/**
 * Feature: Grid-Based Templates
 * Description: Places spell, item and template-mode Region shapes as "grid-based" shapes, so their size is
 * measured with the scene's grid rules (e.g. a 20 ft circle on a 5/5/5 square grid becomes a square), chosen
 * per template type.
 *
 * @introduced v14.68.0
 */
import { log, debug, getSetting } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * How it works (Foundry V14 / dnd5e 6.x):
 * Region shapes have a core `gridBased` field (circle, ellipse, cone, rectangle, ring, line, emanation). When it is
 * set, Foundry builds the shape's polygon with the grid's metric instead of plain Euclidean geometry: on a square
 * grid with 5/5/5 diagonals a circle becomes a square, with 5/10/5 an octagon; on hex grids round shapes follow the
 * hexes. Core only exposes one global switch (`CONFIG.Region.templateModeConfig.gridBased`, template mode only)
 * and dnd5e never sets the field, so this feature sets it per shape type:
 *
 * - dnd5e templates: `TemplatePlacement` hands the region data to `RegionLayer#placeRegion` (through
 *   `placeRegions`). The data is changed before the preview document is made, so the preview, the shape dnd5e
 *   collects in `preConfirm` and the created Region all carry the flag.
 * - Foundry's template tools (Regions layer, template mode): `_createDragShapeData` clones the tool's shapeData;
 *   the flag is set on that clone, so dragging out the size uses the grid metric too.
 * - `preCreateRegion` sets it on any other dnd5e template region (e.g. one created without placement) as a
 *   safety net.
 *
 * The flag is stored on the shape, so templates keep the shape they were created with when the setting changes
 * later, and every client draws them the same way. That is why this is a world setting without a personal
 * opt-out. Works with midi-qol: midi targets through the Region's polygon tree, which follows the flag.
 */

/** Region shape type → setting key of the template type that controls it. */
const SHAPE_SETTINGS = {
    circle: "gridBasedTemplatesCircle",
    ellipse: "gridBasedTemplatesCircle",
    cone: "gridBasedTemplatesCone",
    rectangle: "gridBasedTemplatesRectangle",
    line: "gridBasedTemplatesLine",
    ring: "gridBasedTemplatesRing",
    emanation: "gridBasedTemplatesEmanation"
};

/**
 * Whether the feature is active in this world.
 * @returns {boolean}
 */
function _isActive() {
    try {
        return !!getSetting("enableGridBasedTemplates");
    } catch {
        return false;
    }
}

/**
 * Whether shapes of this type should be grid-based.
 * @param {string} type  Region shape type.
 * @returns {boolean|null}  null for shape types without a `gridBased` field.
 */
function _wantsGridBased(type) {
    const key = SHAPE_SETTINGS[type];
    if (!key) return null;
    try {
        return !!getSetting(key);
    } catch {
        return null;
    }
}

/**
 * Set `gridBased` on each supported shape according to the settings, in place.
 * @param {object[]} shapes  Plain shape data.
 * @returns {boolean}        Whether any shape changed.
 */
function _applyToShapes(shapes) {
    let changed = false;
    for (const shape of shapes ?? []) {
        if (!shape) continue;
        const gridBased = _wantsGridBased(shape.type);
        if ((gridBased === null) || (shape.gridBased === gridBased)) continue;
        shape.gridBased = gridBased;
        changed = true;
    }
    return changed;
}

/**
 * Whether region data (plain or document) belongs to a template.
 * @param {object} data
 * @returns {boolean}
 */
function _isTemplateData(data) {
    if (!data) return false;
    if (data["flags.core.MeasuredTemplate"] || data.flags?.core?.MeasuredTemplate) return true;
    return !!(data.flags?.dnd5e?.activity || data.flags?.dnd5e?.item);
}

/* -------------------------------------------- */
/*  Wrappers and hooks                           */
/* -------------------------------------------- */

/**
 * dnd5e templates: set the flag before the preview document is created.
 * The caller's data is cloned, not changed.
 */
function _placeRegion(wrapped, data, options = {}) {
    if (!_isActive() || !_isTemplateData(data) || !Array.isArray(data?.shapes)) return wrapped(data, options);
    const clone = foundry.utils.deepClone(data);
    if (_applyToShapes(clone.shapes)) debug("Grid-Based Templates: set gridBased on placed template shapes");
    return wrapped(clone, options);
}

/** Foundry's template tools: set the flag on the shape being drawn. */
function _createDragShapeData(wrapped, ...args) {
    const shapeData = wrapped(...args);
    if (!this.templateMode || !_isActive() || !shapeData) return shapeData;
    _applyToShapes([shapeData]);
    return shapeData;
}

/**
 * Safety net for template regions created without going through placement.
 * @param {RegionDocument} document
 * @param {object} data
 * @param {object} options
 * @param {string} userId
 */
function _onPreCreateRegion(document, data, options, userId) {
    if (userId && (userId !== game.user.id)) return;
    if (!_isActive() || !_isTemplateData(document)) return;
    const shapes = document.toObject().shapes;
    if (_applyToShapes(shapes)) document.updateSource({ shapes });
}

/* -------------------------------------------- */
/*  Init                                         */
/* -------------------------------------------- */

/**
 * Register the wrappers. Each checks the settings, so changes apply to the next template without a reload.
 */
export function initGridBasedTemplates() {
    const proto = "foundry.canvas.layers.RegionLayer.prototype";
    patchMethod(`${proto}.placeRegion`, _placeRegion, "WRAPPER");
    patchMethod(`${proto}._createDragShapeData`, _createDragShapeData, "WRAPPER");
    Hooks.on("preCreateRegion", _onPreCreateRegion);
    log("Grid-Based Templates initialized");
}
