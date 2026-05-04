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
 * Determine whether an actor is "player-owned" (has at least one non-GM
 * user with OWNER permission) or "NPC" (only GM owners).
 * @param {Actor} actor
 * @returns {"player"|"npc"}
 */
function _ownershipType(actor) {
    for (const [id, level] of Object.entries(actor.ownership)) {
        if (level !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
        if (id === "default") return "player"; // default-owner means every player owns it
        const user = game.users.get(id);
        if (user && !user.isGM) return "player";
    }
    return "npc";
}

// ── Status condition helpers ──────────────────────────────────────────

/**
 * Apply (or skip) the configured status condition for a token at 0 HP.
 * Also applies the "prone" condition since unconscious and dead creatures
 * are prone per D&D 5e rules.
 *
 * Wrapped in try-catch because the DnD5e system (and other modules like
 * monks-combat-details) may also apply the same fixed-ID status effect
 * concurrently, causing a duplicate _id error.
 * @param {Actor} actor
 * @param {string} statusId  "dead" | "unconscious" | "none"
 */
async function _applyZeroHPStatus(actor, statusId) {
    if (statusId === "none") return;

    // Apply the main status condition as an overlay
    if (!actor.statuses.has(statusId)) {
        debug(`Auto-Status | Applying "${statusId}" overlay to ${actor.name}`);
        try {
            await actor.toggleStatusEffect(statusId, { active: true, overlay: true });
        } catch (e) {
            debug(`Auto-Status | Could not apply "${statusId}" to ${actor.name}: ${e.message}`);
        }
    } else {
        debug(`Auto-Status | ${actor.name} already has "${statusId}" — skipping`);
    }

    // Also apply prone (unconscious/dead creatures are prone per 5e rules)
    if (!actor.statuses.has("prone")) {
        debug(`Auto-Status | Applying "prone" to ${actor.name}`);
        try {
            await actor.toggleStatusEffect("prone", { active: true });
        } catch (e) {
            debug(`Auto-Status | Could not apply "prone" to ${actor.name}: ${e.message}`);
        }
    }
}

/**
 * Remove dead and unconscious status effects from an actor that has
 * regained HP.  Prone is intentionally kept — creatures must spend
 * movement to stand up on their turn per 5e rules.
 * @param {Actor} actor
 */
async function _removeZeroHPStatuses(actor) {
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
 */
function _onUpdateActor(actor, change) {
    if (!game.settings.get(MODULE_ID, "enableAutoStatusZeroHP")) return;

    // Only the GM client should process this to avoid duplicate updates.
    if (!game.user.isGM) return;

    // Only react when HP actually changed.
    if (!foundry.utils.hasProperty(change, "system.attributes.hp.value")) return;

    // Capture values now; defer processing to avoid race conditions.
    const newHP = actor.system.attributes.hp.value;
    const type = _ownershipType(actor);

    setTimeout(() => _processHPChange(actor, newHP, type), 250);
}

/**
 * Deferred HP-change handler.  By the time this runs the dnd5e system
 * and other modules will have finished their own status-effect work,
 * so our `statuses.has()` checks will see the true state.
 * @param {Actor}  actor
 * @param {number} newHP
 * @param {"player"|"npc"} type
 */
async function _processHPChange(actor, newHP, type) {
    if (newHP <= 0) {
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
        // HP is above 0 — remove any auto-applied statuses and un-defeat.
        await _removeZeroHPStatuses(actor);
        await _undefeatCombatant(actor);
    }
}

/**
 * Initialize the feature by registering the updateActor hook.
 * Called once during the "setup" phase from main.js.
 */
export function initAutoStatusZeroHP() {
    Hooks.on("updateActor", _onUpdateActor);
}
