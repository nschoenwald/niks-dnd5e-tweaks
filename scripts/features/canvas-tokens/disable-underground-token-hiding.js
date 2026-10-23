/**
 * Feature: Disable Underground Token Hiding
 * Description: Prevents tokens with negative elevation from disappearing behind the scene background layer in Foundry canvas.
 *
 * @introduced v14.10.0
 */
import { getSetting, log, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Disable Underground Token Hiding
 *
 * By default, Foundry VTT renders tokens behind the scene background when
 * their elevation is negative. This happens because the PrimaryCanvasGroup
 * sorts objects by elevation, and the background sits at elevation 0.
 * Tokens below 0 are drawn behind the background, effectively hiding them.
 *
 * This feature wraps Token.prototype._refreshElevation to clamp the mesh's
 * render elevation to 0 when the document elevation is negative. The actual
 * elevation value in the document is preserved — only the sort/render order
 * is affected so the token stays visible above the background.
 *
 * Compatible with Foundry V14 (including native Scene Levels).
 * In V14 with Scene Levels, the background elevation is determined by the
 * level configuration; this tweak only adjusts tokens that would be hidden
 * behind the background.
 *
 * Called during the module's "init" hook. Requires a reload to take effect.
 */
export function initDisableUndergroundTokenHiding() {
    if (!getSetting("disableUndergroundTokenHiding")) return;

    patchMethod("CONFIG.Token.objectClass.prototype._refreshElevation", function patchedRefreshElevation(wrapped) {
        wrapped();

        // Guard: skip if the token placeable or its document is destroyed
        if (this.destroyed || this._destroyed || !this.document) return;

        // If the token's document elevation is negative, clamp the mesh
        // elevation to 0 so the token renders above the background layer.
        const elevation = this.document.elevation;
        if (elevation == null || elevation >= 0) return;

        const mesh = this.mesh ?? this.primaryGraphic;
        if (mesh && !mesh.destroyed && typeof mesh.elevation === "number" && mesh.elevation < 0) {
            debug(`Clamping token "${this.document.name}" mesh elevation from ${mesh.elevation} to 0`);
            mesh.elevation = 0;
        }
    }, "WRAPPER");

    log("Disabled underground token hiding (wrapped Token._refreshElevation)");
}
