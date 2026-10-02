/**
 * Feature: Snap Templates to Grid Intersections
 * Description: Forces circle and square spell templates to snap to grid intersections rather than cell centers during preview and placement.
 *
 * @introduced v14.5.0
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";

/**
 * Enforces placing circle and square/rectangle measured templates on grid intersections (vertices)
 * instead of grid cell centers. Cones, rays, and emanations (radius templates placed on tokens)
 * are not affected.
 *
 * Hold Shift while placing to temporarily override the snap and place freely.
 *
 * This feature affects both the live preview (while dragging to place) and the final placement.
 *
 * In Foundry V14 / DnD5e v6:
 * - Spell and item templates are placed via TemplatePlacement and canvas.regions.placeRegions().
 * - Live preview snapping wraps _getSnappedPoint on CircleShapeData and RectangleShapeData.
 * - Final placement is handled via the dnd5e.createMeasuredTemplate and preCreateRegion hooks.
 */

/**
 * Check whether the Shift key is currently held, which overrides snap behaviour
 * and allows free placement.
 * @returns {boolean}
 */
function _isShiftHeld() {
    return !!game.keyboard?.isModifierActive(KeyboardManager.MODIFIER_KEYS.SHIFT);
}

/**
 * Determine whether a region shape is part of an active spell or item template placement.
 * @param {BaseShapeData} shape
 * @returns {boolean}
 */
function _isTemplateShape(shape) {
    if (shape.parent?.flags?.core?.MeasuredTemplate) return true;
    if (shape.parent?.flags?.dnd5e?.activity || shape.parent?.flags?.dnd5e?.item) return true;
    const ctx = canvas.regions?._placementContext;
    if (ctx) {
        if (ctx.preview?.document?.flags?.core?.MeasuredTemplate) return true;
        if (ctx.data?.flags?.core?.MeasuredTemplate) return true;
        if (ctx.data?.["flags.core.MeasuredTemplate"]) return true;
        if (ctx.preview?.document?.flags?.dnd5e) return true;
        if (canvas.regions?.templateMode) return true;
    }
    return false;
}

/**
 * Wrap _getSnappedPoint on a ShapeData class prototype so that template shapes snap
 * strictly to grid vertices (intersections) instead of centers or midpoints.
 * @param {Function} ShapeClass
 */
function _wrapShapeSnappedPoint(ShapeClass) {
    if (!ShapeClass?.prototype?._getSnappedPoint) return;
    if (ShapeClass.prototype._getSnappedPoint._niksWrapped) return;

    const original = ShapeClass.prototype._getSnappedPoint;

    const wrapped = function(point) {
        if (!isFeatureActive("enableTemplateGridSnap", "clientEnableTemplateGridSnap")) {
            return original.call(this, point);
        }

        // Shift bypasses snap
        if (_isShiftHeld()) {
            return original.call(this, point);
        }

        // Only snap when placing spell / item templates
        if (!_isTemplateShape(this)) {
            return original.call(this, point);
        }

        // Emanation or token-attached shapes should not snap to vertices
        if (this.parent?.attachment?.token || this.parent?.flags?.dnd5e?.dimensions?.adjustedSize) {
            return original.call(this, point);
        }

        const grid = this.grid ?? canvas.grid;
        if (grid?.isGridless) {
            return { x: Math.round(point.x), y: Math.round(point.y) };
        }

        return grid.getSnappedPoint(point, {
            mode: CONST.GRID_SNAPPING_MODES.VERTEX,
            resolution: 1
        });
    };

    wrapped._niksWrapped = true;
    ShapeClass.prototype._getSnappedPoint = wrapped;
}

/**
 * Initialize the template grid snap feature by registering the appropriate hooks
 * and wrapping shape preview snapping methods.
 */
export function initTemplateGridSnap() {
    // 1. V14 / DnD5e v6: Live preview snapping on Region shape models
    const circleClass = foundry.data.CircleShapeData ?? foundry.data.BaseShapeData?.TYPES?.circle;
    const rectClass = foundry.data.RectangleShapeData ?? foundry.data.BaseShapeData?.TYPES?.rectangle;

    if (circleClass) _wrapShapeSnappedPoint(circleClass);
    if (rectClass) _wrapShapeSnappedPoint(rectClass);

    // 2. DnD5e v6: TemplatePlacement.fromActivity hook right before Region documents are created
    Hooks.on("dnd5e.createMeasuredTemplate", _onCreateMeasuredTemplate);

    // 3. V14: General Region pre-creation safety net
    Hooks.on("preCreateRegion", _onPreCreateRegion);

    log("Template Grid Snap initialized (Foundry V14 / DnD5e v6)");
}

/* -------------------------------------------- */
/*  DnD5e v6 Template Hook (Final Placement)     */
/* -------------------------------------------- */

/**
 * Hook dnd5e.createMeasuredTemplate (fired by TemplatePlacement.fromActivity in DnD5e v6).
 * Snaps circle and rectangle shapes in regionData to grid intersections before documents are created.
 *
 * @param {Activity} activity      The Activity for which the template is being placed.
 * @param {object[]} templateData  Data objects for the regions about to be created.
 */
function _onCreateMeasuredTemplate(activity, templateData) {
    if (!isFeatureActive("enableTemplateGridSnap", "clientEnableTemplateGridSnap")) return;
    if (_isShiftHeld()) {
        debug("Shift held — skipping template snap in dnd5e.createMeasuredTemplate");
        return;
    }

    if (!Array.isArray(templateData)) return;

    for (const region of templateData) {
        if (!region || !Array.isArray(region.shapes)) continue;

        // Skip token emanations
        if (region.attachment?.token || region.flags?.dnd5e?.dimensions?.adjustedSize) continue;

        for (const shape of region.shapes) {
            if (shape.token) continue;
            const shapeType = shape.type;
            if (shapeType !== "circle" && shapeType !== "ellipse" && shapeType !== "rectangle" && shapeType !== "rect") continue;

            const snapped = canvas.grid.getSnappedPoint(
                { x: shape.x, y: shape.y },
                { mode: CONST.GRID_SNAPPING_MODES.VERTEX, resolution: 1 }
            );

            shape.x = snapped.x;
            shape.y = snapped.y;
            debug(`dnd5e.createMeasuredTemplate: Snapped ${shapeType} shape to vertex (${snapped.x}, ${snapped.y})`);
        }
    }
}

/* -------------------------------------------- */
/*  Region Document Hook (Final Placement)       */
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
    if (userId && userId !== game.user.id) return;
    if (!isFeatureActive("enableTemplateGridSnap", "clientEnableTemplateGridSnap")) return;

    // Only process regions created as spell/item templates
    const isTemplate = document.flags?.core?.MeasuredTemplate
        || document.flags?.dnd5e?.activity
        || document.flags?.dnd5e?.item
        || document.flags?.dnd5e?.origin;
    if (!isTemplate) return;

    // Skip emanation (radius) templates and token-attached templates
    if (document.flags?.dnd5e?.dimensions?.adjustedSize) return;
    if (document.attachment?.token) return;

    // Shift held at moment of confirmation → skip snapping
    if (_isShiftHeld()) {
        debug("Shift held — skipping region shape snap on creation");
        return;
    }

    const shapes = document.toObject().shapes;
    if (!shapes?.length) return;

    let modified = false;
    for (const shape of shapes) {
        const shapeType = shape.type;
        if (shapeType !== "circle" && shapeType !== "ellipse" && shapeType !== "rectangle" && shapeType !== "rect") continue;
        if (shape.token) continue;

        const snapped = canvas.grid.getSnappedPoint(
            { x: shape.x, y: shape.y },
            { mode: CONST.GRID_SNAPPING_MODES.VERTEX, resolution: 1 }
        );

        if (shape.x !== snapped.x || shape.y !== snapped.y) {
            shape.x = snapped.x;
            shape.y = snapped.y;
            modified = true;
            debug(`preCreateRegion: Snapped ${shapeType} shape to vertex (${snapped.x}, ${snapped.y})`);
        }
    }

    if (modified) {
        document.updateSource({ shapes });
    }
}

