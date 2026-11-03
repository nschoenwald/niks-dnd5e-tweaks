/**
 * Feature: Auto-Target Tokens in Spell Templates
 * Description: Automatically targets tokens enclosed within spell or ability templates placed on the canvas in real time.
 *
 * @introduced v14.19.0
 * @updated v14.46.7 (Exclude source/origin tokens for emanation templates)
 * @updated v14.48.4 (Heal activities target allies only, "Choose Targets" damage activities target opponents only)
 * @updated v14.62.0 (Respect the activity's Affects type, skip dead, non-creature and GM-hidden tokens, Secret tokens always targeted, "Choose Targets" saves target opponents, GM selection no longer treated as caster, per-placement caching, no duplicate final targeting)
 */
import { debug, log, isFeatureActive } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";

/**
 * State tracking for the active template placement session
 */
let activePlacementActivity = null;
let activePlacementTimestamp = 0;
let initialPlacementTargets = null;
const activePlacementBatchRegionIds = new Set();
let _pendingPlacementRAF = null;
let _lastPlacementChangeArgs = null;
let _isPlacingRegion = false;
let _cachedOriginIds = null;
/** Per-placement caches: the activity, caster and template shape don't change while a preview is moved */
let _cachedTargetFilter = null;
let _cachedExcludeOrigin = null;
/** Region IDs already targeted by dnd5e.postCreateMeasuredTemplate, so the createRegion fallback can skip them */
const _finalizedRegionIds = new Set();
let lastChatActionMessageId = null;

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks and wraps for the Template Auto-Targeting feature.
 * Called once during the "setup" phase from main.js.
 * No-op when midi-qol is active.
 */
export function initTemplateTargeting() {
    // Completely disabled when midi-qol is active — it has its own template
    // auto-targeting feature and running both would cause conflicts.
    if (isMidiActive()) {
        log("Template Targeting | midi-qol is active, feature disabled");
        return;
    }

    // Capture activity context when template placement starts in DnD5e 6.x
    Hooks.on("dnd5e.preCreateMeasuredTemplate", (activity, config) => {
        activePlacementActivity = activity;
        activePlacementTimestamp = Date.now();
        activePlacementBatchRegionIds.clear();
        debug(`Template Targeting | Captured preCreateMeasuredTemplate for activity: ${activity?.name || activity?.item?.name}`);
    });

    // Listen to "Place Template" button clicks in chat cards to track which message to update
    document.addEventListener("click", (event) => {
        const button = event.target?.closest?.('[data-action="placeTemplate"]');
        if (button) {
            const messageId = button.closest("[data-message-id]")?.dataset?.messageId;
            if (messageId) lastChatActionMessageId = messageId;
            return;
        }

        // Track when user manually clicks the targeting mode toggle so we do not overwrite their manual choice
        const toggle = event.target?.closest?.(".target-source-toggle");
        if (toggle) {
            const messageId = toggle.closest("[data-message-id]")?.dataset?.messageId;
            const msg = game.messages?.get(messageId);
            if (msg) msg._nd5tUserToggledMode = true;
        }
    }, true);

    // Final placement in DnD5e 6.x: fired with the exact newly created RegionDocument instances
    Hooks.on("dnd5e.postCreateMeasuredTemplate", (activity, created) => {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
        if (!Array.isArray(created) || !created.length) return;

        if (activity) activePlacementActivity = activity;
        for (const r of created) {
            if (r?.id) activePlacementBatchRegionIds.add(r.id);
        }

        const targetIds = _getTargetsForRegions(created);
        _setTargetsIfChanged(targetIds);
        for (const r of created) {
            if (r?.id) _finalizedRegionIds.add(r.id);
        }

        // If template placement was triggered from a chat card button, sync targets to that card
        if (lastChatActionMessageId) {
            const message = game.messages?.get(lastChatActionMessageId);
            if (message) {
                _syncTargetsToMessage(message);
            }
            lastChatActionMessageId = null;
        }

        activePlacementActivity = null;
    });

    // Sync newly targeted tokens to the usage chat message so save & damage buttons have targets
    Hooks.on("dnd5e.postUseActivity", async (activity, usageConfig, results) => {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) return;
        if (!results?.templates?.length || !results?.message) return;

        await _syncTargetsToMessage(results.message);
    });

    // Ensure chat cards with recorded targets default to "targeted" mode instead of "selected"
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        _ensureTargetedApplicationMode(message, html);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _ensureTargetedApplicationMode(message, html);
    });

    // Wrap RegionLayer.prototype.placeRegion to update targets live as the template preview is moved or rotated
    _wrapRegionLayerPlaceRegion();

    // Final placement fallback: re-run containment against the persisted RegionDocument
    Hooks.on("createRegion", _onCreateRegion);

    // Clean up state if canvas tears down
    Hooks.on("canvasTearDown", () => {
        if (_pendingPlacementRAF) {
            cancelAnimationFrame(_pendingPlacementRAF);
            _pendingPlacementRAF = null;
        }
        _lastPlacementChangeArgs = null;
        _isPlacingRegion = false;
        _cachedOriginIds = null;
        _resetPlacementCaches();
        _finalizedRegionIds.clear();
        activePlacementActivity = null;
        initialPlacementTargets = null;
        activePlacementBatchRegionIds.clear();
        lastChatActionMessageId = null;
    });

    log("Template Targeting | Initialized (Foundry V14 / DnD5e v6 Region mode)");
}

// ── RegionLayer Placement Wrapper (Live Preview) ─────────────────────

/**
 * Wrap RegionLayer.prototype.placeRegion to intercept onChange and update targets in real time.
 */
function _wrapRegionLayerPlaceRegion() {
    patchMethod("foundry.canvas.layers.RegionLayer.prototype.placeRegion", async function patchedTargetingPlaceRegion(wrapped, data, options = {}) {
        if (!isFeatureActive("enableTemplateTargeting", "clientEnableTemplateTargeting")) {
            return wrapped(data, options);
        }

        const isTemplate = _isTemplatePlacement(data, options, this);
        if (!isTemplate) {
            return wrapped(data, options);
        }

        _isPlacingRegion = true;

        // Capture user targets prior to template placement (only on first region in batch)
        const isFirstRegion = (options._regionIndex ?? 0) === 0;
        if (isFirstRegion) {
            initialPlacementTargets = Array.from(game.user.targets ?? []).map(t => t.id);
            _cachedOriginIds = null;
            _resetPlacementCaches();
        }

        // Intercept onChange to update targets in real-time as the preview moves or rotates
        const origOnChange = options.onChange;
        options.onChange = (args) => {
            _onRegionPlacementChange(args);
            return origOnChange?.(args);
        };

        let result;
        try {
            result = await wrapped(data, options);
            return result;
        } finally {
            _isPlacingRegion = false;
            if (_pendingPlacementRAF) {
                cancelAnimationFrame(_pendingPlacementRAF);
                _pendingPlacementRAF = null;
            }
            _lastPlacementChangeArgs = null;
            _cachedOriginIds = null;
            _resetPlacementCaches();

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
                // Retain activePlacementActivity briefly for createRegion / postCreateMeasuredTemplate hooks
                setTimeout(() => {
                    activePlacementActivity = null;
                }, 5000);
            }
        }
    }, "MIXED");
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

    _lastPlacementChangeArgs = args;
    if (_pendingPlacementRAF) return;
    _pendingPlacementRAF = requestAnimationFrame(() => {
        _pendingPlacementRAF = null;
        const currentArgs = _lastPlacementChangeArgs;
        _lastPlacementChangeArgs = null;
        if (!canvas?.ready || !canvas?.tokens || !currentArgs) return;

        // Collect all preview region documents currently active in this placement session
        const previewDocs = new Set();
        if (currentArgs.document) previewDocs.add(currentArgs.document);
        if (currentArgs.preview?.document) previewDocs.add(currentArgs.preview.document);

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
    });
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

    if (activePlacementActivity && (Date.now() - activePlacementTimestamp < 30000)) {
        activePlacementBatchRegionIds.add(regionDoc.id);
    }

    // Defer by one tick so the Region's polygon tree is fully built before we call testInsideRegion()
    // dnd5e.postCreateMeasuredTemplate usually runs first (promise continuation before this timer) and has
    // already targeted this region, so only fall back when it did not (e.g. regions created by other code).
    setTimeout(() => {
        if (_finalizedRegionIds.delete(regionDoc.id)) {
            debug(`Template Targeting | createRegion: region ${regionDoc.id} already targeted, skipping`);
            return;
        }
        _applyTargetsFromRegion(regionDoc);
    }, 0);
}

// ── Containment Helpers ──────────────────────────────────────────────

/**
 * Clear the per-placement target filter caches.
 */
function _resetPlacementCaches() {
    _cachedTargetFilter = null;
    _cachedExcludeOrigin = null;
}

/**
 * Template types that originate from a creature/object and exclude that origin from the area of effect.
 * Under D&D 5e / 2024 rules:
 * - Cones and lines/rays originate from the caster but do not affect the caster.
 * - Emanations originate from a creature or object and explicitly exclude that origin unless stated otherwise.
 */
const EXCLUDED_ORIGIN_TEMPLATE_TYPES = new Set(["cone", "line", "ray", "emanation", "radius"]);

/**
 * Check if the active placement or any of the given region documents represent a template
 * that excludes an originating token (cone, line/ray, or emanation).
 * @param {RegionDocument|RegionDocument[]} regionDocs
 * @returns {boolean}
 */
function _shouldExcludeOrigin(regionDocs) {
    const act = activePlacementActivity;
    const actType = act?.target?.template?.type;
    const actShape = dnd5e?.config?.areaTargetTypes?.[actType]?.template;
    if (actType && (EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(actType) || (actShape && EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(actShape)))) {
        return true;
    }

    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];
    for (const doc of docs) {
        if (!doc) continue;
        const shapes = doc.shapes ?? [];
        for (const shape of shapes) {
            if (shape?.type && EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(shape.type)) return true;
        }
        const templateT = doc.flags?.core?.MeasuredTemplate?.t;
        if (templateT && (templateT === "cone" || templateT === "ray" || EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(templateT))) return true;
        const activityUuid = doc.flags?.dnd5e?.activity;
        if (activityUuid) {
            try {
                const docActivity = fromUuidSync(activityUuid, { strict: false });
                const docActType = docActivity?.target?.template?.type;
                const docActShape = dnd5e?.config?.areaTargetTypes?.[docActType]?.template;
                if (docActType && (EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(docActType) || (docActShape && EXCLUDED_ORIGIN_TEMPLATE_TYPES.has(docActShape)))) {
                    return true;
                }
            } catch (err) {}
        }
    }
    return false;
}

/**
 * Retrieve token IDs for the originating source token(s) of the active template.
 * Under D&D 5e / 2024 rules:
 * - Directional templates (cone, line, ray) originate from the caster and exclude the caster.
 * - Emanations originate from the attached token, but are only excluded if that attached token
 *   is also the source (caster/creator) of the emanation.
 *
 * @param {RegionDocument|RegionDocument[]} regionDocs
 * @returns {Set<string>}
 */
function _getOriginatingTokenIds(regionDocs) {
    const ids = new Set();
    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];

    // 1. Resolve source / caster tokens (cached during live placement RAF loop)
    let sourceTokenIds = null;
    if (_isPlacingRegion && _cachedOriginIds !== null) {
        sourceTokenIds = _cachedOriginIds;
    } else {
        sourceTokenIds = new Set();
        for (const doc of docs) {
            if (!doc) continue;
            const originUuid = doc.flags?.dnd5e?.origin;
            if (originUuid) {
                try {
                    const originDoc = fromUuidSync(originUuid, { strict: false });
                    if (originDoc) {
                        if (originDoc instanceof Actor || typeof originDoc.getActiveTokens === "function") {
                            const active = originDoc.getActiveTokens?.(false, true) ?? originDoc.getActiveTokens?.() ?? [];
                            for (const t of active) {
                                if (t?.id) sourceTokenIds.add(t.id);
                            }
                        } else if (originDoc.id) {
                            sourceTokenIds.add(originDoc.id);
                        }
                    }
                } catch (err) {}
            }
        }

        const act = activePlacementActivity;
        if (act) {
            try {
                const usageToken = act.getUsageToken?.();
                if (usageToken?.id) sourceTokenIds.add(usageToken.id);
            } catch (err) {}

            const actor = act.actor ?? act.item?.actor;
            if (actor) {
                try {
                    const activeTokens = actor.getActiveTokens?.(false, true) ?? actor.getActiveTokens?.() ?? [];
                    for (const t of activeTokens) {
                        if (t?.id) sourceTokenIds.add(t.id);
                    }
                } catch (err) {}
            }
        }

        // Last resort for players only: their controlled tokens and assigned character.
        // A GM's selection is often unrelated to the template, so it is never treated as the caster.
        if (!sourceTokenIds.size && !game.user.isGM) {
            for (const token of canvas.tokens?.controlled ?? []) {
                sourceTokenIds.add(token.id);
            }
            if (game.user.character) {
                try {
                    for (const t of game.user.character.getActiveTokens?.() ?? []) {
                        if (t?.id) sourceTokenIds.add(t.id);
                    }
                } catch (err) {}
            }
        }

        if (_isPlacingRegion) {
            _cachedOriginIds = sourceTokenIds;
        } else {
            _cachedOriginIds = null;
        }
    }

    // 2. Evaluate each document to determine excluded origin tokens
    for (const doc of docs) {
        if (!doc) continue;
        const shapes = doc.shapes ?? [];
        const isEmanation = shapes.some(s => s.type === "emanation")
            || activePlacementActivity?.target?.template?.type === "radius"
            || activePlacementActivity?.target?.template?.type === "emanation";

        if (isEmanation) {
            // A token is only excluded for an emanation if it is BOTH the source AND the attached token
            const attached = doc.attachment?.token ?? doc._source?.attachment?.token;
            const attachedId = typeof attached === "string" ? attached : attached?.id;
            if (attachedId && sourceTokenIds.has(attachedId)) {
                ids.add(attachedId);
            }
        } else {
            // For directional templates (cone, line, ray), exclude the source/caster token(s)
            for (const id of sourceTokenIds) {
                ids.add(id);
            }
        }
    }

    return ids;
}

/**
 * Resolve the activity responsible for the given template regions.
 * Prefers the activity captured for the active placement, then falls back to the region's dnd5e activity flag.
 * @param {RegionDocument[]} regionDocs
 * @returns {Activity|null}
 */
function _getPlacementActivity(regionDocs) {
    if (activePlacementActivity) return activePlacementActivity;
    for (const doc of regionDocs) {
        const activityUuid = doc?.flags?.dnd5e?.activity;
        if (!activityUuid) continue;
        try {
            const activity = fromUuidSync(activityUuid, { strict: false });
            if (activity) return activity;
        } catch (err) {}
    }
    return null;
}

/**
 * Actor types that never count as creatures or objects caught in an area (party groups, encounters, factions).
 */
const NON_TARGETABLE_ACTOR_TYPES = new Set(["group", "encounter", "faction"]);

/**
 * Activity "Affects" types that only include creatures, so vehicles are left out.
 */
const CREATURE_ONLY_AFFECTS_TYPES = new Set(["creature", "ally", "enemy", "willing"]);

/**
 * Get the disposition used to decide whether a token is an ally.
 * Player characters and player-owned actors always count as friendly, regardless of token disposition.
 * @param {TokenDocument|PrototypeToken|null} tokenDoc
 * @param {Actor5e|null} [actor]
 * @returns {number|null}
 */
function _getAllyDisposition(tokenDoc, actor = tokenDoc?.actor) {
    if (actor?.type === "character" || actor?.hasPlayerOwner) return CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    return tokenDoc?.disposition ?? null;
}

/**
 * Check whether a potential target is on the required side.
 * Secret tokens are a wildcard: the GM uses that disposition to hide an NPC's intent, so they count as
 * both allies and opponents and are always targeted.
 * @param {TokenDocument} tokenDoc
 * @param {number} side
 * @returns {boolean}
 */
function _isOnSide(tokenDoc, side) {
    if (tokenDoc.disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return true;
    return _getAllyDisposition(tokenDoc) === side;
}

/**
 * Resolve the token document that is using the activity.
 * @param {Activity|null} activity
 * @returns {TokenDocument|null}
 */
function _getSourceTokenDocument(activity) {
    if (!activity) return null;
    let sourceToken = null;
    try {
        sourceToken = activity.getUsageToken?.() ?? null;
    } catch (err) {}
    const actor = activity.actor ?? activity.item?.actor;
    sourceToken ??= actor?.getActiveTokens?.(false, true)?.[0] ?? null;
    return sourceToken;
}

/**
 * Work out which tokens a template's activity can affect.
 * - The activity's "Affects" type wins: "Ally" targets the caster's allies, "Enemy" the caster's opponents,
 *   "Self" only the caster, and creature-only types skip vehicles.
 * - Otherwise heal activities only target allies, and damage or save activities with "Choose Targets"
 *   only target opponents. Neutral casters have no opponents; secret casters get no side filtering at all.
 * @param {RegionDocument[]} regionDocs
 * @returns {{side: number|null, selfOnly: boolean, creaturesOnly: boolean, sourceToken: TokenDocument|null}}
 */
function _getTemplateTargetFilter(regionDocs) {
    const filter = { side: null, selfOnly: false, creaturesOnly: false, sourceToken: null };
    const activity = _getPlacementActivity(regionDocs);
    if (!activity) return filter;

    const actor = activity.actor ?? activity.item?.actor;
    filter.sourceToken = _getSourceTokenDocument(activity);

    const affectsType = activity.target?.affects?.type || activity.item?.system?.target?.affects?.type || "";
    filter.creaturesOnly = CREATURE_ONLY_AFFECTS_TYPES.has(affectsType);
    if (affectsType === "self") {
        filter.selfOnly = true;
        return filter;
    }
    if (!actor) return filter;

    const { FRIENDLY, HOSTILE, SECRET } = CONST.TOKEN_DISPOSITIONS;
    const casterSide = _getAllyDisposition(filter.sourceToken ?? actor.prototypeToken, actor);
    // A secret caster is a wildcard too: its allies and opponents are unknown, so no side filtering
    if (casterSide === SECRET) return filter;
    const opponentSide = casterSide === FRIENDLY ? HOSTILE : casterSide === HOSTILE ? FRIENDLY : null;

    if (affectsType === "ally") filter.side = casterSide;
    else if (affectsType === "enemy") filter.side = opponentSide;
    else if (activity.type === "heal") filter.side = casterSide;
    else {
        const choosesTargets = !!(activity.target?.affects?.choice || activity.item?.system?.target?.affects?.choice);
        const isHarmful = !!activity.damage?.parts?.length || activity.type === "save";
        if (choosesTargets && isHarmful) filter.side = opponentSide;
    }
    return filter;
}

/**
 * Check whether a token can be caught in an area at all.
 * Skips tokens without an actor, party groups, encounters and factions, Item Piles, and dead or defeated
 * creatures. Creatures at 0 HP that are only unconscious stay targetable, so healing still reaches them.
 * @param {Token} token
 * @param {{creaturesOnly: boolean}} filter
 * @returns {boolean}
 */
function _isTargetableToken(token, filter) {
    const tokenDoc = token.document;
    const actor = tokenDoc?.actor;
    if (!actor) return false;
    if (NON_TARGETABLE_ACTOR_TYPES.has(actor.type)) return false;
    if (filter.creaturesOnly && (actor.type === "vehicle")) return false;
    // Read the flag directly: getFlag() throws when the Item Piles module is not active
    if (tokenDoc.flags?.["item-piles"]?.data?.enabled || actor.flags?.["item-piles"]?.data?.enabled) return false;
    if (actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return false;
    if (tokenDoc.combatant?.isDefeated) return false;
    return true;
}

/**
 * Calculate which tokens fall inside any of the specified Region documents.
 * Uses native TokenDocument#testInsideRegion(), which already respects walls (the template region's
 * restriction), elevation, scene levels and every square a large token occupies.
 * Respects token visibility so non-GMs cannot auto-target hidden tokens, and skips GM-hidden tokens
 * unless the caster is hidden too.
 * For cone, ray/line, and emanation templates, always excludes the originating token.
 *
 * @param {RegionDocument|RegionDocument[]} regionDocs  One or more Region documents to test against.
 * @returns {string[]}                                  Array of token IDs enclosed by the regions.
 */
function _getTargetsForRegions(regionDocs) {
    if (!canvas?.tokens?.placeables) return [];
    const docs = Array.isArray(regionDocs) ? regionDocs : [regionDocs];
    if (!docs.length) return [];

    // During live placement these only depend on the activity, its caster and the template shape, so they
    // are computed once per placement instead of on every animation frame.
    let filter;
    let shouldExcludeOrigin;
    if (_isPlacingRegion && _cachedTargetFilter) {
        filter = _cachedTargetFilter;
        shouldExcludeOrigin = _cachedExcludeOrigin;
    } else {
        filter = _getTemplateTargetFilter(docs);
        shouldExcludeOrigin = !filter.selfOnly && _shouldExcludeOrigin(docs);
        if (_isPlacingRegion) {
            _cachedTargetFilter = filter;
            _cachedExcludeOrigin = shouldExcludeOrigin;
        }
    }
    const originIds = shouldExcludeOrigin ? _getOriginatingTokenIds(docs) : null;
    const casterHidden = !!filter.sourceToken?.hidden;

    const targetIds = [];
    for (const token of canvas.tokens.placeables) {
        if (!token?.document) continue;

        // Non-GMs cannot target tokens they cannot see
        if (!token.visible && !game.user.isGM) continue;

        // GM-hidden tokens (staged reinforcements, secret watchers) are only caught by a hidden caster
        if (token.document.hidden && !casterHidden) continue;

        // "Self" activities only affect the caster
        if (filter.selfOnly && (token.document !== filter.sourceToken)) continue;

        // For cone, ray/line, and emanation templates, always exclude the originating token
        if (originIds?.has(token.id)) continue;

        if (!_isTargetableToken(token, filter)) continue;

        // Ally / enemy filtering from the activity's Affects type, healing and "Choose Targets"
        if ((filter.side !== null) && !_isOnSide(token.document, filter.side)) continue;

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
 * Only evaluates the newly created region(s) from the current placement batch,
 * avoiding old historical regions left on the scene from previous spell casts.
 *
 * @param {RegionDocument} regionDoc  The persisted Region document.
 */
function _applyTargetsFromRegion(regionDoc) {
    if (!canvas?.tokens) return;

    // Only evaluate regions created in the current placement batch, or this specific region.
    // NEVER query the entire scene by activityUuid, as that would include all historical regions from previous casts!
    let regionsToEvaluate = [regionDoc];
    if (activePlacementBatchRegionIds.has(regionDoc.id) && activePlacementBatchRegionIds.size > 1) {
        regionsToEvaluate = Array.from(activePlacementBatchRegionIds)
            .map(id => canvas.scene?.regions?.get(id))
            .filter(Boolean);
        if (!regionsToEvaluate.length) regionsToEvaluate = [regionDoc];
    }

    const targetIds = _getTargetsForRegions(regionsToEvaluate);
    debug(`Template Targeting | Final placement: targeting ${targetIds.length} token(s) in region(s)`);

    _setTargetsIfChanged(targetIds);
}

// ── Chat Card Application Mode Synchronization ──────────────────────

/**
 * Synchronize targets to a chat message and ensure its targeting mode defaults to "targeted".
 * @param {ChatMessage} message
 */
async function _syncTargetsToMessage(message) {
    if (!message) return;
    const targetDescriptors = dnd5e.dataModels?.chatMessage?.fields?.TargetsField?.getDescriptors?.(game.user.targets) ?? [];
    if (!targetDescriptors.length) return;

    if (message._targetState) {
        message._targetState.mode = "targeted";
    }

    try {
        await message.update({ "system.targets": targetDescriptors });
        debug(`Template Targeting | Synchronized ${targetDescriptors.length} target(s) to message ${message.id} (mode: targeted)`);
    } catch (err) {
        debug("Template Targeting | Failed to update chat message targets:", err);
    }

    _setTargetingModeOnElements(message.id, "targeted");
}

/**
 * Update live <recorded-targets> elements for a message to the specified mode.
 * @param {string} messageId
 * @param {"targeted"|"selected"} mode
 */
function _setTargetingModeOnElements(messageId, mode = "targeted") {
    if (!messageId) return;
    const query = `[data-message-id="${messageId}"] recorded-targets`;
    for (const el of document.querySelectorAll(query)) {
        if (el.hasRecordedTargets && el.targetingMode !== mode) {
            el.targetingMode = mode;
        }
    }
}

/**
 * Ensure chat cards with recorded targets default to "targeted" mode instead of "selected".
 * Preserves explicit manual toggle if the user clicked the toggle button.
 * @param {ChatMessage} message
 * @param {HTMLElement|jQuery} html
 */
function _ensureTargetedApplicationMode(message, html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    const origin = message.getOriginatingMessage?.();
    const hasTargets = !!(message.system?.targets?.length || origin?.system?.targets?.length);
    if (!hasTargets) return;

    // If user clicked the toggle button explicitly on this message, respect their choice
    if (message._nd5tUserToggledMode) return;

    if (message._targetState && message._targetState.mode !== "targeted") {
        message._targetState.mode = "targeted";
    }
    if (origin && !origin._nd5tUserToggledMode && origin._targetState && origin._targetState.mode !== "targeted") {
        origin._targetState.mode = "targeted";
    }

    for (const el of root.querySelectorAll("recorded-targets")) {
        if (el.hasRecordedTargets && el.targetingMode !== "targeted") {
            el.targetingMode = "targeted";
        }
    }
}
