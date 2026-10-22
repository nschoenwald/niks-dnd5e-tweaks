/**
 * Feature: Token Resource Bar Refresh Patch
 * Description: Fixes an upstream Foundry V14 core bug where the first HP change of an unlinked token in a session does not redraw its resource bar.
 *
 * @introduced v14.48.1
 */
import { log } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Stale Token Resource Bars After First Actor Update — Unlinked Tokens
 * ---------------------------------------------------------------------------
 * Foundry V14 core only redraws token bars from the bar animation started at the
 * end of `TokenDocument#_onRelatedUpdate`. On the first related update of an
 * unlinked token, that animation sees no change:
 *
 *  1. `TokenDocument#prepareBaseData` seeds `_priorOverrides` with the empty,
 *     pre-ActiveEffect `overrides` object. D&D 5e's token size sync adds
 *     width/height/depth token changes, so the first `_onRelatedUpdate` treats
 *     the overrides as changed and calls `Token#_onUpdate({})`.
 *  2. That empty update starts an empty token animation, whose single frame runs
 *     `mergeObject(this.document, this.#animationData)` and writes the cached
 *     (pre-update) bar values back over the freshly prepared `bar1`/`bar2`.
 *  3. The bar animation then animates from the old value to the old value,
 *     completes with duration 0 and never sets `refreshBars`.
 *
 * The document data is correct again after D&D 5e's own reset, so the bar only
 * needs one redraw. D&D 5e draws the HP bar straight from the actor, so this
 * patch requests a `refreshBars` after every related update.
 *
 * Fixed upstream in Foundry V14.370, so the patch only applies to 14.369 and lower.
 */
const FIXED_IN_VERSION = "14.370";

export function initFixTokenBarRefresh() {
    if (!foundry.utils.isNewerVersion(FIXED_IN_VERSION, game.version)) {
        log(`Skipped token bar refresh patch (fixed in Foundry ${FIXED_IN_VERSION}, running ${game.version})`);
        return;
    }

    patchMethod("CONFIG.Token.documentClass.prototype._onRelatedUpdate", function patchedOnRelatedUpdate(wrapped, ...args) {
        const result = wrapped(...args);
        if (this.rendered) this.object?.renderFlags.set({ refreshBars: true });
        return result;
    }, "WRAPPER");

    log("Patched TokenDocument._onRelatedUpdate to refresh token bars after actor updates");
}
