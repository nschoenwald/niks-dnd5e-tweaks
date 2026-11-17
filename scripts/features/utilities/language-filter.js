/**
 * Feature: World Language Filter
 * Description: Limits the languages offered in the actor Languages dialog and in Trait advancements (e.g. "choose
 * any language" from a species or background) to the ones the GM wants in the world, either by hiding listed
 * languages or by offering only listed ones.
 *
 * @introduced v14.99.0
 * @updated v14.100.0 (Languages picked from the world's languages in the dashboard, with Nik's Foundry Tweaks 14.7.0)
 */
import { debug, getSetting } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Background
 * ---------------------------------------------------------------------------
 * `CONFIG.DND5E.languages` is a tree: categories (`standard`, `exotic`, not selectable), languages, and languages with
 * dialects (`primordial` → `aquan`…). With legacy rules, `cant` and `druidic` are top-level languages.
 *
 * The config itself is left alone on purpose: actor labels, statblocks, `keyLabel` (advancement summaries) and the
 * `&Reference` / passive check enrichers all read it, so removing entries would make monsters lose languages they
 * already speak. Only the two places where a language is picked are filtered:
 *  - `LanguagesConfig#_preparePartContext` (the actor's Languages dialog, D&D 5e 6.0 and 6.1). Its `context.choices`
 *    is a nested `SelectChoices` with unprefixed keys. Languages the actor already has stay, so saving the dialog
 *    never drops them.
 *  - `TraitAdvancement#actorSelected`: its `available` set (prefixed keys such as `languages:exotic:abyssal`) feeds
 *    `unfulfilledChoices`, which builds every choice pool of the advancement from it. Keys the advancement grants
 *    explicitly (`configuration.grants`) stay, so a species that grants Elvish still grants it.
 *
 * A listed entry matches a config key (`abyssal`, `exotic`, `primordial`) or a label (`Abyssal`, `Rare Languages`),
 * case-insensitive. Listing a category or a language with dialects covers everything under it.
 */

const LANGUAGES_CONFIG_PATH = "dnd5e.applications.actor.LanguagesConfig.prototype._preparePartContext";
const TRAIT_ADVANCEMENT_PATH = "dnd5e.documents.advancement.TraitAdvancement.prototype.actorSelected";

/** @type {{raw: string, keys: Set<string>}|null} */
let _cache = null;

export function initLanguageFilter() {
    if (typeof dnd5e?.applications?.actor?.LanguagesConfig?.prototype?._preparePartContext === "function") {
        patchMethod(LANGUAGES_CONFIG_PATH, _patchedPreparePartContext, "WRAPPER");
    } else debug("LanguagesConfig._preparePartContext not found, skipping language filter for the Languages dialog.");

    if (typeof dnd5e?.documents?.advancement?.TraitAdvancement?.prototype?.actorSelected === "function") {
        patchMethod(TRAIT_ADVANCEMENT_PATH, _patchedActorSelected, "WRAPPER");
    } else debug("TraitAdvancement.actorSelected not found, skipping language filter for advancements.");
}

/**
 * The active filter, or null when the feature is off or the list is empty.
 * @returns {{mode: "hide"|"allow", keys: Set<string>}|null}
 */
function getFilter() {
    if (!getSetting("enableLanguageFilter")) return null;
    const raw = String(getSetting("languageFilterList") ?? "");
    if (_cache?.raw !== raw) _cache = { raw, keys: resolveKeys(raw) };
    if (!_cache.keys.size) return null;
    return { mode: getSetting("languageFilterMode") === "allow" ? "allow" : "hide", keys: _cache.keys };
}

/**
 * Label of a language config entry, localized.
 * @param {string|object} data
 * @returns {string}
 */
function languageLabel(data) {
    const label = (typeof data === "string") ? data : data?.label;
    return label ? game.i18n.localize(label) : "";
}

/**
 * Config key of a listed entry: a key (`abyssal`, `languages:exotic:abyssal`) or a label (`Abyssal`), case-insensitive.
 * @param {string} entry
 * @returns {string|null}
 */
export function findLanguageKey(entry) {
    const wanted = String(entry ?? "").trim().split(":").pop().toLocaleLowerCase();
    if (!wanted) return null;
    let byLabel = null;
    const walk = (config) => {
        for (const [key, data] of Object.entries(config ?? {})) {
            if (key.toLocaleLowerCase() === wanted) return key;
            if (!byLabel && (languageLabel(data).toLocaleLowerCase() === wanted)) byLabel = key;
            const found = data?.children ? walk(data.children) : null;
            if (found) return found;
        }
        return null;
    };
    return walk(CONFIG.DND5E?.languages) ?? byLabel;
}

/**
 * The world's languages as groups for the dashboard's choice picker (Nik's Foundry Tweaks 14.7.0): one group per
 * category (Standard, Rare), which can be picked as a whole, and "Other Languages" for languages outside a category
 * (Thieves' Cant and Druidic with legacy rules). Dialects are listed under their language.
 * @returns {object[]}
 */
export function getLanguageGroups() {
    const toChoices = (config) => Object.entries(config ?? {}).map(([key, data]) => ({
        value: key,
        label: languageLabel(data) || key,
        children: data?.children ? toChoices(data.children) : undefined
    }));
    const groups = [];
    const other = [];
    for (const [key, data] of Object.entries(CONFIG.DND5E?.languages ?? {})) {
        if (data?.children && (data.selectable === false)) {
            groups.push({ label: languageLabel(data) || key, value: key, choices: toChoices(data.children) });
        } else other.push(...toChoices({ [key]: data }));
    }
    if (other.length) groups.push({ label: "Other Languages", choices: other });
    return groups;
}

/**
 * Turn the listed entries (keys or labels) into config keys.
 * @param {string} raw  Comma-separated list.
 * @returns {Set<string>}
 */
function resolveKeys(raw) {
    const keys = new Set();
    for (const entry of raw.split(",")) {
        if (!entry.trim()) continue;
        const key = findLanguageKey(entry);
        if (key) keys.add(key);
        else debug(`Language filter: "${entry.trim()}" matches no language.`);
    }
    return keys;
}

/**
 * Whether a language is offered, given its path in the config tree (e.g. ["exotic", "primordial", "aquan"]).
 * @param {{mode: string, keys: Set<string>}} filter
 * @param {string[]} path
 * @returns {boolean}
 */
function isVisible(filter, path) {
    if (path.at(-1) === "ALL") return false;
    const listed = path.some(segment => filter.keys.has(segment));
    return filter.mode === "allow" ? listed : !listed;
}

/**
 * Remove hidden languages from a nested SelectChoices in place. Chosen entries stay. Entries kept only for their
 * children can no longer be picked themselves.
 * @param {object} choices
 * @param {string[]} parentPath
 * @param {{mode: string, keys: Set<string>}} filter
 * @returns {boolean}  Whether anything was kept.
 */
function pruneChoices(choices, parentPath, filter) {
    let anyKept = false;
    for (const [key, entry] of Object.entries(choices)) {
        // Languages without a category are moved into an "Other" group with their top-level keys
        if (entry?.otherGroup) {
            if (entry.children) pruneChoices(entry.children, parentPath, filter);
            if (!entry.children || entry.children.isEmpty) delete choices[key];
            else anyKept = true;
            continue;
        }
        const path = [...parentPath, key];
        const visible = isVisible(filter, path);
        const childKept = entry?.children ? pruneChoices(entry.children, path, filter) : false;
        const emptyCategory = entry?.children && !childKept && (entry.selectable === false);
        const keep = !emptyCategory && (visible || childKept || entry?.chosen);
        if (!keep) {
            delete choices[key];
            continue;
        }
        if (!visible && !entry.chosen) entry.selectable = false;
        anyKept = true;
    }
    return anyKept;
}

/**
 * Filter the actor's Languages dialog.
 * @this {LanguagesConfig}
 */
async function _patchedPreparePartContext(wrapped, partId, context, options) {
    const result = await wrapped(partId, context, options);
    const filter = getFilter();
    if (filter && result?.choices) pruneChoices(result.choices, [], filter);
    return result;
}

/**
 * Filter the languages a Trait advancement offers.
 * @this {TraitAdvancement}
 */
async function _patchedActorSelected(wrapped, ...args) {
    const result = await wrapped(...args);
    const filter = getFilter();
    if (!filter || !result?.available) return result;
    const grants = this.configuration?.grants ?? new Set();
    for (const key of [...result.available]) {
        const [trait, ...path] = key.split(":");
        if ((trait !== "languages") || grants.has(key)) continue;
        if (!isVisible(filter, path)) result.available.delete(key);
    }
    return result;
}
