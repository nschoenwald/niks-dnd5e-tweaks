import { MODULE_ID, log, debug } from "../main.js";

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
    const bloodiedId = CONFIG.ActiveEffect?.documentClass?.ID?.BLOODIED ?? "dnd5ebloodied";
    return effect.id === bloodiedId
        || effect.id === "dnd5ebloodied"
        || effect.id === "dnd5ebloodied000"
        || effect.statuses?.has("bloodied")
        || effect.getFlag?.("dnd5e", "statusId") === "bloodied";
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
    return actor.effects?.some(e => !e.disabled && e.statuses?.has("dead")) ?? false;
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
    if (game.settings.get(MODULE_ID, "enableAutoStatusZeroHP")) {
        const isPlayer = actor.type === "character" || actor.hasPlayerOwner;
        const statusKey = isPlayer ? "autoStatusZeroHP_playerStatus" : "autoStatusZeroHP_npcStatus";
        const configuredStatus = game.settings.get(MODULE_ID, statusKey);
        const failedDeathSaves = (actor.system.attributes?.death?.failure ?? 0) >= 3;
        if (configuredStatus === "dead" || failedDeathSaves) return true;
        if (configuredStatus !== "none") return false;
    }

    // Default DnD5e behavior at 0 HP
    if (actor.type === "npc") {
        if (!actor.system?.traits?.important) return true;
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
    const ActiveEffect5e = CONFIG.ActiveEffect?.documentClass;
    const Actor5e = CONFIG.Actor?.documentClass;

    // 1. Patch ActiveEffect5e.prototype.isSuppressed with re-entrancy protection
    if (ActiveEffect5e?.prototype) {
        let descriptor = null;
        let proto = ActiveEffect5e.prototype;
        while (!descriptor && proto) {
            descriptor = Object.getOwnPropertyDescriptor(proto, "isSuppressed");
            if (!descriptor) proto = Object.getPrototypeOf(proto);
        }

        if (descriptor?.get) {
            const originalIsSuppressed = descriptor.get;
            Object.defineProperty(ActiveEffect5e.prototype, "isSuppressed", {
                get() {
                    if (this._suppressCheckActive) return false;
                    this._suppressCheckActive = true;
                    try {
                        if (originalIsSuppressed.call(this)) return true;
                        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return false;

                        if (isBloodiedEffect(this)) {
                            const actor = this.target ?? this.parent;
                            if (actor instanceof Actor && (isActorDead(actor) || willActorBeDead(actor))) {
                                return true;
                            }
                        }
                        return false;
                    } finally {
                        this._suppressCheckActive = false;
                    }
                },
                configurable: true,
                enumerable: descriptor.enumerable
            });
        }
    }

    // 2. Patch Actor5e.prototype.updateBloodied
    if (Actor5e?.prototype?.updateBloodied) {
        const originalUpdateBloodied = Actor5e.prototype.updateBloodied;
        Actor5e.prototype.updateBloodied = function(options) {
            if (game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) {
                if (isActorDead(this) || willActorBeDead(this)) {
                    removeBloodiedEffect(this);
                    return;
                }
            }
            return originalUpdateBloodied.call(this, options);
        };
    }

    // 3. Pre-create hook: block creating bloodied on dead or dying actors
    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
        if (!isBloodiedEffect(effect)) return;
        const actor = effect.parent;
        if (actor instanceof Actor && (isActorDead(actor) || willActorBeDead(actor))) {
            debug(`Suppress Bloodied | Preventing creation of bloodied effect on dead/dying actor "${actor.name}"`);
            return false;
        }
    });

    // 4. Hook createActiveEffect: when "dead" is created, delete bloodied
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
        if (!game.user.isActiveGM) return;
        if (!effect.statuses?.has("dead")) return;

        const actor = effect.parent;
        if (actor instanceof Actor) {
            removeBloodiedEffect(actor);
        }
    });

    // 5. Hook deleteActiveEffect: when "dead" is deleted, re-evaluate bloodied
    Hooks.on("deleteActiveEffect", (effect, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
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
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
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
