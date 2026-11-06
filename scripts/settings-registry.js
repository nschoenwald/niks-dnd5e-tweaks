/**
 * Settings registry
 * -----------------
 * Holds what the settings dashboard shows: the registered modules, their merged tabs / sections / settings,
 * and the "handled by another module" rules. The dashboard renders only from here.
 *
 * Schema entries keep the module's own key as `settingKey` and get `module` plus a unique `key`
 * ("<module>.<settingKey>", the full setting id). `parentKey` and `pairedWith` are qualified the same way,
 * unless they already are, so they can point into another module.
 *
 * Prepared for niks-foundry-tweaks: core will own this registry and expose it to system add-ons.
 *
 * @introduced v14.69.0
 */

/** @type {Map<string, {id: string, title: string, docsUrl: string}>} */
const _modules = new Map();

/** @type {object[]} Merged tabs, in registration order. */
const _tabs = [];

/** @type {Map<string, object>} Every registered entry by full setting id. */
const _settings = new Map();

/** @type {Record<string, {label: string, isActive: () => boolean}>} */
const _unavailableWith = {};

/**
 * Register a module that contributes settings to the dashboard.
 * @param {object} data
 * @param {string} data.id        Package id; the settings namespace.
 * @param {string} data.title     Display name.
 * @param {string} [data.docsUrl] README base URL; an entry's `docs` anchor is appended.
 */
export function registerModule({ id, title, docsUrl = "" }) {
    _modules.set(id, { id, title, docsUrl });
}

/**
 * @param {string} id
 * @returns {{id: string, title: string, docsUrl: string}|undefined}
 */
export function getModule(id) {
    return _modules.get(id);
}

/** @returns {string[]} Ids of all registered modules. */
export function getModuleIds() {
    return [..._modules.keys()];
}

/**
 * Register modules that can take over a feature completely. Entries tagged `unavailableWith: "<id>"` are
 * locked in the dashboard while `isActive()` returns true.
 * @param {Record<string, {label: string, isActive: () => boolean}>} rules
 */
export function registerUnavailableWith(rules) {
    Object.assign(_unavailableWith, rules);
}

/**
 * @param {string} [id]
 * @returns {{label: string, isActive: () => boolean}|null}
 */
export function getUnavailableWith(id) {
    return (id && _unavailableWith[id]) || null;
}

/**
 * Full setting id of a key: kept when it already contains the namespace.
 * @param {string} moduleId
 * @param {string} key
 */
function qualify(moduleId, key) {
    if (!key) return key;
    return key.includes(".") ? key : `${moduleId}.${key}`;
}

/**
 * Add a module's schema. Tabs and sections with the same id as existing ones are merged into them.
 * @param {string} moduleId
 * @param {object[]} schema  Tabs → sections → settings.
 */
export function registerSettings(moduleId, schema) {
    if (!_modules.has(moduleId)) throw new Error(`Settings registry: register module "${moduleId}" first.`);
    for (const tabData of schema) {
        let tab = _tabs.find(t => t.id === tabData.id);
        if (!tab) {
            tab = { ...tabData, sections: [] };
            _tabs.push(tab);
        }
        for (const secData of tabData.sections ?? []) {
            let section = tab.sections.find(s => s.id === secData.id);
            if (!section) {
                section = { ...secData, settings: [] };
                tab.sections.push(section);
            }
            for (const data of secData.settings ?? []) {
                const entry = {
                    ...data,
                    module: moduleId,
                    settingKey: data.key,
                    key: qualify(moduleId, data.key),
                    parentKey: qualify(moduleId, data.parentKey),
                    pairedWith: qualify(moduleId, data.pairedWith)
                };
                if (_settings.has(entry.key)) {
                    console.warn(`Settings registry: "${entry.key}" is registered twice; keeping the first.`);
                    continue;
                }
                _settings.set(entry.key, entry);
                section.settings.push(entry);
            }
        }
    }
}

/** @returns {object[]} The merged tabs. */
export function getTabs() {
    return _tabs;
}

/** @returns {object[]} Every registered entry. */
export function getAllSettings() {
    return [..._settings.values()];
}

/**
 * Find the full setting id for a key. Accepts a full id, or a bare key (preferring `preferModule`).
 * @param {string} key
 * @param {string} [preferModule]
 * @returns {string|null}
 */
export function resolveSettingId(key, preferModule) {
    if (!key) return null;
    if (_settings.has(key)) return key;
    if (preferModule && _settings.has(`${preferModule}.${key}`)) return `${preferModule}.${key}`;
    for (const entry of _settings.values()) {
        if (entry.settingKey === key) return entry.key;
    }
    return null;
}
