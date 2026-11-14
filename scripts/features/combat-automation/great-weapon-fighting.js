/**
 * Feature: Great Weapon Fighting
 * Description: Applies the Great Weapon Fighting fighting style automatically to the weapon's damage dice of melee
 * weapon attacks made with two hands: 2024 treats every 1 or 2 as a 3, 2014 rerolls each 1 or 2 once. Part of
 * Conditional Damage Bonuses, but without a toggle: there is never a reason not to use it.
 *
 * @introduced v14.83.0
 */
import { isFeatureActive, log, debug } from "../../context.js";
import { isModernRules } from "./conditional-damage.js";

/**
 * Great Weapon Fighting
 * ---------------------------------------------------------------------------
 * Feature items (dnd5e SRD 2014 class feature, dnd5e and PHB module 2024 feat) all use the identifier
 * `great-weapon-fighting` and carry no effects; `system.source.rules` says which rules they follow ("2014"/"2024").
 * Items without it follow the world's rules version.
 *
 * Foundry dice already implement both rules: `r<3` rerolls a 1 or 2 once and keeps the new roll (`Die#reroll`,
 * `recursive: false`), `min3` raises 1s and 2s to 3 (`Die#minimum`).
 *
 * Only the weapon's own damage dice benefit (Sage Advice / 2024 rules FAQ: not Divine Smite, Hex, Sneak Attack …).
 * In dnd5e (6.0.6 and 6.1.0) the base damage roll's first part is the weapon's dice (`_processDamagePart`, versatile
 * dice already swapped in for two-handed attacks); `@mod` and actor damage bonuses are later parts. So the modifier is
 * appended to the dice of that first part in `dnd5e.preRollDamage`, before the dialog builds the rolls:
 *   - Critical hits: DamageRoll scales in its constructor and clones modified dice with their modifiers, so the extra
 *     critical dice (and Brutal Critical / Savage Attacks dice, which copy the first term) keep the modifier.
 *   - Savage Attacker: Conditional Damage copies the parts into `_nd5tOriginalParts` in its own `preRollDamage` and
 *     builds `{2d6min3, 2d6min3}kh` from them, so this hook must run first (registered before `initConditionalDamage`).
 *   - Conditional bonus rolls (Sneak Attack, Hex, …) are separate rolls and stay untouched.
 *
 * Two hands: dnd5e offers the "twoHanded" attack mode only for Two-Handed or Versatile weapons, and the chat card's
 * damage button passes the attack's mode on (`config.attackMode`, also `roll.attack.mode` in the roll data). Without an
 * attack mode, only Two-Handed weapons qualify (a Versatile weapon may have been held in one hand).
 */

const IDENTIFIER = "great-weapon-fighting";
const NAME_PATTERN = /^(?:fighting style:\s*)?great weapon fighting$/i;

/** Literal dice with their modifiers, e.g. "2d6", "1d10", "1d8r1". Not "@scale…" references. */
const DICE_PATTERN = /\b(\d+d\d+)((?:[a-z]+[<>=]*\d*)*)/gi;

/**
 * The actor's Great Weapon Fighting item, if any.
 * @param {Actor5e} actor
 * @returns {Item5e|null}
 */
function getGreatWeaponFightingItem(actor) {
    return actor?.items?.find(item => (item.type === "feat")
        && ((item.system?.identifier === IDENTIFIER) || NAME_PATTERN.test(item.name?.trim() ?? ""))) ?? null;
}

/**
 * Whether the feature follows the 2024 rules: its own source rules, else the world's rules version.
 * @param {Item5e} item
 * @returns {boolean}
 */
function isModernFeature(item) {
    const rules = item?.system?.source?.rules;
    if (rules === "2024") return true;
    if (rules === "2014") return false;
    return isModernRules();
}

/**
 * Whether this damage roll is for a melee weapon attack made with two hands.
 * @param {object} config   Damage roll process configuration
 * @returns {boolean}
 */
function isEligibleAttack(config) {
    const activity = config?.subject;
    if (activity?.type !== "attack") return false;
    const item = activity.item;
    if (item?.type !== "weapon") return false;

    const properties = item.system?.properties;
    const hasTwoHanded = Boolean(properties?.has?.("two"));
    const isVersatile = Boolean(item.system?.isVersatile ?? properties?.has?.("ver"));
    if (!hasTwoHanded && !isVersatile) return false;

    const attackMode = config.attackMode ?? config.rolls?.[0]?.data?.roll?.attack?.mode ?? null;
    const actionType = activity.getActionType?.(attackMode) ?? activity.actionType;
    if (actionType !== "mwak") return false;

    if (attackMode) return attackMode === "twoHanded";
    return hasTwoHanded;
}

/**
 * Append the modifier to every literal die in a formula part. Dice that can't roll above 2 and dice that already
 * reroll or have a minimum are left alone.
 * @param {string} part
 * @param {string} modifier   "min3" or "r<3"
 * @returns {string}
 */
export function applyGreatWeaponFightingToPart(part, modifier) {
    if (typeof part !== "string") return part;
    return part.replace(DICE_PATTERN, (match, dice, mods) => {
        const faces = Number(dice.split(/d/i)[1]);
        if (!(faces > 2)) return match;
        // "r"/"rr" (reroll) and "min" are the only Foundry die modifiers containing these letters
        if (/min|r/i.test(mods)) return match;
        return `${dice}${mods}${modifier}`;
    });
}

/**
 * Hook handler for `dnd5e.preRollDamage`.
 * @param {object} config   Damage roll process configuration
 */
function onPreRollDamage(config) {
    try {
        if (config?.hookNames && !config.hookNames.includes("damage")) return;
        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
        const actor = config?.subject?.actor;
        const feature = getGreatWeaponFightingItem(actor);
        if (!feature || !isEligibleAttack(config)) return;

        const baseRoll = config.rolls?.find(r => r.base) ?? config.rolls?.[0];
        if (!baseRoll?.parts?.length || baseRoll.options?.nd5tGreatWeaponFighting) return;

        const modern = isModernFeature(feature);
        const modifier = modern ? "min3" : "r<3";
        const weaponPart = applyGreatWeaponFightingToPart(baseRoll.parts[0], modifier);
        if (weaponPart === baseRoll.parts[0]) return;

        baseRoll.parts = [weaponPart, ...baseRoll.parts.slice(1)];
        baseRoll.options ??= {};
        baseRoll.options.nd5tGreatWeaponFighting = modern ? "2024" : "2014";
        debug(`Great Weapon Fighting (${modern ? "2024" : "2014"}): ${actor.name}'s ${config.subject.item.name} rolls ${weaponPart}`);
    } catch (err) {
        console.error("niks-dnd5e-tweaks | Great Weapon Fighting failed", err);
    }
}

/** Must be called before `initConditionalDamage`, so Savage Attacker builds its dice pool from the modified dice. */
export function initGreatWeaponFighting() {
    Hooks.on("dnd5e.preRollDamage", onPreRollDamage);
    log("Great Weapon Fighting | Hooked dnd5e.preRollDamage.");
}
