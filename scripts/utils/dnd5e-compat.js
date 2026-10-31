/**
 * Utility: D&D 5e Version Compatibility
 * Description: Wrappers around D&D 5e APIs whose signature changed between system versions, so features can
 *              call them the same way on every supported version.
 *
 * @introduced v14.59.0
 */

/**
 * D&D 5e 6.1 moved the target unit of `convertLength` into the options object and made it return
 * `{ value, unit }` (with `legacy: false`). The old call still works there but logs deprecation warnings,
 * and is removed in 6.3.
 */
const CONVERT_LENGTH_OPTIONS_VERSION = "6.1.0";

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
        const result = foundry.utils.isNewerVersion(CONVERT_LENGTH_OPTIONS_VERSION, game.system.version)
            ? convert(value, from, to, { strict: false })
            : convert(value, from, { to, strict: false, legacy: false })?.value;
        return Number.isFinite(result) ? result : null;
    } catch {
        return null;
    }
}
