/**
 * Feature: Auto-End Concentration
 * Description: Automatically removes all concentration effects from an actor when they gain an incapacitating condition, respecting Boon of the Iron Mind exemptions.
 *
 * @introduced v14.11.0
 * @updated v14.67.1 (Debounce keyed by actor UUID so unlinked tokens of the same actor are each handled)
 * @updated v14.67.2 (Chat message names the condition that broke concentration, not the last effect added)
 */
import { getSetting, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { hasBoonOfTheIronMind } from "./auto-roll-concentration.js";

const BREAK_CONCENTRATION_STATUSES = new Set([
    "incapacitated",
    "unconscious",
    "dead",
    "paralyzed",
    "petrified",
    "stunned"
]);

/**
 * Statuses that break concentration for characters with the Boon of the Iron Mind feat
 * (Unshakable Focus: concentration is only lost if petrified, unconscious, or dead).
 */
const BOON_OF_THE_IRON_MIND_BREAK_STATUSES = new Set([
    "unconscious",
    "dead",
    "petrified"
]);

/**
 * Breaking statuses from most to least significant. Used to name the reason in the chat message
 * when several arrive together (e.g. Unconscious + Prone from Auto-Status at 0 HP, or Paralyzed
 * with its Incapacitated rider).
 */
const BREAKING_STATUS_PRIORITY = ["dead", "unconscious", "petrified", "paralyzed", "stunned", "incapacitated"];

/**
 * Name the condition that ends a feature, for chat messages.
 * Picks the most significant status from `statuses` that the actor has, and returns the name of
 * the active effect carrying it (falling back to the status's configured name).
 * @param {Actor} actor
 * @param {Set<string>} statuses    The statuses that end the feature.
 * @param {string} [fallback]       Used when none of the statuses is found.
 * @returns {string}
 */
export function getBreakingConditionName(actor, statuses, fallback = "") {
    const ordered = [...BREAKING_STATUS_PRIORITY.filter(s => statuses.has(s)), ...[...statuses].filter(s => !BREAKING_STATUS_PRIORITY.includes(s))];
    for (const status of ordered) {
        if (!actor.statuses?.has(status)) continue;
        const effect = (actor.appliedEffects ?? []).find(e => e.statuses?.has(status));
        if (effect?.name) return effect.name;
        const config = CONFIG.statusEffects?.[status];
        if (config?.name) return game.i18n.localize(config.name);
    }
    return fallback;
}

/**
 * Per-actor debounce timers to prevent duplicate processing when multiple
 * concentration-breaking statuses are applied simultaneously.
 * @type {Map<string, number>}
 */
const _debounceTimers = new Map();

/**
 * Auto-End Concentration
 * Automatically ends all concentration effects from a token when it receives
 * conditions that break concentration.
 *
 * Uses the official `actor.concentration.effects` API and canonical
 * `actor.endConcentration()` method to identify and end active concentration effects.
 *
 * In DnD5e 6.0+, the system natively calls `actor.promptConcentrationEnd()` when
 * a condition that implies `incapacitated` (or `dead`) is applied to a concentrating
 * actor. This creates a manual "End Concentration" button in chat. When our auto-end
 * feature is enabled, we suppress this system prompt to avoid a redundant message
 * appearing alongside our own automatic handling.
 *
 * NOTE: This feature interacts with Auto-Status at 0 HP — when that
 * feature applies "unconscious" or "dead" at 0 HP (after its own 250ms
 * delay), the resulting createActiveEffect hook will trigger this feature.
 * The timing works because the hooks fire sequentially after the status
 * is actually created.
 */
export function initAutoEndConcentration() {
    Hooks.on("createActiveEffect", _onCreateActiveEffect);
    Hooks.on("updateActiveEffect", _onUpdateActiveEffect);
    _patchPromptConcentrationEnd();
    debug("Auto-End Concentration | Initialized");
}

/**
 * Wraps `Actor.prototype.promptConcentrationEnd` to suppress the system's
 * native "End Concentration" prompt chat message when our auto-end feature
 * is enabled. Without this, both systems fire simultaneously: the system
 * creates a manual button prompt (which does nothing after we've already
 * auto-ended concentration) and our module creates its own notification.
 */
function _patchPromptConcentrationEnd() {
    patchMethod("CONFIG.Actor.documentClass.prototype.promptConcentrationEnd", async function patchedPromptConcentrationEnd(wrapped, ...args) {
        const enabled = getSetting("enableAutoEndConcentration");
        if (enabled) {
            debug("Auto-End Concentration | Suppressed system promptConcentrationEnd (auto-end is active)");
            return null;
        }
        return wrapped(...args);
    }, "MIXED");
}

/**
 * Handler for newly created active effects.
 * @param {ActiveEffect} effect
 * @param {object} options
 * @param {string} userId
 */
function _onCreateActiveEffect(effect, options, userId) {
    try {
        if (effect.disabled) return;
        _processEffect(effect, userId);
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onCreateActiveEffect for Auto-End Concentration:`, err);
    }
}

/**
 * Handler for updated active effects.
 * Only processes when an effect is being enabled (disabled → active).
 * @param {ActiveEffect} effect
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
function _onUpdateActiveEffect(effect, changes, options, userId) {
    try {
        if (changes.disabled === false) {
            _processEffect(effect, userId);
        }
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onUpdateActiveEffect for Auto-End Concentration:`, err);
    }
}

/**
 * Shared processing for active effect hooks.
 * Defers the check by 250ms to ensure actor statuses are fully updated,
 * and debounces per-actor to avoid duplicate processing when multiple
 * statuses arrive simultaneously.
 * @param {ActiveEffect} effect
 * @param {string} userId
 */
function _processEffect(effect, userId) {
    if (game.user.id !== userId) return;

    const concEnabled = getSetting("enableAutoEndConcentration");
    if (!concEnabled) return;

    debug(`Auto-End Concentration | Effect changed: ${effect.name}`);

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    const effectName = effect.name;

    // Keyed by UUID: unlinked tokens of the same actor share `actor.id`.
    const key = actor.uuid;
    const existingTimer = _debounceTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        _debounceTimers.delete(key);
        _checkAndEndConcentration(actor, effectName).catch(err => {
            console.error(`Nik's DnD5e Tweaks | Failed processing concentration check:`, err);
        });
    }, 250);
    _debounceTimers.set(key, timer);
}

/**
 * Check whether the actor has any concentration-breaking status and, if so,
 * end all active concentration effects.
 * @param {Actor} actor
 * @param {string} effectName       The name of the last effect that triggered the check (fallback for the message)
 */
async function _checkAndEndConcentration(actor, effectName) {
    const isIronMind = hasBoonOfTheIronMind(actor);
    const breakingStatuses = isIronMind ? BOON_OF_THE_IRON_MIND_BREAK_STATUSES : BREAK_CONCENTRATION_STATUSES;

    let breaksConcentration = false;
    for (const status of breakingStatuses) {
        if (actor.statuses.has(status)) {
            breaksConcentration = true;
            break;
        }
    }

    debug(`Auto-End Concentration | Breaks Concentration: ${breaksConcentration} | Actor Statuses: ${Array.from(actor.statuses).join(", ")}${isIronMind ? " (Boon of the Iron Mind)" : ""}`);

    if (!breaksConcentration) return;

    const concEffects = Array.from(actor.concentration?.effects ?? []);
    debug(`Auto-End Concentration | Concentration Effects: ${concEffects.length}`);
    if (!concEffects.length) return;

    const effectIdsToDelete = concEffects.map(e => e.id);
    debug(`Auto-End Concentration | ${actor.name} gained a status that breaks concentration. Ending ${effectIdsToDelete.length} effect(s).`);

    try {
        if (typeof actor.endConcentration === "function") {
            await actor.endConcentration();
        } else {
            await actor.deleteEmbeddedDocuments("ActiveEffect", effectIdsToDelete);
        }
    } catch (e) {
        console.error(`Nik's DnD5e Tweaks | Failed to end concentration for ${actor.name}:`, e);
        return;
    }

    // The debounce keeps only the last effect's name (e.g. Prone, added after Unconscious), so name
    // the condition that actually breaks concentration instead.
    const reason = getBreakingConditionName(actor, breakingStatuses, effectName);
    const safeName = foundry.utils.escapeHTML?.(actor.name) ?? actor.name;
    const safeEffect = foundry.utils.escapeHTML?.(reason) ?? reason;

    ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("ND5T.AutoEndConcentration.ChatMessage", { name: `<strong>${safeName}</strong>`, effect: `<strong>${safeEffect}</strong>` })}</p>`
    });
}
