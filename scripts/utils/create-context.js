/**
 * Module context factory
 * ----------------------
 * Builds the helpers every feature file uses (logging, cached setting reads, feature checks) for one module id.
 * Kept free of feature imports, so feature files can import their context without the circular import through
 * `main.js` (whose exports are still uninitialized while it imports the feature files).
 *
 * Prepared for niks-foundry-tweaks: core will export this factory and each module builds its own context.
 *
 * @introduced v14.69.0
 */

/**
 * Settings cache, shared by every context (entries are keyed by full setting id).
 *
 * In Foundry V14, `game.settings.get` linearly scans every world Setting document (or constructs a fresh
 * `Setting` document for client settings and unset defaults) on every call. Several features read settings
 * inside hot getters that run for every ActiveEffect during data preparation, so reads are cached here.
 *
 * Invalidation:
 *  - The setting config's `onChange` is wrapped on first read so the cache entry is dropped *before* any
 *    onChange handler runs (Foundry calls onChange before hooks).
 *  - `clientSettingChanged`, `createSetting`, `updateSetting` and `deleteSetting` hooks act as a fallback for
 *    any change path that bypasses onChange.
 *
 * Only primitive-valued settings should be read through this cache, since cached values are returned by reference.
 */

/** @type {Map<string, any>} Setting id ("namespace.key") -> cached value */
const _settingsCache = new Map();

/** @type {Set<string>} Setting ids whose config onChange has been wrapped for invalidation */
const _settingsCacheWrapped = new Set();

/**
 * Drop one cached setting value, or the entire cache when no id is given.
 * @param {string} [id] - Setting id in "namespace.key" form.
 */
export function clearSettingsCache(id) {
    if (id) _settingsCache.delete(id);
    else _settingsCache.clear();
}

Hooks.on("clientSettingChanged", (key) => clearSettingsCache(key));
Hooks.on("createSetting", (setting) => clearSettingsCache(setting.key));
Hooks.on("updateSetting", (setting) => clearSettingsCache(setting.key));
Hooks.on("deleteSetting", (setting) => clearSettingsCache(setting.key));

/**
 * Read a setting value through the shared settings cache.
 * @param {string} namespace
 * @param {string} key
 * @returns {any}
 */
function readCached(namespace, key) {
    const id = `${namespace}.${key}`;
    if (_settingsCache.has(id)) return _settingsCache.get(id);

    // Throws for unregistered settings, matching game.settings.get behavior; nothing is cached then.
    const value = game.settings.get(namespace, key);

    const config = game.settings.settings.get(id);
    if (!config) return value;
    if (!_settingsCacheWrapped.has(id)) {
        _settingsCacheWrapped.add(id);
        const originalOnChange = config.onChange;
        config.onChange = function (...args) {
            _settingsCache.delete(id);
            if (typeof originalOnChange === "function") return originalOnChange.apply(this, args);
        };
    }
    _settingsCache.set(id, value);
    return value;
}

/**
 * Create the helpers for one module.
 *
 * @param {object} options
 * @param {string} options.moduleId              The module's package id; default setting namespace.
 * @param {string} options.label                 Prefix for console messages.
 * @param {string} [options.debugNamespace]      Namespace of the `debugMode` setting (defaults to moduleId).
 * @returns {{
 *   MODULE_ID: string,
 *   log: (message: string, ...args: any[]) => void,
 *   debug: (message: string, ...args: any[]) => void,
 *   getSetting: (key: string, namespace?: string) => any,
 *   isFeatureActive: (worldKey: string, clientKey?: string) => boolean,
 *   clearSettingsCache: (id?: string) => void
 * }}
 */
export function createContext({ moduleId, label, debugNamespace = moduleId }) {
    const getSetting = (key, namespace = moduleId) => readCached(namespace, key);

    const log = (message, ...args) => console.log(`${label} | ${message}`, ...args);

    const debug = (message, ...args) => {
        let enabled = false;
        try {
            enabled = readCached(debugNamespace, "debugMode");
        } catch {
            return;
        }
        if (enabled) console.debug(`${label} DEBUG | ${message}`, ...args);
    };

    /**
     * Whether a feature is active: the GM's world-level master setting is on and the player's personal
     * client-level override (if any) isn't off.
     */
    const isFeatureActive = (worldKey, clientKey) => {
        try {
            if (!getSetting(worldKey)) return false;
            if (clientKey && !getSetting(clientKey)) return false;
        } catch {
            return false;
        }
        return true;
    };

    return { MODULE_ID: moduleId, log, debug, getSetting, isFeatureActive, clearSettingsCache };
}
