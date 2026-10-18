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
    any: "#e2e8f0",
    untyped: "#e2e8f0",
    pure: "#e2e8f0"
});

/**
 * Built-in pure/untyped damage icon asset path.
 * @type {string}
 */
export const PURE_DAMAGE_ICON = "systems/dnd5e/icons/svg/damage/all.svg";


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
 * Determine if a roll or roll config represents a damage or healing roll.
 *
 * @param {Roll|object} roll
 * @returns {boolean}
 */
export function isDamageRoll(roll) {
    if (!roll) return false;
    // D20 rolls (attacks, saves, checks) are never damage rolls in D&D 5e
    if (CONFIG.Dice?.D20Roll && (roll instanceof CONFIG.Dice.D20Roll)) return false;
    const type = roll.options?.type;
    if (type && ["attack", "save", "check", "skill", "tool", "initiative", "death", "concentration"].includes(type)) return false;
    if (CONFIG.Dice?.DamageRoll && (roll instanceof CONFIG.Dice.DamageRoll)) return true;
    if (roll.options?.rollType === "damage" || type === "damage") return true;
    if (roll.data?.roll?.type === "damage" || String(roll.options?.flavor ?? "").toLowerCase().includes("damage")) return true;
    if (type && type !== "initiative" && Boolean(CONFIG.DND5E?.damageTypes?.[type] || CONFIG.DND5E?.healingTypes?.[type])) return true;
    if (Array.isArray(roll.options?.types) && roll.options.types.some(t => CONFIG.DND5E?.damageTypes?.[t] || CONFIG.DND5E?.healingTypes?.[t])) return true;
    if (Array.isArray(roll.hookNames) && roll.hookNames.some(h => String(h).toLowerCase().includes("damage"))) return true;
    return false;
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

    const hookNames = (Array.isArray(processConfig?.hookNames) ? processConfig.hookNames : []).map(h => String(h).toLowerCase());
    const rollType = String(rollConfig?.options?.type ?? data.roll?.type ?? "").toLowerCase();
    const isInitiative = hookNames.includes("initiativedialog")
        || hookNames.includes("initiative")
        || rollType === "initiative"
        || String(rollConfig?.options?.flavor ?? "").toLowerCase().includes("initiative");

    const isDamage = !isInitiative && Boolean(
        hookNames.includes("damage")
        || (rollType && Boolean(CONFIG.DND5E?.damageTypes?.[rollType] || CONFIG.DND5E?.healingTypes?.[rollType]))
        || (Array.isArray(rollConfig?.options?.types) && rollConfig.options.types.some(t => CONFIG.DND5E?.damageTypes?.[t] || CONFIG.DND5E?.healingTypes?.[t]))
        || (processConfig?.subject?.type === "damage")
    );

    // Identify ability shorthand
    let rawAbility = data.roll?.ability
        || rollConfig.options?.ability
        || processConfig?.ability
        || processConfig?.subject?.attack?.ability
        || processConfig?.subject?.ability
        || processConfig?.subject?.item?.system?.ability
        || null;

    if (!rawAbility && actor?.system?.abilities && data.mod !== undefined) {
        const modNum = Number(data.mod);
        const matchedKey = Object.keys(ABILITY_SHORTHANDS).find(key => actor.system.abilities[key]?.mod === modNum);
        if (matchedKey) rawAbility = matchedKey;
    }

    const abilityKey = String(rawAbility || "mod").toLowerCase();
    const abilityLabel = ABILITY_SHORTHANDS[abilityKey] ?? (abilityKey === "mod" ? "MOD" : abilityKey.toUpperCase());

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
    const claimedEffectIds = new Set();
    rollConfig.parts = rollConfig.parts.map(part => {
        if (typeof part !== "string") return part;
        const trimmed = part.trim();

        // If part already has flavor bracket, do not re-tag
        if (trimmed.includes("[") && trimmed.includes("]")) return part;

        // Extract any leading sign e.g. "+@scale.barbarian.rage-damage", "+4", "-2"
        const signMatch = trimmed.match(/^([+-])\s*(.*)$/);
        const sign = signMatch ? signMatch[1] : "";
        let clean = signMatch ? signMatch[2].trim() : trimmed;

        let modified = false;

        // Attribute tags must only match standalone terms or arithmetic operands (+, -, *, /, %, or in parentheses/commas).
        // They must never match attributes inside dice term definitions or modifiers (e.g. exploding dice "1d8x@mod=8",
        // keep dice "1d8kh@mod", reroll "1d8ro<=@mod", faces "1d@mod", or count "(@mod)d6").
        const lookbehind = "(?<=^|[\\s+\\-*/(%])";
        const lookahead = "(?=$|[\\s+\\-*/%,]|\\)(?!\\s*[dD]))";

        const modRegex = new RegExp(`${lookbehind}@mod${lookahead}`, "g");
        const replacedMod = clean.replace(modRegex, `@mod[${abilityLabel}]`);
        if (replacedMod !== clean) {
            clean = replacedMod;
            modified = true;
        }

        const ablRegex = new RegExp(`${lookbehind}@abilities\\.([a-z]{3})\\.mod${lookahead}`, "gi");
        const replacedAbl = clean.replace(ablRegex, (match, ablKey) => {
            const abl = ABILITY_SHORTHANDS[ablKey.toLowerCase()] ?? ablKey.toUpperCase();
            return `${match}[${abl}]`;
        });
        if (replacedAbl !== clean) {
            clean = replacedAbl;
            modified = true;
        }

        const profRegex = new RegExp(`${lookbehind}@prof${lookahead}`, "g");
        if (profRegex.test(clean)) {
            const isPartExpertise = /\*\s*2\b/.test(clean) || /\b2\s*\*/.test(clean) || isExpertise;
            const isPartHalf = /\/\s*2\b/.test(clean) || /\*\s*0?\.5\b/.test(clean) || isHalf;
            const targetPbLabel = isPartExpertise ? "PB (Expertise)" : (isPartHalf ? "PB (Half)" : pbLabel);
            const replacedProf = clean.replace(new RegExp(`${lookbehind}@prof${lookahead}`, "g"), `@prof[${targetPbLabel}]`);
            if (replacedProf !== clean) {
                clean = replacedProf;
                modified = true;
            }
        }

        if (clean === "@toHit") {
            clean = `${clean}[Attack Bonus]`;
            modified = true;
        }

        if (clean === "@extraBonus") {
            const extraVal = String(data.extraBonus ?? "").trim();
            if (!extraVal.includes("[")) {
                clean = `${clean}[Bonus]`;
                modified = true;
            }
        }

        if (clean === "@weaponMagic" || clean === "@magicalBonus") {
            clean = `${clean}[MGC]`;
            modified = true;
        }

        if (clean === "@ammoMagic" || clean === "@ammoBonus") {
            clean = `${clean}[Magic Ammo]`;
            modified = true;
        }

        if (clean === "@cover") {
            const coverVal = Number(data.cover ?? 0);
            const coverText = coverVal === 2 ? "Half Cover" : (coverVal === 5 ? "Three-Quarters Cover" : "Cover");
            clean = `${clean}[${coverText}]`;
            modified = true;
        }

        const scaleRegex = new RegExp(`${lookbehind}@scale\\.([\\w.-]+)${lookahead}`, "g");
        if (scaleRegex.test(clean)) {
            let scaleHandled = false;
            clean = clean.replace(new RegExp(`${lookbehind}@scale\\.([\\w.-]+)${lookahead}`, "g"), (match, scaleKey) => {
                const scaleVal = foundry.utils.getProperty(data, `scale.${scaleKey}`) ?? "";
                if (String(scaleVal).includes("[")) return match;

                let tag = null;
                if (scaleKey.includes("rage")) {
                    const effectName = (actor && isDamage) ? findActiveEffectForDamageBonus(actor, match, { rollData: data, isDamageRoll: isDamage, claimedEffectIds }) : null;
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
                scaleHandled = true;
                return `${match}[${tag}]`;
            });
            if (scaleHandled) modified = true;
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
            const sitVal = String(data.situational ?? "").trim();
            // If the user already provided their own flavor brackets (e.g. 1d6[necrotic]), don't append [Situational]
            // which causes double-bracket syntax errors in Foundry's RollParser: 1d6[necrotic][Situational]
            if (sitVal.includes("[")) return part;
            clean = `${clean}[Situational]`;
            modified = true;
        }

        if (clean === "@bonus") {
            const bonusVal = String(data.bonus ?? "").trim();
            if (bonusVal.includes("[")) return part;
            clean = `${clean}[Item Bonus]`;
            modified = true;
        }

        if (clean === "@ruleBonus") {
            const ruleVal = String(data.ruleBonus ?? "").trim();
            if (ruleVal.includes("[")) return part;
            const effectName = detectActiveEffectSource(actor, data.ruleBonus, processConfig, rollConfig);
            const tag = effectName || "Bonus";
            clean = `${clean}[${tag}]`;
            modified = true;
        }

        // Check if this part matches an active effect damage bonus on the actor (strictly for damage rolls)
        if (!modified && actor && isDamage) {
            const cleanKey = clean.replace(/^@/, "");
            const partVal = data[cleanKey] ?? foundry.utils.getProperty(data, cleanKey);
            if (partVal && String(partVal).includes("[")) return part;

            const effectName = findActiveEffectForDamageBonus(actor, clean, { rollData: data, isDamageRoll: isDamage, claimedEffectIds });
            if (effectName) {
                clean = `${clean}[${effectName}]`;
                modified = true;
            }
        }

        if (modified) {
            return sign === "-" ? `-${clean}` : clean;
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
 * @param {object} [rollConfig]
 * @returns {string|null}
 */
function detectActiveEffectSource(actor, bonusValue, processConfig, rollConfig = null) {
    if (!actor?.appliedEffects?.length && !actor?.effects?.size) return null;
    const effects = actor.appliedEffects ?? Array.from(actor.effects.values());
    const bonusStr = String(bonusValue ?? "").toLowerCase().trim();
    if (!bonusStr) return null;
    const rollData = actor.getRollData ? actor.getRollData() : {};

    const hookNames = (Array.isArray(processConfig?.hookNames) ? processConfig.hookNames : []).map(h => String(h).toLowerCase());
    const rollType = String(rollConfig?.options?.type ?? rollConfig?.data?.roll?.type ?? processConfig?.options?.type ?? "").toLowerCase();
    const rollFlavor = String(rollConfig?.options?.flavor ?? "").toLowerCase();

    const isInitiative = hookNames.includes("initiativedialog")
        || hookNames.includes("initiative")
        || rollType === "initiative"
        || rollFlavor.includes("initiative");

    const isSave = !isInitiative && Boolean(
        hookNames.some(h => h.includes("save") || h.includes("concentration"))
        || ["save", "death", "concentration"].includes(rollType)
        || rollFlavor.includes("save")
    );

    const isAttack = !isInitiative && !isSave && Boolean(
        hookNames.includes("attack")
        || rollType === "attack"
        || rollFlavor.includes("attack")
    );

    const isDamage = !isInitiative && !isSave && !isAttack && Boolean(
        hookNames.includes("damage")
        || (rollType && Boolean(CONFIG.DND5E?.damageTypes?.[rollType] || CONFIG.DND5E?.healingTypes?.[rollType]))
        || (Array.isArray(rollConfig?.options?.types) && rollConfig.options.types.some(t => CONFIG.DND5E?.damageTypes?.[t] || CONFIG.DND5E?.healingTypes?.[t]))
        || (processConfig?.subject?.type === "damage")
    );

    const isCheck = !isSave && !isAttack && !isDamage && Boolean(
        isInitiative
        || hookNames.some(h => h.includes("check") || h.includes("skill") || h.includes("tool"))
        || ["check", "ability", "skill", "tool"].includes(rollType)
        || rollFlavor.includes("check")
    );

    const isPenalty = bonusStr.startsWith("-");
    const cleanBonus = bonusStr.replace(/^[+-]\s*/, "").trim();

    // Matcher helper avoiding substring false positives (e.g. "1d6" containing "1")
    const matchesBonus = (val) => {
        if (val === undefined || val === null || val === "") return false;
        const valStr = String(val).toLowerCase().trim();
        const isValNeg = valStr.startsWith("-");
        if (isPenalty !== isValNeg) return false;

        const cleanVal = valStr.replace(/^[+-]\s*/, "").trim();
        if (cleanVal === cleanBonus) return true;

        const numVal = Number(cleanVal);
        const numBonus = Number(cleanBonus);
        if (!isNaN(numVal) && !isNaN(numBonus) && Number.isFinite(numVal) && Number.isFinite(numBonus)) {
            return numVal === numBonus;
        }

        // Token-boundary match for compound expressions (e.g. "1d4" in "1d4 + 2", but never "1" in "1d6")
        const escaped = cleanBonus.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tokenRegex = new RegExp(`(?:^|[^\\w])${escaped}(?:$|[^\\w])`, "i");
        return tokenRegex.test(cleanVal);
    };

    // Check active effects for matching changes
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        for (const change of effect.changes ?? []) {
            const key = String(change.key ?? "").toLowerCase();

            // Strict category filtering to prevent cross-contamination across roll types
            if (isInitiative && (key.includes("damage") || key.includes("attack") || key.includes("save"))) continue;
            if (isCheck && !isInitiative && (key.includes("damage") || key.includes("attack") || key.includes("save") || key.includes("init"))) continue;
            if (isSave && (key.includes("damage") || key.includes("attack") || key.includes("check") || key.includes("skill") || key.includes("tool") || key.includes("init"))) continue;
            if (isAttack && (key.includes("damage") || key.includes("save") || key.includes("check") || key.includes("skill") || key.includes("tool") || key.includes("init"))) continue;
            if (isDamage && (key.includes("attack") || key.includes("save") || key.includes("check") || key.includes("skill") || key.includes("tool") || key.includes("init"))) continue;

            const rawVal = String(change.value ?? "").toLowerCase().trim();
            if (matchesBonus(rawVal)) {
                return effect.name;
            }
            if (rawVal.includes("@")) {
                try {
                    const replaced = Roll.replaceFormulaData(rawVal, rollData).toLowerCase().trim();
                    if (matchesBonus(replaced)) {
                        return effect.name;
                    }
                } catch {
                    // Ignore replacement errors
                }
            }
        }
    }

    // Common spell names heuristic (filtered strictly by roll category and polarity)
    if (cleanBonus === "1d4") {
        for (const effect of effects) {
            if (effect.disabled || effect.isSuppressed) continue;
            const name = effect.name?.toLowerCase() ?? "";
            if (!isPenalty && name.includes("bless") && (isAttack || isSave)) return "Bless";
            if (!isPenalty && name.includes("guidance") && isCheck) return "Guidance";
            if (isPenalty && name.includes("bane") && (isAttack || isSave)) return "Bane";
            if (!isPenalty && name.includes("emboldening") && (isAttack || isSave || isCheck)) return "Emboldening Bond";
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
    if (options.isDamageRoll === false) return null;
    if (options.roll && !isDamageRoll(options.roll)) return null;
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
/**
 * Evaluate an arithmetic expression of numbers and operators safely.
 * @param {string} expr
 * @returns {number}
 */
export function evaluateTermExpression(expr) {
    if (typeof Roll?.safeEval === "function") {
        try {
            const res = Roll.safeEval(expr);
            if (!isNaN(res) && Number.isFinite(res)) return res;
        } catch {
            // fallback below
        }
    }
    try {
        if (/^[\d\s+\-*/%().]+$/.test(expr)) {
            // eslint-disable-next-line no-new-func
            const res = Function(`"use strict"; return (${expr});`)();
            if (!isNaN(res) && Number.isFinite(res)) return res;
        }
    } catch {
        // Return 0 if failed
    }
    return 0;
}

/**
 * Splits roll terms into additive chunks based on top-level addition and subtraction operators.
 * Terms bound by multiplication, division, and modulo remain grouped together.
 *
 * @param {RollTerm[]} terms
 * @returns {{ sign: number, terms: RollTerm[] }[]}
 */
export function splitIntoAdditiveChunks(terms) {
    const chunks = [];
    let currentChunk = null;
    let currentSign = 1;

    for (const term of terms) {
        if (term instanceof foundry.dice.terms.OperatorTerm && (term.operator === "+" || term.operator === "-")) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = null;
                currentSign = 1;
            }
            if (term.operator === "-") {
                currentSign = -currentSign;
            }
            continue;
        }

        if (!currentChunk) {
            currentChunk = {
                sign: currentSign,
                terms: []
            };
        }
        currentChunk.terms.push(term);
    }

    if (currentChunk && currentChunk.terms.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Checks whether an additive chunk contains any dice terms.
 * @param {object} chunk
 * @returns {boolean}
 */
export function chunkHasDice(chunk) {
    return chunk.terms.some(t => {
        if (t instanceof foundry.dice.terms.DiceTerm || t instanceof foundry.dice.terms.PoolTerm) return true;
        if (t instanceof foundry.dice.terms.ParentheticalTerm && t.dice?.length) return true;
        return false;
    });
}

/**
 * Extract dice, multiplier formula, and total from an additive chunk containing dice.
 *
 * @param {object} chunk - { sign: number, terms: RollTerm[] }
 * @returns {{ dieTerm: DiceTerm|PoolTerm|null, multiplierFormula: string, hasMultiplier: boolean, signedTotal: number }}
 */
export function processDiceChunk(chunk) {
    const { sign, terms } = chunk;
    const expr = terms.map(t => t.total).join(" ");
    const chunkVal = evaluateTermExpression(expr);
    const signedTotal = chunkVal * sign;

    const dieTerm = terms.find(t =>
        t instanceof foundry.dice.terms.DiceTerm
        || t instanceof foundry.dice.terms.PoolTerm
        || (t instanceof foundry.dice.terms.ParentheticalTerm && t.dice?.length)
    ) ?? null;

    const nonDieTerms = terms.filter(t => t !== dieTerm && !(t instanceof foundry.dice.terms.ParentheticalTerm && t.dice?.includes(dieTerm)));
    const hasMultiplier = nonDieTerms.length > 0;

    let multiplierFormula = "";
    if (hasMultiplier) {
        const opTerm = nonDieTerms.find(t => t instanceof foundry.dice.terms.OperatorTerm);
        const numTerms = nonDieTerms.filter(t => !(t instanceof foundry.dice.terms.OperatorTerm));
        if (opTerm?.operator === "*" && numTerms.length === 1) {
            multiplierFormula = `× ${numTerms[0].total}`;
        } else if (opTerm?.operator === "/" && numTerms.length === 1) {
            multiplierFormula = `/ ${numTerms[0].total}`;
        } else {
            multiplierFormula = nonDieTerms.map(t => {
                if (t instanceof foundry.dice.terms.OperatorTerm) {
                    return t.operator === "*" ? "×" : t.operator;
                }
                return String(t.total ?? "");
            }).join(" ").trim();
        }
    }

    return { dieTerm, multiplierFormula, hasMultiplier, signedTotal };
}

/**
 * Process a modifier chunk (no dice) into a structured breakdown modifier object.
 *
 * @param {object} chunk - { sign: number, terms: RollTerm[] }
 * @param {Roll} roll
 * @param {object} [options={}]
 * @returns {object}
 */
export function processModifierChunk(chunk, roll, { actor = null, claimedEffectIds = null } = {}) {
    const { sign, terms } = chunk;
    const expr = terms.map(t => t.total).join(" ");
    const chunkVal = evaluateTermExpression(expr);
    const signedTotal = chunkVal * sign;
    const signStr = signedTotal >= 0 ? "+" : "-";
    const absVal = Math.abs(signedTotal);
    const isPositive = signedTotal >= 0;

    let isCompound = terms.length > 1;
    let formula = "";
    if (isCompound) {
        formula = terms.map(t => {
            if (t instanceof foundry.dice.terms.OperatorTerm) {
                return t.operator === "*" ? "×" : t.operator;
            }
            return String(t.total ?? "");
        }).join(" ").trim();
    } else if (terms.length === 1 && terms[0] instanceof foundry.dice.terms.ParentheticalTerm && terms[0].roll?.terms?.length > 1) {
        const innerTerms = terms[0].roll.terms;
        isCompound = true;
        formula = innerTerms.map(t => {
            if (t instanceof foundry.dice.terms.OperatorTerm) {
                return t.operator === "*" ? "×" : t.operator;
            }
            return String(t.total ?? "");
        }).join(" ").trim();
    }

    let label = "";
    for (const t of terms) {
        const flav = t.flavor ? t.flavor.trim() : (t.options?.flavor ? String(t.options.flavor).trim() : "");
        if (flav) {
            label = flav;
            break;
        }
        if (t instanceof foundry.dice.terms.ParentheticalTerm && t.roll?.terms) {
            for (const pt of t.roll.terms) {
                const pfl = pt.flavor ? pt.flavor.trim() : (pt.options?.flavor ? String(pt.options.flavor).trim() : "");
                if (pfl) {
                    label = pfl;
                    break;
                }
            }
            if (label) break;
        }
    }

    if (label) {
        const abilityMatch = label.match(/^(STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?:\s+(?:bonus|penalty))?$/i);
        if (abilityMatch) {
            const key = abilityMatch[1].slice(0, 3).toLowerCase();
            label = ABILITY_SHORTHANDS[key] ?? key.toUpperCase();
        } else if (/^Magic Weapon(?:\s+bonus)?$/i.test(label)) {
            label = "MGC";
        }
    }

    if (/^PB(?:\s*\(.*\))?$/i.test(label) || /^Proficiency(?:\s+Bonus)?$/i.test(label)) {
        if (formula.includes("× 2") || formula.includes("2 ×") || expr.includes("* 2") || expr.includes("2 *")) {
            label = "PB (Expertise)";
        } else if (formula.includes("/ 2") || formula.includes("0.5") || expr.includes("/ 2") || expr.includes("* 0.5")) {
            label = "PB (Half)";
        }
    }

    if (!label && actor) {
        const profVal = Number(actor.system?.attributes?.prof ?? 0);
        if (profVal > 0 && isCompound) {
            const baseTerm = terms.find(t => !(t instanceof foundry.dice.terms.OperatorTerm));
            if (baseTerm && Number(baseTerm.total) === profVal) {
                if (formula.includes("× 2") || formula.includes("2 ×") || expr.includes("* 2") || expr.includes("2 *")) {
                    label = "PB (Expertise)";
                } else if (formula.includes("/ 2") || formula.includes("0.5") || expr.includes("/ 2") || expr.includes("* 0.5")) {
                    label = "PB (Half)";
                }
            }
        }
    }

    if (!label && actor && isDamageRoll(roll)) {
        const effectName = findActiveEffectForDamageBonus(actor, absVal, {
            roll,
            claimedEffectIds
        });
        if (effectName) {
            label = effectName;
        }
    }

    const displayLabel = label || (formula ? formula : "Modifier");

    return {
        sign: signStr,
        absVal,
        signedTotal,
        formattedValue: `${signStr}${absVal}`,
        label: label ? `(${label})` : "",
        displayLabel,
        rawLabel: label,
        formula: (label && isCompound) ? formula : "",
        isPositive,
        isDie: false
    };
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
 * @param {boolean} [options.hasMultiplier=false]
 * @param {string} [options.multiplierFormula=""]
 * @param {number|null} [options.overrideTotal=null]
 * @returns {object}
 */
function createDieRow(die, roll, {
    isBase = false,
    currentSign = 1,
    actor = null,
    item = null,
    claimedEffectIds = null,
    flavor = "",
    fallbackFlavor = "",
    hasMultiplier = false,
    multiplierFormula = "",
    overrideTotal = null
} = {}) {
    const isD20 = die instanceof CONFIG.Dice?.D20Die || die.faces === 20;
    const critThreshold = die.options?.criticalSuccess ?? CONFIG.Dice?.D20Die?.CRITICAL_SUCCESS_TOTAL ?? 20;
    const fumbleThreshold = die.options?.criticalFailure ?? CONFIG.Dice?.D20Die?.CRITICAL_FAILURE_TOTAL ?? 1;

    const rolls = die.results?.map(r => {
        const isCrit = isD20 ? r.result >= critThreshold : Boolean(r.critical || die.options?.critical);
        const isFumble = isD20 ? r.result <= fumbleThreshold : Boolean(r.fumble);
        const cssArray = die.getResultCSS ? die.getResultCSS(r) : [];
        const coreClasses = typeof cssArray.filterJoin === "function" ? cssArray.filterJoin(" ") : (Array.isArray(cssArray) ? cssArray.filter(Boolean).join(" ") : String(cssArray || ""));
        const discardedClass = (r.discarded || r.active === false) ? "discarded" : "";
        const extraClasses = isD20 ? (isCrit ? "critical max" : (isFumble ? "fumble min" : "")) : (isCrit ? "critical" : (isFumble ? "fumble" : ""));
        const combinedClasses = Array.from(new Set([coreClasses, discardedClass, extraClasses].join(" ").split(/\s+/).filter(Boolean))).join(" ");

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
    const isSingleDie = !hasMultiplier && activeRolls.length === 1 && discardedRolls.length === 0;
    const hasAdvantageOrDisadvantage = !hasMultiplier && activeRolls.length === 1 && discardedRolls.length > 0;
    const isFormula = !hasMultiplier && activeRolls.length > 1;
    const isSingleDieRoll = activeRolls.length === 1 && discardedRolls.length === 0;

    const rawFormulaMatch = die?.formula ? die.formula.match(/\[(.*?)\]/) : null;
    const rawFlavor = die?.flavor || die?.options?.flavor || flavor || fallbackFlavor || (rawFormulaMatch ? rawFormulaMatch[1] : "");
    let cleanFlavor = extractCleanDieFlavor(rawFlavor, roll);

    if (!cleanFlavor && (flavor || fallbackFlavor)) {
        cleanFlavor = extractCleanDieFlavor(flavor || fallbackFlavor, roll);
    }

    if (!cleanFlavor && actor && isDamageRoll(roll)) {
        const expression = die?.expression || (die?.faces ? `${die.number ?? 1}d${die.faces}` : "");
        const effectName = findActiveEffectForDamageBonus(actor, expression, { claimedEffectIds, roll });
        if (effectName) cleanFlavor = effectName;
    }

    if (!cleanFlavor && isBase && item?.name) {
        cleanFlavor = item.name;
    }

    const rawDenom = die?.expression || (die?.faces ? `d${die.faces}` : "d20");
    const denomination = rawDenom.replace(/\[.*?\]/g, "").trim().toUpperCase();

    const signedTotal = overrideTotal !== null
        ? overrideTotal
        : (Number(die?.total ?? 0) * currentSign);
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
        singleRoll: (isSingleDie || isSingleDieRoll) ? activeRolls[0] : null,
        hasAdvantageOrDisadvantage,
        isFormula,
        isSingleDieRoll,
        hasMultiplier,
        multiplierFormula,
        isCritical: Boolean(roll?.isCritical || (isD20 && die.isCriticalSuccess) || die?.options?.critical),
        isFumble: Boolean(roll?.isFumble || (isD20 && die.isCriticalFailure)),
        hasAdvantage: Boolean(roll?.hasAdvantage),
        hasDisadvantage: Boolean(roll?.hasDisadvantage),
        isBase
    };
}

/**
 * Create die row(s) for a PoolTerm (e.g. Savage Attacker {1d8, 1d8}kh).
 * If the pool consists of single candidate dice, combines them into an advantage/disadvantage
 * style roll row showing kept and discarded dice. Otherwise extracts dice from the winning roll.
 *
 * @param {PoolTerm} poolTerm
 * @param {Roll} roll
 * @param {object} [options={}]
 * @returns {object[]}
 */
function createPoolDieRows(poolTerm, roll, {
    isBase = false,
    currentSign = 1,
    actor = null,
    item = null,
    claimedEffectIds = null,
    defaultFlavor = "",
    hasMultiplier = false,
    multiplierFormula = "",
    overrideTotal = null
} = {}) {
    if (!poolTerm) return [];
    const poolResults = poolTerm.results ?? [];
    const isSavage = Boolean(roll?.options?._nd5tSavageAttacker || roll?.options?.savageAttacker || poolTerm.options?._nd5tSavageAttacker);
    const subRolls = poolTerm.rolls ?? [];

    const signedTotal = overrideTotal !== null
        ? overrideTotal
        : (Number(poolTerm.total ?? 0) * currentSign);

    const isSingleDicePool = subRolls.length > 1
        && subRolls.every(r => r.dice?.length === 1 && (r.dice[0].number ?? 1) === 1);

    if (isSingleDicePool) {
        const combinedRolls = [];
        for (let rIdx = 0; rIdx < subRolls.length; rIdx++) {
            const subRoll = subRolls[rIdx];
            const poolRes = poolResults[rIdx];
            const d = subRoll.dice[0];
            const dieRes = d.results?.[0] ?? { result: subRoll.total };
            const isActive = poolRes ? (poolRes.active !== false && !poolRes.discarded) : true;
            const isCrit = Boolean(d.isCriticalSuccess || d.options?.critical || poolTerm.options?.critical || (d.faces === 20 && dieRes.result === 20));
            const isFumble = Boolean(d.isCriticalFailure || (d.faces === 20 && dieRes.result === 1));
            const cssArray = d.getResultCSS ? d.getResultCSS(dieRes) : [];
            const coreClasses = typeof cssArray.filterJoin === "function" ? cssArray.filterJoin(" ") : (Array.isArray(cssArray) ? cssArray.filter(Boolean).join(" ") : String(cssArray || ""));
            const discardedClass = !isActive ? "discarded" : "";
            const extraClasses = isCrit ? "critical" : (isFumble ? "fumble" : "");
            const combinedClasses = Array.from(new Set([coreClasses, discardedClass, extraClasses].join(" ").split(/\s+/).filter(Boolean))).join(" ");
            combinedRolls.push({
                result: d.getResultLabel ? d.getResultLabel(dieRes) : dieRes.result,
                classes: combinedClasses,
                active: isActive,
                isCritical: isCrit,
                isFumble: isFumble
            });
        }

        const winningRoll = subRolls.find((_, idx) => poolResults[idx]?.active !== false && !poolResults[idx]?.discarded) ?? subRolls[0];
        const winningDie = winningRoll?.dice?.[0];
        const activeRolls = combinedRolls.filter(r => r.active !== false);
        const discardedRolls = combinedRolls.filter(r => r.active === false);
        const fallbackFaces = poolTerm.terms?.[0]?.match?.(/d(\d+)/i)?.[1];
        const denomination = winningDie ? `D${winningDie.faces}` : (fallbackFaces ? `D${fallbackFaces}` : "D8");
        const savageLabel = defaultFlavor || (poolTerm.options?.critical ? "Savage Attacker (Crit)" : "Savage Attacker");
        const cleanFlavor = isSavage
            ? savageLabel
            : (poolTerm.flavor || defaultFlavor || (isBase && item?.name ? item.name : ""));

        return [{
            denomination,
            flavor: cleanFlavor,
            total: signedTotal,
            sign: currentSign < 0 ? "-" : "",
            rolls: combinedRolls,
            activeRolls,
            discardedRolls,
            isSingleDie: false,
            singleRoll: null,
            hasAdvantageOrDisadvantage: !hasMultiplier,
            isFormula: false,
            isSingleDieRoll: false,
            hasMultiplier,
            multiplierFormula,
            isCritical: Boolean(roll?.isCritical || winningDie?.options?.critical || poolTerm.options?.critical),
            isFumble: Boolean(roll?.isFumble),
            hasAdvantage: true,
            hasDisadvantage: false,
            isBase
        }];
    }

    // Fallback for multi-die pools (e.g. {2d6, 2d6}kh)
    const activeSubRolls = subRolls.filter((_, idx) => {
        const res = poolResults[idx];
        return res ? (res.active !== false && !res.discarded) : true;
    });
    const rollsToUse = activeSubRolls.length ? activeSubRolls : subRolls;
    const savageMultiLabel = defaultFlavor || (poolTerm.options?.critical ? "Savage Attacker (Crit)" : "Savage Attacker");
    const poolFlavor = isSavage ? savageMultiLabel : (poolTerm.flavor || defaultFlavor || (isBase && item?.name ? item.name : ""));

    const rows = [];
    for (const subRoll of rollsToUse) {
        for (const d of subRoll.dice ?? []) {
            rows.push(createDieRow(d, roll, {
                isBase,
                currentSign,
                actor,
                item,
                claimedEffectIds,
                flavor: d.flavor || poolFlavor,
                hasMultiplier,
                multiplierFormula,
                overrideTotal: hasMultiplier ? signedTotal : null
            }));
        }
    }
    return rows;
}

/**
 * Generate structured breakdown data for a Roll instance.
 *
 * @param {BasicRoll} roll
 * @param {object} [options={}]
 * @param {boolean} [options.isBase] - Explicit override for whether the primary die is base weapon damage.
 * @param {Actor5e} [options.actor]
 * @param {Item5e} [options.item]
 * @returns {Promise<object|null>}
 */
export async function getDetailedRollBreakdown(roll, options = {}) {
    if (!roll?._evaluated) return null;

    const terms = roll.terms ?? [];
    if (!terms.length) return null;

    const actor = options.actor
        ?? (typeof roll.parent?.getAssociatedActor === "function" ? roll.parent.getAssociatedActor() : null)
        ?? roll.parent?.actor
        ?? (roll.parent?.speaker ? ChatMessage.getSpeakerActor(roll.parent.speaker) : null)
        ?? (roll.options?.actor ? game.actors?.get(roll.options.actor) : null)
        ?? null;
    const item = options.item
        ?? roll.item
        ?? (typeof roll.parent?.getAssociatedItem === "function" ? roll.parent.getAssociatedItem() : null)
        ?? roll.parent?.item
        ?? (roll.options?.item ? game.items?.get(roll.options.item) : null)
        ?? null;
    const claimedEffectIds = new Set();

    const diceRows = [];
    const modifiers = [];
    const isBase = options.isBase ?? Boolean(roll.options?.base || roll.base);

    const chunks = splitIntoAdditiveChunks(terms);
    if (!chunks.length) return null;

    // Identify which chunk contains the primary/base die.
    const d20 = roll.d20 ?? (terms[0] instanceof CONFIG.Dice?.D20Die ? terms[0] : null);
    const baseChunkIndex = d20
        ? chunks.findIndex(chunk => chunk.terms.includes(d20) || chunk.terms.some(t => t instanceof CONFIG.Dice?.D20Die || t.faces === 20))
        : chunks.findIndex(chunk => chunkHasDice(chunk));

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isBaseChunk = (i === baseChunkIndex) && (isBase || baseChunkIndex === 0);

        if (chunkHasDice(chunk)) {
            const { dieTerm, multiplierFormula, hasMultiplier, signedTotal } = processDiceChunk(chunk);

            if (dieTerm instanceof foundry.dice.terms.PoolTerm) {
                const isSavage = Boolean(roll.options?._nd5tSavageAttacker || roll.options?.savageAttacker || dieTerm.options?._nd5tSavageAttacker);
                const defaultFlavor = (dieTerm.options?.critical || roll.isCritical)
                    ? (isSavage ? "Savage Attacker (Crit)" : (game.i18n?.localize("DND5E.CriticalHit") || "Critical Hit"))
                    : (isSavage ? "Savage Attacker" : "");

                const poolRows = createPoolDieRows(dieTerm, roll, {
                    isBase: isBaseChunk,
                    currentSign: chunk.sign,
                    actor,
                    item,
                    claimedEffectIds,
                    defaultFlavor,
                    hasMultiplier,
                    multiplierFormula,
                    overrideTotal: hasMultiplier ? signedTotal : null
                });

                diceRows.push(...poolRows);
            } else if (dieTerm instanceof foundry.dice.terms.ParentheticalTerm && dieTerm.dice?.length) {
                for (const d of dieTerm.dice) {
                    const dieMultiplierTotal = hasMultiplier
                        ? evaluateTermExpression(`${d.total} ${multiplierFormula.replace(/×/g, "*")}`) * chunk.sign
                        : null;
                    diceRows.push(createDieRow(d, roll, {
                        isBase: isBaseChunk,
                        currentSign: chunk.sign,
                        actor,
                        item,
                        claimedEffectIds,
                        hasMultiplier,
                        multiplierFormula,
                        overrideTotal: dieMultiplierTotal ?? (hasMultiplier ? signedTotal : null)
                    }));
                }
            } else if (dieTerm instanceof foundry.dice.terms.DiceTerm) {
                diceRows.push(createDieRow(dieTerm, roll, {
                    isBase: isBaseChunk,
                    currentSign: chunk.sign,
                    actor,
                    item,
                    claimedEffectIds,
                    hasMultiplier,
                    multiplierFormula,
                    overrideTotal: hasMultiplier ? signedTotal : null
                }));
            }
        } else {
            // Modifier chunk (no dice)
            modifiers.push(processModifierChunk(chunk, roll, { actor, claimedEffectIds }));
        }
    }

    const sortedDice = sortBreakdownDiceRows(diceRows);
    const sortedMods = sortBreakdownModifiers(modifiers);

    const isDamage = isDamageRoll(roll);
    let damageType = null;
    let typeConfig = null;
    let typeLabel = "";
    let typeIcon = null;
    let typeColor = null;

    if (isDamage) {
        const rawType = (typeof roll.options?.type === "string") ? roll.options.type.trim() : "";
        const isUntyped = !rawType || rawType.toLowerCase() === "untyped" || rawType.toLowerCase() === "none" || rawType.toLowerCase() === "pure";
        damageType = isUntyped ? "untyped" : rawType.toLowerCase();
        typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
        const pureLabel = game.i18n?.localize?.("ND5T.DamageType.Pure") || "Pure";
        typeLabel = typeConfig?.labelShort ?? typeConfig?.label ?? (isUntyped ? pureLabel.toUpperCase() : rawType.toUpperCase());
        typeIcon = typeConfig?.icon ?? (isUntyped ? PURE_DAMAGE_ICON : null);
        typeColor = getDamageTypeColor(damageType);
    }

    const totalLabel = game.i18n?.localize ? (game.i18n.localize("DND5E.PropertyTotal") || game.i18n.localize("ND5T.RollBreakdownDetails.Total") || "Total") : "Total";

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
    if (CONFIG.Dice.BasicRoll.prototype._nd5tWrappedGetTooltip) return;

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
    CONFIG.Dice.BasicRoll.prototype._nd5tWrappedGetTooltip = true;
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
export async function enhanceDamageChatMessageBreakdown(message, html, targetPopover = null) {
    if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
    if (!message?.rolls?.length) {
        if (targetPopover) targetPopover._nd5tBreakdownSkipped = true;
        return;
    }

    const isDamageMsg = message.system?.constructor?.name === "DamageMessageData"
        || (CONFIG.ChatMessage?.dataModels?.damage && message.system instanceof CONFIG.ChatMessage.dataModels.damage);
    const damageRolls = message.rolls.filter(r => (CONFIG.Dice?.DamageRoll && r instanceof CONFIG.Dice.DamageRoll) || isDamageMsg);
    if (!damageRolls.length) {
        if (targetPopover) targetPopover._nd5tBreakdownSkipped = true;
        return;
    }

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const breakdownEl = targetPopover ?? root.querySelector(".roll-breakdown[popover]");
    if (!breakdownEl) return;

    // Avoid duplicate work if already enhanced
    if (breakdownEl.querySelector(".nd5t-roll-breakdown")) return;

    // Fast-path: use cached rendered HTML if available
    if (message._nd5tBreakdownHtml) {
        breakdownEl.innerHTML = message._nd5tBreakdownHtml;
        return;
    }

    try {
        const item = (typeof message.getAssociatedItem === "function" ? message.getAssociatedItem() : null)
            ?? message.item
            ?? null;
        const isWeapon = item?.type === "weapon";
        const actor = (typeof message.getAssociatedActor === "function" ? message.getAssociatedActor() : null)
            ?? message.actor
            ?? (message.speaker ? ChatMessage.getSpeakerActor(message.speaker) : null)
            ?? null;
        const typeMap = new Map();

        for (let i = 0; i < damageRolls.length; i++) {
            const roll = damageRolls[i];
            if (!roll.parent) roll.parent = message;

            const isBase = Boolean(roll.options?.base || roll.base || (isWeapon && i === 0));
            const data = await getDetailedRollBreakdown(roll, { isBase, actor, item });
            if (!data) continue;

            const rawType = (typeof roll.options?.type === "string") ? roll.options.type.trim() : "";
            const isUntyped = !rawType || rawType.toLowerCase() === "untyped" || rawType.toLowerCase() === "none" || rawType.toLowerCase() === "pure";
            const damageType = isUntyped ? "untyped" : rawType.toLowerCase();

            if (!typeMap.has(damageType)) {
                const typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
                const pureLabel = game.i18n?.localize?.("ND5T.DamageType.Pure") || "Pure";
                const typeLabel = typeConfig?.labelShort ?? typeConfig?.label ?? (isUntyped ? pureLabel.toUpperCase() : rawType.toUpperCase());
                const typeIcon = typeConfig?.icon ?? (isUntyped ? PURE_DAMAGE_ICON : null);
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

        const totalLabel = game.i18n?.localize ? (game.i18n.localize("DND5E.PropertyTotal") || game.i18n.localize("ND5T.RollBreakdownDetails.Total") || "Total") : "Total";

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
 * @param {ChatMessage} [message=null]
 */
async function _ensurePopoverBreakdown(popoverEl, message = null) {
    if (!popoverEl?.matches?.(".roll-breakdown[popover]")) return;
    if (popoverEl.querySelector(".nd5t-roll-breakdown")) return;
    if (popoverEl._nd5tBreakdownLoading || popoverEl._nd5tBreakdownSkipped) return;
    popoverEl._nd5tBreakdownLoading = true;
    try {
        const chatCard = popoverEl.closest(".chat-message[data-message-id], .message[data-message-id]")
            ?? popoverEl.closest(".chat-message, .message")
            ?? popoverEl.parentElement;
        const msgId = chatCard?.dataset?.messageId;
        const targetMessage = message ?? (msgId ? game.messages?.get(msgId) : null);
        if (targetMessage && chatCard) await enhanceDamageChatMessageBreakdown(targetMessage, chatCard, popoverEl);
        else if (!targetMessage && game.ready && msgId && game.messages && !game.messages.has(msgId)) {
            popoverEl._nd5tBreakdownSkipped = true;
        }
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
    // dnd5e.postBuildRollConfig fires exactly once for all roll types (attacks, damage, checks, saves, tools)
    Hooks.on("dnd5e.postBuildRollConfig", (processConfig, rollConfig, index) => {
        tagRollConfigParts(processConfig, rollConfig, index);
    });

    // Tier 2 & 3: Enhanced breakdown rendering for BasicRoll (d20 rolls, checks, saves)
    wrapBasicRollGetTooltip();

    // Pre-cache breakdown for newly rendered chat messages (Foundry V14 hook)
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!game.ready) return;
        if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
        const popovers = html?.querySelectorAll?.(".roll-breakdown[popover]") ?? [];
        for (const popover of popovers) {
            _ensurePopoverBreakdown(popover, message);
        }
    });

    // Pre-cache recent historical messages once the world and messages collection are fully ready
    Hooks.once("ready", () => {
        if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
        const popovers = Array.from(document.querySelectorAll("#chat-log .roll-breakdown[popover]")).slice(-30);
        for (const popover of popovers) {
            _ensurePopoverBreakdown(popover);
        }
    });

    // Pre-cache when chat log renders or loads batches
    Hooks.on("renderChatLog", (app, html) => {
        if (!game.ready) return;
        if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        const popovers = Array.from(root?.querySelectorAll?.(".roll-breakdown[popover]") ?? []).slice(-30);
        for (const popover of popovers) {
            _ensurePopoverBreakdown(popover);
        }
    });

    // Lazy on-demand popover rendering: populate breakdown when opened, clicked, or hovered.
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

        // Pre-cache on hover so opening the popover is instantaneous and flicker-free
        document.addEventListener("pointerover", (event) => {
            const row = event.target?.closest?.(".icon-row, .chat-message");
            if (!row) return;
            const popovers = row.querySelectorAll?.(".roll-breakdown[popover]") ?? [];
            for (const popover of popovers) _ensurePopoverBreakdown(popover);
        }, { capture: true, passive: true });
    }
}
