/**
 * Area Spell Automation: Adding the behavior when an area is placed, the upcast choice, and ignoring creatures already inside.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, getSetting, debug } from "../../../context.js";
import { getConcentrationEffect, getEmanationBehaviors, hasActivityBehavior, isListedSpell, notifyOnce, resolveDamageActivity } from "./activity.js";
import { DAMAGE_EMANATION_BEHAVIOR_TYPE, SUPPRESSED_ENTER_TTL_MS, UPCAST_CHOICE_KEY, getProfile } from "./config.js";
import { clearBehaviorState, suppressedEnters } from "./state.js";

/**
 * Make sure casting a listed spell places its emanation, even when the activity has template
 * placement turned off (e.g. Yolande's Regal Presence "Surround Self"). Without the template
 * region there is nothing to trigger from. The usage dialog still lets the caster untick it.
 * @param {Activity} activity
 * @param {object} usageConfig
 */
export function onPreUseActivity(activity, usageConfig) {
    if (!getSetting("enableDamageEmanation")) return;
    if (usageConfig?.nd5tDamageEmanation) return;
    // Remember the usage config of casts that place the area: the usage dialog writes the upcast choice into it
    if (usageConfig && activity?.target?.template?.type && getProfile(activity.item).upcastChoice) {
        _upcastUsages.set(activity.item.uuid, usageConfig);
    }
    if (!usageConfig?.create || (usageConfig.create.measuredTemplate !== false)) return;
    if (!activity?.target?.template?.type || !activity.consumption?.spellSlot) return;
    if (!isListedSpell(activity.item)) return;
    usageConfig.create.measuredTemplate = true;
    debug(`Area Spells | Enabled template placement for "${activity.item.name}" (${activity.name})`);
}

/**
 * Usage config of the latest area-placing cast of spells with an upcast choice, by item uuid. Kept after the cast,
 * so an area placed later from the chat card uses the same choice.
 * @type {Map<string, object>}
 */
const _upcastUsages = new Map();

/**
 * The behavior activities a caster can give the upcast bonus to: those whose damage scales with the slot level.
 * A version without scaling damage (the 2014 Hunger of Hadar) offers none, so no choice is shown.
 * @param {Item5e} item
 * @returns {Activity[]}
 */
function _getUpcastChoices(item) {
    const profile = getProfile(item);
    if (!profile.upcastChoice || !profile.behaviors) return [];
    const activities = Array.from(item?.system?.activities ?? []);
    return profile.behaviors.map(entry => activities.find(a => entry.activityName.test(a.name ?? "")))
        .filter(a => a && _hasScalingDamage(a));
}

/**
 * Whether any damage part of an activity grows with the spell slot level (dnd5e's damage scaling mode is set).
 * @param {Activity} activity
 * @returns {boolean}
 */
function _hasScalingDamage(activity) {
    return (activity.damage?.parts ?? []).some(p => p.scaling?.mode && (p.scaling.number || p.scaling.formula));
}

/**
 * Label of an upcast choice: its damage types, then the activity name ("Cold (Start of Turn Damage)").
 * @param {Activity} activity
 * @returns {string}
 */
function _getUpcastChoiceLabel(activity) {
    const types = new Set((activity.damage?.parts ?? []).flatMap(p => Array.from(p.types ?? [])));
    const labels = [...types].map(t => CONFIG.DND5E.damageTypes?.[t]?.label ?? t).filter(Boolean);
    return labels.length ? `${labels.join(", ")} (${activity.name})` : activity.name;
}

/**
 * Add a choice to the usage dialog of spells where only one damage gets the upcast bonus, shown once the chosen
 * slot is above the spell's level. dnd5e merges every field of its form into the usage config.
 * @param {ActivityUsageDialog} app
 * @param {HTMLElement} element
 */
export function onRenderUsageDialog(app, element) {
    if (!getSetting("enableDamageEmanation")) return;
    const activity = app.activity;
    const item = activity?.item;
    const config = app.config;
    if (!config || config.nd5tDamageEmanation || !activity?.target?.template?.type) return;
    if (!isListedSpell(item) || hasActivityBehavior(activity)) return;
    const choices = _getUpcastChoices(item);
    if (choices.length < 2) return;

    const slotLevel = activity.actor?.system.spells?.[config.spell?.slot]?.level;
    const scaling = Number.isFinite(slotLevel) ? (slotLevel - item.system.level) : (config.scaling || 0);
    const fieldset = element.querySelector('[data-application-part="scaling"] fieldset');
    if (!(scaling > 0) || !fieldset || fieldset.querySelector(`[name="${UPCAST_CHOICE_KEY}"]`)) return;

    const value = choices.some(a => a.id === config[UPCAST_CHOICE_KEY]) ? config[UPCAST_CHOICE_KEY] : choices[0].id;
    const label = game.i18n.has("ND5T.DamageEmanation.UpcastChoice")
        ? game.i18n.localize("ND5T.DamageEmanation.UpcastChoice") : "Upcast Damage";
    const group = document.createElement("div");
    group.classList.add("form-group");
    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    const fields = document.createElement("div");
    fields.classList.add("form-fields");
    const select = document.createElement("select");
    select.name = UPCAST_CHOICE_KEY;
    for (const choice of choices) {
        const option = document.createElement("option");
        option.value = choice.id;
        option.textContent = _getUpcastChoiceLabel(choice);
        option.selected = choice.id === value;
        select.append(option);
    }
    fields.append(select);
    group.append(labelEl, fields);
    fieldset.append(group);
    config[UPCAST_CHOICE_KEY] = value;
}

/**
 * Add the Area Spell Trigger behavior to template regions of listed spells before they are created.
 * Runs on the casting client; `activity` is the scaled clone used for this cast.
 *
 * Core only lets GMs create a Region that already has behaviors (`BaseRegion.#canCreate`), whatever the player's
 * Region permission, and only GMs can create RegionBehaviors. A player's template therefore carries the behavior
 * data in a flag instead, and the active GM attaches it once the region exists (`_attachPendingBehavior`), the way
 * dnd5e attaches its own activity behaviors (`UtilityActivity.placeTemplateBehaviors`).
 * @param {Activity} activity
 * @param {object[]} regionData
 */
export function onCreateMeasuredTemplate(activity, regionData) {
    if (!getSetting("enableDamageEmanation")) return;
    const item = activity?.item;
    if (!isListedSpell(item) || hasActivityBehavior(activity)) return;

    const damageActivity = resolveDamageActivity(item, activity);
    if (!damageActivity) {
        debug(`Area Spells | "${item.name}" is listed but has no save or damage activity`);
        notifyOnce(`noActivity:${item.uuid}`, "ND5T.DamageEmanation.NoTriggerActivity", { spell: item.name },
            `${item.name} is on the Area Spells list but has no save or damage activity, so its area isn't automated.`);
        return;
    }
    const profile = getProfile(item);
    if (profile.requirePlacingActivity && (damageActivity.id !== activity.id)) {
        debug(`Area Spells | "${item.name}" (${activity.name}) places an area without the trigger`);
        return;
    }

    const scaling = _getUsageScaling(activity);
    const drift = profile.drift ?? 0;
    const charges = profile.charges ? Math.max(0, profile.charges(scaling)) : null;
    const name = game.i18n.localize(`TYPES.RegionBehavior.${DAMAGE_EMANATION_BEHAVIOR_TYPE}`);
    const behaviorData = [];
    if (profile.behaviors) {
        const activities = Array.from(item.system.activities ?? []);
        // Only one behavior gets the upcast bonus (Hunger of Hadar): the caster's choice, otherwise the first
        let upcastId = null;
        if (profile.upcastChoice && (scaling > 0)) {
            const choices = _getUpcastChoices(item);
            const chosen = _upcastUsages.get(item.uuid)?.[UPCAST_CHOICE_KEY];
            // Fewer than two scaling damages: nothing to choose, every behavior keeps the cast level
            if (choices.length > 1) upcastId = choices.find(a => a.id === chosen)?.id ?? choices[0].id;
        }
        for (const entry of profile.behaviors) {
            const entryActivity = activities.find(a => entry.activityName.test(a.name ?? ""));
            if (!entryActivity) continue;
            const entryScaling = (upcastId && (entryActivity.id !== upcastId)) ? 0 : scaling;
            behaviorData.push({
                type: DAMAGE_EMANATION_BEHAVIOR_TYPE,
                name: `${name} (${entryActivity.name})`,
                system: { activity: entryActivity.uuid, scaling: entryScaling, drift, triggers: [...entry.triggers] }
            });
        }
        if (upcastId) debug(`Area Spells | "${item.name}": the upcast bonus goes to ${activities.find(a => a.id === upcastId)?.name}`);
    }
    if (!behaviorData.length) {
        behaviorData.push({
            type: DAMAGE_EMANATION_BEHAVIOR_TYPE,
            name,
            system: { activity: damageActivity.uuid, scaling, drift, charges }
        });
    }
    if (!game.user.isGM && !game.users?.activeGM) {
        ui.notifications?.warn(game.i18n.has("ND5T.DamageEmanation.NoGM")
            ? game.i18n.format("ND5T.DamageEmanation.NoGM", { spell: item.name })
            : `${item.name}: Area Spell Automation needs a GM online to set up the area. The area isn't automated this time.`);
        return;
    }
    for (const data of regionData) {
        // Lets a lost activity be found again on the caster (spell removed and added back, replaced by another version)
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.emanationItem`, { identifier: item.system?.identifier ?? "", name: item.name });
        if (game.user.isGM) {
            data.behaviors = [...(data.behaviors ?? []), ...foundry.utils.deepClone(behaviorData)];
        } else {
            foundry.utils.setProperty(data, `flags.${MODULE_ID}.pendingEmanation`, foundry.utils.deepClone(behaviorData));
        }
    }
    debug(`Area Spells | Added ${behaviorData.length} behavior(s) to "${item.name}" template (scaling: ${scaling}${charges !== null ? `, ${charges} uses` : ""})`);
}

/**
 * Determine how many levels above its base level a spell is being cast.
 * @param {Activity} activity  The scaled activity clone used for the cast.
 * @returns {number}
 */
function _getUsageScaling(activity) {
    const itemScaling = Number(activity.item?.getFlag("dnd5e", "scaling"));
    if (Number.isFinite(itemScaling)) return Math.max(0, itemScaling);
    const concentrationScaling = Number(getConcentrationEffect(activity.actor, activity.item)?.getFlag("dnd5e", "scaling"));
    return Number.isFinite(concentrationScaling) ? Math.max(0, concentrationScaling) : 0;
}

/**
 * Remember the tokens inside a newly created region with an Area Spell Trigger behavior.
 * @param {RegionDocument} region
 */
export function onCreateRegion(region) {
    for (const behavior of getEmanationBehaviors(region)) _suppressTokensInside(behavior);
    _attachPendingBehavior(region);
}

/**
 * Active GM: attach the Area Spell Trigger behavior a player's template carries in its flags (players can't create
 * regions with behaviors). The tokens inside are remembered by `onCreateRegionBehavior`.
 * @param {RegionDocument} region
 */
async function _attachPendingBehavior(region) {
    if (!game.user.isActiveGM) return;
    const flag = region.getFlag?.(MODULE_ID, "pendingEmanation");
    const pending = (Array.isArray(flag) ? flag : [flag]).filter(b => b?.type);
    if (!pending.length) return;
    try {
        if (!getEmanationBehaviors(region).length) {
            await region.createEmbeddedDocuments("RegionBehavior", pending);
            debug(`Area Spells | Attached behavior to "${region.name}" for a player's template`);
        }
        await region.unsetFlag(MODULE_ID, "pendingEmanation");
    } catch (err) {
        console.error(`${MODULE_ID} | Area Spells: could not attach the behavior to "${region.name}"`, err);
    }
}

/**
 * Remember the tokens inside a region that was revealed. Foundry fires "enter" events for them,
 * but the emanation didn't move.
 * @param {RegionDocument} region
 * @param {object} changes
 */
export function onUpdateRegion(region, changes) {
    if (changes.hidden !== false) return;
    for (const behavior of getEmanationBehaviors(region)) _suppressTokensInside(behavior);
}

/**
 * Same for emanations attached to a token that was revealed. Since Foundry 14.371 revealing the token doesn't update
 * the attached region; core fires the "enter" events right after this hook (`RegionDocument._onHiddenChange`).
 * @param {TokenDocument} token
 * @param {object} changes
 */
export function onUpdateToken(token, changes) {
    if (changes.hidden !== false) return;
    for (const region of token.attachments?.regions ?? []) {
        if (region.hidden) continue;
        for (const behavior of getEmanationBehaviors(region)) _suppressTokensInside(behavior);
    }
}

/**
 * Drop the client-side state of a deleted region's emanations.
 * @param {RegionDocument} region
 */
export function onDeleteRegion(region) {
    for (const behavior of getEmanationBehaviors(region)) clearBehaviorState(behavior.uuid);
}

/**
 * Remember the tokens inside the region when the behavior is added to an existing region
 * (e.g. by dnd5e's activity behaviors after the template was created).
 * @param {RegionBehavior} behavior
 */
export function onCreateRegionBehavior(behavior) {
    if (behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) _suppressTokensInside(behavior);
}

/**
 * Remember the tokens inside the region when the behavior is enabled again. Foundry fires "enter"
 * events for them, but the emanation didn't move.
 * @param {RegionBehavior} behavior
 * @param {object} changes
 */
export function onUpdateRegionBehavior(behavior, changes) {
    if ((behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) && (changes.disabled === false)) {
        _suppressTokensInside(behavior);
    }
}

/**
 * Drop the client-side state of a deleted emanation behavior.
 * @param {RegionBehavior} behavior
 */
export function onDeleteRegionBehavior(behavior) {
    if (behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) clearBehaviorState(behavior.uuid);
}

/**
 * Ignore the "enter" event of a token created inside an emanation (e.g. a summoned creature):
 * it appeared there, it didn't enter and the emanation didn't move onto it.
 * @param {TokenDocument} token
 */
export function onCreateToken(token) {
    for (const region of token.regions ?? []) {
        for (const behavior of getEmanationBehaviors(region)) _suppressEnter(behavior, [token.id]);
    }
}

/**
 * Record which tokens are inside the emanation when it appears (created, enabled or revealed).
 * Their "enter" events are ignored: on creation the casting activity handles them, otherwise the
 * emanation simply didn't move.
 * @param {RegionBehavior} behavior
 */
function _suppressTokensInside(behavior) {
    const region = behavior.region ?? behavior.parent;
    const scene = region?.parent;
    if (!scene) return;
    const tokenIds = [];
    for (const token of scene.tokens) {
        try {
            if (token.regions?.has(region) || token.testInsideRegion(region)) tokenIds.push(token.id);
        } catch (err) {
            debug("Area Spells | Failed to test token inside region", err);
        }
    }
    _suppressEnter(behavior, tokenIds);
}

/**
 * Ignore the next "enter" event without movement of the given tokens for a short while.
 * @param {RegionBehavior} behavior
 * @param {string[]} tokenIds
 */
function _suppressEnter(behavior, tokenIds) {
    if (!behavior?.uuid || !tokenIds.length) return;
    let record = suppressedEnters.get(behavior.uuid);
    if (!record || (Date.now() > record.expires)) {
        record = { tokenIds: new Set(), expires: 0 };
        suppressedEnters.set(behavior.uuid, record);
    }
    for (const id of tokenIds) record.tokenIds.add(id);
    record.expires = Date.now() + SUPPRESSED_ENTER_TTL_MS;
}

/**
 * Whether an "enter" event without movement was announced as not being a real trigger.
 * Consumes the entry so a later "emanation moves onto creature" event still triggers.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument} token
 * @returns {boolean}
 */
export function consumeSuppressedEnter(behavior, token) {
    const record = suppressedEnters.get(behavior.uuid);
    if (!record) return false;
    if (Date.now() > record.expires) {
        suppressedEnters.delete(behavior.uuid);
        return false;
    }
    const consumed = record.tokenIds.delete(token.id);
    if (!record.tokenIds.size) suppressedEnters.delete(behavior.uuid);
    return consumed;
}
