/**
 * Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, Great Weapon Master, Brutal Strike & Cleave)
 *
 * Offers toggles in damage roll configuration dialogs when an actor is actively
 * concentrating on Hex or Hunter's Mark, attacks with a ranged or finesse weapon (Sneak Attack),
 * attacks with a Heavy weapon under 2024 rules with Great Weapon Master (+PB bonus flavored with GWM),
 * attacks with Brutal Strike (@scale.barbarian.brutal-strike bonus matching weapon damage type, reset to disabled),
 * or attacks with a Cleave mastery weapon (damage malus removing ability score modifier unless negative).
 * Remembers choices per actor (except Cleave and Brutal Strike, which are disabled by default and strictly one-off).
 */

import { MODULE_ID, isFeatureActive, log, debug } from "../../main.js";

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
 * In-memory fallback cache for actor choices (keyed by actor UUID/ID -> { [bonusId]: boolean }).
 * Guarantees zero-latency and persistence for unlinked synthetic tokens, permission edge cases,
 * or compendium actors.
 * @type {Map<string, Record<string, boolean>>}
 */
const _actorChoiceMemory = new Map();

/**
 * Safely extract the boolean state of a conditional bonus toggle from the DOM form and FormDataExtended.
 * Avoids the native FormData.prototype.get() pitfall where unchecked checkboxes return serialized "false"
 * (which evaluates to truthy Boolean("false") in JavaScript).
 *
 * @param {HTMLFormElement|null} form
 * @param {FormDataExtended|null} formData
 * @param {string} bonusId
 * @returns {boolean}
 */
function _getBonusToggleValue(form, formData, bonusId) {
    const key = `nd5t.conditional.${bonusId}`;
    if (form?.elements?.[key]) {
        const el = form.elements[key];
        if (typeof el.checked === "boolean") return el.checked;
        if (el instanceof NodeList || Array.isArray(el)) {
            const first = el[0];
            if (typeof first?.checked === "boolean") return first.checked;
        }
    }
    if (formData?.object && key in formData.object) {
        return Boolean(formData.object[key]);
    }
    const raw = formData?.get?.(key);
    if (raw === "true" || raw === true) return true;
    if (raw === "false" || raw === false || raw === null || raw === undefined) return false;
    return Boolean(raw);
}

/**
 * Retrieve Rogue class or NPC Sneak Attack data and formula for an actor.
 * Resolves the native Scale Value advancement from the Rogue class in DnD5e 6.x,
 * or falls back to an NPC Sneak Attack feat item (e.g. Assassin, Spy).
 *
 * @param {Actor5e} actor
 * @returns {{ classItem: Item5e|null, featureItem?: Item5e, levels: number, formula: string }|null}
 */
export function getRogueData(actor) {
    if (!actor) return null;

    // 1. PC Rogue class advancement
    const classes = actor.itemTypes?.class ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "class");
    const rogueClass = classes.find(c => {
        const id = (c.identifier || c.system?.identifier || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        return id === "rogue" || name === "rogue";
    });

    if (rogueClass) {
        const levels = Number(rogueClass.system?.levels ?? 0);
        if (levels >= 1) {
            // Retrieve native scale value formula from rogue class advancement
            // e.g. actor.system.scale.rogue["sneak-attack"].formula
            const scaleGroup = actor.system?.scale?.[rogueClass.identifier]
                ?? actor.system?.scale?.rogue
                ?? rogueClass.scaleValues
                ?? {};

            let scaleObj = scaleGroup["sneak-attack"] ?? scaleGroup["sneakAttack"] ?? scaleGroup["sneak_attack"];
            if (!scaleObj) {
                for (const [key, val] of Object.entries(scaleGroup)) {
                    if (key.toLowerCase().includes("sneak")) {
                        scaleObj = val;
                        break;
                    }
                }
            }

            const rawFormula = scaleObj?.formula ?? (typeof scaleObj === "string" ? scaleObj : scaleObj?.value);
            const formula = rawFormula || `${Math.ceil(levels / 2)}d6`;

            return {
                classItem: rogueClass,
                levels,
                formula
            };
        }
    }

    // 2. NPC / Monster Sneak Attack feature item (e.g. Assassin, Spy)
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    const sneakFeat = feats.find(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "sneak-attack" || id === "sneak_attack" || name.includes("sneak attack");
    });

    if (sneakFeat) {
        let featFormula = "";
        const activities = sneakFeat.system?.activities;
        if (activities) {
            const list = activities.values ? Array.from(activities.values()) : Object.values(activities);
            for (const act of list) {
                const part = act.damage?.parts?.[0];
                if (part?.number && part?.denomination) {
                    featFormula = `${part.number}d${part.denomination}`;
                    break;
                }
                if (part?.formula) {
                    featFormula = part.formula;
                    break;
                }
            }
        }

        if (!featFormula) {
            const parts = sneakFeat.system?.damage?.parts;
            if (Array.isArray(parts) && parts.length && parts[0]?.[0]) {
                featFormula = parts[0][0];
            }
        }

        if (!featFormula) {
            const desc = sneakFeat.system?.description?.value || "";
            const match = desc.match(/(\d+d6)/i);
            if (match) featFormula = match[1];
        }

        if (featFormula) {
            return {
                classItem: null,
                featureItem: sneakFeat,
                levels: 0,
                formula: featFormula
            };
        }
    }

    return null;
}

/**
 * Determine if a weapon is eligible for Sneak Attack (ranged weapon or finesse property).
 * Under 5e RAW, thrown melee weapons without finesse (e.g. Handaxe, Spear, Javelin) do NOT qualify.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} [activity=null]
 * @param {DamageRollProcessConfiguration|null} [config=null]
 * @returns {boolean}
 */
export function isEligibleSneakAttackWeapon(item, activity = null, config = null) {
    if (!item || item.type !== "weapon") return false;

    // 1. Finesse property check ("fin" or "finesse")
    const props = item.system?.properties;
    const hasFinesse = props instanceof Set
        ? (props.has("fin") || props.has("finesse"))
        : Array.isArray(props)
            ? (props.includes("fin") || props.includes("finesse"))
            : Boolean(props?.fin || props?.finesse);
    if (hasFinesse) return true;

    // A melee weapon lacking finesse is strictly ineligible under 5e RAW, even if thrown (e.g. handaxe/spear)
    const weaponType = item.system?.type?.value;
    const isMeleeWeapon = weaponType === "simpleM" || weaponType === "martialM";
    if (isMeleeWeapon) return false;

    // 2. Ranged weapon type check ("simpleR", "martialR", or weaponTypeMap)
    if (weaponType === "simpleR" || weaponType === "martialR") return true;
    if (CONFIG.DND5E?.weaponTypeMap?.[weaponType] === "ranged") return true;

    // 3. Ranged attack activity classification (e.g. rwak) for non-melee weapons, honoring thrown/ranged attack modes
    const actionType = activity?.getActionType?.(config?.attackMode) ?? activity?.actionType ?? item.system?.actionType;
    if (actionType === "rwak") return true;

    return false;
}

/**
 * Check whether 2024 / Modern rules are active in the world.
 *
 * @returns {boolean}
 */
export function isModernRules() {
    try {
        const setting = dnd5e?.settings?.rulesVersion ?? game.settings?.get?.("dnd5e", "rulesVersion");
        return setting === "modern";
    } catch {
        return false;
    }
}

/**
 * Check whether an actor possesses the Great Weapon Master feat by identifier.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasGreatWeaponMaster(actor) {
    if (!actor) return false;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "great-weapon-master"
            || id === "great_weapon_master"
            || id.includes("great-weapon-master")
            || id.includes("great_weapon_master")
            || name.includes("great weapon master");
    });
}

/**
 * Check whether an actor possesses the Brutal Strike feature by identifier.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasBrutalStrike(actor) {
    if (!actor) return false;
    const items = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []);
    return items.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "brutal-strike"
            || id === "brutal_strike"
            || id.includes("brutal-strike")
            || id.includes("brutal_strike")
            || name.includes("brutal strike");
    });
}

/**
 * Check whether an actor possesses the Charger feat by identifier.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasCharger(actor) {
    if (!actor) return false;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "charger"
            || id === "charger-feat"
            || id === "feat-charger"
            || /(?:^|[-_\s])charger(?:$|[-_\s])/i.test(id)
            || /\bcharger\b/i.test(name);
    });
}

/**
 * Determine whether an attack is eligible for Charger.
 * Under 2024 PHB rules, Charger applies to a melee attack roll dealt as part of
 * the Attack action (e.g. melee weapon attack or unarmed strike). Ranged attacks,
 * ranged weapons, thrown attacks, saving throws, and spell attacks do NOT qualify.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} [activity=null]
 * @param {DamageRollProcessConfiguration|null} [config=null]
 * @returns {boolean}
 */
export function isEligibleChargerAttack(item, activity = null, config = null) {
    if (!item) return false;
    if (item.type === "spell") return false;

    const attackMode = config?.attackMode;
    if (attackMode?.startsWith?.("thrown") || attackMode === "ranged") return false;

    // If an activity is provided, it must be an attack activity (e.g. not a Grapple/Shove save activity on unarmed strike)
    if (activity?.type && activity.type !== "attack") return false;
    if (activity?.attack?.type?.value === "ranged") return false;

    // Check action type on activity or item
    const actionType = activity?.getActionType?.(attackMode)
        ?? activity?.actionType
        ?? item.system?.actionType;

    if (actionType === "mwak") return true;
    if (actionType === "rwak" || actionType === "rsak" || actionType === "msak") return false;

    // Check modern attack activity structure
    if (activity?.attack?.type?.value === "melee") {
        return activity.attack.type.classification !== "spell";
    }

    // If an explicit activity is provided and is an attack, it must have been melee
    if (activity?.type === "attack") return false;

    // Unarmed strikes with attack classification
    const isUnarmed = activity?.attack?.type?.classification === "unarmed"
        || item.identifier === "unarmed-strike"
        || (item.system?.identifier || "").includes("unarmed-strike")
        || (item.name || "").toLowerCase().includes("unarmed strike");
    if (isUnarmed && (!activity || activity.type === "attack")) return true;

    // Melee weapons without explicit activity or thrown mode
    if (item.type === "weapon") {
        const weaponType = item.system?.type?.value;
        const isRangedOnly = weaponType === "simpleR" || weaponType === "martialR"
            || CONFIG.DND5E?.weaponTypeMap?.[weaponType] === "ranged";
        if (isRangedOnly) return false;
        return true;
    }

    return false;
}

/**
 * Check whether an actor possesses the Savage Attacker feat by identifier.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasSavageAttacker(actor) {
    if (!actor) return false;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "savage-attacker"
            || id === "savage_attacker"
            || id === "feat-savage-attacker"
            || /(?:^|[-_\s])savage[-_\s]attacker(?:$|[-_\s])/i.test(id)
            || /\bsavage attacker\b/i.test(name);
    });
}

/**
 * Determine whether an attack is eligible for Savage Attacker.
 * Under 2024 PHB rules, Savage Attacker applies once per turn when you hit a target with a weapon.
 * Applies to melee and ranged weapon attacks. Spells and non-weapons do NOT qualify.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} [activity=null]
 * @param {DamageRollProcessConfiguration|null} [config=null]
 * @returns {boolean}
 */
export function isEligibleSavageAttackerAttack(item, activity = null, config = null) {
    if (!item) return false;
    if (item.type !== "weapon") return false;

    // If an activity is provided, it must be an attack activity
    if (activity?.type && activity.type !== "attack") return false;

    const attackMode = config?.attackMode;
    const actionType = activity?.getActionType?.(attackMode)
        ?? activity?.actionType
        ?? item.system?.actionType;

    if (actionType === "msak" || actionType === "rsak") return false;

    return true;
}

/**
 * Find the Boon of Irresistible Offense feat item on an actor, if present.
 *
 * @param {Actor5e|null} actor
 * @returns {Item5e|null}
 */
export function getActorBoonOfIrresistibleOffenseFeat(actor) {
    if (!actor) return null;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.find(item => {
        const id = (item.system?.identifier || item.identifier || "").toLowerCase();
        const name = (item.name || "").toLowerCase();
        return id === "boon-of-irresistible-offense"
            || id === "boon_of_irresistible_offense"
            || id === "feat-boon-of-irresistible-offense"
            || /(?:^|[-_\s])boon[-_\s]of[-_\s]irresistible[-_\s]offense(?:$|[-_\s])/i.test(id)
            || /(?:^|[-_\s])irresistible[-_\s]offense(?:$|[-_\s])/i.test(id)
            || /\bboon\s+of\s+irresistible\s+offense\b/i.test(name)
            || /\birresistible\s+offense\b/i.test(name);
    }) ?? null;
}

/**
 * Check whether an actor possesses the Boon of Irresistible Offense feat.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasBoonOfIrresistibleOffense(actor) {
    return Boolean(getActorBoonOfIrresistibleOffenseFeat(actor));
}

/**
 * Determine which ability score was raised by the Boon of Irresistible Offense feat.
 * If cannot be determined from the feat item's advancement or effects data,
 * defaults to the higher of Strength and Dexterity of the attacker.
 *
 * @param {Actor5e} actor
 * @param {Item5e|null} [featItem=null]
 * @returns {"str"|"dex"}
 */
export function getBoonOfIrresistibleOffenseAbility(actor, featItem = null) {
    featItem ??= getActorBoonOfIrresistibleOffenseFeat(actor);

    // 1. Inspect feat item data for assigned advancement or effects
    if (featItem) {
        // Inspect AbilityScoreImprovement advancement assignments
        const advancements = featItem.system?.advancement
            ?? (featItem.advancement?.byType?.AbilityScoreImprovement)
            ?? [];
        const advList = Array.isArray(advancements) ? advancements : Object.values(advancements);
        for (const adv of advList) {
            const assignments = adv.value?.assignments;
            if (assignments) {
                const str = Number(assignments.str ?? 0);
                const dex = Number(assignments.dex ?? 0);
                if (str > dex) return "str";
                if (dex > str) return "dex";
            }
        }

        // Inspect Active Effects on the feat for ability increases
        const effects = featItem.effects ?? [];
        for (const effect of effects) {
            for (const change of (effect.changes ?? [])) {
                if (/abilities\.str\b/i.test(change.key)) return "str";
                if (/abilities\.dex\b/i.test(change.key)) return "dex";
            }
        }

        // Inspect item flags
        const flagAbility = featItem.getFlag?.("dnd5e", "ability")
            ?? featItem.getFlag?.(MODULE_ID, "ability")
            ?? featItem.flags?.dnd5e?.advancement?.ability;
        if (flagAbility === "str" || flagAbility === "dex") return flagAbility;
    }

    // 2. Fallback: assume the higher of STR and DEX of the attacker
    const strVal = Number(actor?.system?.abilities?.str?.value ?? 10);
    const dexVal = Number(actor?.system?.abilities?.dex?.value ?? 10);
    return strVal >= dexVal ? "str" : "dex";
}

/**
 * Get the score value of the ability raised by Boon of Irresistible Offense.
 *
 * @param {Actor5e} actor
 * @param {Item5e|null} [featItem=null]
 * @returns {number}
 */
export function getBoonOfIrresistibleOffenseScore(actor, featItem = null) {
    const ability = getBoonOfIrresistibleOffenseAbility(actor, featItem);
    return Number(actor?.system?.abilities?.[ability]?.value ?? 10);
}

/**
 * Determine whether an attack is eligible for Brutal Strike.
 * Under 2024 PHB rules, Brutal Strike applies to a Strength-based attack roll
 * dealt by a weapon or Unarmed Strike. Spells, non-weapon items, and ranged weapons
 * that cannot be thrown with Strength (e.g. bows, crossbows) do NOT qualify.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} [activity=null]
 * @param {DamageRollProcessConfiguration|null} [config=null]
 * @param {Actor5e|null} [actor=null]
 * @returns {boolean}
 */
export function isEligibleBrutalStrikeAttack(item, activity = null, config = null, actor = null) {
    if (!item) return false;
    if (item.type === "spell") return false;

    // Must be a weapon or unarmed strike
    const isWeapon = item.type === "weapon";
    const isUnarmed = activity?.attack?.type?.classification === "unarmed"
        || item.identifier === "unarmed-strike"
        || (item.system?.identifier || "").includes("unarmed-strike")
        || (item.name || "").toLowerCase().includes("unarmed strike");
    if (!isWeapon && !isUnarmed) return false;

    // Disallow spell attacks
    const actionType = activity?.getActionType?.(config?.attackMode) ?? activity?.actionType ?? item.system?.actionType;
    if (actionType === "msak" || actionType === "rsak") return false;

    // Check weapon type: ranged weapons (simpleR, martialR) must have thrown property to use Strength
    const weaponType = item.system?.type?.value;
    const isRangedWeapon = weaponType === "simpleR" || weaponType === "martialR"
        || CONFIG.DND5E?.weaponTypeMap?.[weaponType] === "ranged";

    if (isRangedWeapon) {
        const props = item.system?.properties;
        const hasThrown = Array.isArray(props)
            ? (props.includes("thr") || props.includes("thrown"))
            : (props instanceof Set ? (props.has("thr") || props.has("thrown")) : Boolean(props?.thr || props?.thrown));
        if (!hasThrown) return false;
    }

    // Check explicit ability: if set to something other than "str" or default, not Strength-based
    const baseRoll = config?.rolls?.[0];
    const abilityKey = baseRoll?.data?.roll?.ability
        ?? activity?.ability
        ?? activity?.attack?.ability
        ?? item.system?.ability;
    if (abilityKey && abilityKey !== "default" && abilityKey !== "str") {
        return false;
    }

    // With the default ability, finesse weapons use the better of STR/DEX (dnd5e). Brutal Strike needs a
    // Strength-based attack, so a finesse weapon only qualifies when Strength is at least as high as Dexterity.
    if (!abilityKey || abilityKey === "default") {
        const props = item.system?.properties;
        const hasFinesse = props instanceof Set
            ? (props.has("fin") || props.has("finesse"))
            : Array.isArray(props)
                ? (props.includes("fin") || props.includes("finesse"))
                : Boolean(props?.fin || props?.finesse);
        const owner = actor ?? item.actor;
        if (hasFinesse && owner) {
            const strMod = Number(owner.system?.abilities?.str?.mod ?? 0);
            const dexMod = Number(owner.system?.abilities?.dex?.mod ?? 0);
            if (dexMod > strMod) return false;
        }
    }

    return true;
}

/**
 * Resolve the Brutal Strike scale value formula for display and fallback calculation.
 * Resolves @scale.barbarian.brutal-strike advancement on the Barbarian class,
 * falling back to 1d10 (or 2d10 at level 17+).
 *
 * @param {Actor5e|null} actor
 * @returns {string}
 */
export function getBrutalStrikeFormula(actor) {
    if (!actor) return "1d10";

    // 1. Check Barbarian class scale values
    const classes = actor.itemTypes?.class ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "class");
    const barbarianClass = classes.find(c => {
        const id = (c.identifier || c.system?.identifier || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        return id === "barbarian" || name === "barbarian";
    });

    const barbarianScale = actor.system?.scale?.[barbarianClass?.identifier]
        ?? actor.system?.scale?.barbarian
        ?? barbarianClass?.scaleValues
        ?? {};

    let scaleObj = barbarianScale["brutal-strike"] ?? barbarianScale["brutalStrike"] ?? barbarianScale["brutal_strike"];
    if (!scaleObj && actor.system?.scale) {
        for (const [classKey, classScale] of Object.entries(actor.system.scale)) {
            if (classScale && typeof classScale === "object") {
                for (const [key, val] of Object.entries(classScale)) {
                    if (key.toLowerCase().includes("brutal")) {
                        scaleObj = val;
                        break;
                    }
                }
            }
            if (scaleObj) break;
        }
    }

    const rawFormula = scaleObj?.formula ?? (typeof scaleObj === "string" ? scaleObj : scaleObj?.value);
    if (rawFormula) return String(rawFormula);

    // 2. Fallback based on Barbarian class level if available (1d10 at lvl 9+, 2d10 at lvl 17+)
    if (barbarianClass) {
        const levels = Number(barbarianClass.system?.levels ?? 0);
        if (levels >= 17) return "2d10";
        if (levels >= 9) return "1d10";
    }

    // 3. Fallback to feature item damage parts if present, or improved-brutal-strike-2 feature
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    const hasImpBrutal2 = feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id.includes("improved-brutal-strike-2") || id.includes("improved_brutal_strike_2") || name.includes("improved brutal strike (2)");
    });
    if (hasImpBrutal2) return "2d10";

    const brutalItem = feats.find(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        return id === "brutal-strike" || id === "brutal_strike";
    });
    if (brutalItem) {
        const activities = brutalItem.system?.activities;
        if (activities) {
            const list = activities.values ? Array.from(activities.values()) : Object.values(activities);
            for (const act of list) {
                const part = act.damage?.parts?.[0];
                if (part?.number && part?.denomination) {
                    return `${part.number}d${part.denomination}`;
                }
                if (part?.formula && !part.formula.includes("@scale")) {
                    return part.formula;
                }
            }
        }
    }

    return "1d10";
}

/**
 * Determine whether a weapon has the Heavy property.
 *
 * @param {Item5e|null} item
 * @returns {boolean}
 */
export function isEligibleHeavyWeapon(item) {
    if (!item || item.type !== "weapon") return false;
    const props = item.system?.properties;
    if (props instanceof Set) {
        return props.has("hvy") || props.has("heavy");
    }
    if (Array.isArray(props)) {
        return props.includes("hvy") || props.includes("heavy");
    }
    return Boolean(props?.hvy || props?.heavy);
}

/**
 * Determine whether an active, started combat encounter exists for an actor or token.
 * Only returns a combat if the actor or token is an active combatant in it.
 *
 * @param {Actor5e|null} [actor=null]
 * @param {TokenDocument|Token|null} [token=null]
 * @returns {Combat|null} The active combat encounter, or null if no started combat exists for this actor.
 */
export function getActiveCombat(actor = null, token = null) {
    try {
        const tokenDoc = (token instanceof foundry.documents.TokenDocument)
            ? token
            : (token?.document
                ?? (typeof token === "string" ? canvas?.scene?.tokens?.get(token) : null)
                ?? (actor?.isToken ? actor.token : null)
                ?? actor?.getActiveTokens?.(false, true)?.[0]
                ?? null);

        // Check game.combat (currently viewed/active encounter)
        const currentCombat = game.combat ?? game.combats?.active;
        if (currentCombat?.active && currentCombat.started) {
            if (tokenDoc) {
                if (currentCombat.getCombatantsByToken?.(tokenDoc)?.length) return currentCombat;
            } else if (actor && currentCombat.getCombatantsByActor?.(actor)?.length) {
                return currentCombat;
            }
        }

        // Check all combats in the world that are active and have started
        if (game.combats) {
            for (const combat of game.combats) {
                if (!combat.active || !combat.started) continue;
                if (tokenDoc) {
                    if (combat.getCombatantsByToken?.(tokenDoc)?.length) return combat;
                } else if (actor && combat.getCombatantsByActor?.(actor)?.length) {
                    return combat;
                }
            }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Check whether it is currently the attacker's turn in combat.
 * If there is no active, started combat encounter involving the attacker, this returns true
 * because out-of-combat attacks are not restricted by combat turn order.
 *
 * @param {Actor5e|null} actor
 * @param {TokenDocument|Token|string|null} [token=null]
 * @returns {boolean} True if there is no active combat for the attacker or if it is the attacker's turn.
 */
export function isAttackerCombatTurn(actor, token = null) {
    if (!actor) return false;

    try {
        const combat = getActiveCombat(actor, token);
        // If there is no active, started combat involving the actor, turn restriction does not apply
        if (!combat || !combat.started) return true;

        const currentCombatant = combat.combatant;
        if (!currentCombatant) return false;

        const tokenDoc = (token instanceof foundry.documents.TokenDocument)
            ? token
            : (token?.document
                ?? (typeof token === "string" ? canvas?.scene?.tokens?.get(token) : null)
                ?? (actor.isToken ? actor.token : null)
                ?? actor.getActiveTokens?.(false, true)?.[0]
                ?? null);

        // 1. If we have a specific token, check if it matches the current combatant's token
        if (tokenDoc && currentCombatant.tokenId) {
            if (currentCombatant.tokenId === tokenDoc.id) return true;
            // If the actor is an unlinked token, non-matching tokenId means it is another token's turn
            if (actor.isToken) return false;
            // If this token itself is registered in the combat, non-matching tokenId means it is not this token's turn
            if (combat.getCombatantsByToken?.(tokenDoc)?.length) return false;
        }

        // 2. Direct actor document or UUID match
        if (currentCombatant.actor === actor) return true;
        if (currentCombatant.actor?.uuid && currentCombatant.actor.uuid === actor.uuid) return true;

        // 3. Actor ID match (for linked actors)
        if (currentCombatant.actorId && currentCombatant.actorId === actor.id && !actor.isToken) {
            return true;
        }

        // 4. Check via combat's registered combatants for this actor
        const actorCombatants = combat.getCombatantsByActor?.(actor) ?? [];
        return actorCombatants.some(c => c.id === currentCombatant.id);
    } catch {
        return true;
    }
}

/**
 * Calculate the total movement distance in grid units (feet) that a token has moved on its current turn,
 * ignoring teleportation and displacement.
 *
 * @param {TokenDocument|Token|string|null} token
 * @returns {number} The total distance moved on this turn, or 0.
 */
export function getTokenTurnMovementDistance(token) {
    try {
        const tokenDoc = (token instanceof foundry.documents.TokenDocument)
            ? token
            : (token?.document
                ?? (typeof token === "string" ? canvas?.scene?.tokens?.get(token) : null)
                ?? null);
        if (!tokenDoc) return 0;

        const history = tokenDoc.movementHistory ?? tokenDoc._source?._movementHistory ?? tokenDoc._movementHistory;
        if (!Array.isArray(history) || history.length <= 1) return 0;

        if (typeof tokenDoc.measureMovementPath === "function") {
            try {
                const res = tokenDoc.measureMovementPath(history);
                if (typeof res?.distance === "number" && !isNaN(res.distance) && res.distance >= 0) {
                    return res.distance;
                }
            } catch {
                // Fall back to segment-by-segment calculation below
            }
        }

        const scene = tokenDoc.parent ?? canvas?.scene;
        const grid = canvas?.grid ?? scene?.grid;
        const gridDistance = Number(grid?.distance ?? scene?.grid?.distance ?? 5);
        const gridSize = Number(grid?.size ?? scene?.grid?.size ?? 100);

        let totalDistance = 0;
        for (let i = 1; i < history.length; i++) {
            const p0 = history[i - 1];
            const p1 = history[i];
            if (!p0 || !p1) continue;

            if (p1.teleport || p1.action === "teleport" || p1.action === "displace") continue;

            if (grid?.measurePath) {
                try {
                    const segRes = grid.measurePath([p0, p1]);
                    totalDistance += Number(segRes?.distance ?? 0);
                } catch {
                    const dx = (p1.x ?? 0) - (p0.x ?? 0);
                    const dy = (p1.y ?? 0) - (p0.y ?? 0);
                    totalDistance += (Math.hypot(dx, dy) / gridSize) * gridDistance;
                }
            } else {
                const dx = (p1.x ?? 0) - (p0.x ?? 0);
                const dy = (p1.y ?? 0) - (p0.y ?? 0);
                totalDistance += (Math.hypot(dx, dy) / gridSize) * gridDistance;
            }
        }

        return totalDistance;
    } catch {
        return 0;
    }
}

/**
 * Determine whether the attacker has moved at least the required distance (default 10 feet)
 * on their current turn.
 *
 * @param {Actor5e|null} actor
 * @param {TokenDocument|Token|string|null} [token=null]
 * @param {number} [minDistance=10]
 * @returns {boolean}
 */
export function hasAttackerMovedChargerDistance(actor, token = null, minDistance = 10) {
    if (!actor) return false;
    const tokenDoc = (token instanceof foundry.documents.TokenDocument)
        ? token
        : (token?.document
            ?? (typeof token === "string" ? canvas?.scene?.tokens?.get(token) : null)
            ?? (actor.isToken ? actor.token : null)
            ?? actor.getActiveTokens?.(false, true)?.[0]
            ?? null);

    // If no token exists on canvas/scene, movement cannot be verified (fail open)
    if (!tokenDoc) return true;

    const scene = tokenDoc.parent ?? canvas?.scene;
    const gridDistance = Number(scene?.grid?.distance ?? 5);
    const units = scene?.grid?.units;

    let effectiveMinDistance = minDistance;
    if (units && typeof dnd5e?.utils?.convertLength === "function") {
        try {
            const converted = dnd5e.utils.convertLength(minDistance, "ft", units, { strict: false });
            if (typeof converted === "number" && !isNaN(converted) && converted > 0) {
                effectiveMinDistance = converted;
            }
        } catch {
            // Fall back below
        }
    } else if (gridDistance > 0 && gridDistance <= 2) {
        // Metric scenes (e.g. 1.5m) or unit spaces (1 space)
        effectiveMinDistance = gridDistance * 2;
    }

    const movedDistance = getTokenTurnMovementDistance(tokenDoc);
    return movedDistance >= (effectiveMinDistance - 0.01);
}

/**
 * Determine if a weapon is eligible for Cleave weapon mastery.
 *
 * @param {Item5e|null} item
 * @param {Actor5e|null} [actor=null]
 * @returns {boolean}
 */
export function isEligibleCleaveWeapon(item, actor = null) {
    if (!item || item.type !== "weapon") return false;
    if (!isModernRules()) return false;

    // Weapon masteries are a character-only mechanic: never offer Cleave for NPCs or other non-character actors.
    const owner = actor ?? item.actor;
    if (!owner || owner.type === "npc") return false;

    // Cleave requires the weapon's mastery to actually be unlocked by the actor.
    const masteryTrait = owner.system?.traits?.weaponProf?.mastery;
    if (!masteryTrait?.value || typeof masteryTrait.value.has !== "function") return false;

    // Item#masteryOptions is only populated when the actor has this weapon's mastery (or a bonus mastery)
    const options = item.system?.masteryOptions;
    return Array.isArray(options) && options.some(m => m.value === "cleave");
}

/**
 * Remove ability score modifier reference (@mod, @abilities.<abl>.mod, etc.) from an array of formula parts.
 * Used by Cleave weapon mastery malus to strip the ability modifier from the weapon damage formula.
 *
 * @param {string[]} parts
 * @returns {string[]}
 */
export function removeAbilityModifierFromParts(parts) {
    if (!Array.isArray(parts)) return [];

    const isOnlyModRegex = /^@(?:mod|abilities\.[a-z]{3}\.mod)(?:\[[^\]]*\])?$/i;

    const newParts = [];
    for (const part of parts) {
        if (typeof part !== "string") {
            newParts.push(part);
            continue;
        }

        const trimmed = part.trim();
        // If the entire part is just @mod or @mod[STR] or @abilities.str.mod
        if (isOnlyModRegex.test(trimmed)) {
            continue;
        }

        // Remove @mod from compound expression like "1d12 + @mod" or "1d12 + @mod[STR]"
        let modified = trimmed
            .replace(/\s*\+\s*@(?:mod|abilities\.[a-z]{3}\.mod)(?:\[[^\]]*\])?/gi, "")
            .replace(/@(?:mod|abilities\.[a-z]{3}\.mod)(?:\[[^\]]*\])?\s*\+\s*/gi, "")
            .replace(/\s*-\s*@(?:mod|abilities\.[a-z]{3}\.mod)(?:\[[^\]]*\])?/gi, "")
            .trim();

        if (modified.length > 0) {
            newParts.push(modified);
        }
    }

    if (!newParts.length) {
        newParts.push("0");
    }

    return newParts;
}

/**
 * Track the combat turn in which an actor last applied Savage Attacker.
 * Keyed by actor UUID or ID -> turn key string `${combat.id}-r${round}-t${turn}`.
 * @type {Map<string, string>}
 */
const _lastSavageAttackerTurn = new Map();

/**
 * Track once-per-turn bonuses (e.g. Sneak Attack). Keyed by `${actorKey}|${bonusId}` -> turn key string.
 * @type {Map<string, string>}
 */
const _bonusTurnUsage = new Map();

/**
 * Determine whether a once-per-turn bonus has already been used by the actor on the specified combat turn.
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string|null} turnKey
 * @returns {boolean}
 */
export function hasUsedBonusThisTurn(actor, bonusId, turnKey) {
    if (!actor || !turnKey) return false;
    return _bonusTurnUsage.get(`${actor.uuid || actor.id}|${bonusId}`) === turnKey;
}

/**
 * Mark a once-per-turn bonus as used by the actor on the specified combat turn.
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string|null} turnKey
 */
export function markBonusUsedThisTurn(actor, bonusId, turnKey) {
    if (!actor || !turnKey) return;
    _bonusTurnUsage.set(`${actor.uuid || actor.id}|${bonusId}`, turnKey);
}

/**
 * Construct a unique string key representing the current combat turn.
 *
 * @param {Combat|null} combat
 * @param {Actor5e|null} [actor=null]
 * @param {TokenDocument|Token|null} [token=null]
 * @returns {string|null}
 */
export function getCombatTurnKey(combat, actor = null, token = null) {
    if (!combat?.active || !combat.started) return null;
    return `${combat.id}-r${combat.round ?? 0}-t${combat.turn ?? 0}`;
}

/**
 * Determine whether Savage Attacker has already been used by the actor on the specified combat turn.
 *
 * @param {Actor5e|null} actor
 * @param {string|null} turnKey
 * @returns {boolean}
 */
export function hasUsedSavageAttackerThisTurn(actor, turnKey) {
    if (!actor || !turnKey) return false;
    const key = actor.uuid || actor.id;
    return _lastSavageAttackerTurn.get(key) === turnKey;
}

/**
 * Mark Savage Attacker as having been expended on the current combat turn for an actor.
 *
 * @param {Actor5e|null} actor
 * @param {string|null} turnKey
 */
export function markSavageAttackerUsed(actor, turnKey) {
    if (!actor || !turnKey) return;
    const key = actor.uuid || actor.id;
    _lastSavageAttackerTurn.set(key, turnKey);
}

/**
 * In-memory map of the most recent attack roll evaluated for each actor,
 * used to correlate damage rolls with attack d20 results.
 * Keyed by actor UUID or ID.
 * @type {Map<string, { roll: BasicRoll, time: number, activityId?: string, itemId?: string, messageId?: string }>}
 */
const _lastAttackRollsByActor = new Map();

/**
 * Check whether a given roll's d20 was an active (kept) natural 20.
 *
 * @param {BasicRoll|Roll|null} roll
 * @returns {boolean}
 */
export function isRollD20Natural20(roll) {
    if (!roll) return false;

    // Check roll.d20 or first Die term with 20 faces
    const d20 = roll.d20 ?? roll.terms?.find(t => (t instanceof foundry.dice.terms.Die) && t.faces === 20);
    if (d20) {
        const results = d20.results ?? [];
        if (results.length > 0) {
            const active = results.filter(r => r.active !== false && !r.discarded);
            if (active.length > 0) {
                return active.some(r => Number(r.result) === 20);
            }
            return Number(d20.total) === 20;
        }
        return Number(d20.total) === 20;
    }

    // Fallback: check any die with 20 faces in roll.dice
    for (const d of roll.dice ?? []) {
        if (d.faces === 20) {
            const results = d.results ?? [];
            if (results.length > 0) {
                const active = results.filter(r => r.active !== false && !r.discarded);
                if (active.length > 0) {
                    if (active.some(r => Number(r.result) === 20)) return true;
                } else if (Number(d.total) === 20) return true;
            } else if (Number(d.total) === 20) return true;
        }
    }

    return false;
}

/**
 * Check whether the attack roll triggering the current damage roll rolled a 20 on the d20.
 *
 * @param {Actor5e} actor
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function didAttackRollNatural20(actor, { config, dialog, message, activity } = {}) {
    // 1. Direct roll on config
    const directRoll = config?.attackRoll ?? config?.rolls?.[0]?.options?.attackRoll;
    if (directRoll && isRollD20Natural20(directRoll)) return true;

    // Inspect a chat message for attack d20 results.
    // Returns true/false when the message (or its associated attack messages) contains d20 rolls, null when it has none.
    const inspectMessage = (msg) => {
        if (!msg) return null;
        const rolls = [...(msg.rolls ?? [])];
        if (typeof msg.getAssociatedRolls === "function") {
            for (const attackMsg of msg.getAssociatedRolls("attack") ?? []) rolls.push(...(attackMsg.rolls ?? []));
        }
        const hasD20 = rolls.some(r => (r.dice ?? []).some(d => d.faces === 20));
        if (!hasD20) return null;
        return rolls.some(r => isRollD20Natural20(r));
    };

    // 2. Direct message origin (authoritative: a found origin attack must not fall through to the time-based cache)
    const originId = message?.data?.system?.origin
        ?? config?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId
        ?? dialog?.options?.originatingMessage;

    if (originId) {
        const result = inspectMessage(game.messages?.get(originId));
        if (result !== null) return result;
    }

    // 3. Event target chat message element
    if (config?.event?.target) {
        const chatCard = config.event.target.closest?.(".chat-message");
        const msgId = chatCard?.dataset?.messageId;
        if (msgId && msgId !== originId) {
            const result = inspectMessage(game.messages?.get(msgId));
            if (result !== null) return result;
        }
    }

    // 4. In-memory cached attack roll for this actor within the last 60 seconds
    if (actor) {
        const actorKey = actor.uuid || actor.id;
        const cached = _lastAttackRollsByActor.get(actorKey);
        if (cached && !cached.damageRolled && (Date.now() - cached.time < 60000)) {
            if (!activity || !cached.activityId || cached.activityId === activity.id) {
                if (isRollD20Natural20(cached.roll)) return true;
            }
        }
    }

    // 5. midi-qol workflow fallback
    if (config?.workflow?.attackRoll && isRollD20Natural20(config.workflow.attackRoll)) return true;

    return false;
}

/**
 * Extract the weapon's base damage dice formula (e.g. "1d8", "2d6", "1d12") from a roll, item, or activity.
 *
 * @param {object|null} [baseRoll=null]
 * @param {Item5e|null} [item=null]
 * @param {Activity|null} [activity=null]
 * @returns {string}
 */
export function getWeaponBaseDiceFormula(baseRoll = null, item = null, activity = null) {
    const parts = baseRoll?._nd5tOriginalParts ?? baseRoll?.parts;
    if (Array.isArray(parts)) {
        // The roll's own parts are authoritative: no dice term means the weapon deals flat damage.
        for (const part of parts) {
            if (typeof part !== "string") continue;
            if (part.includes("kh") || part.includes("kl")) continue;
            const match = part.match(/\b(\d+d\d+)\b/i);
            if (match) return match[1];
        }
        return null;
    }

    const actParts = activity?.damage?.parts;
    if (Array.isArray(actParts) && actParts.length) {
        for (const p of actParts) {
            if (p.number && p.denomination) return `${p.number}d${p.denomination}`;
            if (typeof p.formula === "string") {
                const m = p.formula.match(/\b(\d+d\d+)\b/i);
                if (m) return m[1];
            }
        }
    }

    const baseDamage = item?.system?.damage?.base;
    if (baseDamage?.number && baseDamage?.denomination) {
        return `${baseDamage.number}d${baseDamage.denomination}`;
    }
    if (typeof baseDamage?.formula === "string") {
        const m = baseDamage.formula.match(/\b(\d+d\d+)\b/i);
        if (m) return m[1];
    }

    return null;
}

/**
 * Transform weapon damage formula parts to roll the weapon's damage dice twice and use the higher roll,
 * in accordance with the 2024 PHB Savage Attacker feat: "you can roll the weapon's damage dice twice and use either roll".
 * Replaces the first dice expression e.g. "1d8" or "2d6" with "{1d8, 1d8}kh" or "{2d6, 2d6}kh".
 *
 * @param {string[]} parts
 * @returns {string[]}
 */
export function applySavageAttackerToParts(parts) {
    if (!Array.isArray(parts)) return [];

    let applied = false;
    const newParts = [];

    for (const part of parts) {
        if (typeof part !== "string" || applied || part.includes("kh") || part.includes("kl")) {
            newParts.push(part);
            continue;
        }

        // Match the first dice expression incl. modifiers, e.g. "1d8", "2d6", "1d8r<=2", "2d4min3[slashing]"
        const match = part.match(/\b(\d+d\d+)((?:[a-z]+[<>=]*\d*)*)(?:\[([^\]]*)\])?/i);
        if (match) {
            const fullMatch = match[0];
            const diceFormula = `${match[1]}${match[2] ?? ""}`;
            const flavor = match[3] ? `[${match[3]}]` : "";
            const replacement = `{${diceFormula}, ${diceFormula}}kh${flavor}`;
            newParts.push(part.replace(fullMatch, replacement));
            applied = true;
        } else {
            newParts.push(part);
        }
    }

    return applied ? newParts : [...parts];
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
export function getActiveConditionalBonuses(actor, { item = null, activity = null, config = null, dialog = null, message = null } = {}) {
    if (!actor) return [];
    const activeBonuses = [];

    // --- 1. Concentration Spells (Hex & Hunter's Mark) ---
    const effects = actor.appliedEffects ?? Array.from(actor.effects?.values() ?? []);
    const concentrationItems = actor.concentration?.items ?? new Set();
    const localizedConcentrating = (game.i18n?.localize("EFFECT.DND5E.StatusConcentrating") || "Concentrating").toLowerCase();

    for (const def of CONDITIONAL_DAMAGE_DEFINITIONS) {
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

                // Support localized "Concentrating: <Spell>"
                if (name.startsWith(localizedConcentrating) && name.endsWith(targetSpell)) return true;

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

        if (hasMatch) {
            activeBonuses.push(def);
        }
    }

    // Match the weapon's base damage type for sneak attack and great weapon master
    const baseDamageType = config?.rolls?.[0]?.options?.type
        ?? config?.rolls?.[0]?.options?.types?.[0]
        ?? item?.system?.damage?.base?.types?.first?.()
        ?? item?.system?.damage?.base?.type
        ?? activity?.damage?.parts?.[0]?.types?.first?.()
        ?? "piercing";

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

    // --- 2. Sneak Attack (Rogue class scale value on ranged or finesse weapon; once per turn) ---
    const rogueData = getRogueData(actor);
    if (rogueData && isEligibleSneakAttackWeapon(item, activity, config)) {
        // In combat, Sneak Attack defaults off once it has been used this turn (and is not remembered across turns)
        const sneakTurnKey = getCombatTurnKey(getActiveCombat(actor, token), actor, token);
        activeBonuses.push({
            id: "sneakAttack",
            spellName: "Sneak Attack",
            formula: `${rogueData.formula}[Sneak Attack]`,
            formulaDisplay: rogueData.formula,
            damageType: baseDamageType,
            flavor: "Sneak Attack",
            labelKey: "ND5T.ConditionalDamage.SneakAttack.Label",
            defaultLabel: `Sneak Attack (+${rogueData.formula})`,
            turnKey: sneakTurnKey,
            defaultActive: !hasUsedBonusThisTurn(actor, "sneakAttack", sneakTurnKey)
        });
    }

    // --- 3. Great Weapon Master (2024 Modern Rules: +PB damage on heavy weapons on attacker's turn) ---

    if (isModernRules() && actorHasGreatWeaponMaster(actor) && isEligibleHeavyWeapon(item) && isAttackerCombatTurn(actor, token)) {
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
            defaultActive: true
        });
    }

    // --- 4. Cleave Weapon Mastery (2024 Modern Rules: remove ability modifier unless negative) ---
    if (isEligibleCleaveWeapon(item, actor)) {
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

    // --- 5. Brutal Strike (Barbarian class feature: @scale.barbarian.brutal-strike) ---
    if (actorHasBrutalStrike(actor) && isEligibleBrutalStrikeAttack(item, activity, config, actor)) {
        const brutalFormulaDisplay = getBrutalStrikeFormula(actor);
        activeBonuses.push({
            id: "brutalStrike",
            spellName: "Brutal Strike",
            formula: `${brutalFormulaDisplay}[Brutal Strike]`,
            formulaDisplay: brutalFormulaDisplay,
            damageType: baseDamageType,
            flavor: "Brutal Strike",
            labelKey: "ND5T.ConditionalDamage.BrutalStrike.Label",
            defaultLabel: `Brutal Strike (+${brutalFormulaDisplay})`,
            defaultActive: false
        });
    }

    // --- 6. Charger (2024 Modern Rules: +1d8 damage on melee attack after moving at least 10 ft on your turn) ---
    if (isModernRules() && actorHasCharger(actor) && isEligibleChargerAttack(item, activity, config)) {
        const combat = getActiveCombat(actor, token);
        const inCombat = Boolean(combat?.active && combat.started);
        const isEligibleTurnAndMovement = !inCombat
            || (isAttackerCombatTurn(actor, token) && hasAttackerMovedChargerDistance(actor, token, 10));

        if (isEligibleTurnAndMovement) {
            activeBonuses.push({
                id: "charger",
                spellName: "Charger",
                formula: "1d8[Charger]",
                formulaDisplay: "1d8",
                damageType: baseDamageType,
                flavor: "Charger",
                labelKey: "ND5T.ConditionalDamage.Charger.Label",
                defaultLabel: "Charger (+1d8)",
                defaultActive: false
            });
        }
    }

    // --- 7. Savage Attacker (2024 Modern Rules: Roll weapon damage dice twice and use either roll) ---
    if (isModernRules() && actorHasSavageAttacker(actor) && isEligibleSavageAttackerAttack(item, activity, config)) {
        const combat = getActiveCombat(actor, token);
        const turnKey = getCombatTurnKey(combat, actor, token);
        const hasUsedThisTurn = hasUsedSavageAttackerThisTurn(actor, turnKey);

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

    // --- 8. Boon of Irresistible Offense (2024 Modern Rules: +Ability Score when rolling a 20 on the d20 for an attack roll) ---
    if (isModernRules() && actorHasBoonOfIrresistibleOffense(actor)) {
        const isAttack = activity?.type === "attack"
            || ["mwak", "rwak", "msak", "rsak"].includes(activity?.actionType ?? "");

        if (isAttack && didAttackRollNatural20(actor, { config, dialog, message, activity })) {
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
                defaultActive: true,
                abilityKey,
                scoreValue
            });
        }
    }

    return activeBonuses;
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
    data.roll.damageType = def.damageType;

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

    const rollOptions = {
        type: def.damageType,
        flavor: def.flavor,
        _nd5tConditionalId: def.id,
        critical: { bonusDice: 0 }
    };

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

/**
 * Hook handler for `dnd5e.preRollDamage`.
 * Inspects actor concentration effects and prepares eligible conditional damage rolls.
 *
 * @param {DamageRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration} dialog
 * @param {BasicRollMessageConfiguration} message
 */
function _onPreRollDamage(config, dialog = {}, message = {}) {
    if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;

    // Healing rolls cannot receive attack-dependent damage bonuses
    const rollType = config.subject?.type ?? message?.data?.type;
    if (rollType === "heal") return;
    if (config.rolls?.some(r => r.options?.type === "healing" || r.options?.type === "temphp")) return;

    // Conditional damage bonuses strictly require hitting with an attack.
    // If an activity subject is defined and is NOT an attack activity (e.g. SaveActivity like Fireball,
    // DamageActivity like Magic Missile / environmental damage, UtilityActivity, etc.), bail out.
    if (config.subject) {
        const isAttackActivity = config.subject.type === "attack"
            || ["mwak", "rwak", "msak", "rsak"].includes(config.subject.actionType);
        if (!isAttackActivity) return;
    }

    // Resolve the rolling actor
    const actor = config.subject?.actor
        ?? dialog?.options?.actor
        ?? (config.subject?.item?.actor)
        ?? (config.rolls?.[0]?.data?.actor)
        ?? (message?.data?.speaker ? ChatMessage.getSpeakerActor?.(message.data.speaker) : null)
        ?? (canvas?.tokens?.controlled?.[0]?.actor)
        ?? null;
    if (!actor) return;

    // Resolve the item being rolled
    const item = config.subject?.item
        ?? (config.rolls?.[0]?.data?.item instanceof Item ? config.rolls[0].data.item : null)
        ?? (actor.items?.get(config.rolls?.[0]?.data?.item?.id ?? config.rolls?.[0]?.data?.item?._id))
        ?? null;

    // Detect active conditional bonuses (Hex, Hunter's Mark, Sneak Attack, GWM, etc.)
    const activeDefs = getActiveConditionalBonuses(actor, { item, activity: config.subject, config, dialog, message });
    if (!activeDefs.length) return;

    // Prepare bonus metadata on the process configuration
    config._nd5tConditionalBonuses = activeDefs.map(def => {
        const lastChoice = (def.id === "cleave" || def.id === "brutalStrike" || def.id === "charger" || def.id === "boonOfIrresistibleOffense" || (def.id === "sneakAttack" && def.turnKey))
            ? def.defaultActive
            : (def.id === "savageAttacker"
                ? def.defaultActive
                : getActorConditionalPreference(actor, def.id, def.defaultActive));
        return {
            ...def,
            actor,
            active: lastChoice
        };
    });

    const baseRoll = config.rolls?.[0];
    const baseRollData = baseRoll?.data ?? actor.getRollData?.() ?? {};
    const baseProperties = baseRoll?.options?.properties ?? [];
    const isCritical = Boolean(config.isCritical);

    if (baseRoll) {
        baseRoll._nd5tOriginalParts = [...(baseRoll.parts ?? [])];
        baseRoll._nd5tOriginalMod = baseRoll.data?.mod;

        const savageBonus = config._nd5tConditionalBonuses.find(b => b.id === "savageAttacker" && b.active);
        const isFastForward = dialog.configure === false || Boolean(config.event?.shiftKey) || Boolean(config.options?.fastForward);
        if (savageBonus) {
            baseRoll.parts = applySavageAttackerToParts(baseRoll._nd5tOriginalParts);
            baseRoll.options ??= {};
            baseRoll.options._nd5tSavageAttacker = true;
            if (savageBonus.turnKey && isFastForward) {
                markSavageAttackerUsed(actor, savageBonus.turnKey);
            }
        }
        const sneakBonus = config._nd5tConditionalBonuses.find(b => b.id === "sneakAttack" && b.active);
        if (sneakBonus?.turnKey && isFastForward) {
            markBonusUsedThisTurn(actor, "sneakAttack", sneakBonus.turnKey);
        }
        if (isFastForward && actor) {
            const actorKey = actor.uuid || actor.id;
            const cached = _lastAttackRollsByActor.get(actorKey);
            if (cached) cached.damageRolled = true;
        }
    }

    // For any bonus that is currently active, add the roll configuration upfront.
    // This ensures fast-forward rolls (holding Shift / dialog.configure === false)
    // honor the actor's last chosen state, critical mode, and weapon properties.
    config.rolls ??= [];
    for (const bonus of config._nd5tConditionalBonuses) {
        if (!bonus.active || bonus.isMalus || bonus.isWeaponModifier) continue;

        const alreadyPresent = config.rolls.some(r => r.options?._nd5tConditionalId === bonus.id);
        if (!alreadyPresent) {
            const properties = (bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster" || bonus.id === "brutalStrike" || bonus.id === "charger" || bonus.id === "boonOfIrresistibleOffense") ? baseProperties : [];
            config.rolls.push(createConditionalRollConfig(bonus, baseRollData, { isCritical, properties }));
        }
    }
}

/**
 * Ensure all eligible conditional rolls are present in the dialog configuration upfront.
 * Inactive rolls are flagged with `options._nd5tInactive = true` so they can be rendered in the dialog
 * in a disabled/greyed-out state without causing layout shifts when toggled.
 *
 * @param {DamageRollProcessConfiguration} config
 */
function _ensureAllConditionalRollsInConfig(config) {
    const bonuses = config._nd5tConditionalBonuses;
    if (!bonuses?.length) return;

    config.rolls ??= [];
    const baseIndex = config.rolls.findIndex(r => !r.options?._nd5tConditionalId);
    const baseRoll = baseIndex >= 0 ? config.rolls[baseIndex] : config.rolls[0];
    const baseRollData = baseRoll?.data ?? {};
    const baseProperties = baseRoll?.options?.properties ?? [];
    const isCritical = Boolean(config.isCritical);

    for (const bonus of bonuses) {
        if (bonus.isMalus || bonus.isWeaponModifier) continue;

        let rollConfig = config.rolls.find(r => r.options?._nd5tConditionalId === bonus.id);
        if (!rollConfig) {
            const properties = (bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster" || bonus.id === "brutalStrike" || bonus.id === "charger" || bonus.id === "boonOfIrresistibleOffense") ? baseProperties : [];
            rollConfig = createConditionalRollConfig(bonus, baseRollData, { isCritical, properties });
            if (!bonus.active) {
                rollConfig.options._nd5tInactive = true;
            }
            config.rolls.push(rollConfig);
        } else {
            if (!bonus.active) {
                rollConfig.options ??= {};
                rollConfig.options._nd5tInactive = true;
            } else if (rollConfig.options?._nd5tInactive) {
                delete rollConfig.options._nd5tInactive;
            }
        }
    }
}

/**
 * Update the visual and interactive states of formula rows in the damage roll dialog.
 * Greys out inactive conditional rolls, adds line-through to their formulas, and disables their inputs.
 *
 * @param {DamageRollConfigurationDialog} app
 */
function _updateFormulaRowStates(app) {
    if (!app?.element) return;
    const formulaList = app.element.querySelector(".formulas");
    if (!formulaList) return;

    const listItems = Array.from(formulaList.children).filter(el => el.tagName === "LI");
    const rolls = app.config?.rolls ?? [];

    listItems.forEach((li, index) => {
        const roll = rolls[index];
        const isInactive = Boolean(roll?.options?._nd5tInactive);
        const conditionalId = roll?.options?._nd5tConditionalId;

        li.classList.toggle("nd5t-inactive-roll", isInactive);
        li.classList.toggle("nd5t-conditional-roll", Boolean(conditionalId));

        if (conditionalId) {
            li.dataset.nd5tConditionalId = conditionalId;
        }

        const inputs = li.querySelectorAll("input, select");
        inputs.forEach(input => {
            input.disabled = isInactive;
            if (isInactive) {
                input.setAttribute("tabindex", "-1");
                if (input.name?.includes("situational")) {
                    input.placeholder = game.i18n?.localize("ND5T.ConditionalDamage.InactivePlaceholder") || "(Inactive)";
                }
            } else {
                input.removeAttribute("tabindex");
                if (input.name?.includes("situational")) {
                    input.placeholder = game.i18n?.localize("DND5E.RollSituationalBonus") || "Situational Bonus";
                }
            }
        });
    });
}

let _isDialogPatched = false;

/**
 * Patch DamageRollConfigurationDialog to display conditional damage toggles,
 * synchronize rolls in real time, grey out inactive bonuses without layout shift, and persist preferences.
 */
function _patchDamageRollConfigurationDialog() {
    if (_isDialogPatched) return;
    const DialogClass = CONFIG.Dice?.DamageRoll?.DefaultConfigurationDialog;
    if (!DialogClass) return;

    // 1. Ensure all eligible conditional bonus rolls are included upfront when the dialog is configured
    const origConfigure = DialogClass.configure;
    DialogClass.configure = async function(config = {}, dialog = {}, message = {}) {
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage") && config._nd5tConditionalBonuses?.length) {
            _ensureAllConditionalRollsInConfig(config);
        }
        return origConfigure.call(this, config, dialog, message);
    };

    // 2. Filter dice in _prepareFormulasContext so inactive rolls do not display dice at the top
    const origPrepareFormulasContext = DialogClass.prototype._prepareFormulasContext;
    DialogClass.prototype._prepareFormulasContext = async function(context, options) {
        context = await origPrepareFormulasContext.call(this, context, options);

        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            return context;
        }

        const activeRolls = (this.rolls ?? []).filter(r => !r.options?._nd5tInactive);
        let dice = [];
        let shouldDisplay = true;
        const denominations = this.options?.rendering?.dice?.denominations ?? new Set(["d4", "d6", "d8", "d10", "d12", "d20"]);

        for (const roll of activeRolls) {
            for (const term of roll.terms ?? []) {
                const diceTerms = (term instanceof foundry.dice.terms.PoolTerm)
                    ? (term.rolls?.[0]?.dice ?? term.dice ?? [])
                    : (term instanceof foundry.dice.terms.DiceTerm ? [term] : []);

                for (const dt of diceTerms) {
                    if (!Number.isFinite(dt.number) || !Number.isFinite(dt.faces)) {
                        shouldDisplay = false;
                        break;
                    }
                    if (!denominations.has(dt.denomination)) {
                        shouldDisplay = false;
                        break;
                    }
                    for (let i = 0; i < dt.number; i++) {
                        dice.push({
                            icon: `systems/dnd5e/icons/svg/dice/${dt.denomination}.svg`,
                            label: dt.denomination,
                            denomination: dt.denomination
                        });
                    }
                }
            }
            if (!shouldDisplay) break;
        }

        const max = this.options?.rendering?.dice?.max ?? 10;
        if (dice.length > max) {
            const byDenom = dice.reduce((obj, { icon, denomination }) => {
                obj[denomination] ??= { icon, count: 0 };
                obj[denomination].count++;
                return obj;
            }, {});
            dice = Object.entries(byDenom).map(([d, { icon, count }]) => ({ icon, label: `${count}${d}` }));
            if (dice.length > max) shouldDisplay = false;
        } else if (!dice.length) shouldDisplay = false;

        context.dice = shouldDisplay ? dice : [];

        return context;
    };

    // 3. Inject conditional checkboxes into _prepareConfigurationContext
    const origPrepareConfigurationContext = DialogClass.prototype._prepareConfigurationContext;
    DialogClass.prototype._prepareConfigurationContext = async function(context, options) {
        context = await origPrepareConfigurationContext.call(this, context, options);

        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            return context;
        }

        const bonuses = this.config?._nd5tConditionalBonuses;
        if (!bonuses?.length) return context;

        context.fields ??= [];

        const bonusFields = bonuses.map(bonus => {
            let label = bonus.defaultLabel;
            if (bonus.labelKey && game.i18n?.has(bonus.labelKey)) {
                label = game.i18n.format(bonus.labelKey, { formula: bonus.formulaDisplay ?? "" });
            }

            // Normalize any internal newlines to spaces
            label = label.replace(/[\r\n]+/g, " ").trim();

            // Format label so title and parenthetical bonus are atomic non-breaking tokens,
            // allowing the browser to render them on a single line if space permits,
            // while ensuring that if wrapping is necessary, it wraps cleanly between title and bonus.
            const match = label.match(/^(.*?)\s*(\([^)]+\))$/);
            if (match) {
                const titlePart = match[1].trim().replace(/\s+/g, "\u00A0");
                const bonusPart = match[2].trim().replace(/\s+/g, "\u00A0");
                label = `${titlePart} ${bonusPart}`;
            }

            const isCurrentlyInRolls = (bonus.id === "cleave" || bonus.id === "savageAttacker")
                ? Boolean(bonus.active)
                : (this.config.rolls ?? []).some(
                    r => r.options?._nd5tConditionalId === bonus.id && !r.options?._nd5tInactive
                );

            return {
                field: new foundry.data.fields.BooleanField({
                    label,
                    required: false,
                    initial: bonus.defaultActive
                }),
                name: `nd5t.conditional.${bonus.id}`,
                value: isCurrentlyInRolls,
                options: {
                    classes: "checkbox nd5t-conditional-group"
                }
            };
        });

        // Prepend bonus fields while maintaining their stable definition order
        context.fields.unshift(...bonusFields);

        return context;
    };

    // 4. Update formula row DOM classes and disabled states on render
    const origOnRender = DialogClass.prototype._onRender;
    DialogClass.prototype._onRender = function(context, options) {
        origOnRender?.call(this, context, options);

        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            _updateFormulaRowStates(this);
        }
    };

    // 5. Synchronize rolls in real time on form change (_onChangeForm) without layout shift
    const origOnChangeForm = DialogClass.prototype._onChangeForm;
    DialogClass.prototype._onChangeForm = function(formConfig, event) {
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            const bonuses = this.config?._nd5tConditionalBonuses;
            if (bonuses?.length && this.form) {
                const formData = new foundry.applications.ux.FormDataExtended(this.form);
                const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId);
                const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                const baseProperties = baseRoll?.options?.properties ?? [];

                // Dynamically resolve weapon damage type selected in the form
                const selectedBaseType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                    || baseRoll?.options?.type;

                for (const bonus of bonuses) {
                    const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);

                    if (bonus.id === "cleave" || bonus.id === "savageAttacker") {
                        bonus.active = isChecked;
                        if (baseRoll) {
                            baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                            baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                            const isCleaveActive = bonuses.find(b => b.id === "cleave")?.active ?? false;
                            const isSavageActive = bonuses.find(b => b.id === "savageAttacker")?.active ?? false;

                            let currentParts = [...baseRoll._nd5tOriginalParts];
                            if (isSavageActive) {
                                currentParts = applySavageAttackerToParts(currentParts);
                                baseRoll.options ??= {};
                                baseRoll.options._nd5tSavageAttacker = true;
                            } else {
                                if (baseRoll.options?._nd5tSavageAttacker) delete baseRoll.options._nd5tSavageAttacker;
                            }
                            if (isCleaveActive) {
                                const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? 0;
                                if (abilityMod > 0) {
                                    currentParts = removeAbilityModifierFromParts(currentParts);
                                    if (baseRoll.data) baseRoll.data.mod = 0;
                                }
                            } else {
                                if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                                    baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                                }
                            }
                            baseRoll.parts = currentParts;
                        }
                        continue;
                    }

                    const roll = (this.config.rolls ?? []).find(
                        r => r.options?._nd5tConditionalId === bonus.id
                    );

                    if (roll) {
                        if (isChecked) {
                            delete roll.options._nd5tInactive;
                            bonus.active = true;
                        } else {
                            roll.options._nd5tInactive = true;
                            bonus.active = false;
                        }

                        // Keep Sneak Attack, Great Weapon Master, Brutal Strike, Charger, and Boon of Irresistible Offense aligned with weapon damage type and properties
                        if ((bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster" || bonus.id === "brutalStrike" || bonus.id === "charger" || bonus.id === "boonOfIrresistibleOffense") && selectedBaseType) {
                            bonus.damageType = selectedBaseType;
                            roll.options.type = selectedBaseType;
                            if (roll.data?.roll) {
                                roll.data.roll.damageType = selectedBaseType;
                            }
                            roll.options.properties = [...baseProperties];
                        }
                    }
                }
            }
        }

        return origOnChangeForm.call(this, formConfig, event);
    };

    // 6. Finalize rolls and persist last user choice (_finalizeRolls)
    const origFinalizeRolls = DialogClass.prototype._finalizeRolls;
    DialogClass.prototype._finalizeRolls = function(action) {
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            const bonuses = this.config?._nd5tConditionalBonuses;
            if (bonuses?.length && this.form) {
                const formData = new foundry.applications.ux.FormDataExtended(this.form);
                const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId);
                const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                const baseProperties = baseRoll?.options?.properties ?? [];

                const selectedBaseType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                    || baseRoll?.options?.type;

                for (const bonus of bonuses) {
                    const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);

                    if (bonus.id === "cleave" || bonus.id === "savageAttacker") {
                        bonus.active = isChecked;
                        if (baseRoll) {
                            baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                            baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                            const isCleaveActive = bonuses.find(b => b.id === "cleave")?.active ?? false;
                            const isSavageActive = bonuses.find(b => b.id === "savageAttacker")?.active ?? false;

                            let currentParts = [...baseRoll._nd5tOriginalParts];
                            if (isSavageActive) {
                                currentParts = applySavageAttackerToParts(currentParts);
                                baseRoll.options ??= {};
                                baseRoll.options._nd5tSavageAttacker = true;
                            } else {
                                if (baseRoll.options?._nd5tSavageAttacker) delete baseRoll.options._nd5tSavageAttacker;
                            }
                            if (isCleaveActive) {
                                const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? 0;
                                if (abilityMod > 0) {
                                    currentParts = removeAbilityModifierFromParts(currentParts);
                                    if (baseRoll.data) baseRoll.data.mod = 0;
                                }
                            } else {
                                if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                                    baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                                }
                            }
                            baseRoll.parts = currentParts;
                        }
                        if (bonus.id === "savageAttacker" && isChecked && bonus.turnKey) {
                            markSavageAttackerUsed(bonus.actor, bonus.turnKey);
                        }
                        continue;
                    }

                    const roll = (this.config.rolls ?? []).find(
                        r => r.options?._nd5tConditionalId === bonus.id
                    );

                    if (roll) {
                        if (isChecked) {
                            delete roll.options._nd5tInactive;
                            bonus.active = true;
                        } else {
                            roll.options._nd5tInactive = true;
                            bonus.active = false;
                        }

                        if ((bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster" || bonus.id === "brutalStrike" || bonus.id === "charger" || bonus.id === "boonOfIrresistibleOffense") && selectedBaseType) {
                            bonus.damageType = selectedBaseType;
                            roll.options.type = selectedBaseType;
                            if (roll.data?.roll) {
                                roll.data.roll.damageType = selectedBaseType;
                            }
                            roll.options.properties = [...baseProperties];
                        }
                    }

                    if (bonus.id === "boonOfIrresistibleOffense" && isChecked && bonus.actor) {
                        const actorKey = bonus.actor.uuid || bonus.actor.id;
                        const cached = _lastAttackRollsByActor.get(actorKey);
                        if (cached) cached.damageRolled = true;
                    }

                    // Persist selection so subsequent rolls remember it (exempt cleave, brutalStrike, charger, savageAttacker, and boonOfIrresistibleOffense)
                    if (bonus.id === "sneakAttack" && isChecked && bonus.turnKey) {
                        markBonusUsedThisTurn(bonus.actor, "sneakAttack", bonus.turnKey);
                    }

                    // In combat, Sneak Attack's default is governed by once-per-turn tracking instead of remembered choices
                    const isTurnTracked = bonus.id === "sneakAttack" && Boolean(bonus.turnKey);
                    if (bonus.actor && !isTurnTracked && bonus.id !== "cleave" && bonus.id !== "brutalStrike" && bonus.id !== "charger" && bonus.id !== "savageAttacker" && bonus.id !== "boonOfIrresistibleOffense") {
                        if (bonus.id === "greatWeaponMaster" && !isChecked) {
                            // GWM was disabled for this one roll (e.g. bonus action or reaction attack).
                            // Automatically reset it back to enabled for subsequent rolls so the player doesn't have to re-enable it.
                            setActorConditionalPreference(bonus.actor, bonus.id, true);
                        } else {
                            setActorConditionalPreference(bonus.actor, bonus.id, isChecked);
                        }
                    }
                }
            }
        }

        const allRolls = origFinalizeRolls.call(this, action);
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            return (allRolls ?? []).filter(r => !r.options?._nd5tInactive);
        }
        return allRolls;
    };

    _isDialogPatched = true;
    log("Conditional Damage | Patched DamageRollConfigurationDialog for conditional toggles");
}

let _isInitialized = false;

/**
 * Initialize the Conditional Damage Bonuses feature.
 */
export function initConditionalDamage() {
    if (_isInitialized) return;
    _isInitialized = true;

    // Listen to preRollDamage to identify active concentration effects and sneak attack eligibility
    Hooks.on("dnd5e.preRollDamage", _onPreRollDamage);

    // Track evaluated attack rolls for correlating d20 results with damage rolls (e.g. for Boon of Irresistible Offense)
    Hooks.on("dnd5e.rollAttack", (rolls, { subject } = {}) => {
        const roll = rolls?.[0];
        if (!roll) return;
        const actor = subject?.actor ?? roll.data?.actor;
        if (!actor) return;
        const actorKey = actor.uuid || actor.id;
        _lastAttackRollsByActor.set(actorKey, {
            roll,
            time: Date.now(),
            activityId: subject?.id,
            itemId: subject?.item?.id
        });
    });

    Hooks.on("createChatMessage", (message) => {
        const rollType = message.getFlag?.("dnd5e", "roll.type") ?? message.flags?.dnd5e?.roll?.type;
        if (rollType === "attack" && message.rolls?.length) {
            const actor = message.getAssociatedActor?.()
                ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null);
            if (actor) {
                const actorKey = actor.uuid || actor.id;
                const existing = _lastAttackRollsByActor.get(actorKey);
                const activityId = message.getAssociatedActivity?.()?.id
                    ?? message.getFlag?.("dnd5e", "activity.id")
                    ?? existing?.activityId;
                const itemId = message.getAssociatedItem?.()?.id
                    ?? message.getFlag?.("dnd5e", "item.id")
                    ?? existing?.itemId;
                _lastAttackRollsByActor.set(actorKey, {
                    roll: message.rolls[0],
                    time: Date.now(),
                    messageId: message.id,
                    activityId,
                    itemId
                });
            }
        }
    });

    // Patch DamageRollConfigurationDialog once configuration class is available
    if (CONFIG.Dice?.DamageRoll?.DefaultConfigurationDialog) {
        _patchDamageRollConfigurationDialog();
    } else {
        Hooks.once("ready", () => {
            _patchDamageRollConfigurationDialog();
        });
    }

    log("Initialized Conditional Damage Bonuses");
}
