/**
 * Feature: Free Cast Spell Scaling Patch
 * Description: In the activity usage dialog, hides the "Cast at Level" section on spells that are never cast with
 * a spell slot, and removes the "no available spell slots" warning from spell activities that don't consume one.
 *
 * @introduced v14.55.2
 * @updated v14.56.3 (Picker kept on follow-up activities of slot-cast spells; warning removal only below D&D 5e 6.1.0)
 */
import { log } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Usage Dialog Slot Picker on Spells Used Without a Slot
 * ---------------------------------------------------------------------------
 * In D&D 5e 6.0.x, `ActivityUsageDialog#_prepareScalingContext` shows the "Cast at Level" slot picker
 * whenever `activity.requiresSpellSlot` is true, which only checks that the spell can scale. It ignores the
 * activity's own "Consume Spell Slot" toggle (`consumption.spellSlot`). When none of the actor's slots fit
 * (e.g. a 9th-level Mystic Arcanum on a Warlock with 5th-level pact slots), it also adds
 * "You have no available spell slots with which to cast X!".
 *
 * - Picker: removed when the activity neither consumes a spell slot nor allows scaling of its own, and no
 *   activity on the spell consumes a spell slot. Such a spell is only ever cast for free at its base level.
 *   `_prepareUsageConfig` has already set `spell.slot` and `scaling` to the base level, and nothing is
 *   submitted for them without the section. Follow-up activities of slot-cast spells (e.g. Moonbeam's
 *   damage) keep the picker: it is how the user tells dnd5e the level the spell was originally cast at.
 * - Warning: removed from every activity that doesn't consume a spell slot. Fixed upstream in D&D 5e 6.1.0,
 *   so this part only applies to 6.0.x and lower.
 *
 * Linked activities (cast activities on magic items) use their own picker and are left alone.
 */
const WARNING_FIXED_IN_VERSION = "6.1.0";

export function initFixFreeCastSpellScaling() {
    const removeWarning = foundry.utils.isNewerVersion(WARNING_FIXED_IN_VERSION, game.system.version);

    patchMethod(
        "dnd5e.applications.activity.ActivityUsageDialog.prototype._prepareScalingContext",
        async function patchedPrepareScalingContext(wrapped, ...args) {
            const context = await wrapped(...args);
            const activity = this.activity;
            if ( !context?.spellSlots || context.linkedActivity ) return context;
            if ( !activity?.requiresSpellSlot || activity.consumption?.spellSlot ) return context;

            const castWithSlot = activity.item?.system?.activities?.some(a => a.consumption?.spellSlot);
            if ( !castWithSlot && !activity.consumption?.scaling?.allowed ) {
                context.hasScaling = false;
                delete context.spellSlots;
                context.notes = [];
            } else if ( removeWarning ) {
                const warning = game.i18n.format("DND5E.SpellCastNoSlotsLeft", { name: this.item.name });
                context.notes = (context.notes ?? []).filter(n => !((n.type === "warn") && (n.message === warning)));
            }
            return context;
        },
        "WRAPPER"
    );

    log(`Fix: Free Cast Spell Scaling | Initialized usage dialog patch (slot warning removal ${removeWarning ? "on" : `off, fixed in D&D 5e ${WARNING_FIXED_IN_VERSION}`}).`);
}
