/**
 * Feature: Damage Emanation Automation
 * Description: Triggers the saving throw and damage of emanation and area spells such as Spirit Guardians,
 * Conjure Woodland Beings, Cacophonic Shield, Dirge, Moonbeam, Cloudkill and Doomtide whenever a creature
 * enters the area, the area moves into a creature's space, or a creature ends its turn inside it.
 *
 * @introduced v14.54.0
 * @updated v14.58.0 (Placed areas: Moonbeam, Cloudkill, Doomtide; Cloudkill / Doomtide drift each caster turn)
 */
import { MODULE_ID, getSetting, debug, log } from "../../main.js";
import { isMidiActive } from "../../utils/module-compat.js";

/**
 * Damage Emanation Automation
 *
 * dnd5e 6 places emanation templates as Regions attached to the caster's token. This feature adds
 * a custom Region Behavior (`niks-dnd5e-tweaks.damageEmanation`) to those regions, either through
 * the spell list setting (matched by item identifier) or through the "Damage Emanation" entry in an
 * activity's Behaviors tab.
 *
 * Foundry V14 fires the region events that match the 2024 rules wording:
 *  - TOKEN_ENTER with movement data: a creature enters the emanation.
 *  - TOKEN_ENTER without movement data: the emanation (attached to the caster) moves into a
 *    creature's space. The same event fires for creatures already inside when the region is
 *    created; those are ignored, because the casting activity already handles them.
 *  - TOKEN_TURN_END: a creature ends its turn inside the emanation.
 *
 * Exactly one client handles an event (the active GM, otherwise the caster's first active owner).
 * Triggers arriving close together are batched into one activity use with several targets. Each
 * creature makes the save only once per combat turn per emanation.
 *
 * The damage activity is re-used without consumption, concentration or template placement, so the
 * native save card, damage roll, damage application and effect application all work as usual.
 */

// Literal module id: main.js imports this file before MODULE_ID is initialised (circular import).
const DAMAGE_EMANATION_BEHAVIOR_TYPE = "niks-dnd5e-tweaks.damageEmanation";
const ACTIVITY_BEHAVIOR_TYPE = "niksDamageEmanation";

/** Spells (by identifier) that only affect creatures the caster can see. */
const SIGHT_REQUIRED_SPELLS = new Set(["conjure-woodland-beings", "yolandes-regal-presence"]);

/** Spells (by identifier) whose area moves this many feet away from the caster at the start of each of the caster's turns. */
const DRIFTING_SPELLS = new Map([["cloudkill", 10], ["doomtide", 10]]);

/** Actor types that count as creatures. */
const CREATURE_ACTOR_TYPES = new Set(["character", "npc"]);

/** How long triggers are collected before they are processed together. */
const BATCH_DELAY_MS = 300;

/** How long tokens are ignored for "emanation enters" events after the emanation appears around them. */
const SUPPRESSED_ENTER_TTL_MS = 10000;

/** How long a player waits for the GM (or the card's author) to confirm a prompt click. */
const CLAIM_TIMEOUT_MS = 5000;

/** @type {Map<string, {entries: Map<string, {token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}>, timer: number}>} */
const _queues = new Map();

/**
 * Behavior UUID -> tokens whose next "enter" event without movement is ignored: tokens inside when
 * the emanation is created, enabled or revealed, and tokens created inside it.
 * @type {Map<string, {tokenIds: Set<string>, expires: number}>}
 */
const _suppressedEnters = new Map();

/**
 * Behavior UUID -> (token ID -> turn key) of triggers already processed on this client. Covers the
 * time until `system.triggered` is stored, and users who can't update the behavior.
 * @type {Map<string, Map<string, string>>}
 */
const _triggeredLocal = new Map();

/** @type {Map<string, string>} Activity UUID -> last chosen damage type (client-local fallback) */
const _rememberedDamageTypes = new Map();

/** @type {Map<string, Promise>} Behavior UUID -> pending prompt post, so cards are merged in order */
const _promptLocks = new Map();

/** @type {Set<string>} Prompt message IDs being resolved on this client, so only one click wins */
const _claimedPrompts = new Set();

/** @type {Map<string, Function>} Claim request ID -> callback receiving whether the claim was granted */
const _pendingClaims = new Map();

// ── Registration (init) ──────────────────────────────────────────────

/**
 * Register the Region Behavior type and the dnd5e Activity Behavior type.
 * Must run during "init", before Foundry prepares data models and dnd5e localizes them.
 */
export function registerDamageEmanationTypes() {
    const RegionBehaviorClass = _createRegionBehaviorType();
    CONFIG.RegionBehavior.dataModels[DAMAGE_EMANATION_BEHAVIOR_TYPE] = RegionBehaviorClass;
    CONFIG.RegionBehavior.typeIcons[DAMAGE_EMANATION_BEHAVIOR_TYPE] = "fa-solid fa-burst";

    const BaseActivityBehavior = globalThis.dnd5e?.dataModels?.regionBehavior?.BaseActivityBehavior;
    if (BaseActivityBehavior && CONFIG.DND5E?.activityBehaviorTypes) {
        CONFIG.DND5E.activityBehaviorTypes[ACTIVITY_BEHAVIOR_TYPE] = {
            label: `TYPES.RegionBehavior.${DAMAGE_EMANATION_BEHAVIOR_TYPE}`,
            icon: "icons/svg/explosion.svg",
            model: _createActivityBehaviorType(BaseActivityBehavior)
        };
    } else {
        log("Damage Emanation | dnd5e Activity Behaviors not available, Behaviors tab entry not registered");
    }
}

/**
 * Build the Region Behavior data model class.
 * @returns {typeof foundry.data.regionBehaviors.RegionBehaviorType}
 */
function _createRegionBehaviorType() {
    const { NumberField, ObjectField, StringField } = foundry.data.fields;

    return class DamageEmanationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

        /** @override */
        static LOCALIZATION_PREFIXES = ["ND5T.DamageEmanation.Behavior"];

        /** @override */
        static defineSchema() {
            return {
                activity: new StringField({ required: true, blank: true, initial: "" }),
                scaling: new NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
                damageType: new StringField({ required: false, blank: true, initial: "" }),
                drift: new NumberField({ required: false, nullable: false, min: 0, initial: 0 }),
                triggered: new ObjectField()
            };
        }

        /** @override */
        static events = {
            [CONST.REGION_EVENTS.TOKEN_ENTER]: _onTokenEnter,
            [CONST.REGION_EVENTS.TOKEN_TURN_END]: _onTokenTurnEnd
        };
    };
}

/**
 * Build the dnd5e Activity Behavior data model class, shown in an activity's Behaviors tab.
 * @param {typeof foundry.abstract.DataModel} BaseActivityBehavior
 * @returns {typeof foundry.abstract.DataModel}
 */
function _createActivityBehaviorType(BaseActivityBehavior) {
    const { NumberField, StringField } = foundry.data.fields;

    return class DamageEmanationActivityBehavior extends BaseActivityBehavior {

        /** @override */
        static LOCALIZATION_PREFIXES = ["ND5T.DamageEmanation.ActivityBehavior"];

        /** @override */
        static defineSchema() {
            return {
                damageActivity: new StringField({ required: true, blank: true, initial: "" }),
                drift: new NumberField({ required: false, nullable: false, min: 0, initial: 0 })
            };
        }

        /** @override */
        createBehaviorData(activity) {
            if (!getSetting("enableDamageEmanation")) return false;
            const damageActivity = (this.damageActivity && activity.item?.system.activities?.get(this.damageActivity))
                ?? _resolveDamageActivity(activity.item, activity);
            if (!damageActivity) return false;
            return {
                type: DAMAGE_EMANATION_BEHAVIOR_TYPE,
                system: { activity: damageActivity.uuid, scaling: null, drift: this.drift ?? 0 }
            };
        }

        /** @override */
        customizeField(field, data) {
            if (field.name !== "damageActivity") return;
            const item = _findParentItem(this);
            const choices = Array.from(item?.system.activities ?? [])
                .filter(a => a.type === "save" && a.damage?.parts?.length)
                .map(a => ({ value: a.id, label: a.name }));
            data.options = [
                { value: "", label: game.i18n.localize("ND5T.DamageEmanation.ActivityBehavior.Automatic") },
                ...choices
            ];
        }
    };
}

/**
 * Walk up the data model parents to the owning item.
 * @param {foundry.abstract.DataModel} model
 * @returns {Item5e|null}
 */
function _findParentItem(model) {
    let current = model?.parent;
    for (let depth = 0; current && depth < 6; depth++) {
        if (current.documentName === "Item") return current;
        if (current.item?.documentName === "Item") return current.item;
        current = current.parent;
    }
    return null;
}

// ── Initialisation (setup) ───────────────────────────────────────────

/**
 * Register hooks for the Damage Emanation feature.
 * Called once during the "setup" phase from main.js.
 */
export function initDamageEmanation() {
    Hooks.on("dnd5e.preUseActivity", _onPreUseActivity);
    Hooks.on("dnd5e.createMeasuredTemplate", _onCreateMeasuredTemplate);
    Hooks.on("createRegion", _onCreateRegion);
    Hooks.on("updateRegion", _onUpdateRegion);
    Hooks.on("deleteRegion", _onDeleteRegion);
    Hooks.on("createRegionBehavior", _onCreateRegionBehavior);
    Hooks.on("updateRegionBehavior", _onUpdateRegionBehavior);
    Hooks.on("deleteRegionBehavior", _onDeleteRegionBehavior);
    Hooks.on("createToken", _onCreateToken);
    Hooks.on("deleteActiveEffect", _onDeleteActiveEffect);
    Hooks.on("dnd5e.preRollDamage", _onPreRollDamage);
    Hooks.on("dnd5e.rollDamage", _onRollDamage);
    Hooks.on("renderChatMessageHTML", _onRenderChatMessage);
    Hooks.on("updateChatMessage", _onUpdateChatMessage);
    Hooks.on("combatTurnChange", _onCombatTurnChange);
    log("Damage Emanation | Initialized");
}

// ── Damage activity resolution ───────────────────────────────────────

/**
 * Find the activity whose saving throw and damage the emanation applies.
 * Prefers a separate save activity with damage that uses no spell slot (e.g. "Emanation Save"),
 * then the activity that placed the template (e.g. "Cast and Save"), then any save with damage.
 * @param {Item5e} item
 * @param {Activity} [placingActivity]
 * @returns {Activity|null}
 */
function _resolveDamageActivity(item, placingActivity) {
    const candidates = Array.from(item?.system.activities ?? [])
        .filter(a => a.type === "save" && a.damage?.parts?.length);
    if (!candidates.length) return null;
    return candidates.find(a => (a.id !== placingActivity?.id) && !a.consumption?.spellSlot)
        ?? candidates.find(a => a.id === placingActivity?.id)
        ?? candidates[0];
}

/**
 * Whether an item is on the Damage Emanation spell list (by identifier or slugified name).
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isListedSpell(item) {
    if (!item) return false;
    const raw = getSetting("damageEmanationSpells");
    if (!raw || typeof raw !== "string") return false;
    const listed = new Set(raw.split(",").map(s => s.trim().slugify({ strict: true })).filter(Boolean));
    const identifier = item.system?.identifier || item.name?.slugify({ strict: true });
    return listed.has(identifier) || listed.has(item.name?.slugify({ strict: true }));
}

/**
 * Whether the activity already carries the Damage Emanation activity behavior,
 * in which case dnd5e creates the region behavior itself.
 * @param {Activity} activity
 * @returns {boolean}
 */
function _hasActivityBehavior(activity) {
    // Only behaviors whose level range matches the cast, the same ones dnd5e turns into region behaviors
    return Array.from(activity?.applicableBehaviors ?? []).some(b => b.type === ACTIVITY_BEHAVIOR_TYPE);
}

// ── Region creation ──────────────────────────────────────────────────

/**
 * Make sure casting a listed spell places its emanation, even when the activity has template
 * placement turned off (e.g. Yolande's Regal Presence "Surround Self"). Without the template
 * region there is nothing to trigger from. The usage dialog still lets the caster untick it.
 * @param {Activity} activity
 * @param {object} usageConfig
 */
function _onPreUseActivity(activity, usageConfig) {
    if (!getSetting("enableDamageEmanation")) return;
    if (usageConfig?.nd5tDamageEmanation) return;
    if (!usageConfig?.create || (usageConfig.create.measuredTemplate !== false)) return;
    if (!activity?.target?.template?.type || !activity.consumption?.spellSlot) return;
    if (!_isListedSpell(activity.item)) return;
    usageConfig.create.measuredTemplate = true;
    debug(`Damage Emanation | Enabled template placement for "${activity.item.name}" (${activity.name})`);
}

/**
 * Add the Damage Emanation behavior to template regions of listed spells before they are created.
 * Runs on the casting client; `activity` is the scaled clone used for this cast.
 * @param {Activity} activity
 * @param {object[]} regionData
 */
function _onCreateMeasuredTemplate(activity, regionData) {
    if (!getSetting("enableDamageEmanation")) return;
    const item = activity?.item;
    if (!_isListedSpell(item) || _hasActivityBehavior(activity)) return;

    const damageActivity = _resolveDamageActivity(item, activity);
    if (!damageActivity) {
        debug(`Damage Emanation | "${item.name}" is listed but has no save activity with damage`);
        return;
    }

    const scaling = _getUsageScaling(activity);
    const drift = DRIFTING_SPELLS.get(item.system?.identifier) ?? 0;
    for (const data of regionData) {
        data.behaviors = [
            ...(data.behaviors ?? []),
            {
                type: DAMAGE_EMANATION_BEHAVIOR_TYPE,
                name: game.i18n.localize(`TYPES.RegionBehavior.${DAMAGE_EMANATION_BEHAVIOR_TYPE}`),
                system: { activity: damageActivity.uuid, scaling, drift }
            }
        ];
    }
    debug(`Damage Emanation | Added behavior to "${item.name}" template (activity: ${damageActivity.name}, scaling: ${scaling})`);
}

/**
 * Determine how many levels above its base level a spell is being cast.
 * @param {Activity} activity  The scaled activity clone used for the cast.
 * @returns {number}
 */
function _getUsageScaling(activity) {
    const itemScaling = Number(activity.item?.getFlag("dnd5e", "scaling"));
    if (Number.isFinite(itemScaling)) return Math.max(0, itemScaling);
    const concentrationScaling = Number(_getConcentrationEffect(activity.actor, activity.item)?.getFlag("dnd5e", "scaling"));
    return Number.isFinite(concentrationScaling) ? Math.max(0, concentrationScaling) : 0;
}

/**
 * Remember the tokens inside a newly created region with a Damage Emanation behavior.
 * @param {RegionDocument} region
 */
function _onCreateRegion(region) {
    for (const behavior of _getEmanationBehaviors(region)) _suppressTokensInside(behavior);
}

/**
 * Remember the tokens inside a region that was revealed. Foundry fires "enter" events for them,
 * but the emanation didn't move.
 * @param {RegionDocument} region
 * @param {object} changes
 */
function _onUpdateRegion(region, changes) {
    if (changes.hidden !== false) return;
    for (const behavior of _getEmanationBehaviors(region)) _suppressTokensInside(behavior);
}

/**
 * Drop the client-side state of a deleted region's emanations.
 * @param {RegionDocument} region
 */
function _onDeleteRegion(region) {
    for (const behavior of _getEmanationBehaviors(region)) _clearBehaviorState(behavior.uuid);
}

/**
 * Remember the tokens inside the region when the behavior is added to an existing region
 * (e.g. by dnd5e's activity behaviors after the template was created).
 * @param {RegionBehavior} behavior
 */
function _onCreateRegionBehavior(behavior) {
    if (behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) _suppressTokensInside(behavior);
}

/**
 * Remember the tokens inside the region when the behavior is enabled again. Foundry fires "enter"
 * events for them, but the emanation didn't move.
 * @param {RegionBehavior} behavior
 * @param {object} changes
 */
function _onUpdateRegionBehavior(behavior, changes) {
    if ((behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) && (changes.disabled === false)) {
        _suppressTokensInside(behavior);
    }
}

/**
 * Drop the client-side state of a deleted emanation behavior.
 * @param {RegionBehavior} behavior
 */
function _onDeleteRegionBehavior(behavior) {
    if (behavior.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) _clearBehaviorState(behavior.uuid);
}

/**
 * Ignore the "enter" event of a token created inside an emanation (e.g. a summoned creature):
 * it appeared there, it didn't enter and the emanation didn't move onto it.
 * @param {TokenDocument} token
 */
function _onCreateToken(token) {
    for (const region of token.regions ?? []) {
        for (const behavior of _getEmanationBehaviors(region)) _suppressEnter(behavior, [token.id]);
    }
}

/**
 * The Damage Emanation behaviors of a region.
 * @param {RegionDocument} region
 * @returns {RegionBehavior[]}
 */
function _getEmanationBehaviors(region) {
    return Array.from(region?.behaviors ?? []).filter(b => b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE);
}

/**
 * Forget the client-side state kept for an emanation behavior.
 * @param {string} behaviorUuid
 */
function _clearBehaviorState(behaviorUuid) {
    const queue = _queues.get(behaviorUuid);
    if (queue) clearTimeout(queue.timer);
    _queues.delete(behaviorUuid);
    _suppressedEnters.delete(behaviorUuid);
    _triggeredLocal.delete(behaviorUuid);
    _promptLocks.delete(behaviorUuid);
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
            debug("Damage Emanation | Failed to test token inside region", err);
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
    let record = _suppressedEnters.get(behavior.uuid);
    if (!record || (Date.now() > record.expires)) {
        record = { tokenIds: new Set(), expires: 0 };
        _suppressedEnters.set(behavior.uuid, record);
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
function _consumeSuppressedEnter(behavior, token) {
    const record = _suppressedEnters.get(behavior.uuid);
    if (!record) return false;
    if (Date.now() > record.expires) {
        _suppressedEnters.delete(behavior.uuid);
        return false;
    }
    const consumed = record.tokenIds.delete(token.id);
    if (!record.tokenIds.size) _suppressedEnters.delete(behavior.uuid);
    return consumed;
}

// ── Region events ────────────────────────────────────────────────────

/**
 * A creature entered the emanation, or the emanation moved into a creature's space.
 * @this {foundry.data.regionBehaviors.RegionBehaviorType}
 * @param {RegionTokenEnterEvent} event
 */
function _onTokenEnter(event) {
    const { token, movement } = event.data;
    if (!token) return;
    if (!movement && _consumeSuppressedEnter(this.behavior, token)) {
        debug(`Damage Emanation | Ignoring ${token.name}: inside the emanation when it appeared`);
        return;
    }
    const combat = _getCombat(this.scene);
    const turnKey = combat ? `${combat.id}.${combat.round}.${combat.turn}` : null;
    const mergeKey = combat ? _getMergeKey(combat, combat.round, combat.combatant, turnKey) : null;
    _enqueueTrigger(this.behavior, token, movement ? "enter" : "emanationEnter", turnKey, mergeKey);
}

/**
 * A creature ended its turn inside the emanation.
 * @this {foundry.data.regionBehaviors.RegionBehaviorType}
 * @param {RegionTokenTurnEndEvent} event
 */
function _onTokenTurnEnd(event) {
    const { token, combat, combatant, round, turn } = event.data;
    if (!token || !combat) return;
    // Key the turn that just ended, so a creature that entered on its own turn doesn't save again.
    const turnKey = `${combat.id}.${round}.${turn}`;
    _enqueueTrigger(this.behavior, token, "turnEnd", turnKey, _getMergeKey(combat, round, combatant, turnKey));
}

// ── Trigger evaluation ───────────────────────────────────────────────

/**
 * Whether this client handles triggers for the caster: the active GM, or the caster's first
 * active owner when no GM is connected.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isExecutor(actor) {
    const activeGM = game.users.activeGM;
    if (activeGM) return activeGM.isSelf;
    const owner = game.users
        .filter(u => u.active && actor?.testUserPermission(u, "OWNER"))
        .sort((a, b) => a.id.localeCompare(b.id))[0];
    return owner?.isSelf ?? false;
}

/**
 * The started combat for a scene.
 * @param {Scene} scene
 * @returns {Combat|null}
 */
function _getCombat(scene) {
    return game.combats.find(c => c.started && (!c.scene || (c.scene.id === scene?.id))) ?? null;
}

/**
 * Key grouping prompt cards: consecutive turns of combatants with the same initiative in a round
 * (e.g. a group of identical monsters) share one card. Falls back to the turn itself.
 * @param {Combat} combat
 * @param {number} round
 * @param {Combatant|null} combatant  The combatant whose turn it is (or just ended).
 * @param {string} turnKey
 * @returns {string}
 */
function _getMergeKey(combat, round, combatant, turnKey) {
    const initiative = combatant?.initiative;
    return Number.isFinite(initiative) ? `${combat.id}.${round}.init${initiative}` : turnKey;
}

/**
 * The caster's concentration effect for an item.
 * @param {Actor5e} actor
 * @param {Item5e} item
 * @returns {ActiveEffect5e|null}
 */
function _getConcentrationEffect(actor, item) {
    if (!actor || !item) return null;
    const status = CONFIG.specialStatusEffects.CONCENTRATING;
    return actor.effects.find(e => e.statuses?.has(status) && (e.getFlag("dnd5e", "item")?.id === item.id)) ?? null;
}

/**
 * Whether the caster is still concentrating on the spell, if the spell needs concentration.
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isSpellStillActive(activity) {
    const { actor, item } = activity;
    if (!item?.system.properties?.has("concentration")) return true;
    if (game.settings.get("dnd5e", "disableConcentration")) return true;
    if (!(actor?.system.attributes?.concentration?.limit > 0)) return true;
    return !!_getConcentrationEffect(actor, item);
}

/**
 * Whether the emanation affects a token.
 * An emanation centered on the caster never affects the caster. Placed areas (Moonbeam, Cloudkill)
 * affect everyone inside, the caster and allies included, unless the spell lets the caster choose.
 * @param {TokenDocument} token
 * @param {TokenDocument|null} casterToken
 * @param {Activity} activity
 * @param {RegionDocument} region
 * @returns {boolean}
 */
function _isAffected(token, casterToken, activity, region) {
    const actor = token.actor;
    if (!actor || !CREATURE_ACTOR_TYPES.has(actor.type)) return false;
    const centeredOnCaster = !!region?.attachment?.token
        && ((region.attachment.token === casterToken) || (region.attachment.token.actor === activity.actor));
    if (centeredOnCaster && ((token.id === casterToken?.id) || (actor === activity.actor))) return false;
    if (token.disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return false;
    if (actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || actor.statuses?.has("dead")) return false;

    const choosesTargets = centeredOnCaster || !!activity.item?.system.target?.affects?.choice;
    if (getSetting("damageEmanationExcludeAllies") && choosesTargets && casterToken
        && (token.disposition === casterToken.disposition)) return false;

    if (getSetting("damageEmanationRequireSight") && SIGHT_REQUIRED_SPELLS.has(activity.item?.system.identifier)) {
        if (token.hidden || actor.statuses?.has("invisible")) return false;
    }
    return true;
}

/**
 * Check a trigger and queue it for the batched activity use.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument} token
 * @param {"enter"|"emanationEnter"|"turnEnd"} reason
 * @param {string|null} turnKey   Combat turn used for the once-per-turn rule.
 * @param {string|null} mergeKey  Groups prompt cards (same initiative count in a round).
 */
function _enqueueTrigger(behavior, token, reason, turnKey, mergeKey) {
    if (!getSetting("enableDamageEmanation")) return;
    if (!behavior?.uuid || behavior.disabled || !behavior.system.activity) return;
    if (getSetting("damageEmanationCombatOnly") && !turnKey) return;

    const activity = fromUuidSync(behavior.system.activity, { strict: false });
    if (!activity?.item) {
        debug(`Damage Emanation | Activity ${behavior.system.activity} not found for behavior ${behavior.uuid}`);
        return;
    }
    if (!_isExecutor(activity.actor)) return;
    if (!_isSpellStillActive(activity)) return;

    const region = behavior.region;
    const casterToken = region?.attachment?.token
        ?? fromUuidSync(region?.getFlag("dnd5e", "origin"), { strict: false });
    if (!_isAffected(token, casterToken, activity, region)) return;

    let queue = _queues.get(behavior.uuid);
    if (turnKey) {
        if (behavior.system.triggered?.[token.id] === turnKey) return;
        if (_triggeredLocal.get(behavior.uuid)?.get(token.id) === turnKey) return;
        if (queue?.entries.get(token.id)?.turnKey === turnKey) return;
    } else if (queue?.entries.has(token.id)) return;

    if (!queue) {
        queue = { entries: new Map(), timer: null };
        _queues.set(behavior.uuid, queue);
    }
    queue.entries.set(token.id, { token, turnKey, mergeKey, reason });
    debug(`Damage Emanation | Queued ${token.name} (${reason}) for ${activity.item.name}`);

    clearTimeout(queue.timer);
    queue.timer = setTimeout(() => _flushQueue(behavior.uuid), BATCH_DELAY_MS);
}

/**
 * Process the queued triggers of one emanation.
 * @param {string} behaviorUuid
 */
async function _flushQueue(behaviorUuid) {
    const queue = _queues.get(behaviorUuid);
    _queues.delete(behaviorUuid);
    const entries = Array.from(queue?.entries.values() ?? []).filter(e => e.token.parent);
    const behavior = fromUuidSync(behaviorUuid, { strict: false });
    if (!entries.length || !behavior) return;

    // Record locally before anything is awaited, so triggers arriving meanwhile are de-duplicated
    _markTriggeredLocal(behaviorUuid, entries);
    await _markTriggered(behavior, entries);

    try {
        const mode = getSetting("damageEmanationMode");
        if (mode === "automatic") await _executeDamageEmanation(behavior, entries.map(e => e.token));
        else await _postPrompt(behavior, entries, mode);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Damage Emanation: Failed to process triggers", err);
    }
}

/**
 * Remember on this client the turn each creature was affected in. Entries from other combats are dropped.
 * @param {string} behaviorUuid
 * @param {{token: TokenDocument, turnKey: string|null}[]} entries
 */
function _markTriggeredLocal(behaviorUuid, entries) {
    const keyed = entries.filter(e => e.turnKey);
    if (!keyed.length) return;
    const combatPrefix = `${keyed[0].turnKey.split(".")[0]}.`;
    const local = _triggeredLocal.get(behaviorUuid) ?? new Map();
    for (const [tokenId, key] of local) {
        if (!key.startsWith(combatPrefix)) local.delete(tokenId);
    }
    for (const { token, turnKey } of keyed) local.set(token.id, turnKey);
    _triggeredLocal.set(behaviorUuid, local);
}

/**
 * Store the turn each creature was affected in, so it saves only once per turn.
 * Entries from other combats are dropped.
 * @param {RegionBehavior} behavior
 * @param {{token: TokenDocument, turnKey: string|null}[]} entries
 */
async function _markTriggered(behavior, entries) {
    const keyed = entries.filter(e => e.turnKey);
    if (!keyed.length) return;
    const combatPrefix = `${keyed[0].turnKey.split(".")[0]}.`;
    const triggered = Object.fromEntries(Object.entries(behavior.system.triggered ?? {})
        .filter(([, key]) => typeof key === "string" && key.startsWith(combatPrefix)));
    for (const { token, turnKey } of keyed) triggered[token.id] = turnKey;
    try {
        await behavior.update({ "system.triggered": foundry.data.operators.ForcedReplacement.create(triggered) });
    } catch (err) {
        debug("Damage Emanation | Could not store triggered creatures", err);
    }
}

// ── Activity use ─────────────────────────────────────────────────────

/**
 * Use the emanation's damage activity against the given tokens without consuming resources,
 * starting concentration or placing a template.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument[]} tokens
 */
async function _executeDamageEmanation(behavior, tokens) {
    const activity = behavior.system.activity ? await fromUuid(behavior.system.activity) : null;
    if (!activity?.item) {
        ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.ActivityMissing"));
        return;
    }
    if (!activity.item.isOwner) {
        ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.NoPermission"));
        return;
    }
    tokens = tokens.filter(t => t?.parent && t.actor);
    if (!tokens.length) return;

    const scaling = _getBehaviorScaling(behavior, activity);
    const slot = _findSpellSlotKey(activity.actor, activity.item.system.level + scaling);
    const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
    const usage = {
        consume: false,
        scaling,
        concentration: { begin: false },
        create: { measuredTemplate: false },
        nd5tDamageEmanation: true
    };
    if (slot) usage.spell = { slot };

    debug(`Damage Emanation | Using ${activity.item.name} (${activity.name}) at +${scaling} against`, tokens.map(t => t.name));

    // Link the card to the caster's concentration, so effects applied from it (e.g. Deafened)
    // end together with the spell.
    const messageSystem = { targets: TargetsField.getDescriptors(tokens) };
    const concentration = _getConcentrationEffect(activity.actor, activity.item);
    if (concentration) messageSystem.concentration = concentration.id;

    const restoreTargets = isMidiActive() ? _setUserTargets(tokens) : null;
    try {
        await activity.use(usage, { configure: false }, {
            data: {
                system: messageSystem,
                flags: { [MODULE_ID]: { damageEmanation: behavior.uuid } }
            }
        });
    } finally {
        restoreTargets?.();
    }
}

/**
 * Levels above base at which the spell was cast.
 * @param {RegionBehavior} behavior
 * @param {Activity} activity
 * @returns {number}
 */
function _getBehaviorScaling(behavior, activity) {
    if (Number.isFinite(behavior.system.scaling)) return behavior.system.scaling;
    const concentrationScaling = Number(_getConcentrationEffect(activity.actor, activity.item)?.getFlag("dnd5e", "scaling"));
    if (Number.isFinite(concentrationScaling)) return Math.max(0, concentrationScaling);
    const spellLevel = Number(behavior.region?.getFlag("dnd5e", "spellLevel"));
    return Number.isFinite(spellLevel) ? Math.max(0, spellLevel - activity.item.system.level) : 0;
}

/**
 * Spell slot key of the given level, so dnd5e scales the activity to the cast level.
 * @param {Actor5e} actor
 * @param {number} level
 * @returns {string|null}
 */
function _findSpellSlotKey(actor, level) {
    if (!(level > 0)) return null;
    const spells = actor?.system.spells ?? {};
    if (spells[`spell${level}`]) return `spell${level}`;
    return Object.entries(spells).find(([, data]) => data?.level === level)?.[0] ?? null;
}

/**
 * Temporarily target the given tokens (midi-qol reads the user's targets instead of the message's).
 * @param {TokenDocument[]} tokens
 * @returns {Function} Restores the previous targets.
 */
function _setUserTargets(tokens) {
    const previous = Array.from(game.user.targets).map(t => t.id);
    canvas.tokens?.setTargets(tokens.map(t => t.id), { mode: "replace" });
    return () => canvas.tokens?.setTargets(previous, { mode: "replace" });
}

// ── Prompt card ──────────────────────────────────────────────────────

/**
 * Users who receive the prompt: GMs, plus the caster's owners in "Prompt Caster" mode.
 * @param {Actor5e} actor
 * @param {string} mode
 * @returns {string[]}
 */
function _getPromptRecipients(actor, mode) {
    const users = game.users.filter(u => u.isGM
        || ((mode === "promptCaster") && actor?.testUserPermission(u, "OWNER")));
    return users.map(u => u.id);
}

/**
 * Whisper a prompt asking whether the triggered creatures should make their saves.
 * Triggers from the same combat turn, or from consecutive turns of combatants with the same
 * initiative, are added to the open card for this emanation as long as nobody has used it yet.
 * @param {RegionBehavior} behavior
 * @param {{token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}[]} entries
 * @param {string} mode
 */
async function _postPrompt(behavior, entries, mode) {
    const previous = _promptLocks.get(behavior.uuid) ?? Promise.resolve();
    const current = previous.then(() => _postPromptGroups(behavior, entries, mode));
    _promptLocks.set(behavior.uuid, current.catch(() => {}));
    await current;
}

/**
 * Post or extend one prompt card per merge key in the batch.
 * @param {RegionBehavior} behavior
 * @param {{token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}[]} entries
 * @param {string} mode
 */
async function _postPromptGroups(behavior, entries, mode) {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.mergeKey)) groups.set(entry.mergeKey, []);
        groups.get(entry.mergeKey).push({
            tokenUuid: entry.token.uuid,
            turnKey: entry.turnKey,
            reason: entry.reason,
            name: entry.token.name,
            img: entry.token.texture?.src ?? "icons/svg/mystery-man.svg"
        });
    }

    const activity = behavior.system.activity ? fromUuidSync(behavior.system.activity, { strict: false }) : null;
    const actor = activity?.actor;
    const itemName = activity?.item?.name ?? "";

    for (const [mergeKey, groupEntries] of groups) {
        const existing = mergeKey ? _findOpenPrompt(behavior.uuid, mergeKey) : null;
        if (existing) {
            const prompt = existing.getFlag(MODULE_ID, "damageEmanationPrompt");
            // A creature already on the card keeps its row but takes the newer turn key, the one
            // now stored in `system.triggered`, so skipping it clears the right key.
            const byToken = new Map(prompt.entries.map(e => [e.tokenUuid, { ...e }]));
            for (const entry of groupEntries) {
                const known = byToken.get(entry.tokenUuid);
                if (known) known.turnKey = entry.turnKey;
                else byToken.set(entry.tokenUuid, entry);
            }
            const merged = Array.from(byToken.values());
            await existing.update({
                content: _buildPromptContent(itemName, merged),
                [`flags.${MODULE_ID}.damageEmanationPrompt.entries`]: merged
            });
            debug(`Damage Emanation | Added ${groupEntries.length} creature(s) to open prompt ${existing.id}`);
            continue;
        }

        await ChatMessage.create({
            content: _buildPromptContent(itemName, groupEntries),
            speaker: ChatMessage.getSpeaker({ actor }),
            whisper: _getPromptRecipients(actor, mode),
            flags: {
                [MODULE_ID]: {
                    damageEmanationPrompt: {
                        behaviorUuid: behavior.uuid,
                        mergeKey,
                        entries: groupEntries,
                        state: "pending"
                    }
                }
            }
        });
    }
}

/**
 * The newest unresolved prompt card of an emanation for a merge key, if this user can edit it.
 * @param {string} behaviorUuid
 * @param {string} mergeKey
 * @returns {ChatMessage|null}
 */
function _findOpenPrompt(behaviorUuid, mergeKey) {
    const messages = game.messages.contents;
    for (let i = messages.length - 1, checked = 0; (i >= 0) && (checked < 50); i--, checked++) {
        const message = messages[i];
        const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
        if (!prompt || (prompt.behaviorUuid !== behaviorUuid) || (prompt.mergeKey !== mergeKey)) continue;
        if ((prompt.state !== "pending") || _claimedPrompts.has(message.id)
            || !message.canUserModify(game.user, "update")) return null;
        return message;
    }
    return null;
}

/**
 * Build the prompt card's HTML.
 * @param {string} itemName
 * @param {{tokenUuid: string, reason: string, name: string, img: string}[]} entries
 * @returns {string}
 */
function _buildPromptContent(itemName, entries) {
    const rows = entries.map(({ tokenUuid, reason, name, img }) => {
        const reasonLabel = game.i18n.localize(`ND5T.DamageEmanation.Reason.${reason}`);
        return `
            <li class="nd5t-emanation-target">
                <label>
                    <input type="checkbox" data-token-uuid="${tokenUuid}" checked>
                    <img src="${img}" alt="">
                    <span class="nd5t-emanation-name">${foundry.utils.escapeHTML(name ?? "")}</span>
                    <span class="nd5t-emanation-reason">${reasonLabel}</span>
                </label>
            </li>`.trim();
    }).join("");

    return `
        <div class="dnd5e chat-card nd5t-emanation-prompt">
            <div class="card-content">
                <p>${game.i18n.format("ND5T.DamageEmanation.PromptDescription", { itemName: foundry.utils.escapeHTML(itemName) })}</p>
                <ul class="nd5t-emanation-targets">${rows}</ul>
            </div>
            <div class="card-buttons nd5t-emanation-buttons">
                <button type="button" data-action="nd5t-emanation-trigger">
                    <i class="fa-solid fa-burst" inert></i> ${game.i18n.localize("ND5T.DamageEmanation.Trigger")}
                </button>
                <button type="button" data-action="nd5t-emanation-skip">
                    <i class="fa-solid fa-xmark" inert></i> ${game.i18n.localize("ND5T.DamageEmanation.Skip")}
                </button>
            </div>
        </div>`.trim();
}

/**
 * Bind the prompt card's buttons.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function _onRenderChatMessage(message, html) {
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt) return;
    const card = html.querySelector(".nd5t-emanation-prompt");
    if (!card || card.dataset.bound) return;
    card.dataset.bound = "true";

    if (prompt.state !== "pending") {
        _renderResolvedState(card, prompt);
        return;
    }

    const behavior = fromUuidSync(prompt.behaviorUuid, { strict: false });
    const actor = behavior?.system.activity ? fromUuidSync(behavior.system.activity, { strict: false })?.actor : null;
    const canAct = game.user.isGM || !!actor?.isOwner;
    for (const button of card.querySelectorAll(".nd5t-emanation-buttons button")) {
        if (!canAct) button.disabled = true;
        button.addEventListener("click", event => _onPromptButton(event, message, card));
    }
}

/**
 * Update rendered prompt cards once the prompt is resolved (flag changes don't re-render them).
 * @param {ChatMessage} message
 */
function _onUpdateChatMessage(message) {
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state === "pending")) return;
    for (const card of document.querySelectorAll(`[data-message-id="${message.id}"] .nd5t-emanation-prompt`)) {
        if (card.querySelector(".nd5t-emanation-buttons")) _renderResolvedState(card, prompt);
    }
}

/**
 * Show who resolved the prompt instead of its buttons.
 * @param {HTMLElement} card
 * @param {object} prompt
 */
function _renderResolvedState(card, prompt) {
    card.querySelectorAll(".nd5t-emanation-target input").forEach(input => {
        input.disabled = true;
        input.checked = (prompt.affected ?? []).includes(input.dataset.tokenUuid);
    });
    const buttons = card.querySelector(".nd5t-emanation-buttons");
    if (!buttons) return;
    const key = prompt.state === "triggered" ? "ND5T.DamageEmanation.Triggered" : "ND5T.DamageEmanation.Skipped";
    const status = document.createElement("p");
    status.classList.add("nd5t-emanation-status");
    status.textContent = game.i18n.format(key, { user: prompt.resolvedBy ?? "" });
    buttons.replaceWith(status);
}

/**
 * Handle Trigger / Skip clicks on the prompt card.
 * @param {PointerEvent} event
 * @param {ChatMessage} message
 * @param {HTMLElement} card
 */
async function _onPromptButton(event, message, card) {
    event.preventDefault();
    event.stopPropagation();
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state !== "pending")) return;
    card.querySelectorAll(".nd5t-emanation-buttons button").forEach(b => b.disabled = true);

    const trigger = event.currentTarget.dataset.action === "nd5t-emanation-trigger";
    const selected = trigger
        ? Array.from(card.querySelectorAll(".nd5t-emanation-target input:checked")).map(i => i.dataset.tokenUuid)
        : [];

    // Claim the card first: only the click that resolves it rolls the saves, so two users clicking
    // at the same time can't both trigger them.
    let granted = false;
    try {
        granted = await _claimPrompt(message, selected);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Damage Emanation: Failed to resolve prompt", err);
    }
    if (!granted) {
        // Someone else resolved it (the card updates itself), or nobody could confirm the click
        const current = message.getFlag(MODULE_ID, "damageEmanationPrompt");
        if (current?.state === "pending") {
            card.querySelectorAll(".nd5t-emanation-buttons button").forEach(b => b.disabled = false);
        }
        return;
    }
    if (!selected.length) return;

    try {
        const behavior = await fromUuid(prompt.behaviorUuid);
        if (!behavior) {
            ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.EmanationGone"));
            return;
        }
        const tokens = selected.map(uuid => fromUuidSync(uuid, { strict: false })).filter(Boolean);
        await _executeDamageEmanation(behavior, tokens);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Damage Emanation: Failed to roll saves", err);
    }
}

/**
 * The user who resolves a prompt card: the active GM, otherwise the card's author if connected.
 * @param {ChatMessage} message
 * @returns {User|null}
 */
function _getPromptAuthority(message) {
    const activeGM = game.users.activeGM;
    if (activeGM) return activeGM;
    return message.author?.active ? message.author : null;
}

/**
 * Resolve the prompt on the resolving user's client and report whether this click won.
 * @param {ChatMessage} message
 * @param {string[]} affected  Token UUIDs that make the save.
 * @returns {Promise<boolean>}
 */
async function _claimPrompt(message, affected) {
    const data = { messageId: message.id, affected, resolvedBy: game.user.name };
    const authority = _getPromptAuthority(message);
    if (!authority) return false;
    if (authority.isSelf) return _applyPromptResolution(data);

    const requestId = foundry.utils.randomID();
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            _pendingClaims.delete(requestId);
            resolve(false);
        }, CLAIM_TIMEOUT_MS);
        _pendingClaims.set(requestId, granted => {
            clearTimeout(timer);
            _pendingClaims.delete(requestId);
            resolve(granted);
        });
        game.socket.emit(`module.${MODULE_ID}`, {
            action: "damageEmanationResolve", requestId, userId: game.user.id, ...data
        });
    });
}

/**
 * Store the prompt's outcome. Creatures that were skipped may be triggered again this turn.
 * Runs only on the resolving user's client, which claims the card synchronously.
 * @param {{messageId: string, affected: string[], resolvedBy: string}} data
 * @returns {Promise<boolean>} Whether this call resolved the prompt.
 */
async function _applyPromptResolution({ messageId, affected, resolvedBy }) {
    const message = game.messages.get(messageId);
    const prompt = message?.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state !== "pending") || _claimedPrompts.has(messageId)) return false;
    _claimedPrompts.add(messageId);

    try {
        await message.setFlag(MODULE_ID, "damageEmanationPrompt", {
            ...prompt,
            state: affected.length ? "triggered" : "skipped",
            affected,
            resolvedBy
        });
    } finally {
        _claimedPrompts.delete(messageId);
    }

    // Let skipped creatures trigger again this turn
    const local = _triggeredLocal.get(prompt.behaviorUuid);
    const behavior = fromUuidSync(prompt.behaviorUuid, { strict: false });
    const triggered = { ...(behavior?.system.triggered ?? {}) };
    let changed = false;
    for (const { tokenUuid, turnKey } of prompt.entries ?? []) {
        if (!turnKey || affected.includes(tokenUuid)) continue;
        const tokenId = tokenUuid.split(".").pop();
        if (local?.get(tokenId) === turnKey) local.delete(tokenId);
        if (triggered[tokenId] === turnKey) {
            delete triggered[tokenId];
            changed = true;
        }
    }
    if (changed && behavior?.isOwner) {
        try {
            await behavior.update({ "system.triggered": foundry.data.operators.ForcedReplacement.create(triggered) });
        } catch (err) {
            debug("Damage Emanation | Could not clear skipped creatures", err);
        }
    }
    return true;
}

/**
 * Socket handler: resolve a prompt on behalf of another user, and tell them whether their click won.
 * @param {object} data
 */
export function onSocketMessage(data) {
    if (data?.action === "damageEmanationClaimResult") {
        if (data.userId === game.user.id) _pendingClaims.get(data.requestId)?.(data.granted);
        return;
    }
    if (data?.action !== "damageEmanationResolve") return;
    const message = game.messages.get(data.messageId);
    if (!message || !_getPromptAuthority(message)?.isSelf) return;
    _applyPromptResolution(data)
        .catch(err => {
            console.error("Nik's DnD5e Tweaks | Damage Emanation: Failed to resolve prompt", err);
            return false;
        })
        .then(granted => {
            if (!data.requestId) return;
            game.socket.emit(`module.${MODULE_ID}`, {
                action: "damageEmanationClaimResult", requestId: data.requestId, userId: data.userId, granted
            });
        });
}

// ── Drifting areas (Cloudkill, Doomtide) ─────────────────────────────

/**
 * At the start of a caster's turn, move their drifting areas away from them.
 * @param {Combat} combat
 * @param {CombatHistoryData} previous
 * @param {CombatHistoryData} current
 */
async function _onCombatTurnChange(combat, previous, current) {
    if (!getSetting("enableDamageEmanation") || !getSetting("damageEmanationDrift")) return;
    if (!previous || !current) return;
    const advanced = (current.round > previous.round)
        || ((current.round === previous.round) && (current.turn > previous.turn));
    if (!advanced) return;

    const actor = combat.combatants.get(current.combatantId)?.actor;
    const scene = combat.scene ?? canvas.scene;
    if (!actor || !scene) return;

    for (const region of scene.regions) {
        if (region.attachment?.token) continue;
        const behavior = _getEmanationBehaviors(region).find(b => !b.disabled && (b.system.drift > 0));
        if (!behavior) continue;
        const activity = behavior.system.activity ? fromUuidSync(behavior.system.activity, { strict: false }) : null;
        if (!activity || (activity.actor !== actor) || !_isExecutor(actor) || !_isSpellStillActive(activity)) continue;
        try {
            await _driftRegion(region, behavior.system.drift, scene);
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Damage Emanation: Failed to move area", err);
        }
    }
}

/**
 * Move a region the given distance straight away from its caster's token.
 * @param {RegionDocument} region
 * @param {number} distanceFt
 * @param {Scene} scene
 */
async function _driftRegion(region, distanceFt, scene) {
    const casterToken = fromUuidSync(region.getFlag("dnd5e", "origin"), { strict: false });
    const shapes = region.toObject().shapes ?? [];
    const anchor = shapes.find(s => Number.isFinite(s.x) && Number.isFinite(s.y));
    if (!casterToken?.getCenterPoint || !anchor || (casterToken.parent !== scene)) return;

    const from = casterToken.getCenterPoint();
    const dx = anchor.x - from.x;
    const dy = anchor.y - from.y;
    const length = Math.hypot(dx, dy);
    // Centered on the caster: there's no "away", so leave it to the GM
    if (length < 1) return;

    const distance = dnd5e.utils?.convertLength?.(distanceFt, "ft", scene.grid.units, { strict: false }) ?? distanceFt;
    const pixels = distance * (scene.grid.size / scene.grid.distance);
    const offsetX = (dx / length) * pixels;
    const offsetY = (dy / length) * pixels;

    for (const shape of shapes) {
        if (Number.isFinite(shape.x)) shape.x += offsetX;
        if (Number.isFinite(shape.y)) shape.y += offsetY;
        if (Array.isArray(shape.points)) {
            shape.points = shape.points.map((value, index) => value + ((index % 2) ? offsetY : offsetX));
        }
    }
    debug(`Damage Emanation | Moving "${region.name}" ${distanceFt} ft away from ${casterToken.name}`);
    await region.update({ shapes });
}

// ── Concentration cleanup ────────────────────────────────────────────

/**
 * Remove the emanation when the caster stops concentrating on the spell.
 * @param {ActiveEffect5e} effect
 */
async function _onDeleteActiveEffect(effect) {
    if (!game.user.isActiveGM || !getSetting("enableDamageEmanation")) return;
    if (!effect.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING)) return;
    const actor = effect.parent;
    const itemId = effect.getFlag("dnd5e", "item")?.id;
    if (!(actor instanceof Actor) || !itemId) return;
    const itemUuid = `${actor.uuid}.Item.${itemId}`;

    for (const scene of game.scenes) {
        const ids = scene.regions
            .filter(r => (r.getFlag("dnd5e", "item") === itemUuid)
                && r.behaviors.some(b => b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE))
            .map(r => r.id);
        if (!ids.length) continue;
        debug(`Damage Emanation | Concentration ended, removing ${ids.length} emanation(s) from ${scene.name}`);
        await scene.deleteEmbeddedDocuments("Region", ids);
    }
}

// ── Damage type memory ───────────────────────────────────────────────

/**
 * Damage Emanation behaviors on the viewed scene that use the given activity.
 * @param {string} activityUuid
 * @returns {RegionBehavior[]}
 */
function _getBehaviorsForActivity(activityUuid) {
    if (!activityUuid || !canvas.scene) return [];
    return canvas.scene.regions.contents.flatMap(r => r.behaviors.filter(b =>
        (b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE) && (b.system.activity === activityUuid)));
}

/**
 * Preselect the damage type chosen earlier for this emanation (e.g. Radiant or Necrotic).
 * @param {object} config  Damage roll process configuration.
 */
function _onPreRollDamage(config) {
    if (!getSetting("enableDamageEmanation") || !getSetting("damageEmanationRememberDamageType")) return;
    const activityUuid = config?.subject?.uuid;
    const behaviors = _getBehaviorsForActivity(activityUuid);
    if (!behaviors.length) return;
    const type = behaviors.find(b => b.system.damageType)?.system.damageType
        ?? _rememberedDamageTypes.get(activityUuid);
    if (!type) return;
    for (const roll of config.rolls ?? []) {
        if (roll?.options?.types?.includes(type)) roll.options.type = type;
    }
}

/**
 * Remember the damage type chosen for an emanation's damage.
 * @param {DamageRoll[]} rolls
 * @param {{subject: Activity}} [data]
 */
function _onRollDamage(rolls, { subject } = {}) {
    if (!getSetting("enableDamageEmanation") || !getSetting("damageEmanationRememberDamageType")) return;
    const roll = rolls?.find(r => (r.options?.types?.length > 1) && r.options.type);
    if (!roll || !subject?.uuid) return;
    const behaviors = _getBehaviorsForActivity(subject.uuid);
    if (!behaviors.length) return;
    const type = roll.options.type;
    _rememberedDamageTypes.set(subject.uuid, type);
    for (const behavior of behaviors) {
        if (behavior.isOwner && (behavior.system.damageType !== type)) {
            behavior.update({ "system.damageType": type }).catch(err =>
                debug("Damage Emanation | Could not store damage type", err));
        }
    }
}
