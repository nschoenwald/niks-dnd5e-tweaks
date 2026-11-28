/**
 * Conditional Damage Bonuses: Eligibility and formulas of the core bonuses: Sneak Attack, Genie's Wrath, Great Weapon Master, Brutal Strike, Charger, Savage Attacker, Boon of Irresistible Offense, Cleave.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, isFeatureActive } from "../../../context.js";
import { getMidiWorkflow } from "../../../utils/module-compat.js";
import { areTokensWithin } from "../../../utils/token-distance.js";
import { resolveAttackForDamage } from "./attack-cache.js";
import { getActorBonusType, setActorBonusType } from "./preferences.js";

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
    const classification = item.system?.attackType ?? item.system?.classification ?? CONFIG.DND5E?.weaponTypeMap?.[weaponType];
    const isMeleeWeapon = classification === "melee" || weaponType === "simpleM" || weaponType === "martialM";
    if (isMeleeWeapon) return false;

    // 2. Ranged weapon type check ("simpleR", "martialR", or weaponTypeMap)
    if (classification === "ranged" || weaponType === "simpleR" || weaponType === "martialR") return true;

    // 3. Ranged attack activity classification (e.g. rwak) for non-melee weapons, honoring thrown/ranged attack modes
    const actionType = activity?.getActionType?.(config?.attackMode) ?? activity?.actionType ?? item.system?.actionType;
    if (actionType === "rwak") return true;

    return false;
}

/**
 * Whether an actor has the Swashbuckler's Rakish Audacity feature (Sneak Attack without Advantage when alone
 * with the target).
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasRakishAudacity(actor) {
    if (!actor) return false;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id === "rakish-audacity" || id === "rakish_audacity" || name.includes("rakish audacity");
    });
}

/**
 * Side used to decide whether two tokens are allies. Player characters and player-owned actors always count
 * as friendly, regardless of token disposition (same rule as Template Targeting).
 *
 * @param {TokenDocument} tokenDoc
 * @returns {number|null}
 */
function _sneakAttackSide(tokenDoc) {
    const actor = tokenDoc?.actor;
    if (actor?.type === "character" || actor?.hasPlayerOwner) return CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    return tokenDoc?.disposition ?? null;
}

/**
 * Whether a token stands for a creature that counts for Sneak Attack positioning: a character or NPC that is
 * visible on the scene and not dead.
 *
 * @param {TokenDocument} tokenDoc
 * @returns {boolean}
 */
function _isPresentCreature(tokenDoc) {
    const actor = tokenDoc?.actor;
    if (!actor || tokenDoc.hidden) return false;
    if (actor.type !== "character" && actor.type !== "npc") return false;
    return !actor.statuses?.has("dead");
}

/**
 * Whether a creature can't help with Sneak Attack: Incapacitated (dnd5e adds that status for Unconscious,
 * Paralyzed, Petrified and Stunned too), defeated, or at 0 hit points.
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isIncapacitated(actor) {
    if (actor.statuses?.has("incapacitated") || actor.statuses?.has(CONFIG.specialStatusEffects?.DEFEATED)) return true;
    const hp = actor.system?.attributes?.hp;
    return Boolean(hp?.max > 0 && hp.value <= 0);
}

/**
 * Work out whether the current attack qualifies for Sneak Attack, beyond the weapon check:
 * the attack had Advantage, or an ally who isn't Incapacitated is within 5 feet of the target and the attack
 * didn't have Disadvantage. Swashbucklers with Rakish Audacity also qualify when they are within 5 feet of the
 * target, no other creature is within 5 feet of them, and the attack didn't have Disadvantage.
 *
 * The result only sets the toggle's starting state: "unknown" leaves it to the usual default.
 *
 * @param {Actor5e} actor
 * @param {Token|TokenDocument|null} attackerToken
 * @param {object} [context={}]
 * @returns {{ state: "eligible"|"ineligible"|"unknown", reason: string }}
 */
export function getSneakAttackEligibility(actor, attackerToken, { config, dialog, message, activity } = {}) {
    const attack = resolveAttackForDamage(actor, { config, dialog, message, activity });
    const ADV = CONFIG.Dice?.D20Roll?.ADV_MODE ?? { NORMAL: 0, ADVANTAGE: 1, DISADVANTAGE: -1 };
    const mode = attack?.advantageMode;
    if (mode === null || mode === undefined) return { state: "unknown", reason: "NoAttack" };
    if (mode === ADV.ADVANTAGE) return { state: "eligible", reason: "Advantage" };
    if (mode === ADV.DISADVANTAGE) return { state: "ineligible", reason: "Disadvantage" };

    // Positioning needs the canvas, the attacker's token and the target(s) on the viewed scene
    if (!canvas?.ready || !canvas.scene) return { state: "unknown", reason: "NoTarget" };
    let targetUuids = attack.targets ?? [];
    if (!targetUuids.length) {
        targetUuids = (message?.data?.system?.targets ?? message?.system?.targets ?? []).map(t => t?.token).filter(Boolean);
    }
    if (!targetUuids.length) targetUuids = Array.from(game.user?.targets ?? [], t => t.document?.uuid).filter(Boolean);
    const targets = targetUuids
        .map(uuid => fromUuidSync(uuid, { strict: false }))
        .filter(doc => doc?.parent === canvas.scene && doc.object)
        .map(doc => doc.object);
    if (!targets.length) return { state: "unknown", reason: "NoTarget" };

    const workflowToken = getMidiWorkflow(config)?.token;
    const attacker = [workflowToken?.object ?? workflowToken, attackerToken?.object ?? attackerToken]
        .find(t => t?.document) ?? null;
    const sceneTokens = canvas.tokens?.placeables ?? [];

    // Rakish Audacity: within 5 ft of the target and no other creature within 5 ft of the attacker
    if (attacker?.document?.parent === canvas.scene && actorHasRakishAudacity(actor)) {
        const alone = target => sceneTokens.every(t => t === attacker || t === target
            || !_isPresentCreature(t.document) || !areTokensWithin(attacker, t, 5));
        if (targets.some(target => areTokensWithin(attacker, target, 5) && alone(target))) {
            return { state: "eligible", reason: "RakishAudacity" };
        }
    }

    // Ally within 5 ft of the target. Without the attacker's token, its actor's side still tells who its allies are.
    const side = attacker?.document
        ? _sneakAttackSide(attacker.document)
        : ((actor.type === "character" || actor.hasPlayerOwner) ? CONST.TOKEN_DISPOSITIONS.FRIENDLY : (actor.prototypeToken?.disposition ?? null));
    if (side === null || side === CONST.TOKEN_DISPOSITIONS.SECRET) return { state: "unknown", reason: "NoAlly" };

    const targetSet = new Set(targets);
    const isAlly = t => t !== attacker
        && !targetSet.has(t)
        && t.actor !== actor
        && _isPresentCreature(t.document)
        && t.document.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET
        && _sneakAttackSide(t.document) === side
        && !_isIncapacitated(t.actor);
    const allies = sceneTokens.filter(isAlly);
    if (targets.some(target => allies.some(ally => areTokensWithin(ally, target, 5)))) {
        return { state: "eligible", reason: "Ally" };
    }
    return { state: "ineligible", reason: "NoAlly" };
}

/**
 * Damage types of Genie's Wrath, in the order of the Genie Kind table: Dao, Djinni, Efreeti, Marid.
 * @type {string[]}
 */
export const GENIES_WRATH_DAMAGE_TYPES = ["bludgeoning", "thunder", "fire", "cold"];

/**
 * Whether an actor has the Genie warlock's Genie's Wrath, or the Genie's Vessel feature that includes it.
 *
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function actorHasGeniesWrath(actor) {
    if (!actor) return false;
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");
    return feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase().replace(/[‘’`]/g, "'");
        return /^genie-?s[-_](wrath|vessel)$/.test(id)
            || /\bgenie'?s (wrath|vessel)\b/.test(name);
    });
}

/**
 * The Genie's Wrath damage type the actor picked last, or null if none was picked yet.
 *
 * @param {Actor5e|null} actor
 * @returns {string|null}
 */
export function getActorGeniesWrathType(actor) {
    return getActorBonusType(actor, "geniesWrath", GENIES_WRATH_DAMAGE_TYPES);
}

/**
 * Remember the actor's Genie's Wrath damage type (the patron's kind doesn't change, so one pick is enough).
 *
 * @param {Actor5e|null} actor
 * @param {string} type
 */
export async function setActorGeniesWrathType(actor, type) {
    return setActorBonusType(actor, "geniesWrath", type, GENIES_WRATH_DAMAGE_TYPES);
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
 * Whether Brutal Strike automation handles Brutal Strike for this user (it then adds the damage itself).
 * @returns {boolean}
 */
export function brutalStrikeAutomated() {
    try {
        return isFeatureActive("enableBrutalStrike", "clientEnableBrutalStrike");
    } catch {
        return false;
    }
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
 * Reads both places the scale value can live, whatever the system version, since characters built from
 * older content keep their old items:
 *  - on the Brutal Strike feature itself (D&D 5e 6.1 content, `@scale.brutal-strike.damage`);
 *  - on the Barbarian class (older content, `@scale.barbarian.brutal-strike`).
 * Falls back to 1d10 (or 2d10 at level 17+).
 *
 * @param {Actor5e|null} actor
 * @returns {string}
 */
export function getBrutalStrikeFormula(actor) {
    if (!actor) return "1d10";
    const scales = actor.system?.scale ?? {};
    const feats = actor.itemTypes?.feat ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "feat");

    // 1. Scale value on the Brutal Strike feature (scale values are keyed by the item's identifier)
    const brutalFeature = feats.find(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        return id === "brutal-strike" || id === "brutal_strike";
    });
    const featureScale = scales[brutalFeature?.identifier] ?? scales["brutal-strike"];
    let scaleObj = featureScale?.damage;

    // 2. Scale value on the Barbarian class
    const classes = actor.itemTypes?.class ?? Array.from(actor.items?.values() ?? []).filter(i => i.type === "class");
    const barbarianClass = classes.find(c => {
        const id = (c.identifier || c.system?.identifier || "").toLowerCase();
        const name = (c.name || "").toLowerCase();
        return id === "barbarian" || name === "barbarian";
    });

    const barbarianScale = scales[barbarianClass?.identifier]
        ?? scales.barbarian
        ?? barbarianClass?.scaleValues
        ?? {};

    scaleObj ??= barbarianScale["brutal-strike"] ?? barbarianScale["brutalStrike"] ?? barbarianScale["brutal_strike"];

    // Renamed identifiers: a "brutal" scale on any class, or a "damage" scale on any Brutal Strike item
    if (!scaleObj) {
        for (const [group, groupScale] of Object.entries(scales)) {
            if (!groupScale || (typeof groupScale !== "object")) continue;
            const isBrutalItem = group.toLowerCase().includes("brutal") && !group.toLowerCase().includes("improved");
            for (const [key, val] of Object.entries(groupScale)) {
                if (key.toLowerCase().includes("brutal") || (isBrutalItem && (key === "damage"))) {
                    scaleObj = val;
                    break;
                }
            }
            if (scaleObj) break;
        }
    }

    const rawFormula = scaleObj?.formula ?? (typeof scaleObj === "string" ? scaleObj : scaleObj?.value);
    if (rawFormula) return String(rawFormula);

    // 3. Fallback based on Barbarian class level if available (1d10 at lvl 9+, 2d10 at lvl 17+)
    if (barbarianClass) {
        const levels = Number(barbarianClass.system?.levels ?? 0);
        if (levels >= 17) return "2d10";
        if (levels >= 9) return "1d10";
    }

    // 4. Fallback to feature item damage parts if present, or improved-brutal-strike-2 feature
    const hasImpBrutal2 = feats.some(i => {
        const id = (i.identifier || i.system?.identifier || "").toLowerCase();
        const name = (i.name || "").toLowerCase();
        return id.includes("improved-brutal-strike-2") || id.includes("improved_brutal_strike_2") || name.includes("improved brutal strike (2)");
    });
    if (hasImpBrutal2) return "2d10";

    if (brutalFeature) {
        const activities = brutalFeature.system?.activities;
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
