/**
 * Area Spell Automation: Exclude Allies for dnd5e's own activity behaviors (Apply Active Effect, Difficult Terrain).
 * Part of the feature in `./index.js` (history and overview there).
 */
import { patchMethod } from "../../../utils/patch-helper.js";
import { MODULE_ID, getSetting, debug } from "../../../context.js";

/**
 * dnd5e's "Apply Active Effect" and "Difficult Terrain" activity behaviors only filter by disposition when the
 * target is "allies" or "enemies". Spells that let the caster choose who is affected (Spirit Guardians: "any
 * number of creatures you can see to be unaffected") have the target "creatures" with a choice, which dnd5e turns
 * into an empty filter, so the effect (the halved speed of Spirit Guardians) lands on every creature, allies
 * included. With "Exclude Allies" on, those behaviors skip the caster's disposition, like the emanation's
 * saves and damage do.
 * The behaviors are built by the active GM when the template's region is created (UtilityActivity.placeTemplateBehaviors).
 */
export function patchActivityBehaviorDispositions() {
    const behaviors = dnd5e.dataModels?.regionBehavior;
    if (behaviors?.ApplyActiveEffectActivityBehavior) {
        patchMethod("dnd5e.dataModels.regionBehavior.ApplyActiveEffectActivityBehavior.prototype.createBehaviorData",
            _wrapCreateBehaviorData, "WRAPPER");
    }
    if (behaviors?.DifficultTerrainActivityBehavior) {
        patchMethod("dnd5e.dataModels.regionBehavior.DifficultTerrainActivityBehavior.prototype.createBehaviorData",
            _wrapCreateBehaviorData, "WRAPPER");
    }
}

/**
 * Restrict a dnd5e activity behavior to the creatures not on the caster's side when the caster chooses who is
 * affected and "Exclude Allies" is on.
 * @param {Function} wrapped
 * @param {Activity} activity
 * @param {object} [options]
 * @param {TokenDocument} [options.token]  The token the template originates from.
 * @returns {object|void}  The behavior data.
 */
function _wrapCreateBehaviorData(wrapped, activity, options = {}) {
    const data = wrapped(activity, options);
    try {
        if (!data?.system || !getSetting("enableDamageEmanation") || !getSetting("damageEmanationExcludeAllies")) return data;
        const choosesTargets = !!(activity?.target?.affects?.choice || activity?.item?.system.target?.affects?.choice);
        if (!choosesTargets) return data;
        const { HOSTILE, NEUTRAL, FRIENDLY } = CONST.TOKEN_DISPOSITIONS;
        const casterToken = options.token ?? activity.actor?.token ?? activity.actor?.prototypeToken;
        const disposition = casterToken?.disposition;
        if (![HOSTILE, NEUTRAL, FRIENDLY].includes(disposition)) return data;

        if (data.type === "dnd5e.applyActiveEffect") {
            // An empty set means "everyone"; a non-empty one was set on purpose (allies/enemies), keep it
            const current = data.system.dispositions;
            if (current?.size) return data;
            data.system.dispositions = new Set([HOSTILE, NEUTRAL, FRIENDLY].filter(d => d !== disposition));
        } else if (data.type === "dnd5e.difficultTerrain") {
            const current = data.system.ignoredDispositions;
            if (current?.size) return data;
            data.system.ignoredDispositions = new Set([disposition]);
        } else return data;
        debug(`Area Spells | "${activity.item?.name}": ${data.type} skips the caster's disposition (Exclude Allies)`);
    } catch (err) {
        console.error(`${MODULE_ID} | Area Spells: could not apply Exclude Allies to a dnd5e behavior`, err);
    }
    return data;
}
