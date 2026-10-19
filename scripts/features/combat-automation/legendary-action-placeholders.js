/**
 * Feature: Legendary Action Placeholders
 * Description: Inserts placeholder turns in the combat tracker after player turns to track legendary action usage when legendary creatures are present.
 *
 * @introduced v14.3.1
 * @updated v14.46.6 (Auto-skip placeholders when no combatant has legendary action uses remaining)
 */
import { MODULE_ID, debug } from "../../main.js";

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
        if (!c || c.isDefeated) continue;
        const actor = c.actor;
        if (!actor) continue;

        // Skip dead creatures
        if (actor.statuses?.has("dead") || (actor.system?.attributes?.hp?.value ?? 1) <= 0) continue;

        const legact = actor.system?.resources?.legact;
        if (!legact) continue;

        const remaining = typeof legact.value === "number"
            ? legact.value
            : (Number(legact.max) || 0) - (Number(legact.spent) || 0);

        if (remaining > 0) return true;
    }

    return false;
}

/**
 * Wrap nextTurn and previousTurn on the Combat class prototype to automatically skip
 * legendary action placeholder turns when no combatant in the encounter has uses left.
 * @param {Function} CombatClass
 */
function _wrapCombatClass(CombatClass) {
    if (!CombatClass?.prototype) return;

    if (!Object.prototype.hasOwnProperty.call(CombatClass.prototype, "nextTurn") || !CombatClass.prototype.nextTurn?._niksWrapped) {
        const originalNextTurn = CombatClass.prototype.nextTurn;
        CombatClass.prototype.nextTurn = async function patchedNextTurn(...args) {
            if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")
                || !game.settings.get(MODULE_ID, "autoSkipEmptyLegendaryPlaceholders")
                || this.round === 0
                || !this.turns?.length) {
                return originalNextTurn.apply(this, args);
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
                return originalNextTurn.apply(this, args);
            }

            // Performance check: Is normalNextTurn a placeholder?
            // If it is NOT a placeholder, no need to inspect actors/resources! Zero overhead!
            const candidateCombatant = this.turns[normalNextTurn];
            if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
                return originalNextTurn.apply(this, args);
            }

            // Normal next turn IS a placeholder. Now check if any actor has legendary action uses left:
            if (hasRemainingLegendaryActions(this)) {
                // Actions remaining: do not skip, advance to placeholder normally
                return originalNextTurn.apply(this, args);
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
        };
        CombatClass.prototype.nextTurn._niksWrapped = true;
    }

    if (!Object.prototype.hasOwnProperty.call(CombatClass.prototype, "previousTurn") || !CombatClass.prototype.previousTurn?._niksWrapped) {
        const originalPreviousTurn = CombatClass.prototype.previousTurn;
        CombatClass.prototype.previousTurn = async function patchedPreviousTurn(...args) {
            if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")
                || !game.settings.get(MODULE_ID, "autoSkipEmptyLegendaryPlaceholders")
                || this.round === 0
                || !this.turns?.length) {
                return originalPreviousTurn.apply(this, args);
            }

            if (this.turn === 0) {
                if (this.round <= 1) return this.previousRound();
                // Check if the end of previous round is a placeholder and whether it should be skipped
                const candidateCombatant = this.turns[this.turns.length - 1];
                if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
                    return originalPreviousTurn.apply(this, args);
                }
                if (hasRemainingLegendaryActions(this)) {
                    return originalPreviousTurn.apply(this, args);
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
                return originalPreviousTurn.apply(this, args);
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
                return originalPreviousTurn.apply(this, args);
            }

            const candidateCombatant = this.turns[normalPrevTurn];
            if (!candidateCombatant?.flags?.[MODULE_ID]?.isLegendaryPlaceholder) {
                return originalPreviousTurn.apply(this, args);
            }

            if (hasRemainingLegendaryActions(this)) {
                return originalPreviousTurn.apply(this, args);
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
        };
        CombatClass.prototype.previousTurn._niksWrapped = true;
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
    const combatClasses = new Set();
    if (typeof Combat !== "undefined") combatClasses.add(Combat);
    if (CONFIG.Combat?.documentClass) combatClasses.add(CONFIG.Combat.documentClass);
    for (const cls of combatClasses) {
        _wrapCombatClass(cls);
    }

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

    // Invalidate cache when combatants are added, removed, or relevant actor/combatant data changes
    Hooks.on("createCombatant", c => _invalidateLegendaryCache(c.combat));
    Hooks.on("deleteCombatant", c => _invalidateLegendaryCache(c.combat));
    Hooks.on("updateCombatant", (c, changed) => {
        if ("actorId" in changed || changed.system?.resources?.legact?.max !== undefined) {
            _invalidateLegendaryCache(c.combat);
        }
    });
    Hooks.on("updateActor", (actor, changed) => {
        if (changed.system?.resources?.legact?.max !== undefined) {
            for (const combat of game.combats ?? []) {
                if (combat.combatants?.some(c => c.actorId === actor.id)) {
                    _invalidateLegendaryCache(combat);
                }
            }
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
