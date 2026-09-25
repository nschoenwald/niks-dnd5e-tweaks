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
 *    actor that currently has the dead condition.
 * 2. Patches `Actor5e.prototype.updateBloodied` so the bloodied effect is removed and
 *    prevented from generating while the actor is dead.
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
        || effect.statuses?.has("bloodied")
        || effect.getFlag?.("dnd5e", "statusId") === "bloodied";
}

/**
 * Check whether an actor currently has the dead condition.
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isActorDead(actor) {
    if (!actor) return false;
    if (actor.statuses?.has("dead")) return true;
    return actor.effects?.some(e => !e.disabled && !e.isSuppressed && e.statuses?.has("dead")) ?? false;
}

/**
 * Remove bloodied active effects from an actor.
 *
 * @param {Actor5e} actor
 */
export async function removeBloodiedEffect(actor) {
    if (!actor?.effects) return;
    const bloodiedId = CONFIG.ActiveEffect?.documentClass?.ID?.BLOODIED ?? "dnd5ebloodied";
    const bloodiedEffects = actor.effects.filter(e =>
        e.id === bloodiedId || e.statuses?.has("bloodied")
    );

    if (bloodiedEffects.length > 0) {
        debug(`Suppress Bloodied | Removing ${bloodiedEffects.length} bloodied effect(s) from dead actor "${actor.name}"`);
        try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", bloodiedEffects.map(e => e.id));
        } catch (err) {
            debug(`Suppress Bloodied | Could not delete bloodied effect from "${actor.name}":`, err);
        }
    }
}

/**
 * Initialize the Suppress Bloodied on Dead Tokens feature.
 */
export function initSuppressBloodiedDead() {
    const ActiveEffect5e = CONFIG.ActiveEffect?.documentClass;
    const Actor5e = CONFIG.Actor?.documentClass;

    // 1. Patch ActiveEffect5e.prototype.isSuppressed
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
                    if (originalIsSuppressed.call(this)) return true;
                    if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return false;

                    if (isBloodiedEffect(this)) {
                        const actor = this.target ?? this.parent;
                        if (actor instanceof Actor && isActorDead(actor)) {
                            return true;
                        }
                    }
                    return false;
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
                if (isActorDead(this)) {
                    const bloodiedId = CONFIG.ActiveEffect?.documentClass?.ID?.BLOODIED ?? "dnd5ebloodied";
                    const effect = this.effects.get(bloodiedId)
                        ?? this.effects.find(e => e.statuses?.has("bloodied"));
                    if (effect) return effect.delete();
                    return;
                }
            }
            return originalUpdateBloodied.call(this, options);
        };
    }

    // 3. Pre-create hook: block creating bloodied on dead actors
    Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
        if (!isBloodiedEffect(effect)) return;
        const actor = effect.parent;
        if (actor instanceof Actor && isActorDead(actor)) {
            debug(`Suppress Bloodied | Preventing creation of bloodied effect on dead actor "${actor.name}"`);
            return false;
        }
    });

    // 4. Hook createActiveEffect: when "dead" is created, delete bloodied
    Hooks.on("createActiveEffect", (effect, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
        if (!game.users.activeGM?.isSelf) return;
        if (!effect.statuses?.has("dead")) return;

        const actor = effect.parent;
        if (actor instanceof Actor) {
            removeBloodiedEffect(actor);
        }
    });

    // 5. Hook deleteActiveEffect: when "dead" is deleted, re-evaluate bloodied
    Hooks.on("deleteActiveEffect", (effect, options, userId) => {
        if (!game.settings.get(MODULE_ID, "enableSuppressBloodiedWhileDead")) return;
        if (!game.users.activeGM?.isSelf) return;
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
        if (!game.users.activeGM?.isSelf) return;

        if (isActorDead(actor)) {
            const hasBloodied = actor.effects?.some(e => isBloodiedEffect(e));
            if (hasBloodied) {
                removeBloodiedEffect(actor);
            }
        }
    });

    debug("Suppress Bloodied on Dead | Initialized");
}
