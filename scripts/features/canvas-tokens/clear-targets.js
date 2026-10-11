/**
 * Feature: Clear Targets Token Control Button
 * Description: Adds a button to the Token Controls toolbar that removes all targets.
 *              For players, it removes only their own targets; for GMs, it removes targets for both themselves and all connected players.
 *
 * Direct reference to Foundry V14 and DnD5e v6:
 * - Foundry V14 TokenLayer manages targets via canvas.tokens.setTargets(targetIds, {mode}).
 * - canvas.tokens.setTargets([]) clears the user's active targets, broadcasts {targets: []} via userActivity,
 *   and updates tokens via User#_onUpdateTokenTargets([]).
 * - Token#_updateTarget(false, user) updates token.targeted, user.targets (UserTargets Set),
 *   sets refreshTarget render flags, and dispatches Hooks.callAll("targetToken", user, token, false).
 * - In DnD5e v6, Token5e.onTargetToken responds to targetToken hooks (e.g. dynamic token rings).
 * - For GMs, cross-client clearing is synchronized via the module's central socket dispatcher.
 *
 * @introduced v14.39.0
 * @updated v14.41.1
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";

/**
 * Helper to identify core target selection tool ("target" / "CONTROLS.TargetSelect").
 *
 * @param {object} tool
 * @param {string} [key]
 * @returns {boolean}
 */
function isTargetTool(tool, key) {
    return key === "target" || tool?.name === "target" || tool?.title === "CONTROLS.TargetSelect";
}

/**
 * Helper to identify any clear target tool (this module's or auxiliary tools).
 *
 * @param {object} tool
 * @param {string} [key]
 * @param {string} [targetName="clear-targets"]
 * @returns {boolean}
 */
function isClearTargetTool(tool, key, targetName = "clear-targets") {
    if (key === targetName || tool?.name === targetName) return true;
    const name = (tool?.name || key || "").toLowerCase();
    const title = (tool?.title || "").toLowerCase();
    return (name.includes("clear") && name.includes("target")) ||
           (title.includes("clear") && title.includes("target"));
}

/**
 * Register the getSceneControlButtons hook for the Clear Targets button.
 * Called once during init from main.js.
 */
export function initClearTargets() {
    Hooks.on("getSceneControlButtons", (controls) => {
        if (!isFeatureActive("enableClearTargetsButton", "clientEnableClearTargetsButton")) return;

        // Resolve token control group (V13 Array vs V14 Record)
        let tokenLayer = null;
        if (Array.isArray(controls)) {
            tokenLayer = controls.find(c => c.name === "token" || c.name === "tokens");
        } else if (controls && typeof controls === "object") {
            tokenLayer = controls.tokens ?? controls.token ?? null;
        }
        if (!tokenLayer || !tokenLayer.tools) return;

        const toolName = "clear-targets";
        const isGM = game.user.isGM;
        const toolTitle = isGM ? "ND5T.ClearTargets.ButtonTitleGM" : "ND5T.ClearTargets.ButtonTitlePlayer";

        // Locate core target tool to determine target order
        const targetTool = Array.isArray(tokenLayer.tools)
            ? tokenLayer.tools.find(t => isTargetTool(t))
            : (tokenLayer.tools.target ?? Object.values(tokenLayer.tools).find(t => isTargetTool(t)));
        const targetOrder = Number.isFinite(targetTool?.order) ? targetTool.order : 2;

        const clearTool = {
            name: toolName,
            title: toolTitle,
            icon: "fa-solid fa-crosshairs",
            button: true,
            order: targetOrder + 0.05,
            onChange: () => clearTargets()
        };

        if (Array.isArray(tokenLayer.tools)) {
            // Collect any other clear-target tools and remove them to re-insert after target
            const otherClearTools = tokenLayer.tools.filter(t => t?.name !== toolName && isClearTargetTool(t, t?.name, toolName));
            const allClearTools = [clearTool, ...otherClearTools];

            tokenLayer.tools = tokenLayer.tools.filter(t => !isClearTargetTool(t, t?.name, toolName));

            allClearTools.forEach((tool, idx) => {
                tool.order = targetOrder + 0.05 * (idx + 1);
            });

            const targetIdx = tokenLayer.tools.findIndex(t => isTargetTool(t));
            if (targetIdx !== -1) {
                tokenLayer.tools.splice(targetIdx + 1, 0, ...allClearTools);
            } else {
                tokenLayer.tools.push(...allClearTools);
            }
        } else if (typeof tokenLayer.tools === "object") {
            // In Foundry V14, tools is Record<string, SceneControlTool>.
            // Collect this tool and any other clear-target tools
            const clearTools = [[toolName, clearTool]];
            for (const [key, tool] of Object.entries(tokenLayer.tools)) {
                if (key !== toolName && isClearTargetTool(tool, key, toolName)) {
                    clearTools.push([key, tool]);
                }
            }

            // Assign fractional orders right after targetOrder
            clearTools.forEach(([_, tool], idx) => {
                tool.order = targetOrder + 0.05 * (idx + 1);
            });

            const clearKeys = new Set(clearTools.map(([key]) => key));
            const newTools = {};
            let inserted = false;

            for (const [key, tool] of Object.entries(tokenLayer.tools)) {
                if (clearKeys.has(key)) continue;
                newTools[key] = tool;
                if (isTargetTool(tool, key)) {
                    for (const [cKey, cTool] of clearTools) {
                        newTools[cKey] = cTool;
                    }
                    inserted = true;
                }
            }

            if (!inserted) {
                for (const [cKey, cTool] of clearTools) {
                    newTools[cKey] = cTool;
                }
            }

            tokenLayer.tools = newTools;
        }
    });

    // Life-cycle safety net on SceneControls rendering
    Hooks.on("renderSceneControls", (_app, element) => {
        if (!isFeatureActive("enableClearTargetsButton", "clientEnableClearTargetsButton")) return;

        // Resolve root element across V14 (HTMLElement) and V13 (jQuery)
        const html = element instanceof HTMLElement ? element : element?.[0];
        if (!html) return;

        const targetBtn = html.querySelector?.('button.tool[data-tool="target"]');
        const targetLi = targetBtn?.closest("li");
        if (!targetLi) return;

        const clearButtons = html.querySelectorAll?.('button.tool[data-tool="clear-targets"], button.tool[data-tool*="clear"][data-tool*="target"]');
        if (!clearButtons?.length) return;

        let insertAfter = targetLi;
        for (const btn of clearButtons) {
            const li = btn.closest("li");
            if (!li || li === insertAfter) continue;
            if (insertAfter.nextElementSibling !== li) {
                insertAfter.after(li);
            }
            insertAfter = li;
        }
    });

    log("Clear Targets button initialized");
}

/**
 * Clear targets for the active user. If the user is a GM, clears targets for all users
 * locally and broadcasts a socket message to all connected clients.
 *
 * @param {object} [options]
 * @param {boolean} [options.broadcast=true] Whether to emit a socket message to other clients (GM only)
 */
export function clearTargets({ broadcast = true } = {}) {
    if (!canvas.ready || !canvas.tokens) return;

    if (game.user.isGM) {
        debug("Clear Targets | GM clearing all targets across all users");

        // 1. Clear GM's own targets via Foundry V14 TokenLayer API (broadcasts userActivity)
        canvas.tokens.setTargets([]);

        // 2. Clear all other users' targets on this client
        for (const user of game.users) {
            if (user === game.user) continue;
            user._onUpdateTokenTargets([]);
        }

        // 3. Ensure any lingering placeable target indicators are fully cleared and refreshed
        for (const token of canvas.tokens.placeables) {
            if (token.targeted?.size > 0) {
                token.targeted.clear();
                token.renderFlags.set({ refreshTarget: true });
                if (token.hasActiveHUD) token.layer.hud.render();
            }
        }

        // 4. Broadcast to connected player clients via module socket
        if (broadcast) {
            game.socket.emit(`module.${MODULE_ID}`, {
                action: "clearTargets",
                senderId: game.user.id
            });
        }
    } else {
        debug("Clear Targets | Player clearing own targets");
        // Clear own targets via Foundry V14 TokenLayer API (broadcasts userActivity to other clients)
        canvas.tokens.setTargets([]);
    }
}

/**
 * Handle incoming socket message for clearing targets across clients.
 *
 * @param {object} data
 */
export function onClearTargetsSocket(data) {
    if (data?.action !== "clearTargets") return;

    // Security: Only accept clearTargets commands issued by an authenticated GM
    if (data.senderId) {
        const sender = game.users.get(data.senderId);
        if (!sender?.isGM) {
            log(`Clear Targets | Ignored unauthorized clearTargets socket message from non-GM user ${data.senderId}`);
            return;
        }
    }

    debug("Clear Targets | Received clearTargets socket message from GM; clearing targets");

    if (!canvas.ready || !canvas.tokens) return;

    // Clear own targets via Foundry V14 TokenLayer API
    canvas.tokens.setTargets([]);

    // Clear all other users' targets locally on this client
    for (const user of game.users) {
        if (user === game.user) continue;
        user._onUpdateTokenTargets([]);
    }

    // Ensure placeables refresh target indicators
    for (const token of canvas.tokens.placeables) {
        if (token.targeted?.size > 0) {
            token.targeted.clear();
            token.renderFlags.set({ refreshTarget: true });
            if (token.hasActiveHUD) token.layer.hud.render();
        }
    }
}
