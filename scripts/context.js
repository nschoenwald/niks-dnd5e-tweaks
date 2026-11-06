/**
 * This module's context: id, logging and cached setting helpers for every feature file.
 * Feature files import from here, never from `main.js`.
 * `utils/create-context.js` is a copy of core's (the context is needed while files load, before core's API exists).
 *
 * @introduced v14.69.0
 * @updated v14.70.0 (debug logging follows the shared Debug Mode of Nik's Foundry Tweaks)
 */
import { createContext } from "./utils/create-context.js";

export const {
    MODULE_ID,
    log,
    debug,
    getSetting,
    isFeatureActive,
    clearSettingsCache
} = createContext({
    moduleId: "niks-dnd5e-tweaks",
    label: "Nik's DnD5e Tweaks",
    // One Debug Mode for all Nik's Tweaks modules, in Nik's Foundry Tweaks
    debugNamespace: "niks-foundry-tweaks"
});
