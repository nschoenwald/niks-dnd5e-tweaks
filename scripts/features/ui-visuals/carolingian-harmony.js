/**
 * Feature: Carolingian UI Theme Harmony
 * Description: Dynamically harmonizes Nik's DnD5e Tweaks styling and features with Carolingian UI (crlngn-ui),
 * adopting its active color themes, layout offsets, and combat carousel aesthetics.
 *
 * @introduced v14.37.0
 */
import { MODULE_ID, log, isFeatureActive } from "../../main.js";

const CRLNGN_MODULE_ID = "crlngn-ui";
const HARMONY_BODY_CLASS = "nd5t-crlngn-theme-active";
const PLACEHOLDER_COMBATANT_CLASS = "nd5t-legendary-placeholder";

/**
 * Checks whether Carolingian UI is installed and active in the world.
 * @returns {boolean}
 */
export function isCarolingianActive() {
    return Boolean(game.modules?.get(CRLNGN_MODULE_ID)?.active);
}

/**
 * Checks whether Carolingian UI Theme Harmony should be applied to the current client.
 * Requires Carolingian UI to be installed and active, plus both world and personal client settings enabled.
 * @returns {boolean}
 */
export function isCarolingianHarmonyActive() {
    if (!isCarolingianActive()) return false;
    return isFeatureActive("enableCarolingianTheme", "clientEnableCarolingianTheme");
}

/**
 * Applies or removes the harmony class on a document body.
 * @param {Document} doc
 * @param {boolean} active
 */
function _applyClassToDocument(doc, active) {
    if (!doc?.body) return;
    doc.body.classList.toggle(HARMONY_BODY_CLASS, active);
}

/**
 * Updates the Carolingian UI harmony class across the main window and any detached popout windows.
 */
export function updateCarolingianThemeState() {
    const active = isCarolingianHarmonyActive();

    // Main window
    _applyClassToDocument(document, active);

    // Detached popout windows
    const detachedWindows = foundry.applications?.detached?.values?.() ?? [];
    for (const win of detachedWindows) {
        if (win?.document) {
            _applyClassToDocument(win.document, active);
        }
    }
}

/**
 * Tags legendary action placeholder combatant elements in the combat tracker and carousel.
 * @param {Application} app
 * @param {HTMLElement|JQuery} html
 */
function _tagPlaceholderCombatants(app, html) {
    if (!isCarolingianHarmonyActive()) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const combat = app.viewed;
    if (!combat) return;

    const combatantElements = root.querySelectorAll("li.combatant[data-combatant-id]");
    for (const el of combatantElements) {
        const id = el.dataset.combatantId;
        const combatant = combat.combatants.get(id);
        if (combatant?.getFlag(MODULE_ID, "isLegendaryPlaceholder")) {
            el.classList.add(PLACEHOLDER_COMBATANT_CLASS);
        }
    }
}

/**
 * Initializes Carolingian UI Theme Harmony.
 */
export function initCarolingianHarmony() {
    if (!isCarolingianActive()) return;

    // Apply initial state
    updateCarolingianThemeState();

    // Hook into combat tracker and combat popout renders
    Hooks.on("renderCombatTracker", (app, html) => {
        _tagPlaceholderCombatants(app, html);
    });

    // Tag popout windows when rendered
    Hooks.on("renderApplicationV2", (app) => {
        if (app.element?.ownerDocument && app.element.ownerDocument !== document) {
            _applyClassToDocument(app.element.ownerDocument, isCarolingianHarmonyActive());
        }
    });

    // Re-verify on ready once all modules and UI layers are fully set up
    Hooks.once("ready", () => {
        updateCarolingianThemeState();
    });

    log("Carolingian UI Theme Harmony initialized");
}
