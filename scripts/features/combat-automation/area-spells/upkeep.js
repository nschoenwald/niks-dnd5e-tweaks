/**
 * Area Spell Automation: Drifting areas, removing the area when concentration ends, and the remembered damage type.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { getSetting, debug } from "../../../context.js";
import { convertLength } from "../../../utils/dnd5e-compat.js";
import { getBehaviorActivity, getEmanationBehaviors, isSpellStillActive } from "./activity.js";
import { DAMAGE_EMANATION_BEHAVIOR_TYPE } from "./config.js";
import { pendingDamageTargets, rememberedDamageTypes } from "./state.js";
import { isExecutor } from "./triggers.js";

/**
 * At the start of a caster's turn, move their drifting areas away from them.
 * @param {Combat} combat
 * @param {CombatHistoryData} previous
 * @param {CombatHistoryData} current
 */
export async function onCombatTurnChange(combat, previous, current) {
    if (!getSetting("enableDamageEmanation") || !getSetting("damageEmanationDrift")) return;
    if (!previous || !current) return;
    // A new turn started: the tracker moved forward, or another combatant took the current turn (one was removed or
    // the order changed), as Foundry counts it. Rewinding doesn't move the area back or forth.
    const rewound = (current.round < previous.round)
        || ((current.round === previous.round) && (current.turn < previous.turn));
    const changed = (current.round !== previous.round) || (current.turn !== previous.turn)
        || (current.combatantId !== previous.combatantId);
    if (rewound || !changed) return;

    const combatant = combat.combatants.get(current.combatantId);
    const actor = combatant?.actor;
    // The scene of the caster's token: an unlinked combat has no scene of its own
    const scene = combatant?.token?.parent ?? combat.scene ?? canvas.scene;
    if (!actor || !scene) return;

    for (const region of scene.regions) {
        if (region.attachment?.token) continue;
        const behavior = getEmanationBehaviors(region).find(b => !b.disabled && (b.system.drift > 0));
        if (!behavior) continue;
        const activity = getBehaviorActivity(behavior);
        if (!activity || (activity.actor !== actor) || !isExecutor(actor) || !isSpellStillActive(activity)) continue;
        try {
            await _driftRegion(region, behavior.system.drift, scene);
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Area Spells: Failed to move area", err);
        }
    }
}

/**
 * Move a region the given distance straight away from its caster's token.
 * @param {RegionDocument} region
 * @param {number} distanceFt
 * @param {Scene} scene
 */
async function _driftRegion(region, distanceFt, scene) {
    const casterToken = fromUuidSync(region.getFlag("dnd5e", "origin"), { strict: false });
    const shapes = region.toObject().shapes ?? [];
    const anchor = shapes.find(s => Number.isFinite(s.x) && Number.isFinite(s.y));
    if (!casterToken?.getCenterPoint || !anchor || (casterToken.parent !== scene)) return;

    const from = casterToken.getCenterPoint();
    const dx = anchor.x - from.x;
    const dy = anchor.y - from.y;
    const length = Math.hypot(dx, dy);
    // Centered on the caster: there's no "away", so leave it to the GM
    if (length < 1) return;

    const distance = convertLength(distanceFt, "ft", scene.grid.units) ?? distanceFt;
    const pixels = distance * (scene.grid.size / scene.grid.distance);
    const offsetX = (dx / length) * pixels;
    const offsetY = (dy / length) * pixels;

    for (const shape of shapes) {
        if (Number.isFinite(shape.x)) shape.x += offsetX;
        if (Number.isFinite(shape.y)) shape.y += offsetY;
        if (Array.isArray(shape.points)) {
            shape.points = shape.points.map((value, index) => value + ((index % 2) ? offsetY : offsetX));
        }
    }
    debug(`Area Spells | Moving "${region.name}" ${distanceFt} ft away from ${casterToken.name}`);
    await region.update({ shapes });
}

/**
 * Remove the emanation when the caster stops concentrating on the spell.
 * @param {ActiveEffect5e} effect
 */
export async function onDeleteActiveEffect(effect) {
    if (!game.user.isActiveGM || !getSetting("enableDamageEmanation")) return;
    if (!effect.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING)) return;
    const actor = effect.parent;
    const itemId = effect.getFlag("dnd5e", "item")?.id;
    if (!(actor instanceof Actor) || !itemId) return;
    const itemUuid = `${actor.uuid}.Item.${itemId}`;

    for (const scene of game.scenes) {
        const ids = scene.regions
            .filter(r => (r.getFlag("dnd5e", "item") === itemUuid)
                && r.behaviors.some(b => b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE))
            .map(r => r.id);
        if (!ids.length) continue;
        debug(`Area Spells | Concentration ended, removing ${ids.length} emanation(s) from ${scene.name}`);
        await scene.deleteEmbeddedDocuments("Region", ids);
    }
}

/**
 * Area Spell Trigger behaviors on any scene that use the given activity.
 * @param {Activity} activity
 * @returns {RegionBehavior[]}
 */
function _getBehaviorsForActivity(activity) {
    const activityUuid = activity?.uuid;
    if (!activityUuid) return [];
    const itemUuid = activity.item?.uuid;
    // Every scene, not just the viewed one (the GM may roll while looking at another scene). Plain UUID comparisons
    // first, since this runs for every damage roll in the world.
    const matches = b => (b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) && ((b.system.activity === activityUuid)
        || (!b.system.activity && itemUuid && (b.system.spell === itemUuid) && (getBehaviorActivity(b)?.uuid === activityUuid)));
    return game.scenes.contents.flatMap(scene => scene.regions.contents.flatMap(r => r.behaviors.filter(matches)));
}

/**
 * Point the damage roll of a triggered damage activity at the triggered creatures, and preselect
 * the damage type chosen earlier for this emanation (e.g. Radiant or Necrotic).
 * @param {object} config    Damage roll process configuration.
 * @param {object} [dialog]  Roll dialog configuration.
 * @param {object} [message] Roll message configuration.
 */
export function onPreRollDamage(config, dialog, message) {
    if (!getSetting("enableDamageEmanation")) return;
    const activityUuid = config?.subject?.uuid;
    const targets = pendingDamageTargets.get(activityUuid);
    if (targets && message?.data) {
        foundry.utils.setProperty(message.data, "system.targets", targets);
        pendingDamageTargets.delete(activityUuid);
    }

    if (!getSetting("damageEmanationRememberDamageType")) return;
    const behaviors = _getBehaviorsForActivity(config.subject);
    if (!behaviors.length) return;
    const type = behaviors.find(b => b.system.damageType)?.system.damageType
        ?? rememberedDamageTypes.get(activityUuid);
    if (!type) return;
    for (const roll of config.rolls ?? []) {
        if (roll?.options?.types?.includes(type)) roll.options.type = type;
    }
}

/**
 * Remember the damage type chosen for an emanation's damage.
 * @param {DamageRoll[]} rolls
 * @param {{subject: Activity}} [data]
 */
export function onRollDamage(rolls, { subject } = {}) {
    if (!getSetting("enableDamageEmanation") || !getSetting("damageEmanationRememberDamageType")) return;
    const roll = rolls?.find(r => (r.options?.types?.length > 1) && r.options.type);
    if (!roll || !subject?.uuid) return;
    const behaviors = _getBehaviorsForActivity(subject);
    if (!behaviors.length) return;
    const type = roll.options.type;
    rememberedDamageTypes.set(subject.uuid, type);
    for (const behavior of behaviors) {
        if (behavior.isOwner && (behavior.system.damageType !== type)) {
            behavior.update({ "system.damageType": type }).catch(err =>
                debug("Area Spells | Could not store damage type", err));
        }
    }
}
