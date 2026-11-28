/**
 * Finding the started combat a creature takes part in, wherever it runs: the viewed combat first, then every other
 * active, started combat (combats on other scenes). Shared by Conditional Damage, Reckless Attack, Brutal Strike and
 * the other features that count turns, so they agree on whose turn it is.
 *
 * @introduced v14.121.0 (moved out of Conditional Damage)
 */

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
