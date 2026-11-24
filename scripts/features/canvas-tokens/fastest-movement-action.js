/**
 * Feature: Fastest Movement Action
 * Description: Tokens whose movement action is left on "Default" use the actor's fastest way of moving (e.g. Fly for a
 * creature that flies faster than it walks), and follow the actor when it gains or loses a speed.
 *
 * @introduced v14.112.0
 */
import { MODULE_ID, getSetting, log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fastest Movement Action
 * ---------------------------------------------------------------------------
 * Foundry V14 stores `movementAction: null` for a token whose action is "Default". `TokenDocument#prepareDerivedData`
 * fills it in with `this.movementAction ??= this._inferMovementAction()`, and core's `_inferMovementAction` returns
 * `CONFIG.Token.movement.defaultAction` ("walk"). dnd5e 6.0 / 6.1 override neither.
 *
 * This wraps `_inferMovementAction`, so nothing is written to the database: a token keeps "Default" and only the
 * derived action changes. An action picked on the Token HUD or token sheet is stored and wins, and choosing
 * "Default" again (or clicking the active HUD action) goes back to the inferred one. Prone Rules' crawl switch
 * restores `null` when the creature stands up, so it hands back to this feature.
 *
 * Which action: the actor's final speeds (`system.attributes.movement.speeds`, after conditions, exhaustion and
 * encumbrance; same path in 6.0 and 6.1):
 *   - Fly if it is faster than walking (ties stay on walk).
 *   - Swim, climb and burrow only count when the creature has no walking speed (a shark swims, a crocodile on a
 *     land map keeps walking). Hidden types (jump) never count.
 *   - Otherwise the core default.
 * Grappled / Restrained (all speeds 0) and Prone (only walking left) therefore drop a flier to walking, matching
 * dnd5e's own falling check, and it flies again once the condition ends.
 *
 * Refresh: an actor change does not re-prepare its tokens. Core only re-prepares bars in
 * `TokenDocument#_onRelatedUpdate`, which every actor, actor delta and embedded item / effect change goes through
 * (linked and unlinked). A wrapper there re-infers the action before core re-renders the Token HUD.
 *
 * Lazy deltas: reading `token.actor` materializes an unlinked token's ActorDelta, which core avoids during data
 * preparation. Lazy tokens use the base actor instead; when the delta materializes, core resets the token and the
 * action is inferred again from the synthetic actor.
 */

const SETTING = "enableFastestMovementAction";
const TOKEN_DOCUMENT = "CONFIG.Token.documentClass.prototype";

export function initFastestMovementAction() {
    patchMethod(`${TOKEN_DOCUMENT}._inferMovementAction`, _wrapInferMovementAction, "WRAPPER");
    patchMethod(`${TOKEN_DOCUMENT}._onRelatedUpdate`, _wrapOnRelatedUpdate, "WRAPPER");
    log("Fastest Movement Action | Patched TokenDocument _inferMovementAction and _onRelatedUpdate.");
}

/**
 * Re-infers the action of every token in the world, e.g. after the setting changed.
 */
export function refreshFastestMovementActions() {
    for (const scene of game.scenes) {
        for (const token of scene.tokens) _refreshToken(token);
    }
}

function _wrapInferMovementAction(wrapped, ...args) {
    const fallback = wrapped(...args);
    try {
        if (!getSetting(SETTING)) return fallback;
        return _fastestAction(this) ?? fallback;
    } catch (err) {
        console.error(`${MODULE_ID} | Fastest Movement Action failed`, err);
        return fallback;
    }
}

function _wrapOnRelatedUpdate(wrapped, ...args) {
    try {
        if (getSetting(SETTING)) _refreshToken(this, { render: false });
    } catch (err) {
        console.error(`${MODULE_ID} | Fastest Movement Action refresh failed`, err);
    }
    // Core re-renders an open Token HUD in here
    return wrapped(...args);
}

/**
 * Updates the derived action of a token left on "Default".
 * @param {TokenDocument} token
 * @param {object} [options]
 * @param {boolean} [options.render=true]  Re-render the Token HUD if it is open on this token
 */
function _refreshToken(token, { render = true } = {}) {
    if (token._source.movementAction) return;
    const action = token._inferMovementAction();
    if (token.movementAction === action) return;
    token.movementAction = action;
    if (render && token.rendered && token.object?.hasActiveHUD) canvas.tokens.hud.render();
}

/**
 * @param {TokenDocument} token
 * @returns {string|null}  The movement action to use, or null for the default
 */
function _fastestAction(token) {
    const actor = token.isLazyDelta ? token.baseActor : token.actor;
    const speeds = actor?.system?.attributes?.movement?.speeds;
    if (!speeds) return null;

    const actions = CONFIG.Token.movement.actions;
    const walk = Number(speeds.walk) || 0;
    let best = null;
    let bestSpeed = walk;
    for (const [type, config] of Object.entries(CONFIG.DND5E.movementTypes)) {
        if ((type === "walk") || config.hidden || !actions[type]) continue;
        if ((type !== "fly") && (walk > 0)) continue;
        const speed = Number(speeds[type]) || 0;
        if (speed <= bestSpeed) continue;
        if (!actions[type].canSelect(token)) continue;
        best = type;
        bestSpeed = speed;
    }
    return best;
}
