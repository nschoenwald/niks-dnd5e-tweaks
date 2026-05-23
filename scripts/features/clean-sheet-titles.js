import { MODULE_ID, log, debug } from "../main.js";

/**
 * Clean Sheet Titles
 *
 * Overrides the window title of document sheets (Actor, Item, etc.)
 * to remove the verbose type prefix that Foundry core's DocumentSheetV2
 * prepends (e.g. "Non Player Character: Goblin").
 *
 * This is especially useful in V14 where detached windows use the title
 * in the OS taskbar — the long prefix consumes the visible space and hides
 * the actual document name.
 *
 * Supports three title formats controlled by a setting:
 *   - "name"   → "Goblin"
 *   - "prefix" → "NPC: Goblin"
 *   - "suffix" → "Goblin (NPC)"
 *
 * The override patches DocumentSheetV2.prototype so it applies globally
 * to all document sheet subclasses (Actor sheets, Item sheets, etc.).
 */

/** Cache the original title descriptor so we can restore it if needed. */
let originalTitleDescriptor = null;

export function initCleanSheetTitles() {
    if (!game.settings.get(MODULE_ID, "enableCleanSheetTitles")) return;

    const DSV2 = foundry.applications.api.DocumentSheetV2;
    if (!DSV2) {
        log("Clean Sheet Titles: DocumentSheetV2 not found — skipping.");
        return;
    }

    // Save the original descriptor from whichever class in the chain defines it
    originalTitleDescriptor = _findTitleDescriptor(DSV2.prototype);

    Object.defineProperty(DSV2.prototype, "title", {
        get() {
            return _buildTitle(this);
        },
        configurable: true
    });

    log("Clean Sheet Titles enabled");
}

/**
 * Walk the prototype chain to find the existing "title" property descriptor.
 * @param {object} proto
 * @returns {PropertyDescriptor|null}
 */
function _findTitleDescriptor(proto) {
    let current = proto;
    while (current) {
        const desc = Object.getOwnPropertyDescriptor(current, "title");
        if (desc) return desc;
        current = Object.getPrototypeOf(current);
    }
    return null;
}

/**
 * Build the cleaned window title based on the current format setting.
 * Falls back to the document name, or the original title if something goes wrong.
 * @param {DocumentSheetV2} sheet
 * @returns {string}
 */
function _buildTitle(sheet) {
    try {
        const doc = sheet.document;
        if (!doc) return _fallbackTitle(sheet);

        const name = doc.name;
        if (!name) return _fallbackTitle(sheet);

        const format = game.settings.get(MODULE_ID, "cleanSheetTitles_format");

        if (format === "name") return name;

        // Build a short type label. DnD5e and Foundry register type labels under
        // TYPES.<DocumentType>.<subtype> — for example TYPES.Actor.npc = "Non Player Character".
        // We use the localised label but abbreviate it for compact display.
        const typeLabel = _getTypeLabel(doc);

        if (format === "prefix") return `${typeLabel}: ${name}`;
        if (format === "suffix") return `${name} (${typeLabel})`;

        // Unrecognised format — fall back to name only
        return name;
    } catch (err) {
        debug("Clean Sheet Titles: error building title, using fallback", err);
        return _fallbackTitle(sheet);
    }
}

/**
 * Obtain a short/abbreviated type label for a document.
 *
 * Tries the following in order:
 *   1. Abbreviation key  TYPES_ABBR.<DocType>.<subtype> (custom, for future use)
 *   2. The standard localised label from TYPES.<DocType>.<subtype>
 *   3. The document's own typeLabel property
 *   4. The raw subtype string, title-cased
 *
 * @param {Document} doc
 * @returns {string}
 */
function _getTypeLabel(doc) {
    const docTypeName = doc.documentName; // e.g. "Actor", "Item"
    const subType = doc.type;             // e.g. "npc", "character", "weapon"

    // 1. Check for a custom abbreviation key (modules/systems can define these)
    const abbrKey = `TYPES_ABBR.${docTypeName}.${subType}`;
    if (game.i18n.has(abbrKey)) return game.i18n.localize(abbrKey);

    // 2. Standard localised label
    const labelKey = `TYPES.${docTypeName}.${subType}`;
    if (game.i18n.has(labelKey)) return game.i18n.localize(labelKey);

    // 3. Document's own typeLabel
    if (doc.typeLabel) return doc.typeLabel;

    // 4. Raw type, title-cased
    return subType.charAt(0).toUpperCase() + subType.slice(1);
}

/**
 * Get the original title by calling the saved descriptor, or a sensible fallback.
 * @param {DocumentSheetV2} sheet
 * @returns {string}
 */
function _fallbackTitle(sheet) {
    if (originalTitleDescriptor?.get) {
        try {
            return originalTitleDescriptor.get.call(sheet);
        } catch { /* ignore */ }
    }
    return sheet.document?.name ?? "";
}
