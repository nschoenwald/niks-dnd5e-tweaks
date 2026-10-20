/**
 * Feature: Legendary Action Placeholders
 * Description: Inserts placeholder turns in the combat tracker after player turns to track legendary action usage when legendary creatures are present.
 *
 * @introduced v14.3.1
 * @updated v14.46.6 (Auto-skip placeholders when no combatant has legendary action uses remaining)
 * @updated v14.48.0 (Native core combat turn marker displayed on legendary creatures during placeholder turns)
 */
import { MODULE_ID, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

const DEFAULT_ICON = "icons/svg/combat.svg";
const PLACEHOLDER_OFFSET = 0.0001;
const TIE_BREAKER_STEP = 0.0002;

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
 * Check if any alive combatant in the combat encounter currently has legendary action uses remaining.
 * Performance-optimized:
 * 1. Uses a WeakMap to cache IDs of combatants with max legendary actions > 0.
 * 2. Only checks the current value/spent of those specific combatants.
 * 3. Short-circuits immediately on the first creature found with remaining uses.
 *
 * @param {Combat} combat
 * @returns {boolean}
 */
export function hasRemainingLegendaryActions(combat) {
    if (!combat?.combatants?.size) return false;

    let cache = _legendaryCombatantsCache.get(combat);
    if (!cache || cache.size !== combat.combatants.size) {
        const ids = [];
        for (const c of combat.combatants) {
            if (c.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
            const max = c.actor?.system?.resources?.legact?.max;
            if (Number(max) > 0) {
                ids.push(c.id);
            }
        }
        cache = { size: combat.combatants.size, ids };
        _legendaryCombatantsCache.set(combat, cache);
    }

    if (!cache.ids.length) return false;

    for (let i = 0; i < cache.ids.length; i++) {
        const c = combat.combatants.get(cache.ids[i]);
        if (_getCombatantRemainingLegendaryActions(c) > 0) return true;
    }

    return false;
}

/**
 * Handle next turn progression on a Combat encounter, auto-skipping legendary action
 * placeholder turns when no combatant in the encounter has uses remaining.
 * @param {Function} wrapped Original or downstream nextTurn function
 * @param {...any} args
 * @returns {Promise<Combat>}
 */
async function _handleNextTurn(wrapped, ...args) {
    if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")
        || !game.settings.get(MODULE_ID, "autoSkipEmptyLegendaryPlaceholders")
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
    if (hasRemainingLegendaryActions(this)) {
        // Actions remaining: do not skip, advance to placeholder normally
        return wrapped.apply(this, args);
    }

    debug(`Legendary Action Placeholders | Auto-skipping placeholder at turn ${normalNextTurn} (no legendary action uses remaining).`);

    // No actor has legendary action uses left: skip placeholder(s)!
    let targetTurn = null;
    for (let i = normalNextTurn + 1; i < this.turns.length; i++) {
        const combatant = this.turns[i];
        if (this.settings.skipDefeated && combatant.isDefeated) continue;
        if (combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
    if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")
        || !game.settings.get(MODULE_ID, "autoSkipEmptyLegendaryPlaceholders")
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
        if (hasRemainingLegendaryActions(this)) {
            return wrapped.apply(this, args);
        }

        debug(`Legendary Action Placeholders | Auto-skipping placeholder backward across round boundary to previous round.`);

        // Skip backwards past trailing placeholder(s) at end of previous round
        let targetTurn = null;
        for (let i = this.turns.length - 2; i >= 0; i--) {
            const combatant = this.turns[i];
            if (this.settings.skipDefeated && combatant.isDefeated) continue;
            if (combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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

    if (hasRemainingLegendaryActions(this)) {
        return wrapped.apply(this, args);
    }

    debug(`Legendary Action Placeholders | Auto-skipping placeholder backward at turn ${normalPrevTurn} (no legendary action uses remaining).`);

    // Skip backwards past placeholder(s)
    let targetTurn = null;
    for (let i = normalPrevTurn - 1; i >= 0; i--) {
        const combatant = this.turns[i];
        if (this.settings.skipDefeated && combatant.isDefeated) continue;
        if (combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
    if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")) return false;
    if (!combat || (combat.round ?? 0) === 0 || !combat.turns?.length) return false;
    const currentCombatant = combat.combatant;
    return Boolean(currentCombatant?.getFlag(MODULE_ID, "isLegendaryPlaceholder"));
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
    if (!legact) return 0;

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

    for (const combatant of combat.combatants) {
        if (combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
    for (const combatant of combat.combatants) {
        if (combatant.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
            if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")) return;
            if (!game.settings.get(MODULE_ID, "autoSkipEmptyLegendaryPlaceholders")) return;
            if (typeof changed.turn !== "number") return;
            if ((changed.round ?? combat.round) === 0) return;

            const targetCombatant = combat.turns?.[changed.turn];
            if (!targetCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) return;

            if (hasRemainingLegendaryActions(combat)) return;

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
                    if (c.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
                        if (c.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
                    if (c.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
                        if (c.flags?.[MODULE_ID]?.isLegendaryPlaceholder) continue;
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
        if ("hidden" in changed && game.combat?.isView && isLegendaryPlaceholderTurn(game.combat)) {
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
            const activeGM = game.users.primaryGM ?? game.users.activeGM;
            if (!activeGM?.isSelf) return;

            // Check if the setting is enabled
            if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")) return;

            // Check if there is at least one combatant with legendary actions
            const hasLegendary = combat.combatants.some(c => c.actor?.system?.resources?.legact?.max > 0);

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

            // Find all player characters or friendly creatures, preserving current turn order from combat.turns
            const playerCombatants = (combat.turns ?? []).filter(c => {
                if (c.getFlag(MODULE_ID, "isLegendaryPlaceholder")) return false;
                const isPC = c.actor?.type === "character";
                const isFriendly = c.token?.disposition === CONST.TOKEN_DISPOSITIONS?.FRIENDLY || c.token?.disposition === 1;
                return isPC || isFriendly;
            });

            if (!playerCombatants.length) return;

            // Detect and prepare minimal tie breaker updates for tied initiatives among player combatants
            const roundKey = val => Number(Number(val).toFixed(4));
            const initiativeCounts = new Map();
            for (const pc of playerCombatants) {
                if (!Number.isNumeric(pc.initiative)) continue;
                const key = roundKey(pc.initiative);
                initiativeCounts.set(key, (initiativeCounts.get(key) ?? 0) + 1);
            }

            const seenCounts = new Map();
            const combatantUpdates = [];
            const pcEffectiveInitiatives = new Map();

            for (const pc of playerCombatants) {
                const baseInit = pc.initiative;
                if (!Number.isNumeric(baseInit)) {
                    pcEffectiveInitiatives.set(pc.id, 0);
                    continue;
                }

                const key = roundKey(baseInit);
                const totalWithInit = initiativeCounts.get(key) ?? 0;
                if (totalWithInit > 1) {
                    const tieIndex = seenCounts.get(key) ?? 0;
                    seenCounts.set(key, tieIndex + 1);

                    if (tieIndex > 0) {
                        // Apply an additional minimal tie breaker to subsequent tied characters
                        // to ensure each has a distinct initiative strictly ordered after previous tied PCs
                        const tieBreaker = Number((tieIndex * TIE_BREAKER_STEP).toFixed(5));
                        const newInitiative = Number((baseInit - tieBreaker).toFixed(5));
                        combatantUpdates.push({
                            _id: pc.id,
                            initiative: newInitiative
                        });
                        pcEffectiveInitiatives.set(pc.id, newInitiative);
                        continue;
                    }
                }

                pcEffectiveInitiatives.set(pc.id, baseInit);
            }

            const configuredIcon = game.settings.get(MODULE_ID, "legendaryActionPlaceholderIcon");
            const img = await _resolveIcon(configuredIcon);

            const newCombatants = playerCombatants.map(pc => {
                const effectiveInit = pcEffectiveInitiatives.get(pc.id) ?? pc.initiative ?? 0;
                return {
                    name: game.i18n.localize("ND5T.LegendaryActionPlaceholder") || "Legendary Action Placeholder",
                    hidden: !game.settings.get(MODULE_ID, "showLegendaryActionPlaceholders"),
                    img,
                    initiative: Number((effectiveInit - PLACEHOLDER_OFFSET).toFixed(5)),
                    flags: {
                        [MODULE_ID]: {
                            isLegendaryPlaceholder: true
                        }
                    }
                };
            });

            queueMicrotask(async () => {
                try {
                    if (!combat || combat.destroyed || !game.combats?.has(combat.id)) return;

                    // First give an additional minimal tie breaker to their initiative if needed
                    if (combatantUpdates.length > 0) {
                        debug(`Legendary Action Placeholders | Applying minimal initiative tie breakers to ${combatantUpdates.length} player combatants in combat ${combat.id}.`);
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
