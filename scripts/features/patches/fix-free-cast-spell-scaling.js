/**
 * Feature: Free Cast Spell Scaling Patch
 * Description: Hides the "Cast at Level" scaling section and the "no available spell slots" warning in the
 * activity usage dialog for spells cast without a spell slot (item / activity uses, free casts).
 *
 * @introduced v14.55.2
 */
import { log } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Usage Dialog Slot Picker on Spells Cast Without a Slot
 * ---------------------------------------------------------------------------
 * In D&D 5e 6.x, `ActivityUsageDialog#_prepareScalingContext` shows the "Cast at Level" slot picker
 * whenever `activity.requiresSpellSlot` is true, which only checks that the spell can scale.
 * It ignores the activity's own "Consume Spell Slot" toggle (`consumption.spellSlot`).
 * Spells cast through item or activity uses (Mystic Arcanum, feat spells, innate spells) therefore get:
 *   - a slot picker that lets them be upcast for free, and
 *   - "You have no available spell slots with which to cast X!" when the actor has no slot of the
 *     spell's level at all (e.g. a 9th-level Mystic Arcanum on a Warlock with 5th-level pact slots).
 *
 * When the activity neither consumes a spell slot nor allows scaling of its own, the spell is cast at
 * its base level, so the section is removed. `_prepareUsageConfig` has already set `spell.slot` and
 * `scaling` to the base level, and nothing is submitted for them without the section.
 * Linked activities (cast activities on magic items) use their own picker and are left alone.
 */
export function initFixFreeCastSpellScaling() {
    patchMethod(
        "dnd5e.applications.activity.ActivityUsageDialog.prototype._prepareScalingContext",
        async function patchedPrepareScalingContext(wrapped, ...args) {
            const context = await wrapped(...args);
            const activity = this.activity;
            if ( !context?.spellSlots || context.linkedActivity ) return context;
            if ( !activity?.requiresSpellSlot ) return context;
            if ( activity.consumption?.spellSlot || activity.consumption?.scaling?.allowed ) return context;

            context.hasScaling = false;
            delete context.spellSlots;
            context.notes = [];
            return context;
        },
        "WRAPPER"
    );

    log("Fix: Free Cast Spell Scaling | Initialized usage dialog slot picker patch.");
}
