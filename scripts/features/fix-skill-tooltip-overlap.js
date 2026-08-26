import { log } from "../main.js";

/**
 * Fix: Skill Tooltip Overlap — Character Sheet Skill/Tool Rows (dnd5e < 6.0.0)
 * ---------------------------------------------------------------------------
 * Each skill (and tool) row in the DnD5e character sheet is rendered as an
 * `<li data-key="...">` element that carries `data-reference-tooltip` pointing
 * to the relevant compendium entry.  The shared `_applyTooltips` helper in
 * `BaseActorSheet` converts that attribute into a `data-tooltip` on the `<li>`
 * itself without specifying a `data-tooltip-direction`.  Foundry's default
 * tooltip positioning (typically below the target element) therefore renders the
 * rule tooltip directly on top of other skill rows in the list, covering their
 * clickable areas (the roll link, proficiency-cycle, and config button).
 *
 * This patch wraps `_applyTooltips` on the prototype that owns it so that,
 * when the element being processed is a skill or tool list-item
 * (`li[data-key]` inside `.skills > ul` or `.tools > ul`), a
 * `data-tooltip-direction` of `"LEFT"` is applied before the tooltip is set.
 * The tooltip then appears to the left of the skill row rather than overlapping
 * the list, restoring full click access to every interactive control.
 *
 * GATING: Only applied when the dnd5e system version is below 6.0.0.
 */

export function initFixSkillTooltipOverlap() {
    // Only needed for dnd5e < 6.0.0
    if ( !foundry.utils.isNewerVersion("6.0.0", game.system.version) ) {
        log("Fix: Skill Tooltip Overlap | dnd5e >= 6.0.0, skipping patch.");
        return;
    }

    // Locate BaseActorSheet via the dnd5e applications namespace.
    const BaseActorSheet = dnd5e?.applications?.actor?.BaseActorSheet;
    if ( !BaseActorSheet ) {
        log("Fix: Skill Tooltip Overlap | dnd5e.applications.actor.BaseActorSheet not found — patch not applied.");
        return;
    }

    // Walk up the prototype chain to find the class that *owns* _applyTooltips.
    let targetProto = BaseActorSheet.prototype;
    while ( targetProto && targetProto !== Object.prototype ) {
        if ( Object.prototype.hasOwnProperty.call(targetProto, "_applyTooltips") ) break;
        targetProto = Object.getPrototypeOf(targetProto);
    }

    if ( !targetProto || targetProto === Object.prototype ) {
        log("Fix: Skill Tooltip Overlap | _applyTooltips not found on prototype chain — patch not applied.");
        return;
    }

    const original = targetProto._applyTooltips;

    targetProto._applyTooltips = function patchedApplyTooltips(element) {
        // If this element is a skill or tool list-item and has a reference
        // tooltip, ensure the tooltip renders to the LEFT so it does not
        // overlap adjacent rows in the skill/tool list.
        if (
            element.matches("li[data-key]")
            && element.closest(".skills > ul, .tools > ul")
            && element.dataset.referenceTooltip
            && !("tooltipDirection" in element.dataset)
        ) {
            element.dataset.tooltipDirection = "LEFT";
        }

        return original.call(this, element);
    };

    log(`Fix: Skill Tooltip Overlap | Patched _applyTooltips on ${targetProto.constructor?.name ?? "BaseActorSheet"}.`);
}
