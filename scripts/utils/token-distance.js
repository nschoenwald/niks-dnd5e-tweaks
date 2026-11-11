/**
 * Utility: Token Distance
 * Description: Distance between two tokens the way 5e rules measure reach ("within 5 feet"): between the
 *              closest grid spaces the tokens occupy, including the vertical gap between them. Shared by
 *              Prone Rules and Conditional Damage Bonuses (Sneak Attack).
 *
 * @introduced v14.75.0
 */
import { convertLength } from "./dnd5e-compat.js";

/**
 * Distance between two tokens in scene units: closest grid spaces, including the vertical gap.
 * On gridless scenes tokens are treated as circles, measured so that touching tokens are one grid distance
 * (5 ft) apart, like adjacent spaces on a grid.
 * @param {Token} a
 * @param {Token} b
 * @returns {number}
 */
export function tokenDistance(a, b) {
    const grid = canvas.grid;
    const docA = a.document;
    const docB = b.document;
    const height = doc => (doc.depth ?? Math.min(doc.width, doc.height)) * grid.distance;
    const gap = Math.max(0, docB.elevation - (docA.elevation + height(docA)), docA.elevation - (docB.elevation + height(docB)));

    if (grid.isGridless) {
        const ca = a.center;
        const cb = b.center;
        const radii = ((Math.max(docA.width, docA.height) + Math.max(docB.width, docB.height)) / 2) * grid.distance;
        // Measured like the grid case: between the centers of the closest spaces, so adjacent tokens are 5 ft apart.
        const flat = Math.max(0, (Math.hypot(ca.x - cb.x, ca.y - cb.y) / grid.size * grid.distance) - radii + grid.distance);
        return Math.hypot(flat, gap);
    }

    const spacesA = docA.getOccupiedGridSpaceOffsets();
    const spacesB = docB.getOccupiedGridSpaceOffsets();
    if (!spacesA.length || !spacesB.length) return Infinity;
    let best = Infinity;
    for (const oa of spacesA) {
        const pa = grid.getCenterPoint(oa);
        for (const ob of spacesB) {
            const pb = grid.getCenterPoint(ob);
            const { distance } = grid.measurePath([{ x: pa.x, y: pa.y, elevation: 0 }, { x: pb.x, y: pb.y, elevation: gap }]);
            if (distance < best) best = distance;
        }
    }
    return best;
}

/**
 * Convert a distance in feet to the viewed scene's grid units. Scenes in feet, or in units dnd5e can't
 * convert, use the value as is.
 * @param {number} feet
 * @returns {number}
 */
export function feetToSceneUnits(feet) {
    const units = canvas.scene?.grid?.units;
    if (!units || units === "ft" || !(units in (CONFIG.DND5E.movementUnits ?? {}))) return feet;
    return convertLength(feet, "ft", units) ?? feet;
}

/**
 * Whether two tokens on the same scene are within the given distance in feet of each other.
 * @param {Token} a
 * @param {Token} b
 * @param {number} feet
 * @returns {boolean}
 */
export function areTokensWithin(a, b, feet) {
    if (!a?.document || !b?.document || a === b) return false;
    if (a.document.parent !== b.document.parent) return false;
    return tokenDistance(a, b) <= feetToSceneUnits(feet) + 1e-6;
}
