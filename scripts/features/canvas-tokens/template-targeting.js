/**
 * Feature: Auto-Target Tokens in Spell Templates
 * Description: Automatically targets tokens enclosed within spell or ability templates placed on the canvas in real time.
 *
 * @introduced v14.19.0
 * @updated v14.35.0 (Full Foundry V14 & DnD5e v6 RegionLayer placement support)
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";

/**
 * State tracking for the active template placement session
 */
let activePlacementActivity = null;
let activePlacementTimestamp = 0;
let initialPlacementTargets = null;

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks and wraps for the Template Auto-Targeting feature.
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

    // Capture activity context when template placement starts in DnD5e 6.x
    Hooks.on("dnd5e.preCreateMeasuredTemplate", (activity, config) => {
        activePlacementActivity = activity;
        activePlacementTimestamp = Date.now();
        debug(`Template Targeting | Captured preCreateMeasuredTemplate for activity: ${activity?.name || activity?.item?.name}`);
    });

    // Wrap RegionLayer.prototype.placeRegion to update targets live as the template preview is moved or rotated
    _wrapRegionLayerPlaceRegion();

    // Final placement: re-run containment against the persisted RegionDocument
    Hooks.on("createRegion", _onCreateRegion);

    // Clean up state if canvas tears down
    Hooks.on("canvasTearDown", () => {
        activePlacementActivity = null;
        initialPlacementTargets = null;
    });

    log("Template Targeting | Initialized (Foundry V14 / DnD5e v6 Region mode)");
}

// ── RegionLayer Placement Wrapper (Live Preview) ─────────────────────

/**
 * Wrap RegionLayer.prototype.placeRegion to intercept onChange and update targets in real time.
 */
function _wrapRegionLayerPlaceRegion() {
    if (typeof RegionLayer === "undefined" || !RegionLayer.prototype?.placeRegion) return;
    if (RegionLayer.prototype.placeRegion._nd5tTargetingWrapped) return;

    const originalPlaceRegion = RegionLayer.prototype.placeRegion;

    const wrapped = async function(data, options = {}) {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) {
            return originalPlaceRegion.call(this, data, options);
        }

        const isTemplate = _isTemplatePlacement(data, options, this);
        if (!isTemplate) {
            return originalPlaceRegion.call(this, data, options);
        }

        // Capture user targets prior to template placement (only on first region in batch)
        const isFirstRegion = (options._regionIndex ?? 0) === 0;
        if (isFirstRegion) {
            initialPlacementTargets = Array.from(game.user.targets ?? []).map(t => t.id);
        }

        // Intercept onChange to update targets in real-time as the preview moves or rotates
        const origOnChange = options.onChange;
        options.onChange = (args) => {
            _onRegionPlacementChange(args);
            return origOnChange?.(args);
        };

        let result;
        try {
            result = await originalPlaceRegion.call(this, data, options);
            return result;
        } finally {
            // If placement was aborted/cancelled (result is null/falsy), restore previous targets
            if (!result) {
                if (initialPlacementTargets !== null) {
                    _setTargetsIfChanged(initialPlacementTargets);
                    initialPlacementTargets = null;
                }
                activePlacementActivity = null;
            } else if ((options._regionIndex ?? 0) >= (options._regionCount ?? 1) - 1) {
                // Batch completed successfully
                initialPlacementTargets = null;
                activePlacementActivity = null;
            }
        }
    };

    wrapped._nd5tTargetingWrapped = true;
    RegionLayer.prototype.placeRegion = wrapped;
}

/**
 * Determine whether a region placement call represents a template placement.
 * @param {object} data
 * @param {object} options
 * @param {RegionLayer} layer
 * @returns {boolean}
 */
function _isTemplatePlacement(data, options, layer) {
    if (activePlacementActivity && (Date.now() - activePlacementTimestamp < 15000)) {
        return true;
    }
    if (data?.["flags.core.MeasuredTemplate"] || data?.flags?.core?.MeasuredTemplate) {
        return true;
    }
    if (data?.flags?.dnd5e?.activity || data?.flags?.dnd5e?.item) {
        return true;
    }
    if (layer?.templateMode) {
        return true;
    }
    return false;
}

/**
 * Handler for live region placement changes (cursor move, wheel rotation).
 * Evaluates tokens enclosed by all active preview region documents and updates targets.
 * @param {object} args
 */
function _onRegionPlacementChange(args) {
    if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
    if (!canvas?.ready || !canvas?.tokens) return;

    // Collect all preview region documents currently active in this placement session
    const previewDocs = new Set();
    if (args?.document) previewDocs.add(args.document);
    if (args?.preview?.document) previewDocs.add(args.preview.document);

    // Also include any previously confirmed previews from the same batch (e.g. multi-template spells)
    if (canvas.regions?.preview?.children) {
        for (const child of canvas.regions.preview.children) {
            if (child?.document && !child.destroyed) {
                previewDocs.add(child.document);
            }
        }
    }

    if (!previewDocs.size) return;

    const targetIds = _getTargetsForRegions(Array.from(previewDocs));
    _setTargetsIfChanged(targetIds);
}

// ── Hook Handlers (Post-Placement) ───────────────────────────────────

/**
 * Post-placement: finalise targets once when the Region document is created.
 *
 * When the user confirms template placement, dnd5e creates the Region document.
 * The createRegion hook fires on all clients; we guard to only process it for
 * the creating user.
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
    if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) {
        debug("Template Targeting | createRegion: setting disabled, skipping");
        return;
    }

    // Guard 2: only the placing user runs this
    if (userId !== game.user.id) {
        debug(`Template Targeting | createRegion: userId ${userId} !== game.user.id ${game.user.id}, skipping`);
        return;
    }

    if (!canvas?.ready || !canvas?.tokens) {
        debug("Template Targeting | createRegion: no canvas.tokens, skipping");
        return;
    }

    // Guard 3: check if this region was created from a dnd5e activity/item or core MeasuredTemplate
    const isDnd5eTemplate = !!(regionDoc.flags?.dnd5e?.origin || regionDoc.flags?.dnd5e?.item || regionDoc.flags?.dnd5e?.activity);
    const isCoreTemplate = !!(regionDoc.flags?.core?.MeasuredTemplate);
    if (!isDnd5eTemplate && !isCoreTemplate) {
        debug("Template Targeting | createRegion: not a template region, skipping");
        return;
    }

    debug(`Template Targeting | createRegion: all guards passed for region ${regionDoc.id}, deferring containment check`);

    // Defer by one tick so the Region's polygon tree is fully built before we call testInsideRegion()
    setTimeout(() => {
        _applyTargetsFromRegion(regionDoc);
    }, 0);
}

// ── Containment Helpers ──────────────────────────────────────────────

/**
 * Calculate which tokens fall inside any of the specified Region documents.
 * Uses native TokenDocument#testInsideRegion() API.
 * Respects token visibility so non-GMs cannot auto-target hidden tokens.
 *
 * @param {RegionDocument|RegionDocument[]} regionDocs  One or more Region documents to test against.
 * @returns {string[]}                                  Array of token IDs enclosed by the regions.
 */
function _getTargetsForRegions(regionDocs) {
    if (!canvas?.tokens?.placeables) return [];
    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];
    if (!docs.length) return [];

    const targetIds = [];
    for (const token of canvas.tokens.placeables) {
        if (!token?.document) continue;

        // Non-GMs cannot target tokens they cannot see
        if (!token.visible && !game.user.isGM) continue;

        let inside = false;
        for (const doc of docs) {
            try {
                if (token.document.testInsideRegion(doc)) {
                    inside = true;
                    break;
                }
            } catch (err) {
                debug("Template Targeting | testInsideRegion error:", err);
            }
        }

        if (inside) targetIds.push(token.id);
    }

    return targetIds;
}

/**
 * Updates game.user.targets only if the new set of target IDs differs from the current targets.
 * Avoids unnecessary re-rendering and socket traffic on micro-movements.
 *
 * @param {string[]} newTargetIds  The new list of targeted token IDs.
 */
function _setTargetsIfChanged(newTargetIds) {
    if (!canvas?.tokens) return;
    const currentTargets = game.user.targets;
    const currentIds = new Set(Array.from(currentTargets ?? []).map(t => t.id));

    if (newTargetIds.length === currentIds.size && newTargetIds.every(id => currentIds.has(id))) {
        return;
    }

    debug(`Template Targeting | Updating targets: [${newTargetIds.join(", ")}]`);
    canvas.tokens.setTargets(newTargetIds);
}

/**
 * Compute which tokens fall inside a persisted Region (final placement) and
 * update game.user.targets accordingly.
 * Supports multi-region batches from the same activity.
 *
 * @param {RegionDocument} regionDoc  The persisted Region document.
 */
function _applyTargetsFromRegion(regionDoc) {
    if (!canvas?.tokens) return;

    // For multi-template activities, include all regions created by the same activity
    const activityUuid = regionDoc.flags?.dnd5e?.activity;
    const relatedRegions = activityUuid
        ? (canvas.scene?.regions?.filter(r => r.flags?.dnd5e?.activity === activityUuid) ?? [regionDoc])
        : [regionDoc];

    const targetIds = _getTargetsForRegions(relatedRegions);
    debug(`Template Targeting | Final placement: targeting ${targetIds.length} token(s) in region(s)`);

    _setTargetsIfChanged(targetIds);
}
