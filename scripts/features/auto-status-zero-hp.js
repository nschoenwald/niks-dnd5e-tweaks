import { MODULE_ID, debug } from "../main.js";

/**
 * Auto Status at 0 HP
 *
 * Automatically applies a configurable status condition (dead / unconscious)
 * to tokens that drop to 0 HP, and removes both dead and unconscious when
 * a token regains any HP.  Separate settings for player-owned and
 * GM-owned (NPC) tokens.
 *
 * Additionally can mark the combatant as defeated or remove it from the
 * combat tracker entirely when a token reaches 0 HP, and un-defeat it
 * when it regains HP.
 */

/**
 * Per-actor debounce timers to prevent conflicting processing when
 * HP changes rapidly (e.g. damage + instant healing in < 250ms).
 * Only the latest HP change within the debounce window is processed.
 * @type {Map<string, number>}
 */
const _debounceTimers = new Map();

/**
 * Determine whether an actor is "player-owned" (has at least one non-GM
 * user with OWNER permission) or "NPC" (only GM owners).
 * @param {Actor} actor
 * @returns {"player"|"npc"}
 */
/**
 * Determine whether an actor is "player-owned" (Player Character type or has player owners)
 * or "NPC" (GM-owned non-character).
 * @param {Actor} actor
 * @returns {"player"|"npc"}
 */
function _ownershipType(actor) {
    if (actor.type === "character" || actor.hasPlayerOwner) return "player";
    return "npc";
}

// ── Status condition helpers ──────────────────────────────────────────

/**
 * Apply (or upgrade) the configured status condition for a token at 0 HP.
 *
 * If the status already exists (e.g. applied by the DnD5e system or another
 * module) but lacks the `flags.core.overlay` flag, upgrade it to an overlay
 * so the big icon displays on the token.
 *
 * Wrapped in try-catch because the DnD5e system (and other modules like
 * monks-combat-details) may also apply the same fixed-ID status effect
 * concurrently, causing a duplicate _id error.
 * @param {Actor} actor
 * @param {string} statusId  "dead" | "unconscious" | "none"
 */
async function _applyZeroHPStatus(actor, statusId) {
    if (!actor || !actor.statuses || statusId === "none") return;

    // Remove conflicting opposite 0-HP status if present
    const oppositeStatusId = statusId === "unconscious" ? "dead" : statusId === "dead" ? "unconscious" : null;
    if (oppositeStatusId && actor.statuses.has(oppositeStatusId)) {
        try {
            await actor.toggleStatusEffect(oppositeStatusId, { active: false });
        } catch (e) {
            debug(`Auto-Status | Could not remove opposing status "${oppositeStatusId}" from ${actor.name}: ${e.message}`);
        }
    }

    if (!actor.statuses.has(statusId)) {
        // Status not yet present — apply it fresh as an overlay
        debug(`Auto-Status | Applying "${statusId}" overlay to ${actor.name}`);
        try {
            await actor.toggleStatusEffect(statusId, { active: true, overlay: true });
        } catch (e) {
            debug(`Auto-Status | Could not apply "${statusId}" to ${actor.name}: ${e.message}`);
        }
    } else {
        // Status already exists — ensure it's displayed as an overlay
        const effect = actor.effects.find(e => e.statuses?.has(statusId));
        if (effect && !effect.getFlag("core", "overlay")) {
            debug(`Auto-Status | "${statusId}" exists on ${actor.name} but is not an overlay — upgrading`);
            try {
                await effect.update({ "flags.core.overlay": true });
            } catch (e) {
                debug(`Auto-Status | Could not upgrade "${statusId}" overlay on ${actor.name}: ${e.message}`);
            }
        } else {
            debug(`Auto-Status | ${actor.name} already has "${statusId}" as overlay — skipping`);
        }
    }
}

/**
 * Remove dead and unconscious status effects from an actor that has
 * regained HP.
 * @param {Actor} actor
 */
async function _removeZeroHPStatuses(actor) {
    if (!actor || !actor.statuses) return;
    for (const statusId of ["dead", "unconscious"]) {
        if (actor.statuses.has(statusId)) {
            debug(`Auto-Status | Removing "${statusId}" from ${actor.name}`);
            try {
                await actor.toggleStatusEffect(statusId, { active: false });
            } catch (e) {
                debug(`Auto-Status | Could not remove "${statusId}" from ${actor.name}: ${e.message}`);
            }
        }
    }
}

// ── Combat tracker helpers ────────────────────────────────────────────

/**
 * Find the Combatant document(s) for a given actor across all active combats.
 * For unlinked tokens (synthetic actors) this matches by the specific token ID
 * so that only the token that actually changed HP is affected — not every
 * combatant that shares the same base actor.
 * @param {Actor} actor
 * @returns {Combatant[]}
 */
function _getCombatants(actor) {
    const combatants = [];
    const tokenId = actor.isToken ? actor.token.id : null;

    for (const combat of game.combats) {
        for (const c of combat.combatants) {
            if (tokenId) {
                // Unlinked token — match the specific token, not the base actor
                if (c.tokenId === tokenId) combatants.push(c);
            } else {
                // Linked token — match by actor ID (all tokens share the actor)
                if (c.actorId === actor.id) combatants.push(c);
            }
        }
    }
    return combatants;
}

/**
 * Handle the combat action when a token reaches 0 HP.
 * @param {Actor} actor
 * @param {string} action  "defeated" | "remove" | "none"
 */
async function _handleCombatActionZeroHP(actor, action) {
    if (action === "none") return;
    const combatants = _getCombatants(actor);
    if (!combatants.length) return;

    for (const combatant of combatants) {
        if (action === "defeated") {
            if (combatant.defeated) {
                debug(`Auto-Status | ${actor.name} is already defeated — skipping`);
                continue;
            }
            debug(`Auto-Status | Marking ${actor.name} as defeated`);
            await combatant.update({ defeated: true });
        } else if (action === "remove") {
            debug(`Auto-Status | Removing ${actor.name} from combat`);
            await combatant.delete();
        }
    }
}

/**
 * Un-defeat all combatant entries for an actor when it regains HP.
 * Does NOT re-add removed combatants — that's a deliberate choice.
 * @param {Actor} actor
 */
async function _undefeatCombatant(actor) {
    const combatants = _getCombatants(actor);
    for (const combatant of combatants) {
        if (combatant.defeated) {
            debug(`Auto-Status | Un-defeating ${actor.name}`);
            await combatant.update({ defeated: false });
        }
    }
}

/**
 * Capture the old HP state before it gets updated.
 *
 * @param {Actor}  actor
 * @param {object} change
 * @param {object} options
 * @param {string} userId
 */
function _onPreUpdateActor(actor, change, options, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoStatusZeroHP")) return;

        // Only the GM client should process this.
        if (!game.user.isGM) return;

        // Only react when HP actually changed.
        if (foundry.utils.getProperty(change, "system.attributes.hp.value") === undefined) return;

        // Record whether the actor was at 0 HP before this update
        options.autoStatusWasZeroHP = actor.system.attributes.hp.value <= 0;
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onPreUpdateActor for Auto-Status 0 HP:`, err);
    }
}

/**
 * Core handler — called from the updateActor hook.
 *
 * Processing is deferred by a short timeout so that the dnd5e system and
 * other modules (e.g. monks-combat-details) can apply their own status
 * effects first.  Without this, both our module and others race to create
 * the same fixed-ID ActiveEffect (e.g. dnd5edead0000000), causing a
 * duplicate _id error in whichever module loses the race.
 *
 * @param {Actor}  actor
 * @param {object} change
 * @param {object} options
 * @param {string} userId
 */
function _onUpdateActor(actor, change, options, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoStatusZeroHP")) return;

        // Only the GM client should process this to avoid duplicate updates.
        if (!game.user.isGM) return;

        // Only react when HP actually changed.
        if (foundry.utils.getProperty(change, "system.attributes.hp.value") === undefined) return;

        // Capture values now; defer processing to avoid race conditions.
        // The actor reference is passed live intentionally — by the time the
        // deferred callback runs, we *want* to see the latest statuses/effects
        // so our checks reflect what other modules have already applied.
        const newHP = actor.system.attributes.hp.value;
        const type = _ownershipType(actor);

        // Determine if actor was at 0 HP before, or currently has 0-HP statuses.
        const wasZeroHP = options.autoStatusWasZeroHP === true
            || actor.statuses.has("dead")
            || actor.statuses.has("unconscious");

        // Debounce per actor — if HP changes again within 250ms, cancel the
        // previous callback and only process the latest state.
        const existingTimer = _debounceTimers.get(actor.id);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
            _debounceTimers.delete(actor.id);
            _processHPChange(actor, newHP, type, wasZeroHP).catch(err => {
                console.error(`Nik's DnD5e Tweaks | Failed processing HP change for Auto-Status 0 HP:`, err);
            });
        }, 250);
        _debounceTimers.set(actor.id, timer);
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onUpdateActor for Auto-Status 0 HP:`, err);
    }
}

/**
 * Deferred HP-change handler.  By the time this runs the dnd5e system
 * and other modules will have finished their own status-effect work,
 * so our `statuses.has()` checks will see the true state.
 * @param {Actor}  actor
 * @param {number} newHP
 * @param {"player"|"npc"} type
 * @param {boolean} wasZeroHP
 */
async function _processHPChange(actor, newHP, type, wasZeroHP) {
    // Guard: actor may have been deleted during the debounce window
    if (!actor || !actor.id || !actor.statuses) return;
    if (actor.isToken) {
        if (!actor.token || actor.token._destroyed) return;
        if (canvas?.scene && !canvas.scene.tokens.has(actor.token.id)) return;
    }

    // Skip actors with no max HP (vehicles, objects, etc.) to avoid
    // false triggers — they are always at "0 HP" if max is 0.
    if ((actor.system?.attributes?.hp?.max ?? 0) <= 0) return;

    // Use live HP if available
    const liveHP = actor.system.attributes.hp?.value ?? newHP;

    if (liveHP <= 0) {
        // ── Status overlay ──
        const statusKey = type === "player"
            ? "autoStatusZeroHP_playerStatus"
            : "autoStatusZeroHP_npcStatus";
        const statusId = game.settings.get(MODULE_ID, statusKey);
        await _applyZeroHPStatus(actor, statusId);

        // ── Combat action ──
        const combatKey = type === "player"
            ? "autoStatusZeroHP_playerCombat"
            : "autoStatusZeroHP_npcCombat";
        const combatAction = game.settings.get(MODULE_ID, combatKey);
        await _handleCombatActionZeroHP(actor, combatAction);
    } else {
        // HP is above 0 — remove any zero-HP statuses and un-defeat,
        // if the actor was at 0 HP before or currently holds dead/unconscious statuses.
        const holdsZeroHPStatus = actor.statuses?.has("dead") || actor.statuses?.has("unconscious");
        if (wasZeroHP || holdsZeroHPStatus) {
            await _removeZeroHPStatuses(actor);
            await _undefeatCombatant(actor);
        }
    }
}

/**
 * Initialize the feature by registering the updateActor hook.
 * Called once during the "setup" phase from main.js.
 */
export function initAutoStatusZeroHP() {
    Hooks.on("preUpdateActor", _onPreUpdateActor);
    Hooks.on("updateActor", _onUpdateActor);
}
