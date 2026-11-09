/**
 * Feature: Spell Slots Expend Left to Right
 * Description: On the D&D 5e actor sheets, expended spell slot pips fill up from the left, and clicking the Nth pip expends slots 1 to N, so the slot you click is the slot you spend.
 *
 * @introduced v14.72.0
 */
import { log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isFeatureOnForUser } from "../../utils/personal-override.js";

/**
 * Spell Slots Expend Left to Right
 * ---------------------------------------------------------------------------
 * dnd5e (6.0 and 6.1) builds the spell slot pips in `_prepareSpellsContext` with `filled = value >= n` and renders
 * them as buttons in `BaseActorSheet#_renderSpellbook` (`data-action="togglePip"`, `data-n`). Available slots are
 * therefore the left pips, expended slots pile up from the right, and clicking the 1st pip (whose tooltip reads
 * "1st spell slot") sets `value = 1`, which expends the 2nd to last slot and keeps the 1st.
 *
 * This wraps `_renderSpellbook` and rewrites the regular (non-temporary) pips afterwards:
 *   - With `max` regular slots and `value` available, pips 1 … (max − value) show as expended, the rest as available.
 *   - Clicking pip i sets `value = max − i` (pips 1 … i expended). Clicking the right-most expended pip restores it
 *     (`value + 1`), mirroring dnd5e's "click the last filled pip to toggle it" behaviour.
 *   - Temporary slots (value > max, `.tmp` pips) keep dnd5e's own handling and stay on the right.
 *
 * The regular pips lose `data-action`, so the sheet's `togglePip` action no longer fires for them; a click listener
 * on each button submits the new value the same way dnd5e does (`this.submit({ updateData })`).
 * The setting is read on every render, so toggling it only needs the sheet to re-render.
 * Only the D&D 5e sheets are affected (Tidy 5e Sheets draws its own pips).
 */

const SHEET_PATH = "dnd5e.applications.actor.BaseActorSheet.prototype._renderSpellbook";

export function initSpellSlotsLeftToRight() {
    patchMethod(SHEET_PATH, function nd5tRenderSpellbook(wrapped, ...args) {
        const result = wrapped(...args);
        try {
            if (isFeatureOnForUser("enableSpellSlotsLeftToRight", "clientSpellSlotsLeftToRight")) mirrorPips(this);
        } catch (err) {
            console.error("niks-dnd5e-tweaks | Spell Slots Left to Right failed", err);
        }
        return result;
    }, "WRAPPER");
    log("Spell Slots Expend Left to Right | Patched _renderSpellbook on BaseActorSheet.");
}

/** Re-renders open actor sheets, e.g. after the setting changed. */
export function refreshSpellSlotSheets() {
    for (const app of foundry.applications.instances.values()) {
        if (app.rendered && (app.document?.documentName === "Actor") && (typeof app._renderSpellbook === "function")) {
            app.render();
        }
    }
}

/**
 * @param {ApplicationV2} sheet  A dnd5e actor sheet
 */
function mirrorPips(sheet) {
    const actor = sheet.actor;
    if (!actor || !sheet.element) return;
    const pluralRules = new Intl.PluralRules(game.i18n.lang, { type: "ordinal" });
    for (const container of sheet.element.querySelectorAll('.pips[data-prop^="system.spells."]')) {
        const prop = container.dataset.prop;
        const regular = [...container.querySelectorAll(".pip:not(.tmp)")];
        const max = regular.length;
        if (!max) continue;
        const value = Number(foundry.utils.getProperty(actor, prop)) || 0;
        const expended = Math.max(0, max - value);

        regular.forEach((button, index) => {
            const i = index + 1;
            const available = i > expended;
            const label = available
                ? game.i18n.format(`DND5E.SpellSlotN.${pluralRules.select(i)}`, { n: i })
                : game.i18n.localize("DND5E.SpellSlotExpended");
            button.classList.toggle("filled", available);
            button.ariaPressed = String(available);
            button.ariaLabel = label;
            button.dataset.tooltip = label;
            button.dataset.n = String(i);
            delete button.dataset.action;
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const current = Number(foundry.utils.getProperty(actor, prop)) || 0;
                const target = max - i;
                const next = (current === target) ? target + 1 : target;
                sheet.submit({ updateData: { [prop]: next } });
            });
        });
    }
}
