import { MODULE_ID, debug, log } from "../main.js";

/**
 * Enforces placing circle and square/rectangle measured templates on grid intersections (vertices)
 * instead of grid cell centers. Cones, rays, and emanations (radius templates placed on tokens)
 * are not affected.
 *
 * Hold Shift while placing to temporarily override the snap and place freely.
 *
 * This feature affects both the live preview (while dragging to place) and the final placement.
 *
 * Preview snapping wraps getSnappedPosition on AbilityTemplate instances via
 * dnd5e.createActivityTemplate. Final placement hooks preCreateRegion (V14 Regions).
 */

/**
 * Check whether the Shift key is currently held, which overrides snap behaviour
 * and allows free placement.
 * @returns {boolean}
 */
function _isShiftHeld() {
    return game.keyboard.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT);
}

/**
 * Initialize the template grid snap feature by registering the appropriate hooks.
 */
export function initTemplateGridSnap() {
    // dnd5e.createActivityTemplate fires after AbilityTemplate instances are created
    // but before drawPreview() is called. We use this to wrap the getSnappedPosition
    // method so the preview also snaps to intersections.
    Hooks.on("dnd5e.createActivityTemplate", _onCreateActivityTemplate);

    // Templates are Regions in V14 — hook preCreateRegion for final placement snap
    Hooks.on("preCreateRegion", _onPreCreateRegion);
    log("Template Grid Snap initialized (Region mode)");
}

/* -------------------------------------------- */
/*  Preview Snapping                              */
/* -------------------------------------------- */

/**
 * Wrap the getSnappedPosition method on circle/rect AbilityTemplate instances
 * so the preview also snaps to grid intersections while dragging.
 *
 * The dnd5e.createActivityTemplate hook fires after AbilityTemplate.fromActivity()
 * constructs the template objects but before drawPreview() is called, making it the
 * ideal place to override per-instance snapping behavior.
 *
 * Holding Shift while dragging bypasses the snap and allows free placement.
 *
 * @param {Activity} activity              The Activity for which templates are being placed.
 * @param {AbilityTemplate[]} templates    The template instances being placed.
 */
function _onCreateActivityTemplate(activity, templates) {
    if (!game.settings.get(MODULE_ID, "enableTemplateGridSnap")) return;

    for (const template of templates) {
        const type = template.document.t;

        // Only override snapping for circle and rect (square/cube) templates
        if (type !== "circle" && type !== "rect") continue;

        // Skip emanation (radius) templates — these need free placement on tokens
        if (template.document.flags?.dnd5e?.dimensions?.adjustedSize) continue;

        debug(`Wrapping getSnappedPosition for ${type} template preview`);

        // Store the original method so Shift can fall back to default behaviour
        const originalGetSnappedPosition = template.getSnappedPosition.bind(template);

        // Override getSnappedPosition to snap to grid vertices (intersections)
        // instead of the default center-of-cell snapping.
        // The original method is called by _onMovePlacement on every mouse move.
        template.getSnappedPosition = function(position) {
            // Shift held → bypass intersection snap, use default snapping
            if (_isShiftHeld()) {
                debug("Shift held — using default snap behaviour");
                return originalGetSnappedPosition(position);
            }

            return canvas.grid.getSnappedPoint(position, {
                mode: CONST.GRID_SNAPPING_MODES.VERTEX
            });
        };
    }
}

/* -------------------------------------------- */
/*  Region Hook (Final Placement)                */
/* -------------------------------------------- */

/**
 * Snap dnd5e activity-created circle and rectangle region shapes to grid intersections.
 * In V14, dnd5e spell templates are created as Region documents instead of MeasuredTemplates.
 *
 * Holding Shift at the moment of placement bypasses the snap.
 *
 * @param {RegionDocument} document  The region document being created.
 * @param {object} data              The initial data object provided to the document creation request.
 * @param {object} options           Additional options which modify the creation request.
 * @param {string} userId            The ID of the requesting user.
 */
function _onPreCreateRegion(document, data, options, userId) {
    if (!game.settings.get(MODULE_ID, "enableTemplateGridSnap")) return;

    // Only process regions created by dnd5e activities (spell templates)
    const dnd5eFlags = document.flags?.dnd5e;
    if (!dnd5eFlags?.origin) return;

    // Skip emanation (radius) templates — these need free placement on tokens
    if (dnd5eFlags?.dimensions?.adjustedSize) return;

    // Shift held at moment of confirmation → skip snapping
    if (_isShiftHeld()) {
        debug("Shift held — skipping region shape snap on creation");
        return;
    }

    const shapes = document.shapes;
    if (!shapes?.length) return;

    let modified = false;

    for (const shape of shapes) {
        const shapeType = shape.type;

        // Only snap circle (ellipse) and rectangle shapes, not cones or rays
        if (shapeType !== "circle" && shapeType !== "ellipse" && shapeType !== "rectangle") continue;

        debug(`Snapping ${shapeType} region shape to grid intersection (final)`);

        // Snap the shape's position to the nearest grid intersection
        const snapped = canvas.grid.getSnappedPoint(
            { x: shape.x, y: shape.y },
            { mode: CONST.GRID_SNAPPING_MODES.VERTEX }
        );

        shape.x = snapped.x;
        shape.y = snapped.y;
        modified = true;
    }

    if (modified) {
        document.updateSource({ shapes: shapes.map(s => s.toObject?.() ?? s) });
    }
}
