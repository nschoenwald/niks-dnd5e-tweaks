/**
 * Feature: Rules-Accurate Cones on Square Grids
 * Description: Cone templates on square grids cover whole squares in the D&D grid pattern: they start at a grid
 * intersection, have k squares at a distance of k squares (1, 2, 3, 4 … at 5, 10, 15, 20 … ft) and fill one of
 * the 8 wedges between neighbouring grid directions.
 *
 * @introduced v14.67.0
 * @updated v14.67.5 (Enabled by default)
 * @updated v14.71.2 (isRuleConeShape export for the placement HUD's scroll stepping)
 */
import { log, getSetting } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";

/**
 * How it works (Foundry V14 / dnd5e 6.x):
 * dnd5e places templates as Regions with a "cone" shape (`foundry.data.ConeShapeData`). Region highlighting
 * ("coverage" mode), `TokenDocument#testInsideRegion` and Region behaviours all read the shape's polygon tree.
 * This feature replaces that polygon with the outline of whole grid squares, so all of them agree on the same
 * squares. The stored shape stays an ordinary cone (origin, radius, rotation); only its geometry changes.
 *
 * The geometry itself enforces the rule, whatever is stored: the origin is taken to the nearest grid intersection,
 * the length is rounded to whole squares and the rotation to the nearest wedge. On top of that, placement and
 * editing snap to those values so the handles match what is drawn.
 *
 * Pattern for a cone N squares long, with each square labelled by its grid distance from the origin (5/5/5):
 *     1 2 3
 *     . 2 3
 *     . . 3
 * At distance k there are exactly k squares, N(N+1)/2 in all. This is the wedge between east and south-east; the
 * other 7 are its rotations and mirror images, one per 45° between two neighbouring grid directions. Other shapes
 * break the rule: a right triangle with its corner at the origin (pointing diagonally) has 3 squares at distance 2
 * and only 2 at distance 3, and a cone centred on an axis can't hold an odd number of squares symmetrically.
 *
 * Each wedge is stored as the rotation through its middle: 22.5° = east to south-east, 67.5° = south-east to
 * south, 112.5° = south to south-west, and so on in 45° steps.
 *
 * Every client must draw the same squares, so this is a world setting without a personal opt-out.
 * midi-qol works out cone targets from its own copy of the cone, so the feature stands down while it is active.
 */

/** Each wedge spans 45°; its stored rotation is the middle (22.5°, 67.5°, …). */
const WEDGE_ANGLE = 45;

/**
 * Whether the feature is active in this world.
 * @returns {boolean}
 */
function _isActive() {
    try {
        return !!getSetting("enableGridConeRules") && !isMidiActive();
    } catch {
        return false;
    }
}

/**
 * Whether a cone shape follows the grid cone rules: a template cone on a square grid.
 * Templates are Regions created by dnd5e (template flags) or drawn in the core template mode
 * (which always uses the "coverage" highlight). Ordinary Regions drawn by the GM keep the core cone.
 * @param {foundry.data.ConeShapeData} shape
 * @returns {boolean}
 */
function _isRuleCone(shape) {
    if (!_isActive()) return false;
    const grid = shape.grid;
    if (!grid?.isSquare) return false;
    const region = shape.parent;
    if (!region) return false;
    const flags = region.flags ?? {};
    return !!(flags.core?.MeasuredTemplate || flags.dnd5e?.activity || flags.dnd5e?.item
        || (region.highlightMode === "coverage"));
}

/**
 * Whether a shape is a cone that steps through grid wedges (used by the placement HUD's scroll rotation,
 * where one rotation step is a whole wedge rather than 5°).
 * @param {foundry.data.BaseShapeData} shape
 * @returns {boolean}
 */
export function isRuleConeShape(shape) {
    return (shape?.type === "cone") && _isRuleCone(shape);
}

/**
 * Number of squares along the cone, at least 1.
 * @param {foundry.data.ConeShapeData} shape
 * @returns {number}
 */
function _getLength(shape) {
    const grid = shape.grid;
    return Math.max(1, Math.round(shape.radius / grid.size));
}

/**
 * The wedge (0–7, clockwise from east to south-east) a rotation falls into.
 * @param {number} rotation  Degrees.
 * @returns {number}
 */
function _getWedge(rotation) {
    return Math.floor(Math.normalizeDegrees(rotation) / WEDGE_ANGLE) % 8;
}

/**
 * The stored rotation of a wedge (its middle), kept within half a turn of the given rotation so stored values
 * don't jump by 360°.
 * @param {number} wedge
 * @param {number} near  Degrees.
 * @returns {number}
 */
function _getWedgeRotation(wedge, near) {
    const target = (wedge * WEDGE_ANGLE) + (WEDGE_ANGLE / 2);
    const diff = ((((target - near) % 360) + 540) % 360) - 180;
    return near + diff;
}

/**
 * Outline of the east to south-east wedge in square units, origin at (0, 0): column c holds rows 0 … c.
 * Points run clockwise on screen (y down), which Foundry treats as positive orientation.
 * @param {number} n  Length in squares.
 * @returns {number[][]}  [x, y] points.
 */
function _getCanonicalOutline(n) {
    const points = [[0, 0], [n, 0]];
    for (let c = n - 1; c >= 0; c--) points.push([c + 1, c + 1], [c, c + 1]);

    // Drop repeated points, including a closing point equal to the first
    const outline = [];
    for (const p of points) {
        const last = outline.at(-1);
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        outline.push(p);
    }
    const first = outline[0];
    const last = outline.at(-1);
    if (outline.length > 1 && first[0] === last[0] && first[1] === last[1]) outline.pop();
    return outline;
}

/**
 * Polygon points of a rule cone in canvas coordinates.
 * @param {foundry.data.ConeShapeData} shape
 * @returns {{x: number, y: number}[]}
 */
function _getConePoints(shape) {
    const grid = shape.grid;
    const size = grid.size;
    const origin = grid.getSnappedPoint({ x: shape.x, y: shape.y }, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
    const wedge = _getWedge(shape.rotation);
    const quarterTurns = Math.floor(wedge / 2);
    let outline = _getCanonicalOutline(_getLength(shape));
    if (wedge % 2 === 1) {
        // Mirror across the diagonal: east to south-east → south-east to south.
        // Mirroring flips the winding, so reverse to keep it clockwise.
        outline = outline.map(([x, y]) => [y, x]).reverse();
    }
    return outline.map(([x, y]) => {
        // Rotate 90° clockwise on screen per quarter turn: (x, y) → (-y, x)
        for (let q = 0; q < quarterTurns; q++) [x, y] = [-y, x];
        return { x: origin.x + (x * size), y: origin.y + (y * size) };
    });
}

/* -------------------------------------------- */
/*  Wrappers                                     */
/* -------------------------------------------- */

/** Geometry: whole squares in the rule pattern. */
function _createClipperPolyTree(wrapped, ...args) {
    if (!_isRuleCone(this) || (this.radius <= 0) || (this.angle <= 0)) return wrapped(...args);
    return _getConePoints(this);
}

/** Core computes the area of a round cone from the circle sector; use the squares instead. */
function _calculateArea(wrapped, ...args) {
    if (!_isRuleCone(this)) return wrapped(...args);
    return this.polygonTree.area;
}

/** The angle is fixed by the pattern, so hide the sweep handle. */
function _createControlHandles(wrapped, ...args) {
    const handles = wrapped(...args);
    if (handles?.sweep && _isRuleCone(this)) handles.sweep = { ...handles.sweep, visible: false };
    return handles;
}

/** Snap the origin to grid intersections. */
function _getSnappedPoint(wrapped, point) {
    if (!_isRuleCone(this)) return wrapped(point);
    return this.grid.getSnappedPoint(point, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
}

/**
 * Always snap the origin, also with Shift held: the pattern starts at an intersection either way.
 * Also moves the stored rotation to the middle of its wedge (dnd5e starts cones at 0°), so the rotation handle
 * and measurement line run through the squares.
 */
function _move(wrapped, origin, options = {}) {
    if (!_isRuleCone(this)) return wrapped(origin, options);
    const result = wrapped(origin, { ...options, snap: true });
    const rotation = _getWedgeRotation(_getWedge(this.rotation), this.rotation);
    if (rotation !== this.rotation) this.updateSource({ rotation });
    return result;
}

/** Snap dragged rotation (rotate handle, drawing a new cone) to the middle of a wedge. */
function _getSnappedRotation(wrapped, rotation) {
    if (!_isRuleCone(this)) return wrapped(rotation);
    return _getWedgeRotation(_getWedge(rotation), rotation);
}

/**
 * Mouse-wheel rotation during placement rotates by 5° or 15°. For rule cones, step to the next wedge in the same
 * sense instead. Larger turns go to the wedge they land in. Rotations around a pivot (whole Region rotated,
 * attached token turning) are left alone; the geometry still picks a wedge.
 */
function _rotate(wrapped, angle, options = {}) {
    if (options?.pivot || !angle || !_isRuleCone(this)) return wrapped(angle, options);
    const current = this.rotation;
    const step = Math.abs(angle) < WEDGE_ANGLE ? Math.sign(angle) * WEDGE_ANGLE : angle;
    const target = _getWedgeRotation(_getWedge(_getWedgeRotation(_getWedge(current), current) + step), current + step);
    return wrapped(target - current, options);
}

/** The cone's angle means nothing for a wedge of squares, so leave it out of the measurement label. */
function _createMeasuredSegments(wrapped, ...args) {
    const segments = wrapped(...args);
    if (!_isRuleCone(this)) return segments;
    return segments.map(({ angle, ...segment }) => segment);
}

/* -------------------------------------------- */
/*  Init                                         */
/* -------------------------------------------- */

/**
 * Recompute cone geometry after the setting changed. Shapes cache their polygons on the documents,
 * so every scene is cleared; only the viewed scene has Region objects to redraw.
 */
export function refreshGridCones() {
    for (const scene of game.scenes ?? []) {
        for (const region of scene.regions) {
            if (!region.shapes.some(s => s.type === "cone")) continue;
            for (const shape of region.shapes) if (shape.type === "cone") shape._onShapeChange();
            region._clearPolygonTree();
            region.object?.renderFlags.set({ refreshShapes: true });
        }
    }
}

/**
 * Register the cone shape wrappers. Each wrapper checks the setting, so changes apply without a reload.
 */
export function initGridConeRules() {
    const proto = "foundry.data.ConeShapeData.prototype";
    patchMethod(`${proto}._createClipperPolyTree`, _createClipperPolyTree, "MIXED");
    patchMethod(`${proto}._calculateArea`, _calculateArea, "MIXED");
    patchMethod(`${proto}._createControlHandles`, _createControlHandles, "WRAPPER");
    patchMethod(`${proto}._getSnappedPoint`, _getSnappedPoint, "MIXED");
    patchMethod(`${proto}._getSnappedRotation`, _getSnappedRotation, "MIXED");
    patchMethod(`${proto}.move`, _move, "WRAPPER");
    patchMethod(`${proto}.rotate`, _rotate, "WRAPPER");
    patchMethod(`${proto}._createMeasuredSegments`, _createMeasuredSegments, "WRAPPER");
    log("Rules-Accurate Grid Cones initialized");
}
