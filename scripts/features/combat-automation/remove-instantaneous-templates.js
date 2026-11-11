/**
 * Feature: Remove Instantaneous Templates on Turn Change
 * Description: When the combat turn changes (and when a started combat ends), deletes the templates of activities
 *              with an instantaneous duration (e.g. Fireball, Burning Hands, breath weapons).
 *
 * @introduced v14.74.0
 */
import { debug, getSetting } from "../../context.js";

/**
 * Remove Instantaneous Templates
 *
 * dnd5e places activity templates as Regions flagged with `flags.dnd5e.activity` (the activity's UUID). Templates of
 * spells and abilities with an instantaneous duration stay on the scene until someone deletes them by hand.
 *
 * On every turn change of a started combat (`combatTurnChange`) and when a started combat is deleted, the active GM
 * deletes every Region on the combat's scene(s) whose activity has `duration.units === "inst"`. The activity's duration
 * already falls back to the item's duration in dnd5e's data preparation, so non-overridden activities work too.
 *
 * Not touched: templates without a dnd5e activity flag (drawn by hand, other modules), templates whose activity can no
 * longer be found (item deleted), and templates of activities with any other duration (concentration spells etc.).
 * The start of combat is skipped, so a template placed to open the fight (an ambush Fireball) stays for the first turn.
 */

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the feature. Called once during "setup" from main.js.
 */
export function initRemoveInstantaneousTemplates() {
    Hooks.on("combatTurnChange", _onCombatTurnChange);
    Hooks.on("deleteCombat", _onDeleteCombat);
}

// ── Hook handlers ────────────────────────────────────────────────────

/**
 * Remove instantaneous templates when the turn or round changes.
 * @param {Combat} combat                   The combat whose turn changed.
 * @param {CombatHistoryData} previous      The prior turn state.
 * @param {CombatHistoryData} current       The new turn state.
 */
function _onCombatTurnChange(combat, previous, current) {
    if (!game.user.isActiveGM || !getSetting("enableRemoveInstantaneousTemplates")) return;
    // Combat start: keep templates placed right before or as the fight began.
    if (!previous?.round) return;
    if ((previous.round === current?.round) && (previous.turn === current?.turn)) return;
    _removeTemplates(combat, "turn change");
}

/**
 * Remove instantaneous templates when a started combat ends.
 * @param {Combat} combat  The deleted combat.
 */
function _onDeleteCombat(combat) {
    if (!game.user.isActiveGM || !getSetting("enableRemoveInstantaneousTemplates")) return;
    if (!combat.started) return;
    _removeTemplates(combat, "combat end");
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Delete the instantaneous activity templates on the scenes of a combat.
 * @param {Combat} combat   The combat.
 * @param {string} reason   For the debug log.
 */
async function _removeTemplates(combat, reason) {
    for (const scene of _getCombatScenes(combat)) {
        const ids = scene.regions.filter(_isInstantaneousTemplate).map(r => r.id);
        if (!ids.length) continue;
        debug(`Remove Instantaneous Templates | ${reason}: deleting ${ids.length} template(s) on ${scene.name}`);
        try {
            await scene.deleteEmbeddedDocuments("Region", ids);
        } catch (err) {
            // Another client or module may have deleted them in the meantime.
            debug("Remove Instantaneous Templates | Delete failed", err);
        }
    }
}

/**
 * The scenes a combat takes place on: its linked scene, or for unlinked combats the scenes of its combatants' tokens.
 * @param {Combat} combat  The combat.
 * @returns {Set<Scene>}
 */
function _getCombatScenes(combat) {
    const scenes = new Set();
    if (combat.scene) scenes.add(combat.scene);
    for (const combatant of combat.combatants) {
        const scene = combatant.token?.parent ?? game.scenes.get(combatant.sceneId);
        if (scene) scenes.add(scene);
    }
    return scenes;
}

/**
 * Whether a Region is a dnd5e activity template whose activity has an instantaneous duration.
 * @param {RegionDocument} region  The region.
 * @returns {boolean}
 */
function _isInstantaneousTemplate(region) {
    const activityUuid = region.getFlag("dnd5e", "activity");
    if (!activityUuid) return false;
    let activity;
    try {
        activity = fromUuidSync(activityUuid, { strict: false });
    } catch {
        return false;
    }
    return activity?.duration?.units === "inst";
}
