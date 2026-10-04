/**
 * Feature: Auto-Target Tokens in Spell Templates
 * Description: Automatically targets tokens enclosed within spell or ability templates placed on the canvas in real time.
 *
 * @introduced v14.19.0
 * @updated v14.35.0 (Full Foundry V14 & DnD5e v6 RegionLayer placement support)
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";

/**
 * State tracking for the active template placement session
 */
let activePlacementActivity = null;
let activePlacementTimestamp = 0;
let initialPlacementTargets = null;
const activePlacementBatchRegionIds = new Set();
let lastChatActionMessageId = null;

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks and wraps for the Template Auto-Targeting feature.
 * Called once during the "setup" phase from main.js.
 * No-op when midi-qol is active.
 */
export function initTemplateTargeting() {
    // Completely disabled when midi-qol is active — it has its own template
    // auto-targeting feature and running both would cause conflicts.
    if (game.modules.get("midi-qol")?.active) {
        log("Template Targeting | midi-qol is active, feature disabled");
        return;
    }

    // Capture activity context when template placement starts in DnD5e 6.x
    Hooks.on("dnd5e.preCreateMeasuredTemplate", (activity, config) => {
        activePlacementActivity = activity;
        activePlacementTimestamp = Date.now();
        activePlacementBatchRegionIds.clear();
        debug(`Template Targeting | Captured preCreateMeasuredTemplate for activity: ${activity?.name || activity?.item?.name}`);
    });

    // Listen to "Place Template" button clicks in chat cards to track which message to update
    document.addEventListener("click", (event) => {
        const button = event.target?.closest?.('[data-action="placeTemplate"]');
        if (button) {
            const messageId = button.closest("[data-message-id]")?.dataset?.messageId;
            if (messageId) lastChatActionMessageId = messageId;
            return;
        }

        // Track when user manually clicks the targeting mode toggle so we do not overwrite their manual choice
        const toggle = event.target?.closest?.(".target-source-toggle");
        if (toggle) {
            const messageId = toggle.closest("[data-message-id]")?.dataset?.messageId;
            const msg = game.messages?.get(messageId);
            if (msg) msg._nd5tUserToggledMode = true;
        }
    }, true);

    // Final placement in DnD5e 6.x: fired with the exact newly created RegionDocument instances
    Hooks.on("dnd5e.postCreateMeasuredTemplate", (activity, created) => {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
        if (!Array.isArray(created) || !created.length) return;

        for (const r of created) {
            if (r?.id) activePlacementBatchRegionIds.add(r.id);
        }

        const targetIds = _getTargetsForRegions(created);
        _setTargetsIfChanged(targetIds);

        // If template placement was triggered from a chat card button, sync targets to that card
        if (lastChatActionMessageId) {
            const message = game.messages?.get(lastChatActionMessageId);
            if (message) {
                _syncTargetsToMessage(message);
            }
            lastChatActionMessageId = null;
        }
    });

    // Sync newly targeted tokens to the usage chat message so save & damage buttons have targets
    Hooks.on("dnd5e.postUseActivity", async (activity, usageConfig, results) => {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
        if (!results?.templates?.length || !results?.message) return;

        await _syncTargetsToMessage(results.message);
    });

    // Ensure chat cards with recorded targets default to "targeted" mode instead of "selected"
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        _ensureTargetedApplicationMode(message, html);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _ensureTargetedApplicationMode(message, html);
    });

    // Wrap RegionLayer.prototype.placeRegion to update targets live as the template preview is moved or rotated
    _wrapRegionLayerPlaceRegion();

    // Final placement fallback: re-run containment against the persisted RegionDocument
    Hooks.on("createRegion", _onCreateRegion);

    // Clean up state if canvas tears down
    Hooks.on("canvasTearDown", () => {
        activePlacementActivity = null;
        initialPlacementTargets = null;
        activePlacementBatchRegionIds.clear();
        lastChatActionMessageId = null;
    });

    log("Template Targeting | Initialized (Foundry V14 / DnD5e v6 Region mode)");
}

// ── RegionLayer Placement Wrapper (Live Preview) ─────────────────────

/**
 * Wrap RegionLayer.prototype.placeRegion to intercept onChange and update targets in real time.
 */
function _wrapRegionLayerPlaceRegion() {
    if (typeof RegionLayer === "undefined" || !RegionLayer.prototype?.placeRegion) return;
    if (RegionLayer.prototype.placeRegion._nd5tTargetingWrapped) return;

    const originalPlaceRegion = RegionLayer.prototype.placeRegion;

    const wrapped = async function(data, options = {}) {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) {
            return originalPlaceRegion.call(this, data, options);
        }

        const isTemplate = _isTemplatePlacement(data, options, this);
        if (!isTemplate) {
            return originalPlaceRegion.call(this, data, options);
        }

        // Capture user targets prior to template placement (only on first region in batch)
        const isFirstRegion = (options._regionIndex ?? 0) === 0;
        if (isFirstRegion) {
            initialPlacementTargets = Array.from(game.user.targets ?? []).map(t => t.id);
        }

        // Intercept onChange to update targets in real-time as the preview moves or rotates
        const origOnChange = options.onChange;
        options.onChange = (args) => {
            _onRegionPlacementChange(args);
            return origOnChange?.(args);
        };

        let result;
        try {
            result = await originalPlaceRegion.call(this, data, options);
            return result;
        } finally {
            // If placement was aborted/cancelled (result is null/falsy), restore previous targets
            if (!result) {
                if (initialPlacementTargets !== null) {
                    _setTargetsIfChanged(initialPlacementTargets);
                    initialPlacementTargets = null;
                }
                activePlacementActivity = null;
            } else if ((options._regionIndex ?? 0) >= (options._regionCount ?? 1) - 1) {
                // Batch completed successfully
                initialPlacementTargets = null;
                activePlacementActivity = null;
            }
        }
    };

    wrapped._nd5tTargetingWrapped = true;
    RegionLayer.prototype.placeRegion = wrapped;
}

/**
 * Determine whether a region placement call represents a template placement.
 * @param {object} data
 * @param {object} options
 * @param {RegionLayer} layer
 * @returns {boolean}
 */
function _isTemplatePlacement(data, options, layer) {
    if (activePlacementActivity && (Date.now() - activePlacementTimestamp < 15000)) {
        return true;
    }
    if (data?.["flags.core.MeasuredTemplate"] || data?.flags?.core?.MeasuredTemplate) {
        return true;
    }
    if (data?.flags?.dnd5e?.activity || data?.flags?.dnd5e?.item) {
        return true;
    }
    if (layer?.templateMode) {
        return true;
    }
    return false;
}

/**
 * Handler for live region placement changes (cursor move, wheel rotation).
 * Evaluates tokens enclosed by all active preview region documents and updates targets.
 * @param {object} args
 */
function _onRegionPlacementChange(args) {
    if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
    if (!canvas?.ready || !canvas?.tokens) return;

    // Collect all preview region documents currently active in this placement session
    const previewDocs = new Set();
    if (args?.document) previewDocs.add(args.document);
    if (args?.preview?.document) previewDocs.add(args.preview.document);

    // Also include any previously confirmed previews from the same batch (e.g. multi-template spells)
    if (canvas.regions?.preview?.children) {
        for (const child of canvas.regions.preview.children) {
            if (child?.document && !child.destroyed) {
                previewDocs.add(child.document);
            }
        }
    }

    if (!previewDocs.size) return;

    const targetIds = _getTargetsForRegions(Array.from(previewDocs));
    _setTargetsIfChanged(targetIds);
}

// ── Hook Handlers (Post-Placement) ───────────────────────────────────

/**
 * Post-placement: finalise targets once when the Region document is created.
 *
 * When the user confirms template placement, dnd5e creates the Region document.
 * The createRegion hook fires on all clients; we guard to only process it for
 * the creating user.
 *
 * Processing is deferred by one tick (setTimeout 0) to allow Foundry to build
 * the Region's polygon tree before we call testInsideRegion().
 *
 * @param {RegionDocument} regionDoc  The newly created Region document.
 * @param {object} options            Creation options.
 * @param {string} userId             The ID of the user who triggered the creation.
 */
function _onCreateRegion(regionDoc, options, userId) {
    // Guard 1: setting enabled
    if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) {
        debug("Template Targeting | createRegion: setting disabled, skipping");
        return;
    }

    // Guard 2: only the placing user runs this
    if (userId !== game.user.id) {
        debug(`Template Targeting | createRegion: userId ${userId} !== game.user.id ${game.user.id}, skipping`);
        return;
    }

    if (!canvas?.ready || !canvas?.tokens) {
        debug("Template Targeting | createRegion: no canvas.tokens, skipping");
        return;
    }

    // Guard 3: check if this region was created from a dnd5e activity/item or core MeasuredTemplate
    const isDnd5eTemplate = !!(regionDoc.flags?.dnd5e?.origin || regionDoc.flags?.dnd5e?.item || regionDoc.flags?.dnd5e?.activity);
    const isCoreTemplate = !!(regionDoc.flags?.core?.MeasuredTemplate);
    if (!isDnd5eTemplate && !isCoreTemplate) {
        debug("Template Targeting | createRegion: not a template region, skipping");
        return;
    }

    debug(`Template Targeting | createRegion: all guards passed for region ${regionDoc.id}, deferring containment check`);

    if (activePlacementActivity && (Date.now() - activePlacementTimestamp < 30000)) {
        activePlacementBatchRegionIds.add(regionDoc.id);
    }

    // Defer by one tick so the Region's polygon tree is fully built before we call testInsideRegion()
    setTimeout(() => {
        _applyTargetsFromRegion(regionDoc);
    }, 0);
}

// ── Containment Helpers ──────────────────────────────────────────────

/**
 * Check if the active placement or any of the given region documents represent a cone or line/ray template.
 * @param {RegionDocument|RegionDocument[]} regionDocs
 * @returns {boolean}
 */
function _isConeOrLine(regionDocs) {
    const actType = activePlacementActivity?.target?.template?.type;
    if (actType && ["cone", "line", "ray"].includes(actType)) return true;

    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];
    for (const doc of docs) {
        if (!doc) continue;
        const shapes = doc.shapes ?? [];
        for (const shape of shapes) {
            if (shape?.type && ["cone", "line", "ray"].includes(shape.type)) return true;
        }
        const templateT = doc.flags?.core?.MeasuredTemplate?.t;
        if (templateT && ["cone", "ray"].includes(templateT)) return true;
        const dnd5eType = doc.flags?.dnd5e?.dimensions?.type;
        if (dnd5eType && ["cone", "line", "ray"].includes(dnd5eType)) return true;
    }
    return false;
}

/**
 * Retrieve token IDs for the originating caster token(s) of the active template.
 * @param {RegionDocument|RegionDocument[]} regionDocs
 * @returns {Set<string>}
 */
function _getOriginatingTokenIds(regionDocs) {
    const ids = new Set();
    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];

    for (const doc of docs) {
        if (!doc) continue;
        const originUuid = doc.flags?.dnd5e?.origin;
        if (originUuid) {
            try {
                const originDoc = fromUuidSync(originUuid, { strict: false });
                if (originDoc?.id) ids.add(originDoc.id);
            } catch (err) {}
        }
    }

    if (activePlacementActivity) {
        try {
            const usageToken = activePlacementActivity.getUsageToken?.();
            if (usageToken?.id) ids.add(usageToken.id);
        } catch (err) {}

        const actor = activePlacementActivity.actor ?? activePlacementActivity.item?.actor;
        if (actor) {
            try {
                const activeTokens = actor.getActiveTokens?.(false, true) ?? actor.getActiveTokens?.() ?? [];
                for (const t of activeTokens) {
                    if (t?.id) ids.add(t.id);
                }
            } catch (err) {}
        }
    }

    if (!ids.size) {
        for (const token of canvas.tokens?.controlled ?? []) {
            ids.add(token.id);
        }
        if (game.user.character) {
            try {
                for (const t of game.user.character.getActiveTokens?.() ?? []) {
                    if (t?.id) ids.add(t.id);
                }
            } catch (err) {}
        }
    }

    return ids;
}

/**
 * Calculate which tokens fall inside any of the specified Region documents.
 * Uses native TokenDocument#testInsideRegion() API.
 * Respects token visibility so non-GMs cannot auto-target hidden tokens.
 * For cone and ray/line templates, always excludes the originating token.
 *
 * @param {RegionDocument|RegionDocument[]} regionDocs  One or more Region documents to test against.
 * @returns {string[]}                                  Array of token IDs enclosed by the regions.
 */
function _getTargetsForRegions(regionDocs) {
    if (!canvas?.tokens?.placeables) return [];
    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];
    if (!docs.length) return [];

    const isDirectional = _isConeOrLine(docs);
    const originIds = isDirectional ? _getOriginatingTokenIds(docs) : null;

    const targetIds = [];
    for (const token of canvas.tokens.placeables) {
        if (!token?.document) continue;

        // Non-GMs cannot target tokens they cannot see
        if (!token.visible && !game.user.isGM) continue;

        // For cone and ray/line templates, always exclude the originating token
        if (originIds?.has(token.id)) continue;

        let inside = false;
        for (const doc of docs) {
            try {
                if (token.document.testInsideRegion(doc)) {
                    inside = true;
                    break;
                }
            } catch (err) {
                debug("Template Targeting | testInsideRegion error:", err);
            }
        }

        if (inside) targetIds.push(token.id);
    }

    return targetIds;
}

/**
 * Updates game.user.targets only if the new set of target IDs differs from the current targets.
 * Avoids unnecessary re-rendering and socket traffic on micro-movements.
 *
 * @param {string[]} newTargetIds  The new list of targeted token IDs.
 */
function _setTargetsIfChanged(newTargetIds) {
    if (!canvas?.tokens) return;
    const currentTargets = game.user.targets;
    const currentIds = new Set(Array.from(currentTargets ?? []).map(t => t.id));

    if (newTargetIds.length === currentIds.size && newTargetIds.every(id => currentIds.has(id))) {
        return;
    }

    debug(`Template Targeting | Updating targets: [${newTargetIds.join(", ")}]`);
    canvas.tokens.setTargets(newTargetIds);
}

/**
 * Compute which tokens fall inside a persisted Region (final placement) and
 * update game.user.targets accordingly.
 * Only evaluates the newly created region(s) from the current placement batch,
 * avoiding old historical regions left on the scene from previous spell casts.
 *
 * @param {RegionDocument} regionDoc  The persisted Region document.
 */
function _applyTargetsFromRegion(regionDoc) {
    if (!canvas?.tokens) return;

    // Only evaluate regions created in the current placement batch, or this specific region.
    // NEVER query the entire scene by activityUuid, as that would include all historical regions from previous casts!
    let regionsToEvaluate = [regionDoc];
    if (activePlacementBatchRegionIds.has(regionDoc.id) && activePlacementBatchRegionIds.size > 1) {
        regionsToEvaluate = Array.from(activePlacementBatchRegionIds)
            .map(id => canvas.scene?.regions?.get(id))
            .filter(Boolean);
        if (!regionsToEvaluate.length) regionsToEvaluate = [regionDoc];
    }

    const targetIds = _getTargetsForRegions(regionsToEvaluate);
    debug(`Template Targeting | Final placement: targeting ${targetIds.length} token(s) in region(s)`);

    _setTargetsIfChanged(targetIds);
}

// ── Chat Card Application Mode Synchronization ──────────────────────

/**
 * Synchronize targets to a chat message and ensure its targeting mode defaults to "targeted".
 * @param {ChatMessage} message
 */
async function _syncTargetsToMessage(message) {
    if (!message) return;
    const targetDescriptors = dnd5e.dataModels?.chatMessage?.fields?.TargetsField?.getDescriptors?.(game.user.targets) ?? [];
    if (!targetDescriptors.length) return;

    if (message._targetState) {
        message._targetState.mode = "targeted";
    }

    try {
        await message.update({ "system.targets": targetDescriptors });
        debug(`Template Targeting | Synchronized ${targetDescriptors.length} target(s) to message ${message.id} (mode: targeted)`);
    } catch (err) {
        debug("Template Targeting | Failed to update chat message targets:", err);
    }

    _setTargetingModeOnElements(message.id, "targeted");
}

/**
 * Update live <recorded-targets> elements for a message to the specified mode.
 * @param {string} messageId
 * @param {"targeted"|"selected"} mode
 */
function _setTargetingModeOnElements(messageId, mode = "targeted") {
    if (!messageId) return;
    const query = `[data-message-id="${messageId}"] recorded-targets`;
    for (const el of document.querySelectorAll(query)) {
        if (el.hasRecordedTargets && el.targetingMode !== mode) {
            el.targetingMode = mode;
        }
    }
}

/**
 * Ensure chat cards with recorded targets default to "targeted" mode instead of "selected".
 * Preserves explicit manual toggle if the user clicked the toggle button.
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery} html
 */
function _ensureTargetedApplicationMode(message, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const origin = message.getOriginatingMessage?.();
    const hasTargets = !!(message.system?.targets?.length || origin?.system?.targets?.length);
    if (!hasTargets) return;

    // If user clicked the toggle button explicitly on this message, respect their choice
    if (message._nd5tUserToggledMode) return;

    if (message._targetState && message._targetState.mode !== "targeted") {
        message._targetState.mode = "targeted";
    }
    if (origin && !origin._nd5tUserToggledMode && origin._targetState && origin._targetState.mode !== "targeted") {
        origin._targetState.mode = "targeted";
    }

    for (const el of root.querySelectorAll("recorded-targets")) {
        if (el.hasRecordedTargets && el.targetingMode !== "targeted") {
            el.targetingMode = "targeted";
        }
    }
}
