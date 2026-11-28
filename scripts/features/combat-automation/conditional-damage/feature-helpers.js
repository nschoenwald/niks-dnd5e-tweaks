/**
 * Conditional Damage Bonuses: Helpers shared by the class feature, species and spell bonuses (feature lookup, scale values, resources).
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, debug } from "../../../context.js";
import { resolveAttackForDamage } from "./attack-cache.js";

/** Identifier of an item, lower case. */
export function identifierOf(item) {
    return (item?.system?.identifier || item?.identifier || "").toLowerCase();
}

/**
 * Find a feature item on an actor by identifier, or by an anchored name pattern for items without one.
 *
 * @param {Actor5e|null} actor
 * @param {string[]} identifiers
 * @param {RegExp|null} [namePattern=null]
 * @param {(item: Item5e) => boolean} [filter]
 * @returns {Item5e|null}
 */
export function findFeature(actor, identifiers, namePattern = null, filter = () => true) {
    if (!actor?.items) return null;
    return actor.items.find(i => (i.type === "feat") && filter(i)
        && (identifiers.includes(identifierOf(i))
            || Boolean(namePattern?.test((i.name || "").replace(/[‘’`]/g, "'").trim())))) ?? null;
}

/**
 * The original actor of a polymorphed (wild shaped) actor. Its features, levels and scale values still count.
 *
 * @param {Actor5e} actor
 * @returns {Actor5e|null}
 */
export function originalActor(actor) {
    if (!actor?.isPolymorphed) return null;
    const id = actor.getFlag?.("dnd5e", "originalActor");
    return id ? (game.actors?.get(id) ?? null) : null;
}

/**
 * Levels in a class, by class identifier.
 *
 * @param {Actor5e|null} actor
 * @param {string} identifier
 * @returns {number}
 */
export function classLevels(actor, identifier) {
    return Number(actor?.classes?.[identifier]?.system?.levels ?? 0);
}

/**
 * Number of faces of a dice scale value (e.g. `@scale.monk.die`), or the fallback.
 *
 * @param {Actor5e|null} actor
 * @param {string} group  Identifier of the class, subclass or feature holding the scale value.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
export function scaleDieFaces(actor, group, key, fallback) {
    const faces = Number(actor?.system?.scale?.[group]?.[key]?.faces);
    return (faces > 0) ? faces : fallback;
}

/**
 * Join a dice formula and a flat modifier, each tagged with the bonus's flavor.
 *
 * @param {string} dice
 * @param {number} mod
 * @param {string} flavor
 * @returns {{ formula: string, display: string }}
 */
export function diceWithMod(dice, mod, flavor) {
    if (!mod) return { formula: `${dice}[${flavor}]`, display: dice };
    const sign = mod < 0 ? "-" : "+";
    return {
        formula: `${dice}[${flavor}] ${sign} ${Math.abs(mod)}[${flavor}]`,
        display: `${dice} ${sign} ${Math.abs(mod)}`
    };
}

/**
 * Whether an active effect on the actor belongs to a feature: matched by name, or (for effects applied by an
 * activity, not passive ones) by the identifier of the item it came from.
 *
 * @param {Actor5e} actor
 * @param {string[]} identifiers
 * @param {RegExp} namePattern
 * @returns {ActiveEffect[]}
 */
export function activeFeatureEffects(actor, identifiers, namePattern) {
    const effects = actor?.appliedEffects ?? [];
    return effects.filter(e => {
        if (e.disabled || e.isSuppressed) return false;
        if (namePattern.test((e.name || "").trim())) return true;
        if (e.transfer || !e.origin) return false;
        try {
            const origin = fromUuidSync(e.origin, { strict: false });
            const item = (origin instanceof Item) ? origin : (origin?.item ?? null);
            return identifiers.includes(identifierOf(item));
        } catch {
            return false;
        }
    });
}

/**
 * Whether the actor is raging (an active Rage effect).
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isActorRaging(actor) {
    return activeFeatureEffects(actor, ["rage"], /^(?:rage|raging)$/i).length > 0;
}

/**
 * Whether an activity is an attack (weapon, unarmed or spell attack).
 *
 * @param {Activity|null} activity
 * @returns {boolean}
 */
export function isAttackActivity(activity) {
    return activity?.type === "attack" || ["mwak", "rwak", "msak", "rsak"].includes(activity?.actionType ?? "");
}

/**
 * Whether the attack is an Unarmed Strike.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} activity
 * @returns {boolean}
 */
export function isUnarmedStrike(item, activity) {
    return activity?.attack?.type?.classification === "unarmed"
        || identifierOf(item).includes("unarmed-strike")
        || (item?.name || "").toLowerCase().includes("unarmed strike");
}

/**
 * Whether a weapon is the warlock's pact weapon: it carries the Pact Weapon enchantment from Pact of the Blade.
 *
 * @param {Item5e|null} item
 * @param {Actor5e|null} [actor=null]
 * @returns {boolean}
 */
export function isPactWeapon(item, actor = null) {
    if (item?.type !== "weapon") return false;
    const pact = findFeature(actor ?? item.actor, ["pact-of-the-blade"], /^pact of the blade$/i);
    for (const effect of item.effects ?? []) {
        if ((effect.type !== "enchantment") || effect.disabled || (effect.isAppliedEnchantment === false)) continue;
        if (/pact weapon/i.test(effect.name ?? "")) return true;
        if (pact && (typeof effect.origin === "string") && effect.origin.includes(`.Item.${pact.id}`)) return true;
    }
    return false;
}

/**
 * The resource of a feature that costs uses. Items with uses configured are spent when the bonus is ticked; items
 * without (homebrew, hand-made items) are still offered, but nothing is spent and the label says so.
 *
 * @param {Item5e|null} item
 * @returns {{available: boolean, tracked: boolean, usesLeft: number|null, consume: object|null}|null}
 */
export function resource(item) {
    if (!item) return null;
    const left = _usesLeft(item);
    if (left === null) return { available: true, tracked: false, usesLeft: null, consume: null };
    return {
        available: left > 0,
        tracked: true,
        usesLeft: left,
        consume: { type: "itemUses", itemId: item.id, actor: item.actor }
    };
}

/**
 * The "uses" part of a resource bonus's label: "3 left", "3 Focus left" or "uses not tracked".
 *
 * @param {{usesLeft?: number|null, usesTracked?: boolean, usesUnit?: string}} bonus
 * @returns {string}
 */
export function usesText(bonus) {
    const i18n = game.i18n;
    if (bonus?.usesTracked === false) {
        return i18n?.has("ND5T.ConditionalDamage.UsesNotTracked") ? i18n.localize("ND5T.ConditionalDamage.UsesNotTracked") : "uses not tracked";
    }
    const count = bonus?.usesLeft ?? 0;
    const key = (bonus?.usesUnit === "focus") ? "ND5T.ConditionalDamage.FocusLeft" : "ND5T.ConditionalDamage.UsesLeft";
    if (i18n?.has(key)) return i18n.format(key, { count });
    return (bonus?.usesUnit === "focus") ? `${count} Focus left` : `${count} left`;
}

/**
 * Faces of a class's die from its level, for when the scale value is missing (2024 tables: Martial Arts die,
 * Psionic Energy Die).
 *
 * @param {number} level
 * @param {number[][]} table  [[minLevel, faces], …], ascending.
 * @returns {number}
 */
export function facesByLevel(level, table) {
    let faces = table[0][1];
    for (const [min, value] of table) if (level >= min) faces = value;
    return faces;
}

export const MARTIAL_ARTS_DIE = [[1, 6], [5, 8], [11, 10], [17, 12]];

export const PSIONIC_ENERGY_DIE = [[1, 6], [5, 8], [11, 10], [17, 12]];

export const RAGE_DAMAGE = [[1, 2], [9, 3], [16, 4]];

/**
 * Uses left on an item with limited uses, or null if it has none.
 *
 * @param {Item5e|null} item
 * @returns {number|null}
 */
function _usesLeft(item) {
    const uses = item?.system?.uses;
    if (!uses || !(Number(uses.max) > 0)) return null;
    return Math.max(0, Number(uses.value ?? 0));
}

/**
 * Token documents targeted by the attack behind this damage roll (or the user's targets).
 *
 * @param {Actor5e} actor
 * @param {object} context
 * @returns {TokenDocument[]}
 */
export function resolveTargetDocs(actor, { config, dialog, message, activity } = {}) {
    let uuids = resolveAttackForDamage(actor, { config, dialog, message, activity })?.targets ?? [];
    if (!uuids.length) {
        uuids = (message?.data?.system?.targets ?? message?.system?.targets ?? []).map(t => t?.token).filter(Boolean);
    }
    if (!uuids.length) uuids = Array.from(game.user?.targets ?? [], t => t.document?.uuid).filter(Boolean);
    return uuids.map(uuid => {
        try {
            return fromUuidSync(uuid, { strict: false });
        } catch {
            return null;
        }
    }).filter(doc => doc?.actor);
}

/**
 * Spend the resource of a bonus that costs one (item uses or a Pact Magic slot) once its roll is made.
 *
 * @param {object} bonus
 */
export async function consumeBonusResource(bonus) {
    const actor = bonus?.actor;
    const consume = bonus?.consume;
    if (!actor || !consume) return;
    try {
        if (consume.type === "pactSlot") {
            const value = Number(actor.system?.spells?.pact?.value ?? 0);
            if (value > 0) await actor.update({ "system.spells.pact.value": value - 1 });
        } else if (consume.type === "itemUses") {
            const item = consume.actor?.items?.get(consume.itemId) ?? actor.items?.get(consume.itemId);
            const uses = item?.system?.uses;
            if (uses && (Number(uses.value ?? 0) > 0)) {
                await item.update({ "system.uses.spent": Number(uses.spent ?? 0) + 1 });
            }
        }
        debug(`Conditional Damage | ${bonus.spellName}: spent ${consume.type === "pactSlot" ? "a Pact Magic slot" : "1 use"}.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Conditional Damage: could not spend the resource of ${bonus.spellName}`, err);
    }
}

/**
 * Whether a bonus of this kind follows the weapon's damage type and properties (magical, silvered …).
 *
 * @param {object} bonus
 * @returns {boolean}
 */
export function matchesWeaponType(bonus) {
    return Boolean(bonus?.matchWeaponType)
        || ["sneakAttack", "greatWeaponMaster", "brutalStrike", "charger", "boonOfIrresistibleOffense"].includes(bonus?.id);
}

/**
 * Whether the actor is Bloodied (the system's status, or at half its hit points or fewer).
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isBloodied(actor) {
    if (actor?.statuses?.has("bloodied")) return true;
    const hp = actor?.system?.attributes?.hp;
    return Boolean(hp && (Number(hp.max) > 0) && (Number(hp.value) > 0) && (Number(hp.value) <= (Number(hp.max) / 2)));
}

/**
 * Faces of the first literal die in the roll parts of a damage type, or null.
 *
 * @param {object} config  Damage roll process configuration.
 * @param {string} type
 * @returns {number|null}
 */
export function firstDieFacesOfType(config, type) {
    for (const roll of config?.rolls ?? []) {
        if (roll?.options?._nd5tConditionalId) continue;
        const types = roll?.options?.types ?? (roll?.options?.type ? [roll.options.type] : []);
        if (!types.includes(type)) continue;
        for (const part of roll.parts ?? []) {
            const match = (typeof part === "string") ? part.match(/\b\d+d(\d+)/i) : null;
            if (match) return Number(match[1]);
        }
    }
    return null;
}

/**
 * Whether the actor has an active effect with this name that comes from a feature or spell with one of these
 * identifiers (effects with generic names such as "Havoc" or "Cursed" are only trusted with the right origin).
 * Effects without a resolvable origin count when the actor has such an item.
 *
 * @param {Actor5e} actor
 * @param {RegExp} namePattern
 * @param {string[]} identifiers
 * @param {Actor5e} [originActor]  Only effects created by this actor's item (target curses).
 * @returns {ActiveEffect[]}
 */
export function effectsFrom(actor, namePattern, identifiers, originActor = null) {
    const ownerHasItem = owner => Boolean(owner?.items?.some(i => identifiers.includes(identifierOf(i))));
    return (actor?.appliedEffects ?? []).filter(e => {
        if (e.disabled || e.isSuppressed || !namePattern.test((e.name || "").trim())) return false;
        let item = null;
        if (e.origin) {
            const origin = safeUuid(e.origin);
            item = (origin instanceof Item) ? origin : (origin?.item ?? (origin?.parent instanceof Item ? origin.parent : null));
        }
        if (item) {
            if (!identifiers.includes(identifierOf(item))) return false;
            return !originActor || (item.actor === originActor) || (item.actor?.uuid === originActor.uuid);
        }
        return ownerHasItem(originActor ?? actor);
    });
}

/**
 * fromUuidSync that never throws.
 * @param {string} uuid
 * @returns {object|null}
 */
export function safeUuid(uuid) {
    try {
        return fromUuidSync(uuid, { strict: false }) ?? null;
    } catch {
        return null;
    }
}

/**
 * Size rank of a creature (index in CONFIG.DND5E.actorSizes), or null.
 * @param {Actor5e} actor
 * @returns {number|null}
 */
export function sizeRank(actor) {
    const keys = Object.keys(CONFIG.DND5E?.actorSizes ?? {});
    const index = keys.indexOf(actor?.system?.traits?.size);
    return index >= 0 ? index : null;
}

/**
 * Damage types of a damage roll's own parts (not conditional bonus rolls).
 *
 * @param {object} config
 * @param {boolean} [anyChoice=false]  Also count types a part only offers in its dropdown.
 * @returns {Set<string>}
 */
export function getRollTypes(config, anyChoice = false) {
    const types = new Set();
    for (const roll of config?.rolls ?? []) {
        if (roll?.options?._nd5tConditionalId) continue;
        const list = (anyChoice || !roll?.options?.type) ? (roll?.options?.types ?? []) : [];
        for (const type of [roll?.options?.type, ...list]) if (type) types.add(type);
    }
    return types;
}
