/**
 * Conditional Damage Bonuses (Hex, Hunter's Mark & Sneak Attack)
 *
 * Offers toggles in damage roll configuration dialogs when an actor is actively
 * concentrating on Hex or Hunter's Mark, or when an actor attacks with a ranged or
 * finesse weapon (applying their native Sneak Attack scale value).
 * Remembers the user's last selection on the actor so it remains enabled across
 * multiple attack rolls against that target and can be toggled off when attacking another creature.
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
        defaultLabel: "Hex\n(+1d6 Necrotic)",
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
        defaultLabel: "Hunter's Mark\n(+1d6 Force)",
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
    if (!actor) return defaultVal;
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
    if (!actor) return;
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

    // --- 2. Sneak Attack (Rogue class scale value on ranged or finesse weapon) ---
    const rogueData = getRogueData(actor);
    if (rogueData && isEligibleSneakAttackWeapon(item, activity)) {
        // Match the weapon's base damage type for sneak attack
        const baseDamageType = config?.rolls?.[0]?.options?.type
            ?? config?.rolls?.[0]?.options?.types?.[0]
            ?? item?.system?.damage?.base?.types?.first?.()
            ?? item?.system?.damage?.base?.type
            ?? activity?.damage?.parts?.[0]?.types?.first?.()
            ?? "piercing";

        activeBonuses.push({
            id: "sneakAttack",
            spellName: "Sneak Attack",
            formula: `${rogueData.formula}[Sneak Attack]`,
            formulaDisplay: rogueData.formula,
            damageType: baseDamageType,
            flavor: "Sneak Attack",
            labelKey: "ND5T.ConditionalDamage.SneakAttack.Label",
            defaultLabel: `Sneak Attack\n(+${rogueData.formula})`,
            defaultActive: true
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
        const lastChoice = getActorConditionalPreference(actor, def.id, def.defaultActive);
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

    // For any bonus that is currently active, add the roll configuration upfront.
    // This ensures fast-forward rolls (holding Shift / dialog.configure === false)
    // honor the actor's last chosen state, critical mode, and weapon properties.
    config.rolls ??= [];
    for (const bonus of config._nd5tConditionalBonuses) {
        if (!bonus.active) continue;

        const alreadyPresent = config.rolls.some(r => r.options?._nd5tConditionalId === bonus.id);
        if (!alreadyPresent) {
            const properties = bonus.id === "sneakAttack" ? baseProperties : [];
            config.rolls.push(createConditionalRollConfig(bonus, baseRollData, { isCritical, properties }));
        }
    }
}

let _isDialogPatched = false;

/**
 * Patch DamageRollConfigurationDialog to display conditional damage toggles,
 * synchronize rolls in real time, and persist user preferences.
 */
function _patchDamageRollConfigurationDialog() {
    if (_isDialogPatched) return;
    const DialogClass = CONFIG.Dice?.DamageRoll?.DefaultConfigurationDialog;
    if (!DialogClass) return;

    // 1. Inject conditional checkboxes into _prepareConfigurationContext
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

            // Ensure the line break is cleanly placed between the bonus name and the formula in parentheses
            const match = label.match(/^(.*?)\s*(\([^)]+\))$/);
            if (match) {
                const titlePart = match[1].trim().replace(/ /g, "\u00A0");
                const bonusPart = match[2].trim().replace(/ /g, "\u00A0");
                label = `${titlePart}\n${bonusPart}`;
            }

            const isCurrentlyInRolls = (this.config.rolls ?? []).some(
                r => r.options?._nd5tConditionalId === bonus.id
            );

            return {
                field: new foundry.data.fields.BooleanField({
                    label,
                    required: false,
                    initial: bonus.defaultActive
                }),
                name: `nd5t.conditional.${bonus.id}`,
                value: isCurrentlyInRolls
            };
        });

        // Prepend bonus fields while maintaining their stable definition order
        context.fields.unshift(...bonusFields);

        return context;
    };

    // 2. Synchronize rolls in real time on form change (_onChangeForm)
    const origOnChangeForm = DialogClass.prototype._onChangeForm;
    DialogClass.prototype._onChangeForm = function(formConfig, event) {
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            const bonuses = this.config?._nd5tConditionalBonuses;
            if (bonuses?.length && this.form) {
                const formData = new foundry.applications.ux.FormDataExtended(this.form);
                const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId);
                const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                const baseRollData = baseRoll?.data ?? {};
                const baseProperties = baseRoll?.options?.properties ?? [];
                const isCritical = Boolean(this.config?.isCritical);

                // Dynamically resolve weapon damage type selected in the form
                const selectedBaseType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                    || baseRoll?.options?.type;

                for (const bonus of bonuses) {
                    const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);
                    const rollIndex = (this.config.rolls ?? []).findIndex(
                        r => r.options?._nd5tConditionalId === bonus.id
                    );

                    // Keep Sneak Attack aligned with weapon damage type and properties
                    if (bonus.id === "sneakAttack" && selectedBaseType) {
                        bonus.damageType = selectedBaseType;
                        if (rollIndex >= 0 && this.config.rolls[rollIndex]) {
                            this.config.rolls[rollIndex].options.type = selectedBaseType;
                            if (this.config.rolls[rollIndex].data?.roll) {
                                this.config.rolls[rollIndex].data.roll.damageType = selectedBaseType;
                            }
                            this.config.rolls[rollIndex].options.properties = [...baseProperties];
                        }
                    }

                    if (isChecked && rollIndex < 0) {
                        const properties = bonus.id === "sneakAttack" ? baseProperties : [];
                        this.config.rolls.push(createConditionalRollConfig(bonus, baseRollData, { isCritical, properties }));
                        bonus.active = true;
                    } else if (!isChecked && rollIndex >= 0) {
                        this.config.rolls.splice(rollIndex, 1);
                        bonus.active = false;
                    }
                }
            }
        }

        return origOnChangeForm.call(this, formConfig, event);
    };

    // 3. Finalize rolls and persist last user choice (_finalizeRolls)
    const origFinalizeRolls = DialogClass.prototype._finalizeRolls;
    DialogClass.prototype._finalizeRolls = function(action) {
        if (isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) {
            const bonuses = this.config?._nd5tConditionalBonuses;
            if (bonuses?.length && this.form) {
                const formData = new foundry.applications.ux.FormDataExtended(this.form);
                const baseIndex = (this.config.rolls ?? []).findIndex(r => !r.options?._nd5tConditionalId);
                const baseRoll = baseIndex >= 0 ? this.config.rolls[baseIndex] : this.config.rolls?.[0];
                const baseRollData = baseRoll?.data ?? {};
                const baseProperties = baseRoll?.options?.properties ?? [];
                // If action is passed, clicking "Normal" explicitly turns off critical mode
                const isCritical = action ? (action === "critical") : Boolean(this.config?.isCritical);

                const selectedBaseType = (baseIndex >= 0 ? formData.get(`roll.${baseIndex}.damageType`) : null)
                    || baseRoll?.options?.type;

                for (const bonus of bonuses) {
                    const isChecked = _getBonusToggleValue(this.form, formData, bonus.id);
                    const rollIndex = (this.config.rolls ?? []).findIndex(
                        r => r.options?._nd5tConditionalId === bonus.id
                    );

                    if (bonus.id === "sneakAttack" && selectedBaseType) {
                        bonus.damageType = selectedBaseType;
                        if (rollIndex >= 0 && this.config.rolls[rollIndex]) {
                            this.config.rolls[rollIndex].options.type = selectedBaseType;
                            if (this.config.rolls[rollIndex].data?.roll) {
                                this.config.rolls[rollIndex].data.roll.damageType = selectedBaseType;
                            }
                            this.config.rolls[rollIndex].options.properties = [...baseProperties];
                        }
                    }

                    if (isChecked && rollIndex < 0) {
                        const properties = bonus.id === "sneakAttack" ? baseProperties : [];
                        this.config.rolls.push(createConditionalRollConfig(bonus, baseRollData, { isCritical, properties }));
                    } else if (!isChecked && rollIndex >= 0) {
                        this.config.rolls.splice(rollIndex, 1);
                    }

                    bonus.active = isChecked;

                    // Persist selection so subsequent rolls remember it
                    if (bonus.actor) {
                        setActorConditionalPreference(bonus.actor, bonus.id, isChecked);
                    }
                }
            }
        }

        return origFinalizeRolls.call(this, action);
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
