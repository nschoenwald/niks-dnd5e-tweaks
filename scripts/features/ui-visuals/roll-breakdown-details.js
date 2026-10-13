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
 * Known spell / condition names for common bonus dice denominations.
 * @type {Record<number, string[]>}
 */
const COMMON_DICE_EFFECTS = {
    4: ["Bless", "Guidance", "Bane", "Emboldening Bond", "Peace Cleric"],
    6: ["Bardic Inspiration", "Battle Master", "Maneuver", "Hunter's Mark", "Hex"],
    8: ["Bardic Inspiration", "Battle Master"],
    10: ["Bardic Inspiration", "Battle Master"],
    12: ["Bardic Inspiration"]
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
    const actor = processConfig?.subject?.actor ?? (processConfig?.subject instanceof Actor ? processConfig.subject : null);

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

        if (trimmed === "@mod") {
            return `@mod[${abilityLabel}]`;
        }

        const abilityModMatch = trimmed.match(/^@abilities\.([a-z]{3})\.mod$/i);
        if (abilityModMatch) {
            const abl = ABILITY_SHORTHANDS[abilityModMatch[1].toLowerCase()] ?? abilityModMatch[1].toUpperCase();
            return `${trimmed}[${abl}]`;
        }

        if (trimmed === "@prof") {
            return `@prof[${pbLabel}]`;
        }

        if (trimmed === "@toHit") {
            return "@toHit[Attack Bonus]";
        }

        if (trimmed === "@extraBonus") {
            return "@extraBonus[Bonus]";
        }

        if (trimmed === "@weaponMagic" || trimmed === "@magicalBonus") {
            return `${trimmed}[MGC]`;
        }

        if (trimmed === "@ammoMagic" || trimmed === "@ammoBonus") {
            return `${trimmed}[Magic Ammo]`;
        }

        if (trimmed === "@cover") {
            const coverVal = Number(data.cover ?? 0);
            const coverText = coverVal === 2 ? "Half Cover" : (coverVal === 5 ? "Three-Quarters Cover" : "Cover");
            return `@cover[${coverText}]`;
        }

        if (trimmed.startsWith("@scale.")) {
            const scaleKey = trimmed.replace("@scale.", "");
            if (scaleKey.includes("rage")) return `${trimmed}[Rage]`;
            if (scaleKey.includes("sneak-attack")) return `${trimmed}[Sneak Attack]`;
            if (scaleKey.includes("divine-strike")) return `${trimmed}[Divine Strike]`;
            if (scaleKey.includes("brutal-strike")) return `${trimmed}[Brutal Strike]`;
            if (scaleKey.includes("inspiration")) return `${trimmed}[Bardic Inspiration]`;
            const parts = scaleKey.split(".");
            const lastPart = parts[parts.length - 1].replace(/-/g, " ");
            return `${trimmed}[${lastPart.capitalize()}]`;
        }

        if (trimmed.startsWith("@reductions.")) {
            const statusKey = trimmed.replace("@reductions.", "");
            if (statusKey === "exhaustion") {
                return `@reductions.exhaustion[Exhaustion ${exhaustionLevel}]`;
            }
            const statusLabel = CONFIG.DND5E?.conditionTypes?.[statusKey]?.label
                ? game.i18n.localize(CONFIG.DND5E.conditionTypes[statusKey].label)
                : statusKey.capitalize();
            return `@reductions.${statusKey}[${statusLabel}]`;
        }

        if (trimmed === "@situational") {
            return "@situational[Situational]";
        }

        if (trimmed === "@bonus") {
            return "@bonus[Item Bonus]";
        }

        if (trimmed === "@ruleBonus") {
            const effectName = detectActiveEffectSource(actor, data.ruleBonus, processConfig);
            return effectName ? `@ruleBonus[${effectName}]` : "@ruleBonus[Bonus]";
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

    // Check active effects for matching changes
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        for (const change of effect.changes ?? []) {
            const val = String(change.value ?? "").toLowerCase().trim();
            if (val === bonusStr || (bonusStr && val.includes(bonusStr))) {
                return effect.name;
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
 * Deduce label source for a numeric or parenthetical term if term.flavor is empty.
 *
 * @param {NumericTerm|ParentheticalTerm} term
 * @param {number} currentSign
 * @param {BasicRoll} roll
 * @param {Actor5e|null} actor
 * @param {Item5e|null} item
 * @param {object|null} activity
 * @param {Set<string>} [usedSources=new Set()] - Set of source identifiers already matched to avoid duplicate claims.
 * @returns {string}
 */
function inferNumericBonusSource(term, currentSign, roll, actor, item, activity, usedSources = new Set()) {
    const num = Math.abs(Number(term.number ?? term.total ?? 0));
    const data = roll.data ?? {};

    // 1. Ability Modifier
    if (!usedSources.has("mod") && data.mod !== undefined && Math.abs(Number(data.mod)) === num) {
        usedSources.add("mod");
        const rawAbility = data.roll?.ability || roll.options?.ability || activity?.ability || item?.system?.ability || "mod";
        const abilityKey = String(rawAbility).toLowerCase();
        return ABILITY_SHORTHANDS[abilityKey] ?? abilityKey.toUpperCase();
    }

    // 2. Proficiency Bonus (including Expertise and Half-Proficiency)
    if (!usedSources.has("prof") && data.prof !== undefined) {
        const profVal = Number(data.prof);
        if (profVal === num) {
            usedSources.add("prof");
            const isExpertise = Number(data.roll?.proficient) === 2;
            return isExpertise ? "PB (Expertise)" : "PB";
        }
        if (profVal * 2 === num) {
            usedSources.add("prof");
            return "PB (Expertise)";
        }
        if (profVal * 0.5 === num || Math.floor(profVal * 0.5) === num) {
            usedSources.add("prof");
            return "PB (Half)";
        }
    }

    // 3. Flat Attack Bonus (@toHit)
    if (!usedSources.has("toHit") && data.toHit !== undefined && Math.abs(Number(data.toHit)) === num) {
        usedSources.add("toHit");
        return "Attack Bonus";
    }

    // 4. Exhaustion
    if (!usedSources.has("exhaustion") && data.reductions?.exhaustion !== undefined && Math.abs(Number(data.reductions.exhaustion)) === num) {
        usedSources.add("exhaustion");
        const exLevel = actor?.system?.attributes?.exhaustion ?? 1;
        return `Exhaustion ${exLevel}`;
    }
    if (!usedSources.has("exhaustion") && currentSign === -1 && actor?.system?.attributes?.exhaustion) {
        const exLevel = actor.system.attributes.exhaustion;
        if (num === exLevel * 2 || num === exLevel) {
            usedSources.add("exhaustion");
            return `Exhaustion ${exLevel}`;
        }
    }

    // 5. Magic Weapon / Ammo Bonus
    if (!usedSources.has("weaponMagic") && (data.magicalBonus !== undefined || data.weaponMagic !== undefined)) {
        const val = Number(data.magicalBonus ?? data.weaponMagic);
        if (val === num) {
            usedSources.add("weaponMagic");
            return "MGC";
        }
    }
    if (!usedSources.has("ammoMagic") && (data.ammoBonus !== undefined || data.ammoMagic !== undefined)) {
        const val = Number(data.ammoBonus ?? data.ammoMagic);
        if (val === num) {
            usedSources.add("ammoMagic");
            return "Magic Ammo";
        }
    }
    if (!usedSources.has("weaponMagic") && item?.system?.magicalBonus !== undefined && Number(item.system.magicalBonus) === num) {
        usedSources.add("weaponMagic");
        return "MGC";
    }

    // 6. Cover
    if (!usedSources.has("cover") && data.cover !== undefined && Number(data.cover) === num) {
        usedSources.add("cover");
        return num === 2 ? "Half Cover" : (num === 5 ? "Three-Quarters Cover" : "Cover");
    }

    // 7. Situational Bonus
    if (!usedSources.has("situational") && data.situational !== undefined && Number(data.situational) === num) {
        usedSources.add("situational");
        return "Situational";
    }

    // 8. Extra Bonus (from skill/check prompt)
    if (!usedSources.has("extraBonus") && data.extraBonus !== undefined && Number(data.extraBonus) === num) {
        usedSources.add("extraBonus");
        return "Bonus";
    }

    // 9. Item Attack / Damage Bonus
    if (!usedSources.has("bonus") && data.bonus !== undefined && Number(data.bonus) === num) {
        usedSources.add("bonus");
        return "Item Bonus";
    }

    // 10. Barbarian Rage scaling damage
    if (!usedSources.has("rage") && actor?.system?.scale?.barbarian?.["rage-damage"]?.value !== undefined) {
        const rageVal = Number(actor.system.scale.barbarian["rage-damage"].value);
        if (rageVal === num) {
            usedSources.add("rage");
            return "Rage";
        }
    }

    // 11. Actor Active Effects / Features check
    if (actor) {
        const effectName = detectActiveEffectSource(actor, num, { subject: activity ?? item ?? actor });
        if (effectName && !usedSources.has(effectName)) {
            usedSources.add(effectName);
            return effectName;
        }
    }

    return "";
}

/**
 * Deduce label source for a dice term if term.flavor is empty.
 *
 * @param {DiceTerm} term
 * @param {Actor5e|null} actor
 * @param {object|null} activity
 * @param {BasicRoll} roll
 * @returns {string}
 */
function inferDiceBonusSource(term, actor, activity, roll) {
    if (activity?.name && !activity.name.toLowerCase().includes("attack") && !activity.name.toLowerCase().includes("damage")) {
        return activity.name;
    }

    if (!actor) return `${term.expression} Bonus`;

    const effects = actor.appliedEffects ?? Array.from(actor.effects?.values() ?? []);

    // 1. Inspect actor effect changes directly for matching dice formula
    const expr = term.expression?.toLowerCase() ?? "";
    const denom = `d${term.faces}`;
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        for (const change of effect.changes ?? []) {
            const val = String(change.value ?? "").toLowerCase().trim();
            if (val.includes(expr) || val.includes(denom)) {
                return effect.name;
            }
        }
    }

    // 2. Fall back to common spell names heuristic
    const candidates = COMMON_DICE_EFFECTS[term.faces] ?? [];
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        const effectName = effect.name ?? "";
        for (const candidate of candidates) {
            if (effectName.toLowerCase().includes(candidate.toLowerCase())) {
                return effectName;
            }
        }
    }

    return `${term.expression} Bonus`;
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
function createDieRow(die, roll, { isBase = false, currentSign = 1, fallbackFlavor = "" } = {}) {
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
    const rawFlavor = die.flavor || die.options?.flavor || (rawFormulaMatch ? rawFormulaMatch[1] : "") || fallbackFlavor;
    const cleanFlavor = extractCleanDieFlavor(rawFlavor, roll);

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

    // Retrieve context with resilient ChatMessage fallback (crucial for page reload and non-rolling clients)
    const message = roll.parent
        ?? (roll.options?.originatingMessage ? game.messages?.get(roll.options.originatingMessage) : null)
        ?? game.messages?.find(m => m.rolls?.includes(roll))
        ?? null;

    if (message && !roll.parent) roll.parent = message;

    const actor = message?.actor ?? (message?.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
    const item = message?.item ?? null;
    const activity = message?.system?.activity ?? null;

    const terms = roll.terms ?? [];
    if (!terms.length) return null;

    const diceRows = [];
    const isBase = options.isBase ?? Boolean(roll.options?.base || roll.base);

    // Detect base die (e.g. D20Die or first Die)
    const d20 = roll.d20 ?? (terms[0] instanceof CONFIG.Dice.D20Die ? terms[0] : null);
    let startIndex = 0;

    if (d20) {
        startIndex = 1;
        diceRows.push(createDieRow(d20, roll, { isBase: true }));
    } else if (terms[0] instanceof foundry.dice.terms.Die) {
        startIndex = 1;
        diceRows.push(createDieRow(terms[0], roll, { isBase }));
    }

    // Process subsequent modifier / bonus terms
    const modifiers = [];
    const usedSources = new Set();
    let currentSign = 1;

    // Pre-populate usedSources from terms that already have flavor brackets
    const ABILITY_KEYS = new Set(Object.values(ABILITY_SHORTHANDS).map(a => a.toLowerCase()));
    for (let i = startIndex; i < terms.length; i++) {
        const term = terms[i];
        if (term.flavor) {
            const flv = term.flavor.toLowerCase().trim();
            if (ABILITY_KEYS.has(flv) || flv.includes("ability") || ABILITY_KEYS.has(flv.split(" ")[0])) usedSources.add("mod");
            if (flv === "pb" || flv.startsWith("pb ")) usedSources.add("prof");
            if (flv.includes("exhaustion")) usedSources.add("exhaustion");
            if (flv === "mgc" || flv.includes("magic weapon")) usedSources.add("weaponMagic");
            if (flv.includes("magic ammo")) usedSources.add("ammoMagic");
            if (flv.includes("cover")) usedSources.add("cover");
            if (flv.includes("situational")) usedSources.add("situational");
            if (flv.includes("attack bonus")) usedSources.add("toHit");
            if (flv.includes("rage")) usedSources.add("rage");
        }
    }

    for (let i = startIndex; i < terms.length; i++) {
        const term = terms[i];

        if (term instanceof foundry.dice.terms.OperatorTerm) {
            if (term.operator === "-") currentSign = -1;
            else if (term.operator === "+") currentSign = 1;
            continue;
        }

        // Dice terms become dice rows
        if (term instanceof foundry.dice.terms.DiceTerm) {
            const fallbackFlavor = inferDiceBonusSource(term, actor, activity, roll);
            diceRows.push(createDieRow(term, roll, { isBase: false, currentSign, fallbackFlavor }));
            currentSign = 1;
            continue;
        }

        // Parenthetical terms with dice become dice rows
        if (term instanceof foundry.dice.terms.ParentheticalTerm && term.dice?.length) {
            for (const d of term.dice) {
                const fallbackFlavor = inferDiceBonusSource(d, actor, activity, roll);
                diceRows.push(createDieRow(d, roll, { isBase: false, currentSign, fallbackFlavor }));
            }
            currentSign = 1;
            continue;
        }

        const termTotal = Number(term.total ?? 0);
        const signedTotal = termTotal * currentSign;
        const signStr = signedTotal >= 0 ? "+" : "-";
        const absVal = Math.abs(signedTotal);

        let label = term.flavor ? term.flavor.trim() : "";
        if (label) {
            const abilityMatch = label.match(/^(STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:\s+(?:bonus|penalty))?$/i);
            if (abilityMatch) {
                const key = abilityMatch[1].slice(0, 3).toLowerCase();
                label = ABILITY_SHORTHANDS[key] ?? key.toUpperCase();
            } else if (/^Magic Weapon(?:\s+bonus)?$/i.test(label)) {
                label = "MGC";
            }
        }

        if (term instanceof foundry.dice.terms.NumericTerm) {
            if (!label) {
                label = inferNumericBonusSource(term, currentSign, roll, actor, item, activity, usedSources);
            }
        } else if (term instanceof foundry.dice.terms.ParentheticalTerm) {
            if (!label) {
                label = inferNumericBonusSource(term, currentSign, roll, actor, item, activity, usedSources);
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

    try {
        const item = message.item ?? null;
        const isWeapon = item?.type === "weapon";
        const typeMap = new Map();

        for (let i = 0; i < damageRolls.length; i++) {
            const roll = damageRolls[i];
            if (!roll.parent) roll.parent = message;

            const isBase = Boolean(roll.options?.base || roll.base || (isWeapon && i === 0));
            const data = await getDetailedRollBreakdown(roll, { isBase });
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

        const sections = Array.from(typeMap.values()).map(group => {
            const sortedDice = sortBreakdownDiceRows(group.diceRows);
            const sortedMods = sortBreakdownModifiers(group.modifiers);
            return {
                damageType: group.damageType,
                typeLabel: group.typeLabel,
                typeIcon: group.typeIcon,
                typeColor: group.typeColor,
                baseDie: sortedDice[0] ?? null,
                diceRows: sortedDice,
                modifiers: sortedMods,
                sectionTotal: group.sectionTotal
            };
        });

        const grandTotal = damageRolls.reduce((sum, r) => sum + Math.max(0, Number(r.total ?? 0)), 0);
        const totalLabel = game.i18n.localize("DND5E.PropertyTotal") || game.i18n.localize("ND5T.RollBreakdownDetails.Total") || "Total";

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

        breakdownEl.innerHTML = rendered;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error enhancing damage chat message breakdown:", err);
    }
}

let isInitialized = false;

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

    // Tier 2 & 3: Enhanced breakdown rendering for BasicRoll (d20 rolls, checks, saves)
    wrapBasicRollGetTooltip();

    // Damage cards breakdown enhancement
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        enhanceDamageChatMessageBreakdown(message, html);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        enhanceDamageChatMessageBreakdown(message, html);
    });

    // Native browser popover listener as safety net for already rendered cards
    if (typeof document !== "undefined") {
        document.addEventListener("beforetoggle", (event) => {
            const popover = event.target;
            if (!popover?.matches?.(".icon-row > .roll-breakdown[popover]")) return;
            if (popover.querySelector(".nd5t-roll-breakdown")) return;
            const chatCard = popover.closest(".chat-message[data-message-id]");
            if (!chatCard) return;
            const msgId = chatCard.dataset.messageId;
            const message = game.messages?.get(msgId);
            if (message) enhanceDamageChatMessageBreakdown(message, chatCard);
        }, { capture: true });
    }
}
