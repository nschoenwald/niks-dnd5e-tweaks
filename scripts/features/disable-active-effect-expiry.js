import { MODULE_ID, debug } from "../main.js";

/**
 * Disable Active Effect Expiry (DnD5e)
 *
 * In DnD5e 5.2+ and 6.0+, the system introduced automated Active Effect expiration and deletion:
 *   1. Out of combat, `ActiveEffect5e.prototype._onUpdate` deletes any effect when `data.duration.expired` is true.
 *   2. On combat exit, `Combat5e.prototype._onExit` batch-deletes all expired effects (`effect.duration.expired`)
 *      and pseudo-expired effects (`specialDuration`) from combatant actors and items.
 *   3. On resting, `Actor5e.prototype._onRestCompleted` checks `effect.isExpiryEvent(event)` and deletes
 *      effects associated with rest expiry events (e.g. short/long rest).
 *   4. Pseudo-expiries (turnStart, targetStart, sourceEnd, targetEnd) and time advancement are evaluated
 *      live via `ActiveEffect5e.prototype.isExpiryEvent`.
 *   5. When duration expires, Foundry's `super.isSuppressed` returns true because `this.duration.expired` is true,
 *      which stops the effect from applying changes to the actor.
 *   6. In Foundry V14+, `ActiveEffectRegistry` automatically tracks and executes `CONFIG.ActiveEffect.expiryAction`
 *      for registered effects when their expiry event or duration is reached.
 *
 * When this feature is enabled:
 *   - `_prepareDuration` suppresses `duration.expired = false`, preventing `super.isSuppressed` from deactivating
 *     effects when their numeric or turn duration elapses.
 *   - `_onUpdate` blocks `data.duration.expired` from triggering dnd5e's `this.delete()` out-of-combat deletion.
 *   - `Combat5e._onExit` bypasses dnd5e's batch deletion loop, invoking base `Combat.prototype._onExit` directly.
 *   - `isExpiryEvent` returns `false`, preventing rest-based deletions, turn-based pseudo-expiries, and out-of-combat
 *     time advancement deletions.
 *   - `isExpiryTrackable` returns `false` so Foundry V14's `ActiveEffectRegistry` does not register effects for expiry.
 *   - `CONFIG.ActiveEffect.expiryAction` is set to `null` on V14 to prevent core registry expiry actions.
 *   - Manual deletion by GMs and players remains fully functional.
 */

let _originalExpiryAction = undefined;

/**
 * Initialize monkey patches and hooks for disabling Active Effect expiry.
 * Should be invoked during the `init` hook.
 */
export function initDisableActiveEffectExpiry() {
    _patchPrepareDuration();
    _patchOnUpdate();
    _patchCombatOnExit();
    _patchIsExpiryEvent();
    _patchIsExpiryTrackable();

    Hooks.once("ready", () => {
        const enabled = game.settings.get(MODULE_ID, "disableActiveEffectExpiry");
        if (enabled) {
            updateV14ExpiryAction(true);
        }
    });

    debug("Disable Active Effect Expiry | Initialized");
}

/**
 * Patch `ActiveEffect5e.prototype._prepareDuration` to ensure `duration.expired` is kept `false`
 * when the feature is enabled. This prevents `super.isSuppressed` from suppressing the effect
 * and stops the effect from being categorized as inactive/expired on the sheet.
 */
function _patchPrepareDuration() {
    const effectClass = CONFIG.ActiveEffect?.documentClass;
    if (!effectClass?.prototype) return;
    const original = effectClass.prototype._prepareDuration;
    if (typeof original !== "function") return;

    effectClass.prototype._prepareDuration = function(duration, context) {
        duration = original.call(this, duration, context);
        if (game.settings?.get(MODULE_ID, "disableActiveEffectExpiry")) {
            if (duration && typeof duration === "object") {
                duration.expired = false;
            }
        }
        return duration;
    };
}

/**
 * Patch `ActiveEffect5e.prototype._onUpdate` to ensure `data.duration.expired` is forced `false`,
 * preventing dnd5e's out-of-combat `this.delete()` branch from ever executing.
 */
function _patchOnUpdate() {
    const effectClass = CONFIG.ActiveEffect?.documentClass;
    if (!effectClass?.prototype) return;
    const original = effectClass.prototype._onUpdate;
    if (typeof original !== "function") return;

    effectClass.prototype._onUpdate = function(data, options, userId) {
        if (game.settings?.get(MODULE_ID, "disableActiveEffectExpiry")) {
            if (data?.duration?.expired) {
                data = foundry.utils.duplicate(data);
                data.duration.expired = false;
            }
        }
        return original.call(this, data, options, userId);
    };
}

/**
 * Patch `Combat5e.prototype._onExit` to skip dnd5e's batch deletion of expired and pseudo-expired
 * active effects when a combatant exits combat or combat concludes.
 */
function _patchCombatOnExit() {
    const combatClass = CONFIG.Combat?.documentClass;
    if (!combatClass?.prototype) return;
    const original = combatClass.prototype._onExit;
    if (typeof original !== "function") return;

    combatClass.prototype._onExit = async function(combatant) {
        if (game.settings?.get(MODULE_ID, "disableActiveEffectExpiry")) {
            debug("Combat5e._onExit | Suppressed dnd5e active effect deletion on combat exit");
            const superOnExit = Object.getPrototypeOf(combatClass.prototype)?._onExit;
            if (superOnExit) return superOnExit.call(this, combatant);
            return;
        }
        return original.call(this, combatant);
    };
}

/**
 * Patch `ActiveEffect5e.prototype.isExpiryEvent` to return `false` when enabled.
 * This prevents:
 *  - Rest-based effect deletion in `Actor5e.prototype._onRestCompleted`.
 *  - Pseudo-expiry trigger in combat (`sourceStart`, `targetStart`, `sourceEnd`, `targetEnd`).
 *  - Out-of-combat `updateWorldTime` pseudo-expiry.
 *  - Foundry V14 ActiveEffectRegistry expiry evaluation.
 */
function _patchIsExpiryEvent() {
    const effectClass = CONFIG.ActiveEffect?.documentClass;
    if (!effectClass?.prototype) return;
    const original = effectClass.prototype.isExpiryEvent;

    effectClass.prototype.isExpiryEvent = function(event, context = {}) {
        if (game.settings?.get(MODULE_ID, "disableActiveEffectExpiry")) {
            return false;
        }
        return original ? original.call(this, event, context) : false;
    };
}

/**
 * Patch `isExpiryTrackable` getter to return `false` when enabled, so Foundry V14's
 * `ActiveEffectRegistry` does not register the effect for expiration tracking.
 */
function _patchIsExpiryTrackable() {
    const effectClass = CONFIG.ActiveEffect?.documentClass;
    if (!effectClass?.prototype) return;

    let targetProto = effectClass.prototype;
    let desc = Object.getOwnPropertyDescriptor(targetProto, "isExpiryTrackable");
    if (!desc && typeof foundry !== "undefined" && foundry.documents?.BaseActiveEffect?.prototype) {
        targetProto = foundry.documents.BaseActiveEffect.prototype;
        desc = Object.getOwnPropertyDescriptor(targetProto, "isExpiryTrackable");
    }

    if (desc?.get) {
        const originalGet = desc.get;
        Object.defineProperty(effectClass.prototype, "isExpiryTrackable", {
            get() {
                if (game.settings?.get(MODULE_ID, "disableActiveEffectExpiry")) {
                    return false;
                }
                return originalGet.call(this);
            },
            configurable: true,
            enumerable: true
        });
    }
}

/**
 * Handle Foundry V14 `CONFIG.ActiveEffect.expiryAction` configuration.
 * When enabled, sets expiryAction to null to prevent core registry from updating/deleting expired effects.
 * When disabled, restores the previous value.
 * @param {boolean} enabled
 */
export function updateV14ExpiryAction(enabled) {
    if (CONFIG.ActiveEffect && "expiryAction" in CONFIG.ActiveEffect) {
        if (enabled) {
            if (_originalExpiryAction === undefined) {
                _originalExpiryAction = CONFIG.ActiveEffect.expiryAction ?? "update";
            }
            CONFIG.ActiveEffect.expiryAction = null;
            debug(`V14 ActiveEffect.expiryAction set to null (was ${_originalExpiryAction})`);
        } else if (_originalExpiryAction !== undefined) {
            CONFIG.ActiveEffect.expiryAction = _originalExpiryAction;
            debug(`V14 ActiveEffect.expiryAction restored to ${_originalExpiryAction}`);
        }
    }
}

/**
 * Responds to setting changes at runtime.
 * @param {boolean} enabled
 */
export function onDisableActiveEffectExpiryChanged(enabled) {
    updateV14ExpiryAction(enabled);

    // Re-render any currently open actor or effect sheets so effect displays update immediately
    if (ui.windows) {
        for (const app of Object.values(ui.windows)) {
            if (app?.document?.documentName === "Actor" || app?.document?.documentName === "ActiveEffect") {
                app.render(false);
            }
        }
    }
}
