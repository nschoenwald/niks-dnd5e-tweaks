/**
 * Feature: Detailed Roll Breakdown Overlay
 * Description: Replaces the unlabeled numbers in the roll total popover with a comprehensive breakdown
 *              showing the base die, dice rolls, and where every bonus/penalty originates (e.g. +3 STR,
 *              +2 PB, +1d4 Bless, -2 Exhaustion 1). Supports both d20 checks/saves/attacks and damage rolls.
 *
 * @introduced v14.43.0
 * @updated v14.49.0 (Reuses actor roll data, lazy breakdowns for older messages, gated document listeners)
 * @updated v14.55.1 (midi-qol merged card sections; card summaries use their own message)
 */
import { log, isFeatureActive } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

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
 * Extract an explicit damage or healing type from a formula part string if present in bracketed syntax.
 * (e.g. `1d8[radiant]` -> `"radiant"`).
 *
 * @param {string} part
 * @returns {string|null} The normalized lower-case damage type key, or null if no valid damage type tag was found.
 */
export function getExplicitDamageTypeFromPart(part) {
    if (typeof part !== "string") return null;
    for (const match of part.matchAll(/\[([a-zA-Z0-9_-]+)\]/g)) {
        const cleanType = match[1]?.trim().toLowerCase();
        if (CONFIG.DND5E?.damageTypes?.[cleanType] || CONFIG.DND5E?.healingTypes?.[cleanType]) {
            return cleanType;
        }
    }
    return null;
}

/**
 * Splits a composite formula string on top-level addition and subtraction operators (+ and -),
 * respecting nested parentheses and bracket tags.
 *
 * @param {string} formulaStr
 * @returns {string[]}
 */
export function splitAdditiveFormulaParts(formulaStr) {
    if (typeof formulaStr !== "string") return [formulaStr];
    const parts = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < formulaStr.length; i++) {
        const char = formulaStr[i];
        if (char === "[" || char === "(") depth++;
        else if (char === "]" || char === ")") depth = Math.max(0, depth - 1);

        if (depth === 0 && (char === "+" || char === "-") && current.trim()) {
            parts.push(current.trim());
            current = char === "-" ? "-" : "";
        } else {
            current += char;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/**
 * Inspects a pending damage roll configuration and splits any formula parts that declare an
 * explicit damage type differing from the parent roll's damage type into their own distinct
 * roll configuration entry (e.g. `1d8[radiant]` from Radiant Strikes / Divine Favor).
 *
 * @param {DamageRollProcessConfiguration} config
 * @param {DamageRollDialogConfiguration} [dialog]
 * @param {DamageRollMessageConfiguration} [message]
 */
export function splitTypedDamageParts(config, dialog, message) {
    if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
    if (!config?.rolls?.length) return;

    const newRolls = [];
    for (const rollConfig of config.rolls) {
        if (!Array.isArray(rollConfig.parts) || rollConfig.parts.length === 0) {
            newRolls.push(rollConfig);
            continue;
        }

        // Avoid re-splitting conditional damage rolls, AC5e synthetic bonus rolls, or already split rolls
        if (
            rollConfig.options?._nd5tTypedBonus
            || rollConfig.options?._nd5tConditionalId
            || rollConfig.options?.["automated-conditions-5e"]?.syntheticBonusRoll
            || rollConfig.options?.ac5e?.syntheticBonusRoll
        ) {
            newRolls.push(rollConfig);
            continue;
        }

        const baseType = (typeof rollConfig.options?.type === "string") ? rollConfig.options.type.trim().toLowerCase() : "";

        // Flatten any composite formula parts by top-level addition/subtraction
        const flattenedParts = [];
        for (const rawPart of rollConfig.parts) {
            if (typeof rawPart === "string" && (rawPart.includes("+") || rawPart.includes("-")) && rawPart.includes("[")) {
                flattenedParts.push(...splitAdditiveFormulaParts(rawPart));
            } else {
                flattenedParts.push(rawPart);
            }
        }

        const partsToKeep = [];
        const typedPartsByType = new Map(); // damageType -> string[]

        for (const part of flattenedParts) {
            const detectedType = getExplicitDamageTypeFromPart(part);
            if (detectedType && detectedType !== baseType) {
                if (!typedPartsByType.has(detectedType)) {
                    typedPartsByType.set(detectedType, []);
                }
                typedPartsByType.get(detectedType).push(part);
            } else {
                partsToKeep.push(part);
            }
        }

        if (!typedPartsByType.size) {
            rollConfig.parts = flattenedParts;
            newRolls.push(rollConfig);
            continue;
        }

        // If all parts were typed and belong to a single new type, retype rollConfig in-place
        if (partsToKeep.length === 0 && typedPartsByType.size === 1) {
            const [singleType, parts] = typedPartsByType.entries().next().value;
            rollConfig.parts = parts;
            rollConfig.options = rollConfig.options ?? {};
            rollConfig.options.type = singleType;
            rollConfig.options.types = [singleType];
            if (rollConfig.data?.roll?.damage) {
                rollConfig.data.roll.damage.type = singleType;
            }
            newRolls.push(rollConfig);
            continue;
        }

        // Keep remaining parts in rollConfig (if any)
        if (partsToKeep.length > 0) {
            rollConfig.parts = partsToKeep;
            newRolls.push(rollConfig);
        }

        // Create new roll configurations for each distinct typed damage part
        for (const [damageType, parts] of typedPartsByType.entries()) {
            const newRollConfig = foundry.utils.deepClone(rollConfig);
            newRollConfig.parts = parts;

            newRollConfig.options = newRollConfig.options ?? {};
            newRollConfig.options.type = damageType;
            newRollConfig.options.types = [damageType];
            newRollConfig.options._nd5tTypedBonus = true;

            newRollConfig.data = newRollConfig.data ?? {};
            if (newRollConfig.data.roll?.damage) {
                newRollConfig.data.roll.damage.type = damageType;
            }

            // Propagate critical hit flag if present on parent process config or roll
            if (config.isCritical || rollConfig.options?.isCritical || rollConfig.data?.roll?.isCritical) {
                newRollConfig.options.isCritical = true;
                foundry.utils.setProperty(newRollConfig, "data.roll.isCritical", true);
            }

            newRolls.push(newRollConfig);
        }
    }

    config.rolls = newRolls;
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
 * @param {number} [index=0]     - Index of the roll being prepared within processConfig.
 * @param {object} [hookOptions] - Additional hook options including app and formData.
 */
function tagRollConfigParts(processConfig, rollConfig, index = 0, hookOptions = null) {
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
    const rollType = String(rollConfig?.options?.type ?? data.roll?.damage?.type ?? data.roll?.type ?? "").toLowerCase();
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

    // Claimed effect IDs are tracked across all rolls in the same rolling process configuration
    if (processConfig) {
        if (index === 0 || !processConfig._claimedDamageEffectIds) {
            processConfig._claimedDamageEffectIds = new Set();
        }
    }
    const claimedEffectIds = processConfig?._claimedDamageEffectIds ?? new Set();

    // Pre-populate claimedEffectIds from any parts that already contain flavor tags
    const partsToScan = [];
    if (index === 0 && Array.isArray(processConfig?.rolls)) {
        for (const r of processConfig.rolls) {
            if (Array.isArray(r?.parts)) partsToScan.push(...r.parts);
        }
    } else {
        partsToScan.push(...rollConfig.parts);
    }

    for (const p of partsToScan) {
        if (typeof p !== "string") continue;
        for (const match of p.matchAll(/\[(.*?)\]/g)) {
            const flv = match[1]?.trim().toLowerCase();
            if (!flv || isStandardDamageOrAttributeTag(flv)) continue;
            claimedEffectIds.add(flv);
            const matchedEffect = findMatchingActorEffect(actor, flv);
            if (matchedEffect) {
                claimedEffectIds.add(matchedEffect.id);
                if (matchedEffect.uuid) claimedEffectIds.add(matchedEffect.uuid);
            }
        }
    }

    const rollDamageType = String(
        rollConfig?.options?.type
        ?? (Array.isArray(rollConfig?.options?.types) ? rollConfig.options.types[0] : "")
        ?? data.roll?.damage?.type
        ?? data.roll?.type
        ?? ""
    ).trim().toLowerCase();

    const isSyntheticBonusRoll = Boolean(
        rollConfig?.options?.["automated-conditions-5e"]?.syntheticBonusRoll
        || rollConfig?.options?.ac5e?.syntheticBonusRoll
    );

    const ac5eConfig = processConfig?.["automated-conditions-5e"]
        ?? processConfig?.ac5e
        ?? processConfig?.options?.["automated-conditions-5e"]
        ?? processConfig?.options?.ac5e
        ?? processConfig?.rolls?.[0]?.options?.["automated-conditions-5e"]
        ?? processConfig?.rolls?.[index]?.options?.["automated-conditions-5e"]
        ?? rollConfig?.options?.["automated-conditions-5e"]
        ?? rollConfig?.options?.ac5e
        ?? null;

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

        // (?![\w.-]) stops the key from backtracking to a partial match, e.g. tagging "rage" inside
        // "(@scale.barbarian.rage-damage)d6" and producing "(@scale.barbarian.rage[Rage]-damage)d6".
        const scaleRegex = new RegExp(`${lookbehind}@scale\\.([\\w.-]+)(?![\\w.-])${lookahead}`, "g");
        if (scaleRegex.test(clean)) {
            let scaleHandled = false;
            clean = clean.replace(new RegExp(`${lookbehind}@scale\\.([\\w.-]+)(?![\\w.-])${lookahead}`, "g"), (match, scaleKey) => {
                const scaleVal = foundry.utils.getProperty(data, `scale.${scaleKey}`) ?? "";
                if (String(scaleVal).includes("[")) return match;

                let tag = null;
                if (scaleKey.includes("rage")) {
                    const effectName = (actor && isDamage) ? findActiveEffectForDamageBonus(actor, match, {
                        rollData: data,
                        isDamageRoll: isDamage,
                        damageType: rollDamageType,
                        claimedEffectIds
                    }) : null;
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

            // 1. Direct AC5e runtime config matching if AC5e configuration is available
            let effectName = null;
            if (ac5eConfig) {
                const bonusEntries = [
                    ...(Array.isArray(ac5eConfig.subject?.bonus) ? ac5eConfig.subject.bonus : []),
                    ...(Array.isArray(ac5eConfig.opponent?.bonus) ? ac5eConfig.opponent.bonus : [])
                ];
                const optinSelected = ac5eConfig.optinSelected ?? {};
                for (const entry of bonusEntries) {
                    if (!entry) continue;
                    if (!isAc5eOptinActive(entry, optinSelected)) continue;

                    const entryKey = entry.id || entry.effectUuid || entry.name;
                    if (
                        (entry.id && claimedEffectIds.has(entry.id))
                        || (entry.effectUuid && claimedEffectIds.has(entry.effectUuid))
                        || (entry.name && claimedEffectIds.has(entry.name.toLowerCase()))
                        || (entry.customName && claimedEffectIds.has(entry.customName.toLowerCase()))
                        || (entryKey && claimedEffectIds.has(entryKey))
                    ) continue;

                    let entryTypes = Array.isArray(entry.requiredDamageTypes) ? entry.requiredDamageTypes.map(t => String(t).toLowerCase()) : [];
                    if (Array.isArray(entry.types)) entryTypes.push(...entry.types.map(t => String(t).toLowerCase()));
                    if (Array.isArray(entry.damageTypes)) entryTypes.push(...entry.damageTypes.map(t => String(t).toLowerCase()));
                    if (typeof entry.damageType === "string") entryTypes.push(entry.damageType.toLowerCase());

                    const rawBonus = String(entry.bonus ?? "");
                    for (const typeMatch of rawBonus.matchAll(/\[([a-zA-Z0-9_,\s-]+)\]/g)) {
                        entryTypes.push(...typeMatch[1].split(",").map(t => t.trim().toLowerCase()));
                    }
                    entryTypes = Array.from(new Set(entryTypes.filter(Boolean)));
                    if (rollDamageType && entryTypes.length && !entryTypes.includes(rollDamageType)) continue;

                    const cleanBonus = rawBonus.replace(/\[[^\]]+\]/g, "").replace(/^[+-]\s*/, "").trim();
                    let evaluatedBonus = cleanBonus;
                    if (cleanBonus.includes("@") && data) {
                        try {
                            evaluatedBonus = Roll.replaceFormulaData(cleanBonus, data).replace(/^[+-]\s*/, "").trim();
                        } catch {
                            // Keep cleanBonus
                        }
                    }
                    const numBonus = Number(evaluatedBonus);
                    const numClean = Number(clean);
                    const hasValidCleanNum = clean !== "" && !isNaN(numClean) && Number.isFinite(numClean) && numClean !== 0;
                    const hasValidBonusNum = !isNaN(numBonus) && Number.isFinite(numBonus) && numBonus !== 0;
                    const matches = (cleanBonus && cleanBonus.toLowerCase() === clean.toLowerCase())
                        || (evaluatedBonus && evaluatedBonus.toLowerCase() === clean.toLowerCase())
                        || (hasValidCleanNum && hasValidBonusNum && numBonus === numClean);

                    if (matches) {
                        effectName = entry.customName || entry.name || entry.label?.replace(/\s*\([^)]*\)\s*$/, "") || entry.label;
                        if (entryKey) claimedEffectIds.add(entryKey);
                        if (entry.id) claimedEffectIds.add(entry.id);
                        if (entry.effectUuid) claimedEffectIds.add(entry.effectUuid);
                        if (entry.name) claimedEffectIds.add(entry.name.toLowerCase());
                        if (entry.customName) claimedEffectIds.add(entry.customName.toLowerCase());
                        if (effectName) claimedEffectIds.add(effectName.toLowerCase());
                        break;
                    }
                }
            }

            // 2. ActiveEffect change matching on the actor
            if (!effectName) {
                effectName = findActiveEffectForDamageBonus(actor, clean, {
                    rollData: data,
                    isDamageRoll: isDamage,
                    damageType: rollDamageType,
                    isSyntheticBonus: isSyntheticBonusRoll,
                    isBase: (index === 0),
                    rollConfig,
                    processConfig,
                    claimedEffectIds
                });
            }

            if (effectName) {
                clean = `${clean}[${effectName}]`;
                modified = true;
                claimedEffectIds.add(effectName.toLowerCase());
            }
        }

        if (modified) {
            return sign === "-" ? `-${clean}` : clean;
        }

        return part;
    });
}

/**
 * Check whether an AC5e entry is active according to opt-in selections.
 *
 * @param {object} entry
 * @param {object} [optinSelected]
 * @returns {boolean}
 */
export function isAc5eOptinActive(entry, optinSelected) {
    if (!entry) return false;
    if (!entry.optin && !entry.forceOptin) return true;
    if (entry.forceOptin) return true;
    if (!optinSelected || typeof optinSelected !== "object") return false;

    const checkValue = (val) => {
        if (val === undefined || val === null) return null;
        if (typeof val === "object") return ("enabled" in val) ? Boolean(val.enabled) : true;
        return Boolean(val);
    };

    const idActive = entry.id ? checkValue(optinSelected[entry.id]) : null;
    const optinIdActive = entry.optinId ? checkValue(optinSelected[entry.optinId]) : null;
    if (idActive !== null) return idActive;
    if (optinIdActive !== null) return optinIdActive;
    return false;
}

/**
 * Parses an AC5e active effect change value expression into structured metadata.
 *
 * @param {string} changeValue - Raw change.value from an ActiveEffect.
 * @param {object} [rollData]   - Optional actor rollData for replacing formula references.
 * @returns {{ customName: string|null, bonusExpr: string, damageType: string|null, damageTypes: string[], cleanFormula: string, evaluatedStr: string }|null}
 */
/**
 * Checks whether a label or tag represents a standard D&D 5e damage/healing type or system attribute shorthand.
 * Prevents standard mechanics labels from being treated as active effect identifiers.
 *
 * @param {string} tag
 * @returns {boolean}
 */
export function isStandardDamageOrAttributeTag(tag) {
    if (!tag || typeof tag !== "string") return false;
    const clean = tag.trim().toLowerCase();
    if (!clean) return false;

    if (CONFIG.DND5E?.damageTypes?.[clean] || CONFIG.DND5E?.healingTypes?.[clean]) return true;

    const STANDARD_TAGS = new Set([
        "str", "dex", "con", "int", "wis", "cha", "mod",
        "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
        "pb", "pb (expertise)", "pb (half)", "proficiency", "proficiency bonus",
        "mgc", "magic weapon", "magic ammo",
        "situational", "item bonus", "bonus", "attack bonus",
        "cover", "half cover", "three-quarters cover"
    ]);
    if (STANDARD_TAGS.has(clean)) return true;
    if (/^exhaustion\s+\d+$/i.test(clean)) return true;

    return false;
}

/**
 * Determines whether a dnd5e rule change (e.g. type "dnd5e.bonus" with key "damage") could have contributed
 * to a damage or healing roll. dnd5e only collects "damage" rules for damage activities and "healing" rules for
 * heal activities, and filters them by their per-change and per-effect conditions.
 * Non-rule changes always return true so the caller's existing matching applies.
 *
 * @param {ActiveEffect5e} effect
 * @param {object} change
 * @param {object} [options]
 * @param {string} [options.damageType] - Damage or healing type of the roll, if known.
 * @param {object} [options.rollData]   - Roll data used for the roll; conditions are only checked if it has item data.
 * @returns {boolean}
 */
export function ruleChangeAppliesToDamageRoll(effect, change, { damageType = "", rollData = null } = {}) {
    const type = String(change?.type ?? "");
    if (!type.startsWith("dnd5e.")) return true;
    if (type !== "dnd5e.bonus") return false;

    const key = String(change.key ?? "").trim().toLowerCase();
    const cleanType = String(damageType ?? "").trim().toLowerCase();
    if (cleanType) {
        const expectedKey = CONFIG.DND5E?.healingTypes?.[cleanType] ? "healing" : "damage";
        if (key !== expectedKey) return false;
    } else if (key !== "damage" && key !== "healing") return false;

    // Roll data is not persisted with chat message rolls, so conditions can only be evaluated while it is present
    if (!rollData?.item) return true;
    try {
        const conditionData = effect?.getRuleConditionData?.(rollData) ?? rollData;
        if (effect?.system?.conditions?.check?.(conditionData) === false) return false;
        if (change.conditions?.check?.(conditionData) === false) return false;
    } catch {
        // Ignore condition evaluation errors and fall back to value matching
    }
    return true;
}

/**
 * Finds an ActiveEffect on an actor whose name or AC5e customName matches a given label.
 *
 * @param {Actor5e|null} actor
 * @param {string} label
 * @returns {ActiveEffect|null}
 */
export function findMatchingActorEffect(actor, label) {
    if (!actor || !label || typeof label !== "string") return null;
    const cleanLabel = label.trim().toLowerCase();
    if (!cleanLabel) return null;

    const effects = actor.appliedEffects ?? (actor.effects ? Array.from(actor.effects.values()) : []);
    for (const effect of effects) {
        if (effect.name?.trim().toLowerCase() === cleanLabel) return effect;
        for (const change of effect.changes ?? []) {
            const parsed = parseAc5eBonusChange(change.value);
            if (parsed?.customName?.trim().toLowerCase() === cleanLabel) return effect;
        }
    }
    return null;
}

/**
 * Parses an AC5e active effect change value expression into structured metadata.
 *
 * @param {string} changeValue - Raw change.value from an ActiveEffect.
 * @param {object} [rollData]   - Optional actor rollData for replacing formula references.
 * @returns {{ customName: string|null, bonusExpr: string, damageType: string|null, damageTypes: string[], cleanFormula: string, evaluatedStr: string }|null}
 */
export function parseAc5eBonusChange(changeValue, rollData = null) {
    if (typeof changeValue !== "string" || !changeValue.trim()) return null;
    const raw = changeValue.trim();

    // 1. Extract custom name if specified via name= or name:
    const nameMatch = raw.match(/(?:^|;)\s*name\s*[:=]\s*([^;]+)/i);
    const customName = nameMatch ? nameMatch[1].trim() : null;

    // 2. Extract bonus formula
    let bonusExpr = null;
    const bonusMatch = raw.match(/(?:^|;)\s*(?:bonus|value|formula)\s*[:=]\s*([^;]+)/i);
    const keywordRegex = /^(?:optin|name|condition|chance|cadence|priority|optinid|override|threshold|modify|modifier|preselected|radius|allies|enemies|wallsBlock|includeSelf|singleAura|criticalStatic|addTo|usesCount)\b/i;
    if (bonusMatch) {
        bonusExpr = bonusMatch[1].trim();
    } else {
        // Fallback: search all segments before any semicolon for the first non-keyword segment
        for (const seg of raw.split(";")) {
            const trimmedSeg = seg.trim();
            if (trimmedSeg && !keywordRegex.test(trimmedSeg)) {
                bonusExpr = trimmedSeg;
                break;
            }
        }
    }

    if (!bonusExpr) return null;

    // 3. Extract bracketed damage type if any e.g. [radiant], [fire, cold], or multiple [fire] + [cold]
    const damageTypes = [];
    for (const typeMatch of bonusExpr.matchAll(/\[([a-zA-Z0-9_,\s-]+)\]/g)) {
        const types = typeMatch[1].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        damageTypes.push(...types);
    }
    const damageType = damageTypes[0] || null;

    // 4. Clean formula without bracketed damage type or leading +/-
    const cleanFormula = bonusExpr.replace(/\[[^\]]+\]/g, "").replace(/^[+-]\s*/, "").trim();

    // 5. Evaluate formula if rollData is provided
    let evaluatedStr = cleanFormula;
    if (rollData && cleanFormula.includes("@")) {
        try {
            evaluatedStr = Roll.replaceFormulaData(cleanFormula, rollData).replace(/^[+-]\s*/, "").trim();
        } catch {
            // Keep cleanFormula on evaluation error
        }
    }
    if (evaluatedStr && !evaluatedStr.includes("d") && /[+\-*/]/.test(evaluatedStr)) {
        try {
            const mathResult = Roll.safeEval(evaluatedStr);
            if (mathResult !== undefined && !isNaN(mathResult)) {
                evaluatedStr = String(mathResult);
            }
        } catch {
            // Keep evaluatedStr on eval error
        }
    }

    return {
        raw,
        customName,
        bonusExpr,
        damageType,
        damageTypes,
        cleanFormula,
        evaluatedStr
    };
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
    const rollData = _getCachedRollData(actor);

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
            if (isDamage && !ruleChangeAppliesToDamageRoll(effect, change, {
                damageType: rollConfig?.options?.type ?? rollConfig?.data?.roll?.damage?.type ?? "",
                rollData: rollConfig?.data
            })) continue;

            const isAc5eChange = key.startsWith("flags.automated-conditions-5e.")
                || key.startsWith("flags.ac5e.")
                || String(change.mode) === "ac5e"
                || change.type === "ac5e";

            let rawVal = String(change.value ?? "").toLowerCase().trim();
            if (isAc5eChange) {
                const isOptin = /(?:^|[;|])\s*optin\b/i.test(rawVal);
                if (isOptin) {
                    const ac5eConfig = processConfig?.["automated-conditions-5e"]
                        ?? processConfig?.ac5e
                        ?? processConfig?.options?.["automated-conditions-5e"]
                        ?? rollConfig?.options?.["automated-conditions-5e"]
                        ?? null;
                    if (ac5eConfig?.optinSelected) {
                        const optinIdMatch = rawVal.match(/(?:^|;)\s*optinId\s*[:=]\s*([^;]+)/i);
                        const optinId = optinIdMatch ? optinIdMatch[1].trim() : null;
                        const fakeEntry = { id: effect.id, optinId, optin: true, forceOptin: false };
                        if (!isAc5eOptinActive(fakeEntry, ac5eConfig.optinSelected)) continue;
                    }
                }
                const parsed = parseAc5eBonusChange(change.value, rollData);
                if (parsed) {
                    if (parsed.evaluatedStr && matchesBonus(parsed.evaluatedStr)) {
                        return parsed.customName || effect.name;
                    }
                    if (parsed.cleanFormula && matchesBonus(parsed.cleanFormula.toLowerCase())) {
                        return parsed.customName || effect.name;
                    }
                }
            } else if (matchesBonus(rawVal)) {
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
 * Per-task cache of actor roll data. `Actor5e#getRollData` builds a fresh object graph on every call,
 * and breakdown generation looks up effect sources once per dice row and modifier. Roll data is only
 * read here, so a single copy per actor is shared until the current synchronous task completes.
 * @type {WeakMap<Actor, object>|null}
 */
let _rollDataCache = null;

/**
 * Get roll data for an actor, reusing the copy built earlier in the same task.
 * @param {Actor5e} actor
 * @returns {object}
 */
function _getCachedRollData(actor) {
    if (!actor?.getRollData) return {};
    if (!_rollDataCache) {
        _rollDataCache = new WeakMap();
        queueMicrotask(() => { _rollDataCache = null; });
    }
    let data = _rollDataCache.get(actor);
    if (!data) {
        data = actor.getRollData();
        _rollDataCache.set(actor, data);
    }
    return data;
}

/**
 * Find the name of an active effect providing a specific damage bonus on an actor.
 *
 * @param {Actor5e|null} actor
 * @param {string|number} targetVal - Numeric value or formula string of the bonus.
 * @param {object} [options={}]
 * @param {object} [options.rollData]
 * @param {Roll} [options.roll]
 * @param {object} [options.rollConfig]
 * @param {object} [options.processConfig]
 * @param {string} [options.damageType]
 * @param {boolean} [options.isSyntheticBonus]
 * @param {Set<string>} [options.claimedEffectIds]
 * @returns {string|null}
 */
export function findActiveEffectForDamageBonus(actor, targetVal, options = {}) {
    if (!actor || targetVal === undefined || targetVal === null) return null;
    if (options.isDamageRoll === false) return null;
    if (options.roll && !isDamageRoll(options.roll)) return null;
    const effects = actor.appliedEffects ?? (actor.effects ? Array.from(actor.effects.values()) : []);
    if (!effects.length) return null;

    const rollData = options.rollData ?? _getCachedRollData(actor);
    const claimedEffectIds = options.claimedEffectIds;

    const targetDamageType = String(
        options.damageType
        ?? options.roll?.options?.type
        ?? options.rollConfig?.options?.type
        ?? options.rollConfig?.data?.roll?.damage?.type
        ?? options.rollConfig?.data?.roll?.type
        ?? options.roll?.data?.roll?.damage?.type
        ?? ""
    ).trim().toLowerCase();

    const isSynthetic = Boolean(
        options.isSyntheticBonus
        || options.roll?.options?.["automated-conditions-5e"]?.syntheticBonusRoll
        || options.roll?.options?.ac5e?.syntheticBonusRoll
        || options.rollConfig?.options?.["automated-conditions-5e"]?.syntheticBonusRoll
        || options.rollConfig?.options?.ac5e?.syntheticBonusRoll
    );

    // Roll data that includes item data, used to evaluate dnd5e rule conditions
    const conditionRollData = [options.rollData, options.roll?.data, options.rollConfig?.data].find(d => d?.item) ?? null;

    const DAMAGE_KEY_REGEX = /(?:bonuses\.(?:[a-z]{4}|all)\.damage|rolls\.damage\.[a-z]{4}\.bonus)/i;

    const targetNum = Number(targetVal);
    const hasTargetNum = !isNaN(targetNum) && Number.isFinite(targetNum) && targetNum !== 0;
    const targetStr = String(targetVal).replace(/^[+-]\s*/, "").trim().toLowerCase();

    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        if (claimedEffectIds && (
            claimedEffectIds.has(effect.id)
            || (effect.uuid && claimedEffectIds.has(effect.uuid))
            || (effect.name && claimedEffectIds.has(effect.name.toLowerCase()))
        )) continue;

        const changes = effect.changes ?? [];
        for (const change of changes) {
            const key = String(change.key ?? "");
            const keyLower = key.toLowerCase();
            const rawVal = String(change.value ?? "").trim();
            if (!rawVal) continue;

            // 1. AC5e active effect change format
            const isAc5eChange = /^(?:flags\.(?:automated-conditions-5e|ac5e)\.(?:aura\.|grants\.)?(?:damage|all)\.bonus)/i.test(keyLower)
                || ((String(change.mode) === "ac5e" || change.type === "ac5e") && (keyLower.includes("damage") || keyLower.includes("all")));

            if (isAc5eChange) {
                const isOptin = /(?:^|[;|])\s*optin\b/i.test(rawVal);
                if (isOptin) {
                    const ac5eConfig = options.processConfig?.["automated-conditions-5e"]
                        ?? options.processConfig?.ac5e
                        ?? options.rollConfig?.options?.["automated-conditions-5e"]
                        ?? options.roll?.options?.["automated-conditions-5e"]
                        ?? null;
                    if (ac5eConfig?.optinSelected) {
                        const optinIdMatch = rawVal.match(/(?:^|;)\s*optinId\s*[:=]\s*([^;]+)/i);
                        const optinId = optinIdMatch ? optinIdMatch[1].trim() : null;
                        const fakeEntry = { id: effect.id, optinId, optin: true, forceOptin: false };
                        if (!isAc5eOptinActive(fakeEntry, ac5eConfig.optinSelected)) continue;
                    }
                }

                const parsed = parseAc5eBonusChange(rawVal, rollData);
                if (!parsed) continue;

                // Damage type filtering: if both roll and change specify damage types, target must be included
                if (targetDamageType && parsed.damageTypes?.length && !parsed.damageTypes.includes(targetDamageType)) {
                    continue;
                }
                if (targetDamageType && parsed.damageType && !parsed.damageTypes?.length && parsed.damageType !== targetDamageType) {
                    continue;
                }

                // If label was already claimed, skip
                const label = parsed.customName || effect.name;
                if (claimedEffectIds && label && claimedEffectIds.has(label.toLowerCase())) {
                    continue;
                }

                // Match against target formula or numeric value
                const matchesFormula = targetStr && (
                    parsed.cleanFormula.toLowerCase() === targetStr
                    || parsed.evaluatedStr.toLowerCase() === targetStr
                );
                const evalNum = Number(parsed.evaluatedStr);
                const matchesNum = hasTargetNum && !isNaN(evalNum) && Math.abs(evalNum) === Math.abs(targetNum);

                if (matchesFormula || matchesNum) {
                    if (claimedEffectIds) {
                        claimedEffectIds.add(effect.id);
                        if (effect.uuid) claimedEffectIds.add(effect.uuid);
                        if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                        if (label) claimedEffectIds.add(label.toLowerCase());
                    }
                    return label;
                }
                continue;
            }

            // 2. dnd5e rule changes must target this roll's category and pass their conditions
            if (!ruleChangeAppliesToDamageRoll(effect, change, { damageType: targetDamageType, rollData: conditionRollData })) continue;

            // 3. Standard 5e damage bonus keys (and dnd5e "damage"/"healing" rule keys)
            if (!DAMAGE_KEY_REGEX.test(key) && !keyLower.includes("damage") && keyLower !== "healing") continue;

            const strippedVal = rawVal.replace(/^[+-]\s*/, "").trim().toLowerCase();

            // Extract any bracketed damage type from standard change (e.g. "2[fire]" or "1d4[radiant]")
            const stdTypeMatch = rawVal.match(/\[([a-zA-Z0-9_-]+)\]/);
            const stdDamageType = stdTypeMatch ? stdTypeMatch[1].toLowerCase() : null;

            if (targetDamageType && stdDamageType && stdDamageType !== targetDamageType) {
                continue;
            }

            const cleanVal = strippedVal.replace(/\[[^\]]+\]/g, "").trim();

            // If the roll is a synthetic bonus roll or secondary damage roll,
            // generic weapon attack bonuses (bonuses.mwak.damage / rolls.damage.mwak.bonus)
            // that don't specify this damage type should NOT match it
            const isSecondaryOrSynthetic = isSynthetic || (options.isBase === false);
            if (isSecondaryOrSynthetic && !stdDamageType && (/bonuses\.(?:[mr][ws]ak|weapon|all)\.damage/i.test(key) || /rolls\.damage\.(?:[mr][ws]ak|weapon|all)\.bonus/i.test(key))) {
                continue;
            }

            if (claimedEffectIds && (
                claimedEffectIds.has(effect.id)
                || (effect.uuid && claimedEffectIds.has(effect.uuid))
                || (effect.name && claimedEffectIds.has(effect.name.toLowerCase()))
            )) {
                continue;
            }

            // Direct formula string comparison (e.g. "@scale.barbarian.rage-damage")
            if (targetStr && (cleanVal === targetStr || strippedVal === targetStr || rawVal.toLowerCase() === targetStr)) {
                if (claimedEffectIds) {
                    claimedEffectIds.add(effect.id);
                    if (effect.uuid) claimedEffectIds.add(effect.uuid);
                    if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                }
                return effect.name;
            }

            // Resolve rollData in the change value
            let evaluatedStr = cleanVal;
            if (evaluatedStr.includes("@")) {
                try {
                    evaluatedStr = Roll.replaceFormulaData(cleanVal, rollData).replace(/^[+-]\s*/, "").trim().toLowerCase();
                } catch {
                    // Ignore formula evaluation errors
                }
            }
            if (evaluatedStr && !evaluatedStr.includes("d") && /[+\-*/]/.test(evaluatedStr)) {
                try {
                    const mathResult = Roll.safeEval(evaluatedStr);
                    if (mathResult !== undefined && !isNaN(mathResult)) {
                        evaluatedStr = String(mathResult);
                    }
                } catch {
                    // Ignore safeEval error
                }
            }

            // String match after rollData replacement
            if (targetStr && evaluatedStr === targetStr) {
                if (claimedEffectIds) {
                    claimedEffectIds.add(effect.id);
                    if (effect.uuid) claimedEffectIds.add(effect.uuid);
                    if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                }
                return effect.name;
            }

            // Numeric comparison if target is numeric
            if (hasTargetNum) {
                const evalNum = Number(evaluatedStr);
                if (!isNaN(evalNum) && Math.abs(evalNum) === Math.abs(targetNum)) {
                    if (claimedEffectIds) {
                        claimedEffectIds.add(effect.id);
                        if (effect.uuid) claimedEffectIds.add(effect.uuid);
                        if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                    }
                    return effect.name;
                }
            }
        }
    }

    // Heuristic fallback for Rage / Kampfrausch effects
    for (const effect of effects) {
        if (effect.disabled || effect.isSuppressed) continue;
        if (claimedEffectIds && (
            claimedEffectIds.has(effect.id)
            || (effect.uuid && claimedEffectIds.has(effect.uuid))
            || (effect.name && claimedEffectIds.has(effect.name.toLowerCase()))
        )) continue;
        const name = (effect.name ?? "").toLowerCase();
        if (name.includes("rage") || name.includes("kampfrausch")) {
            if (hasTargetNum) {
                const rageScale = actor.system?.scale?.barbarian?.["rage-damage"]?.value
                    ?? actor.system?.scale?.barbarian?.["rage-damage"]
                    ?? null;
                const rageNum = rageScale !== null ? Number(rageScale) : null;
                if (rageNum !== null && !isNaN(rageNum) && Math.abs(rageNum) === Math.abs(targetNum)) {
                    if (claimedEffectIds) {
                        claimedEffectIds.add(effect.id);
                        if (effect.uuid) claimedEffectIds.add(effect.uuid);
                        if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                    }
                    return effect.name;
                }
            }
            if (targetStr.includes("rage")) {
                if (claimedEffectIds) {
                    claimedEffectIds.add(effect.id);
                    if (effect.uuid) claimedEffectIds.add(effect.uuid);
                    if (effect.name) claimedEffectIds.add(effect.name.toLowerCase());
                }
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
export function processModifierChunk(chunk, roll, { actor = null, claimedEffectIds = null, isBase = false } = {}) {
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
    let modDamageType = null;
    for (const t of terms) {
        const flav = (t.flavor ? t.flavor.trim() : (t.options?.flavor ? String(t.options.flavor).trim() : "")).toLowerCase();
        if (CONFIG.DND5E?.damageTypes?.[flav] || CONFIG.DND5E?.healingTypes?.[flav]) {
            modDamageType = flav;
        }
        const formulaMatch = t.formula ? t.formula.match(/\[([a-zA-Z0-9_-]+)\]/) : null;
        if (formulaMatch) {
            const formType = formulaMatch[1].trim().toLowerCase();
            if (CONFIG.DND5E?.damageTypes?.[formType] || CONFIG.DND5E?.healingTypes?.[formType]) {
                modDamageType = formType;
            }
        }
        if (flav && !label) {
            label = t.flavor ? t.flavor.trim() : (t.options?.flavor ? String(t.options.flavor).trim() : "");
        }
        if (t instanceof foundry.dice.terms.ParentheticalTerm && t.roll?.terms) {
            for (const pt of t.roll.terms) {
                const pfl = pt.flavor ? pt.flavor.trim() : (pt.options?.flavor ? String(pt.options.flavor).trim() : "");
                if (pfl && !label) {
                    label = pfl;
                }
            }
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

    const isModFlavorStandardTag = !label || isStandardDamageOrAttributeTag(label) || (modDamageType && label.toLowerCase() === modDamageType);
    if (isModFlavorStandardTag && actor && isDamageRoll(roll)) {
        const damageTypeForLookup = modDamageType || String(roll.options?.type ?? "").trim().toLowerCase();
        const effectName = findActiveEffectForDamageBonus(actor, absVal, {
            roll,
            damageType: damageTypeForLookup,
            isBase,
            claimedEffectIds
        });
        if (effectName) {
            label = effectName;
        } else if (modDamageType && label.toLowerCase() === modDamageType) {
            label = "";
        }
    }

    if (claimedEffectIds && label && !isStandardDamageOrAttributeTag(label)) {
        claimedEffectIds.add(label.toLowerCase());
        const matched = findMatchingActorEffect(actor, label);
        if (matched) {
            claimedEffectIds.add(matched.id);
            if (matched.uuid) claimedEffectIds.add(matched.uuid);
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
        isDie: false,
        damageType: modDamageType || roll.options?.type || null
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

    let dieDamageType = null;
    const candidateType = (rawFlavor || "").trim().toLowerCase();
    if (CONFIG.DND5E?.damageTypes?.[candidateType] || CONFIG.DND5E?.healingTypes?.[candidateType]) {
        dieDamageType = candidateType;
    } else if (rawFormulaMatch) {
        const formulaType = rawFormulaMatch[1].trim().toLowerCase();
        if (CONFIG.DND5E?.damageTypes?.[formulaType] || CONFIG.DND5E?.healingTypes?.[formulaType]) {
            dieDamageType = formulaType;
        }
    }

    const isFlavorStandardTag = !cleanFlavor || isStandardDamageOrAttributeTag(cleanFlavor) || (dieDamageType && cleanFlavor.toLowerCase() === dieDamageType);
    if (isFlavorStandardTag && actor && isDamageRoll(roll)) {
        const expression = die?.expression || (die?.faces ? `${die.number ?? 1}d${die.faces}` : "");
        const damageTypeForLookup = dieDamageType || String(roll.options?.type ?? "").trim().toLowerCase();
        const effectName = findActiveEffectForDamageBonus(actor, expression, {
            claimedEffectIds,
            roll,
            damageType: damageTypeForLookup,
            isBase
        });
        if (effectName) {
            cleanFlavor = effectName;
        } else if (dieDamageType && cleanFlavor.toLowerCase() === dieDamageType) {
            cleanFlavor = "";
        }
    }

    if (claimedEffectIds && cleanFlavor && !isStandardDamageOrAttributeTag(cleanFlavor)) {
        claimedEffectIds.add(cleanFlavor.toLowerCase());
        const matched = findMatchingActorEffect(actor, cleanFlavor);
        if (matched) {
            claimedEffectIds.add(matched.id);
            if (matched.uuid) claimedEffectIds.add(matched.uuid);
        }
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
        isBase,
        damageType: dieDamageType || roll.options?.type || null
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
            isBase,
            damageType: roll?.options?.type || null
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
    const claimedEffectIds = options.claimedEffectIds ?? new Set();

    // Pre-populate claimedEffectIds from any terms that already contain flavor
    if (actor && isDamageRoll(roll)) {
        for (const term of terms) {
            const rawFlv = String(term.options?.flavor || term.flavor || "").trim();
            const cleanFlv = extractCleanDieFlavor(rawFlv, roll).toLowerCase();
            if (cleanFlv && !isStandardDamageOrAttributeTag(cleanFlv)) {
                claimedEffectIds.add(cleanFlv);
                const matched = findMatchingActorEffect(actor, cleanFlv);
                if (matched) {
                    claimedEffectIds.add(matched.id);
                    if (matched.uuid) claimedEffectIds.add(matched.uuid);
                }
            }
        }
    }

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
            modifiers.push(processModifierChunk(chunk, roll, { actor, claimedEffectIds, isBase: isBaseChunk }));
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
    patchMethod(
        "CONFIG.Dice.BasicRoll.prototype.getTooltip",
        async function(wrapped, ...args) {
            if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) {
                return wrapped(...args);
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

            return wrapped(...args);
        },
        "MIXED"
    );
}

/**
 * Handler for DamageApplicationElement#calculateDamage to guard against undefined actor references.
 */
function _onCalculateDamage(wrapped, actor, options = {}) {
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
    return wrapped(actor, options);
}

let _damageApplicationPatched = false;

/**
 * Patch DamageApplicationElement#calculateDamage to guard against undefined actor references.
 * In DnD5e 6.x, if an unlinked token or missing actor is targeted, calculateDamage throws:
 * "TypeError: Cannot read properties of undefined (reading 'calculateDamage')"
 * causing chat render loops and console errors.
 */
export function patchDamageApplicationCalculateDamage() {
    if (_damageApplicationPatched) return;
    const target = "dnd5e.applications.components.DamageApplicationElement.prototype.calculateDamage";
    const applyPatch = () => {
        if (_damageApplicationPatched) return;
        _damageApplicationPatched = true;
        patchMethod(target, _onCalculateDamage, "MIXED");
        log("Patched DamageApplicationElement#calculateDamage for actor safety");
    };

    if (foundry.utils.getProperty(globalThis, target)) {
        applyPatch();
    } else if (customElements.whenDefined) {
        customElements.whenDefined("damage-application").then(() => {
            applyPatch();
        });
    }
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

    const rendered = await _renderDamageBreakdown(message, damageRolls);
    if (!rendered) return;
    message._nd5tBreakdownHtml = rendered;
    breakdownEl.innerHTML = rendered;
}

/**
 * Render the damage breakdown for a set of damage rolls: one section per damage type, dice at the
 * top (base weapon damage first), modifiers below.
 *
 * @param {ChatMessage5e} message
 * @param {DamageRoll[]} damageRolls
 * @returns {Promise<string|null>} The rendered HTML, or null when there is nothing to show.
 */
async function _renderDamageBreakdown(message, damageRolls) {
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
        const claimedEffectIds = new Set();

        const ensureTypeGroup = (rawType) => {
            const cleanType = (typeof rawType === "string") ? rawType.trim().toLowerCase() : "";
            const isUntyped = !cleanType || cleanType === "untyped" || cleanType === "none" || cleanType === "pure";
            const damageType = isUntyped ? "untyped" : cleanType;

            if (!typeMap.has(damageType)) {
                const typeConfig = CONFIG.DND5E?.damageTypes?.[damageType] ?? CONFIG.DND5E?.healingTypes?.[damageType] ?? null;
                const pureLabel = game.i18n?.localize?.("ND5T.DamageType.Pure") || "Pure";
                const typeLabel = typeConfig?.labelShort ?? typeConfig?.label ?? (isUntyped ? pureLabel.toUpperCase() : damageType.toUpperCase());
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
            return typeMap.get(damageType);
        };

        for (let i = 0; i < damageRolls.length; i++) {
            const roll = damageRolls[i];
            if (!roll.parent) roll.parent = message;

            const isBase = Boolean(roll.options?.base || roll.base || (isWeapon && i === 0));
            const data = await getDetailedRollBreakdown(roll, { isBase, actor, item, claimedEffectIds });
            if (!data) continue;

            const rollDamageType = (typeof roll.options?.type === "string") ? roll.options.type.trim().toLowerCase() : "";

            // Check if this roll has mixed damage types across its dice or modifiers
            const hasMultipleTypesInRoll = (data.diceRows ?? []).some(d => d.damageType && d.damageType.toLowerCase() !== rollDamageType)
                || (data.modifiers ?? []).some(m => m.damageType && m.damageType.toLowerCase() !== rollDamageType);

            if (!hasMultipleTypesInRoll) {
                // Standard case: all terms belong to roll's damage type
                const group = ensureTypeGroup(rollDamageType);
                if (data.diceRows?.length) group.diceRows.push(...data.diceRows);
                if (data.modifiers?.length) group.modifiers.push(...data.modifiers);
                group.sectionTotal += Number(roll.total ?? 0);
            } else {
                // Partitioned case: distribute dice and modifiers into their respective damage types
                for (const dieRow of data.diceRows ?? []) {
                    const targetType = (dieRow.damageType ? dieRow.damageType.toLowerCase() : null) || rollDamageType;
                    const group = ensureTypeGroup(targetType);
                    group.diceRows.push(dieRow);
                    group.sectionTotal += Number(dieRow.total ?? 0);
                }
                for (const mod of data.modifiers ?? []) {
                    const targetType = (mod.damageType ? mod.damageType.toLowerCase() : null) || rollDamageType;
                    const group = ensureTypeGroup(targetType);
                    group.modifiers.push(mod);
                    group.sectionTotal += Number(mod.signedTotal ?? 0);
                }
            }
        }

        if (!typeMap.size) return null;

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

        return rendered;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error enhancing damage chat message breakdown:", err);
        return null;
    }
}

/**
 * midi-qol's merged card sections: the `.dice-roll` class of each section and the `rollType`
 * midi-qol stores on the rolls shown in it (`options.midi-qol.rollType`).
 */
const MIDI_SECTIONS = [
    { selector: ".midi-attack-roll", rollType: "attack" },
    { selector: ".midi-damage-roll", rollType: "defaultDamage", isDamage: true },
    { selector: ".midi-other-damage-roll", rollType: "otherDamage", isDamage: true }
];

/**
 * Show the detailed breakdown in the attack and damage sections of midi-qol's merged card.
 *
 * midi-qol renders those sections with its own tooltip template instead of `roll.getTooltip()`, so
 * the overlay never reached them. Only the content of an existing `.dice-tooltip` is replaced:
 * midi-qol removes the tooltip for players when its settings hide roll details (and dnd5e.renderChatMessage
 * fires after that masking), so nothing hidden comes back. midi-qol's own notes on where
 * advantage and bonuses came from are kept at the top.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
async function enhanceMidiSectionBreakdowns(message, html) {
    if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const results = root?.querySelector?.(".midi-results");
    if (!results || !message?.rolls?.length) return;

    message._nd5tMidiBreakdowns ??= new Map();
    for (const { selector, rollType, isDamage } of MIDI_SECTIONS) {
        const tooltip = results.querySelector(`.dice-roll${selector} .dice-tooltip`);
        if (!tooltip || tooltip.querySelector(".nd5t-roll-breakdown")) continue;
        const rolls = message.rolls.filter(r => foundry.utils.getProperty(r, "options.midi-qol.rollType") === rollType);
        if (!rolls.length) continue;

        // The card re-renders at every workflow step; reuse the breakdown while its rolls are unchanged.
        const key = `${rollType}:${rolls.map(r => `${r.formula}=${r.total}`).join("|")}`;
        let rendered = message._nd5tMidiBreakdowns.get(key);
        if (rendered === undefined) {
            try {
                if (isDamage) rendered = await _renderDamageBreakdown(message, rolls);
                else {
                    const data = await getDetailedRollBreakdown(rolls[0]);
                    rendered = data ? await foundry.applications.handlebars.renderTemplate(
                        "modules/niks-dnd5e-tweaks/templates/chat/roll-breakdown-details.hbs", data) : null;
                }
            } catch (err) {
                console.error("Nik's DnD5e Tweaks | Error rendering midi-qol section breakdown:", err);
                rendered = null;
            }
            message._nd5tMidiBreakdowns.set(key, rendered);
        }
        if (!rendered) continue;

        const template = document.createElement("template");
        template.innerHTML = rendered;
        const ours = template.content.querySelector(".dice-tooltip");
        if (!ours) continue;
        // Keep midi-qol's formula and attribution notes; its dice parts are what ours replaces.
        const notes = Array.from(tooltip.querySelectorAll(":scope > section.tooltip-part:not(:has(.dice))"));
        ours.prepend(...notes);
        tooltip.replaceWith(ours);
    }
}

let isInitialized = false;

/**
 * Server time when the world became ready; messages created after this are eagerly pre-cached on render.
 * Uses server time because ChatMessage timestamps are server-assigned.
 * @type {number}
 */
let _sessionStart = Infinity;

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
        // A card summary (a save or check shown inside the card that requested it) belongs to its own
        // message, not the card's: midi-qol's merged card carries damage rolls of its own.
        const chatCard = popoverEl.closest(".card-summary[data-message-id], .chat-message[data-message-id], .message[data-message-id]")
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
    if (isInitialized) return;
    isInitialized = true;

    patchDamageApplicationCalculateDamage();

    log("Initializing Detailed Roll Breakdown Overlay");

    // Tier 1: Proactive formula tagging and typed bonus damage splitting during roll construction
    Hooks.on("dnd5e.preRollDamage", (config, dialog, message) => {
        splitTypedDamageParts(config, dialog, message);
    });

    // dnd5e.postBuildRollConfig fires exactly once for all roll types (attacks, damage, checks, saves, tools)
    Hooks.on("dnd5e.postBuildRollConfig", (processConfig, rollConfig, index, hookOptions) => {
        tagRollConfigParts(processConfig, rollConfig, index, hookOptions);
    });

    // Tier 2 & 3: Enhanced breakdown rendering for BasicRoll (d20 rolls, checks, saves)
    wrapBasicRollGetTooltip();

    // Pre-cache breakdown for chat messages created during this session (Foundry V14 hook).
    // Older messages rendered while scrolling back through the log are left to the lazy
    // hover / toggle handlers below, so loading history does not build every breakdown up front.
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!game.ready) return;
        if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
        if (!(message?.timestamp >= _sessionStart)) return;
        const popovers = html?.querySelectorAll?.(".roll-breakdown[popover]") ?? [];
        for (const popover of popovers) {
            _ensurePopoverBreakdown(popover, message);
        }
    });

    // midi-qol merged card: its attack and damage sections use midi-qol's own tooltip.
    // dnd5e.renderChatMessage fires after midi-qol has masked what players may not see.
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        enhanceMidiSectionBreakdowns(message, html);
    });

    // Pre-cache recent historical messages once the world and messages collection are fully ready
    Hooks.once("ready", () => {
        _sessionStart = (game.time?.serverTime ?? Date.now()) - 5000;
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
            if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
            _ensurePopoverBreakdown(event.target);
        }, { capture: true });

        document.addEventListener("pointerdown", (event) => {
            if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
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
            if (!isFeatureActive("enableRollBreakdownDetails", "clientEnableRollBreakdownDetails")) return;
            const row = event.target?.closest?.(".icon-row, .chat-message");
            if (!row) return;
            const popovers = row.querySelectorAll?.(".roll-breakdown[popover]") ?? [];
            for (const popover of popovers) _ensurePopoverBreakdown(popover);
        }, { capture: true, passive: true });
    }
}
