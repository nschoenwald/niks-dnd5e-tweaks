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
 * Per-actor debounce records to prevent conflicting processing when
 * HP changes rapidly (e.g. damage + instant healing in < 250ms).
 * Keyed by actor UUID to properly isolate unlinked tokens (synthetic actors).
 * Tracks the timer handle and the initial wasZeroHP state across rapid updates.
 * @type {Map<string, { timer: ReturnType<typeof setTimeout>, wasZeroHP: boolean }>}
 */
const _debounceState = new Map();

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
        const effect = actor.effects.find(e => e.statuses?.has(statusId))
            ?? actor.appliedEffects?.find(e => e.statuses?.has(statusId));
        if (effect && !effect.getFlag("core", "overlay")) {
            debug(`Auto-Status | "${statusId}" exists on ${actor.name} but is not an overlay — upgrading`);
            try {
                await effect.setFlag("core", "overlay", true);
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
    // Also clean up any effects flagged with dnd5e.autoDowned if present
    const autoEffects = actor.effects?.filter(e => e.getFlag?.("dnd5e", "autoDowned"));
    if (autoEffects?.length) {
        try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", autoEffects.map(e => e.id));
        } catch (e) {
            debug(`Auto-Status | Could not remove dnd5e autoDowned effects from ${actor.name}: ${e.message}`);
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

let _updateDownedPatched = false;

/**
 * Patch Actor5e.prototype.updateDowned to suppress the dnd5e system's native
 * autoApplyDowned automation when this feature is enabled.
 */
function _patchUpdateDowned() {
    if (_updateDownedPatched) return;
    const ActorClass = CONFIG.Actor?.documentClass;
    if (!ActorClass?.prototype?.updateDowned) return;

    const originalUpdateDowned = ActorClass.prototype.updateDowned;
    ActorClass.prototype.updateDowned = async function (...args) {
        if (game.settings.get(MODULE_ID, "enableAutoStatusZeroHP")) {
            debug(`Auto-Status | Suppressing native updateDowned for ${this.name} (overridden by niks-dnd5e-tweaks)`);
            return;
        }
        return originalUpdateDowned.apply(this, args);
    };
    _updateDownedPatched = true;
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

        // React when HP or death save failures change.
        const hpChanged = foundry.utils.getProperty(change, "system.attributes.hp.value") !== undefined;
        const deathChanged = foundry.utils.getProperty(change, "system.attributes.death.failure") !== undefined;
        if (!hpChanged && !deathChanged) return;

        // Record whether the actor was at 0 HP before this update
        options.autoStatusWasZeroHP = (actor.system?.attributes?.hp?.value ?? 0) <= 0;
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

        // Only the active primary GM client should process this to avoid duplicate updates.
        const activeGM = game.users.primaryGM ?? game.users.activeGM;
        if (!activeGM?.isSelf) return;

        // React when HP or death save failures change.
        const hpChanged = foundry.utils.getProperty(change, "system.attributes.hp.value") !== undefined;
        const deathChanged = foundry.utils.getProperty(change, "system.attributes.death.failure") !== undefined;
        if (!hpChanged && !deathChanged) return;

        // Capture values now; defer processing to avoid race conditions.
        // The actor reference is passed live intentionally — by the time the
        // deferred callback runs, we *want* to see the latest statuses/effects
        // so our checks reflect what other modules have already applied.
        const newHP = actor.system?.attributes?.hp?.value ?? 0;
        const type = _ownershipType(actor);

        // Debounce per actor UUID — if HP changes again within 250ms, cancel the
        // previous callback and only process the latest state.
        // Using uuid ensures unlinked tokens (synthetic actors) have distinct timers.
        // If a debounce sequence is already active, preserve the initial wasZeroHP state
        // so multi-step HP changes (e.g. 0 -> 1 -> 5) properly recognize the actor started at 0 HP.
        const debounceKey = actor.uuid;
        const existing = _debounceState.get(debounceKey);
        const wasZeroHP = existing ? existing.wasZeroHP : (options.autoStatusWasZeroHP === true);

        if (existing) clearTimeout(existing.timer);

        const timer = setTimeout(() => {
            _debounceState.delete(debounceKey);
            _processHPChange(actor, newHP, type, wasZeroHP).catch(err => {
                console.error(`Nik's DnD5e Tweaks | Failed processing HP change for Auto-Status 0 HP:`, err);
            });
        }, 250);
        _debounceState.set(debounceKey, { timer, wasZeroHP });
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
    if (!actor || !actor.statuses) return;
    if (actor.isToken) {
        if (!actor.token) return;
        const scene = actor.token.parent ?? canvas?.scene;
        if (!scene || !scene.tokens.has(actor.token.id)) return;
    } else {
        if (!game.actors.has(actor.id)) return;
    }

    // Skip actors with no max HP (vehicles, objects, etc.) to avoid
    // false triggers — they are always at "0 HP" if max is 0.
    if ((actor.system?.attributes?.hp?.max ?? 0) <= 0) return;

    // Use live HP if available
    const liveHP = actor.system?.attributes?.hp?.value ?? newHP;

    if (liveHP <= 0) {
        // ── Status overlay ──
        const failedDeathSaves = (actor.system?.attributes?.death?.failure ?? 0) >= 3;
        const statusKey = type === "player"
            ? "autoStatusZeroHP_playerStatus"
            : "autoStatusZeroHP_npcStatus";
        let statusId = game.settings.get(MODULE_ID, statusKey);
        // If 3 death saves have failed, escalate to "dead" unless statuses are disabled ("none")
        if (failedDeathSaves && statusId !== "none") {
            statusId = "dead";
        }
        await _applyZeroHPStatus(actor, statusId);

        // ── Combat action ──
        const combatKey = type === "player"
            ? "autoStatusZeroHP_playerCombat"
            : "autoStatusZeroHP_npcCombat";
        const combatAction = game.settings.get(MODULE_ID, combatKey);
        await _handleCombatActionZeroHP(actor, combatAction);
    } else {
        // HP is above 0 — remove any zero-HP statuses and un-defeat,
        // but ONLY if the token was at 0 HP before this HP restoration.
        if (wasZeroHP) {
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
    _patchUpdateDowned();
    Hooks.on("preUpdateActor", _onPreUpdateActor);
    Hooks.on("updateActor", _onUpdateActor);
}

