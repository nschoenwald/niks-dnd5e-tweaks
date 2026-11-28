/**
 * Conditional Damage Bonuses: The toggles, dropdowns and tooltips in the damage roll configuration dialog.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { isFeatureActive, log } from "../../../context.js";
import { patchMethod } from "../../../utils/patch-helper.js";
import { lastAttackRollsByActor } from "./attack-cache.js";
import { markBonusUsedThisTurn } from "./combat-turn.js";
import { applySavageAttackerToParts, removeAbilityModifierFromParts } from "./core-bonuses.js";
import { consumeBonusResource, matchesWeaponType, usesText } from "./feature-helpers.js";
import { setActorBonusType, setActorConditionalPreference } from "./preferences.js";
import { ensureAllConditionalRollsInConfig } from "./roll-hooks.js";

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
export function patchDamageRollConfigurationDialog() {
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
                ensureAllConditionalRollsInConfig(config);
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
                    label = game.i18n.format(bonus.labelKey, { formula: bonus.formulaDisplay ?? "", uses: usesText(bonus) });
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

                const isCurrentlyInRolls = (bonus.isMalus || bonus.isWeaponModifier)
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

                        if (bonus.isMalus || bonus.isWeaponModifier) {
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
                            if (matchesWeaponType(bonus)) {
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

                        if (bonus.isMalus || bonus.isWeaponModifier) {
                            // Savage Attacker, Perfect Poisoner: once per turn
                            if (bonus.isWeaponModifier && isChecked && bonus.turnKey) {
                                markBonusUsedThisTurn(bonus.actor, bonus.usageId ?? bonus.id, bonus.turnKey);
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

                            if (matchesWeaponType(bonus)) {
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
                        if (isChecked && bonus.consume) consumeBonusResource(bonus);

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
                        const cached = lastAttackRollsByActor.get(actorKey);
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
