/**
 * Area Spell Automation: Client-side state shared by the modules, and its cleanup.
 * Part of the feature in `./index.js` (history and overview there).
 */

/** @type {Map<string, {entries: Map<string, {token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}>, timer: number}>} */
export const queues = new Map();

/**
 * Behavior UUID -> tokens whose next "enter" event without movement is ignored: tokens inside when
 * the emanation is created, enabled or revealed, and tokens created inside it.
 * @type {Map<string, {tokenIds: Set<string>, expires: number}>}
 */
export const suppressedEnters = new Map();

/**
 * Behavior UUID -> (token ID -> turn key) of triggers already processed on this client. Covers the
 * time until `system.triggered` is stored, and users who can't update the behavior.
 * @type {Map<string, Map<string, string>>}
 */
export const triggeredLocal = new Map();

/** @type {Map<string, string>} Activity UUID -> last chosen damage type (client-local fallback) */
export const rememberedDamageTypes = new Map();

/** @type {Map<string, Promise>} Behavior UUID -> pending prompt post, so cards are merged in order */
export const promptLocks = new Map();

/** @type {Set<string>} Prompt message IDs being resolved on this client, so only one click wins */
export const claimedPrompts = new Set();

/** @type {Map<string, Function>} Claim request ID -> callback receiving whether the claim was granted */
export const pendingClaims = new Map();

/**
 * Activity UUID -> target descriptors for the damage roll a damage activity makes right after its use.
 * dnd5e builds that roll's targets from the user's targets, not from the usage message.
 * @type {Map<string, object[]>}
 */
export const pendingDamageTargets = new Map();

/**
 * Forget the client-side state kept for an emanation behavior.
 * @param {string} behaviorUuid
 */
export function clearBehaviorState(behaviorUuid) {
    const queue = queues.get(behaviorUuid);
    if (queue) clearTimeout(queue.timer);
    queues.delete(behaviorUuid);
    suppressedEnters.delete(behaviorUuid);
    triggeredLocal.delete(behaviorUuid);
    promptLocks.delete(behaviorUuid);
}
