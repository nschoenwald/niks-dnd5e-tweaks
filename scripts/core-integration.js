/**
 * Nik's Foundry Tweaks integration
 * --------------------------------
 * Nik's Foundry Tweaks (required module) owns the settings dashboard and the system-independent features that
 * used to live here. This file registers this module with it: the dashboard schema, the "handled by another module"
 * rules, and the D&D 5e parts of core features (extensions).
 *
 * No menu of its own: the dashboard opens from Nik's Foundry Tweaks' Configure Module button, and with no menu and
 * no `config: true` setting, Foundry leaves this module out of Configure Settings entirely.
 *
 * Core calls `niksTweaks.register` once during its own `init`, so `registerWithCore()` must run at the top level of
 * `main.js` (top-level code of every module runs before any `init` hook).
 *
 * @introduced v14.70.0
 */
import { MODULE_ID } from "./context.js";
import { getSettingsSchema } from "./settings-schema.js";
import { isAc5eActive, isMidiActive, isWm5eActive, midiHandlesCantSee, midiHandlesConditionRules } from "./utils/module-compat.js";

/** Package id of Nik's Foundry Tweaks. */
export const CORE_ID = "niks-foundry-tweaks";

/** Combatant class Carolingian UI Theme Harmony gets for legendary action placeholders (styled in style.css). */
const LEGENDARY_PLACEHOLDER_CLASS = "nd5t-legendary-placeholder";

/**
 * The API of Nik's Foundry Tweaks, from its `init` on. Undefined when the module is missing or inactive.
 * @returns {object|undefined}
 */
export function coreApi() {
    return game.modules.get(CORE_ID)?.api;
}

/**
 * Keep a floating HUD banner centered on the visible canvas (core's shared helper).
 * @param {HTMLElement} element
 * @returns {() => void} Cleanup function
 */
export function attachHudPositioning(element) {
    return coreApi()?.attachHudPositioning?.(element) ?? (() => {});
}

/**
 * Whether a token was created by a dnd5e summon activity.
 * @param {TokenDocument} tokenDocument
 * @returns {boolean}
 */
export function isSummonedToken(tokenDocument) {
    const actor = tokenDocument.actor;
    if (actor?.getFlag?.("dnd5e", "summon") || actor?.getFlag?.("dnd5e", "summon.origin") || actor?.flags?.dnd5e?.summon) return true;
    if (tokenDocument.getFlag?.("dnd5e", "summon") || tokenDocument.getFlag?.("dnd5e", "summon.origin") || tokenDocument.flags?.dnd5e?.summon) return true;
    if (tokenDocument.delta?.flags?.dnd5e?.summon) return true;
    return false;
}

/**
 * Listen for core's registration hook. Call once, at the top level of main.js.
 */
export function registerWithCore() {
    Hooks.once("niksTweaks.register", (api) => {
        api.registerModule({
            id: MODULE_ID,
            title: "Nik's DnD5e Tweaks",
            badge: "5e",
            docsUrl: "https://github.com/nschoenwald/niks-dnd5e-tweaks#"
        });
        api.registerUnavailableWith({
            midi: { label: "midi-qol", isActive: isMidiActive },
            wm5e: { label: "Automated Masteries 5e", isActive: isWm5eActive },
            ac5e: { label: "Automated Conditions 5e", isActive: isAc5eActive },
            // Condition Advantage & Disadvantage: AC5e, or midi-qol's optional Condition Rules
            conditionRolls: {
                get label() { return isAc5eActive() ? "Automated Conditions 5e" : "midi-qol (Condition Rules)"; },
                isActive: () => isAc5eActive() || midiHandlesConditionRules()
            },
            // Blinded & Invisible: also midi-qol's optional "Invisible / can't see" rule
            conditionVision: {
                get label() {
                    if (isAc5eActive()) return "Automated Conditions 5e";
                    return midiHandlesConditionRules() ? "midi-qol (Condition Rules)" : "midi-qol (Invisible Advantage)";
                },
                isActive: () => isAc5eActive() || midiHandlesConditionRules() || midiHandlesCantSee()
            }
        });
        api.registerSettings(MODULE_ID, getSettingsSchema());

        // D&D 5e parts of core features
        api.extend("contextMenuStyling", {
            deleteLabels: ["DND5E.ContextMenuActionDelete"],
            duplicateLabels: ["DND5E.ContextMenuActionDuplicate"],
            backgroundVars: ["--dnd5e-background-card"]
        });
        api.extend("hidePrivateGMRolls", {
            isRoll: (message) => Boolean(message.flags?.dnd5e?.roll)
        });
        api.extend("autoAddTokensToCombat", {
            // Summons get their own initiative handling
            skipToken: isSummonedToken
        });
        api.extend("carolingianHarmony", {
            combatantClass: (combatant) => (combatant.getFlag(MODULE_ID, "isLegendaryPlaceholder") ? LEGENDARY_PLACEHOLDER_CLASS : null)
        });
        api.extend("readableTextSize", {
            // style.css enlarges dnd5e chat card descriptions
            chat: true
        });
    });
}

/**
 * Tell the GM when Nik's Foundry Tweaks is missing: the settings dashboard and the system-independent features
 * live there. Foundry normally blocks enabling this module without it, so this only catches unusual setups.
 */
export function warnIfCoreMissing() {
    if (coreApi() || !game.user.isGM) return;
    ui.notifications.error("Nik's DnD5e Tweaks needs Nik's Foundry Tweaks: install and enable it to get the settings dashboard and the interface tweaks that moved there.", { permanent: true });
}
