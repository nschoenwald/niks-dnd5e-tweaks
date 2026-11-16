/**
 * Feature: Intelligence for Weapon Attacks (Bladesong & Battle Ready)
 * Description: Weapon attacks that may use Intelligence instead of Strength or Dexterity use it automatically whenever
 *              its modifier is the highest, and the attack roll dialog offers it:
 *              - Bladesong (Bladesinger, 2024 rules, Heroes of Faerûn): weapons the character is proficient with,
 *                while Bladesong is active.
 *              - Battle Ready (Battle Smith Artificer, Arcane Empowerment): magic weapons.
 *
 * @introduced v14.94.0
 * @updated v14.95.0 (Battle Ready: Intelligence for magic weapons)
 */
import { isFeatureActive, log, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isModernRules } from "./conditional-damage.js";

/**
 * Bladesong Bladework
 * ---------------------------------------------------------------------------
 * Bladework (2024): "Whenever you attack with a weapon with which you have proficiency, you can use your Intelligence
 * modifier for the attack and damage rolls instead of using Strength or Dexterity." The Heroes of Faerûn item (identifier
 * `bladesong`, source rules 2024) only changes AC, speed, Acrobatics and Concentration; its note leaves the attack
 * ability to the user. The 2014 Bladesong has no such benefit, so the feature's own rules version decides (items
 * without one follow the world's rules).
 *
 * dnd5e (6.0.6 and 6.1.0) collects the abilities an attack may use in `AttackActivity#prepareFinalData`: the fixed
 * ability, or the weapon's available abilities (Strength, Dexterity, both for finesse) into the non-persisted
 * `attack.abilities` set, which starts empty on every data preparation. `AttackActivity#ability` then picks the one
 * with the highest modifier, and the roll dialog lists all of them. Adding "int" to the set *before* the original
 * runs therefore:
 *  - uses Intelligence automatically when it's the best modifier (attack and damage, both read `activity.ability`),
 *  - keeps Strength / Dexterity when they're better,
 *  - shows the right to-hit and damage on the sheet (the labels are computed in the same method).
 * The actor re-prepares its items whenever an effect changes, so turning Bladesong on or off updates it at once.
 *
 * Only weapons (not Unarmed Strikes, natural weapons or spell attacks), only attacks that would use Strength or
 * Dexterity (not "none" or "spellcasting", e.g. a Pact Weapon), and only with proficiency.
 *
 * Battle Ready (Battle Smith, Forge of the Artificer 2024 and Tasha's 2014 alike): "When you attack with a magic
 * weapon, you can use your Intelligence modifier, instead of your Strength or Dexterity modifier, for the attack and
 * damage rolls." No proficiency or active effect needed; magic = the weapon's `mgc` property. The Forge item (identifier
 * `battle-ready`) ships an "Arcane Empowerment" enchantment that fixes the weapon's attack ability to Intelligence;
 * such a weapon no longer uses Strength / Dexterity and is left alone.
 */

const IDENTIFIER = "bladesong";
const NAME_PATTERN = /^bladesong$/i;
const EFFECT_PATTERN = /^bladesong\b/i;
const BATTLE_READY_IDENTIFIER = "battle-ready";
const BATTLE_READY_PATTERN = /^battle ready$/i;

/**
 * Whether the actor has the Battle Smith's Battle Ready feature.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _hasBattleReady(actor) {
    return Boolean(actor?.items?.some(item => (item.type === "feat")
        && ((item.system?.identifier === BATTLE_READY_IDENTIFIER) || BATTLE_READY_PATTERN.test(item.name?.trim() ?? ""))));
}

/**
 * The actor's Bladesong feature.
 * @param {Actor5e} actor
 * @returns {Item5e|null}
 */
function _getBladesongItem(actor) {
    return actor?.items?.find(item => (item.type === "feat")
        && ((item.system?.identifier === IDENTIFIER) || NAME_PATTERN.test(item.name?.trim() ?? ""))) ?? null;
}

/**
 * Whether the feature follows the 2024 rules (Bladework): its own source rules, else the world's.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isModernBladesong(item) {
    const rules = item?.system?.source?.rules;
    if (rules === "2024") return true;
    if (rules === "2014") return false;
    return isModernRules();
}

/**
 * Whether Bladesong is active: an enabled effect named Bladesong on the actor (the feature's own effect, enabled or
 * applied by its "Invoke Bladesong" activity).
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isBladesongActive(actor) {
    for (const effect of actor?.appliedEffects ?? []) {
        if (!effect.disabled && !effect.isSuppressed && EFFECT_PATTERN.test(effect.name?.trim() ?? "")) return true;
    }
    return false;
}

/**
 * Whether this attack activity qualifies for Bladework.
 * @param {Activity} activity
 * @returns {boolean}
 */
function _qualifies(activity) {
    const item = activity.item;
    if (item?.type !== "weapon") return false;
    if (activity.attack?.type?.classification && (activity.attack.type.classification !== "weapon")) return false;
    if ((item.system?.identifier === "unarmed-strike") || (item.system?.type?.value === "natural")) return false;

    // Only instead of Strength or Dexterity: the default (the weapon's own abilities) or a fixed Str / Dex
    const fixed = activity.attack?.ability ?? "";
    if (fixed && !["str", "dex"].includes(fixed)) return false;
    if (!fixed && !item.system?.availableAbilities?.size) return false;

    const actor = activity.actor;

    // Battle Ready: any magic weapon
    if (item.system?.properties?.has?.("mgc") && _hasBattleReady(actor)) return true;

    // Bladesong: weapons with proficiency, while Bladesong is active
    if (!(Number(item.system?.proficiencyMultiplier ?? item.system?.prof?.multiplier ?? 0) > 0)) return false;
    const bladesong = _getBladesongItem(actor);
    return Boolean(bladesong && _isModernBladesong(bladesong) && _isBladesongActive(actor));
}

/**
 * Wrapper for AttackActivity#prepareFinalData: add Intelligence to the attack's abilities before dnd5e fills them.
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {*}
 */
function _wrapPrepareFinalData(wrapped, ...args) {
    try {
        if (this.attack?.abilities && !this.attack.abilities.has("int") && this.actor
            && isFeatureActive("enableBladesongBladework", "clientEnableBladesongBladework") && _qualifies(this)) {
            this.attack.abilities.add("int");
            debug(`Intelligence for Weapon Attacks | ${this.actor.name}'s ${this.item.name} may use Intelligence`);
        }
    } catch (err) {
        debug("Bladesong Bladework | Check failed", err);
    }
    return wrapped(...args);
}

/**
 * Re-prepare actors with Bladesong or Battle Ready when the setting changes, so their attacks update without a reload.
 */
export function refreshBladesongActors() {
    const relevant = actor => Boolean(_getBladesongItem(actor) || _hasBattleReady(actor));
    for (const actor of game.actors ?? []) {
        if (relevant(actor)) actor.reset?.();
    }
    for (const token of canvas?.scene?.tokens ?? []) {
        if (!token.actorLink && token.actor && relevant(token.actor)) token.actor.reset?.();
    }
}

/** Called once during "setup" from main.js. */
export function initBladesongBladework() {
    patchMethod("dnd5e.documents.activity.AttackActivity.prototype.prepareFinalData", _wrapPrepareFinalData, "WRAPPER");
    log("Intelligence for Weapon Attacks | Patched AttackActivity#prepareFinalData");
}
