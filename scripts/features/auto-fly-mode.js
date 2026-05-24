import { MODULE_ID, debug } from "../main.js";

/**
 * Auto Fly Mode
 *
 * When dragging an NPC token onto the canvas, automatically sets the
 * token's movement mode to "fly" if the actor's fly speed is at least
 * as large as its walk speed.
 *
 * Uses the `preCreateToken` hook to intercept the token data before it
 * is persisted.  This ensures the token lands on the scene already
 * configured for flying movement — the GM does not need to change it
 * manually afterward.
 *
 * Compatible with Foundry V13 and V14.
 */

/**
 * Determine whether the actor's fly speed meets the threshold.
 * @param {Actor} actor
 * @returns {boolean}
 */
function _shouldAutoFly(actor) {
    const movement = actor?.system?.attributes?.movement;
    if (!movement) return false;

    const walk = movement.walk ?? 0;
    const fly  = movement.fly  ?? 0;

    // Only trigger if the creature actually has a fly speed
    // and it is at least as large as its walk speed.
    return fly > 0 && fly >= walk;
}

/**
 * `preCreateToken` hook handler.
 *
 * Modifies the pending token document data to set `movementAction`
 * to "fly" when the actor qualifies.
 *
 * @param {TokenDocument} tokenDoc  The about-to-be-created token document
 * @param {object}        data      The raw creation data
 * @param {object}        options   Creation options
 * @param {string}        userId    The ID of the requesting user
 */
function _onPreCreateToken(tokenDoc, data, options, userId) {
    if (!game.settings.get(MODULE_ID, "enableAutoFlyMode")) return;

    // Only the GM client should process this.
    if (!game.user.isGM) return;

    // Only apply to NPC actors.
    const actor = tokenDoc.actor ?? game.actors.get(data.actorId);
    if (!actor || actor.type !== "npc") return;

    // Check whether a "fly" movement action actually exists in the
    // current configuration (guard against systems or setups that
    // don't define it).
    if (!CONFIG.Token?.movement?.actions?.fly) {
        debug("Auto-Fly | No 'fly' movement action registered — skipping");
        return;
    }

    if (!_shouldAutoFly(actor)) return;

    debug(`Auto-Fly | Setting movement mode to "fly" for ${actor.name} `
        + `(walk: ${actor.system.attributes.movement.walk}, `
        + `fly: ${actor.system.attributes.movement.fly})`);

    tokenDoc.updateSource({ movementAction: "fly" });
}

/**
 * Initialize the feature by registering the preCreateToken hook.
 * Called once during the "setup" phase from main.js.
 */
export function initAutoFlyMode() {
    Hooks.on("preCreateToken", _onPreCreateToken);
}
