/**
 * Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, Great Weapon Master & Cleave)
 *
 * Offers toggles in damage roll configuration dialogs when an actor is actively
 * concentrating on Hex or Hunter's Mark, attacks with a ranged or finesse weapon (Sneak Attack),
 * attacks with a Heavy weapon under 2024 rules with Great Weapon Master (+PB bonus flavored with GWM),
 * or attacks with a Cleave mastery weapon (damage malus removing ability score modifier unless negative).
 * Remembers choices per actor (except Cleave, which is disabled by default and strictly one-off).
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
 * @returns {boolean}
 */
export function isEligibleSneakAttackWeapon(item, activity = null) {
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

    // 3. Ranged attack activity classification (e.g. rwak) for non-melee weapons
    const actionType = activity?.actionType ?? item.system?.actionType;
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

    // Check weapon mastery property
    const hasCleave = item.system?.mastery === "cleave"
        || (Array.isArray(item.system?.masteryOptions) && item.system.masteryOptions.some(m => m.value === "cleave"));
    return Boolean(hasCleave);
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
    if (!actor || bonusId === "cleave") return false;
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
    if (!actor || bonusId === "cleave") return;
    const key = actor.uuid || actor.id;

    // Update in-memory cache immediately
    const existingMem = _actorChoiceMemory.get(key) ?? {};
    existingMem[bonusId] = Boolean(active);
    _actorChoiceMemory.set(key, existingMem);

    // Persist to document flag if actor is editable / owned
    try {
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
export function getActiveConditionalBonuses(actor, { item = null, activity = null, config = null } = {}) {
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

        // Check official DnD5e concentration items set (Actor#concentration.items)
        let hasMatch = Array.from(concentrationItems).some(cItem => {
            const itemName = (cItem.name || "").toLowerCase();
            const itemIdentifier = (cItem.identifier || cItem.system?.identifier || "").toLowerCase();
            const sourceId = (cItem.flags?.core?.sourceId || cItem._stats?.compendiumSource || "").toLowerCase();
            const cleanIdentifier = itemIdentifier.replace(/[-_]/g, "");
            const cleanSourceId = sourceId.replace(/[-_]/g, "");

            return itemName.includes(targetSpell)
                || (defSlug && (itemIdentifier.includes(defSlug) || sourceId.includes(defSlug)))
                || cleanIdentifier.includes(defId)
                || cleanSourceId.includes(defId);
        });

        // Check applied active effects on the actor
        if (!hasMatch && effects.length) {
            hasMatch = effects.some(e => {
                if (e.disabled || e.isSuppressed) return false;
                const name = (e.name || "").trim().toLowerCase();
                if (def.effectMatch.test(name)) return true;

                // Support localized "Concentrating: <Spell>"
                if (name.startsWith(localizedConcentrating) && name.endsWith(targetSpell)) return true;

                const cleanName = name.replace(/[-_]/g, "");
                if (defSlug && name.includes(defSlug)) return true;
                if (cleanName.includes(defId)) return true;

                // Support special status effect concentrating where name or description matches spell
                if (e.statuses?.has("concentrating") || e.statuses?.has(CONFIG.specialStatusEffects?.CONCENTRATING)) {
                    if (name.includes(targetSpell)) return true;
                    const itemFlag = e.getFlag?.("dnd5e", "item");
                    if (itemFlag) {
                        const flagName = (itemFlag.data?.name || itemFlag.name || "").toLowerCase();
                        const flagId = (itemFlag.data?.identifier || itemFlag.identifier || "").toLowerCase();
                        if (flagName.includes(targetSpell) || (defSlug && flagId.includes(defSlug))) return true;
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

    // --- 2. Sneak Attack (Rogue class scale value on ranged or finesse weapon) ---
    const rogueData = getRogueData(actor);
    if (rogueData && isEligibleSneakAttackWeapon(item, activity)) {
        activeBonuses.push({
            id: "sneakAttack",
            spellName: "Sneak Attack",
            formula: `${rogueData.formula}[Sneak Attack]`,
            formulaDisplay: rogueData.formula,
            damageType: baseDamageType,
            flavor: "Sneak Attack",
            labelKey: "ND5T.ConditionalDamage.SneakAttack.Label",
            defaultLabel: `Sneak Attack (+${rogueData.formula})`,
            defaultActive: true
        });
    }

    // --- 3. Great Weapon Master (2024 Modern Rules: +PB damage on heavy weapons) ---
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

    if (def.formulaDisplay && !isNaN(Number(def.formulaDisplay))) {
        if (data.prof === undefined || def.id === "greatWeaponMaster") {
            data.prof = Number(def.formulaDisplay);
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
function _onPreRollDamage(config, dialog, message) {
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
        ?? dialog.options?.actor
        ?? (config.subject?.item?.actor)
        ?? (config.rolls?.[0]?.data?.actor)
        ?? null;
    if (!actor) return;

    // Resolve the item being rolled
    const item = config.subject?.item
        ?? (config.rolls?.[0]?.data?.item instanceof Item ? config.rolls[0].data.item : null)
        ?? (actor.items?.get(config.rolls?.[0]?.data?.item?.id ?? config.rolls?.[0]?.data?.item?._id))
        ?? null;

    // Detect active conditional bonuses (Hex, Hunter's Mark, Sneak Attack)
    const activeDefs = getActiveConditionalBonuses(actor, { item, activity: config.subject, config });
    if (!activeDefs.length) return;

    // Prepare bonus metadata on the process configuration
    config._nd5tConditionalBonuses = activeDefs.map(def => {
        const lastChoice = def.id === "cleave" ? false : getActorConditionalPreference(actor, def.id, def.defaultActive);
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
    }

    // For any bonus that is currently active, add the roll configuration upfront.
    // This ensures fast-forward rolls (holding Shift / dialog.configure === false)
    // honor the actor's last chosen state, critical mode, and weapon properties.
    config.rolls ??= [];
    for (const bonus of config._nd5tConditionalBonuses) {
        if (!bonus.active || bonus.isMalus) continue;

        const alreadyPresent = config.rolls.some(r => r.options?._nd5tConditionalId === bonus.id);
        if (!alreadyPresent) {
            const properties = (bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster") ? baseProperties : [];
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
        if (bonus.isMalus) continue;

        let rollConfig = config.rolls.find(r => r.options?._nd5tConditionalId === bonus.id);
        if (!rollConfig) {
            const properties = (bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster") ? baseProperties : [];
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
                if (!(term instanceof foundry.dice.terms.DiceTerm)) continue;
                if (!Number.isFinite(term.number) || !Number.isFinite(term.faces)) {
                    shouldDisplay = false;
                    break;
                }
                if (!denominations.has(term.denomination)) {
                    shouldDisplay = false;
                    break;
                }
                for (let i = 0; i < term.number; i++) {
                    dice.push({
                        icon: `systems/dnd5e/icons/svg/dice/${term.denomination}.svg`,
                        label: term.denomination,
                        denomination: term.denomination
                    });
                }
            }
            if (!shouldDisplay) break;
        }
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

            const isCurrentlyInRolls = bonus.id === "cleave"
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

                    if (bonus.id === "cleave") {
                        bonus.active = isChecked;
                        if (baseRoll) {
                            baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                            baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                            const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? bonus.modValue ?? 0;
                            if (isChecked) {
                                if (abilityMod > 0) {
                                    baseRoll.parts = removeAbilityModifierFromParts(baseRoll._nd5tOriginalParts);
                                    if (baseRoll.data) baseRoll.data.mod = 0;
                                }
                            } else {
                                baseRoll.parts = [...baseRoll._nd5tOriginalParts];
                                if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                                    baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                                }
                            }
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

                        // Keep Sneak Attack and Great Weapon Master aligned with weapon damage type and properties
                        if ((bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster") && selectedBaseType) {
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

                    if (bonus.id === "cleave") {
                        bonus.active = isChecked;
                        if (baseRoll) {
                            baseRoll._nd5tOriginalParts ??= [...(baseRoll.parts ?? [])];
                            baseRoll._nd5tOriginalMod ??= baseRoll.data?.mod;

                            const abilityMod = baseRoll._nd5tOriginalMod ?? baseRoll.data?.mod ?? bonus.modValue ?? 0;
                            if (isChecked) {
                                if (abilityMod > 0) {
                                    baseRoll.parts = removeAbilityModifierFromParts(baseRoll._nd5tOriginalParts);
                                    if (baseRoll.data) baseRoll.data.mod = 0;
                                }
                            } else {
                                baseRoll.parts = [...baseRoll._nd5tOriginalParts];
                                if (baseRoll._nd5tOriginalMod !== undefined && baseRoll.data) {
                                    baseRoll.data.mod = baseRoll._nd5tOriginalMod;
                                }
                            }
                        }
                        // Cleave is strictly never remembered across rolls
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

                        if ((bonus.id === "sneakAttack" || bonus.id === "greatWeaponMaster") && selectedBaseType) {
                            bonus.damageType = selectedBaseType;
                            roll.options.type = selectedBaseType;
                            if (roll.data?.roll) {
                                roll.data.roll.damageType = selectedBaseType;
                            }
                            roll.options.properties = [...baseProperties];
                        }
                    }

                    // Persist selection so subsequent rolls remember it
                    if (bonus.actor && bonus.id !== "cleave") {
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
