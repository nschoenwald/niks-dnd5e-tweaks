import { MODULE_ID, log, debug } from "../main.js";

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
    if (!game.settings.get(MODULE_ID, "disableUndergroundTokenHiding")) return;

    // Determine the correct Token class — dnd5e may extend it as Token5e
    const TokenClass = CONFIG.Token?.objectClass
        ?? CONFIG.Canvas?.layers?.tokens?.objectClass
        ?? foundry.canvas?.placeables?.Token;

    if (!TokenClass) {
        log("Warning: Could not find Token class to wrap _refreshElevation");
        return;
    }

    const originalRefreshElevation = TokenClass.prototype._refreshElevation;
    if (typeof originalRefreshElevation !== "function") {
        log("Warning: Token._refreshElevation is not a function, skipping wrap");
        return;
    }

    TokenClass.prototype._refreshElevation = function () {
        // Call the original method first — it sets this.mesh.elevation etc.
        originalRefreshElevation.call(this);

        // Guard: skip if the token placeable or its document is destroyed
        if (this.destroyed || this._destroyed || !this.document) return;

        // If the token's document elevation is negative, clamp the mesh
        // elevation to 0 so the token renders above the background layer.
        // We check this.mesh or this.primaryGraphic.
        const elevation = this.document.elevation;
        if (elevation == null || elevation >= 0) return;

        const mesh = this.mesh ?? this.primaryGraphic;
        if (mesh && !mesh.destroyed && typeof mesh.elevation === "number" && mesh.elevation < 0) {
            debug(`Clamping token "${this.document.name}" mesh elevation from ${mesh.elevation} to 0`);
            mesh.elevation = 0;
        }
    };

    log("Disabled underground token hiding (wrapped Token._refreshElevation)");
}
