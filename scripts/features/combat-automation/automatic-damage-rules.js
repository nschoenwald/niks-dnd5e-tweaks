/**
 * Feature: Automatic Damage Rules
 * Description: Feats and spells that change how damage or healing dice roll, applied automatically like Great Weapon
 *              Fighting (part of Conditional Damage Bonuses, no toggle):
 *              - Tavern Brawler (PHB 2024): Unarmed Strikes deal 1d4 instead of 1 and reroll 1s.
 *              - Healer (PHB 2024): healing dice of spells reroll 1s.
 *              - Fists of Fury, Clean Hits (World of Warcraft): Unarmed Strike and Light weapon damage dice treat 1s as 2s.
 *              - Metamorphosis, Devourer (World of Warcraft): force damage dice treat 1s and 2s as 3s.
 *              - Unholy Rune (World of Warcraft): its extra necrotic damage only on the first hit each turn.
 *
 * @introduced v14.104.0
 */
import { MODULE_ID, isFeatureActive, log, debug } from "../../context.js";
import { getActiveCombat, getCombatTurnKey, hasUsedBonusThisTurn, markBonusUsedThisTurn } from "./conditional-damage.js";

/**
 * Automatic Damage Rules
 * ---------------------------------------------------------------------------
 * The official items handle these only for their own activities: Tavern Brawler's "Enhanced Unarmed Strike"
 * (`1d4r1 + @abilities.str.mod`) and Healer's "Heal d6…d12" (`1d6r1 + @prof`). The character's regular Unarmed
 * Strike (also a Monk's Martial Arts die) and healing spells don't get them, so they're applied here:
 *
 *  - dnd5e.preRollDamage (before the dialog builds the rolls; registered before Conditional Damage so Savage Attacker
 *    copies the changed dice, like Great Weapon Fighting):
 *    - Tavern Brawler: an Unarmed Strike whose base damage has no dice (PHB item: bonus "1 + @mod") gets "1d4"
 *      instead of the flat 1 (Enhanced Unarmed Strike), and its dice get "r1" (Damage Rerolls: reroll a 1 once).
 *      The feat is found by identifier `tavern-brawler`; dnd5e also sets `flags.dnd5e.tavernBrawlerFeat`.
 *    - Unholy Rune: the rune's enchantment adds its bonus (a `dnd5e.bonus` rule on "damage", value
 *      "max(1, @abilities.cha.mod)[necrotic]", Heavy weapons only) to every hit through dnd5e's `@ruleBonus`. The rule
 *      text limits it to the first creature hit each turn. preRollDamage decides whether this is a later hit in the
 *      combat turn; dnd5e then rebuilds `ruleBonus` for every roll in `_buildDamageConfig` (dialog and fast-forward,
 *      6.1.0 and 6.1.1), so the rune's value is removed afterwards, in `dnd5e.postBuildDamageRollConfig`.
 *  - dnd5e.postDamageRollConfiguration (final damage types, e.g. picked in the dialog): Die modifiers on the built
 *    rolls, then `resetFormula()`.
 *    - Clean Hits (`fists-of-fury`): attack damage with an Unarmed Strike or a Light weapon, every die "min2".
 *    - Devourer (Metamorphosis, effect "Devourer" from the spell): rolls of type force, every die "min3".
 *    - Healer (`healer`): healing rolls (type "healing") of spells, every die "r1".
 * Built-roll dice that already have the same kind of modifier are left alone; a reroll and a minimum combine.
 */

/** Literal dice with their modifiers, e.g. "2d6", "1d8r1". Not "@scale…" references. */
const DICE_PATTERN = /\b(\d+d\d+)((?:[a-z]+[<>=]*\d*)*)/gi;

/**
 * Whether the actor has a feat with one of these identifiers (or a matching name).
 * @param {Actor5e} actor
 * @param {string} identifier
 * @param {RegExp} namePattern
 * @returns {boolean}
 */
function _hasFeat(actor, identifier, namePattern) {
    return Boolean(actor?.items?.some(item => (item.type === "feat")
        && ((item.system?.identifier === identifier) || namePattern.test(item.name?.trim() ?? ""))));
}

/**
 * Whether the attack is an Unarmed Strike.
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isUnarmedStrike(activity) {
    const item = activity?.item;
    return (activity?.attack?.type?.classification === "unarmed") || (item?.system?.identifier === "unarmed-strike");
}

/**
 * Append a modifier to every literal die in a formula part, skipping dice that already reroll or have a minimum.
 * @param {string} part
 * @param {string} modifier
 * @returns {string}
 */
function _modifyDice(part, modifier) {
    if (typeof part !== "string") return part;
    return part.replace(DICE_PATTERN, (match, dice, mods) => (/min|r/i.test(mods) ? match : `${dice}${mods}${modifier}`));
}

/**
 * Add a modifier to every Die term of a built roll, skipping dice that already have the same kind (a minimum, or a
 * reroll) or too few faces. A reroll and a minimum combine (Tavern Brawler + Clean Hits: "1d4r1min2").
 * @param {Roll} roll
 * @param {string} modifier
 * @param {number} [minFaces=2]
 * @returns {boolean}  Whether a die was changed.
 */
function _modifyRollDice(roll, modifier, minFaces = 2) {
    let changed = false;
    for (const term of roll?.terms ?? []) {
        if (!(term instanceof foundry.dice.terms.Die) || !(term.faces > minFaces)) continue;
        const modifiers = term.modifiers ?? [];
        // Skip dice that already have this kind of modifier (a minimum, or a reroll); a reroll and a minimum combine
        const sameKind = modifier.startsWith("min") ? (m => /^min/i.test(m)) : (m => /^r/i.test(m));
        if (modifiers.some(sameKind)) continue;
        term.modifiers = [...modifiers, modifier];
        changed = true;
    }
    if (changed) roll.resetFormula?.();
    return changed;
}

/**
 * Whether an active effect with this name comes from the actor's Metamorphosis spell (or has no origin and the
 * actor knows the spell).
 * @param {Actor5e} actor
 * @param {RegExp} pattern
 * @returns {boolean}
 */
function _hasMetamorphosisForm(actor, pattern) {
    for (const effect of actor?.appliedEffects ?? []) {
        if (effect.disabled || !pattern.test(effect.name?.trim() ?? "")) continue;
        let item = null;
        try {
            const origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
            item = (origin instanceof Item) ? origin : (origin?.item ?? null);
        } catch {
            item = null;
        }
        if (item ? (item.system?.identifier === "metamorphosis")
            : actor.items?.some(i => i.system?.identifier === "metamorphosis")) return true;
    }
    return false;
}

// ── Before the dialog ────────────────────────────────────────────────

/**
 * dnd5e.preRollDamage: Tavern Brawler and the Unholy Rune limit.
 * @param {object} config
 */
function _onPreRollDamage(config) {
    try {
        if (config?.hookNames && !config.hookNames.includes("damage")) return;
        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
        const activity = config?.subject;
        const actor = activity?.actor;
        if (!actor || (activity.type !== "attack")) return;
        _applyTavernBrawler(config, activity, actor);
        _limitUnholyRune(config, activity, actor);
    } catch (err) {
        console.error(`${MODULE_ID} | Automatic Damage Rules failed`, err);
    }
}

/**
 * Tavern Brawler: 1d4 instead of a flat 1 for the Unarmed Strike, and its damage dice reroll 1s.
 * @param {object} config
 * @param {Activity} activity
 * @param {Actor5e} actor
 */
function _applyTavernBrawler(config, activity, actor) {
    if ((activity.item?.type !== "weapon") || !_isUnarmedStrike(activity)) return;
    if (!_hasFeat(actor, "tavern-brawler", /^tavern brawler$/i)) return;
    const baseRoll = config.rolls?.find(r => r.base) ?? config.rolls?.[0];
    if (!baseRoll?.parts?.length || baseRoll.options?.nd5tTavernBrawler) return;

    let first = baseRoll.parts[0];
    // Enhanced Unarmed Strike: "1 + @mod" → "1d4 + @mod" (only when the strike has no damage die of its own)
    if ((typeof first === "string") && !/\d+d\d+/i.test(first)) first = first.replace(/^\s*1(?=\s*(?:[+-]|$))/, "1d4");
    first = _modifyDice(first, "r1");
    if (first === baseRoll.parts[0]) return;
    baseRoll.parts = [first, ...baseRoll.parts.slice(1)];
    baseRoll.options ??= {};
    baseRoll.options.nd5tTavernBrawler = true;
    debug(`Automatic Damage Rules | Tavern Brawler: ${actor.name}'s Unarmed Strike rolls ${first}`);
}

/**
 * Unholy Rune: keep the rune's bonus for the first hit with the weapon each turn only.
 * @param {object} config
 * @param {Activity} activity
 * @param {Actor5e} actor
 */
function _limitUnholyRune(config, activity, actor) {
    const item = activity.item;
    if (item?.type !== "weapon") return;
    const rune = item.effects?.find(e => (e.type === "enchantment") && !e.disabled && /^unholy rune$/i.test(e.name ?? ""));
    if (!rune) return;
    const turnKey = getCombatTurnKey(getActiveCombat(actor), actor);
    if (!turnKey) return;
    const changes = rune.changes ?? rune.system?.changes ?? [];
    const value = changes.find(c => (c.key === "damage") && (c.type === "dnd5e.bonus"))?.value;
    if (!value) return;
    // Only Heavy weapons get the rune's bonus (its own condition)
    if (!item.system?.properties?.has?.("hvy")) return;

    const usageId = `unholyRune:${item.id}`;
    if (!hasUsedBonusThisTurn(actor, usageId, turnKey)) {
        markBonusUsedThisTurn(actor, usageId, turnKey);
        return;
    }
    config._nd5tStripRuleBonus = value;
    debug(`Automatic Damage Rules | Unholy Rune: ${actor.name} already hit with ${item.name} this turn, no extra damage`);
}

/**
 * dnd5e.postBuildDamageRollConfig: remove a rule bonus value (a later Unholy Rune hit) from the roll's `@ruleBonus`,
 * after dnd5e rebuilt it for this roll.
 * @param {object} process  Damage roll process configuration.
 * @param {object} config   Configuration of one roll.
 */
function _onPostBuildDamageRollConfig(process, config) {
    const value = process?._nd5tStripRuleBonus;
    if (!value || (typeof config?.data?.ruleBonus !== "string") || !config.data.ruleBonus.includes(value)) return;
    const rest = config.data.ruleBonus.replace(value, "").replace(/^\s*\+\s*|\s*\+\s*$/g, "").replace(/\+\s*\+/g, "+").trim();
    if (rest) config.data.ruleBonus = rest;
    else {
        delete config.data.ruleBonus;
        config.parts = (config.parts ?? []).filter(p => p !== "@ruleBonus");
    }
}

// ── After the dialog ─────────────────────────────────────────────────

/**
 * dnd5e.postDamageRollConfiguration: Clean Hits, Devourer and Healer on the built rolls.
 * @param {Roll[]} rolls
 * @param {object} config
 */
function _onPostDamageRollConfiguration(rolls, config) {
    try {
        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
        const activity = config?.subject;
        const item = activity?.item;
        const actor = activity?.actor ?? item?.actor;
        if (!actor || !rolls?.length) return;

        // Clean Hits: attacks with an Unarmed Strike or a Light weapon
        if ((activity.type === "attack") && (item?.type === "weapon")
            && (_isUnarmedStrike(activity) || item.system?.properties?.has?.("lgt"))
            && _hasFeat(actor, "fists-of-fury", /^fists of fury$/i)) {
            for (const roll of rolls) {
                if ((roll.options?.type === "healing") || (roll.options?.type === "temphp")) continue;
                if (_modifyRollDice(roll, "min2")) debug(`Automatic Damage Rules | Clean Hits: ${roll.formula}`);
            }
        }

        // Devourer: force damage dice while in the Devourer form
        const forceRolls = rolls.filter(r => r.options?.type === "force");
        if (forceRolls.length && _hasMetamorphosisForm(actor, /^devourer$/i)) {
            for (const roll of forceRolls) {
                if (_modifyRollDice(roll, "min3")) debug(`Automatic Damage Rules | Devourer: ${roll.formula}`);
            }
        }

        // Healer: healing dice of spells
        if ((item?.type === "spell") && _hasFeat(actor, "healer", /^healer$/i)) {
            for (const roll of rolls) {
                if (roll.options?.type !== "healing") continue;
                if (_modifyRollDice(roll, "r1", 1)) debug(`Automatic Damage Rules | Healer: ${roll.formula}`);
            }
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Automatic Damage Rules failed`, err);
    }
}

/** Must be called before `initConditionalDamage` (Savage Attacker copies the Unarmed Strike's changed dice). */
export function initAutomaticDamageRules() {
    Hooks.on("dnd5e.preRollDamage", _onPreRollDamage);
    Hooks.on("dnd5e.postDamageRollConfiguration", _onPostDamageRollConfiguration);
    Hooks.on("dnd5e.postBuildDamageRollConfig", _onPostBuildDamageRollConfig);
    log("Automatic Damage Rules | Hooked damage rolls (Tavern Brawler, Healer, Clean Hits, Devourer, Unholy Rune).");
}
