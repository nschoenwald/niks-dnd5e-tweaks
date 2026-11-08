/**
 * Features whose personal setting can override the GM's world setting in both directions.
 *
 * Same idea as niks-foundry-tweaks' `scripts/utils/personal-override.js` (14.2.2). The usual pattern
 * (`isFeatureActive("enableX", "clientEnableX")`) needs both the world setting and the player's opt-out to be on.
 * Features that only change what one player sees or how they work on their own screen instead use a personal
 * Select with three choices:
 *   - "world" (default): follow the GM's world setting
 *   - "on":  on for this player even if the GM left it off
 *   - "off": off for this player even if the GM turned it on
 *
 * The dashboard (niks-foundry-tweaks 14.2.2+) knows these from `overridesWorld: true` on the personal setting's
 * schema entry and doesn't grey them out as "no effect" while the world setting is off.
 *
 * Differences from core's copy: `isFeatureOnForUser` keeps the settings cache by default, because some of these
 * checks run on every chat card, tooltip or HUD render; `onChange` handlers pass `{ refresh: true }`. And
 * `migratePersonalOptOuts` converts this module's old Boolean opt-outs.
 *
 * @introduced v14.71.4
 */
import { MODULE_ID, getSetting, clearSettingsCache, log } from "../context.js";

/** Choices of a personal override setting, for registration (game.settings). */
export const OVERRIDE_CHOICES = Object.freeze({
    world: "Use World Setting",
    on: "On",
    off: "Off"
});

/** @returns {{value: string, label: string}[]} The choices in the dashboard schema format. */
export function overrideSchemaChoices() {
    return Object.entries(OVERRIDE_CHOICES).map(([value, label]) => ({ value, label }));
}

/**
 * Whether a feature is on for this user: the personal choice if it is "on" or "off", otherwise the world setting.
 * @param {string} worldKey    Boolean world setting
 * @param {string} clientKey   Personal override setting ("world" | "on" | "off")
 * @param {object} [options]
 * @param {boolean} [options.refresh=false]  Clear both settings from the cache first. Pass it from `onChange`,
 *                                           which can run before the hooks that clear the cache.
 * @returns {boolean}
 */
export function isFeatureOnForUser(worldKey, clientKey, { refresh = false } = {}) {
    if (refresh) {
        clearSettingsCache(`${MODULE_ID}.${worldKey}`);
        clearSettingsCache(`${MODULE_ID}.${clientKey}`);
    }
    try {
        const personal = getSetting(clientKey);
        if (personal === "on") return true;
        if (personal === "off") return false;
        return Boolean(getSetting(worldKey));
    } catch {
        return false;
    }
}

/**
 * Converts old Boolean personal opt-outs into personal overrides: a player who had turned a feature off keeps it off
 * ("off"); everyone else follows the world setting ("world", the default, nothing stored). Removes the old keys
 * afterwards, so it runs only once per browser. Call during `init`, after the settings are registered and before
 * any feature reads them.
 * @param {Record<string, string>} keys  Old key → new key
 */
export function migratePersonalOptOuts(keys) {
    const store = game.settings.storage.get("client");
    let converted = 0;
    for (const [oldKey, newKey] of Object.entries(keys)) {
        const oldId = `${MODULE_ID}.${oldKey}`;
        const raw = store.getItem(oldId);
        if (raw === null) continue;
        const newId = `${MODULE_ID}.${newKey}`;
        let wasOff;
        try {
            wasOff = JSON.parse(raw) === false;
        } catch {
            wasOff = raw === "false";
        }
        if (wasOff && (store.getItem(newId) === null)) {
            store.setItem(newId, JSON.stringify("off"));
            converted++;
        }
        store.removeItem(oldId);
    }
    if (converted) log(`Kept ${converted} feature(s) turned off on this screen (personal settings changed to Use World Setting / On / Off).`);
}
