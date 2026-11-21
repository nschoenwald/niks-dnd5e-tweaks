/**
 * Utility: Creature Sight
 * Description: Whether a creature has a condition (respecting immunity) and whether it can see another as far as
 *              conditions and senses go. Shared by Condition Advantage & Disadvantage and Ranged Attacks in
 *              Close Combat.
 *
 * @introduced v14.106.0
 */
import { convertLength } from "./dnd5e-compat.js";

/**
 * Whether an actor has a status and isn't immune to it.
 * @param {Actor5e|null} actor
 * @param {string} status
 * @returns {boolean}
 */
export function hasStatus(actor, status) {
    if (!actor?.statuses?.has(status)) return false;
    return !actor.system?.traits?.ci?.value?.has(status);
}

/**
 * Range of a sense in the viewed scene's units: the actor's sense or the token's detection mode, whichever
 * reaches farther.
 * @param {Token} token
 * @param {Actor5e} actor
 * @param {string|null} sense          Key in the actor's `senses.ranges`.
 * @param {string} detectionMode       Detection mode id on the token.
 * @returns {number}
 */
export function senseRange(token, actor, sense, detectionMode) {
    let range = 0;
    const senses = actor?.system?.attributes?.senses;
    const value = sense ? Number(senses?.ranges?.[sense] ?? 0) : 0;
    if (value > 0) {
        const from = senses?.units;
        const to = canvas.scene?.grid?.units;
        range = (from && to && (from !== to) && (to in (CONFIG.DND5E.movementUnits ?? {})))
            ? (convertLength(value, from, to) ?? value) : value;
    }
    const mode = token?.document?.detectionModes?.[detectionMode];
    if (mode?.enabled && (Number(mode.range) > range)) range = Number(mode.range);
    return range;
}

/**
 * Whether a creature can see another as far as conditions and senses go (walls and light are left out).
 * Blindsight sees through Blinded and Invisible; Truesight and See Invisibility see Invisible creatures, each
 * within its range.
 * @param {Token} viewer
 * @param {Token} subject
 * @param {number} distance  Distance between them in scene units.
 * @returns {boolean}
 */
export function canSee(viewer, subject, distance) {
    const viewerActor = viewer.actor;
    const reaches = range => range + 1e-6 >= distance;
    if (reaches(senseRange(viewer, viewerActor, "blindsight", "blindsight"))) return true;
    if (hasStatus(viewerActor, "blinded")) return false;
    if (!hasStatus(subject.actor, "invisible")) return true;
    return reaches(Math.max(
        senseRange(viewer, viewerActor, "truesight", "seeAll"),
        senseRange(viewer, viewerActor, null, "seeInvisibility")
    ));
}
