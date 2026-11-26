/**
 * Feature: Region Effects on Deleted Tokens Patch
 * Description: Deleting an unlinked token that stands in an area with D&D 5e's "Apply Active Effect" behavior (e.g.
 * the halved speed of Spirit Guardians) no longer shows a "does not exist" error.
 *
 * @introduced v14.115.4
 * @updated v14.115.6 (core's behavior moved to niks-foundry-tweaks 14.21.0; only D&D 5e's behavior is patched here)
 */
import { MODULE_ID, log } from "../../context.js";

/**
 * Fix: Effect Removal on Deleted Unlinked Tokens
 * ---------------------------------------------------------------------------
 * Foundry V14 fires TOKEN_EXIT for every region a token stood in when the token is deleted
 * (`TokenDocument._onDeleteOperation`, after the server already deleted it and after the token left
 * `scene.tokens`). D&D 5e's `ApplyActiveEffect5eRegionBehaviorType#onTokenExit` (and `AntimagicRegionBehaviorType`,
 * which inherits its static `events`) then deletes its effect from `token.actor`. For an unlinked token that actor
 * is synthetic: the deletion goes through the deleted token's ActorDelta, the server can't find the token and
 * answers "undefined id [<token id>] does not exist in the EmbeddedCollection collection", shown as an error toast.
 * Seen with Foundry 14.370, D&D 5e 6.0.6 / 6.1.x; not fixed upstream yet, so not version-gated.
 *
 * D&D 5e's handler is its own copy of core's, which has the same bug. Core's behavior (`applyActiveEffect`) is
 * patched by niks-foundry-tweaks (14.21.0), since it isn't specific to D&D 5e.
 *
 * The exit handler is skipped for an unlinked token that is no longer in its scene: its effects went with it.
 * Linked tokens keep the handler, because the world actor still carries the effect and it must be removed.
 * The handler lives in the behavior type's static `events` object (dispatched by `RegionBehavior#_handleRegionEvent`
 * through `system.constructor.events[name]`), so that entry is wrapped.
 */
const PATCHED = Symbol(`${MODULE_ID}.deletedTokenExit`);

/**
 * Whether a region event is the exit of an unlinked token that was deleted.
 * @param {RegionEvent} event
 * @returns {boolean}
 */
function _isDeletedUnlinkedToken(event) {
    const token = event?.data?.token;
    return !!token && !token.actorLink && !!token.parent && !token.parent.tokens?.has(token.id);
}

export function initFixRegionEffectDeletedToken() {
    const events = CONFIG.RegionBehavior?.dataModels?.["dnd5e.applyActiveEffect"]?.events;
    const exit = CONST.REGION_EVENTS.TOKEN_EXIT;
    const original = events?.[exit];
    if ((typeof original !== "function") || original[PATCHED]) return;
    const wrapped = async function(event) {
        if (_isDeletedUnlinkedToken(event)) return;
        return original.call(this, event);
    };
    wrapped[PATCHED] = true;
    events[exit] = wrapped;
    log("Fix: Region Effects on Deleted Tokens | Patched D&D 5e's Apply Active Effect behavior.");
}
