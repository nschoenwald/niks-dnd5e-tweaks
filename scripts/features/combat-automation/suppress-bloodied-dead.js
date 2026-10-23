/**
 * Feature: Suppress Bloodied Condition on Dead Tokens
 * Description: Suppresses and removes the Bloodied condition from tokens that possess the Dead condition, preventing conflicting status overlays.
 *
 * @introduced v14.31.0
 * @updated v14.49.0 (isSuppressed checks for bloodied effects before reading settings)
 */
import { getSetting, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Suppress Bloodied on Dead Tokens
 *
 * When an actor/token in DnD5e has the "dead" condition (e.g. dropping to 0 HP,
 * dying from failed death saves, or having the dead condition applied), it often
 * retains the "bloodied" condition (since HP is <= 50%). This leaves the bloodied
 * status icon/badge lingering on corpses alongside the dead condition overlay.
 *
 * This feature:
 * 1. Automatically suppresses the bloodied condition (`isSuppressed = true`) for any
 *    actor that currently has the dead condition or is at 0 HP and dead.
 * 2. Patches `Actor5e.prototype.updateBloodied` so the bloodied effect is never created
 *    when an actor is dead or dying (e.g. dropping from healthy to 0 HP), and safely removes
 *    any existing bloodied effect with in-flight deduplication.
 * 3. Removes any existing bloodied condition when an actor gains the dead condition.
 * 4. Automatically re-evaluates the bloodied condition when the dead condition is removed
 *    (e.g. resurrection or healing).
 */

/**
 * Check whether an ActiveEffect represents the bloodied status.
 *
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
export function isBloodiedEffect(effect) {
    if (!effect) return false;
    const id = effect.id;
    if (id === "dnd5ebloodied" || id === "dnd5ebloodied000") return true;
    if (id && id === CONFIG.ActiveEffect?.documentClass?.ID?.BLOODIED) return true;
    return Boolean(effect.statuses?.has("bloodied") || effect.flags?.dnd5e?.statusId === "bloodied");
}

/**
 * Check whether an actor currently has the dead condition.
 * Note: Never evaluate `e.isSuppressed` here, as this function is called from within
 * `ActiveEffect5e.prototype.isSuppressed`, which would cause infinite recursion and
 * call stack exhaustion.
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isActorDead(actor) {
    if (!actor) return false;
    if (actor.statuses?.has("dead")) return true;
    return actor.effects?.some(e => e.active && e.statuses?.has("dead")) ?? false;
}

/**
 * Determine whether an actor is an NPC marked as "important".
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isImportantNPC(actor) {
    if (!actor || actor.type !== "npc") return false;
    return Boolean(actor.system?.traits?.important || (actor.classes && !foundry.utils.isEmpty(actor.classes)));
}

/**
 * Check whether an actor is dead or in the process of dying / becoming dead
 * (e.g. dropping to 0 HP before updateDowned or autoStatusZeroHP has added the dead effect).
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function willActorBeDead(actor) {
    if (!actor || !actor.system) return false;
    if (actor.system?.isCreature === false) return false;
    if (isActorDead(actor)) return true;

    const hp = actor.system.attributes?.hp;
    if (!hp || (hp.value ?? 0) > 0) return false;

    // HP is 0 (or less). Check if the actor will be marked dead.
    if (getSetting("enableAutoStatusZeroHP")) {
        const isPlayer = actor.type === "character" || actor.hasPlayerOwner;
        const isImportant = _isImportantNPC(actor);
        const statusKey = isPlayer ? "autoStatusZeroHP_playerStatus" : "autoStatusZeroHP_npcStatus";
        let configuredStatus = getSetting(statusKey);
        if (isImportant && configuredStatus === "dead") {
            configuredStatus = "unconscious";
        }
        const failedDeathSaves = (actor.system.attributes?.death?.failure ?? 0) >= 3;
        if (failedDeathSaves && configuredStatus !== "none") return true;
        if (configuredStatus === "dead") return true;
        if (configuredStatus !== "none") return false;
    }

    // Default DnD5e behavior at 0 HP
    if (actor.type === "npc") {
        if (!_isImportantNPC(actor)) return true;
    }
    const failedDeathSaves = (actor.system?.attributes?.death?.failure ?? 0) >= 3;
    if (failedDeathSaves) return true;

    return false;
}

/**
 * Set of deletion keys (`${actorUuid}:${effectId}`) currently queued or undergoing
 * deletion to prevent duplicate concurrent delete operations from multiple firing hooks.
 * @type {Set<string>}
 */
const _pendingBloodiedDeletions = new Set();

/**
 * Remove bloodied active effects from an actor safely with deduplication.
 *
 * @param {Actor5e} actor
 */
export async function removeBloodiedEffect(actor) {
    if (!actor?.effects) return;
    const actorUuid = actor.uuid || actor.id;
    const bloodiedId = CONFIG.ActiveEffect?.documentClass?.ID?.BLOODIED ?? "dnd5ebloodied";
    const bloodiedEffects = actor.effects.filter(e => {
        const key = `${actorUuid}:${e.id}`;
        return (e.id === bloodiedId || e.id === "dnd5ebloodied" || e.id === "dnd5ebloodied000" || isBloodiedEffect(e))
            && !_pendingBloodiedDeletions.has(key)
            && actor.effects.has(e.id);
    });

    if (bloodiedEffects.length === 0) return;

    const idsToDelete = bloodiedEffects.map(e => e.id);
    const keysToDelete = idsToDelete.map(id => `${actorUuid}:${id}`);
    for (const key of keysToDelete) {
        _pendingBloodiedDeletions.add(key);
    }

    debug(`Suppress Bloodied | Removing ${idsToDelete.length} bloodied effect(s) from dead actor "${actor.name}"`);
    try {
        await actor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
    } catch (err) {
        const msg = err?.message || String(err);
        if (!msg.includes("does not exist")) {
            debug(`Suppress Bloodied | Note while deleting bloodied effect from "${actor.name}": ${msg}`);
        }
    } finally {
        for (const key of keysToDelete) {
            _pendingBloodiedDeletions.delete(key);
        }
    }
}

/**
 * Initialize the Suppress Bloodied on Dead Tokens feature.
 */
export function initSuppressBloodiedDead() {
    // 1. Patch ActiveEffect5e.prototype.isSuppressed with re-entrancy protection.
    // This getter runs for every effect whenever `effect.active` is read, so the cheap
    // bloodied check comes first and the re-entrancy flag is only touched for bloodied effects.
    patchMethod("CONFIG.ActiveEffect.documentClass.prototype.isSuppressed#get", function patchedIsSuppressed(wrapped) {
        if (wrapped()) return true;
        if (!isBloodiedEffect(this)) return false;
        if (!getSetting("enableSuppressBloodiedWhileDead")) return false;

        // isActorDead() reads `active` on sibling effects (including this one), which re-enters this getter.
        if (this._suppressCheckActive) return false;
        this._suppressCheckActive = true;
        try {
            const actor = this.target ?? this.parent;
            return actor instanceof Actor && (isActorDead(actor) || willActorBeDead(actor));
        } finally {
            this._suppressCheckActive = false;
        }
    }, "MIXED");

    // 2. Patch Actor5e.prototype.updateBloodied
    patchMethod("CONFIG.Actor.documentClass.prototype.updateBloodied", function patchedUpdateBloodied(wrapped, options) {
        if (getSetting("enableSuppressBloodiedWhileDead")) {
            if (isActorDead(this) || willActorBeDead(this)) {
                removeBloodiedEffect(this);
                return;
            }
        }
        return wrapped(options);
    }, "MIXED");

    // 3. Pre-create hook: block creating bloodied on dead or dying actors
    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
        if (!getSetting("enableSuppressBloodiedWhileDead")) return;
        if (!isBloodiedEffect(effect)) return;
        const actor = effect.parent;
        if (actor instanceof Actor && (isActorDead(actor) || willActorBeDead(actor))) {
            debug(`Suppress Bloodied | Preventing creation of bloodied effect on dead/dying actor "${actor.name}"`);
            return false;
        }
    });

    // 4. Hook createActiveEffect: when "dead" is created, delete bloodied
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        if (!getSetting("enableSuppressBloodiedWhileDead")) return;
        if (!game.user.isActiveGM) return;
        if (!effect.statuses?.has("dead")) return;

        const actor = effect.parent;
        if (actor instanceof Actor) {
            removeBloodiedEffect(actor);
        }
    });

    // 5. Hook deleteActiveEffect: when "dead" is deleted, re-evaluate bloodied
    Hooks.on("deleteActiveEffect", (effect, options, userId) => {
        if (!getSetting("enableSuppressBloodiedWhileDead")) return;
        if (!game.user.isActiveGM) return;
        if (!effect.statuses?.has("dead")) return;

        const actor = effect.parent;
        if (actor instanceof Actor && typeof actor.updateBloodied === "function") {
            // Re-evaluate bloodied if still <= 50% HP and not dead
            if (!isActorDead(actor)) {
                actor.updateBloodied();
            }
        }
    });

    // 6. Hook updateActor: if actor has dead status, clean up any lingering bloodied
    Hooks.on("updateActor", (actor, changes, options, userId) => {
        if (!getSetting("enableSuppressBloodiedWhileDead")) return;
        if (!game.user.isActiveGM) return;

        if (isActorDead(actor)) {
            const hasBloodied = actor.effects?.some(e => isBloodiedEffect(e));
            if (hasBloodied) {
                removeBloodiedEffect(actor);
            }
        }
    });

    debug("Suppress Bloodied on Dead | Initialized");
}
