import { MODULE_ID, debug } from "../main.js";

/**
 * Auto-Add Tokens to Combat & Roll Initiative
 *
 * Automatically adds tokens to the active combat encounter and rolls their initiative
 * when they are created or dragged to the canvas during combat.
 */

export function initAutoAddTokensToCombat() {
    Hooks.on("createToken", _onCreateToken);
    debug("Auto-Add Tokens to Combat | Initialized");
}

/**
 * Handler for createToken hook.
 * @param {TokenDocument} tokenDocument
 * @param {object} options
 * @param {string} userId
 */
function _onCreateToken(tokenDocument, options, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoAddTokensToCombat")) return;

        // Primary GM check to ensure single client execution
        const activeGM = game.users.primaryGM ?? game.users.activeGM;
        if (!activeGM?.isSelf) return;

        // Check if an active combat exists
        const combat = game.combat ?? game.combats?.active;
        if (!combat) return;

        // Check if combat belongs to the scene where token was created
        const tokenScene = tokenDocument.parent;
        if (combat.scene && tokenScene && combat.scene.id !== tokenScene.id) return;

        // Prevent duplicate combatants if token is already in combat
        const existingCombatant = combat.combatants.some(c => c.tokenId === tokenDocument.id);
        if (existingCombatant) return;

        // Skip tokens created via a summon activity
        if (_isSummonedToken(tokenDocument)) {
            debug(`Auto-Add Tokens to Combat | Skipping token "${tokenDocument.name}" (${tokenDocument.id}) created via summon activity.`);
            return;
        }

        debug(`Auto-adding token "${tokenDocument.name}" (${tokenDocument.id}) to combat ${combat.id} and rolling initiative.`);

        queueMicrotask(async () => {
            try {
                await combat.createEmbeddedDocuments("Combatant", [{
                    tokenId: tokenDocument.id,
                    sceneId: tokenScene?.id,
                    actorId: tokenDocument.actorId,
                    hidden: tokenDocument.hidden
                }]);
            } catch (err) {
                console.error(`${MODULE_ID} | Failed to auto-add token to combat:`, err);
            }
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Error in createToken hook for Auto-Add Tokens to Combat:`, err);
    }
}

/**
 * Helper to check if a token was created via a summon activity.
 * @param {TokenDocument} tokenDocument
 * @returns {boolean}
 */
function _isSummonedToken(tokenDocument) {
    const actor = tokenDocument.actor;
    if (actor?.getFlag?.("dnd5e", "summon") || actor?.getFlag?.("dnd5e", "summon.origin") || actor?.flags?.dnd5e?.summon) return true;
    if (tokenDocument.getFlag?.("dnd5e", "summon") || tokenDocument.getFlag?.("dnd5e", "summon.origin") || tokenDocument.flags?.dnd5e?.summon) return true;
    if (tokenDocument.delta?.flags?.dnd5e?.summon) return true;
    return false;
}

