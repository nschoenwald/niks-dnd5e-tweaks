/**
 * Utility: D&D 5e Version Compatibility
 * Description: Safe wrappers around D&D 5e APIs that features share.
 *
 * @introduced v14.59.0
 * @updated v14.116.0 (Only the D&D 5e 6.1 `convertLength` signature; 6.0 is no longer supported)
 */

/**
 * Convert a length between units in `CONFIG.DND5E.movementUnits`.
 * @param {number} value  The length to convert.
 * @param {string} from   The unit of the value.
 * @param {string} to     The unit to convert to.
 * @returns {number|null}  The converted length, or null if dnd5e can't convert it.
 */
export function convertLength(value, from, to) {
    const convert = dnd5e?.utils?.convertLength;
    if (typeof convert !== "function") return null;
    try {
        const result = convert(value, from, { to, strict: false, legacy: false })?.value;
        return Number.isFinite(result) ? result : null;
    } catch {
        return null;
    }
}
