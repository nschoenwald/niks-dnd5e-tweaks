import { MODULE_ID, debug } from "../main.js";

const BREAK_CONCENTRATION_STATUSES = new Set([
    "incapacitated",
    "unconscious",
    "dead",
    "paralyzed",
    "petrified",
    "stunned"
]);

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
 * Uses the official `actor.concentration.effects` API (dnd5e 5.2+) to
 * identify active concentration effects and deletes them directly.
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
    debug("Auto-End Concentration | Initialized");
}

/**
 * Handler for newly created active effects.
 * @param {ActiveEffect} effect
 * @param {object} options
 * @param {string} userId
 */
function _onCreateActiveEffect(effect, options, userId) {
    if (effect.disabled) return;
    _processEffect(effect, userId);
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
    if (changes.disabled === false) {
        _processEffect(effect, userId);
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

    const concEnabled = game.settings.get(MODULE_ID, "enableAutoEndConcentration");
    if (!concEnabled) return;

    debug(`Auto-End Concentration | Effect changed: ${effect.name}`);

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    const effectName = effect.name;

    const existingTimer = _debounceTimers.get(actor.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        _debounceTimers.delete(actor.id);
        _checkAndEndConcentration(actor, effectName);
    }, 250);
    _debounceTimers.set(actor.id, timer);
}

/**
 * Check whether the actor has any concentration-breaking status and, if so,
 * end all active concentration effects.
 * @param {Actor} actor
 * @param {string} effectName       The name of the effect that triggered the check
 */
async function _checkAndEndConcentration(actor, effectName) {
    let breaksConcentration = false;
    for (const status of BREAK_CONCENTRATION_STATUSES) {
        if (actor.statuses.has(status)) {
            breaksConcentration = true;
            break;
        }
    }

    debug(`Auto-End Concentration | Breaks Concentration: ${breaksConcentration} | Actor Statuses: ${Array.from(actor.statuses).join(", ")}`);

    if (!breaksConcentration) return;

    const concEffects = Array.from(actor.concentration?.effects ?? []);
    debug(`Auto-End Concentration | Concentration Effects: ${concEffects.length}`);
    if (!concEffects.length) return;

    const effectIdsToDelete = concEffects.map(e => e.id);
    debug(`Auto-End Concentration | ${actor.name} gained a status that breaks concentration. Ending ${effectIdsToDelete.length} effect(s).`);

    try {
        await actor.deleteEmbeddedDocuments("ActiveEffect", effectIdsToDelete);
    } catch (e) {
        console.error(`Nik's DnD5e Tweaks | Failed to end concentration for ${actor.name}:`, e);
        return;
    }

    const safeName = foundry.utils.escapeHTML?.(actor.name) ?? actor.name;
    const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;

    ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("ND5T.AutoEndConcentration.ChatMessage", { name: `<strong>${safeName}</strong>`, effect: `<strong>${safeEffect}</strong>` })}</p>`
    });
}
