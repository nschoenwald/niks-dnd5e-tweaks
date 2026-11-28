/**
 * Conditional Damage Bonuses: Combat, turn and movement checks, and the once-per-turn usage tracking.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { convertLength } from "../../../utils/dnd5e-compat.js";
import { isSharedTurn } from "../summon-initiative.js";

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

        // A companion acting in its summoner's turn
        if (isSharedTurn(combat, actor, (token instanceof foundry.documents.TokenDocument) ? token : (token?.document ?? null))) {
            return true;
        }

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
