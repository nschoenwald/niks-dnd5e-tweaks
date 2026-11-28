/**
 * Conditional Damage Bonuses: Remembering attack rolls, so a damage roll knows its attack (natural 20, targets, melee hits for Combo Strikes).
 * Part of the feature in `./index.js` (history and overview there).
 */
import { getMidiWorkflow } from "../../../utils/module-compat.js";
import { getActiveCombat, getCombatTurnKey } from "./combat-turn.js";

/**
 * In-memory map of the most recent attack roll evaluated for each actor,
 * used to correlate damage rolls with attack d20 results (e.g. for Boon of Irresistible Offense).
 * Stores lightweight primitive flags rather than retaining full Roll instances in memory.
 * Keyed by actor UUID or ID.
 * @type {Map<string, { isNatural20: boolean, advantageMode: number|null, targets: string[], time: number, turnKey: string|null, combatId: string|null, activityId?: string, itemId?: string, messageId?: string, damageRolled?: boolean }>}
 */
export const lastAttackRollsByActor = new Map();

const ATTACK_ROLL_OUT_OF_COMBAT_TTL_MS = 180000; // 3 minutes out of combat for narrative / GM adjudication

const ATTACK_ROLL_COMBAT_TTL_MS = 60000;         // 1 minute safety TTL within combat

/**
 * Prune stale attack roll entries from memory.
 */
export function pruneStaleAttackRolls() {
    const now = Date.now();
    for (const [key, entry] of lastAttackRollsByActor.entries()) {
        const ttl = entry.combatId ? ATTACK_ROLL_COMBAT_TTL_MS : ATTACK_ROLL_OUT_OF_COMBAT_TTL_MS;
        if (now - (entry.time ?? 0) >= ttl) {
            lastAttackRollsByActor.delete(key);
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
export function recordAttackRoll(actor, roll, { activityId, itemId, messageId, targets } = {}) {
    if (!actor || !roll) return;
    pruneStaleAttackRolls();

    const actorKey = actor.uuid || actor.id;
    const combat = getActiveCombat(actor);
    const turnKey = getCombatTurnKey(combat, actor);

    lastAttackRollsByActor.set(actorKey, {
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
 * Melee hits per attacker, target and combat turn (Fists of Fury's Combo Strikes).
 * Keyed by `${actorKey}|${targetUuid}` → { turnKey, count }.
 * @type {Map<string, {turnKey: string, count: number}>}
 */
export const meleeHits = new Map();

/**
 * Count a melee hit on a single target, in combat: an attack whose damage was rolled. There is no AC check, since
 * rolling damage means the attack hit (Foundry's view can be wrong: cover, forgotten bonuses). Called from
 * dnd5e.rollDamage before the cached attack is marked as used, so each attack counts once.
 * @param {Actor5e} actor
 * @param {Activity} activity
 * @param {DamageRoll[]} rolls
 */
export function recordMeleeHit(actor, activity, rolls) {
    const combat = getActiveCombat(actor);
    const turnKey = getCombatTurnKey(combat, actor);
    if (!turnKey || !activity) return;
    const cached = _getCachedAttack(actor, { activity });
    if (!cached || (cached.targets.length !== 1)) return;
    const actionType = activity.getActionType?.(rolls?.[0]?.data?.roll?.attackMode) ?? activity.actionType;
    if (actionType !== "mwak") return;
    const targetUuid = cached.targets[0];
    const key = `${actor.uuid || actor.id}|${targetUuid}`;
    const entry = meleeHits.get(key);
    meleeHits.set(key, { turnKey, count: (entry?.turnKey === turnKey) ? entry.count + 1 : 1 });
}

/**
 * Melee hits on a target this turn before the current damage roll (which is counted once it is rolled).
 * @param {Actor5e} actor
 * @param {string} targetUuid
 * @param {string|null} turnKey
 * @returns {number}
 */
export function previousMeleeHits(actor, targetUuid, turnKey) {
    const entry = meleeHits.get(`${actor.uuid || actor.id}|${targetUuid}`);
    if (!turnKey || (entry?.turnKey !== turnKey)) return 0;
    return entry.count;
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
    pruneStaleAttackRolls();
    const cached = lastAttackRollsByActor.get(actor.uuid || actor.id);
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
