/**
 * Feature: Region Effects on Deleted Tokens Patch
 * Description: Deleting an unlinked token that stands in an area with an "Apply Active Effect" behavior (e.g. the
 * halved speed of Spirit Guardians) no longer shows a "does not exist" error.
 *
 * @introduced v14.115.4
 */
import { MODULE_ID, log } from "../../context.js";

/**
 * Fix: Effect Removal on Deleted Unlinked Tokens
 * ---------------------------------------------------------------------------
 * Foundry V14 fires TOKEN_EXIT for every region a token stood in when the token is deleted
 * (`TokenDocument._onDeleteOperation`, after the server already deleted it). The "Apply Active Effect" behaviors
 * of core (`applyActiveEffect`) and D&D 5e (`dnd5e.applyActiveEffect`, and `dnd5e.antimagic`, which inherits its
 * events) then delete their effect from `token.actor`. For an unlinked token that actor is synthetic: the
 * deletion goes through the deleted token's ActorDelta, the server can't find the token and answers
 * "undefined id [<token id>] does not exist in the EmbeddedCollection collection", shown as an error toast.
 * Seen with Foundry 14.370, D&D 5e 6.0.6 / 6.1.x; not fixed upstream yet, so not version-gated.
 *
 * The exit handler is skipped for an unlinked token that is no longer in its scene: its effects went with it.
 * Linked tokens keep the handler, because the world actor still carries the effect and it must be removed.
 * The handlers live in each behavior type's static `events` object (dispatched by
 * `RegionBehavior#_handleRegionEvent` through `system.constructor.events[name]`), so the entry there is wrapped.
 */
const PATCHED = Symbol(`${MODULE_ID}.deletedTokenExit`);

export function initFixRegionEffectDeletedToken() {
    const types = ["applyActiveEffect", "dnd5e.applyActiveEffect"];
    let count = 0;
    for (const type of types) {
        const events = CONFIG.RegionBehavior?.dataModels?.[type]?.events;
        const exit = CONST.REGION_EVENTS.TOKEN_EXIT;
        const original = events?.[exit];
        if ((typeof original !== "function") || original[PATCHED]) continue;
        const wrapped = async function(event) {
            const token = event?.data?.token;
            if (token && !token.actorLink && token.parent && !token.parent.tokens?.has(token.id)) return;
            return original.call(this, event);
        };
        wrapped[PATCHED] = true;
        events[exit] = wrapped;
        count++;
    }
    log(`Fix: Region Effects on Deleted Tokens | Patched ${count} behavior type(s).`);
}
