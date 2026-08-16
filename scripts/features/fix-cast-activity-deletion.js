import { log } from "../main.js";

/**
 * Fix: Cast Activity Deletion — Orphaned Cached Spells (dnd5e < 6.0.0)
 * -----------------------------------------------------------------------
 * In Foundry V14, deleting a Cast activity sends the update key as:
 *
 *   { [`system.activities.${id}`]: _del }   (a DataFieldOperator instance)
 *
 * instead of the V13 form:
 *
 *   { [`system.activities.-=${id}`]: null }
 *
 * The dnd5e `ActivitiesTemplate#preUpdateActivities` method only checks for
 * the "-=" prefix when detecting a deleted activity, so it never fires for
 * V14's new operator syntax.  As a result, the per-actor cached spell items
 * that were created by the Cast activity are left permanently orphaned on the
 * actor with a dangling `flags.dnd5e.cachedFor` reference.
 *
 * This patch wraps `preUpdateActivities` on the prototype that owns it so
 * that entries whose value is a V14 DataFieldOperator instance are normalised
 * into the "-=" form before the original method runs.
 *
 * GATING: Only applied when the dnd5e system version is below 6.0.0.
 */

export function initFixCastActivityDeletion() {
    // Only needed for dnd5e < 6.0.0
    if ( !foundry.utils.isNewerVersion("6.0.0", game.system.version) ) {
        log("Fix: Cast Activity Deletion | dnd5e >= 6.0.0, skipping patch.");
        return;
    }

    // Walk up the prototype chain of the spell data model to find the class
    // that *owns* preUpdateActivities (i.e., ActivitiesTemplate).
    const SpellDataModel = CONFIG.Item.dataModels?.spell;
    if ( !SpellDataModel ) {
        log("Fix: Cast Activity Deletion | CONFIG.Item.dataModels.spell not found — patch not applied.");
        return;
    }

    let targetProto = SpellDataModel.prototype;
    while ( targetProto && targetProto !== Object.prototype ) {
        if ( Object.prototype.hasOwnProperty.call(targetProto, "preUpdateActivities") ) break;
        targetProto = Object.getPrototypeOf(targetProto);
    }

    if ( !targetProto || targetProto === Object.prototype ) {
        log("Fix: Cast Activity Deletion | preUpdateActivities not found on prototype chain — patch not applied.");
        return;
    }

    const original = targetProto.preUpdateActivities;

    targetProto.preUpdateActivities = async function patchedPreUpdateActivities(changed, options, user) {
        // Normalise V14 DataFieldOperator deletions to the "-=" prefix form
        // that the original method recognises.
        if ( foundry.utils.hasProperty(changed, "system.activities") ) {
            const activities = changed.system.activities;
            for ( const key of Object.keys(activities) ) {
                if ( key.startsWith("-=") ) continue;
                if ( _isDeletionValue(activities[key]) ) {
                    activities[`-=${key}`] = null;
                    delete activities[key];
                }
            }
        }

        return original.call(this, changed, options, user);
    };

    log(`Fix: Cast Activity Deletion | Patched preUpdateActivities on ${targetProto.constructor?.name ?? "ActivitiesTemplate"}.`);
}

/**
 * Return true if `value` represents a V14 DataFieldOperator-based deletion.
 *
 * Handles:
 *   - `foundry.data.operators.DataFieldOperator` instances (canonical V14)
 *   - The global `_del` shorthand (resolves to the same ForcedDeletion instance)
 *
 * @param {*} value
 * @returns {boolean}
 */
function _isDeletionValue(value) {
    if ( value === null || value === undefined ) return false;

    // Primary check: foundry.data.operators.DataFieldOperator base class
    const DataFieldOperator = foundry.data?.operators?.DataFieldOperator;
    if ( DataFieldOperator && (value instanceof DataFieldOperator) ) return true;

    // Belt-and-suspenders: compare against the global _del reference directly.
    // eslint-disable-next-line no-undef
    if ( typeof _del !== "undefined" && value === _del ) return true;

    return false;
}
