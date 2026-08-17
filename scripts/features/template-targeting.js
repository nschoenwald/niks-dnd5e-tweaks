import { MODULE_ID, debug, log } from "../main.js";

/**
 * Template Auto-Targeting (V14 only)
 *
 * When a dnd5e spell or ability template is placed on the canvas, automatically
 * targets all tokens whose position falls inside the template area.
 *
 * Two hooks work together:
 * 1. refreshMeasuredTemplate — fires repeatedly while the user drags the template
 *    during placement preview. Updates targets live so the placing user can see
 *    which tokens will be affected before confirming placement. Uses
 *    template.shape.contains() geometry (template-local coordinates) to check
 *    each grid square that a token occupies.
 * 2. createRegion — fires once when placement is confirmed and the Region is
 *    persisted. Re-runs the containment check using the V14 native
 *    TokenDocument#testInsideRegion() API for accuracy against the final geometry.
 *
 * Guards:
 * - V14 only (returns immediately on V13, checked in initTemplateTargeting).
 * - Completely disabled when midi-qol is active (it has its own targeting).
 * - Only the user who placed the template updates their own game.user.targets;
 *   all other clients skip both hooks.
 *
 * Targets are REPLACED (not merged) on each update, matching midi-qol behavior.
 */

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the Template Auto-Targeting feature.
 * Called once during the "setup" phase from main.js.
 * No-op on Foundry V13 and when midi-qol is active.
 */
export function initTemplateTargeting() {
    // V14-only: this feature relies on the Region document system
    if (game.release.generation < 14) return;

    // Completely disabled when midi-qol is active — it has its own template
    // auto-targeting feature and running both would cause conflicts.
    if (game.modules.get("midi-qol")?.active) {
        log("Template Targeting | midi-qol is active, feature disabled");
        return;
    }

    Hooks.on("refreshMeasuredTemplate", _onRefreshMeasuredTemplate);
    Hooks.on("createRegion", _onCreateRegion);

    log("Template Targeting | Initialized (V14 Region mode)");
}

// ── Hook Handlers ────────────────────────────────────────────────────

/**
 * Live preview: update targets while the user drags the template.
 *
 * The refreshMeasuredTemplate hook fires on every mouse-move (throttled by
 * dnd5e to ~20ms) during template placement. We use the live MeasuredTemplate
 * placeable's .shape property to compute containment in template-local
 * coordinates, then replace game.user.targets with the result.
 *
 * Only fires processing for the user who is placing the template.
 *
 * @param {MeasuredTemplate} template   The live preview MeasuredTemplate placeable.
 * @param {Record<string,boolean>} flags  Refresh flags from Foundry indicating what changed.
 */
function _onRefreshMeasuredTemplate(template, flags) {
    // Only process when position or shape changed (not just visual updates)
    if (!flags.refreshPosition && !flags.refreshShape) return;
    if (!game.settings.get(MODULE_ID, "enableTemplateTargeting")) return;
    if (!canvas?.tokens) return;

    // Only the placing user updates their own targets
    if (template.document.author?.id !== game.user?.id) return;

    // Only dnd5e activity templates:
    // - template.activity is set on the AbilityTemplate instance during preview
    // - flags.dnd5e.origin is set on the document when already placed (edge case)
    if (!template.activity && !template.document.flags?.dnd5e?.origin) return;

    _applyTargetsFromPreviewTemplate(template);
}

/**
 * Post-placement: finalize targets once when the Region document is created.
 *
 * When the user left-clicks to confirm template placement, dnd5e calls
 * canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [...]) which Foundry
 * V14 routes to a Region creation. The createRegion hook fires on all clients,
 * but we only process it for the creating user (userId === game.user.id).
 *
 * Uses the V14 native TokenDocument#testInsideRegion() API for the final check.
 *
 * @param {RegionDocument} regionDoc  The newly created Region document.
 * @param {object} data               The creation data.
 * @param {object} options            Creation options.
 * @param {string} userId             The ID of the user who triggered the creation.
 */
function _onCreateRegion(regionDoc, data, options, userId) {
    if (!game.settings.get(MODULE_ID, "enableTemplateTargeting")) return;

    // Only process dnd5e activity spell/ability templates.
    // All dnd5e activity templates carry flags.dnd5e.origin (the activity UUID).
    if (!regionDoc.flags?.dnd5e?.origin) return;

    // Only the placing user updates their own targets.
    if (userId !== game.user.id) return;

    if (!canvas?.tokens) return;

    const targets = [];
    for (const token of (canvas.tokens?.placeables ?? [])) {
        if (!token.document) continue;
        try {
            if (token.document.testInsideRegion(regionDoc)) targets.push(token.id);
        } catch (e) {
            debug("Template Targeting | testInsideRegion error:", e);
        }
    }

    debug(`Template Targeting | Final placement: targeting ${targets.length} token(s) in region ${regionDoc.id}`);

    // Replace all existing targets with exactly the tokens inside the template.
    game.user.updateTokenTargets(targets);
}

// ── Containment Helpers ──────────────────────────────────────────────

/**
 * Compute which tokens fall inside a live MeasuredTemplate preview and
 * replace game.user.targets with exactly that set.
 *
 * Checks the center of each grid square that the token occupies against
 * template.shape.contains(localX, localY) in template-local coordinates.
 * For multi-square tokens (Large, Huge, Gargantuan) we check every occupied
 * square and treat the token as inside if any square is covered.
 *
 * Coordinates are converted to template-local space by subtracting the
 * template's world position (template.document.x, template.document.y).
 *
 * @param {MeasuredTemplate} template  The live preview MeasuredTemplate placeable.
 */
function _applyTargetsFromPreviewTemplate(template) {
    if (!template.shape) return;

    const grid = canvas.scene?.grid;
    if (!grid) return;

    const templatePos = { x: template.document.x, y: template.document.y };
    const targets = [];

    for (const token of (canvas.tokens?.placeables ?? [])) {
        if (!token.document) continue;

        // For tokens narrower than 1 grid unit, start from the center of the
        // (fractional) token space. For >= 1 grid unit, check each full square.
        const startX = token.document.width >= 1 ? 0.5 : (token.document.width / 2);
        const startY = token.document.height >= 1 ? 0.5 : (token.document.height / 2);

        let inside = false;
        outer: for (let x = startX; x < token.document.width; x++) {
            for (let y = startY; y < token.document.height; y++) {
                // World-space center of this grid square
                const worldX = token.x + x * grid.size;
                const worldY = token.y + y * grid.size;
                // Convert to template-local coordinates
                const localX = worldX - templatePos.x;
                const localY = worldY - templatePos.y;
                if (template.shape.contains(localX, localY)) {
                    inside = true;
                    break outer;
                }
            }
        }
        if (inside) targets.push(token.id);
    }

    debug(`Template Targeting | Preview: ${targets.length} token(s) in template`);

    // Replace all existing targets with exactly the tokens inside the template.
    game.user.updateTokenTargets(targets);
}
