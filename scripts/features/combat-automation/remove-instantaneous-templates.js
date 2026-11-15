/**
 * Feature: Remove Instantaneous Templates on Turn Change
 * Description: When the combat turn changes (and when a started combat ends), deletes the templates of activities
 *              with an instantaneous duration (e.g. Fireball, Burning Hands, breath weapons). Exceptions for
 *              instantaneous spells whose area lasts (Ice Storm, Plant Growth) are removed later or never.
 *
 * @introduced v14.74.0
 * @updated v14.90.0 (Template Exceptions: per-spell removal time for instantaneous spells whose area lasts)
 */
import { MODULE_ID, debug, getSetting } from "../../context.js";

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
 *
 * Exceptions ("removeInstantaneousTemplatesKeep", entries "identifier" or "identifier=mode", matched by item
 * identifier or slugified name): instantaneous spells whose area outlasts the spell. Found in the PHB 2024 and the
 * other official books: Ice Storm (Difficult Terrain until the end of the caster's next turn), Plant Growth
 * (Overgrowth), Heroes' Feast (the feast lasts 1 hour). Modes:
 *  - never:           kept until deleted by hand (the default for entries without a mode).
 *  - casterTurnStart: removed when the caster's next turn starts.
 *  - casterTurnEnd:   removed when the caster's next turn ends.
 *  - combatEnd:       removed when the combat ends.
 * For the caster's turn, the active GM stores the combat turn a template was created in (`flags.<module>.createdTurn`),
 * so the turn it was placed in doesn't count. The caster is the template's origin token (`flags.dnd5e.origin`), else
 * the item's actor. A caster who isn't in the combat has its template removed once a full round has passed.
 * The timed modes are also removed when the combat ends.
 */

/** Removal times of the exception list, in dropdown order. */
export const TEMPLATE_EXCEPTION_MODES = ["never", "casterTurnStart", "casterTurnEnd", "combatEnd"];

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the feature. Called once during "setup" from main.js.
 */
export function initRemoveInstantaneousTemplates() {
    Hooks.on("combatTurnChange", _onCombatTurnChange);
    Hooks.on("deleteCombat", _onDeleteCombat);
    Hooks.on("createRegion", _onCreateRegion);
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
    _removeTemplates(combat, "turn change", { previous, current });
}

/**
 * Remove instantaneous templates when a started combat ends.
 * @param {Combat} combat  The deleted combat.
 */
function _onDeleteCombat(combat) {
    if (!game.user.isActiveGM || !getSetting("enableRemoveInstantaneousTemplates")) return;
    if (!combat.started) return;
    _removeTemplates(combat, "combat end", { combatEnd: true });
}

/**
 * Remember the combat turn a template with a caster-turn exception was placed in, so that turn doesn't count.
 * @param {RegionDocument} region
 */
function _onCreateRegion(region) {
    if (!game.user.isActiveGM || !getSetting("enableRemoveInstantaneousTemplates")) return;
    const info = _templateInfo(region, _getExceptions());
    if (!info?.mode?.startsWith("caster")) return;
    const combat = game.combats?.find(c => c.started && _getCombatScenes(c).has(region.parent));
    if (!combat) return;
    region.setFlag(MODULE_ID, "createdTurn", { combat: combat.id, round: combat.round, turn: combat.turn })
        .catch(err => debug("Remove Instantaneous Templates | Could not store the creation turn", err));
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Delete the instantaneous activity templates on the scenes of a combat that are due.
 * @param {Combat} combat   The combat.
 * @param {string} reason   For the debug log.
 * @param {object} context  `{previous, current}` on a turn change, `{combatEnd: true}` when the combat ends.
 */
async function _removeTemplates(combat, reason, context) {
    const exceptions = _getExceptions();
    for (const scene of _getCombatScenes(combat)) {
        const ids = scene.regions.filter(region => _isDue(region, combat, exceptions, context)).map(r => r.id);
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
 * The exception list: slugified item identifier or name → removal mode.
 * @returns {Map<string, string>}
 */
function _getExceptions() {
    const raw = getSetting("removeInstantaneousTemplatesKeep");
    const map = new Map();
    if (!raw || (typeof raw !== "string")) return map;
    for (const part of raw.split(",")) {
        const text = part.trim();
        if (!text) continue;
        const index = text.lastIndexOf("=");
        const name = (index > 0 ? text.slice(0, index) : text).trim().slugify({ strict: true });
        const mode = (index > 0) ? text.slice(index + 1).trim() : "never";
        if (name) map.set(name, TEMPLATE_EXCEPTION_MODES.includes(mode) ? mode : "never");
    }
    return map;
}

/**
 * For a dnd5e activity template with an instantaneous duration: its activity and its exception mode (null when the
 * item isn't on the list). Null for every other region.
 * @param {RegionDocument} region
 * @param {Map<string, string>} exceptions
 * @returns {{activity: Activity, mode: string|null}|null}
 */
function _templateInfo(region, exceptions) {
    const activityUuid = region.getFlag("dnd5e", "activity");
    if (!activityUuid) return null;
    let activity;
    try {
        activity = fromUuidSync(activityUuid, { strict: false });
    } catch {
        return null;
    }
    if (activity?.duration?.units !== "inst") return null;
    const item = activity.item;
    const name = item?.name?.slugify({ strict: true });
    const mode = exceptions.get(item?.system?.identifier) ?? (name ? exceptions.get(name) : undefined) ?? null;
    return { activity, mode };
}

/**
 * Whether a region is an instantaneous template that should be removed now.
 * @param {RegionDocument} region
 * @param {Combat} combat
 * @param {Map<string, string>} exceptions
 * @param {object} context  See `_removeTemplates`.
 * @returns {boolean}
 */
function _isDue(region, combat, exceptions, context) {
    const info = _templateInfo(region, exceptions);
    if (!info) return false;
    const { activity, mode } = info;
    if (!mode) return true;
    if (mode === "never") return false;
    if (context.combatEnd) return true;
    if (mode === "combatEnd") return false;

    const { previous, current } = context;
    const created = region.getFlag(MODULE_ID, "createdTurn");
    const createdHere = created?.combat === combat.id;
    const caster = _casterCombatant(region, activity, combat);
    if (!caster) {
        // The caster isn't in this combat: remove once a full round has passed
        return createdHere ? (current.round > created.round) : true;
    }
    const isCreationTurn = state => createdHere && (created.round === state.round) && (created.turn === state.turn);
    if (mode === "casterTurnStart") {
        return (current.combatantId === caster.id) && !isCreationTurn(current);
    }
    // casterTurnEnd
    return (previous.combatantId === caster.id) && !isCreationTurn(previous);
}

/**
 * The combatant of a template's caster: its origin token, else the item's actor.
 * @param {RegionDocument} region
 * @param {Activity} activity
 * @param {Combat} combat
 * @returns {Combatant|null}
 */
function _casterCombatant(region, activity, combat) {
    const originUuid = region.getFlag("dnd5e", "origin");
    if (originUuid) {
        try {
            const token = fromUuidSync(originUuid, { strict: false });
            const byToken = token ? combat.getCombatantsByToken?.(token)?.[0] : null;
            if (byToken) return byToken;
        } catch {
            // Fall back to the actor
        }
    }
    const actor = activity.actor;
    return actor ? (combat.getCombatantsByActor?.(actor)?.[0] ?? null) : null;
}
