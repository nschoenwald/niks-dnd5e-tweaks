/**
 * Conditional Damage Bonuses: Remembered toggle choices and damage types per actor.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, debug } from "../../../context.js";

/**
 * In-memory fallback cache for actor choices (keyed by actor UUID/ID -> { [bonusId]: boolean }).
 * Guarantees zero-latency and persistence for unlinked synthetic tokens, permission edge cases,
 * or compendium actors.
 * @type {Map<string, Record<string, boolean>>}
 */
const _actorChoiceMemory = new Map();

/**
 * The damage type the actor picked last for a bonus with a type dropdown, or null if none was picked yet.
 * Stored as `conditionalDamage.<bonusId>Type` (Genie's Wrath: `geniesWrathType`).
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string[]} allowed  Types the bonus offers.
 * @returns {string|null}
 */
export function getActorBonusType(actor, bonusId, allowed) {
    if (!actor) return null;
    const key = `${bonusId}Type`;
    const memType = _actorChoiceMemory.get(actor.uuid || actor.id)?.[key];
    if (allowed.includes(memType)) return memType;
    const flagType = actor.getFlag?.(MODULE_ID, `conditionalDamage.${key}`);
    return allowed.includes(flagType) ? flagType : null;
}

/**
 * Remember the damage type picked for a bonus with a type dropdown.
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string} type
 * @param {string[]} allowed
 */
export async function setActorBonusType(actor, bonusId, type, allowed) {
    if (!actor || !allowed?.includes(type)) return;
    const key = `${bonusId}Type`;
    const memKey = actor.uuid || actor.id;
    const existingMem = _actorChoiceMemory.get(memKey) ?? {};
    existingMem[key] = type;
    _actorChoiceMemory.set(memKey, existingMem);
    try {
        if (actor.getFlag?.(MODULE_ID, `conditionalDamage.${key}`) === type) return;
        if (actor.isOwner && !actor.inCompendium && actor.setFlag) {
            await actor.setFlag(MODULE_ID, `conditionalDamage.${key}`, type);
        }
    } catch (err) {
        debug(`Conditional Damage | Could not persist ${bonusId} type on actor "${actor.name}":`, err);
    }
}

/**
 * Retrieve the actor's last saved toggle state for a conditional bonus.
 * Checks immediate in-memory cache first to eliminate race conditions with pending async database operations,
 * falling back to document flags and finally the default value.
 *
 * @param {Actor5e} actor
 * @param {string} bonusId
 * @param {boolean} [defaultVal=true]
 * @returns {boolean}
 */
export function getActorConditionalPreference(actor, bonusId, defaultVal = true) {
    if (bonusId === "boonOfIrresistibleOffense") return true;
    if (!actor || bonusId === "cleave" || bonusId === "brutalStrike" || bonusId === "charger" || bonusId === "savageAttacker") return false;
    if (bonusId === "greatWeaponMaster") {
        // Great Weapon Master defaults to enabled on rolls unless explicitly toggled off in memory for that action
        const key = actor.uuid || actor.id;
        const memObj = _actorChoiceMemory.get(key);
        if (memObj && typeof memObj[bonusId] === "boolean") return memObj[bonusId];
        return true;
    }
    const key = actor.uuid || actor.id;

    const memObj = _actorChoiceMemory.get(key);
    if (memObj && typeof memObj[bonusId] === "boolean") return memObj[bonusId];

    const flagVal = actor.getFlag?.(MODULE_ID, `conditionalDamage.${bonusId}`);
    if (typeof flagVal === "boolean") return flagVal;

    return defaultVal;
}

/**
 * Persist the actor's toggle state for a conditional bonus.
 * Keyed by actor UUID to prevent cross-token bleed between unlinked synthetic tokens.
 *
 * @param {Actor5e} actor
 * @param {string} bonusId
 * @param {boolean} active
 */
export async function setActorConditionalPreference(actor, bonusId, active) {
    if (!actor || bonusId === "cleave" || bonusId === "brutalStrike" || bonusId === "charger" || bonusId === "savageAttacker" || bonusId === "boonOfIrresistibleOffense") return;
    const key = actor.uuid || actor.id;

    // Update in-memory cache immediately
    const existingMem = _actorChoiceMemory.get(key) ?? {};
    existingMem[bonusId] = Boolean(active);
    _actorChoiceMemory.set(key, existingMem);

    // Persist to document flag if actor is editable / owned (skip redundant DB writes when unchanged)
    try {
        if (actor.getFlag?.(MODULE_ID, `conditionalDamage.${bonusId}`) === Boolean(active)) return;
        if (actor.isOwner && !actor.inCompendium && actor.setFlag) {
            await actor.setFlag(MODULE_ID, `conditionalDamage.${bonusId}`, Boolean(active));
        }
    } catch (err) {
        debug(`Conditional Damage | Could not persist flag on actor "${actor.name}":`, err);
    }
}
