/**
 * Conditional Damage Bonuses: Collecting the bonuses that apply to a damage roll, and building their roll configurations.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { debug } from "../../../context.js";
import { isWm5eActive } from "../../../utils/module-compat.js";
import { didAttackRollNatural20 } from "./attack-cache.js";
import { getActiveCombat, getCombatTurnKey, hasAttackerMovedChargerDistance, hasUsedBonusThisTurn, isAttackerCombatTurn } from "./combat-turn.js";
import { GENIES_WRATH_DAMAGE_TYPES, actorHasBoonOfIrresistibleOffense, actorHasBrutalStrike, actorHasCharger, actorHasGeniesWrath, actorHasGreatWeaponMaster, actorHasSavageAttacker, brutalStrikeAutomated, getActorBoonOfIrresistibleOffenseFeat, getActorGeniesWrathType, getBoonOfIrresistibleOffenseAbility, getBoonOfIrresistibleOffenseScore, getBrutalStrikeFormula, getRogueData, getSneakAttackEligibility, getWeaponBaseDiceFormula, isEligibleChargerAttack, isEligibleCleaveWeapon, isEligibleHeavyWeapon, isEligibleSavageAttackerAttack, isEligibleSneakAttackWeapon, isModernRules, strengthAttackCheck } from "./core-bonuses.js";
import { addFeatureAttackBonuses } from "./feature-bonuses.js";
import { BLOCKED_REASON_FALLBACKS, findFeature, isAttackActivity } from "./feature-helpers.js";
import { addSpellBonuses } from "./spell-bonuses.js";

/**
 * Registry of static conditional damage bonus definitions.
 * Designed to be cleanly extensible for future conditional damage effects.
 */
export const CONDITIONAL_DAMAGE_DEFINITIONS = [
    {
        id: "hex",
        slug: "hex",
        spellName: "Hex",
        effectMatch: /^concentrating:\s*hex$/i,
        labelKey: "ND5T.ConditionalDamage.Hex.Label",
        defaultLabel: "Hex (+1d6 Necrotic)",
        formula: "1d6[Hex]",
        damageType: "necrotic",
        flavor: "Hex",
        defaultActive: true
    },
    {
        id: "huntersMark",
        slug: "hunters-mark",
        spellName: "Hunter's Mark",
        effectMatch: /^concentrating:\s*hunter's mark$/i,
        labelKey: "ND5T.ConditionalDamage.HuntersMark.Label",
        defaultLabel: "Hunter's Mark (+1d6 Force)",
        formula: "1d6[Hunter's Mark]",
        damageType: "force",
        flavor: "Hunter's Mark",
        defaultActive: true
    }
];

/**
 * Determine which conditional damage bonuses are currently active on an actor.
 * Checks concentration effects (Hex, Hunter's Mark) as well as Sneak Attack eligibility.
 * Fully compatible with localized games and kebab-case identifiers.
 *
 * @param {Actor5e} actor
 * @param {object} [context={}]
 * @param {Item5e|null} [context.item=null]
 * @param {Activity|null} [context.activity=null]
 * @param {object|null} [context.config=null]
 * @returns {Array<object>} Array of active definition objects
 */
export function getActiveConditionalBonuses(actor, { item = null, activity = null, config = null, dialog = null, message = null, isHealing = false } = {}) {
    if (!actor) return [];
    const activeBonuses = [];

    // Damage rolls without an activity count as attacks (old behaviour); other activities (saving throw spells,
    // damage activities) only get the spell damage bonuses.
    const isAttack = !isHealing && (!activity || isAttackActivity(activity));

    // --- 1. Concentration Spells (Hex & Hunter's Mark) ---
    const effects = actor.appliedEffects ?? Array.from(actor.effects?.values() ?? []);
    const concentrationItems = actor.concentration?.items ?? new Set();

    for (const def of (isAttack ? CONDITIONAL_DAMAGE_DEFINITIONS : [])) {
        const targetSpell = def.spellName.toLowerCase();
        const defId = def.id.toLowerCase();
        const defSlug = (def.slug || "").toLowerCase();

        // Whole-word matchers: prevent e.g. "Hexblade's Curse" from matching Hex.
        const nameRe = new RegExp(`(?:^|[^a-z0-9])${targetSpell}(?:$|[^a-z0-9])`, "i");
        const slugRe = defSlug ? new RegExp(`(?:^|[-_])${defSlug}(?:$|[-_])`, "i") : null;

        // Check official DnD5e concentration items set (Actor#concentration.items)
        let hasMatch = Array.from(concentrationItems).some(cItem => {
            const itemName = (cItem.name || "").toLowerCase();
            const itemIdentifier = (cItem.identifier || cItem.system?.identifier || "").toLowerCase();
            const cleanIdentifier = itemIdentifier.replace(/[-_]/g, "");

            return nameRe.test(itemName)
                || Boolean(slugRe?.test(itemIdentifier))
                || cleanIdentifier === defId;
        });

        // Check applied active effects on the actor
        if (!hasMatch && effects.length) {
            hasMatch = effects.some(e => {
                if (e.disabled || e.isSuppressed) return false;
                const name = (e.name || "").trim().toLowerCase();
                if (def.effectMatch.test(name)) return true;

                // Support special status effect concentrating where name or description matches spell
                if (e.statuses?.has("concentrating") || e.statuses?.has(CONFIG.specialStatusEffects?.CONCENTRATING)) {
                    if (nameRe.test(name)) return true;
                    const itemFlag = e.getFlag?.("dnd5e", "item");
                    if (itemFlag) {
                        const flagName = (itemFlag.data?.name || itemFlag.name || "").toLowerCase();
                        const flagId = (itemFlag.data?.identifier || itemFlag.identifier || "").toLowerCase();
                        if (nameRe.test(flagName) || Boolean(slugRe?.test(flagId))) return true;
                    }
                }
                return false;
            });
        }

        if (hasMatch && (def.id === "huntersMark") && findFeature(actor, ["foe-slayer"], /^foe slayer$/i)) {
            // Foe Slayer (Ranger 20): the Hunter's Mark damage die becomes a d10
            activeBonuses.push({
                ...def,
                formula: "1d10[Hunter's Mark]",
                labelKey: "ND5T.ConditionalDamage.HuntersMark.FoeSlayerLabel",
                defaultLabel: "Hunter's Mark (+1d10 Force)"
            });
        } else if (hasMatch) {
            activeBonuses.push(def);
        }
    }

    // Match the weapon's base damage type for generic bonuses (Sneak Attack, GWM, Brutal Strike, Charger, Boon of Irresistible Offense).
    // If the weapon's base damage does not specify a damage type, generic bonuses remain untyped (null).
    const getFirstType = (types) => {
        if (!types) return null;
        if (typeof types.first === "function") return types.first() ?? null;
        if (Array.isArray(types)) return types[0] ?? null;
        if (types instanceof Set) return types.values().next().value ?? null;
        return null;
    };

    let rawBaseType = null;
    if (config?.rolls?.length) {
        rawBaseType = config.rolls[0]?.options?.type ?? config.rolls[0]?.options?.types?.[0] ?? null;
    } else {
        rawBaseType = getFirstType(activity?.damage?.parts?.[0]?.types)
            ?? getFirstType(item?.system?.damage?.base?.types)
            ?? item?.system?.damage?.base?.type
            ?? null;
    }
    const baseDamageType = (typeof rawBaseType === "string" && rawBaseType.trim()) ? rawBaseType.trim() : null;

    // Resolve the attacking token (used for combat turn checks)
    const speakerTokenDoc = message?.data?.speaker?.token
        ? (canvas?.scene?.tokens?.get(message.data.speaker.token) ?? null)
        : null;
    const controlledTokenDoc = (canvas?.ready && canvas.tokens?.controlled?.length)
        ? (canvas.tokens.controlled.find(t => t.actor?.id === actor.id || t.actor === actor)?.document ?? null)
        : null;

    const token = actor.token
        ?? activity?.token
        ?? activity?.item?.actor?.token
        ?? dialog?.options?.token
        ?? config?.token
        ?? speakerTokenDoc
        ?? controlledTokenDoc
        ?? (canvas?.ready && actor.getActiveTokens ? actor.getActiveTokens(false, true)?.[0] : null)
        ?? null;

    const combat = getActiveCombat(actor, token);
    const inCombat = Boolean(combat?.active && combat.started);
    const turnKey = getCombatTurnKey(combat, actor, token);
    const isMyTurn = isAttackerCombatTurn(actor, token);
    const featureContext = { actor, item, activity, config, dialog, message, baseDamageType, token, combat, inCombat, turnKey, isMyTurn, isAttack, isHealing };

    if (!isAttack) {
        addSpellBonuses(featureContext, activeBonuses);
        _applyBlockedReasons(actor, activeBonuses);
        return activeBonuses;
    }

    // --- 2. Sneak Attack (Rogue class scale value on ranged or finesse weapon; once per turn) ---
    const rogueData = getRogueData(actor);
    if (rogueData && isEligibleSneakAttackWeapon(item, activity, config)) {
        // Starts on only when the attack qualifies (Advantage, an ally next to the target, or Rakish Audacity)
        // and Sneak Attack hasn't been used this combat turn. If that can't be worked out, the old default applies:
        // on until used this turn in combat, the remembered choice outside combat.
        let eligibility = { state: "unknown", reason: "NoAttack" };
        try {
            eligibility = getSneakAttackEligibility(actor, token, { config, dialog, message, activity });
        } catch (err) {
            debug("Conditional Damage | Sneak Attack eligibility check failed:", err);
        }
        const usedThisTurn = hasUsedBonusThisTurn(actor, "sneakAttack", turnKey);
        debug(`Conditional Damage | Sneak Attack for ${actor.name}: ${eligibility.state} (${eligibility.reason})`);

        // Assassinate (Assassin): during the first round of combat, Sneak Attack deals extra damage equal to the
        // Rogue level
        let formula = `${rogueData.formula}[Sneak Attack]`;
        let formulaDisplay = rogueData.formula;
        if (inCombat && (combat.round === 1) && (rogueData.levels > 0)
            && findFeature(actor, ["assassinate"], /^assassinate$/i)) {
            formula += ` + ${rogueData.levels}[Assassinate]`;
            formulaDisplay += ` + ${rogueData.levels}`;
        }

        activeBonuses.push({
            id: "sneakAttack",
            spellName: "Sneak Attack",
            formula,
            formulaDisplay,
            damageType: baseDamageType,
            flavor: "Sneak Attack",
            labelKey: "ND5T.ConditionalDamage.SneakAttack.Label",
            defaultLabel: `Sneak Attack (+${formulaDisplay})`,
            turnKey,
            eligibility,
            defaultActive: eligibility.state === "unknown" ? !usedThisTurn : (eligibility.state === "eligible" && !usedThisTurn)
        });
    }

    // --- 3. Great Weapon Master (2024 Modern Rules: +PB damage on heavy weapons on attacker's turn) ---
    // Off-turn attacks (Opportunity Attacks) get it unticked
    if (isModernRules() && actorHasGreatWeaponMaster(actor) && isEligibleHeavyWeapon(item)) {
        const pb = Number(actor.system?.attributes?.prof ?? 2);
        activeBonuses.push({
            id: "greatWeaponMaster",
            spellName: "Great Weapon Master",
            formula: "@prof[GWM]",
            formulaDisplay: String(pb),
            damageType: baseDamageType,
            flavor: "GWM",
            labelKey: "ND5T.ConditionalDamage.GreatWeaponMaster.Label",
            defaultLabel: `Great Weapon Master (+${pb})`,
            blocked: [!isMyTurn && "NotYourTurn"],
            defaultActive: true
        });
    }

    // --- 4. Cleave Weapon Mastery (2024 Modern Rules: remove ability modifier unless negative) ---
    // Automated Masteries 5e rolls the Cleave attack itself in off-hand mode, which already drops the modifier.
    if (!isWm5eActive() && isEligibleCleaveWeapon(item, actor)) {
        const baseRoll = config?.rolls?.[0];
        const abilityKey = baseRoll?.data?.roll?.ability ?? activity?.ability ?? item?.system?.ability ?? "str";
        const modValue = Number(baseRoll?.data?.mod ?? actor.system?.abilities?.[abilityKey]?.mod ?? 0);

        activeBonuses.push({
            id: "cleave",
            spellName: "Cleave",
            flavor: "Cleave",
            labelKey: modValue > 0 ? "ND5T.ConditionalDamage.Cleave.Label" : "ND5T.ConditionalDamage.Cleave.NoMalusLabel",
            defaultLabel: modValue > 0 ? `Cleave (-${modValue})` : "Cleave (No Malus)",
            formulaDisplay: modValue > 0 ? String(modValue) : "0",
            defaultActive: false,
            isMalus: true,
            modValue
        });
    }

    // --- 5. Brutal Strike (2024 Modern Rules: @scale.barbarian.brutal-strike on Barbarian's turn, once per turn) ---
    // Not offered while Brutal Strike automation (brutal-strike.js) adds the damage to the attacks it was chosen on.
    // Off-turn, already used or not Strength-based: offered unticked, so a player can still correct a missed choice.
    const brutalCheck = (isModernRules() && !brutalStrikeAutomated() && actorHasBrutalStrike(actor))
        ? strengthAttackCheck(item, activity, config, actor)
        : "kind";
    if (brutalCheck !== "kind") {
        const brutalFormulaDisplay = getBrutalStrikeFormula(actor);
        activeBonuses.push({
            id: "brutalStrike",
            spellName: "Brutal Strike",
            formula: `${brutalFormulaDisplay}[Brutal Strike]`,
            formulaDisplay: brutalFormulaDisplay,
            damageType: baseDamageType,
            flavor: "Brutal Strike",
            turnKey,
            labelKey: "ND5T.ConditionalDamage.BrutalStrike.Label",
            defaultLabel: `Brutal Strike (+${brutalFormulaDisplay})`,
            blocked: [!isMyTurn && "NotYourTurn", (brutalCheck === "strength") && "NotStrength"],
            defaultActive: false
        });
    }

    // --- 6. Charger (2024 Modern Rules: +1d8 damage on melee attack after moving at least 10 ft on your turn, once per turn) ---
    // In combat, off-turn or without the 10 ft of movement it's offered unticked (movement can be missed: teleports,
    // forced movement, a token moved by hand)
    if (isModernRules() && actorHasCharger(actor) && isEligibleChargerAttack(item, activity, config)) {
        activeBonuses.push({
            id: "charger",
            spellName: "Charger",
            formula: "1d8[Charger]",
            formulaDisplay: "1d8",
            damageType: baseDamageType,
            flavor: "Charger",
            turnKey,
            labelKey: "ND5T.ConditionalDamage.Charger.Label",
            defaultLabel: "Charger (+1d8)",
            blocked: inCombat
                ? [!isMyTurn && "NotYourTurn", isMyTurn && !hasAttackerMovedChargerDistance(actor, token, 10) && "NotMoved"]
                : [],
            defaultActive: false
        });
    }

    // --- 7. Savage Attacker (2024 Modern Rules: Roll weapon damage dice twice and use either roll, once per turn) ---
    if (isModernRules() && actorHasSavageAttacker(actor) && isEligibleSavageAttackerAttack(item, activity, config)) {
        const hasUsedThisTurn = inCombat && hasUsedBonusThisTurn(actor, "savageAttacker", turnKey);

        const weaponDice = getWeaponBaseDiceFormula(config?.rolls?.[0], item, activity);
        // Flat-damage weapons have no dice to roll twice
        if (weaponDice) {
            const dicePair = `{${weaponDice}, ${weaponDice}}kh`;

            activeBonuses.push({
                id: "savageAttacker",
                spellName: "Savage Attacker",
                flavor: "Savage Attacker",
                isWeaponModifier: true,
                weaponDice,
                formulaDisplay: dicePair,
                turnKey,
                labelKey: "ND5T.ConditionalDamage.SavageAttacker.Label",
                defaultLabel: `Savage Attacker (${dicePair})`,
                defaultActive: !hasUsedThisTurn
            });
        }
    }

    // --- 8. Genie's Wrath (Genie warlock: +PB on a hit with an attack roll, once during each of your turns) ---
    // The type depends on the patron's kind, which items don't reliably record: the roll offers the four types
    // in a dropdown and remembers the last pick.
    if (actorHasGeniesWrath(actor)) {
        const isAttack = activity?.type === "attack"
            || ["mwak", "rwak", "msak", "rsak"].includes(activity?.actionType ?? "");
        if (isAttack) {
            const pb = Number(actor.system?.attributes?.prof ?? 2);
            const rememberedType = getActorGeniesWrathType(actor);
            activeBonuses.push({
                id: "geniesWrath",
                spellName: "Genie's Wrath",
                formula: "@prof[Genie's Wrath]",
                formulaDisplay: String(pb),
                damageType: rememberedType ?? GENIES_WRATH_DAMAGE_TYPES[0],
                damageTypes: [...GENIES_WRATH_DAMAGE_TYPES],
                rememberType: true,
                typeRemembered: Boolean(rememberedType),
                flavor: "Genie's Wrath",
                labelKey: "ND5T.ConditionalDamage.GeniesWrath.Label",
                defaultLabel: `Genie's Wrath (+${pb})`,
                turnKey,
                blocked: [!isMyTurn && "NotYourTurn"],
                defaultActive: !(inCombat && hasUsedBonusThisTurn(actor, "geniesWrath", turnKey))
            });
        }
    }

    // --- 9. Boon of Irresistible Offense (2024 Modern Rules: +Ability Score when rolling a 20 on the d20 for an attack roll) ---
    if (isModernRules() && actorHasBoonOfIrresistibleOffense(actor)) {
        const isAttack = activity?.type === "attack"
            || ["mwak", "rwak", "msak", "rsak"].includes(activity?.actionType ?? "");

        // Offered unticked without a natural 20 found (an attack rolled outside Foundry, or not found)
        if (isAttack) {
            const natural20 = didAttackRollNatural20(actor, { config, dialog, message, activity });
            const featItem = getActorBoonOfIrresistibleOffenseFeat(actor);
            const abilityKey = getBoonOfIrresistibleOffenseAbility(actor, featItem);
            const scoreValue = getBoonOfIrresistibleOffenseScore(actor, featItem);

            activeBonuses.push({
                id: "boonOfIrresistibleOffense",
                spellName: "Boon of Irresistible Offense",
                formula: `${scoreValue}[Boon of Irresistible Offense]`,
                formulaDisplay: String(scoreValue),
                damageType: baseDamageType,
                flavor: "Boon of Irresistible Offense",
                labelKey: "ND5T.ConditionalDamage.BoonOfIrresistibleOffense.Label",
                defaultLabel: `Boon of Irresistible Offense (+${scoreValue})`,
                blocked: [!natural20 && "NotNatural20"],
                defaultActive: true,
                abilityKey,
                scoreValue
            });
        }
    }

    // --- 10. Class features and species traits (PHB 2024), then spell damage bonuses ---
    addFeatureAttackBonuses(featureContext, activeBonuses);
    addSpellBonuses(featureContext, activeBonuses);

    _applyBlockedReasons(actor, activeBonuses);
    return activeBonuses;
}

/**
 * Bonuses whose conditions aren't met are still offered, unticked, so players can fix a misclick or a condition
 * Foundry can't see. Each bonus lists its unmet conditions in `blocked` (reason keys, falsy entries ignored); a
 * once-per-turn bonus already used this turn gets "UsedThisTurn". A blocked bonus starts unticked, its remembered
 * choice is neither applied nor overwritten, and its toggle's tooltip lists the reasons (after its own tooltip, if
 * it has one). Sneak Attack explains itself.
 *
 * @param {Actor5e} actor
 * @param {object[]} bonuses
 */
function _applyBlockedReasons(actor, bonuses) {
    for (const bonus of bonuses) {
        const reasons = (bonus.blocked ?? []).filter(Boolean);
        if (bonus.turnKey && (bonus.id !== "sneakAttack") && !reasons.includes("UsedThisTurn")
            && hasUsedBonusThisTurn(actor, bonus.usageId ?? bonus.id, bonus.turnKey)) {
            reasons.push("UsedThisTurn");
        }
        if (!reasons.length) {
            delete bonus.blocked;
            continue;
        }
        bonus.blocked = reasons;
        bonus.defaultActive = false;
        const texts = reasons.map(reason => {
            const key = (reason === "UsedThisTurn") ? "ND5T.ConditionalDamage.UsedThisTurn" : `ND5T.ConditionalDamage.Blocked.${reason}`;
            return game.i18n?.has(key) ? game.i18n.localize(key) : (BLOCKED_REASON_FALLBACKS[reason] ?? "");
        });
        if (bonus.tooltipKey) {
            texts.unshift(game.i18n?.has(bonus.tooltipKey) ? game.i18n.localize(bonus.tooltipKey) : (bonus.tooltipFallback ?? ""));
        }
        bonus.tooltipText = texts.filter(Boolean).join(" ");
    }
}

/**
 * Create a DamageRollConfiguration object for a conditional damage bonus.
 * Inherits weapon properties (e.g. magical, silvered) on Sneak Attack, and explicitly sets
 * `critical: { bonusDice: 0 }` to prevent Savage Attacks or Brutal Critical weapon dice
 * from erroneously duplicating onto bonus damage dice.
 *
 * @param {object} def                       Conditional bonus definition
 * @param {object} [rollData={}]             Base roll data
 * @param {object} [options={}]
 * @param {boolean} [options.isCritical]     Whether critical hit damage should be flagged
 * @param {string[]} [options.properties]    Weapon properties to propagate (e.g. ["mgc", "sil"])
 * @returns {object}
 */
export function createConditionalRollConfig(def, rollData = {}, { isCritical = false, properties = [] } = {}) {
    const data = foundry.utils.deepClone(rollData);
    data.roll ??= {};
    const damageType = (typeof def.damageType === "string" && def.damageType.trim()) ? def.damageType.trim() : null;
    data.roll.damageType = damageType;

    // Only Great Weapon Master's @prof formula needs its roll data overridden
    if (def.id === "greatWeaponMaster" && def.formulaDisplay && !isNaN(Number(def.formulaDisplay))) {
        data.prof = Number(def.formulaDisplay);
    }

    if (def.id === "brutalStrike") {
        data.scale ??= {};
        data.scale.barbarian ??= {};
        if (!data.scale.barbarian["brutal-strike"] || typeof data.scale.barbarian["brutal-strike"] === "object") {
            data.scale.barbarian["brutal-strike"] = def.formulaDisplay || "1d10";
        }
    }

    const isFlatBonus = Boolean(def.flat) || def.id === "greatWeaponMaster" || def.id === "boonOfIrresistibleOffense" || def.id === "geniesWrath";
    const rollOptions = {
        type: damageType,
        flavor: def.flavor,
        _nd5tConditionalId: def.id,
        critical: {
            bonusDice: 0,
            ...(isFlatBonus ? { multiplyNumeric: false } : {})
        }
    };

    if (Array.isArray(def.damageTypes) && def.damageTypes.length > 1) {
        // Several types: dnd5e's damage dialog shows a type dropdown for this row
        rollOptions.types = [...def.damageTypes];
    } else if (damageType) {
        rollOptions.types = [damageType];
    }

    if (properties?.length) {
        rollOptions.properties = [...properties];
        data.roll.properties = [...properties];
    }

    if (isCritical) {
        rollOptions.isCritical = true;
        data.roll.isCritical = true;
    }

    return {
        parts: [def.formula],
        data,
        options: rollOptions
    };
}
