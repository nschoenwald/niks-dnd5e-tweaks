/**
 * Area Spell Automation: Region events, who is affected, once-per-turn tracking and batching.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, getSetting, debug } from "../../../context.js";
import { getBehaviorActivity, getTriggers, isSpellStillActive, notifyOnce } from "./activity.js";
import { BATCH_DELAY_MS, CREATURE_ACTOR_TYPES, getProfile } from "./config.js";
import { executeAreaSpell } from "./execute.js";
import { consumeSuppressedEnter } from "./placement.js";
import { postPrompt } from "./prompt.js";
import { queues, triggeredLocal } from "./state.js";

/**
 * A creature entered the emanation, or the emanation moved into a creature's space.
 * @this {foundry.data.regionBehaviors.RegionBehaviorType}
 * @param {RegionTokenEnterEvent} event
 */
export function onTokenEnter(event) {
    const { token, movement } = event.data;
    if (!token) return;
    if (!movement && consumeSuppressedEnter(this.behavior, token)) {
        debug(`Area Spells | Ignoring ${token.name}: inside the emanation when it appeared`);
        return;
    }
    const combat = _getCombat(this.scene);
    const turnKey = combat ? `${combat.id}.${combat.round}.${combat.turn}` : null;
    const mergeKey = combat ? _getMergeKey(combat, combat.round, combat.combatant, turnKey) : null;
    _enqueueTrigger(this.behavior, token, movement ? "enter" : "emanationEnter", turnKey, mergeKey);
}

/**
 * A creature started its turn inside the emanation (Web, Sleet Storm, Stinking Cloud).
 * @this {foundry.data.regionBehaviors.RegionBehaviorType}
 * @param {RegionTokenTurnStartEvent} event
 */
export function onTokenTurnStart(event) {
    const { token, combat, combatant, round, turn, skipped } = event.data;
    if (!token || !combat || skipped) return;
    // Same key as entering during this turn, so a creature that starts its turn inside and then
    // moves out and back in makes the save only once.
    const turnKey = `${combat.id}.${round}.${turn}`;
    _enqueueTrigger(this.behavior, token, "turnStart", turnKey, _getMergeKey(combat, round, combatant, turnKey));
}

/**
 * A creature ended its turn inside the emanation.
 * @this {foundry.data.regionBehaviors.RegionBehaviorType}
 * @param {RegionTokenTurnEndEvent} event
 */
export function onTokenTurnEnd(event) {
    const { token, combat, combatant, round, turn, skipped } = event.data;
    // Jumping ahead in the tracker ends the turns passed over too (`skipped`): those creatures never had a turn
    if (!token || !combat || skipped) return;
    // Key the turn that just ended, so a creature that entered on its own turn doesn't save again.
    const turnKey = `${combat.id}.${round}.${turn}`;
    _enqueueTrigger(this.behavior, token, "turnEnd", turnKey, _getMergeKey(combat, round, combatant, turnKey));
}

/**
 * Whether this client handles triggers for the caster: the active GM, or the caster's first
 * active owner when no GM is connected.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isExecutor(actor) {
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
    if (!scene) return null;
    const started = game.combats.filter(c => c.started);
    // A combat linked to this scene first; an unlinked one only if it has combatants here
    return started.find(c => c.scene?.id === scene.id)
        ?? started.find(c => !c.scene && c.combatants.some(cb => cb.sceneId === scene.id))
        ?? null;
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
 * Whether the emanation affects a token.
 * An emanation centered on the caster never affects the caster. Placed areas (Moonbeam, Cloudkill)
 * affect everyone inside, the caster and allies included, unless the spell lets the caster choose.
 * @param {TokenDocument} token
 * @param {TokenDocument|null} casterToken
 * @param {Activity} activity
 * @param {RegionBehavior} behavior
 * @returns {boolean}
 */
function _isAffected(token, casterToken, activity, behavior) {
    const actor = token.actor;
    if (!actor || !CREATURE_ACTOR_TYPES.has(actor.type)) return false;
    const region = behavior.region;
    const profile = getProfile(activity.item);
    const isCaster = (token.id === casterToken?.id) || (actor === activity.actor);
    const centeredOnCaster = !!region?.attachment?.token
        && ((region.attachment.token === casterToken) || (region.attachment.token.actor === activity.actor));
    if ((centeredOnCaster || profile.excludeCaster) && isCaster) return false;
    if (token.disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return false;
    if (actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) || actor.statuses?.has("dead")) return false;

    const creatureTypes = behavior.system.creatureTypes;
    if (creatureTypes?.size && !creatureTypes.has(_getCreatureType(actor))) return false;

    // Spells that only affect enemies (Grave Ground: "An enemy also makes this save") skip the caster's side
    const enemiesOnly = [activity.target?.affects?.type, activity.item?.system.target?.affects?.type].includes("enemy");
    if (enemiesOnly && casterToken && (token.disposition === casterToken.disposition)) return false;

    const choosesTargets = centeredOnCaster || !!activity.item?.system.target?.affects?.choice;
    if (getSetting("damageEmanationExcludeAllies") && choosesTargets && casterToken
        && (token.disposition === casterToken.disposition)) return false;

    if (getSetting("damageEmanationRequireSight") && profile.requiresSight) {
        if (token.hidden || actor.statuses?.has("invisible")) return false;
    }
    return true;
}

/**
 * A creature's type (e.g. "fiend"). Characters take it from their species, humanoid otherwise.
 * @param {Actor5e} actor
 * @returns {string}
 */
function _getCreatureType(actor) {
    const details = actor.system?.details;
    const type = details?.type?.value || details?.race?.system?.type?.value;
    return type || ((actor.type === "character") ? "humanoid" : "");
}

/**
 * Check a trigger and queue it for the batched activity use.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument} token
 * @param {"enter"|"emanationEnter"|"turnStart"|"turnEnd"} reason
 * @param {string|null} turnKey   Combat turn used for the once-per-turn rule.
 * @param {string|null} mergeKey  Groups prompt cards (same initiative count in a round).
 */
function _enqueueTrigger(behavior, token, reason, turnKey, mergeKey) {
    if (!getSetting("enableDamageEmanation")) return;
    if (!behavior?.uuid || behavior.disabled) return;
    if (getSetting("damageEmanationCombatOnly") && !turnKey) return;

    const activity = getBehaviorActivity(behavior);
    if (!activity?.item) {
        debug(`Area Spells | No activity found for behavior ${behavior.uuid}`);
        // Tell the GM once why the area does nothing
        if (game.user.isActiveGM) {
            const region = behavior.region;
            if (!behavior.system.activity && !behavior.system.spell) {
                notifyOnce(`incomplete:${behavior.uuid}`, "ND5T.DamageEmanation.BehaviorIncomplete", { region: region?.name ?? "" },
                    `Area Spell Trigger behavior on "${region?.name ?? ""}": drop a spell onto its Spell field (or set an Activity), otherwise it does nothing.`);
            } else {
                const spell = region?.getFlag(MODULE_ID, "emanationItem")?.name ?? region?.name ?? "";
                notifyOnce(`lost:${behavior.uuid}`, "ND5T.DamageEmanation.ActivityLost", { spell },
                    `${spell}: the area's save or damage activity can't be found any more (the spell was removed or replaced). Remove the area, or drop the spell onto the Area Spell Trigger behavior again.`);
            }
        }
        return;
    }
    if (!getTriggers(behavior, activity.item).has(reason)) return;
    if (!isExecutor(activity.actor)) return;
    if (!isSpellStillActive(activity)) return;

    const region = behavior.region;
    const casterToken = region?.attachment?.token
        ?? fromUuidSync(region?.getFlag("dnd5e", "origin"), { strict: false });
    if (!_isAffected(token, casterToken, activity, behavior)) return;

    let queue = queues.get(behavior.uuid);
    if (turnKey) {
        if (behavior.system.triggered?.[token.id] === turnKey) return;
        if (triggeredLocal.get(behavior.uuid)?.get(token.id) === turnKey) return;
        if (queue?.entries.get(token.id)?.turnKey === turnKey) return;
    } else if (queue?.entries.has(token.id)) return;

    if (!queue) {
        queue = { entries: new Map(), timer: null };
        queues.set(behavior.uuid, queue);
    }
    queue.entries.set(token.id, { token, turnKey, mergeKey, reason });
    debug(`Area Spells | Queued ${token.name} (${reason}) for ${activity.item.name}`);

    clearTimeout(queue.timer);
    queue.timer = setTimeout(() => _flushQueue(behavior.uuid), BATCH_DELAY_MS);
}

/**
 * Process the queued triggers of one emanation.
 * @param {string} behaviorUuid
 */
async function _flushQueue(behaviorUuid) {
    const queue = queues.get(behaviorUuid);
    queues.delete(behaviorUuid);
    const entries = Array.from(queue?.entries.values() ?? []).filter(e => e.token.parent);
    const behavior = fromUuidSync(behaviorUuid, { strict: false });
    if (!entries.length || !behavior) return;

    // Record locally before anything is awaited, so triggers arriving meanwhile are de-duplicated
    _markTriggeredLocal(behaviorUuid, entries);
    await _markTriggered(behavior, entries);

    try {
        const mode = getSetting("damageEmanationMode");
        if (mode === "automatic") await executeAreaSpell(behavior, entries.map(e => e.token));
        else await postPrompt(behavior, entries, mode);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Area Spells: Failed to process triggers", err);
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
    const local = triggeredLocal.get(behaviorUuid) ?? new Map();
    for (const [tokenId, key] of local) {
        if (!key.startsWith(combatPrefix)) local.delete(tokenId);
    }
    for (const { token, turnKey } of keyed) local.set(token.id, turnKey);
    triggeredLocal.set(behaviorUuid, local);
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
        debug("Area Spells | Could not store triggered creatures", err);
    }
}
