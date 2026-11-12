/**
 * Feature: Untyped Healing Patch
 * Description: Heal activities whose healing part has no type selected heal instead of dealing damage.
 *
 * @introduced v14.79.0
 */
import { log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Untyped Healing Rolls Applied as Damage
 * ---------------------------------------------------------------------------
 * A heal activity's healing part can be saved without a type (e.g. imported or hand-made items). dnd5e then
 * rolls it with `options.type` undefined: `Activity#_processDamagePart` skips the base-damage fallback for
 * healing activities and takes `types.first()` of an empty set. `Actor5e#calculateDamage` only negates parts
 * typed "healing", so the damage tray shows the healing as damage and Apply deals it as damage
 * (D&D 5e 6.0.6 and 6.1.0, not fixed upstream yet).
 *
 * - New rolls: `HealActivity#getDamageConfig` gives untyped heal parts the type "healing", so the roll,
 *   the tray, its labels and other modules (midi-qol) all see healing.
 * - Rolls already in chat: `dnd5e.preCalculateDamage` types untyped parts as "healing" when the originating
 *   message is a healing roll (`system.isHealing`). The hook receives dnd5e's own clone of the damages.
 */
export function initFixUntypedHealing() {
    patchMethod(
        "CONFIG.DND5E.activityTypes.heal.documentClass.prototype.getDamageConfig",
        function patchedHealGetDamageConfig(wrapped, ...args) {
            const config = wrapped(...args);
            const healing = config?.rolls?.[0];
            if ( healing?.options && !healing.options.type && !this.healing?.types?.size ) {
                healing.options.type = "healing";
                healing.options.types = ["healing"];
                if ( healing.data?.roll?.damage ) healing.data.roll.damage.type = "healing";
            }
            return config;
        },
        "WRAPPER"
    );

    Hooks.on("dnd5e.preCalculateDamage", (actor, damages, options) => {
        if ( !options?.originatingMessage?.system?.isHealing ) return;
        for ( const d of damages ) {
            if ( !d.type ) d.type = "healing";
        }
    });

    log("Fix: Untyped Healing | Initialized heal roll and damage calculation patch.");
}
