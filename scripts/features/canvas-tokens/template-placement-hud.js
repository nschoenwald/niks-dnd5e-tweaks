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
        if (!isFeatureActive("enableTemplateControlsHUD", "clientEnableTemplateControlsHUD")) {
            return originalPlaceRegion.call(this, data, options);
        }

        const isTemplate = _isTemplatePlacement(data, options, this);
        if (!isTemplate) {
            return originalPlaceRegion.call(this, data, options);
        }

        // Intercept onChange to track live rotation and shape updates
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

        const currentActivity = (Date.now() - activeTemplateTimestamp < 15000) ? activeTemplateActivity : null;
        const regionIndex = options._regionIndex ?? 0;
        const regionCount = options._regionCount ?? 1;
        const shape = data.shapes?.[0];

        _openOrUpdateHud({
            activity: currentActivity,
            data,
            shape,
            regionIndex,
            regionCount,
            layer: this
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
 * - Plain scroll -> Rotates the template (instead of zooming)
 * - Shift + scroll -> Zooms the canvas (instead of rotating)
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

    if (isShift || isCtrl) {
        // Shift + Scroll (or Ctrl / Trackpad pinch): Zoom the canvas
        canvas._onMouseWheel(event);
    } else {
        // Plain Scroll: Rotate the template
        canvas.regions._onMouseWheel(event);
    }
}

/* -------------------------------------------- */
/*  HUD Lifecycle & DOM Management               */
/* -------------------------------------------- */

/**
 * Opens a new HUD banner or updates an existing one with current shape details.
 * @param {object} params
 */
function _openOrUpdateHud({ activity, data, shape, regionIndex, regionCount, layer }) {
    if (pendingCloseTimeout) {
        clearTimeout(pendingCloseTimeout);
        pendingCloseTimeout = null;
    }

    const info = _extractTemplateInfo(activity, data, shape, regionIndex, regionCount);
    const initialRotation = shape?.rotation ?? shape?.direction ?? 0;

    if (activeHudSession && activeHudSession.hudElement?.isConnected) {
        // Update existing HUD
        _updateHudContent(info, initialRotation);
        activeHudSession.activity = activity;
        activeHudSession.data = data;
        activeHudSession.shape = shape;
        activeHudSession.regionIndex = regionIndex;
        activeHudSession.regionCount = regionCount;
        activeHudSession.layer = layer;
        return;
    }

    // Create new HUD
    const hudElement = _createTemplateHudElement(info, initialRotation, () => {
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
        canRotate: info.shapeType !== "circle" && info.shapeType !== "ring" && info.shapeType !== "emanation",
        rotation: initialRotation
    };

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
 * @returns {object}
 */
function _extractTemplateInfo(activity, data, shape, regionIndex, regionCount) {
    let name = activity?.item?.name || activity?.name || data?.name;
    let img = activity?.item?.img || null;
    let shapeType = shape?.type || data?.shapes?.[0]?.type || "template";
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

    return { name, img, shapeType, shapeLabel, subtitle, iconClass };
}

/**
 * Creates the DOM element for the floating template placement HUD banner.
 * @param {object} info
 * @param {number} initialRotation
 * @param {Function} onCancel
 * @returns {HTMLElement}
 */
function _createTemplateHudElement(info, initialRotation, onCancel) {
    const hud = document.createElement("div");
    hud.id = "nd5t-template-hud";
    hud.className = "nd5t-template-hud";

    const isGridSnapActive = isFeatureActive("enableTemplateGridSnap", "clientEnableTemplateGridSnap");
    const normalizedAngle = Math.round(((initialRotation % 360) + 360) % 360);
    const canRotate = info.shapeType !== "circle" && info.shapeType !== "ring" && info.shapeType !== "emanation";

    const iconHtml = info.img
        ? `<img class="nd5t-template-badge-img" src="${info.img}" alt="${escapeHTML(info.name)}" />`
        : `<i class="${info.iconClass}"></i>`;

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
            <div class="nd5t-template-controls">
                <div class="nd5t-template-control-badge" title="Scroll mouse wheel to rotate template">
                    <kbd class="nd5t-template-kbd"><i class="fa-solid fa-arrows-rotate"></i> Scroll</kbd>
                    <span class="nd5t-template-control-label">Rotate</span>
                    <span class="nd5t-template-rotation-val" id="nd5t-template-rotation-val" style="${canRotate ? '' : 'display: none;'}">
                        ${normalizedAngle}°
                    </span>
                </div>
                <div class="nd5t-template-control-badge" title="Hold Shift and scroll mouse wheel to zoom canvas">
                    <span class="nd5t-template-kbd-combo">
                        <kbd class="nd5t-template-kbd">Shift</kbd>
                        <span class="nd5t-template-kbd-plus">+</span>
                        <kbd class="nd5t-template-kbd"><i class="fa-solid fa-magnifying-glass"></i> Scroll</kbd>
                    </span>
                    <span class="nd5t-template-control-label">Zoom</span>
                </div>
                <div class="nd5t-template-control-badge" title="Left-click on canvas to confirm placement">
                    <kbd class="nd5t-template-kbd"><i class="fa-solid fa-arrow-pointer"></i> Click</kbd>
                    <span class="nd5t-template-control-label">Place</span>
                </div>
                ${isGridSnapActive ? `
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
