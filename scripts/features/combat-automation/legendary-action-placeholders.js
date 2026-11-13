/**
 * Feature: Legendary Action Placeholders
 * Description: Inserts placeholder turns in the combat tracker after creatures' turns to track legendary action usage when legendary creatures are present.
 *
 * @introduced v14.3.1
 * @updated v14.46.6 (Auto-skip placeholders when no combatant has legendary action uses remaining)
 * @updated v14.48.0 (Native core combat turn marker displayed on legendary creatures during placeholder turns)
 * @updated v14.57.0 (Active GM check uses the V14 API)
 * @updated v14.77.0 (Creatures without a Legendary Actions count, e.g. player characters, count as legendary when they
 *   have a feature with a Legendary Action activation; their remaining uses come from that feature)
 *
 * Who counts as legendary:
 *  - Actors whose data has `system.resources.legact` (NPCs): only that count, as before. dnd5e spends Legendary Action
 *    activations from it automatically, so an NPC with a count of 0 can't use its legendary features anyway.
 *  - Actors without it (characters, vehicles…): any item with an activity whose activation type is in
 *    LEGENDARY_ACTIVATION_TYPES. dnd5e doesn't auto-consume anything for these, so remaining uses are read from the
 *    activity's consumption targets (item uses, activity uses, attributes), or its own / its item's limited uses.
 *    A feature without any limit counts as always available.
 * @updated v14.81.0 (Placeholders after every creature's turn except a lone legendary creature's own, with an
 *   "after opposing creatures only" placement setting; auto-skip and turn markers are per placeholder)
 *
 * Placement (at combat start, setting `legendaryActionPlaceholderPlacement`): a placeholder follows each creature after
 * whose turn at least one *other* legendary creature may act (`_canActAfter`). "all": every creature, so with a single
 * legendary creature there is none after its own turn. "opposing": Friendly legendary creatures only after Hostile
 * creatures and vice versa; Neutral / Secret legendary creatures after everyone. Each placeholder stores the creature
 * it follows (`flags.niks-dnd5e-tweaks.afterCombatantId`); auto-skip and the placeholder-turn markers only consider the
 * legendary creatures that may act after that creature (re-evaluated live, so later disposition changes count).
 * Placeholders without that flag (made before 14.81.0) consider every legendary creature, as before.
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

const DEFAULT_ICON = "icons/svg/combat.svg";
const PLACEHOLDER_OFFSET = 0.0001;
const TIE_BREAKER_STEP = 0.0002;

/** Activation types that mark a feature as a legendary action (dnd5e CONFIG.DND5E.activityActivationTypes keys). */
const LEGENDARY_ACTIVATION_TYPES = new Set(["legendary", "mythic"]);

/** Cache of legendary creature combatant IDs for active combats. Keyed by Combat document. */
const _legendaryCombatantsCache = new WeakMap();

/**
 * Invalidate the cached legendary combatants for a given combat.
 * @param {Combat} [combat]
 */
function _invalidateLegendaryCache(combat) {
    if (combat) _legendaryCombatantsCache.delete(combat);
}

/**
 * Legendary combatants of a combat (see isLegendaryCombatant), cached per combat until its combatant count changes
 * or the cache is invalidated.
 * @param {Combat} combat
 * @returns {Combatant[]}
 */
function _getLegendaryCombatants(combat) {
    if (!combat?.combatants?.size) return [];
    let cache = _legendaryCombatantsCache.get(combat);
    if (!cache || cache.size !== combat.combatants.size) {
        const ids = [];
        for (const c of combat.combatants) {
            if (isLegendaryCombatant(c)) ids.push(c.id);
        }
        cache = { size: combat.combatants.size, ids };
        _legendaryCombatantsCache.set(combat, cache);
    }
    return cache.ids.map(id => combat.combatants.get(id)).filter(Boolean);
}

/**
 * Whether a combatant is a legendary action placeholder.
 * @param {Combatant} [combatant]
 * @returns {boolean}
 */
function _isPlaceholder(combatant) {
    return Boolean(combatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder);
}

/**
 * The placement setting: "all" (after every creature's turn) or "opposing" (friendly and hostile legendary creatures
 * only after the turns of creatures with the opposite disposition).
 * @returns {"all"|"opposing"}
 */
function _getPlacementMode() {
    return getSetting("legendaryActionPlaceholderPlacement") === "opposing" ? "opposing" : "all";
}

/**
 * Whether a legendary creature may take a legendary action after another creature's turn.
 * Never after its own turn. In "opposing" mode, a Friendly legendary creature only acts after Hostile creatures and a
 * Hostile one only after Friendly creatures; Neutral and Secret legendary creatures act after everyone.
 * @param {Combatant} legendary
 * @param {Combatant} after
 * @param {"all"|"opposing"} mode
 * @returns {boolean}
 */
function _canActAfter(legendary, after, mode) {
    if (!legendary || !after || (legendary.id === after.id)) return false;
    if (mode !== "opposing") return true;
    const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
    const own = legendary.token?.disposition;
    const other = after.token?.disposition;
    if (own === FRIENDLY) return other === HOSTILE;
    if (own === HOSTILE) return other === FRIENDLY;
    return true;
}

/**
 * The legendary creatures that may act during a placeholder turn: those that can act after the creature the
 * placeholder follows. Placeholders made before 14.81.0 don't know that creature and count every legendary creature.
 * @param {Combat} combat
 * @param {Combatant} placeholder
 * @returns {Combatant[]}
 */
function _getPlaceholderLegendaryCombatants(combat, placeholder) {
    const legendary = _getLegendaryCombatants(combat);
    const afterId = placeholder?.flags?.[MODULE_ID]?.afterCombatantId;
    const after = afterId ? combat.combatants.get(afterId) : null;
    if (!after) return legendary;
    const mode = _getPlacementMode();
    return legendary.filter(l => _canActAfter(l, after, mode));
}

/**
 * Check whether legendary action uses remain: for a placeholder, among the legendary creatures that may act during
 * it (none if the creature it follows is defeated, since that creature had no turn); otherwise among all legendary
 * creatures of the combat.
 * @param {Combat} combat
 * @param {Combatant} [placeholder]
 * @returns {boolean}
 */
export function hasRemainingLegendaryActions(combat, placeholder = null) {
    if (!combat?.combatants?.size) return false;
    let candidates;
    if (placeholder) {
        const afterId = placeholder.flags?.[MODULE_ID]?.afterCombatantId;
        if (afterId && combat.combatants.get(afterId)?.isDefeated) return false;
        candidates = _getPlaceholderLegendaryCombatants(combat, placeholder);
    } else {
        candidates = _getLegendaryCombatants(combat);
    }
    return candidates.some(c => _getCombatantRemainingLegendaryActions(c) > 0);
}

/**
 * Whether auto-skip passes over this combatant: a placeholder without remaining uses for it.
 * @param {Combat} combat
 * @param {Combatant} combatant
 * @returns {boolean}
 */
function _isSkippablePlaceholder(combat, combatant) {
    return _isPlaceholder(combatant) && !hasRemainingLegendaryActions(combat, combatant);
}

/**
 * Handle next turn progression on a Combat encounter, auto-skipping legendary action
 * placeholder turns when no combatant in the encounter has uses remaining.
 * @param {Function} wrapped Original or downstream nextTurn function
 * @param {...any} args
 * @returns {Promise<Combat>}
 */
async function _handleNextTurn(wrapped, ...args) {
    if (!getSetting("enableLegendaryActionPlaceholders")
        || !getSetting("autoSkipEmptyLegendaryPlaceholders")
        || this.round === 0
        || !this.turns?.length) {
        return wrapped.apply(this, args);
    }

    // Determine normal next turn
    const turn = this.turn ?? -1;
    let normalNextTurn = null;
    if (this.settings.skipDefeated) {
        for (let i = turn + 1; i < this.turns.length; i++) {
            if (!this.turns[i].isDefeated) {
                normalNextTurn = i;
                break;
            }
        }
    } else {
        normalNextTurn = turn + 1;
    }

    // If the next turn is outside round bounds, delegate to original (which advances round)
    if (normalNextTurn === null || normalNextTurn >= this.turns.length) {
        return wrapped.apply(this, args);
    }

    // Performance check: Is normalNextTurn a placeholder?
    // If it is NOT a placeholder, no need to inspect actors/resources! Zero overhead!
    const candidateCombatant = this.turns[normalNextTurn];
    if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
        return wrapped.apply(this, args);
    }

    // Normal next turn IS a placeholder. Now check if any actor has legendary action uses left:
    if (hasRemainingLegendaryActions(this, candidateCombatant)) {
        // Actions remaining: do not skip, advance to placeholder normally
        return wrapped.apply(this, args);
    }

    debug(`Legendary Action Placeholders | Auto-skipping placeholder at turn ${normalNextTurn} (no legendary action uses remaining).`);

    // No actor has legendary action uses left: skip placeholder(s)!
    let targetTurn = null;
    for (let i = normalNextTurn + 1; i < this.turns.length; i++) {
        const combatant = this.turns[i];
        if (this.settings.skipDefeated && combatant.isDefeated) continue;
        if (_isSkippablePlaceholder(this, combatant)) continue;
        targetTurn = i;
        break;
    }

    // If no valid turn remains in the current round, advance to next round
    if (targetTurn === null || targetTurn >= this.turns.length) {
        return this.nextRound();
    }

    // Advance to the found non-placeholder turn
    const advanceTime = this.getTimeDelta(this.round, this.turn, this.round, targetTurn);
    const updateData = { round: this.round, turn: targetTurn };
    const updateOptions = { direction: 1, worldTime: { delta: advanceTime } };
    Hooks.callAll("combatTurn", this, updateData, updateOptions);
    await this.update(updateData, updateOptions);
    return this;
}

/**
 * Handle previous turn progression on a Combat encounter, auto-skipping legendary action
 * placeholder turns backward when no combatant in the encounter has uses remaining.
 * @param {Function} wrapped Original or downstream previousTurn function
 * @param {...any} args
 * @returns {Promise<Combat>}
 */
async function _handlePreviousTurn(wrapped, ...args) {
    if (!getSetting("enableLegendaryActionPlaceholders")
        || !getSetting("autoSkipEmptyLegendaryPlaceholders")
        || this.round === 0
        || !this.turns?.length) {
        return wrapped.apply(this, args);
    }

    if (this.turn === 0) {
        if (this.round <= 1) return this.previousRound();
        // Check if the end of previous round is a placeholder and whether it should be skipped
        const candidateCombatant = this.turns[this.turns.length - 1];
        if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
            return wrapped.apply(this, args);
        }
        if (hasRemainingLegendaryActions(this, candidateCombatant)) {
            return wrapped.apply(this, args);
        }

        debug(`Legendary Action Placeholders | Auto-skipping placeholder backward across round boundary to previous round.`);

        // Skip backwards past trailing placeholder(s) at end of previous round
        let targetTurn = null;
        for (let i = this.turns.length - 2; i >= 0; i--) {
            const combatant = this.turns[i];
            if (this.settings.skipDefeated && combatant.isDefeated) continue;
            if (_isSkippablePlaceholder(this, combatant)) continue;
            targetTurn = i;
            break;
        }
        if (targetTurn !== null) {
            const previousRound = this.round - 1;
            const advanceTime = this.getTimeDelta(this.round, this.turn, previousRound, targetTurn);
            const updateData = { round: previousRound, turn: targetTurn };
            const updateOptions = { direction: -1, worldTime: { delta: advanceTime } };
            Hooks.callAll("combatRound", this, updateData, updateOptions);
            await this.update(updateData, updateOptions);
            return this;
        }
        return wrapped.apply(this, args);
    }

    const turn = this.turn ?? this.turns.length;
    let normalPrevTurn = null;
    if (this.settings.skipDefeated) {
        for (let i = turn - 1; i >= 0; i--) {
            if (!this.turns[i].isDefeated) {
                normalPrevTurn = i;
                break;
            }
        }
    } else {
        normalPrevTurn = turn - 1;
    }

    if (normalPrevTurn === null || normalPrevTurn < 0) {
        return wrapped.apply(this, args);
    }

    const candidateCombatant = this.turns[normalPrevTurn];
    if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
        return wrapped.apply(this, args);
    }

    if (hasRemainingLegendaryActions(this, candidateCombatant)) {
        return wrapped.apply(this, args);
    }

    debug(`Legendary Action Placeholders | Auto-skipping placeholder backward at turn ${normalPrevTurn} (no legendary action uses remaining).`);

    // Skip backwards past placeholder(s)
    let targetTurn = null;
    for (let i = normalPrevTurn - 1; i >= 0; i--) {
        const combatant = this.turns[i];
        if (this.settings.skipDefeated && combatant.isDefeated) continue;
        if (_isSkippablePlaceholder(this, combatant)) continue;
        targetTurn = i;
        break;
    }

    if (targetTurn === null || targetTurn < 0) {
        return this.previousRound();
    }

    const advanceTime = this.getTimeDelta(this.round, this.turn, this.round, targetTurn);
    const updateData = { round: this.round, turn: targetTurn };
    const updateOptions = { direction: -1, worldTime: { delta: advanceTime } };
    Hooks.callAll("combatTurn", this, updateData, updateOptions);
    await this.update(updateData, updateOptions);
    return this;
}

/**
 * Check if the given combat encounter is currently on a legendary action placeholder turn.
 * @param {Combat} [combat]
 * @returns {boolean}
 */
export function isLegendaryPlaceholderTurn(combat) {
    if (!getSetting("enableLegendaryActionPlaceholders")) return false;
    if (!combat || (combat.round ?? 0) === 0 || !combat.turns?.length) return false;
    const currentCombatant = combat.combatant;
    return Boolean(currentCombatant?.getFlag(MODULE_ID, "isLegendaryPlaceholder"));
}

/**
 * Activities with a legendary activation on an actor that has no Legendary Actions count of its own.
 * NPCs (which have `system.resources.legact`) return none: their count decides.
 * @param {Actor} actor
 * @returns {object[]} dnd5e Activity instances
 */
function _getLegendaryActivities(actor) {
    if (!actor || actor.system?.resources?.legact) return [];
    const activities = [];
    for (const item of actor.items ?? []) {
        for (const activity of item.system?.activities ?? []) {
            if (LEGENDARY_ACTIVATION_TYPES.has(activity?.activation?.type)) activities.push(activity);
        }
    }
    return activities;
}

/**
 * Remaining uses of a legendary activity on an actor without a Legendary Actions count.
 * Uses the smallest value among its consumption targets; without numeric targets, its own or its item's limited
 * uses; without any limit, Infinity.
 * @param {object} activity dnd5e Activity
 * @returns {number}
 */
function _getActivityRemainingUses(activity) {
    const item = activity.item;
    const actor = activity.actor ?? item?.actor;
    const values = [];
    for (const target of activity.consumption?.targets ?? []) {
        let value;
        if (target.type === "activityUses") value = activity.uses?.value;
        else if (target.type === "itemUses") value = (target.target ? actor?.items?.get(target.target) : item)?.system?.uses?.value;
        else if ((target.type === "attribute") && target.target) value = foundry.utils.getProperty(actor?.system ?? {}, target.target);
        if ((value !== null) && (value !== undefined) && (value !== "") && Number.isFinite(Number(value))) values.push(Number(value));
    }
    if (!values.length) {
        if (Number(activity.uses?.max) > 0) values.push(Number(activity.uses.value) || 0);
        if (Number(item?.system?.uses?.max) > 0) values.push(Number(item.system.uses.value) || 0);
    }
    if (!values.length) return Infinity;
    return Math.max(0, Math.min(...values));
}

/**
 * Whether a combatant is a legendary creature: a Legendary Actions count above 0, or (for actors without that count,
 * e.g. player characters) a feature with a Legendary Action activation.
 * @param {Combatant} combatant
 * @returns {boolean}
 */
export function isLegendaryCombatant(combatant) {
    if (!combatant || combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) return false;
    const actor = combatant.actor;
    if (!actor) return false;
    const legact = actor.system?.resources?.legact;
    if (legact) return Number(legact.max) > 0;
    return _getLegendaryActivities(actor).length > 0;
}

/**
 * Determine remaining legendary action uses for a given combatant.
 * Returns 0 if the combatant is defeated, dead, has 0 HP, or has no uses remaining.
 * @param {Combatant} combatant
 * @returns {number}
 */
function _getCombatantRemainingLegendaryActions(combatant) {
    if (!combatant || combatant.isDefeated) return 0;
    const actor = combatant.actor;
    if (!actor) return 0;
    if (actor.statuses?.has("dead") || (actor.system?.attributes?.hp?.value ?? 1) <= 0) return 0;

    const legact = actor.system?.resources?.legact;
    if (!legact) {
        let remaining = 0;
        for (const activity of _getLegendaryActivities(actor)) {
            remaining = Math.max(remaining, _getActivityRemainingUses(activity));
            if (remaining === Infinity) break;
        }
        return remaining;
    }

    const max = Number(legact.max) || 0;
    if (max <= 0) return 0;

    const remaining = typeof legact.value === "number"
        ? legact.value
        : max - (Number(legact.spent) || 0);

    return Math.max(0, remaining);
}

/**
 * Helper to collect all scene Tokens corresponding to combatants with remaining legendary actions.
 * @param {Combat} combat
 * @returns {Set<Token>}
 */
function _getLegendaryTokensWithRemainingActions(combat) {
    const tokens = new Set();
    if (!combat?.combatants?.size) return tokens;

    for (const combatant of _getPlaceholderLegendaryCombatants(combat, combat.combatant)) {
        if (combatant.sceneId && canvas.scene?.id && combatant.sceneId !== canvas.scene.id) continue;
        if ((combatant.hidden || combatant.token?.hidden) && !game.user.isGM) continue;
        if (_getCombatantRemainingLegendaryActions(combatant) > 0) {
            const token = canvas.tokens?.get(combatant.tokenId) ?? combatant.token?._object;
            if (token) tokens.add(token);
        }
    }

    return tokens;
}

/**
 * Check if a token is eligible to display the turn marker during a legendary action placeholder turn.
 * @param {Token} token
 * @param {Combat} [combat]
 * @returns {boolean}
 */
function _isTokenEligibleForPlaceholderTurnMarker(token, combat) {
    if (!token || !combat?.combatants?.size) return false;
    const sceneId = canvas.scene?.id ?? token.document?.parent?.id;
    for (const combatant of _getPlaceholderLegendaryCombatants(combat, combat.combatant)) {
        if (combatant.sceneId && sceneId && combatant.sceneId !== sceneId) continue;
        if ((combatant.hidden || combatant.token?.hidden) && !game.user.isGM) continue;
        if (combatant.tokenId === token.id) {
            if (_getCombatantRemainingLegendaryActions(combatant) > 0) return true;
        }
    }
    return false;
}

/**
 * Handle Combat#_updateTurnMarkers: when a placeholder turn is active, ensure all eligible
 * creatures with remaining legendary actions are flagged to display turn markers, and any
 * tokens that no longer qualify have their turn markers refreshed (removed).
 *
 * Does NOT call core wrapped during placeholder turns to avoid core flagging all tokens in
 * canvas.tokens.turnMarkers, which would destroy and rebuild existing active meshes on every update.
 *
 * @param {Function} wrapped Original or downstream _updateTurnMarkers function
 * @param {...any} args
 */
function _handleUpdateTurnMarkers(wrapped, ...args) {
    if (!canvas.ready || !canvas.tokens?.turnMarkers || !this.isView) return wrapped.apply(this, args);
    if (!isLegendaryPlaceholderTurn(this)) return wrapped.apply(this, args);

    const legendaryTokens = _getLegendaryTokensWithRemainingActions(this);

    // Flag tokens currently in turnMarkers that are no longer eligible (e.g. previous turn's token, or 0 uses left)
    for (const token of canvas.tokens.turnMarkers) {
        if (!legendaryTokens.has(token)) {
            token.renderFlags.set({ refreshTurnMarker: true });
        }
    }

    // Flag eligible tokens that do not currently have an active turn marker
    for (const token of legendaryTokens) {
        if (!canvas.tokens.turnMarkers.has(token)) {
            token.renderFlags.set({ refreshTurnMarker: true });
        }
    }
}

/**
 * Handle Token#_refreshTurnMarker: if currently on a legendary action placeholder turn and
 * this token is an alive creature with remaining legendary actions, temporarily set the
 * placeholder combatant's tokenId to this token so core's turn marker activation logic
 * executes completely natively (including sprite meshes, shaders, and disposition tinting).
 *
 * @param {Function} wrapped Original or downstream _refreshTurnMarker function
 * @param {...any} args
 */
function _handleRefreshTurnMarker(wrapped, ...args) {
    const combat = game.combat;
    if (isLegendaryPlaceholderTurn(combat) && _isTokenEligibleForPlaceholderTurnMarker(this, combat)) {
        const combatant = combat.combatant;
        if (combatant) {
            const originalDescriptor = Object.getOwnPropertyDescriptor(combatant, "tokenId");
            Object.defineProperty(combatant, "tokenId", {
                value: this.id,
                configurable: true,
                writable: true
            });
            try {
                return wrapped.apply(this, args);
            } finally {
                if (originalDescriptor) {
                    Object.defineProperty(combatant, "tokenId", originalDescriptor);
                } else {
                    delete combatant.tokenId;
                }
            }
        }
    }
    return wrapped.apply(this, args);
}

/**
 * Wrap nextTurn and previousTurn on Combat document class, as well as turn marker methods
 * on Combat and Token to display the core combat turn marker on all creatures with remaining
 * legendary actions when a placeholder turn is active.
 *
 * Uses libWrapper when available to avoid conflicts with modules like Monk's Combat Details,
 * falling back to prototype wrapping if libWrapper is not present.
 */
function _wrapCombatMethods() {
    patchMethod("Combat.prototype.nextTurn", _handleNextTurn, "MIXED");
    patchMethod("Combat.prototype.previousTurn", _handlePreviousTurn, "MIXED");
    patchMethod("Combat.prototype._updateTurnMarkers", _handleUpdateTurnMarkers, "MIXED");
    patchMethod("CONFIG.Token.objectClass.prototype._refreshTurnMarker", _handleRefreshTurnMarker, "WRAPPER");
}

/**
 * Handle ActiveEffect changes (creation, deletion, or enabled/disabled toggles) on combatants
 * to ensure status changes (e.g. "dead") immediately reflect on placeholder turn markers.
 * @param {ActiveEffect} effect
 * @param {object} [changed=null]
 */
function _handleActiveEffectChange(effect, changed = null) {
    const rawTarget = effect.target ?? effect.parent;
    const actor = rawTarget instanceof Actor ? rawTarget : (rawTarget?.parent instanceof Actor ? rawTarget.parent : null);
    if (!(actor instanceof Actor)) return;

    const defeatedId = CONFIG.specialStatusEffects?.DEFEATED || "defeated";
    const isDefeatedOrDead = effect.statuses?.has("dead")
        || effect.statuses?.has(defeatedId)
        || effect.statuses?.has("defeated")
        || (changed && ("disabled" in changed || "statuses" in changed));
    if (!isDefeatedOrDead) return;

    for (const combat of game.combats ?? []) {
        if (combat.isView && isLegendaryPlaceholderTurn(combat)) {
            if (combat.combatants?.some(c => c.actorId === actor.id || c.actor === actor || c.actor?.id === actor.id)) {
                combat._updateTurnMarkers();
            }
        }
    }
}

/**
 * Preloads an image path using HTMLImageElement to test whether it can be loaded.
 * @param {string} src
 * @returns {Promise<boolean>}
 */
function _canLoadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
    });
}

/**
 * Validate that an icon path exists and can be rendered by the browser.
 * Falls back to DEFAULT_ICON for any error (404, 403, CORS, network failure, or corrupt/invalid image file).
 * @param {string} path
 * @returns {Promise<string>}
 */
async function _resolveIcon(path) {
    if (!path || typeof path !== "string") return DEFAULT_ICON;
    const trimmed = path.trim();
    if (!trimmed || trimmed === DEFAULT_ICON) return DEFAULT_ICON;

    try {
        const canLoad = await _canLoadImage(trimmed);
        if (canLoad) return trimmed;
    } catch (err) {
        debug(`Legendary Action Placeholders | Custom icon "${trimmed}" failed validation:`, err);
    }

    debug(`Legendary Action Placeholders | Custom icon "${trimmed}" could not be loaded. Falling back to default icon.`);
    return DEFAULT_ICON;
}

export function initLegendaryActionPlaceholders() {
    // 1. Wrap nextTurn / previousTurn on Combat document class to automatically skip placeholders
    _wrapCombatMethods();

    // 2. Secondary safety net for direct combat updates (e.g. from macros or external modules)
    Hooks.on("preUpdateCombat", (combat, changed, options, userId) => {
        try {
            if (!getSetting("enableLegendaryActionPlaceholders")) return;
            if (!getSetting("autoSkipEmptyLegendaryPlaceholders")) return;
            if (typeof changed.turn !== "number") return;
            if ((changed.round ?? combat.round) === 0) return;

            const targetCombatant = combat.turns?.[changed.turn];
            if (!targetCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) return;

            if (hasRemainingLegendaryActions(combat, targetCombatant)) return;

            debug(`Legendary Action Placeholders | Direct turn update to placeholder intercepted at turn ${changed.turn}. Redirecting.`);

            const roundDelta = (changed.round ?? combat.round) - (combat.round ?? 0);
            let direction = options.direction;
            if (direction === undefined) {
                if (roundDelta !== 0) direction = roundDelta > 0 ? 1 : -1;
                else direction = changed.turn >= (combat.turn ?? 0) ? 1 : -1;
            }

            const currentRound = changed.round ?? combat.round;

            if (direction >= 0) {
                let nextTurn = null;
                for (let i = changed.turn + 1; i < combat.turns.length; i++) {
                    const c = combat.turns[i];
                    if (combat.settings.skipDefeated && c.isDefeated) continue;
                    if (_isSkippablePlaceholder(combat, c)) continue;
                    nextTurn = i;
                    break;
                }
                if (nextTurn !== null) {
                    changed.turn = nextTurn;
                } else {
                    if (roundDelta <= 0) changed.round = currentRound + 1;
                    let firstTurn = 0;
                    for (let i = 0; i < combat.turns.length; i++) {
                        const c = combat.turns[i];
                        if (combat.settings.skipDefeated && c.isDefeated) continue;
                        if (_isSkippablePlaceholder(combat, c)) continue;
                        firstTurn = i;
                        break;
                    }
                    changed.turn = firstTurn;
                }
            } else {
                let prevTurn = null;
                for (let i = changed.turn - 1; i >= 0; i--) {
                    const c = combat.turns[i];
                    if (combat.settings.skipDefeated && c.isDefeated) continue;
                    if (_isSkippablePlaceholder(combat, c)) continue;
                    prevTurn = i;
                    break;
                }
                if (prevTurn !== null) {
                    changed.turn = prevTurn;
                } else {
                    if (roundDelta >= 0) changed.round = Math.max(1, currentRound - 1);
                    let lastTurn = Math.max(0, combat.turns.length - 1);
                    for (let i = combat.turns.length - 1; i >= 0; i--) {
                        const c = combat.turns[i];
                        if (combat.settings.skipDefeated && c.isDefeated) continue;
                        if (_isSkippablePlaceholder(combat, c)) continue;
                        lastTurn = i;
                        break;
                    }
                    changed.turn = lastTurn;
                }
            }

            // Sync worldTime delta with actual redirection if present
            if (options.worldTime && typeof combat.getTimeDelta === "function") {
                const targetRound = changed.round ?? combat.round;
                const targetTurn = changed.turn;
                options.worldTime.delta = combat.getTimeDelta(combat.round, combat.turn, targetRound, targetTurn);
            }
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Error in preUpdateCombat for legendary placeholders:", err);
        }
    });

    // Invalidate cache and update turn markers when combatants are added, removed, or updated
    Hooks.on("createCombatant", c => {
        _invalidateLegendaryCache(c.combat);
        if (c.combat?.isView && isLegendaryPlaceholderTurn(c.combat)) c.combat._updateTurnMarkers();
    });
    Hooks.on("deleteCombatant", c => {
        _invalidateLegendaryCache(c.combat);
        if (c.combat?.isView && isLegendaryPlaceholderTurn(c.combat)) c.combat._updateTurnMarkers();
    });
    Hooks.on("updateCombatant", (c, changed) => {
        if ("actorId" in changed || changed.system?.resources?.legact?.max !== undefined) {
            _invalidateLegendaryCache(c.combat);
        }
        if ((changed.defeated !== undefined || "actorId" in changed || "tokenId" in changed || "hidden" in changed)
            && c.combat?.isView && isLegendaryPlaceholderTurn(c.combat)) {
            c.combat._updateTurnMarkers();
        }
    });
    Hooks.on("updateToken", (tokenDoc, changed) => {
        if (("hidden" in changed || "disposition" in changed) && game.combat?.isView && isLegendaryPlaceholderTurn(game.combat)) {
            game.combat._updateTurnMarkers();
        }
    });
    Hooks.on("updateActor", (actor, changed) => {
        const legactMaxChanged = ("system.resources.legact.max" in changed)
            || (changed.system?.resources?.legact?.max !== undefined);
        const legactChanged = ("system.resources.legact" in changed)
            || ("system.resources.legact.spent" in changed)
            || ("system.resources.legact.value" in changed)
            || (changed.system?.resources?.legact !== undefined);
        const hpChanged = ("system.attributes.hp" in changed)
            || ("system.attributes.hp.value" in changed)
            || (changed.system?.attributes?.hp !== undefined);

        if (legactMaxChanged) {
            for (const combat of game.combats ?? []) {
                if (combat.combatants?.some(c => c.actorId === actor.id || c.actor === actor)) {
                    _invalidateLegendaryCache(combat);
                }
            }
        }

        if (legactChanged || hpChanged) {
            for (const combat of game.combats ?? []) {
                if (combat.isView && isLegendaryPlaceholderTurn(combat)) {
                    if (combat.combatants?.some(c => c.actorId === actor.id || c.actor === actor)) {
                        combat._updateTurnMarkers();
                    }
                }
            }
        }
    });

    // Legendary features of actors without a Legendary Actions count (e.g. player characters): adding, removing or
    // changing one can make its actor legendary; spending or recovering its uses changes who gets a turn marker
    const handleItemChange = (item, changed = null) => {
        const actor = item?.parent;
        if (!(actor instanceof Actor) || actor.system?.resources?.legact) return;
        const structural = !changed || ("type" in changed) || (changed.system?.activities !== undefined)
            || Object.keys(changed).some(k => k.startsWith("system.activities"));
        const usesChanged = !changed || (changed.system?.uses !== undefined) || (changed.system?.activities !== undefined)
            || Object.keys(changed).some(k => k.startsWith("system.uses") || k.startsWith("system.activities"));
        if (!structural && !usesChanged) return;
        for (const combat of game.combats ?? []) {
            if (!combat.combatants?.some(c => c.actorId === actor.id || c.actor === actor)) continue;
            if (structural) _invalidateLegendaryCache(combat);
            if (combat.isView && isLegendaryPlaceholderTurn(combat)) combat._updateTurnMarkers();
        }
    };
    Hooks.on("createItem", item => handleItemChange(item));
    Hooks.on("deleteItem", item => handleItemChange(item));
    Hooks.on("updateItem", (item, changed) => handleItemChange(item, changed));

    // Synchronize turn markers when ActiveEffects (e.g. dead status) are created, updated, or deleted
    Hooks.on("createActiveEffect", (effect) => _handleActiveEffectChange(effect));
    Hooks.on("deleteActiveEffect", (effect) => _handleActiveEffectChange(effect));
    Hooks.on("updateActiveEffect", (effect, changed) => {
        if ("disabled" in changed || "statuses" in changed) {
            _handleActiveEffectChange(effect, changed);
        }
    });

    // Ensure turn markers are drawn on active legendary creatures when viewing the canvas
    Hooks.on("canvasReady", () => {
        if (game.combat && isLegendaryPlaceholderTurn(game.combat)) {
            game.combat._updateTurnMarkers();
        }
    });

    // Upstream DnD5e 6.x combat recovery crashes if a combatant has no actor (e.g. legendary placeholders)
    Hooks.on("dnd5e.combatRecovery", (combatant) => {
        if (!combatant?.actor || combatant.getFlag?.(MODULE_ID, "isLegendaryPlaceholder")) {
            return false;
        }
    });

    Hooks.on("combatStart", async (combat) => {
        try {
            _invalidateLegendaryCache(combat);
            // Only run for the primary GM
            const activeGM = game.users.activeGM;
            if (!activeGM?.isSelf) return;

            // Check if the setting is enabled
            if (!getSetting("enableLegendaryActionPlaceholders")) return;

            // Check if there is at least one combatant with legendary actions
            const hasLegendary = combat.combatants.some(c => isLegendaryCombatant(c));

            if (!hasLegendary) {
                debug(`No actors with legendary actions found in combat ${combat.id}.`);
                return;
            }

            // If placeholders already exist, do not recreate them
            const alreadyHasPlaceholders = combat.combatants.some(c => c.getFlag(MODULE_ID, "isLegendaryPlaceholder"));
            if (alreadyHasPlaceholders) {
                debug(`Combat ${combat.id} already has legendary action placeholders.`);
                return;
            }

            // All creatures in turn order. A placeholder follows each creature after whose turn at least one other
            // legendary creature may act (see _canActAfter and the placement setting)
            const creatures = (combat.turns ?? []).filter(c => !_isPlaceholder(c));
            const legendary = creatures.filter(c => isLegendaryCombatant(c));
            const mode = _getPlacementMode();
            const followed = creatures.filter(c => legendary.some(l => _canActAfter(l, c, mode)));

            if (!followed.length) {
                debug(`Legendary Action Placeholders | No creature in combat ${combat.id} needs a placeholder (${mode}).`);
                return;
            }

            // Tied initiatives: every creature after the first in a tie gets a minimal tie breaker, keeping the current
            // order, so each placeholder sorts directly after its own creature
            const roundKey = val => Number(Number(val).toFixed(4));
            const initiativeCounts = new Map();
            for (const c of creatures) {
                if (!Number.isNumeric(c.initiative)) continue;
                const key = roundKey(c.initiative);
                initiativeCounts.set(key, (initiativeCounts.get(key) ?? 0) + 1);
            }

            const seenCounts = new Map();
            const combatantUpdates = [];
            const effectiveInitiatives = new Map();

            for (const c of creatures) {
                const baseInit = c.initiative;
                if (!Number.isNumeric(baseInit)) {
                    effectiveInitiatives.set(c.id, 0);
                    continue;
                }

                const key = roundKey(baseInit);
                if ((initiativeCounts.get(key) ?? 0) > 1) {
                    const tieIndex = seenCounts.get(key) ?? 0;
                    seenCounts.set(key, tieIndex + 1);
                    if (tieIndex > 0) {
                        const tieBreaker = Number((tieIndex * TIE_BREAKER_STEP).toFixed(5));
                        const newInitiative = Number((baseInit - tieBreaker).toFixed(5));
                        combatantUpdates.push({ _id: c.id, initiative: newInitiative });
                        effectiveInitiatives.set(c.id, newInitiative);
                        continue;
                    }
                }

                effectiveInitiatives.set(c.id, baseInit);
            }

            const configuredIcon = getSetting("legendaryActionPlaceholderIcon");
            const img = await _resolveIcon(configuredIcon);
            const showToPlayers = getSetting("showLegendaryActionPlaceholders");

            const newCombatants = followed.map(c => {
                const effectiveInit = effectiveInitiatives.get(c.id) ?? c.initiative ?? 0;
                return {
                    name: game.i18n.localize("ND5T.LegendaryActionPlaceholder") || "Legendary Action Placeholder",
                    // A visible placeholder after a hidden creature would give its position away
                    hidden: !showToPlayers || Boolean(c.hidden),
                    img,
                    initiative: Number((effectiveInit - PLACEHOLDER_OFFSET).toFixed(5)),
                    flags: {
                        [MODULE_ID]: {
                            isLegendaryPlaceholder: true,
                            afterCombatantId: c.id
                        }
                    }
                };
            });

            queueMicrotask(async () => {
                try {
                    if (!combat || combat.destroyed || !game.combats?.has(combat.id)) return;

                    // First give an additional minimal tie breaker to their initiative if needed
                    if (combatantUpdates.length > 0) {
                        debug(`Legendary Action Placeholders | Applying minimal initiative tie breakers to ${combatantUpdates.length} combatants in combat ${combat.id}.`);
                        await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);
                    }

                    // Then place the legendary action placeholders
                    debug(`Legendary Action Placeholders | Inserting ${newCombatants.length} placeholders for combat ${combat.id}.`);
                    await combat.createEmbeddedDocuments("Combatant", newCombatants);
                } catch (err) {
                    console.error(`Nik's DnD5e Tweaks | Failed to process legendary action placeholders:`, err);
                }
            });
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Error in combatStart hook for Legendary Action Placeholders:`, err);
        }
    });
}
