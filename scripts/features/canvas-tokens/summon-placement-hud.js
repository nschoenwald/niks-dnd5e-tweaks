/**
 * Feature: Summoning Placement Controls HUD, Range Preview & Scroll Rotation
 * Description: Displays a floating HUD banner with key controls, live distance vs. max range badge, dynamic rotation readout, canvas range boundary ring, and inverted wheel scrolling during summoning placement.
 *
 * @introduced v14.36.0
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";
import { attachHudPositioning } from "./hud-position-helper.js";

/**
 * State tracking for pending and active summon HUD sessions
 */
let pendingSummonData = null;
let activeSummonHudSession = null;
let pendingCloseTimeout = null;

/**
 * Escape HTML characters to prevent XSS in creature / spell names
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Initialize the Summon Placement Controls HUD feature.
 * Registers necessary hooks and wraps TokenLayer.prototype.placeTokens for Foundry V14 and DnD5e 6.x.
 */
export function initSummonPlacementHUD() {
    // 1. DnD5e hook fired right before summoning placement begins
    Hooks.on("dnd5e.preSummon", (activity, profile, options) => {
        const originToken = _resolveOriginToken(activity);
        const range = _resolveSummonRange(activity);
        const spellName = activity?.item?.name || activity?.name || "Summon";
        const profileName = profile?.name || null;
        const profileCount = profile?.count || 1;
        const img = activity?.item?.img || null;

        pendingSummonData = {
            activity,
            profile,
            options,
            originToken,
            range,
            spellName,
            profileName,
            profileCount,
            img,
            timestamp: Date.now()
        };

        debug(`Captured pending summon activity: "${spellName}" -> "${profileName}" (range: ${range.value ?? "unlimited"} ${range.units})`);
    });

    // 2. Wrap TokenLayer.prototype.placeTokens for Foundry V14 / DnD5e v6
    _wrapTokenLayerPlaceTokens();

    // 3. Clean up HUD if canvas tears down or changes scenes
    Hooks.on("canvasTearDown", () => _closeHudSession(true));
    Hooks.on("canvasInit", () => _closeHudSession(true));

    log("Summoning Placement Controls HUD initialized (Foundry V14 / DnD5e v6)");
}

/* -------------------------------------------- */
/*  Origin Token & Range Helpers                */
/* -------------------------------------------- */

/**
 * Resolve the origin (caster) token from the summon activity.
 * @param {Activity} activity
 * @returns {TokenDocument|Token|null}
 */
function _resolveOriginToken(activity) {
    try {
        const usageToken = activity?.getUsageToken?.();
        if (usageToken?.object) return usageToken.object;
        if (usageToken?.id) return canvas.tokens?.get(usageToken.id) ?? usageToken;

        // Fallback: active tokens of the actor
        const actorTokens = activity?.actor?.getActiveTokens?.();
        if (actorTokens?.length) return actorTokens[0];

        // Fallback: current controlled token
        if (canvas.tokens?.controlled?.length) return canvas.tokens.controlled[0];
    } catch (err) {
        debug("Could not resolve summon origin token:", err);
    }
    return null;
}

/**
 * Resolve the maximum range configuration from the summon activity or its parent item.
 * @param {Activity} activity
 * @returns {{value: number|null, units: string, isTouch: boolean}}
 */
function _resolveSummonRange(activity) {
    const rangeData = activity?.range?.override
        ? activity.range
        : (activity?.item?.system?.range ?? activity?.range);

    const units = rangeData?.units || canvas.scene?.grid?.units || "ft";
    const isTouch = units === "touch";
    let value = null;

    if (isTouch) {
        value = 5;
    } else if (rangeData?.value !== undefined && rangeData?.value !== null && rangeData?.value !== "") {
        const parsed = Number(rangeData.value);
        if (!Number.isNaN(parsed) && parsed > 0) {
            value = parsed;
        }
    }

    return { value, units, isTouch };
}

/**
 * Safely get the center point from a token or token document.
 * @param {Token|TokenDocument|object} token
 * @returns {{x: number, y: number}|null}
 */
function _getTokenCenter(token) {
    if (!token) return null;
    if (typeof token.getCenterPoint === "function") {
        return token.getCenterPoint();
    }
    if (token.center) {
        return { x: token.center.x, y: token.center.y };
    }
    if (token.x !== undefined && token.y !== undefined) {
        const w = token.w ?? token.width ?? canvas.grid?.size ?? 100;
        const h = token.h ?? token.height ?? canvas.grid?.size ?? 100;
        return { x: token.x + (w / 2), y: token.y + (h / 2) };
    }
    return null;
}

/* -------------------------------------------- */
/*  Foundry V14 / DnD5e v6 TokenLayer Patch      */
/* -------------------------------------------- */

/**
 * Wrap TokenLayer.prototype.placeTokens to inject the HUD banner and range boundary ring.
 */
function _wrapTokenLayerPlaceTokens() {
    if (typeof TokenLayer === "undefined" || !TokenLayer.prototype?.placeTokens) return;
    if (TokenLayer.prototype.placeTokens._nd5tSummonWrapped) return;

    const originalPlaceTokens = TokenLayer.prototype.placeTokens;

    const wrapped = async function(data, options = {}) {
        if (!isFeatureActive("enableSummonControlsHUD", "clientEnableSummonControlsHUD")) {
            return originalPlaceTokens.call(this, data, options);
        }

        const isSummon = _isSummonPlacement(data, options);
        if (!isSummon) {
            return originalPlaceTokens.call(this, data, options);
        }

        const summonData = (pendingSummonData && (Date.now() - pendingSummonData.timestamp < 30000))
            ? pendingSummonData
            : null;

        // Fix mystery man token preview textures for summon placement
        await _fixSummonTokenTextures(data, summonData);

        // Intercept onChange to track live rotation, coordinates, and distance
        const origOnChange = options.onChange;
        options.onChange = (args) => {
            const res = origOnChange?.(args);
            _onSummonPlacementChange(args);
            return res;
        };

        // Intercept onRotate
        const origOnRotate = options.onRotate;
        options.onRotate = (args) => {
            const res = origOnRotate ? origOnRotate(args) : undefined;
            if (res !== false) {
                _onSummonPlacementRotate(args);
            }
            return res;
        };

        // Initialize HUD session
        _openOrUpdateSummonHud({
            data,
            summonData,
            layer: this
        });

        let result;
        try {
            result = await originalPlaceTokens.call(this, data, options);
            return result;
        } finally {
            _scheduleHudClose();
            pendingSummonData = null;
        }
    };

    wrapped._nd5tSummonWrapped = true;
    TokenLayer.prototype.placeTokens = wrapped;
}

/**
 * Resolves the configured default wildcard image if one is defined
 * (e.g. from Token HUD Wildcard "flags.token-hud-wildcard.default", Token Variant Art, or token flags).
 * @param {object} tokenData
 * @param {Actor} [actor]
 * @returns {string|null}
 */
function _getDefaultWildcardImage(tokenData, actor) {
    const candidates = [
        tokenData?.flags?.["token-hud-wildcard"]?.default,
        tokenData?.flags?.tokenHudWildcard?.default,
        actor?.prototypeToken?.flags?.["token-hud-wildcard"]?.default,
        actor?.prototypeToken?.flags?.tokenHudWildcard?.default,
        actor?.flags?.["token-hud-wildcard"]?.default,
        actor?.flags?.tokenHudWildcard?.default,
        tokenData?.flags?.["token-variants"]?.default,
        actor?.prototypeToken?.flags?.["token-variants"]?.default,
        actor?.flags?.["token-variants"]?.default,
        tokenData?.flags?.wildcardDefault,
        actor?.prototypeToken?.flags?.wildcardDefault,
        actor?.flags?.wildcardDefault
    ];

    for (const img of candidates) {
        if (typeof img === "string" && img.trim().length > 0 && img !== CONST.DEFAULT_TOKEN && img !== "icons/svg/mystery-man.svg" && !img.includes("*")) {
            return img.trim();
        }
    }
    return null;
}

/**
 * Fixes texture sources in summon placement token data so that the native Foundry preview
 * displays the actual creature artwork instead of the mystery man fallback.
 * @param {object[]} data
 * @param {object} summonData
 */
async function _fixSummonTokenTextures(data, summonData) {
    if (!Array.isArray(data)) return;

    for (const tokenData of data) {
        let actor = null;
        if (tokenData.actorId) {
            actor = game.actors?.get(tokenData.actorId);
        }
        if (!actor && summonData?.profile?.uuid) {
            try {
                actor = await fromUuid(summonData.profile.uuid);
            } catch {
                // ignore
            }
        }
        if (!actor && summonData?.activity?.actor) {
            actor = summonData.activity.actor;
        }

        // Priority 1: Check for an explicit default wildcard image (e.g. Token HUD Wildcard)
        const defaultWildcardImage = _getDefaultWildcardImage(tokenData, actor);
        if (defaultWildcardImage) {
            tokenData.texture ??= {};
            tokenData.texture.src = defaultWildcardImage;
            tokenData.randomImg = false;
            debug(`Resolved default wildcard image for summon preview: "${defaultWildcardImage}"`);
            continue;
        }

        const currentSrc = tokenData.texture?.src;
        const isMysteryMan = !currentSrc || currentSrc === CONST.DEFAULT_TOKEN || currentSrc === "icons/svg/mystery-man.svg";
        const isWildcard = tokenData.randomImg || (typeof currentSrc === "string" && currentSrc.includes("*"));

        // Priority 2: Resolve wildcard pattern if present
        if (isWildcard && actor && typeof actor.getTokenImages === "function") {
            try {
                const images = await actor.getTokenImages();
                if (images?.length) {
                    tokenData.texture ??= {};
                    tokenData.texture.src = images[Math.floor(Math.random() * images.length)];
                    tokenData.randomImg = false;
                    continue;
                }
            } catch (err) {
                debug("Could not resolve wildcard images for preview:", err);
            }
        }

        // Priority 3: Fall back from mystery man to actor artwork
        if (isMysteryMan || isWildcard) {
            const candidateSrc = (actor?.prototypeToken?.texture?.src && actor.prototypeToken.texture.src !== CONST.DEFAULT_TOKEN && !actor.prototypeToken.texture.src.includes("*"))
                ? actor.prototypeToken.texture.src
                : (actor?.img && actor.img !== CONST.DEFAULT_TOKEN)
                    ? actor.img
                    : summonData?.img;

            if (candidateSrc && candidateSrc !== CONST.DEFAULT_TOKEN) {
                tokenData.texture ??= {};
                tokenData.texture.src = candidateSrc;
            }
        }
    }
}

/**
 * Determine whether a placeTokens call corresponds to a summoning action.
 * @param {object[]} data
 * @param {object} options
 * @returns {boolean}
 */
function _isSummonPlacement(data, options) {
    if (pendingSummonData && (Date.now() - pendingSummonData.timestamp < 30000)) {
        return true;
    }
    if (Array.isArray(data) && data.some(d => d.flags?.dnd5e?.summon || d.flags?.dnd5e?.activity)) {
        return true;
    }
    return false;
}

/**
 * Handler called on token placement change (movement or rotation).
 * Updates distance badge, in-range/out-of-range status, and rotation readout.
 * @param {object} args
 */
function _onSummonPlacementChange(args) {
    if (!activeSummonHudSession) return;

    const { preview, document, index, count } = args || {};

    if (index !== undefined && count !== undefined) {
        _updateStepDisplay(index, count);
    }

    _updateDistanceDisplay(preview, document);
}

/**
 * Handler called on token placement rotate.
 * @param {object} args
 */
function _onSummonPlacementRotate(args) {
    // Rotation is visually tracked on canvas token preview directly; no HUD badge update needed.
}


/* -------------------------------------------- */
/*  HUD Lifecycle & DOM Management               */
/* -------------------------------------------- */

/**
 * Opens a new HUD banner or updates an existing one for summoning.
 * @param {object} params
 */
function _openOrUpdateSummonHud({ data, summonData, layer }) {
    if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
    }

    const firstToken = data?.[0] || {};
    const totalCount = data?.length || 1;
    const spellName = summonData?.spellName || "Summoning";
    const creatureName = summonData?.profileName || firstToken.name || "Summoned Creature";
    let img = firstToken.texture?.src || summonData?.img || null;
    if (img === CONST.DEFAULT_TOKEN || img === "icons/svg/mystery-man.svg") {
        img = summonData?.img || null;
    }
    const originToken = summonData?.originToken || null;
    const range = summonData?.range || { value: null, units: canvas.scene?.grid?.units || "ft", isTouch: false };

    const initialRotation = firstToken.rotation ?? 0;

    // Build or update canvas range ring
    let rangeRing = null;
    const originCenter = _getTokenCenter(originToken);
    if (canvas.controls && originCenter && range?.value && Number.isFinite(range.value)) {
        const gridDist = canvas.scene?.grid?.distance || 5;
        const gridSize = canvas.grid?.size || 100;
        const radiusPixels = (range.value / gridDist) * gridSize;

        rangeRing = new PIXI.Graphics();
        canvas.controls.addChild(rangeRing);
        _drawRangeRing(rangeRing, originCenter, radiusPixels, true);
    }

    // Create DOM Element
    const hudElement = _createSummonHudElement({
        spellName,
        creatureName,
        img,
        totalCount,
        range,
        hasOrigin: !!originCenter,
        onCancel: () => _cancelPlacement({ layer })
    });

    document.body.appendChild(hudElement);
    const detachPositioning = attachHudPositioning(hudElement);

    activeSummonHudSession = {
        hudElement,
        detachPositioning,
        data,
        summonData,
        layer,
        originToken,
        originCenter,
        range,
        creatureName,
        spellName,
        totalCount,
        currentIndex: 0,
        rotation: initialRotation,
        rangeRing,
        lastInRange: true
    };

    debug(`Opened Summoning Placement HUD for "${spellName}" (${creatureName})`);
}

/**
 * Cancel the active token placement session when the cancel button or shortcut is used.
 * @param {object} context
 */
function _cancelPlacement({ layer } = {}) {
    debug("Cancelling summon token placement via HUD");
    try {
        if (canvas.tokens?._placementContext) {
            canvas.tokens._cancelPlacement();
        } else if (layer?._placementContext) {
            layer._cancelPlacement();
        }
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to cancel summon placement:", err);
    }
    _closeHudSession(false);
}

/**
 * Creates the DOM element for the floating summon placement HUD banner.
 * @param {object} params
 * @returns {HTMLElement}
 */
function _createSummonHudElement({ spellName, creatureName, img, totalCount, range, hasOrigin, onCancel }) {
    const hud = document.createElement("div");
    hud.id = "nd5t-summon-hud";
    hud.className = "nd5t-summon-hud";

    const subtitle = totalCount > 1
        ? `${escapeHTML(creatureName)} • Summon 1 of ${totalCount}`
        : escapeHTML(creatureName);

    const iconHtml = img
        ? `<img class="nd5t-summon-badge-img" src="${img}" alt="${escapeHTML(creatureName)}" />`
        : `<i class="fa-solid fa-wand-magic-sparkles"></i>`;

    const distanceBadgeHtml = (hasOrigin && range.value)
        ? `
            <div class="nd5t-summon-status-badge in-range" id="nd5t-summon-distance-badge" title="Live distance from caster vs maximum spell range">
                <i class="fa-solid fa-check"></i>
                <span id="nd5t-summon-distance-text">In Range (0 / ${range.value} ${range.units})</span>
            </div>
            <div class="nd5t-summon-divider" aria-hidden="true"></div>
        `
        : (hasOrigin)
            ? `
            <div class="nd5t-summon-status-badge in-range" id="nd5t-summon-distance-badge" title="Live distance from caster">
                <i class="fa-solid fa-location-dot"></i>
                <span id="nd5t-summon-distance-text">0 ${range.units}</span>
            </div>
            <div class="nd5t-summon-divider" aria-hidden="true"></div>
        `
            : "";

    hud.innerHTML = `
        <div class="nd5t-summon-hud-content">
            <div class="nd5t-summon-badge-icon" aria-hidden="true">
                ${iconHtml}
            </div>
            <div class="nd5t-summon-info">
                <span class="nd5t-summon-title">${escapeHTML(spellName)}</span>
                <span class="nd5t-summon-subtitle" id="nd5t-summon-subtitle">${subtitle}</span>
            </div>
            <div class="nd5t-summon-divider" aria-hidden="true"></div>
            ${distanceBadgeHtml}
            <div class="nd5t-summon-controls">
                <div class="nd5t-summon-control-badge" title="Scroll mouse wheel to zoom canvas">
                    <kbd class="nd5t-summon-kbd"><i class="fa-solid fa-magnifying-glass"></i> Scroll</kbd>
                    <span class="nd5t-summon-control-label">Zoom</span>
                </div>
                <div class="nd5t-summon-control-badge" title="Hold Shift and scroll mouse wheel to rotate token facing">
                    <span class="nd5t-summon-kbd-combo">
                        <kbd class="nd5t-summon-kbd">Shift</kbd>
                        <span class="nd5t-summon-kbd-plus">+</span>
                        <kbd class="nd5t-summon-kbd"><i class="fa-solid fa-arrows-rotate"></i> Scroll</kbd>
                    </span>
                    <span class="nd5t-summon-control-label">Facing</span>
                </div>
                <div class="nd5t-summon-control-badge" title="Left-click on canvas to place token">
                    <kbd class="nd5t-summon-kbd"><i class="fa-solid fa-arrow-pointer"></i> Click</kbd>
                    <span class="nd5t-summon-control-label">Place</span>
                </div>
                <div class="nd5t-summon-control-badge" title="Hold Shift while placing to freely position without snapping to grid">
                    <kbd class="nd5t-summon-kbd">Shift</kbd>
                    <span class="nd5t-summon-control-label">Free Snap</span>
                </div>
            </div>
            <div class="nd5t-summon-divider" aria-hidden="true"></div>
            <div class="nd5t-summon-actions">
                <kbd class="nd5t-summon-kbd" title="Right-click canvas or press Escape to cancel / skip">ESC / Right-Click</kbd>
                <button type="button" class="nd5t-summon-cancel-btn" title="Cancel Summoning Placement">
                    <i class="fa-solid fa-xmark"></i>
                    <span>Cancel</span>
                </button>
            </div>
        </div>
    `;

    hud.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
    });

    const cancelBtn = hud.querySelector(".nd5t-summon-cancel-btn");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
        });
    }

    return hud;
}

/**
 * Updates the multi-creature step subtitle (e.g. "Summon 2 of 4").
 * @param {number} index
 * @param {number} count
 */
function _updateStepDisplay(index, count) {
    if (!activeSummonHudSession?.hudElement) return;
    const subEl = activeSummonHudSession.hudElement.querySelector("#nd5t-summon-subtitle");
    if (!subEl) return;

    activeSummonHudSession.currentIndex = index;
    activeSummonHudSession.totalCount = count;

    if (count > 1) {
        subEl.textContent = `${activeSummonHudSession.creatureName} • Summon ${index + 1} of ${count}`;
    } else {
        subEl.textContent = activeSummonHudSession.creatureName;
    }
}

/**
 * Measures live distance between caster and summon preview, updating the HUD badge and canvas ring.
 * @param {Token} preview
 * @param {TokenDocument} document
 */
function _updateDistanceDisplay(preview, document) {
    if (!activeSummonHudSession) return;
    const { originCenter, range, hudElement, rangeRing } = activeSummonHudSession;
    if (!originCenter || !hudElement) return;

    const badge = hudElement.querySelector("#nd5t-summon-distance-badge");
    const textEl = hudElement.querySelector("#nd5t-summon-distance-text");
    if (!badge || !textEl) return;

    const targetCenter = _getTokenCenter(document) || _getTokenCenter(preview);
    if (!targetCenter) return;

    let distance = 0;
    try {
        distance = canvas.grid.measurePath([originCenter, targetCenter]).distance;
    } catch {
        const dx = (targetCenter.x - originCenter.x) / (canvas.grid.size || 100);
        const dy = (targetCenter.y - originCenter.y) / (canvas.grid.size || 100);
        distance = Math.round(Math.hypot(dx, dy) * (canvas.scene?.grid?.distance || 5));
    }

    const roundedDist = Math.round(distance);

    if (range.value) {
        const inRange = distance <= (range.value + 0.001);

        if (inRange !== activeSummonHudSession.lastInRange) {
            activeSummonHudSession.lastInRange = inRange;
            if (rangeRing) {
                const gridDist = canvas.scene?.grid?.distance || 5;
                const gridSize = canvas.grid?.size || 100;
                const radiusPixels = (range.value / gridDist) * gridSize;
                _drawRangeRing(rangeRing, originCenter, radiusPixels, inRange);
            }
        }

        if (inRange) {
            badge.className = "nd5t-summon-status-badge in-range";
            badge.innerHTML = `<i class="fa-solid fa-check"></i> <span id="nd5t-summon-distance-text">In Range (${roundedDist} / ${range.value} ${range.units})</span>`;
        } else {
            badge.className = "nd5t-summon-status-badge out-of-range";
            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span id="nd5t-summon-distance-text">Out of Range (${roundedDist} / ${range.value} ${range.units})</span>`;
        }
    } else {
        badge.className = "nd5t-summon-status-badge in-range";
        badge.innerHTML = `<i class="fa-solid fa-location-dot"></i> <span id="nd5t-summon-distance-text">${roundedDist} ${range.units}</span>`;
    }
}

/**
 * Draws or updates the visual range boundary circle on canvas.
 * @param {PIXI.Graphics} graphics
 * @param {{x: number, y: number}} center
 * @param {number} radius
 * @param {boolean} inRange
 */
function _drawRangeRing(graphics, center, radius, inRange) {
    if (!graphics || graphics.destroyed) return;
    graphics.clear();

    const color = inRange ? 0x8b5cf6 : 0xef4444; // Conjuration Violet vs Warning Red
    const strokeAlpha = inRange ? 0.7 : 0.85;
    const fillAlpha = inRange ? 0.05 : 0.08;

    graphics.lineStyle(2, color, strokeAlpha);
    graphics.beginFill(color, fillAlpha);
    graphics.drawCircle(center.x, center.y, radius);
    graphics.endFill();
}

/**
 * Schedules closing the HUD with a short debounce to allow sequential token placements.
 */
function _scheduleHudClose() {
    if (pendingCloseTimeout) clearTimeout(pendingCloseTimeout);
    pendingCloseTimeout = setTimeout(() => {
        _closeHudSession(false);
        pendingCloseTimeout = null;
    }, 60);
}

/**
 * Closes and removes the HUD banner and range ring with animation.
 * @param {boolean} [immediate=false]
 */
function _closeHudSession(immediate = false) {
    if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
    }

    if (!activeSummonHudSession) return;

    const { hudElement, rangeRing, detachPositioning } = activeSummonHudSession;
    activeSummonHudSession = null;
    detachPositioning?.();

    // Clean up range ring
    if (rangeRing) {
        try {
            if (!rangeRing.destroyed) rangeRing.destroy({ children: true });
        } catch {
            // ignore
        }
    }

    if (!hudElement || !hudElement.isConnected) return;

    if (immediate) {
        hudElement.remove();
        return;
    }

    hudElement.classList.add("nd5t-summon-fade-out");
    setTimeout(() => {
        if (hudElement.isConnected) hudElement.remove();
    }, 200);
}
