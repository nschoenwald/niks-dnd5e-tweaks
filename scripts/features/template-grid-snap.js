import { MODULE_ID, debug, log } from "../main.js";

/**
 * Enforces placing circle and square/rectangle measured templates on grid intersections (vertices)
 * instead of grid cell centers. Cones and rays are not affected.
 *
 * This feature affects both the live preview (while dragging to place) and the final placement.
 *
 * Foundry V13: Uses MeasuredTemplate documents — wraps getSnappedPosition on AbilityTemplate
 *              instances via dnd5e.createActivityTemplate, and hooks preCreateMeasuredTemplate
 *              as a final safety net.
 * Foundry V14: Measured templates are replaced by Regions — hooks preCreateRegion.
 *              Preview snapping is handled the same way via dnd5e.createActivityTemplate.
 */

/**
 * Initialize the template grid snap feature by registering the appropriate hooks
 * based on the Foundry version.
 */
export function initTemplateGridSnap() {
    // dnd5e.createActivityTemplate fires for both V13 and V14 after AbilityTemplate
    // instances are created but before drawPreview() is called. We use this to wrap
    // the getSnappedPosition method so the preview also snaps to intersections.
    Hooks.on("dnd5e.createActivityTemplate", _onCreateActivityTemplate);

    if (game.release.generation >= 14) {
        // V14+: Templates are replaced by Regions
        Hooks.on("preCreateRegion", _onPreCreateRegion);
        log("Template Grid Snap initialized (V14 Region mode)");
    } else {
        // V13: Traditional MeasuredTemplate documents — final safety net
        Hooks.on("preCreateMeasuredTemplate", _onPreCreateMeasuredTemplate);
        log("Template Grid Snap initialized (V13 MeasuredTemplate mode)");
    }
}

/* -------------------------------------------- */
/*  Preview Snapping (V13 + V14)                 */
/* -------------------------------------------- */

/**
 * Wrap the getSnappedPosition method on circle/rect AbilityTemplate instances
 * so the preview also snaps to grid intersections while dragging.
 *
 * The dnd5e.createActivityTemplate hook fires after AbilityTemplate.fromActivity()
 * constructs the template objects but before drawPreview() is called, making it the
 * ideal place to override per-instance snapping behavior.
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

        debug(`Wrapping getSnappedPosition for ${type} template preview`);

        // Override getSnappedPosition to snap to grid vertices (intersections)
        // instead of the default center-of-cell snapping.
        // The original method is called by _onMovePlacement on every mouse move.
        template.getSnappedPosition = function(position) {
            return canvas.grid.getSnappedPoint(position, {
                mode: CONST.GRID_SNAPPING_MODES.VERTEX
            });
        };
    }
}

/* -------------------------------------------- */
/*  Foundry V13: MeasuredTemplate Hook           */
/* -------------------------------------------- */

/**
 * Snap circle and rect template origins to grid intersections on creation.
 * This serves as a final safety net — the preview wrapping via
 * dnd5e.createActivityTemplate handles most cases, but this ensures
 * correctness even if templates are created via other code paths.
 *
 * @param {MeasuredTemplateDocument} document  The template document being created.
 * @param {object} data                        The initial data object provided to the document creation request.
 * @param {object} options                     Additional options which modify the creation request.
 * @param {string} userId                      The ID of the requesting user.
 */
function _onPreCreateMeasuredTemplate(document, data, options, userId) {
    if (!game.settings.get(MODULE_ID, "enableTemplateGridSnap")) return;

    const type = document.t;

    // Only snap circle and rect (square/cube) templates
    if (type !== "circle" && type !== "rect") return;

    debug(`Snapping ${type} template to grid intersection (final)`);

    const snapped = canvas.grid.getSnappedPoint(
        { x: document.x, y: document.y },
        { mode: CONST.GRID_SNAPPING_MODES.VERTEX }
    );

    document.updateSource({ x: snapped.x, y: snapped.y });
}

/* -------------------------------------------- */
/*  Foundry V14: Region Hook                     */
/* -------------------------------------------- */

/**
 * Snap dnd5e activity-created circle and rectangle region shapes to grid intersections.
 * In V14, dnd5e spell templates are created as Region documents instead of MeasuredTemplates.
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
