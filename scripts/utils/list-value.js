/**
 * Comma-separated list settings (e.g. Hidden Statuses). The list editor itself lives in Nik's Foundry Tweaks'
 * dashboard; features only need to read the values.
 *
 * @introduced v14.70.0 (from settings-list-editor.js)
 */

/**
 * Split a comma-separated list into trimmed entries, dropping empty entries and
 * case-insensitive duplicates (first spelling wins), sorted alphabetically (case-insensitive).
 *
 * @param {string} value
 * @returns {string[]}
 */
export function parseListValue(value) {
    if (typeof value !== "string") return [];
    const seen = new Set();
    const entries = [];
    for (const raw of value.split(",")) {
        const entry = raw.trim();
        const key = entry.toLocaleLowerCase();
        if (!entry || seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
    }
    return entries.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
