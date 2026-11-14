/**
 * Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, Great Weapon Master, Brutal Strike, Charger, Savage Attacker, Cleave, Boon of Irresistible Offense & Genie's Wrath)
 *
 * Offers toggles in damage roll configuration dialogs when an actor is actively
 * concentrating on Hex or Hunter's Mark, attacks with a ranged or finesse weapon (Sneak Attack),
 * attacks with a Heavy weapon under 2024 rules with Great Weapon Master (+PB bonus flavored with GWM),
 * attacks with Brutal Strike (@scale.brutal-strike.damage or @scale.barbarian.brutal-strike bonus matching weapon damage type, once per turn),
 * attacks after moving 10+ ft with Charger (+1d8 bonus, once per turn),
 * attacks with Savage Attacker (rolling weapon damage dice twice and keeping higher, once per turn),
 * attacks with a Cleave mastery weapon (damage malus removing ability score modifier unless negative),
 * scores a natural 20 attack roll with Boon of Irresistible Offense (+Ability Score bonus),
 * or hits with an attack roll on their turn with Genie's Wrath (+PB of the patron's damage type, once per turn).
 * Remembers choices per actor (except one-offs and once-per-turn bonuses).
 * Sneak Attack starts on only when the attack qualifies: Advantage, an ally who isn't Incapacitated within
 * 5 ft of the target (without Disadvantage), or Rakish Audacity.
 *
 * @updated v14.75.0 (Sneak Attack detects Advantage, Disadvantage, allies next to the target and Rakish Audacity)
 * @updated v14.76.0 (Genie's Wrath: +PB on your turn, once per turn, with a remembered damage type dropdown)
 * @updated v14.85.0 (PHB class feature, species and spell bonuses: Colossus Slayer, Divine Strike, Primal Strike, Divine Fury,
 *   Frenzy, Dreadful Strikes, Dread Ambusher, Elemental Epitome, Fire's Burn, Frost's Chill, Celestial Revelation, Lunar Form,
 *   Psionic Strike, Hand of Harm, Eldritch Smite, Lifedrinker, Empowered Evocation, Radiant Soul; Assassinate; Foe Slayer)
 */

import { MODULE_ID, isFeatureActive, log, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isWm5eActive, getMidiWorkflow } from "../../utils/module-compat.js";
import { areTokensWithin } from "../../utils/token-distance.js";
import { convertLength } from "../../utils/dnd5e-compat.js";
import { isActorReckless } from "./reckless-attack.js";

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
 * The damage type the actor picked last for a bonus with a type dropdown, or null if none was picked yet.
 * Stored as `conditionalDamage.<bonusId>Type` (Genie's Wrath: `geniesWrathType`).
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string[]} allowed  Types the bonus offers.
 * @returns {string|null}
 */
export function getActorBonusType(actor, bonusId, allowed) {
    if (!actor) return null;
    const key = `${bonusId}Type`;
    const memType = _actorChoiceMemory.get(actor.uuid || actor.id)?.[key];
    if (allowed.includes(memType)) return memType;
    const flagType = actor.getFlag?.(MODULE_ID, `conditionalDamage.${key}`);
    return allowed.includes(flagType) ? flagType : null;
}

/**
 * Remember the damage type picked for a bonus with a type dropdown.
 *
 * @param {Actor5e|null} actor
 * @param {string} bonusId
 * @param {string} type
 * @param {string[]} allowed
 */
export async function setActorBonusType(actor, bonusId, type, allowed) {
    if (!actor || !allowed?.includes(type)) return;
    const key = `${bonusId}Type`;
    const memKey = actor.uuid || actor.id;
    const existingMem = _actorChoiceMemory.get(memKey) ?? {};
    existingMem[key] = type;
    _actorChoiceMemory.set(memKey, existingMem);
    try {
        if (actor.getFlag?.(MODULE_ID, `conditionalDamage.${key}`) === type) return;
        if (actor.isOwner && !actor.inCompendium && actor.setFlag) {
            await actor.setFlag(MODULE_ID, `conditionalDamage.${key}`, type);
        }
    } catch (err) {
        debug(`Conditional Damage | Could not persist ${bonusId} type on actor "${actor.name}":`, err);
    }
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
        const converted = convertLength(minDistance, "ft", units);
        if (converted > 0) effectiveMinDistance = converted;
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
 * Track once-per-turn bonuses (e.g. Sneak Attack, Savage Attacker, Charger, Brutal Strike).
 * Keyed by `${actorKey}|${bonusId}` -> turn key string `${combat.id}-r${round}-t${turn}`.
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
 * Clean up turn usage tracking entries for a deleted combat encounter.
 *
 * @param {string} combatId
 */
export function clearCombatTurnUsage(combatId) {
    if (!combatId) return;
    const prefix = `${combatId}-`;
    for (const [key, turnKey] of _bonusTurnUsage.entries()) {
        if (typeof turnKey === "string" && turnKey.startsWith(prefix)) {
            _bonusTurnUsage.delete(key);
        }
    }
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
 * In-memory map of the most recent attack roll evaluated for each actor,
 * used to correlate damage rolls with attack d20 results (e.g. for Boon of Irresistible Offense).
 * Stores lightweight primitive flags rather than retaining full Roll instances in memory.
 * Keyed by actor UUID or ID.
 * @type {Map<string, { isNatural20: boolean, advantageMode: number|null, targets: string[], time: number, turnKey: string|null, combatId: string|null, activityId?: string, itemId?: string, messageId?: string, damageRolled?: boolean }>}
 */
const _lastAttackRollsByActor = new Map();

const ATTACK_ROLL_OUT_OF_COMBAT_TTL_MS = 180000; // 3 minutes out of combat for narrative / GM adjudication
const ATTACK_ROLL_COMBAT_TTL_MS = 60000;         // 1 minute safety TTL within combat

/**
 * Prune stale attack roll entries from memory.
 */
function _pruneStaleAttackRolls() {
    const now = Date.now();
    for (const [key, entry] of _lastAttackRollsByActor.entries()) {
        const ttl = entry.combatId ? ATTACK_ROLL_COMBAT_TTL_MS : ATTACK_ROLL_OUT_OF_COMBAT_TTL_MS;
        if (now - (entry.time ?? 0) >= ttl) {
            _lastAttackRollsByActor.delete(key);
        }
    }
}

/**
 * Record evaluated attack roll metadata for an actor.
 *
 * @param {Actor5e} actor
 * @param {BasicRoll|Roll} roll
 * @param {object} [options={}]
 * @param {string} [options.activityId]
 * @param {string} [options.itemId]
 * @param {string} [options.messageId]
 * @param {string[]} [options.targets]  Token UUIDs of the attack's targets.
 */
function _recordAttackRoll(actor, roll, { activityId, itemId, messageId, targets } = {}) {
    if (!actor || !roll) return;
    _pruneStaleAttackRolls();

    const actorKey = actor.uuid || actor.id;
    const combat = getActiveCombat(actor);
    const turnKey = getCombatTurnKey(combat, actor);

    _lastAttackRollsByActor.set(actorKey, {
        isNatural20: isRollD20Natural20(roll),
        advantageMode: roll.options?.advantageMode ?? null,
        targets: Array.isArray(targets) ? targets.filter(Boolean) : [],
        time: Date.now(),
        turnKey,
        combatId: combat?.id ?? null,
        activityId,
        itemId,
        messageId,
        damageRolled: false
    });
}

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
 * Whether a chat message is a damage message.
 *
 * @param {ChatMessage5e} msg
 * @returns {boolean}
 */
function _isDamageMessage(msg) {
    return msg?.type === "damage"
        || msg?.system?.constructor?.name === "DamageMessageData"
        || Boolean(CONFIG.ChatMessage?.dataModels?.damage && msg?.system instanceof CONFIG.ChatMessage.dataModels.damage);
}

/**
 * Find the attack message (one with a d20 roll) that belongs to a chat message: its latest associated attack
 * roll, or the message itself when it holds the attack roll.
 *
 * @param {ChatMessage5e|null} msg
 * @returns {ChatMessage5e|null}
 */
function _attackMessageFor(msg) {
    if (!msg) return null;
    let candidate = null;
    if (typeof msg.getAssociatedRolls === "function") {
        candidate = msg.getAssociatedRolls("attack")?.at?.(-1) ?? null;
    }
    if (!candidate && !_isDamageMessage(msg)) candidate = msg;
    const hasD20 = (candidate?.rolls ?? []).some(r => (r.dice ?? []).some(d => d.faces === 20));
    return hasD20 ? candidate : null;
}

/**
 * Get the actor's cached attack roll if it can belong to the current damage roll: same combat turn (or both
 * out of combat), not yet followed by a damage roll, fresh, and made with the same activity and item.
 *
 * @param {Actor5e|null} actor
 * @param {object} [context={}]
 * @returns {object|null}
 */
function _getCachedAttack(actor, { config, activity } = {}) {
    if (!actor) return null;
    _pruneStaleAttackRolls();
    const cached = _lastAttackRollsByActor.get(actor.uuid || actor.id);
    if (!cached || cached.damageRolled) return null;

    const combat = getActiveCombat(actor);
    const inCombat = Boolean(combat?.active && combat.started);
    const currentTurnKey = getCombatTurnKey(combat, actor);

    // Out-of-combat attack rolls must never leak across the boundary into a started combat
    const isValidTurn = inCombat
        ? Boolean(cached.combatId && cached.turnKey && cached.turnKey === currentTurnKey)
        : !cached.combatId;
    const ttl = cached.combatId ? ATTACK_ROLL_COMBAT_TTL_MS : ATTACK_ROLL_OUT_OF_COMBAT_TTL_MS;
    const isFresh = (Date.now() - (cached.time ?? 0)) < ttl;
    if (!isValidTurn || !isFresh) return null;

    const activityMatches = !activity || !cached.activityId || cached.activityId === activity.id;
    const itemId = activity?.item?.id ?? config?.subject?.item?.id;
    const itemMatches = !itemId || !cached.itemId || cached.itemId === itemId;
    return (activityMatches && itemMatches) ? cached : null;
}

/**
 * Resolve the attack roll behind the current damage roll, from the most to the least reliable source:
 * the roll on the config, midi-qol's workflow, the originating chat message, the clicked chat card, and
 * finally the actor's cached attack roll.
 *
 * @param {Actor5e|null} actor
 * @param {object} [context={}]
 * @returns {{ roll: Roll|null, advantageMode: number|null, isNatural20: boolean, targets: string[], source: string }|null}
 */
export function resolveAttackForDamage(actor, { config, dialog, message, activity } = {}) {
    // 1. Direct roll on config (authoritative if provided)
    const directRoll = config?.attackRoll ?? config?.rolls?.[0]?.options?.attackRoll;
    if (directRoll) {
        return {
            roll: directRoll,
            advantageMode: directRoll.options?.advantageMode ?? null,
            isNatural20: isRollD20Natural20(directRoll),
            targets: [],
            source: "config"
        };
    }

    // 2. midi-qol workflow: its attack roll carries midi's own advantage result, and hitTargets only the hits
    const workflow = getMidiWorkflow(config) ?? config?.workflow ?? null;
    if (workflow?.attackRoll) {
        const source = workflow.hitTargets?.size ? workflow.hitTargets : workflow.targets;
        return {
            roll: workflow.attackRoll,
            advantageMode: workflow.attackRoll.options?.advantageMode ?? null,
            isNatural20: isRollD20Natural20(workflow.attackRoll),
            targets: Array.from(source ?? [], t => t?.document?.uuid ?? t?.uuid).filter(Boolean),
            source: "midi"
        };
    }

    const fromMessage = (msg, source) => {
        const attackMessage = _attackMessageFor(msg);
        if (!attackMessage) return null;
        const roll = attackMessage.rolls?.find(r => (r.dice ?? []).some(d => d.faces === 20)) ?? null;
        return {
            roll,
            advantageMode: roll?.options?.advantageMode ?? null,
            isNatural20: (attackMessage.rolls ?? []).some(r => isRollD20Natural20(r)),
            targets: (attackMessage.system?.targets ?? []).map(t => t?.token).filter(Boolean),
            source
        };
    };

    // 3. Direct message origin (authoritative: a found origin attack must not fall through to the cache)
    const rawOrigin = message?.system?.origin
        ?? message?.data?.system?.origin
        ?? (typeof message?.getOriginatingMessage === "function" ? message.getOriginatingMessage() : null)
        ?? config?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId
        ?? dialog?.options?.originatingMessage;

    const originMessage = (rawOrigin instanceof foundry.documents.BaseChatMessage || (rawOrigin && typeof rawOrigin === "object" && rawOrigin.id))
        ? rawOrigin
        : (typeof rawOrigin === "string" ? game.messages?.get(rawOrigin) : null);

    const fromOrigin = fromMessage(originMessage, "origin");
    if (fromOrigin) return fromOrigin;

    // 4. Event target chat message element
    const msgId = config?.event?.target?.closest?.(".chat-message")?.dataset?.messageId;
    if (msgId && msgId !== originMessage?.id) {
        const fromCard = fromMessage(game.messages?.get(msgId), "card");
        if (fromCard) return fromCard;
    }

    // 5. In-memory cached attack roll for this actor
    const cached = _getCachedAttack(actor, { config, activity });
    if (cached) {
        return {
            roll: null,
            advantageMode: cached.advantageMode ?? null,
            isNatural20: Boolean(cached.isNatural20),
            targets: cached.targets ?? [],
            source: "cache"
        };
    }

    return null;
}

/**
 * Check whether the attack roll triggering the current damage roll rolled a 20 on the d20.
 *
 * @param {Actor5e} actor
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function didAttackRollNatural20(actor, context = {}) {
    return Boolean(resolveAttackForDamage(actor, context)?.isNatural20);
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

// ── Class feature, species and spell bonuses (PHB 2024) ───────────────────────────────────────────────

/** Identifier of an item, lower case. */
function _identifierOf(item) {
    return (item?.system?.identifier || item?.identifier || "").toLowerCase();
}

/**
 * Find a feature item on an actor by identifier, or by an anchored name pattern for items without one.
 *
 * @param {Actor5e|null} actor
 * @param {string[]} identifiers
 * @param {RegExp|null} [namePattern=null]
 * @param {(item: Item5e) => boolean} [filter]
 * @returns {Item5e|null}
 */
function _findFeature(actor, identifiers, namePattern = null, filter = () => true) {
    if (!actor?.items) return null;
    return actor.items.find(i => (i.type === "feat") && filter(i)
        && (identifiers.includes(_identifierOf(i))
            || Boolean(namePattern?.test((i.name || "").replace(/[‘’`]/g, "'").trim())))) ?? null;
}

/**
 * The original actor of a polymorphed (wild shaped) actor. Its features, levels and scale values still count.
 *
 * @param {Actor5e} actor
 * @returns {Actor5e|null}
 */
function _originalActor(actor) {
    if (!actor?.isPolymorphed) return null;
    const id = actor.getFlag?.("dnd5e", "originalActor");
    return id ? (game.actors?.get(id) ?? null) : null;
}

/**
 * Levels in a class, by class identifier.
 *
 * @param {Actor5e|null} actor
 * @param {string} identifier
 * @returns {number}
 */
function _classLevels(actor, identifier) {
    return Number(actor?.classes?.[identifier]?.system?.levels ?? 0);
}

/**
 * Number of faces of a dice scale value (e.g. `@scale.monk.die`), or the fallback.
 *
 * @param {Actor5e|null} actor
 * @param {string} group  Identifier of the class, subclass or feature holding the scale value.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function _scaleDieFaces(actor, group, key, fallback) {
    const faces = Number(actor?.system?.scale?.[group]?.[key]?.faces);
    return (faces > 0) ? faces : fallback;
}

/**
 * Join a dice formula and a flat modifier, each tagged with the bonus's flavor.
 *
 * @param {string} dice
 * @param {number} mod
 * @param {string} flavor
 * @returns {{ formula: string, display: string }}
 */
function _diceWithMod(dice, mod, flavor) {
    if (!mod) return { formula: `${dice}[${flavor}]`, display: dice };
    const sign = mod < 0 ? "-" : "+";
    return {
        formula: `${dice}[${flavor}] ${sign} ${Math.abs(mod)}[${flavor}]`,
        display: `${dice} ${sign} ${Math.abs(mod)}`
    };
}

/**
 * Whether an active effect on the actor belongs to a feature: matched by name, or (for effects applied by an
 * activity, not passive ones) by the identifier of the item it came from.
 *
 * @param {Actor5e} actor
 * @param {string[]} identifiers
 * @param {RegExp} namePattern
 * @returns {ActiveEffect[]}
 */
function _activeFeatureEffects(actor, identifiers, namePattern) {
    const effects = actor?.appliedEffects ?? [];
    return effects.filter(e => {
        if (e.disabled || e.isSuppressed) return false;
        if (namePattern.test((e.name || "").trim())) return true;
        if (e.transfer || !e.origin) return false;
        try {
            const origin = fromUuidSync(e.origin, { strict: false });
            const item = (origin instanceof Item) ? origin : (origin?.item ?? null);
            return identifiers.includes(_identifierOf(item));
        } catch {
            return false;
        }
    });
}

/**
 * Whether the actor is raging (an active Rage effect).
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isActorRaging(actor) {
    return _activeFeatureEffects(actor, ["rage"], /^(?:rage|raging|kampfrausch)$/i).length > 0;
}

/**
 * Whether an activity is an attack (weapon, unarmed or spell attack).
 *
 * @param {Activity|null} activity
 * @returns {boolean}
 */
function _isAttackActivity(activity) {
    return activity?.type === "attack" || ["mwak", "rwak", "msak", "rsak"].includes(activity?.actionType ?? "");
}

/**
 * Whether the attack is an Unarmed Strike.
 *
 * @param {Item5e|null} item
 * @param {Activity|null} activity
 * @returns {boolean}
 */
function _isUnarmedStrike(item, activity) {
    return activity?.attack?.type?.classification === "unarmed"
        || _identifierOf(item).includes("unarmed-strike")
        || (item?.name || "").toLowerCase().includes("unarmed strike");
}

/**
 * Whether a weapon is the warlock's pact weapon: it carries the Pact Weapon enchantment from Pact of the Blade.
 *
 * @param {Item5e|null} item
 * @param {Actor5e|null} [actor=null]
 * @returns {boolean}
 */
export function isPactWeapon(item, actor = null) {
    if (item?.type !== "weapon") return false;
    const pact = _findFeature(actor ?? item.actor, ["pact-of-the-blade"], /^pact of the blade$/i);
    for (const effect of item.effects ?? []) {
        if ((effect.type !== "enchantment") || effect.disabled || (effect.isAppliedEnchantment === false)) continue;
        if (/pact weapon/i.test(effect.name ?? "")) return true;
        if (pact && (typeof effect.origin === "string") && effect.origin.includes(`.Item.${pact.id}`)) return true;
    }
    return false;
}

/**
 * Uses left on an item with limited uses, or null if it has none.
 *
 * @param {Item5e|null} item
 * @returns {number|null}
 */
function _usesLeft(item) {
    const uses = item?.system?.uses;
    if (!uses || !(Number(uses.max) > 0)) return null;
    return Math.max(0, Number(uses.value ?? 0));
}

/**
 * Token documents targeted by the attack behind this damage roll (or the user's targets).
 *
 * @param {Actor5e} actor
 * @param {object} context
 * @returns {TokenDocument[]}
 */
function _resolveTargetDocs(actor, { config, dialog, message, activity } = {}) {
    let uuids = resolveAttackForDamage(actor, { config, dialog, message, activity })?.targets ?? [];
    if (!uuids.length) {
        uuids = (message?.data?.system?.targets ?? message?.system?.targets ?? []).map(t => t?.token).filter(Boolean);
    }
    if (!uuids.length) uuids = Array.from(game.user?.targets ?? [], t => t.document?.uuid).filter(Boolean);
    return uuids.map(uuid => {
        try {
            return fromUuidSync(uuid, { strict: false });
        } catch {
            return null;
        }
    }).filter(doc => doc?.actor);
}

/**
 * Spend the resource of a bonus that costs one (item uses or a Pact Magic slot) once its roll is made.
 *
 * @param {object} bonus
 */
async function _consumeBonusResource(bonus) {
    const actor = bonus?.actor;
    const consume = bonus?.consume;
    if (!actor || !consume) return;
    try {
        if (consume.type === "pactSlot") {
            const value = Number(actor.system?.spells?.pact?.value ?? 0);
            if (value > 0) await actor.update({ "system.spells.pact.value": value - 1 });
        } else if (consume.type === "itemUses") {
            const item = consume.actor?.items?.get(consume.itemId) ?? actor.items?.get(consume.itemId);
            const uses = item?.system?.uses;
            if (uses && (Number(uses.value ?? 0) > 0)) {
                await item.update({ "system.uses.spent": Number(uses.spent ?? 0) + 1 });
            }
        }
        debug(`Conditional Damage | ${bonus.spellName}: spent ${consume.type === "pactSlot" ? "a Pact Magic slot" : "1 use"}.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Conditional Damage: could not spend the resource of ${bonus.spellName}`, err);
    }
}

/**
 * Whether a bonus of this kind follows the weapon's damage type and properties (magical, silvered …).
 *
 * @param {object} bonus
 * @returns {boolean}
 */
function _matchesWeaponType(bonus) {
    return Boolean(bonus?.matchWeaponType)
        || ["sneakAttack", "greatWeaponMaster", "brutalStrike", "charger", "boonOfIrresistibleOffense"].includes(bonus?.id);
}

/** Damage types offered by bonuses with a type choice. */
const DIVINE_STRIKE_TYPES = ["radiant", "necrotic"];
const PRIMAL_STRIKE_TYPES = ["cold", "fire", "lightning", "thunder"];
const DIVINE_FURY_TYPES = ["necrotic", "radiant"];
const ELEMENTAL_EPITOME_TYPES = ["acid", "cold", "fire", "lightning", "thunder"];
const LIFEDRINKER_TYPES = ["necrotic", "psychic", "radiant"];

/**
 * Add the class feature and species bonuses that ride on attacks (PHB 2024).
 *
 * @param {object} ctx
 * @param {object[]} out
 */
function _addFeatureAttackBonuses(ctx, out) {
    const { actor, item, activity, config, dialog, message, baseDamageType, turnKey, isMyTurn } = ctx;
    const isWeapon = item?.type === "weapon";
    const unarmed = _isUnarmedStrike(item, activity);
    const original = _originalActor(actor);
    const feature = (ids, pattern, filter) => _findFeature(actor, ids, pattern, filter)
        ?? (original ? _findFeature(original, ids, pattern, filter) : null);
    const levels = id => _classLevels(actor, id) || _classLevels(original, id);
    const used = (usageId) => hasUsedBonusThisTurn(actor, usageId, turnKey);
    const add = (bonus) => out.push({ turnKey, oneOff: true, ...bonus });

    // Remembered pick, or the first type
    const pickType = (bonusId, types) => getActorBonusType(actor, bonusId, types) ?? types[0];

    // Colossus Slayer (Hunter's Prey): +1d8 once per turn when the target is missing hit points
    if (isWeapon && feature(["hunters-prey"], /^hunter's prey(?::\s*colossus slayer)?$|^colossus slayer$/i)) {
        const targets = _resolveTargetDocs(actor, { config, dialog, message, activity });
        const hurt = targets.some(doc => {
            const hp = doc.actor.system?.attributes?.hp;
            return hp && (Number(hp.max) > 0) && (Number(hp.value) < Number(hp.max));
        });
        const usedNow = used("colossusSlayer");
        add({
            id: "colossusSlayer",
            spellName: "Colossus Slayer",
            formula: "1d8[Colossus Slayer]",
            formulaDisplay: "1d8",
            damageType: baseDamageType,
            matchWeaponType: true,
            flavor: "Colossus Slayer",
            labelKey: "ND5T.ConditionalDamage.ColossusSlayer.Label",
            defaultLabel: "Colossus Slayer (+1d8)",
            tooltipKey: `ND5T.ConditionalDamage.ColossusSlayer.Reason.${!targets.length ? "NoTarget" : (hurt ? "Hurt" : "Full")}`,
            tooltipFallback: !targets.length
                ? "No target found. Check the target's hit points yourself."
                : (hurt ? "The target is missing hit points." : "The target has all its hit points."),
            // Hunter's Prey can be switched to Horde Breaker: a choice made while the target qualified is remembered
            rememberWhen: hurt && !usedNow,
            defaultActive: hurt && !usedNow && getActorConditionalPreference(actor, "colossusSlayer", true)
        });
    }

    // Divine Strike (Cleric Blessed Strikes): +1d8 (2d8 at 14) radiant or necrotic, once on each of your turns
    if (isWeapon && isMyTurn && feature(["divine-strike"], /^(?:blessed strikes:\s*)?divine strike$/i)) {
        const dice = levels("cleric") >= 14 ? "2d8" : "1d8";
        add({
            id: "divineStrike",
            spellName: "Divine Strike",
            formula: `${dice}[Divine Strike]`,
            formulaDisplay: dice,
            damageType: "radiant",
            damageTypes: [...DIVINE_STRIKE_TYPES],
            flavor: "Divine Strike",
            labelKey: "ND5T.ConditionalDamage.DivineStrike.Label",
            defaultLabel: `Divine Strike (+${dice})`,
            defaultActive: !used("divineStrike")
        });
    }

    // Primal Strike (Druid Elemental Fury): +1d8 (2d8 at 15), weapon or Wild Shape attack, once on each of your turns
    if ((isWeapon || actor.isPolymorphed) && isMyTurn
        && feature(["primal-strike"], /^(?:elemental fury:\s*)?primal strike$/i)) {
        const dice = levels("druid") >= 15 ? "2d8" : "1d8";
        add({
            id: "primalStrike",
            spellName: "Primal Strike",
            formula: `${dice}[Primal Strike]`,
            formulaDisplay: dice,
            damageType: pickType("primalStrike", PRIMAL_STRIKE_TYPES),
            damageTypes: [...PRIMAL_STRIKE_TYPES],
            rememberType: true,
            flavor: "Primal Strike",
            labelKey: "ND5T.ConditionalDamage.PrimalStrike.Label",
            defaultLabel: `Primal Strike (+${dice})`,
            defaultActive: !used("primalStrike")
        });
    }

    // Divine Fury (Zealot): +1d6 + half Barbarian level on the first hit of each of your turns while raging
    if (isMyTurn && feature(["divine-fury"], /^divine fury$/i) && isActorRaging(actor)) {
        const half = Math.floor(levels("barbarian") / 2);
        const { formula, display } = _diceWithMod("1d6", half, "Divine Fury");
        add({
            id: "divineFury",
            spellName: "Divine Fury",
            formula,
            formulaDisplay: display,
            damageType: pickType("divineFury", DIVINE_FURY_TYPES),
            damageTypes: [...DIVINE_FURY_TYPES],
            rememberType: true,
            flavor: "Divine Fury",
            labelKey: "ND5T.ConditionalDamage.DivineFury.Label",
            defaultLabel: `Divine Fury (+${display})`,
            defaultActive: !used("divineFury")
        });
    }

    // Frenzy (Berserker): Rage Damage d6s on the first Strength-based hit of your turn, raging and Reckless
    if (isMyTurn && feature(["frenzy"], /^frenzy$/i) && isActorRaging(actor) && isActorReckless(actor)
        && isEligibleBrutalStrikeAttack(item, activity, config, actor)) {
        const count = Number(actor.system?.scale?.barbarian?.["rage-damage"]?.value
            ?? original?.system?.scale?.barbarian?.["rage-damage"]?.value ?? 2) || 2;
        const dice = `${count}d6`;
        add({
            id: "frenzy",
            spellName: "Frenzy",
            formula: `${dice}[Frenzy]`,
            formulaDisplay: dice,
            damageType: baseDamageType,
            matchWeaponType: true,
            flavor: "Frenzy",
            labelKey: "ND5T.ConditionalDamage.Frenzy.Label",
            defaultLabel: `Frenzy (+${dice})`,
            defaultActive: !used("frenzy")
        });
    }

    // Dreadful Strikes (Fey Wanderer): +1d4 (1d6 at 11) psychic, each creature once per turn
    if (isWeapon && feature(["dreadful-strikes"], /^dreadful strikes?$/i)) {
        const dice = levels("ranger") >= 11 ? "1d6" : "1d4";
        const targets = _resolveTargetDocs(actor, { config, dialog, message, activity });
        const usageId = targets.length === 1 ? `dreadfulStrikes:${targets[0].uuid}` : "dreadfulStrikes";
        add({
            id: "dreadfulStrikes",
            usageId,
            spellName: "Dreadful Strikes",
            formula: `${dice}[Dreadful Strikes]`,
            formulaDisplay: dice,
            damageType: "psychic",
            flavor: "Dreadful Strikes",
            labelKey: "ND5T.ConditionalDamage.DreadfulStrikes.Label",
            defaultLabel: `Dreadful Strikes (+${dice})`,
            defaultActive: !used(usageId)
        });
    }

    // Dread Ambusher (Gloom Stalker): +2d6 (2d8 at 11) psychic once per turn, Wisdom modifier uses per Long Rest
    const ambusher = isWeapon ? feature(["dread-ambusher"], /^dread ambusher$/i) : null;
    const ambusherUses = _usesLeft(ambusher);
    if (ambusher && ((ambusherUses ?? 0) > 0) && !used("dreadAmbusher")) {
        const dice = levels("ranger") >= 11 ? "2d8" : "2d6";
        add({
            id: "dreadAmbusher",
            spellName: "Dread Ambusher",
            formula: `${dice}[Dread Ambusher]`,
            formulaDisplay: dice,
            damageType: "psychic",
            flavor: "Dread Ambusher",
            usesLeft: ambusherUses,
            consume: { type: "itemUses", itemId: ambusher.id, actor: ambusher.actor },
            labelKey: "ND5T.ConditionalDamage.DreadAmbusher.Label",
            defaultLabel: `Dread Ambusher (+${dice}, ${ambusherUses} left)`,
            defaultActive: false
        });
    }

    // Elemental Epitome (Monk 17): +1 Martial Arts die on an Unarmed Strike, once on each of your turns, while
    // Elemental Attunement is active
    if (unarmed && isMyTurn && feature(["elemental-epitome"], /^elemental epitome$/i)) {
        const attunement = feature(["elemental-attunement"], /^elemental attunement/i);
        const attuned = !attunement
            || (attunement.effects ?? []).some(e => (e.type === "enchantment") && !e.disabled && (e.isAppliedEnchantment === true))
            || /\(active\)/i.test(attunement.name ?? "");
        if (attuned) {
            const dice = `1d${_scaleDieFaces(actor, "monk", "die", 0) || _scaleDieFaces(original, "monk", "die", 10)}`;
            add({
                id: "elementalEpitome",
                spellName: "Elemental Epitome",
                formula: `${dice}[Elemental Epitome]`,
                formulaDisplay: dice,
                damageType: pickType("elementalEpitome", ELEMENTAL_EPITOME_TYPES),
                damageTypes: [...ELEMENTAL_EPITOME_TYPES],
                rememberType: true,
                flavor: "Elemental Epitome",
                labelKey: "ND5T.ConditionalDamage.ElementalEpitome.Label",
                defaultLabel: `Elemental Epitome (+${dice})`,
                defaultActive: !used("elementalEpitome")
            });
        }
    }

    // Fire's Burn / Frost's Chill (Goliath Giant Ancestry): on a hit with an attack roll, Proficiency Bonus uses
    for (const giant of [
        { id: "firesBurn", ids: ["fires-burn"], pattern: /^fire's burn/i, name: "Fire's Burn", dice: "1d10", type: "fire", key: "FiresBurn" },
        { id: "frostsChill", ids: ["frosts-chill"], pattern: /^frost's chill/i, name: "Frost's Chill", dice: "1d6", type: "cold", key: "FrostsChill" }
    ]) {
        const giantItem = feature(giant.ids, giant.pattern);
        const left = _usesLeft(giantItem);
        if (!giantItem || !((left ?? 0) > 0)) continue;
        add({
            id: giant.id,
            spellName: giant.name,
            formula: `${giant.dice}[${giant.name}]`,
            formulaDisplay: giant.dice,
            damageType: giant.type,
            flavor: giant.name,
            usesLeft: left,
            consume: { type: "itemUses", itemId: giantItem.id, actor: giantItem.actor },
            labelKey: `ND5T.ConditionalDamage.${giant.key}.Label`,
            defaultLabel: `${giant.name} (+${giant.dice}, ${left} left)`,
            turnKey: null,
            defaultActive: false
        });
    }

    // Lunar Form (Moon Druid 10): +2d10 radiant on a Wild Shape form's attack, once on each of your turns
    if (actor.isPolymorphed && isMyTurn && feature(["lunar-form"], /^lunar form$/i)) {
        add({
            id: "lunarForm",
            spellName: "Lunar Form",
            formula: "2d10[Lunar Form]",
            formulaDisplay: "2d10",
            damageType: "radiant",
            flavor: "Lunar Form",
            labelKey: "ND5T.ConditionalDamage.LunarForm.Label",
            defaultLabel: "Lunar Form (+2d10)",
            defaultActive: !used("lunarForm")
        });
    }

    // Psionic Strike (Psi Warrior): Psionic Energy Die + Intelligence modifier force, once on each of your turns
    const psionic = isWeapon && isMyTurn
        ? feature(["psionic-power"], /^psionic power$/i, i => Array.from(i.system?.activities ?? []).some(a => a.type === "damage"))
        : null;
    const psionicUses = _usesLeft(psionic);
    if (psionic && ((psionicUses ?? 0) > 0) && !used("psionicStrike")) {
        const faces = _scaleDieFaces(actor, "psi-warrior", "die", 0) || _scaleDieFaces(original, "psi-warrior", "die", 6);
        const { formula, display } = _diceWithMod(`1d${faces}`, Number(actor.system?.abilities?.int?.mod ?? 0), "Psionic Strike");
        add({
            id: "psionicStrike",
            spellName: "Psionic Strike",
            formula,
            formulaDisplay: display,
            damageType: "force",
            flavor: "Psionic Strike",
            usesLeft: psionicUses,
            consume: { type: "itemUses", itemId: psionic.id, actor: psionic.actor },
            labelKey: "ND5T.ConditionalDamage.PsionicStrike.Label",
            defaultLabel: `Psionic Strike (+${display}, ${psionicUses} left)`,
            defaultActive: false
        });
    }

    // Hand of Harm (Warrior of Mercy): 1 Focus Point, Martial Arts die + Wisdom modifier necrotic, once per turn
    if (unarmed && !used("handOfHarm") && feature(["hand-of-harm"], /^hand of harm$/i)) {
        const focus = feature(["monks-focus"], /^monk's focus$/i);
        const focusLeft = _usesLeft(focus);
        if (focus && (focusLeft ?? 0) > 0) {
            const faces = _scaleDieFaces(actor, "monk", "die", 0) || _scaleDieFaces(original, "monk", "die", 6);
            const { formula, display } = _diceWithMod(`1d${faces}`, Number(actor.system?.abilities?.wis?.mod ?? 0), "Hand of Harm");
            add({
                id: "handOfHarm",
                spellName: "Hand of Harm",
                formula,
                formulaDisplay: display,
                damageType: "necrotic",
                flavor: "Hand of Harm",
                usesLeft: focusLeft,
                consume: { type: "itemUses", itemId: focus.id, actor: focus.actor },
                labelKey: "ND5T.ConditionalDamage.HandOfHarm.Label",
                defaultLabel: `Hand of Harm (+${display}, ${focusLeft} Focus left)`,
                defaultActive: false
            });
        }
    }

    // Eldritch Smite (invocation): a Pact Magic slot, (1 + slot level)d8 force with the pact weapon, once per turn
    const pactWeapon = isWeapon && isPactWeapon(item, actor);
    const pact = actor.system?.spells?.pact;
    if (pactWeapon && (Number(pact?.value ?? 0) > 0) && (Number(pact?.level ?? 0) > 0) && !used("eldritchSmite")
        && feature(["eldritch-smite"], /^(?:eldritch invocation:\s*)?eldritch smite$/i)) {
        const dice = `${1 + Number(pact.level)}d8`;
        add({
            id: "eldritchSmite",
            spellName: "Eldritch Smite",
            formula: `${dice}[Eldritch Smite]`,
            formulaDisplay: dice,
            damageType: "force",
            flavor: "Eldritch Smite",
            usesLeft: Number(pact.value),
            consume: { type: "pactSlot" },
            labelKey: "ND5T.ConditionalDamage.EldritchSmite.Label",
            defaultLabel: `Eldritch Smite (+${dice}, uses a Pact slot)`,
            defaultActive: false
        });
    }

    // Lifedrinker (invocation): +1d6 necrotic, psychic or radiant with the pact weapon
    if (pactWeapon && feature(["lifedrinker"], /^(?:eldritch invocation:\s*)?lifedrinker$/i)) {
        add({
            id: "lifedrinker",
            spellName: "Lifedrinker",
            formula: "1d6[Lifedrinker]",
            formulaDisplay: "1d6",
            damageType: pickType("lifedrinker", LIFEDRINKER_TYPES),
            damageTypes: [...LIFEDRINKER_TYPES],
            rememberType: true,
            flavor: "Lifedrinker",
            labelKey: "ND5T.ConditionalDamage.Lifedrinker.Label",
            defaultLabel: "Lifedrinker (+1d6)",
            turnKey: null,
            oneOff: false,
            defaultActive: true
        });
    }
}

/**
 * Add the bonuses for spell damage (Empowered Evocation, Radiant Soul) and Celestial Revelation, which also works
 * with attacks. Spell bonuses work with every spell damage roll, saving throw spells included.
 *
 * @param {object} ctx
 * @param {object[]} out
 */
function _addSpellBonuses(ctx, out) {
    const { actor, item, config, baseDamageType, turnKey, isMyTurn, isAttack } = ctx;
    const isSpell = item?.type === "spell";
    const used = (usageId) => hasUsedBonusThisTurn(actor, usageId, turnKey);

    // Damage types of the roll's parts
    const rollTypes = new Set();
    for (const roll of config?.rolls ?? []) {
        if (roll?.options?._nd5tConditionalId) continue;
        const types = roll?.options?.types ?? (roll?.options?.type ? [roll.options.type] : []);
        for (const type of types) if (type) rollTypes.add(type);
    }

    // Empowered Evocation (Evoker): + Intelligence modifier to a Wizard Evocation spell's damage
    if (isSpell && (item.system?.school === "evo") && _findFeature(actor, ["empowered-evocation"], /^empowered evocation$/i)) {
        const classId = item.system?.classIdentifier ?? "";
        const intMod = Number(actor.system?.abilities?.int?.mod ?? 0);
        if ((!classId || classId === "wizard") && intMod > 0) {
            out.push({
                id: "empoweredEvocation",
                spellName: "Empowered Evocation",
                formula: `${intMod}[Empowered Evocation]`,
                formulaDisplay: String(intMod),
                damageType: baseDamageType,
                matchWeaponType: true,
                flat: true,
                flavor: "Empowered Evocation",
                labelKey: "ND5T.ConditionalDamage.EmpoweredEvocation.Label",
                defaultLabel: `Empowered Evocation (+${intMod})`,
                defaultActive: true
            });
        }
    }

    // Radiant Soul (Celestial Patron): + Charisma modifier to a radiant or fire spell, once on each of your turns
    const soulTypes = ["radiant", "fire"].filter(t => rollTypes.has(t));
    const chaMod = Number(actor.system?.abilities?.cha?.mod ?? 0);
    if (isSpell && isMyTurn && soulTypes.length && (chaMod > 0) && _findFeature(actor, ["radiant-soul"], /^radiant soul$/i)) {
        out.push({
            id: "radiantSoul",
            spellName: "Radiant Soul",
            formula: `${chaMod}[Radiant Soul]`,
            formulaDisplay: String(chaMod),
            damageType: soulTypes.includes(baseDamageType) ? baseDamageType : soulTypes[0],
            ...(soulTypes.length > 1 ? { damageTypes: soulTypes } : {}),
            flat: true,
            oneOff: true,
            turnKey,
            flavor: "Radiant Soul",
            labelKey: "ND5T.ConditionalDamage.RadiantSoul.Label",
            defaultLabel: `Radiant Soul (+${chaMod})`,
            defaultActive: !used("radiantSoul")
        });
    }

    // Celestial Revelation (Aasimar): + Proficiency Bonus to an attack or spell, once on each of your turns, while
    // transformed. Necrotic Shroud deals necrotic damage, Heavenly Wings and Inner Radiance radiant.
    if ((isAttack || isSpell) && isMyTurn && _findFeature(actor, ["celestial-revelation"], /^celestial revelation$/i)) {
        const revelation = _activeFeatureEffects(actor, ["celestial-revelation"],
            /^(?:heavenly wings|inner radiance|searing radiance|necrotic shroud)$/i);
        if (revelation.length) {
            const pb = Number(actor.system?.attributes?.prof ?? 2);
            const necrotic = revelation.some(e => /necrotic shroud/i.test(e.name ?? ""));
            out.push({
                id: "celestialRevelation",
                spellName: "Celestial Revelation",
                formula: `${pb}[Celestial Revelation]`,
                formulaDisplay: String(pb),
                damageType: necrotic ? "necrotic" : "radiant",
                flat: true,
                oneOff: true,
                turnKey,
                flavor: "Celestial Revelation",
                labelKey: "ND5T.ConditionalDamage.CelestialRevelation.Label",
                defaultLabel: `Celestial Revelation (+${pb})`,
                defaultActive: !used("celestialRevelation")
            });
        }
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

    // Damage rolls without an activity count as attacks (old behaviour); other activities (saving throw spells,
    // damage activities) only get the spell damage bonuses.
    const isAttack = !activity || _isAttackActivity(activity);

    // --- 1. Concentration Spells (Hex & Hunter's Mark) ---
    const effects = actor.appliedEffects ?? Array.from(actor.effects?.values() ?? []);
    const concentrationItems = actor.concentration?.items ?? new Set();
    const localizedConcentrating = (game.i18n?.localize("EFFECT.DND5E.StatusConcentrating") || "Concentrating").toLowerCase();

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

        if (hasMatch && (def.id === "huntersMark") && _findFeature(actor, ["foe-slayer"], /^foe slayer$/i)) {
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
    const featureContext = { actor, item, activity, config, dialog, message, baseDamageType, token, combat, inCombat, turnKey, isMyTurn, isAttack };

    if (!isAttack) {
        _addSpellBonuses(featureContext, activeBonuses);
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
            && _findFeature(actor, ["assassinate"], /^assassinate$/i)) {
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
    if (isModernRules() && actorHasGreatWeaponMaster(actor) && isEligibleHeavyWeapon(item) && isMyTurn) {
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
    if (isModernRules() && actorHasBrutalStrike(actor) && isEligibleBrutalStrikeAttack(item, activity, config, actor) && isMyTurn) {
        const hasUsedThisTurn = inCombat && hasUsedBonusThisTurn(actor, "brutalStrike", turnKey);
        if (!hasUsedThisTurn) {
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
                defaultActive: false
            });
        }
    }

    // --- 6. Charger (2024 Modern Rules: +1d8 damage on melee attack after moving at least 10 ft on your turn, once per turn) ---
    if (isModernRules() && actorHasCharger(actor) && isEligibleChargerAttack(item, activity, config)) {
        const hasUsedThisTurn = inCombat && hasUsedBonusThisTurn(actor, "charger", turnKey);
        const isEligibleTurnAndMovement = !inCombat
            || (!hasUsedThisTurn && isMyTurn && hasAttackerMovedChargerDistance(actor, token, 10));

        if (isEligibleTurnAndMovement) {
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
                defaultActive: false
            });
        }
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
    if (isMyTurn && actorHasGeniesWrath(actor)) {
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
                defaultActive: !(inCombat && hasUsedBonusThisTurn(actor, "geniesWrath", turnKey))
            });
        }
    }

    // --- 9. Boon of Irresistible Offense (2024 Modern Rules: +Ability Score when rolling a 20 on the d20 for an attack roll) ---
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

    // --- 10. Class features and species traits (PHB 2024), then spell damage bonuses ---
    _addFeatureAttackBonuses(featureContext, activeBonuses);
    _addSpellBonuses(featureContext, activeBonuses);

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

    // Must be a damage roll hook
    if (config.hookNames && !config.hookNames.includes("damage")) return;

    // Initiative rolls or rolls with non-damage subjects must never receive conditional damage bonuses
    if (config.rolls?.some(r => r.options?.type === "initiative" || r.data?.roll?.type === "initiative")) return;

    // Healing rolls cannot receive attack-dependent damage bonuses
    const rollType = config.subject?.type ?? message?.type ?? message?.system?.type ?? message?.data?.type;
    if (rollType === "heal") return;
    if (config.rolls?.some(r => r.options?.type === "healing" || r.options?.type === "temphp")) return;

    // Damage rolls are associated with activities/items, not an Actor directly (e.g. rollInitiative passes subject: this [Actor])
    if (config.subject instanceof Actor) return;

    // Most bonuses require hitting with an attack. Other activities (a saving throw spell like Fireball, a damage
    // activity like Magic Missile) only get the spell damage bonuses (Empowered Evocation, Radiant Soul, Celestial
    // Revelation), so non-attack activities of anything but spells bail out here.
    if (config.subject && !_isAttackActivity(config.subject) && (config.subject.item?.type !== "spell")) return;

    // Resolve the rolling actor
    const actor = config.subject?.actor
        ?? dialog?.options?.actor
        ?? (config.subject?.item?.actor)
        ?? (config.rolls?.[0]?.data?.actor)
        ?? (typeof message?.getAssociatedActor === "function" ? message.getAssociatedActor() : null)
        ?? (message?.speaker ? ChatMessage.getSpeakerActor?.(message.speaker) : null)
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
        const isOneOffOrTurnTracked = def.id === "cleave"
            || def.id === "brutalStrike"
            || def.id === "charger"
            || def.id === "boonOfIrresistibleOffense"
            || def.id === "savageAttacker"
            || def.id === "geniesWrath"
            || Boolean(def.oneOff)
            || (def.id === "sneakAttack" && (def.turnKey || def.eligibility?.state !== "unknown"));
        const lastChoice = isOneOffOrTurnTracked
            ? def.defaultActive
            : getActorConditionalPreference(actor, def.id, def.defaultActive);
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

    const isFastForward = dialog.configure === false || Boolean(config.event?.shiftKey) || Boolean(config.options?.fastForward);

    if (baseRoll) {
        baseRoll._nd5tOriginalParts = [...(baseRoll.parts ?? [])];
        baseRoll._nd5tOriginalMod = baseRoll.data?.mod;

        const savageBonus = config._nd5tConditionalBonuses.find(b => b.id === "savageAttacker" && b.active);
        if (savageBonus) {
            baseRoll.parts = applySavageAttackerToParts(baseRoll._nd5tOriginalParts);
            baseRoll.options ??= {};
            baseRoll.options._nd5tSavageAttacker = true;
        }
    }

    if (isFastForward) {
        for (const bonus of config._nd5tConditionalBonuses) {
            if (bonus.active && bonus.turnKey) {
                markBonusUsedThisTurn(actor, bonus.usageId ?? bonus.id, bonus.turnKey);
            }
            if (bonus.active && bonus.consume) _consumeBonusResource(bonus);
        }
        if (actor) {
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
            const properties = _matchesWeaponType(bonus) ? baseProperties : [];
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
    if (!config || (config.hookNames && !config.hookNames.includes("damage"))) return;
    const bonuses = config._nd5tConditionalBonuses;
    if (!bonuses?.length) return;

    config.rolls ??= [];
    const baseIndex = config.rolls.findIndex(r => !r.options?._nd5tConditionalId && !r.options?._nd5tTypedBonus);
    const baseRoll = baseIndex >= 0 ? config.rolls[baseIndex] : config.rolls[0];
    const baseRollData = baseRoll?.data ?? {};
    const baseProperties = baseRoll?.options?.properties ?? [];
    const isCritical = Boolean(config.isCritical);

    for (const bonus of bonuses) {
        if (bonus.isMalus || bonus.isWeaponModifier) continue;

        let rollConfig = config.rolls.find(r => r.options?._nd5tConditionalId === bonus.id);
        if (!rollConfig) {
            const properties = _matchesWeaponType(bonus) ? baseProperties : [];
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

/**
 * Fallback texts for the Sneak Attack eligibility tooltip, used when a key is missing from the language file.
 */
const SNEAK_ATTACK_REASON_FALLBACKS = {
    Advantage: "The attack had Advantage.",
    Ally: "An ally is within 5 ft of the target.",
    RakishAudacity: "Rakish Audacity: no other creature is within 5 ft of you.",
    Disadvantage: "The attack had Disadvantage.",
    NoAlly: "No Advantage, and no ally within 5 ft of the target.",
    NoAttack: "The attack roll wasn't found. Check the conditions yourself.",
    NoTarget: "No target on this scene. Check the conditions yourself."
};

/**
 * Show why Sneak Attack starts on or off as a tooltip on its toggle.
 *
 * @param {DamageRollConfigurationDialog} app
 */
function _applySneakAttackTooltip(app) {
    const bonus = app?.config?._nd5tConditionalBonuses?.find(b => b.id === "sneakAttack");
    const reason = bonus?.eligibility?.reason;
    if (!reason || !app.element) return;
    const input = app.element.querySelector('input[name="nd5t.conditional.sneakAttack"]');
    const group = input?.closest(".form-group") ?? input?.parentElement;
    if (!group) return;
    const key = `ND5T.ConditionalDamage.SneakAttack.Reason.${reason}`;
    group.dataset.tooltip = game.i18n?.has(key) ? game.i18n.localize(key) : (SNEAK_ATTACK_REASON_FALLBACKS[reason] ?? "");
    group.dataset.tooltipDirection = "UP";
}

/**
 * Read the damage type picked in a conditional roll's dropdown.
 *
 * @param {DamageRollConfigurationDialog} app
 * @param {FormDataExtended} formData
 * @param {object} roll  The roll configuration inside `app.config.rolls`.
 * @returns {string|null}
 */
function _getPickedRollType(app, formData, roll) {
    const index = (app.config?.rolls ?? []).indexOf(roll);
    if (index < 0) return null;
    const picked = formData?.get?.(`roll.${index}.damageType`);
    return (typeof picked === "string" && roll.options?.types?.includes(picked)) ? picked : null;
}

/**
 * Until a Genie's Wrath type has been picked once, remind the player on the toggle to pick the patron's type.
 *
 * @param {DamageRollConfigurationDialog} app
 */
function _applyGeniesWrathTooltip(app) {
    const bonus = app?.config?._nd5tConditionalBonuses?.find(b => b.id === "geniesWrath");
    if (!bonus || bonus.typeRemembered || !app.element) return;
    const input = app.element.querySelector('input[name="nd5t.conditional.geniesWrath"]');
    const group = input?.closest(".form-group") ?? input?.parentElement;
    if (!group) return;
    const key = "ND5T.ConditionalDamage.GeniesWrath.PickType";
    group.dataset.tooltip = game.i18n?.has(key)
        ? game.i18n.localize(key)
        : "Pick your patron's damage type in the Genie's Wrath row. Your pick is remembered.";
    group.dataset.tooltipDirection = "UP";
}

/**
 * Show a bonus's own tooltip (e.g. why Colossus Slayer starts on or off) on its toggle.
 *
 * @param {DamageRollConfigurationDialog} app
 */
function _applyBonusTooltips(app) {
    for (const bonus of app?.config?._nd5tConditionalBonuses ?? []) {
        if (!bonus.tooltipKey || !app.element) continue;
        const input = app.element.querySelector(`input[name="nd5t.conditional.${bonus.id}"]`);
        const group = input?.closest(".form-group") ?? input?.parentElement;
        if (!group) continue;
        group.dataset.tooltip = game.i18n?.has(bonus.tooltipKey) ? game.i18n.localize(bonus.tooltipKey) : (bonus.tooltipFallback ?? "");
        group.dataset.tooltipDirection = "UP";
    }
}

let _isDialogPatched = false;

/**
 * Patch DamageRollConfigurationDialog to display conditional damage toggles,
 * synchronize rolls in real time, grey out inactive bonuses without layout shift, and persist preferences.
 */
function _patchDamageRollConfigurationDialog() {
    if (_isDialogPatched) return;
    const base = foundry.utils.getProperty(globalThis, "dnd5e.applications.dice.DamageRollConfigurationDialog")
        ? "dnd5e.applications.dice.DamageRollConfigurationDialog"
        : (CONFIG.Dice?.DamageRoll?.DefaultConfigurationDialog ? "CONFIG.Dice.DamageRoll.DefaultConfigurationDialog" : null);
    if (!base) return;
    _isDialogPatched = true;

    // 1. Ensure all eligible conditional bonus rolls are included upfront when the dialog is configured
    patchMethod(
        `${base}.configure`,
        async function(wrapped, config = {}, dialog = {}, message = {}) {
            const isDamage = config.hookNames?.includes("damage")
                || (this.rollType && this.rollType === CONFIG.Dice?.DamageRoll)
                || (this.name === "DamageRollConfigurationDialog");
            if (isDamage && isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage") && config._nd5tConditionalBonuses?.length) {
                _ensureAllConditionalRollsInConfig(config);
            }
            return wrapped(config, dialog, message);
        },
        "WRAPPER"
    );

    // 2. Filter dice in _prepareFormulasContext and label untyped damage as "Pure"
    patchMethod(
        `${base}.prototype._prepareFormulasContext`,
        async function(wrapped, context, options) {
            context = await wrapped(context, options);

            if (this.constructor.rollType && this.constructor.rollType !== CONFIG.Dice.DamageRoll) {
                return context;
            }

            // Relabel untyped damage parts from "Formula" to "Pure" and assign the pure damage icon
            const pureLabel = game.i18n?.localize?.("ND5T.DamageType.Pure") || "Pure";
            const pureIcon = "systems/dnd5e/icons/svg/damage/all.svg";
            for (const entry of context.rolls ?? []) {
                if (!entry.damageConfig && !entry.damageTypes) {
                    const rollType = (typeof entry.roll?.options?.type === "string") ? entry.roll.options.type.trim() : null;
                    const isUntyped = !rollType || rollType.toLowerCase() === "untyped" || rollType.toLowerCase() === "none" || rollType.toLowerCase() === "pure";
                    if (isUntyped) {
                        entry.damageConfig = {
                            label: pureLabel,
                            icon: pureIcon
                        };
                    } else {
                        entry.damageConfig = {
                            label: rollType.charAt(0).toUpperCase() + rollType.slice(1)
                        };
                    }
                }
            }

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
        },
        "WRAPPER"
    );

    // 3. Inject conditional checkboxes into _prepareConfigurationContext
    patchMethod(
        `${base}.prototype._prepareConfigurationContext`,
        async function(wrapped, context, options) {
            context = await wrapped(context, options);

            if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
                return context;
            }

            if (this.constructor.rollType && this.constructor.rollType !== CONFIG.Dice.DamageRoll) {
                return context;
            }

            const bonuses = this.config?._nd5tConditionalBonuses;
            if (!bonuses?.length) return context;

            context.fields ??= [];

            const bonusFields = bonuses.map(bonus => {
                let label = bonus.defaultLabel;
                if (bonus.labelKey && game.i18n?.has(bonus.labelKey)) {
                    label = game.i18n.format(bonus.labelKey, { formula: bonus.formulaDisplay ?? "", uses: bonus.usesLeft ?? "" });
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
        },
        "WRAPPER"
    );

    // 4. Update formula row DOM classes and disabled states on render
    patchMethod(
        `${base}.prototype._onRender`,
        async function(wrapped, context, options) {
            await wrapped(context, options);

            if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
            if (this.constructor.rollType && this.constructor.rollType !== CONFIG.Dice.DamageRoll) return;

            _updateFormulaRowStates(this);
            _applySneakAttackTooltip(this);
            _applyGeniesWrathTooltip(this);
            _applyBonusTooltips(this);
        },
        "WRAPPER"
    );

    // 5. Synchronize rolls in real time on form change (_onChangeForm) without layout shift
    patchMethod(
        `${base}.prototype._onChangeForm`,
        function(wrapped, formConfig, event) {
            if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")
                && (!this.constructor.rollType || this.constructor.rollType === CONFIG.Dice.DamageRoll)) {
                const bonuses = this.config?._nd5tConditionalBonuses;
                if (bonuses?.length && this.form) {
                    const formData = new foundry.applications.ux.FormDataExtended(this.form);
                    const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId && !r.options?._nd5tTypedBonus);
                    const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                    const baseProperties = baseRoll?.options?.properties ?? [];

                    // Dynamically resolve weapon damage type selected in the form
                    const rawType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                        || baseRoll?.options?.type;
                    const resolvedType = (typeof rawType === "string" && rawType.trim()) ? rawType.trim() : null;

                    // Resolve Cleave and Savage Attacker states upfront to prevent ordering race conditions
                    const isCleaveActive = bonuses.some(b => b.id === "cleave") && _getBonusToggleValue(this.form, formData, "cleave");
                    const isSavageActive = bonuses.some(b => b.id === "savageAttacker") && _getBonusToggleValue(this.form, formData, "savageAttacker");

                    if (baseRoll && (bonuses.some(b => b.id === "cleave") || bonuses.some(b => b.id === "savageAttacker"))) {
                        baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                        baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                        let currentParts = [...baseRoll._nd5tOriginalParts];
                        if (isSavageActive) {
                            currentParts = applySavageAttackerToParts(currentParts);
                            baseRoll.options ??= {};
                            baseRoll.options._nd5tSavageAttacker = true;
                        } else if (baseRoll.options?._nd5tSavageAttacker) {
                            delete baseRoll.options._nd5tSavageAttacker;
                        }

                        if (isCleaveActive) {
                            const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? 0;
                            if (abilityMod > 0) {
                                currentParts = removeAbilityModifierFromParts(currentParts);
                                if (baseRoll.data) baseRoll.data.mod = 0;
                            }
                        } else if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                            baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                        }

                        baseRoll.parts = currentParts;
                    }

                    for (const bonus of bonuses) {
                        const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);
                        bonus.active = isChecked;

                        if (bonus.id === "cleave" || bonus.id === "savageAttacker") {
                            continue;
                        }

                        const roll = (this.config.rolls ?? []).find(
                            r => r.options?._nd5tConditionalId === bonus.id
                        );

                        if (roll) {
                            if (isChecked) {
                                delete roll.options._nd5tInactive;
                            } else {
                                roll.options._nd5tInactive = true;
                            }

                            // Bonuses with a type dropdown (Genie's Wrath, Divine Strike …): keep the picked type, since a
                            // disabled (unticked) row's dropdown isn't in the form data
                            if (bonus.damageTypes?.length > 1) {
                                const pickedType = _getPickedRollType(this, formData, roll);
                                if (pickedType) {
                                    bonus.damageType = pickedType;
                                    roll.options.type = pickedType;
                                    if (roll.data?.roll) roll.data.roll.damageType = pickedType;
                                }
                            }

                            // Keep Sneak Attack, Great Weapon Master, Brutal Strike, Charger, and Boon of Irresistible Offense aligned with weapon damage type and properties
                            if (_matchesWeaponType(bonus)) {
                                bonus.damageType = resolvedType;
                                roll.options.type = resolvedType;
                                if (resolvedType) {
                                    roll.options.types = [resolvedType];
                                } else {
                                    delete roll.options.types;
                                }
                                if (roll.data?.roll) {
                                    roll.data.roll.damageType = resolvedType;
                                }
                                roll.options.properties = [...baseProperties];
                            }
                        }
                    }

                    _updateFormulaRowStates(this);
                }
            }

            return wrapped(formConfig, event);
        },
        "WRAPPER"
    );

    // 6. Finalize rolls and persist last user choice (_finalizeRolls)
    patchMethod(
        `${base}.prototype._finalizeRolls`,
        function(wrapped, action) {
            if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")
                && (!this.constructor.rollType || this.constructor.rollType === CONFIG.Dice.DamageRoll)) {
                const bonuses = this.config?._nd5tConditionalBonuses;
                if (bonuses?.length && this.form) {
                    const formData = new foundry.applications.ux.FormDataExtended(this.form);
                    const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId && !r.options?._nd5tTypedBonus);
                    const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                    const baseProperties = baseRoll?.options?.properties ?? [];

                    const rawType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                        || baseRoll?.options?.type;
                    const resolvedType = (typeof rawType === "string" && rawType.trim()) ? rawType.trim() : null;

                    // Resolve Cleave and Savage Attacker states upfront to prevent ordering race conditions
                    const isCleaveActive = bonuses.some(b => b.id === "cleave") && _getBonusToggleValue(this.form, formData, "cleave");
                    const isSavageActive = bonuses.some(b => b.id === "savageAttacker") && _getBonusToggleValue(this.form, formData, "savageAttacker");

                    if (baseRoll && (bonuses.some(b => b.id === "cleave") || bonuses.some(b => b.id === "savageAttacker"))) {
                        baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                        baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                        let currentParts = [...baseRoll._nd5tOriginalParts];
                        if (isSavageActive) {
                            currentParts = applySavageAttackerToParts(currentParts);
                            baseRoll.options ??= {};
                            baseRoll.options._nd5tSavageAttacker = true;
                        } else if (baseRoll.options?._nd5tSavageAttacker) {
                            delete baseRoll.options._nd5tSavageAttacker;
                        }

                        if (isCleaveActive) {
                            const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? 0;
                            if (abilityMod > 0) {
                                currentParts = removeAbilityModifierFromParts(currentParts);
                                if (baseRoll.data) baseRoll.data.mod = 0;
                            }
                        } else if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                            baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                        }

                        baseRoll.parts = currentParts;
                    }

                    for (const bonus of bonuses) {
                        const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);
                        bonus.active = isChecked;

                        if (bonus.id === "cleave" || bonus.id === "savageAttacker") {
                            if (bonus.id === "savageAttacker" && isChecked && bonus.turnKey) {
                                markBonusUsedThisTurn(bonus.actor, "savageAttacker", bonus.turnKey);
                            }
                            continue;
                        }

                        const roll = (this.config.rolls ?? []).find(
                            r => r.options?._nd5tConditionalId === bonus.id
                        );

                        if (roll) {
                            if (isChecked) {
                                delete roll.options._nd5tInactive;
                            } else {
                                roll.options._nd5tInactive = true;
                            }

                            if (_matchesWeaponType(bonus)) {
                                bonus.damageType = resolvedType;
                                roll.options.type = resolvedType;
                                if (resolvedType) {
                                    roll.options.types = [resolvedType];
                                } else {
                                    delete roll.options.types;
                                }
                                if (roll.data?.roll) {
                                    roll.data.roll.damageType = resolvedType;
                                }
                                roll.options.properties = [...baseProperties];
                            }

                            // Bonuses with a type dropdown: apply the picked type, and remember it where the bonus
                            // remembers its type (only when it's used)
                            if (bonus.damageTypes?.length > 1) {
                                const pickedType = _getPickedRollType(this, formData, roll);
                                if (pickedType) {
                                    bonus.damageType = pickedType;
                                    roll.options.type = pickedType;
                                    if (roll.data?.roll) roll.data.roll.damageType = pickedType;
                                    if (isChecked && bonus.rememberType) {
                                        setActorBonusType(bonus.actor, bonus.id, pickedType, bonus.damageTypes);
                                    }
                                }
                            }
                        }

                        // Record once-per-turn usage and spend the bonus's resource
                        if (isChecked && bonus.turnKey) {
                            markBonusUsedThisTurn(bonus.actor, bonus.usageId ?? bonus.id, bonus.turnKey);
                        }
                        if (isChecked && bonus.consume) _consumeBonusResource(bonus);

                        // Colossus Slayer: a choice made while the target qualified is remembered (Horde Breaker
                        // hunters untick it once)
                        if (bonus.rememberWhen && bonus.actor) {
                            setActorConditionalPreference(bonus.actor, bonus.id, isChecked);
                        }

                        // Persist selection so subsequent rolls remember it (exempt one-offs and turn-tracked bonuses).
                        // A Sneak Attack choice made against a detected result is a one-off too: the remembered
                        // choice is only the fallback for when eligibility can't be worked out.
                        const isTurnTracked = Boolean(bonus.turnKey)
                            || (bonus.id === "sneakAttack" && Boolean(bonus.eligibility) && bonus.eligibility.state !== "unknown");
                        if (bonus.actor && !isTurnTracked && !bonus.oneOff && bonus.id !== "cleave" && bonus.id !== "brutalStrike" && bonus.id !== "charger" && bonus.id !== "savageAttacker" && bonus.id !== "boonOfIrresistibleOffense" && bonus.id !== "geniesWrath") {
                            if (bonus.id === "greatWeaponMaster" && !isChecked) {
                                // GWM was disabled for this one roll (e.g. bonus action or reaction attack).
                                // Automatically reset it back to enabled for subsequent rolls so the player doesn't have to re-enable it.
                                setActorConditionalPreference(bonus.actor, bonus.id, true);
                            } else {
                                setActorConditionalPreference(bonus.actor, bonus.id, isChecked);
                            }
                        }
                    }

                    // Mark cached attack roll as rolled
                    const primaryActor = this.config.rolls?.[0]?.data?.actor
                        ?? bonuses[0]?.actor;
                    const actorKey = primaryActor?.uuid || primaryActor?.id;
                    if (actorKey) {
                        const cached = _lastAttackRollsByActor.get(actorKey);
                        if (cached) cached.damageRolled = true;
                    }
                }
            }

            const allRolls = wrapped(action);
            if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")
                && (!this.constructor.rollType || this.constructor.rollType === CONFIG.Dice.DamageRoll)) {
                return (allRolls ?? []).filter(r => !r.options?._nd5tInactive);
            }
            return allRolls;
        },
        "WRAPPER"
    );

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
        _recordAttackRoll(actor, roll, {
            activityId: subject?.id,
            itemId: subject?.item?.id,
            targets: Array.from(game.user?.targets ?? [], t => t.document?.uuid)
        });
    });

    Hooks.on("createChatMessage", (message) => {
        const rollType = message.getFlag?.("dnd5e", "roll.type") ?? message.flags?.dnd5e?.roll?.type;
        const isAttack = rollType === "attack"
            || message.type === "attack"
            || message.system?.constructor?.name === "AttackMessageData";
        if (isAttack && message.rolls?.length) {
            const actor = (typeof message.getAssociatedActor === "function" ? message.getAssociatedActor() : null)
                ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null)
                ?? (message.speaker ? ChatMessage.getSpeakerActor?.(message.speaker) : null);
            if (actor) {
                const actorKey = actor.uuid || actor.id;
                const existing = _lastAttackRollsByActor.get(actorKey);
                const activityId = message.getAssociatedActivity?.()?.id
                    ?? message.getFlag?.("dnd5e", "activity.id")
                    ?? existing?.activityId;
                const itemId = message.getAssociatedItem?.()?.id
                    ?? message.getFlag?.("dnd5e", "item.id")
                    ?? existing?.itemId;
                const targets = (message.system?.targets ?? []).map(t => t?.token).filter(Boolean);
                _recordAttackRoll(actor, message.rolls[0], {
                    activityId,
                    itemId,
                    messageId: message.id,
                    targets: targets.length ? targets : existing?.targets
                });
            }
        }
    });

    // Mark cached attack rolls as having rolled damage when a damage roll is executed
    Hooks.on("dnd5e.rollDamage", (rolls, { subject } = {}) => {
        const actor = subject?.actor
            ?? rolls?.[0]?.data?.actor
            ?? (rolls?.[0]?.options?.actor ? game.actors?.get(rolls[0].options.actor) : null)
            ?? (typeof rolls?.[0]?.parent?.getAssociatedActor === "function" ? rolls[0].parent.getAssociatedActor() : null);
        if (!actor) return;
        const actorKey = actor.uuid || actor.id;
        const cached = _lastAttackRollsByActor.get(actorKey);
        if (cached) cached.damageRolled = true;
    });

    // Clean up combat turn usage tracking and combat attack cache when a combat encounter is removed
    Hooks.on("deleteCombat", (combat) => {
        clearCombatTurnUsage(combat?.id);
        if (combat?.id) {
            for (const [key, entry] of _lastAttackRollsByActor.entries()) {
                if (entry.combatId === combat.id) {
                    _lastAttackRollsByActor.delete(key);
                }
            }
        }
    });

    // Periodically prune stale attacks as combat turns or rounds progress
    Hooks.on("combatTurn", () => _pruneStaleAttackRolls());
    Hooks.on("combatRound", () => _pruneStaleAttackRolls());

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
