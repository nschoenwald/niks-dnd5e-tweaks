/**
 * Registers this module's settings from the dashboard schema (`settings-schema.js`), so key, scope, type, default,
 * choices and reload flag are defined once. What a setting does when it changes lives in `settings-handlers.js`.
 *
 * Every setting is `config: false`: Foundry's Configure Settings never shows them, the dashboard of Nik's Foundry
 * Tweaks does. Name and hint are registered anyway (from the schema), since Foundry and other modules may show them.
 *
 * @introduced v14.121.0 (replaces the registrations written out in main.js)
 */
import { MODULE_ID } from "./context.js";
import { getSettingsSchema } from "./settings-schema.js";
import { SETTING_HANDLERS } from "./settings-handlers.js";

/** Schema type → setting data type. */
const SETTING_TYPES = Object.freeze({
    Boolean: Boolean,
    Number: Number,
    String: String,
    Select: String,
    FilePicker: String,
    Color: String
});

/**
 * Every setting entry of the schema, in dashboard order.
 * @returns {object[]}
 */
function _schemaSettings() {
    return getSettingsSchema().flatMap(tab => (tab.sections ?? []).flatMap(section => section.settings ?? []));
}

/**
 * The data passed to `game.settings.register` for a schema entry.
 * @param {object} entry
 * @returns {object}
 */
export function buildSettingData(entry) {
    const type = SETTING_TYPES[entry.type];
    if (!type) throw new Error(`${MODULE_ID} | Setting "${entry.key}" has the unknown schema type "${entry.type}"`);
    const data = {
        name: entry.name,
        hint: entry.hint,
        scope: entry.scope,
        config: false,
        type,
        default: entry.default
    };
    if (entry.scope === "world") data.restricted = true;
    if (Array.isArray(entry.choices)) data.choices = Object.fromEntries(entry.choices.map(c => [c.value, c.label]));
    if (entry.requiresReload) data.requiresReload = true;
    if (entry.filePicker) data.filePicker = entry.filePicker;
    const onChange = SETTING_HANDLERS[entry.key];
    if (onChange) data.onChange = onChange;
    return data;
}

/**
 * Register every setting of the schema, plus the internal ones the dashboard doesn't show.
 * Called once from main.js during "init".
 */
export function registerSettings() {
    const keys = new Set();
    for (const entry of _schemaSettings()) {
        if (keys.has(entry.key)) {
            console.warn(`${MODULE_ID} | Setting "${entry.key}" is listed twice in the dashboard schema`);
            continue;
        }
        keys.add(entry.key);
        game.settings.register(MODULE_ID, entry.key, buildSettingData(entry));
    }

    // A handler without a setting is a typo or a leftover
    for (const key of Object.keys(SETTING_HANDLERS)) {
        if (!keys.has(key)) console.warn(`${MODULE_ID} | onChange handler for "${key}", which isn't in the dashboard schema`);
    }

    // Data migrations already run (`runMigrations` in main.js)
    game.settings.register(MODULE_ID, "migrationVersion", {
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    // Legacy initiative settings, replaced in migration 2; registered so the migration can read stored values
    game.settings.register(MODULE_ID, "enableAutoRollInitiative", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });
    game.settings.register(MODULE_ID, "autoRollInitiativeFastForward", {
        scope: "world",
        config: false,
        type: String,
        default: "none",
        restricted: true
    });
}
