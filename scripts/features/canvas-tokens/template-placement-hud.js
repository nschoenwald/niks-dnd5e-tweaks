/**
 * Feature: Template Placement Controls HUD & Scroll Rotation
 * Description: Displays a floating HUD banner with key controls (Scroll to rotate, Shift+Scroll to zoom, Left-Click to place, Right-Click / ESC to cancel, and Shift for free snap) and inverts wheel scrolling during template placement.
 *
 * @introduced v14.35.0
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";
import { attachHudPositioning } from "./hud-position-helper.js";

/**
 * State tracking for the active template HUD session
 */
let activeHudSession = null;
let activeTemplateActivity = null;
let activeTemplateConfig = null;
let activeTemplateTimestamp = 0;
let pendingCloseTimeout = null;
let _emanationHoverRaf = null;

/**
 * Escape HTML characters to prevent XSS in template names
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
 * Initialize the Template Placement Controls HUD feature.
 * Registers necessary hooks and wraps placement methods for Foundry V14 (Regions) and DnD5e 6.x.
 */
export function initTemplatePlacementHUD() {
    // 1. DnD5e hook fired right before template placement begins
    Hooks.on("dnd5e.preCreateMeasuredTemplate", (activity, config) => {
        activeTemplateActivity = activity;
        activeTemplateConfig = config;
        activeTemplateTimestamp = Date.now();
        debug(`Captured pending template placement activity: "${activity?.item?.name || activity?.name}"`);

        // If auto-attach self emanation is active, prevent character sheet minimize/restore flicker
        if (_shouldAutoAttachSelfEmanation(activity, config)) {
            config.minimizeWindows = false;
        }
    });

    // 2. Wrap RegionLayer.prototype.placeRegion for Foundry V14 / DnD5e v6
    _wrapRegionLayerPlaceRegion();

    // 3. Clean up HUD if canvas tears down or changes scenes
    Hooks.on("canvasTearDown", () => _closeHudSession(true));
    Hooks.on("canvasInit", () => _closeHudSession(true));

    // 4. Invert wheel scrolling during template placement: Scroll rotates, Shift+Scroll zooms
    window.addEventListener("wheel", _onWindowWheelCapture, { capture: true, passive: false });

    log("Template Placement Controls HUD & Scroll Rotation initialized (Foundry V14 / DnD5e v6)");
}

/* -------------------------------------------- */
/*  Foundry V14 / DnD5e v6 RegionLayer Patch     */
/* -------------------------------------------- */

/**
 * Wrap RegionLayer.prototype.placeRegion to inject the HUD banner during template placement.
 */
function _wrapRegionLayerPlaceRegion() {
    if (typeof RegionLayer === "undefined" || !RegionLayer.prototype?.placeRegion) return;
    if (RegionLayer.prototype.placeRegion._nd5tHudWrapped) return;

    const originalPlaceRegion = RegionLayer.prototype.placeRegion;

    const wrapped = async function(data, options = {}) {
        const isTemplate = _isTemplatePlacement(data, options, this);
        if (!isTemplate) {
            return originalPlaceRegion.call(this, data, options);
        }

        const currentActivity = (Date.now() - activeTemplateTimestamp < 15000) ? activeTemplateActivity : null;
        const shape = data.shapes?.[0];
        const isEmanation = (shape?.type === "emanation")
            || Boolean(data.shapes?.some(s => s?.type === "emanation"))
            || Boolean(options?.attachToToken);

        // Check if auto-attaching self emanation is enabled and applies
        if (isEmanation && _shouldAutoAttachSelfEmanation(currentActivity, data, options)) {
            const autoAttachedDoc = _autoAttachSelfEmanation(currentActivity, data, options);
            if (autoAttachedDoc) {
                return autoAttachedDoc;
            }
        }

        if (!isFeatureActive("enableTemplateControlsHUD", "clientEnableTemplateControlsHUD")) {
            return originalPlaceRegion.call(this, data, options);
        }

        // Intercept onChange to track live rotation, coordinates, and shape updates
        const origOnChange = options.onChange;
        options.onChange = (args) => {
            _onRegionPlacementChange(args);
            return origOnChange?.(args);
        };

        const origOnRotate = options.onRotate;
        options.onRotate = (args) => {
            const res = origOnRotate ? origOnRotate(args) : undefined;
            if (res !== false) {
                _onRegionPlacementRotate(args);
            }
            return res;
        };

        // If placing an emanation and placement confirms without a token attached, inform user
        const origPreConfirm = options.preConfirm;
        options.preConfirm = (args) => {
            if (isEmanation && !args?.document?.attachment?.token) {
                ui.notifications.info("Note: Emanation placed on empty ground without an attached token. (To attach to a creature, click directly on their token.)");
            }
            return origPreConfirm?.(args);
        };

        const regionIndex = options._regionIndex ?? 0;
        const regionCount = options._regionCount ?? 1;

        _openOrUpdateHud({
            activity: currentActivity,
            data,
            shape,
            regionIndex,
            regionCount,
            layer: this,
            isEmanation
        });

        let result;
        try {
            result = await originalPlaceRegion.call(this, data, options);
            return result;
        } finally {
            // If placement was cancelled or this was the last region in the batch, schedule close
            if (!result || regionCount <= 1 || regionIndex >= regionCount - 1) {
                _scheduleHudClose();
                activeTemplateActivity = null;
                activeTemplateConfig = null;
            }
        }
    };

    wrapped._nd5tHudWrapped = true;
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
    if (activeTemplateActivity && (Date.now() - activeTemplateTimestamp < 15000)) {
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
    if (Array.isArray(data?.shapes) && data.shapes.some(s => ["circle", "cone", "emanation", "line", "ray", "rect", "rectangle", "ring"].includes(s?.type))) {
        return true;
    }
    return false;
}

/**
 * Called on Region placement change event to update the rotation angle readout in real time.
 * @param {object} args
 */
function _onRegionPlacementChange(args) {
    if (!activeHudSession) return;
    const shape = args?.shape || args?.preview?.document?.shapes?.at(-1);
    if (shape && shape.rotation !== undefined) {
        _updateRotationDisplay(shape.rotation);
    }
    if (activeHudSession.isEmanation) {
        _updateEmanationHoverState(args?.document?.attachment?.token);
    }
}

/**
 * Called on Region placement rotate event.
 * @param {object} args
 */
function _onRegionPlacementRotate(args) {
    if (!activeHudSession) return;
    const shape = args?.shape;
    if (shape && shape.rotation !== undefined) {
        _updateRotationDisplay(shape.rotation);
    }
}

/* -------------------------------------------- */
/*  Mouse Wheel Behavior Override               */
/* -------------------------------------------- */

/**
 * Intercept mousewheel events on window during the capture phase when placing a template.
 * Inverts the behavior:
 * - Plain scroll -> Rotates directional templates (or zooms if non-rotatable/emanation)
 * - Shift + scroll -> Zooms the canvas
 * @param {WheelEvent} event
 */
function _onWindowWheelCapture(event) {
    if (!canvas?.ready) return;
    if (!isFeatureActive("enableTemplateControlsHUD", "clientEnableTemplateControlsHUD")) return;

    // Only intervene if a template placement session is actively running in Foundry V14
    if (!canvas.regions?._placementContext) return;

    // Check if the cursor is over the canvas board
    const hover = document.elementFromPoint(event.clientX, event.clientY);
    if (!hover || (hover.id !== "board")) return;

    const isCtrl = game.keyboard.isModifierActive("CONTROL") || event.ctrlKey;
    const isShift = event.shiftKey;

    let dy = event.deltaY;
    if (isShift && dy === 0) dy = event.deltaX;
    if (dy === 0) return;

    // Intercept event from Foundry's default MouseManager handler
    event.preventDefault();
    event.stopImmediatePropagation();

    event.delta = dy;

    // If active placement is an emanation (or shape cannot rotate), plain scroll zooms canvas
    if (activeHudSession?.isEmanation || !activeHudSession?.canRotate) {
        canvas._onMouseWheel(event);
        return;
    }

    if (isShift || isCtrl) {
        // Shift + Scroll (or Ctrl / Trackpad pinch): Zoom the canvas
        canvas._onMouseWheel(event);
    } else {
        // Plain Scroll: Rotate the template
        canvas.regions._onMouseWheel(event);
    }
}

/* -------------------------------------------- */
/*  Self-Emanation Auto-Attachment Logic        */
/* -------------------------------------------- */

/**
 * Determine whether a pending placement represents an emanation from an activity targeting self,
 * and whether the auto-attach sub-setting is active.
 * @param {Activity} activity
 * @param {object} [dataOrConfig={}]
 * @param {object} [options={}]
 * @returns {boolean}
 */
function _shouldAutoAttachSelfEmanation(activity, dataOrConfig = {}, options = {}) {
    if (!activity) return false;
    if (!isFeatureActive("enableAutoAttachSelfEmanations", "clientEnableAutoAttachSelfEmanations")) {
        return false;
    }

    // Check if the activity or parent item targets "self"
    const rangeUnits = activity.range?.units || activity.item?.system?.range?.units;
    const affectsType = activity.target?.affects?.type || activity.item?.system?.target?.affects?.type;
    const targetType = activity.target?.type || activity.item?.system?.target?.type;

    const isSelf = (rangeUnits === "self") || (affectsType === "self") || (targetType === "self");
    if (!isSelf) return false;

    // Check if the template shape is an emanation
    const templateType = activity.target?.template?.type || activity.item?.system?.target?.template?.type;
    const isEmanation = (templateType === "radius")
        || (templateType === "emanation")
        || Boolean(dataOrConfig?.shapes?.some(s => s?.type === "emanation"))
        || Boolean(options?.attachToToken);

    return Boolean(isEmanation);
}

/**
 * Resolves the triggering token document for an activity in the current scene.
 * Uses activity.getUsageToken(), followed by actor scene targets, active tokens, or controlled tokens.
 * @param {Activity} activity
 * @returns {TokenDocument|null}
 */
function _resolveTriggeringToken(activity) {
    if (!activity) return null;

    // 1. Activity's direct usage token
    const usageDoc = activity.getUsageToken?.();
    if (usageDoc?.id && canvas.scene?.tokens?.has(usageDoc.id)) {
        return canvas.scene.tokens.get(usageDoc.id);
    }
    if (usageDoc?.document?.id && canvas.scene?.tokens?.has(usageDoc.document.id)) {
        return canvas.scene.tokens.get(usageDoc.document.id);
    }

    // 2. Active tokens for the activity's actor in the current scene
    if (activity.actor) {
        const sceneTargets = dnd5e?.utils?.getSceneTargets?.(activity.actor);
        if (sceneTargets?.length) {
            const targetToken = sceneTargets[0];
            return targetToken.document || canvas.scene?.tokens?.get(targetToken.id) || null;
        }
        const activeTokens = activity.actor.getActiveTokens?.(true, true);
        if (activeTokens?.length) {
            const token = activeTokens[0];
            return token.document || canvas.scene?.tokens?.get(token.id) || null;
        }
    }

    // 3. Controlled token on canvas matching actor or first controlled
    if (canvas.tokens?.controlled?.length) {
        if (activity.actor) {
            const match = canvas.tokens.controlled.find(t => t.actor?.id === activity.actor.id);
            if (match) return match.document;
        }
        return canvas.tokens.controlled[0].document;
    }

    // 4. Any token on the scene belonging to the actor
    if (activity.actor && canvas.scene?.tokens) {
        const sceneToken = canvas.scene.tokens.find(t => t.actorId === activity.actor.id);
        if (sceneToken) return sceneToken;
    }

    return null;
}

/**
 * Automatically attaches an emanation template directly to the triggering token and skips manual canvas placement.
 * @param {Activity} activity
 * @param {object} data
 * @param {object} options
 * @returns {RegionDocument|null}
 */
function _autoAttachSelfEmanation(activity, data, options) {
    const tokenDoc = _resolveTriggeringToken(activity);
    if (!tokenDoc) {
        debug("Auto-attach self emanation skipped: Could not resolve triggering token on scene");
        return null;
    }

    try {
        const document = new CONFIG.Region.documentClass(foundry.utils.deepClone(data), { parent: canvas.scene });
        const source = tokenDoc._source || tokenDoc;
        const shape = document.shapes[0];

        // Match elevation calculation from Foundry's RegionLayer.#attachPlacementToToken
        const elevation = {
            bottom: Number.isFinite(data.elevation?.bottom) ? data.elevation.bottom + source.elevation : null,
            top: Number.isFinite(data.elevation?.top) ? data.elevation.top + (source.elevation + (source.depth * canvas.grid.distance)) : null
        };

        if (shape) {
            shape.updateSource({
                base: {
                    x: source.x,
                    y: source.y,
                    width: source.width,
                    height: source.height,
                    shape: source.shape
                }
            });
        }

        document.updateSource({
            elevation,
            levels: [source.level],
            hidden: Boolean(source.hidden),
            attachment: { token: tokenDoc.id }
        });

        // Fire preConfirm callback so TemplatePlacement collects the shape and token
        if (options.preConfirm) {
            options.preConfirm({ document });
        }

        const tokenName = tokenDoc.name || "caster";
        const itemName = activity?.item?.name || activity?.name || "Emanation";
        debug(`Auto-attached self emanation "${itemName}" directly to token "${tokenName}" (${tokenDoc.id})`);

        // If this is the last or only region, clean up cached activity
        const regionIndex = options._regionIndex ?? 0;
        const regionCount = options._regionCount ?? 1;
        if (regionCount <= 1 || regionIndex >= regionCount - 1) {
            activeTemplateActivity = null;
            activeTemplateConfig = null;
        }

        return document;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to auto-attach self emanation template:", err);
        return null;
    }
}

/* -------------------------------------------- */
/*  Live Emanation Hover Tracking               */
/* -------------------------------------------- */

/**
 * Global window pointermove handler active during emanation placement sessions.
 * Throttled to display refresh rate with requestAnimationFrame.
 */
function _onWindowPointerMoveForEmanation() {
    if (!activeHudSession?.isEmanation) return;
    if (_emanationHoverRaf) return;
    _emanationHoverRaf = requestAnimationFrame(() => {
        _emanationHoverRaf = null;
        _updateEmanationHoverState();
    });
}

/**
 * Dynamically updates the HUD banner to indicate whether a valid token is currently targeted
 * versus hovering over empty space.
 * @param {string|null} [explicitTokenId=null]
 */
function _updateEmanationHoverState(explicitTokenId = null) {
    if (!activeHudSession?.isEmanation || !activeHudSession?.hudElement) return;
    const hud = activeHudSession.hudElement;

    // Resolve hovered token
    let hoveredToken = canvas.tokens?.hover;
    let tokenId = hoveredToken?.id || hoveredToken?.document?.id || explicitTokenId || null;
    if (!hoveredToken && tokenId && canvas.tokens?.get) {
        hoveredToken = canvas.tokens.get(tokenId);
    }
    const tokenName = hoveredToken?.document?.name || hoveredToken?.name || null;

    if (tokenId === activeHudSession.lastHoveredTokenId) return;
    activeHudSession.lastHoveredTokenId = tokenId;

    const targetBadge = hud.querySelector("#nd5t-template-target-badge");
    const targetIcon = hud.querySelector("#nd5t-template-target-icon");
    const targetText = hud.querySelector("#nd5t-template-target-text");
    const placeBadge = hud.querySelector("#nd5t-template-place-badge");
    const placeLabel = hud.querySelector("#nd5t-template-place-label");

    if (hoveredToken && tokenName) {
        if (targetBadge) {
            targetBadge.className = "nd5t-template-status-badge targeted";
            targetBadge.title = `Ready to attach emanation to "${tokenName}". Left-click to confirm.`;
        }
        if (targetIcon) targetIcon.className = "fa-solid fa-circle-check";
        if (targetText) targetText.innerHTML = `Target: <strong>${escapeHTML(tokenName)}</strong>`;

        if (placeBadge) {
            placeBadge.className = "nd5t-template-control-badge nd5t-template-place-emanation targeted";
            placeBadge.title = `Click to attach emanation to "${tokenName}"`;
        }
        if (placeLabel) {
            placeLabel.textContent = `Attach to ${tokenName}`;
        }
    } else {
        if (targetBadge) {
            targetBadge.className = "nd5t-template-status-badge waiting";
            targetBadge.title = "Emanations originate from a creature. Left-click directly on a token to attach (clicking empty space will not attach).";
        }
        if (targetIcon) targetIcon.className = "fa-solid fa-circle-exclamation";
        if (targetText) targetText.innerHTML = `Click a <strong class="nd5t-highlight-token">Token</strong> (not empty space)`;

        if (placeBadge) {
            placeBadge.className = "nd5t-template-control-badge nd5t-template-place-emanation waiting";
            placeBadge.title = "Click directly on a token to attach emanation (must click a token, not empty space)";
        }
        if (placeLabel) {
            placeLabel.textContent = "Select Token";
        }
    }
}

/* -------------------------------------------- */
/*  HUD Lifecycle & DOM Management               */
/* -------------------------------------------- */

/**
 * Opens a new HUD banner or updates an existing one with current shape details.
 * @param {object} params
 */
function _openOrUpdateHud({ activity, data, shape, regionIndex, regionCount, layer, isEmanation = false }) {
    if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
    }

    const info = _extractTemplateInfo(activity, data, shape, regionIndex, regionCount, isEmanation);
    const initialRotation = shape?.rotation ?? shape?.direction ?? 0;
    const canRotate = !isEmanation && info.shapeType !== "circle" && info.shapeType !== "ring";

    if (activeHudSession && activeHudSession.hudElement?.isConnected) {
        // Update existing HUD
        activeHudSession.activity = activity;
        activeHudSession.data = data;
        activeHudSession.shape = shape;
        activeHudSession.regionIndex = regionIndex;
        activeHudSession.regionCount = regionCount;
        activeHudSession.layer = layer;
        activeHudSession.isEmanation = isEmanation;
        activeHudSession.canRotate = canRotate;
        _updateHudContent(info, initialRotation);
        if (isEmanation) {
            _updateEmanationHoverState();
        }
        return;
    }

    // Create new HUD
    const hudElement = _createTemplateHudElement(info, initialRotation, isEmanation, canRotate, () => {
        _cancelPlacement({ layer });
    });

    document.body.appendChild(hudElement);
    const detachPositioning = attachHudPositioning(hudElement);

    activeHudSession = {
        hudElement,
        detachPositioning,
        activity,
        data,
        shape,
        regionIndex,
        regionCount,
        layer,
        isEmanation,
        canRotate,
        rotation: initialRotation,
        lastHoveredTokenId: null
    };

    if (isEmanation) {
        window.addEventListener("pointermove", _onWindowPointerMoveForEmanation, { passive: true });
        _updateEmanationHoverState();
    }

    debug(`Opened Template Placement HUD for "${info.name}" (${info.subtitle})`);
}

/**
 * Cancel the active placement session when the cancel button or shortcut is used.
 * @param {object} context
 */
function _cancelPlacement({ layer } = {}) {
    debug("Cancelling template placement via HUD");
    try {
        if (canvas.regions?._placementContext) {
            canvas.regions._cancelPlacement();
        } else if (layer?._placementContext) {
            layer._cancelPlacement();
        }
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to cancel template placement:", err);
    }
    _closeHudSession(false);
}

/**
 * Extracts friendly display information (name, image, shape label, subtitle)
 * from the activity or placement shape data.
 * @param {Activity} activity
 * @param {object} data
 * @param {object} shape
 * @param {number} regionIndex
 * @param {number} regionCount
 * @param {boolean} [isEmanation=false]
 * @returns {object}
 */
function _extractTemplateInfo(activity, data, shape, regionIndex, regionCount, isEmanation = false) {
    let name = activity?.item?.name || activity?.name || data?.name;
    let img = activity?.item?.img || null;
    let shapeType = shape?.type || data?.shapes?.[0]?.type || (isEmanation ? "emanation" : "template");
    let size = activity?.target?.template?.size || shape?.radius || shape?.length || shape?.width || shape?.distance;
    let units = activity?.target?.template?.units || canvas.scene?.grid?.units || "ft";

    // Format readable shape label
    let shapeLabel = "";
    switch (shapeType) {
        case "circle":
            shapeLabel = size ? `${size} ${units} Radius` : "Circle";
            break;
        case "cone":
            shapeLabel = size ? `${size} ${units} Cone` : "Cone";
            break;
        case "emanation":
            shapeLabel = size ? `${size} ${units} Emanation` : "Emanation";
            break;
        case "ray":
        case "line":
            shapeLabel = size ? `${size} ${units} Line` : "Line";
            break;
        case "rect":
        case "rectangle":
            shapeLabel = size ? `${size} ${units} Cube` : "Cube / Square";
            break;
        case "ring":
            shapeLabel = size ? `${size} ${units} Ring` : "Ring";
            break;
        default:
            shapeLabel = "Template";
            break;
    }

    if (!name || name === "Unnamed Region" || name.startsWith("Region [") || name.startsWith("MeasuredTemplate [")) {
        name = `${shapeLabel} Placement`;
    }

    let subtitle = shapeLabel;
    if (regionCount && regionCount > 1) {
        subtitle += ` • Shape ${(regionIndex ?? 0) + 1} of ${regionCount}`;
    }
    if (isEmanation) {
        subtitle += " • Attach to Token";
    }

    let iconClass = "fa-solid fa-shapes";
    switch (shapeType) {
        case "cone":
            iconClass = "fa-solid fa-shapes";
            break;
        case "circle":
            iconClass = "fa-solid fa-bullseye";
            break;
        case "ray":
        case "line":
            iconClass = "fa-solid fa-arrows-left-right";
            break;
        case "rect":
        case "rectangle":
            iconClass = "fa-regular fa-square";
            break;
        case "emanation":
            iconClass = "fa-solid fa-circle-dot";
            break;
    }

    return { name, img, shapeType, shapeLabel, subtitle, iconClass, isEmanation };
}

/**
 * Creates the DOM element for the floating template placement HUD banner.
 * @param {object} info
 * @param {number} initialRotation
 * @param {boolean} isEmanation
 * @param {boolean} canRotate
 * @param {Function} onCancel
 * @returns {HTMLElement}
 */
function _createTemplateHudElement(info, initialRotation, isEmanation, canRotate, onCancel) {
    const hud = document.createElement("div");
    hud.id = "nd5t-template-hud";
    hud.className = "nd5t-template-hud";

    const isGridSnapActive = isFeatureActive("enableTemplateGridSnap", "clientEnableTemplateGridSnap");
    const normalizedAngle = Math.round(((initialRotation % 360) + 360) % 360);

    const iconHtml = info.img
        ? `<img class="nd5t-template-badge-img" src="${info.img}" alt="${escapeHTML(info.name)}" />`
        : `<i class="${info.iconClass}"></i>`;

    const emanationBadgeHtml = isEmanation
        ? `
            <div class="nd5t-template-status-badge waiting" id="nd5t-template-target-badge" title="Emanations originate from a creature. Left-click directly on a token to attach (clicking empty space will not attach).">
                <i class="fa-solid fa-circle-exclamation" id="nd5t-template-target-icon"></i>
                <span id="nd5t-template-target-text">Click a <strong class="nd5t-highlight-token">Token</strong> (not empty space)</span>
            </div>
            <div class="nd5t-template-divider" aria-hidden="true"></div>
        `
        : "";

    const placeBadgeHtml = isEmanation
        ? `
            <div class="nd5t-template-control-badge nd5t-template-place-emanation waiting" id="nd5t-template-place-badge" title="Click directly on a token to attach emanation (must click a token, not empty space)">
                <kbd class="nd5t-template-kbd"><i class="fa-solid fa-bullseye"></i> Click Token</kbd>
                <span class="nd5t-template-control-label" id="nd5t-template-place-label">Select Token</span>
            </div>
        `
        : `
            <div class="nd5t-template-control-badge" title="Left-click on canvas to confirm placement">
                <kbd class="nd5t-template-kbd"><i class="fa-solid fa-arrow-pointer"></i> Click</kbd>
                <span class="nd5t-template-control-label">Place</span>
            </div>
        `;

    hud.innerHTML = `
        <div class="nd5t-template-hud-content">
            <div class="nd5t-template-badge-icon" aria-hidden="true">
                ${iconHtml}
            </div>
            <div class="nd5t-template-info">
                <span class="nd5t-template-title">${escapeHTML(info.name)}</span>
                <span class="nd5t-template-subtitle">${escapeHTML(info.subtitle)}</span>
            </div>
            <div class="nd5t-template-divider" aria-hidden="true"></div>
            ${emanationBadgeHtml}
            <div class="nd5t-template-controls">
                ${canRotate ? `
                <div class="nd5t-template-control-badge" title="Scroll mouse wheel to rotate template">
                    <kbd class="nd5t-template-kbd"><i class="fa-solid fa-arrows-rotate"></i> Scroll</kbd>
                    <span class="nd5t-template-control-label">Rotate</span>
                    <span class="nd5t-template-rotation-val" id="nd5t-template-rotation-val">
                        ${normalizedAngle}°
                    </span>
                </div>
                ` : ""}
                <div class="nd5t-template-control-badge" title="Hold Shift and scroll mouse wheel to zoom canvas">
                    <span class="nd5t-template-kbd-combo">
                        <kbd class="nd5t-template-kbd">Shift</kbd>
                        <span class="nd5t-template-kbd-plus">+</span>
                        <kbd class="nd5t-template-kbd"><i class="fa-solid fa-magnifying-glass"></i> Scroll</kbd>
                    </span>
                    <span class="nd5t-template-control-label">Zoom</span>
                </div>
                ${placeBadgeHtml}
                ${(isGridSnapActive && !isEmanation) ? `
                <div class="nd5t-template-control-badge" title="Hold Shift while placing to bypass grid vertex snap and place freely">
                    <kbd class="nd5t-template-kbd">Shift</kbd>
                    <span class="nd5t-template-control-label">Free Snap</span>
                </div>
                ` : ""}
            </div>
            <div class="nd5t-template-divider" aria-hidden="true"></div>
            <div class="nd5t-template-actions">
                <kbd class="nd5t-template-kbd" title="Right-click canvas or press Escape to cancel">ESC / Right-Click</kbd>
                <button type="button" class="nd5t-template-cancel-btn" title="Cancel Template Placement">
                    <i class="fa-solid fa-xmark"></i>
                    <span>Cancel</span>
                </button>
            </div>
        </div>
    `;

    hud.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
    });

    const cancelBtn = hud.querySelector(".nd5t-template-cancel-btn");
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
 * Updates text and elements in an existing active HUD element.
 * @param {object} info
 * @param {number} rotation
 */
function _updateHudContent(info, rotation) {
    if (!activeHudSession?.hudElement) return;
    const hud = activeHudSession.hudElement;

    const titleEl = hud.querySelector(".nd5t-template-title");
    if (titleEl) titleEl.textContent = info.name;

    const subtitleEl = hud.querySelector(".nd5t-template-subtitle");
    if (subtitleEl) subtitleEl.textContent = info.subtitle;

    _updateRotationDisplay(rotation);
}

/**
 * Updates the displayed rotation degree badge in the HUD banner.
 * @param {number} degrees
 */
function _updateRotationDisplay(degrees) {
    if (!activeHudSession?.hudElement) return;
    const rotEl = activeHudSession.hudElement.querySelector("#nd5t-template-rotation-val");
    if (!rotEl) return;

    if (!activeHudSession.canRotate) {
        rotEl.style.display = "none";
        return;
    }

    if (degrees !== undefined && !Number.isNaN(degrees)) {
        const normalized = Math.round(((degrees % 360) + 360) % 360);
        rotEl.textContent = `${normalized}°`;
        rotEl.style.display = "";
        activeHudSession.rotation = normalized;
    }
}

/**
 * Schedules closing the HUD with a short debounce to allow sequential shape placements.
 */
function _scheduleHudClose() {
    if (pendingCloseTimeout) clearTimeout(pendingCloseTimeout);
    pendingCloseTimeout = setTimeout(() => {
        _closeHudSession(false);
        pendingCloseTimeout = null;
    }, 60);
}

/**
 * Closes and removes the HUD banner with animation.
 * @param {boolean} [immediate=false]
 */
function _closeHudSession(immediate = false) {
    if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
    }

    if (_emanationHoverRaf) {
        cancelAnimationFrame(_emanationHoverRaf);
        _emanationHoverRaf = null;
    }
    window.removeEventListener("pointermove", _onWindowPointerMoveForEmanation);

    if (!activeHudSession) return;

    const { hudElement: hud, detachPositioning } = activeHudSession;
    activeHudSession = null;
    detachPositioning?.();

    if (!hud || !hud.isConnected) return;

    if (immediate) {
        hud.remove();
        return;
    }

    hud.classList.add("nd5t-template-fade-out");
    setTimeout(() => {
        if (hud.isConnected) hud.remove();
    }, 200);
}
