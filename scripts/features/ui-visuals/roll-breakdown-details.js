/**
 * Feature: Detailed Roll Breakdown Overlay
 * Description: Replaces the unlabeled numbers in the roll total popover with a comprehensive breakdown
 *              showing the base die, dice rolls, and where every bonus/penalty originates (e.g. +3 STR,
 *              +2 PB, +1d4 Bless, -2 Exhaustion 1). Supports both d20 checks/saves/attacks and damage rolls.
 *
 * @introduced v14.43.0
 */
import { MODULE_ID, log, debug, isFeatureActive } from "../../main.js";

/**
 * Standard ability labels in 5e.
 * @type {Record<string, string>}
 */
const ABILITY_SHORTHANDS = {
    str: "STR",
    dex: "DEX",
    con: "CON",
    int: "INT",
    wis: "WIS",
    cha: "CHA"
};

/**
 * Tuned accent colors for DnD5e damage types sourced from Nik's Action HUD.
 * @type {Record<string, string>}
 */
export const DAMAGE_TYPE_COLORS = Object.freeze({
    acid: "#9ecc4e",
    bludgeoning: "#799fe0",
    cold: "#8be0f7",
    fire: "#ff6e42",
    force: "#b86bfc",
    lightning: "#4dc2ff",
    necrotic: "#6bbe6b",
    piercing: "#cbd5e1",
    poison: "#b066f5",
    psychic: "#ff54ad",
    radiant: "#ffd154",
    slashing: "#f05252",
    thunder: "#63a4d8",
    healing: "#48d689",
    temphp: "#38bdf8",
    all: "#e2e8f0",
    any: "#e2e8f0"
});

/**
 * Retrieve the subtle accent color for a given damage type key.
 * @param {string} typeKey
 * @returns {string}
 */
export function getDamageTypeColor(typeKey) {
    if (!typeKey) return "#191813";
    const key = String(typeKey).toLowerCase().trim();
    return DAMAGE_TYPE_COLORS[key] ?? CONFIG.DND5E?.damageTypes?.[key]?.color?.css ?? "#191813";
}

/**
 * Proactively tag roll configuration parts with bracketed flavor tags
 * during roll creation (e.g. @mod[STR], @prof[PB], @reductions.exhaustion[Exhaustion 1]).
 *
 * Foundry natively parses bracketed syntax [flavor] into term.options.flavor,
 * which persists through database storage and chat rendering.
 *
 * @param {object} processConfig - Full rolling process configuration.
 * @param {object} rollConfig    - Current roll configuration being built.
 * @param {number} [index=0]     - Index of the roll being prepared.
 */
function tagRollConfigParts(processConfig, rollConfig, index = 0) {
    if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
    if (!rollConfig?.parts || !Array.isArray(rollConfig.parts)) return;

    const data = rollConfig.data ?? {};
    const actor = processConfig?.subject?.actor
        ?? (processConfig?.subject instanceof Actor ? processConfig.subject : null)
        ?? processConfig?.actor
        ?? rollConfig?.options?.actor
        ?? rollConfig?.data?.actor
        ?? null;

    // Identify ability shorthand
    const rawAbility = data.roll?.ability || rollConfig.options?.ability || processConfig?.ability || "mod";
    const abilityKey = String(rawAbility).toLowerCase();
    const abilityLabel = ABILITY_SHORTHANDS[abilityKey] ?? abilityKey.toUpperCase();

    // Identify exhaustion level
    const exhaustionLevel = actor?.system?.attributes?.exhaustion
        ?? processConfig?.subject?.system?.attributes?.exhaustion
        ?? 1;

    // Identify proficiency level
    const profTerm = rollConfig.options?.profTerm ?? data.prof;
    const isExpertise = Number(data.roll?.proficient) === 2
        || String(profTerm).includes("* 2")
        || String(profTerm).includes("2 *");
    const isHalf = Number(data.roll?.proficient) === 0.5
        || String(profTerm).includes("/ 2")
        || String(profTerm).includes("* 0.5");
    const pbLabel = isExpertise ? "PB (Expertise)" : (isHalf ? "PB (Half)" : "PB");

    // Scan and annotate parts
    rollConfig.parts = rollConfig.parts.map(part => {
        if (typeof part !== "string") return part;
        const trimmed = part.trim();

        // If part already has flavor bracket, do not re-tag
        if (trimmed.includes("[") && trimmed.includes("]")) return part;

        // Extract any leading sign e.g. "+@scale.barbarian.rage-damage", "+4", "-2"
        const signMatch = trimmed.match(/^([+-])\s*(.*)$/);
        const sign = signMatch ? signMatch[1] : "";
        const clean = signMatch ? signMatch[2].trim() : trimmed;

        if (clean === "@mod") {
            return sign === "-" ? `-@mod[${abilityLabel}]` : `@mod[${abilityLabel}]`;
        }

        const abilityModMatch = clean.match(/^@abilities\.([a-z]{3})\.mod$/i);
        if (abilityModMatch) {
            const abl = ABILITY_SHORTHANDS[abilityModMatch[1].toLowerCase()] ?? abilityModMatch[1].toUpperCase();
            return sign === "-" ? `-${clean}[${abl}]` : `${clean}[${abl}]`;
        }

        if (clean === "@prof") {
            return sign === "-" ? `-${clean}[${pbLabel}]` : `${clean}[${pbLabel}]`;
        }

        if (clean === "@toHit") {
            return "@toHit[Attack Bonus]";
        }

        if (clean === "@extraBonus") {
            return "@extraBonus[Bonus]";
        }

        if (clean === "@weaponMagic" || clean === "@magicalBonus") {
            return `${clean}[MGC]`;
        }

        if (clean === "@ammoMagic" || clean === "@ammoBonus") {
            return `${clean}[Magic Ammo]`;
        }

        if (clean === "@cover") {
            const coverVal = Number(data.cover ?? 0);
            const coverText = coverVal === 2 ? "Half Cover" : (coverVal === 5 ? "Three-Quarters Cover" : "Cover");
            return `@cover[${coverText}]`;
        }

        if (clean.startsWith("@scale.")) {
            const scaleKey = clean.replace("@scale.", "");
            let tag = null;
            if (scaleKey.includes("rage")) {
                const effectName = actor ? findActiveEffectForDamageBonus(actor, clean, { rollData: data }) : null;
                tag = effectName || "Rage";
            }
            else if (scaleKey.includes("sneak-attack")) tag = "Sneak Attack";
            else if (scaleKey.includes("divine-strike")) tag = "Divine Strike";
            else if (scaleKey.includes("brutal-strike")) tag = "Brutal Strike";
            else if (scaleKey.includes("inspiration")) tag = "Bardic Inspiration";
            else {
                const parts = scaleKey.split(".");
                tag = parts[parts.length - 1].replace(/-/g, " ").capitalize();
            }
            return sign === "-" ? `-${clean}[${tag}]` : `${clean}[${tag}]`;
        }

        if (clean.startsWith("@reductions.")) {
            const statusKey = clean.replace("@reductions.", "");
            if (statusKey === "exhaustion") {
                return `@reductions.exhaustion[Exhaustion ${exhaustionLevel}]`;
            }
            const statusLabel = CONFIG.DND5E?.conditionTypes?.[statusKey]?.label
                ? game.i18n.localize(CONFIG.DND5E.conditionTypes[statusKey].label)
                : statusKey.capitalize();
            return `@reductions.${statusKey}[${statusLabel}]`;
        }

        if (clean === "@situational") {
            return "@situational[Situational]";
        }

        if (clean === "@bonus") {
            return "@bonus[Item Bonus]";
        }

        if (clean === "@ruleBonus") {
            const effectName = detectActiveEffectSource(actor, data.ruleBonus, processConfig);
            return effectName ? `@ruleBonus[${effectName}]` : "@ruleBonus[Bonus]";
        }

        // Check if this part matches an active effect damage bonus on the actor
        if (actor) {
            const effectName = findActiveEffectForDamageBonus(actor, clean, { rollData: data });
            if (effectName) {
                return sign === "-" ? `-${clean}[${effectName}]` : `${clean}[${effectName}]`;
            }
        }

        return part;
    });
}

/**
 * Detect name of an active effect or feature providing a specific rule bonus.
 *
 * @param {Actor5e|null} actor
 * @param {string|number} bonusValue
 * @param {object} processConfig
 * @returns {string|null}
 */
function detectActiveEffectSource(actor, bonusValue, processConfig) {
    if (!actor?.appliedEffects?.length && !actor?.effects?.size) return null;
    const effects = actor.appliedEffects ?? Array.from(actor.effects.values());
    const bonusStr = String(bonusValue ?? "").toLowerCase().trim();
    const rollData = actor.getRollData ? actor.getRollData() : {};

    // Check active effects for matching changes
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        for (const change of effect.changes ?? []) {
            let val = String(change.value ?? "").toLowerCase().trim();
            if (val === bonusStr || (bonusStr && val.includes(bonusStr))) {
                return effect.name;
            }
            if (val.includes("@")) {
                try {
                    const replaced = Roll.replaceFormulaData(val, rollData).toLowerCase().trim();
                    if (replaced === bonusStr || (bonusStr && replaced.includes(bonusStr))) {
                        return effect.name;
                    }
                } catch {
                    // Ignore replacement errors
                }
            }
        }
    }

    // Common spell names heuristic
    if (bonusStr === "1d4") {
        for (const effect of effects) {
            const name = effect.name?.toLowerCase() ?? "";
            if (name.includes("bless")) return "Bless";
            if (name.includes("guidance")) return "Guidance";
            if (name.includes("bane")) return "Bane";
            if (name.includes("emboldening")) return "Emboldening Bond";
        }
    }

    return null;
}

/**
 * Find the name of an active effect providing a specific damage bonus on an actor.
 *
 * @param {Actor5e|null} actor
 * @param {string|number} targetVal - Numeric value or formula string of the bonus.
 * @param {object} [options={}]
 * @param {object} [options.rollData]
 * @param {Roll} [options.roll]
 * @param {Set<string>} [options.claimedEffectIds]
 * @returns {string|null}
 */
export function findActiveEffectForDamageBonus(actor, targetVal, options = {}) {
    if (!actor || targetVal === undefined || targetVal === null) return null;
    const effects = actor.appliedEffects ?? (actor.effects ? Array.from(actor.effects.values()) : []);
    if (!effects.length) return null;

    const rollData = options.rollData ?? (actor.getRollData ? actor.getRollData() : {});
    const claimedEffectIds = options.claimedEffectIds;

    const DAMAGE_KEY_REGEX = /(?:bonuses\.(?:[a-z]{4}|all)\.damage|rolls\.damage\.[a-z]{4}\.bonus)/i;

    const targetNum = Number(targetVal);
    const hasTargetNum = !isNaN(targetNum) && Number.isFinite(targetNum) && targetNum !== 0;
    const targetStr = String(targetVal).replace(/^[+-]\s*/, "").trim().toLowerCase();

    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        if (claimedEffectIds && claimedEffectIds.has(effect.id)) continue;

        const changes = effect.changes ?? [];
        for (const change of changes) {
            const key = String(change.key ?? "");
            if (!DAMAGE_KEY_REGEX.test(key) && !key.toLowerCase().includes("damage")) continue;

            const rawVal = String(change.value ?? "").trim();
            if (!rawVal) continue;

            const strippedVal = rawVal.replace(/^[+-]\s*/, "").trim().toLowerCase();

            // Direct formula string comparison (e.g. "@scale.barbarian.rage-damage")
            if (targetStr && (strippedVal === targetStr || rawVal.toLowerCase() === targetStr)) {
                if (claimedEffectIds) claimedEffectIds.add(effect.id);
                return effect.name;
            }

            // Resolve rollData in the change value
            let evaluatedStr = strippedVal;
            if (evaluatedStr.includes("@")) {
                try {
                    evaluatedStr = Roll.replaceFormulaData(rawVal, rollData).replace(/^[+-]\s*/, "").trim().toLowerCase();
                } catch {
                    // Ignore formula evaluation errors
                }
            }

            // String match after rollData replacement
            if (targetStr && evaluatedStr === targetStr) {
                if (claimedEffectIds) claimedEffectIds.add(effect.id);
                return effect.name;
            }

            // Numeric comparison if target is numeric
            if (hasTargetNum) {
                const evalNum = Number(evaluatedStr);
                if (!isNaN(evalNum) && Math.abs(evalNum) === Math.abs(targetNum)) {
                    if (claimedEffectIds) claimedEffectIds.add(effect.id);
                    return effect.name;
                }
            }
        }
    }

    // Heuristic fallback for Rage / Kampfrausch effects
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        if (claimedEffectIds && claimedEffectIds.has(effect.id)) continue;
        const name = (effect.name ?? "").toLowerCase();
        if (name.includes("rage") || name.includes("kampfrausch")) {
            if (hasTargetNum) {
                const rageScale = actor.system?.scale?.barbarian?.["rage-damage"]?.value
                    ?? actor.system?.scale?.barbarian?.["rage-damage"]
                    ?? null;
                const rageNum = rageScale !== null ? Number(rageScale) : null;
                if (rageNum !== null && !isNaN(rageNum) && Math.abs(rageNum) === Math.abs(targetNum)) {
                    if (claimedEffectIds) claimedEffectIds.add(effect.id);
                    return effect.name;
                }
            }
            if (targetStr.includes("rage")) {
                if (claimedEffectIds) claimedEffectIds.add(effect.id);
                return effect.name;
            }
        }
    }

    return null;
}



/**
 * Strips damage type names from die flavor if the flavor is simply the damage type.
 *
 * @param {string} rawFlavor
 * @param {Roll} roll
 * @returns {string}
 */
export function extractCleanDieFlavor(rawFlavor, roll) {
    if (!rawFlavor) return "";
    const trimmed = String(rawFlavor).trim();
    if (!trimmed) return "";
    const damageType = String(roll?.options?.type ?? "").toLowerCase();
    const typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
    const typeLabels = [
        damageType,
        String(typeConfig?.label ?? "").toLowerCase(),
        String(typeConfig?.labelShort ?? "").toLowerCase()
    ].filter(Boolean);
    if (typeLabels.includes(trimmed.toLowerCase())) return "";
    return trimmed;
}

/**
 * Ability order ranking (standard 5e ability score order: STR, DEX, CON, INT, WIS, CHA).
 * @type {Record<string, number>}
 */
const ABILITY_ORDER = {
    str: 1,
    dex: 2,
    con: 3,
    int: 4,
    wis: 5,
    cha: 6
};

/**
 * Returns the ability rank for a modifier label, or 999 if not an ability modifier.
 *
 * @param {string} label
 * @returns {number}
 */
function getAbilityRank(label) {
    if (!label) return 999;
    const clean = String(label).trim().toLowerCase();
    if (clean in ABILITY_ORDER) return ABILITY_ORDER[clean];
    const firstWord = clean.split(/[\s_-]+/)[0];
    if (firstWord in ABILITY_ORDER) return ABILITY_ORDER[firstWord];
    const threeLetter = clean.slice(0, 3);
    if (threeLetter in ABILITY_ORDER && (clean.length === 3 || clean.startsWith(threeLetter))) {
        return ABILITY_ORDER[threeLetter];
    }
    return 999;
}

/**
 * Sorts breakdown dice rows:
 * 1. Base weapon damage / base d20 at the top.
 * 2. Additional dice sorted alphabetically by flavor/name if present, or denomination.
 *
 * @param {object[]} diceRows
 * @returns {object[]}
 */
export function sortBreakdownDiceRows(diceRows) {
    if (!Array.isArray(diceRows) || diceRows.length <= 1) return diceRows ?? [];

    return diceRows.slice().sort((a, b) => {
        // 1. Base weapon damage / base die at the top
        if (a.isBase && !b.isBase) return -1;
        if (!a.isBase && b.isBase) return 1;

        // 2. Additional dice sorted alphabetically by flavor or denomination
        const labelA = String(a.flavor || a.denomination || "").trim();
        const labelB = String(b.flavor || b.denomination || "").trim();
        return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
    });
}

/**
 * Sorts breakdown modifiers:
 * 1. Dice modifiers (if any remain) before flat modifiers.
 * 2. Ability modifiers at the top (ordered STR, DEX, CON, INT, WIS, CHA).
 * 3. Modifiers sorted alphabetically by modifier name.
 *
 * @param {object[]} modifiers
 * @returns {object[]}
 */
export function sortBreakdownModifiers(modifiers) {
    if (!Array.isArray(modifiers) || modifiers.length <= 1) return modifiers ?? [];

    return modifiers.slice().sort((a, b) => {
        // 1. Dice modifiers always before flat modifiers
        if (a.isDie && !b.isDie) return -1;
        if (!a.isDie && b.isDie) return 1;

        if (a.isDie && b.isDie) {
            const nameA = String(a.rawLabel || a.formula || a.displayLabel || "").trim();
            const nameB = String(b.rawLabel || b.formula || b.displayLabel || "").trim();
            return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
        }

        // 2. Ability modifiers at the top
        const rankA = getAbilityRank(a.rawLabel || a.displayLabel);
        const rankB = getAbilityRank(b.rawLabel || b.displayLabel);
        if (rankA !== rankB) {
            return rankA - rankB;
        }

        // 3. Modifiers sorted alphabetically by modifier name
        const nameA = String(a.displayLabel || a.rawLabel || "").trim();
        const nameB = String(b.displayLabel || b.rawLabel || "").trim();
        return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
    });
}

/**
 * Creates a structured die row representation for breakdown display.
 *
 * @param {DiceTerm} die
 * @param {Roll} roll
 * @param {object} [options={}]
 * @param {boolean} [options.isBase=false]
 * @param {number} [options.currentSign=1]
 * @param {string} [options.fallbackFlavor=""]
 * @returns {object}
 */
function createDieRow(die, roll, { isBase = false, currentSign = 1, actor = null, claimedEffectIds = null } = {}) {
    const isD20 = die instanceof CONFIG.Dice?.D20Die || die.faces === 20;
    const critThreshold = die.options?.criticalSuccess ?? CONFIG.Dice?.D20Die?.CRITICAL_SUCCESS_TOTAL ?? 20;
    const fumbleThreshold = die.options?.criticalFailure ?? CONFIG.Dice?.D20Die?.CRITICAL_FAILURE_TOTAL ?? 1;

    const rolls = die.results?.map(r => {
        const isCrit = isD20 ? r.result >= critThreshold : Boolean(r.critical || die.options?.critical);
        const isFumble = isD20 ? r.result <= fumbleThreshold : Boolean(r.fumble);
        const coreClasses = die.getResultCSS ? die.getResultCSS(r).filterJoin(" ") : (r.discarded ? "discarded" : "");
        const extraClasses = isCrit ? "critical max" : (isFumble ? "fumble min" : "");
        const combinedClasses = [coreClasses, extraClasses].filter(Boolean).join(" ");

        return {
            result: die.getResultLabel ? die.getResultLabel(r) : r.result,
            classes: combinedClasses,
            active: r.active !== false && !r.discarded,
            isCritical: isCrit,
            isFumble: isFumble
        };
    }) ?? [];

    const activeRolls = rolls.filter(r => r.active !== false);
    const discardedRolls = rolls.filter(r => r.active === false);
    const isSingleDie = activeRolls.length === 1 && discardedRolls.length === 0;
    const hasAdvantageOrDisadvantage = activeRolls.length === 1 && discardedRolls.length > 0;
    const isFormula = activeRolls.length > 1;

    const rawFormulaMatch = (die.formula || roll?.formula || "").match(/\[(.*?)\]/);
    const rawFlavor = die.flavor || die.options?.flavor || roll?.options?.flavor || (rawFormulaMatch ? rawFormulaMatch[1] : "");
    let cleanFlavor = extractCleanDieFlavor(rawFlavor, roll);

    if (!cleanFlavor && actor) {
        const expression = die.expression || (die.faces ? `${die.number ?? 1}d${die.faces}` : "");
        const effectName = findActiveEffectForDamageBonus(actor, expression, { claimedEffectIds });
        if (effectName) cleanFlavor = effectName;
    }

    const rawDenom = die.expression || (die.faces ? `d${die.faces}` : "d20");
    const denomination = rawDenom.replace(/\[.*?\]/g, "").trim().toUpperCase();

    const signedTotal = Number(die.total ?? 0) * currentSign;
    const sign = currentSign < 0 ? "-" : "";

    return {
        denomination,
        flavor: cleanFlavor,
        total: signedTotal,
        sign,
        rolls,
        activeRolls,
        discardedRolls,
        isSingleDie,
        singleRoll: isSingleDie ? activeRolls[0] : null,
        hasAdvantageOrDisadvantage,
        isFormula,
        isCritical: Boolean(roll?.isCritical || (isD20 && die.isCriticalSuccess) || die.options?.critical),
        isFumble: Boolean(roll?.isFumble || (isD20 && die.isCriticalFailure)),
        hasAdvantage: Boolean(roll?.hasAdvantage),
        hasDisadvantage: Boolean(roll?.hasDisadvantage),
        isBase
    };
}

/**
 * Generate structured breakdown data for a Roll instance.
 *
 * @param {BasicRoll} roll
 * @param {object} [options={}]
 * @param {boolean} [options.isBase] - Explicit override for whether the primary die is base weapon damage.
 * @returns {Promise<object|null>}
 */
export async function getDetailedRollBreakdown(roll, options = {}) {
    if (!roll?._evaluated) return null;

    const terms = roll.terms ?? [];
    if (!terms.length) return null;

    const actor = options.actor
        ?? roll.parent?.actor
        ?? (roll.parent?.speaker ? ChatMessage.getSpeakerActor(roll.parent.speaker) : null)
        ?? (roll.options?.actor ? game.actors?.get(roll.options.actor) : null)
        ?? null;
    const claimedEffectIds = new Set();

    const diceRows = [];
    const isBase = options.isBase ?? Boolean(roll.options?.base || roll.base);

    // Detect base die (e.g. D20Die or first Die)
    const d20 = roll.d20 ?? (terms[0] instanceof CONFIG.Dice.D20Die ? terms[0] : null);
    let startIndex = 0;

    if (d20) {
        startIndex = 1;
        diceRows.push(createDieRow(d20, roll, { isBase: true, actor, claimedEffectIds }));
    } else if (terms[0] instanceof foundry.dice.terms.Die) {
        startIndex = 1;
        diceRows.push(createDieRow(terms[0], roll, { isBase, actor, claimedEffectIds }));
    }

    // Process subsequent modifier / bonus terms
    const modifiers = [];
    let currentSign = 1;

    for (let i = startIndex; i < terms.length; i++) {
        const term = terms[i];

        if (term instanceof foundry.dice.terms.OperatorTerm) {
            if (term.operator === "-") currentSign = -1;
            else if (term.operator === "+") currentSign = 1;
            continue;
        }

        // Dice terms become dice rows
        if (term instanceof foundry.dice.terms.DiceTerm) {
            diceRows.push(createDieRow(term, roll, { isBase: false, currentSign, actor, claimedEffectIds }));
            currentSign = 1;
            continue;
        }

        // Parenthetical terms with dice become dice rows
        if (term instanceof foundry.dice.terms.ParentheticalTerm && term.dice?.length) {
            for (const d of term.dice) {
                diceRows.push(createDieRow(d, roll, { isBase: false, currentSign, actor, claimedEffectIds }));
            }
            currentSign = 1;
            continue;
        }

        const termTotal = Number(term.total ?? 0);
        const signedTotal = termTotal * currentSign;
        const signStr = signedTotal >= 0 ? "+" : "-";
        const absVal = Math.abs(signedTotal);

        let label = term.flavor ? term.flavor.trim() : (term.options?.flavor ? String(term.options.flavor).trim() : "");
        if (label) {
            const abilityMatch = label.match(/^(STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:\s+(?:bonus|penalty))?$/i);
            if (abilityMatch) {
                const key = abilityMatch[1].slice(0, 3).toLowerCase();
                label = ABILITY_SHORTHANDS[key] ?? key.toUpperCase();
            } else if (/^Magic Weapon(?:\s+bonus)?$/i.test(label)) {
                label = "MGC";
            }
        }

        if (!label && actor) {
            const effectName = findActiveEffectForDamageBonus(actor, absVal, {
                roll,
                claimedEffectIds
            });
            if (effectName) {
                label = effectName;
            }
        }

        const displayLabel = label || "Modifier";

        modifiers.push({
            sign: signStr,
            absVal,
            signedTotal,
            formattedValue: `${signStr}${absVal}`,
            label: label ? `(${label})` : "",
            displayLabel,
            rawLabel: label,
            isPositive: signedTotal >= 0,
            isDie: false
        });

        // Reset sign for next value
        currentSign = 1;
    }

    const sortedDice = sortBreakdownDiceRows(diceRows);
    const sortedMods = sortBreakdownModifiers(modifiers);

    const damageType = roll.options?.type;
    const typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
    const typeLabel = typeConfig?.labelShort ?? typeConfig?.label ?? (damageType ? damageType.toUpperCase() : "");
    const typeIcon = typeConfig?.icon ?? null;
    const typeColor = getDamageTypeColor(damageType);
    const totalLabel = game.i18n.localize("DND5E.PropertyTotal") || game.i18n.localize("ND5T.RollBreakdownDetails.Total") || "Total";

    return {
        baseDie: sortedDice[0] ?? null,
        diceRows: sortedDice,
        modifiers: sortedMods,
        total: roll.total,
        totalLabel,
        damageType,
        typeLabel,
        typeIcon,
        typeColor
    };
}

/**
 * Wrap BasicRoll#getTooltip to render the detailed breakdown overlay when enabled.
 */
function wrapBasicRollGetTooltip() {
    if (!CONFIG.Dice?.BasicRoll) return;

    const originalGetTooltip = CONFIG.Dice.BasicRoll.prototype.getTooltip;

    CONFIG.Dice.BasicRoll.prototype.getTooltip = async function() {
        if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) {
            return originalGetTooltip.call(this);
        }

        try {
            const breakdownData = await getDetailedRollBreakdown(this);
            if (breakdownData) {
                return await foundry.applications.handlebars.renderTemplate(
                    "modules/niks-dnd5e-tweaks/templates/chat/roll-breakdown-details.hbs",
                    breakdownData
                );
            }
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Error rendering detailed roll breakdown:", err);
        }

        return originalGetTooltip.call(this);
    };
}

/**
 * Monkey patch DamageApplicationElement#calculateDamage to guard against undefined actor references.
 * In DnD5e 6.x, if an unlinked token or missing actor is targeted, calculateDamage throws:
 * "TypeError: Cannot read properties of undefined (reading 'calculateDamage')"
 * causing chat render loops and console errors.
 */
export function patchDamageApplicationCalculateDamage() {
    const DamageApplication = customElements.get("damage-application");
    if (!DamageApplication) {
        if (customElements.whenDefined) {
            customElements.whenDefined("damage-application").then(() => {
                patchDamageApplicationCalculateDamage();
            });
        }
        return;
    }
    if (DamageApplication.prototype._nd5tPatchedCalculateDamage) return;

    const originalCalculateDamage = DamageApplication.prototype.calculateDamage;
    DamageApplication.prototype.calculateDamage = function(actor, options = {}) {
        if (!actor?.calculateDamage) {
            return {
                active: {
                    modification: new Set(),
                    resistance: new Set(),
                    vulnerability: new Set(),
                    immunity: new Set(),
                    threshold: false
                },
                temp: 0,
                tempMax: 0,
                total: 0
            };
        }
        return originalCalculateDamage.call(this, actor, options);
    };
    DamageApplication.prototype._nd5tPatchedCalculateDamage = true;
    log("Patched DamageApplicationElement#calculateDamage for actor safety");
}

/**
 * Intercepts damage chat messages and injects the Detailed Roll Breakdown overlay
 * into .icon-row > .roll-breakdown[popover].
 *
 * In DnD5e 6.x, damage-card.hbs statically renders {{> "dnd5e.damage-breakdown" }}
 * directly inside .roll-breakdown[popover] without calling roll.getTooltip().
 * This function consolidates damage rolls by damage type, sorting all dice at the top
 * (starting with base weapon damage) and modifiers below (starting with ability modifiers,
 * then alphabetical).
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement|JQuery} html
 */
export async function enhanceDamageChatMessageBreakdown(message, html) {
    if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
    if (!message?.rolls?.length) return;

    const isDamageMsg = message.system?.constructor?.name === "DamageMessageData"
        || (CONFIG.ChatMessage?.dataModels?.damage && message.system instanceof CONFIG.ChatMessage.dataModels.damage);
    const damageRolls = message.rolls.filter(r => (CONFIG.Dice?.DamageRoll && r instanceof CONFIG.Dice.DamageRoll) || isDamageMsg);
    if (!damageRolls.length) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const breakdownEl = root.querySelector(".icon-row > .roll-breakdown[popover]");
    if (!breakdownEl) return;

    // Avoid duplicate work if already enhanced
    if (breakdownEl.querySelector(".nd5t-roll-breakdown")) return;

    // Fast-path: use cached rendered HTML if available
    if (message._nd5tBreakdownHtml) {
        breakdownEl.innerHTML = message._nd5tBreakdownHtml;
        return;
    }

    try {
        const item = message.item ?? null;
        const isWeapon = item?.type === "weapon";
        const actor = message.actor
            ?? (message.speaker ? ChatMessage.getSpeakerActor(message.speaker) : null)
            ?? null;
        const typeMap = new Map();

        for (let i = 0; i < damageRolls.length; i++) {
            const roll = damageRolls[i];
            if (!roll.parent) roll.parent = message;

            const isBase = Boolean(roll.options?.base || roll.base || (isWeapon && i === 0));
            const data = await getDetailedRollBreakdown(roll, { isBase, actor });
            if (!data) continue;

            const damageType = String(roll.options?.type ?? "untyped").toLowerCase();
            if (!typeMap.has(damageType)) {
                const typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
                const typeLabel = typeConfig?.labelShort ?? typeConfig?.label ?? (damageType !== "untyped" ? damageType.toUpperCase() : "");
                const typeIcon = typeConfig?.icon ?? null;
                const typeColor = getDamageTypeColor(damageType);

                typeMap.set(damageType, {
                    damageType,
                    typeLabel,
                    typeIcon,
                    typeColor,
                    diceRows: [],
                    modifiers: [],
                    sectionTotal: 0
                });
            }

            const group = typeMap.get(damageType);
            if (data.diceRows?.length) {
                group.diceRows.push(...data.diceRows);
            }
            if (data.modifiers?.length) {
                group.modifiers.push(...data.modifiers);
            }
            group.sectionTotal += Number(roll.total ?? 0);
        }

        if (!typeMap.size) return;

        const totalLabel = game.i18n.localize("DND5E.PropertyTotal") || game.i18n.localize("ND5T.RollBreakdownDetails.Total") || "Total";

        const sections = Array.from(typeMap.values()).map(group => {
            const sortedDice = sortBreakdownDiceRows(group.diceRows);
            const sortedMods = sortBreakdownModifiers(group.modifiers);
            return {
                damageType: group.damageType,
                typeLabel: group.typeLabel,
                typeTotalLabel: `${group.typeLabel} ${totalLabel}`,
                typeIcon: group.typeIcon,
                typeColor: group.typeColor,
                baseDie: sortedDice[0] ?? null,
                diceRows: sortedDice,
                modifiers: sortedMods,
                sectionTotal: group.sectionTotal
            };
        });

        const grandTotal = damageRolls.reduce((sum, r) => sum + Math.max(0, Number(r.total ?? 0)), 0);

        const rendered = await foundry.applications.handlebars.renderTemplate(
            "modules/niks-dnd5e-tweaks/templates/chat/roll-breakdown-details.hbs",
            {
                isDamageCard: true,
                sections,
                hasMultipleSections: sections.length > 1,
                total: grandTotal,
                totalLabel
            }
        );

        message._nd5tBreakdownHtml = rendered;
        breakdownEl.innerHTML = rendered;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error enhancing damage chat message breakdown:", err);
    }
}

let isInitialized = false;

/**
 * Trigger lazy rendering for a popover element if not yet populated.
 * @param {HTMLElement} popoverEl
 */
async function _ensurePopoverBreakdown(popoverEl) {
    if (!popoverEl?.matches?.(".icon-row > .roll-breakdown[popover]")) return;
    if (popoverEl.querySelector(".nd5t-roll-breakdown")) return;
    if (popoverEl._nd5tBreakdownLoading) return;
    popoverEl._nd5tBreakdownLoading = true;
    try {
        const chatCard = popoverEl.closest(".chat-message[data-message-id]");
        if (!chatCard) return;
        const msgId = chatCard.dataset.messageId;
        const message = game.messages?.get(msgId);
        if (message) await enhanceDamageChatMessageBreakdown(message, chatCard);
    } finally {
        popoverEl._nd5tBreakdownLoading = false;
    }
}

/**
 * Initialize the Detailed Roll Breakdown Overlay feature.
 */
export function initRollBreakdownDetails() {
    patchDamageApplicationCalculateDamage();

    if (isInitialized) return;
    isInitialized = true;

    log("Initializing Detailed Roll Breakdown Overlay");

    // Tier 1: Proactive formula tagging during roll construction
    Hooks.on("dnd5e.postBuildRollConfig", (processConfig, rollConfig, index) => {
        tagRollConfigParts(processConfig, rollConfig, index);
    });
    Hooks.on("dnd5e.postBuildDamageRollConfig", (processConfig, rollConfig, index) => {
        tagRollConfigParts(processConfig, rollConfig, index);
    });

    // Tier 2 & 3: Enhanced breakdown rendering for BasicRoll (d20 rolls, checks, saves)
    wrapBasicRollGetTooltip();

    // Lazy on-demand popover rendering: populate breakdown strictly when the popover is opened or clicked.
    // Avoids eagerly compiling and rendering Handlebars templates across hundreds of historical messages.
    if (typeof document !== "undefined") {
        document.addEventListener("beforetoggle", (event) => {
            if (event.newState !== "open") return;
            _ensurePopoverBreakdown(event.target);
        }, { capture: true });

        document.addEventListener("pointerdown", (event) => {
            const btn = event.target?.closest?.('.icon-row button.dice-roll, .icon-row button[popovertarget], .icon-row [popovertarget]');
            if (!btn) return;
            const targetId = btn.getAttribute?.("popovertarget");
            const popover = btn.popoverTargetElement
                ?? (targetId ? document.getElementById(targetId) : null)
                ?? (btn.nextElementSibling?.matches?.(".roll-breakdown[popover]") ? btn.nextElementSibling : null)
                ?? btn.parentElement?.querySelector?.(".roll-breakdown[popover]");
            if (popover) _ensurePopoverBreakdown(popover);
        }, { capture: true });
    }
}
