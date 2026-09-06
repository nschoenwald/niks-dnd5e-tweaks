import { MODULE_ID, debug, log } from "../main.js";

/**
 * Template Auto-Targeting
 *
 * When a dnd5e spell or ability template is placed on the canvas, automatically
 * targets all tokens whose position falls inside the template area.
 *
 * Two mechanisms work together:
 * 1. dnd5e.createActivityTemplate — fires when AbilityTemplate instances are
 *    created (before drawPreview). We wrap each template's refresh() method
 *    so that targeting updates every time the template moves.
 * 2. createRegion — fires once when placement is confirmed and the Region is
 *    persisted. Finalises targeting using the TokenDocument#testInsideRegion
 *    API. Deferred by one tick to allow the Region's polygon tree to initialise.
 *
 * Guards:
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
 * No-op when midi-qol is active.
 */
export function initTemplateTargeting() {
    // Completely disabled when midi-qol is active — it has its own template
    // auto-targeting feature and running both would cause conflicts.
    if (game.modules.get("midi-qol")?.active) {
        log("Template Targeting | midi-qol is active, feature disabled");
        return;
    }

    // Live preview: wrap template.refresh() on each AbilityTemplate instance
    // created by a dnd5e activity. This hook fires before drawPreview() is called,
    // giving us the template instances. Approach mirrors template-grid-snap.js.
    Hooks.on("dnd5e.createActivityTemplate", _onCreateActivityTemplate);

    // Final placement: re-run containment against the persisted RegionDocument.
    Hooks.on("createRegion", _onCreateRegion);

    log("Template Targeting | Initialized (Region mode)");
}

// ── Hook Handlers ────────────────────────────────────────────────────

/**
 * Live preview: wrap each AbilityTemplate's refresh() method to update
 * targeting every time the template is redrawn.
 *
 * The dnd5e.createActivityTemplate hook fires after AbilityTemplate.fromActivity()
 * constructs the template objects but before drawPreview() is called, giving us
 * a clean point to override instance methods — the same approach used by
 * template-grid-snap.js for getSnappedPosition.
 *
 * @param {Activity} activity           The dnd5e Activity for which templates are placed.
 * @param {AbilityTemplate[]} templates The template instances being placed.
 */
function _onCreateActivityTemplate(activity, templates) {
    if (!game.settings.get(MODULE_ID, "enableTemplateTargeting")) return;

    debug(`Template Targeting | dnd5e.createActivityTemplate fired for activity ${activity?.name ?? "(unknown)"}, wrapping ${templates.length} template(s)`);

    for (const template of templates) {
        // Wrap refresh() to update targets on every redraw during placement preview.
        const originalRefresh = template.refresh.bind(template);
        template.refresh = function(options) {
            const result = originalRefresh(options);
            // Guard canvas in case refresh fires after placement is complete
            if (canvas?.tokens) {
                _applyTargetsFromPreviewTemplate(this);
            }
            return result;
        };
    }
}

/**
 * Post-placement: finalise targets once when the Region document is created.
 *
 * When the user confirms template placement, dnd5e calls
 * canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [...]) which Foundry
 * V14 routes to a Region creation. The createRegion hook fires on all clients;
 * we guard to only process it for the creating user.
 *
 * NOTE: Foundry post-create hooks for embedded documents use the 3-parameter
 * signature (document, options, userId) — NOT 4 parameters. The extra `data`
 * parameter only exists on preCreate hooks.
 *
 * Processing is deferred by one tick (setTimeout 0) to allow Foundry to build
 * the Region's polygon tree before we call testInsideRegion().
 *
 * @param {RegionDocument} regionDoc  The newly created Region document.
 * @param {object} options            Creation options.
 * @param {string} userId             The ID of the user who triggered the creation.
 */
function _onCreateRegion(regionDoc, options, userId) {
    // Guard 1: setting enabled
    if (!game.settings.get(MODULE_ID, "enableTemplateTargeting")) {
        debug("Template Targeting | createRegion: setting disabled, skipping");
        return;
    }

    // Guard 2: dnd5e activity template flag
    if (!regionDoc.flags?.dnd5e?.origin) {
        debug("Template Targeting | createRegion: no flags.dnd5e.origin, not a dnd5e template, skipping");
        return;
    }

    // Guard 3: only the placing user runs this
    if (userId !== game.user.id) {
        debug(`Template Targeting | createRegion: userId ${userId} !== game.user.id ${game.user.id}, skipping`);
        return;
    }

    if (!canvas?.tokens) {
        debug("Template Targeting | createRegion: no canvas.tokens, skipping");
        return;
    }

    debug(`Template Targeting | createRegion: all guards passed for region ${regionDoc.id}, deferring containment check`);

    // Defer by one tick so the Region's polygon tree is fully built before
    // we call testInsideRegion().
    setTimeout(() => {
        _applyTargetsFromRegion(regionDoc);
    }, 0);
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
 * @param {AbilityTemplate} template  The live preview AbilityTemplate placeable.
 */
function _applyTargetsFromPreviewTemplate(template) {
    if (!template.shape) return;

    const grid = canvas.scene?.grid;
    if (!grid) return;

    // Use world position from the placeable itself (template.x/y) with fallback
    // to the underlying document, matching midi-qol's approach.
    const originX = template.document?.x ?? template.x ?? 0;
    const originY = template.document?.y ?? template.y ?? 0;

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
                const localX = worldX - originX;
                const localY = worldY - originY;
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
    // canvas.tokens.setTargets() is the correct V14 API (game.user.updateTokenTargets
    // was retired as part of V12 deprecation cleanup in V14).
    canvas.tokens?.setTargets(targets);
}

/**
 * Compute which tokens fall inside a persisted Region (final placement) and
 * replace game.user.targets with exactly that set.
 *
 * Uses the V14 native TokenDocument#testInsideRegion() API. Called after a
 * one-tick delay from createRegion to allow the polygon tree to be ready.
 *
 * @param {RegionDocument} regionDoc  The persisted Region document.
 */
function _applyTargetsFromRegion(regionDoc) {
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
    canvas.tokens?.setTargets(targets);
}
