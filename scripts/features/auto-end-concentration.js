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
 * Auto-End Concentration & Rage
 * Automatically ends all concentration effects (and optionally rage effects)
 * from a token when it receives conditions that break concentration.
 *
 * Uses the official `actor.concentration.effects` API (dnd5e 5.2+) to
 * identify active concentration effects and deletes them directly.
 *
 * Rage effects are identified by tracing the effect's origin back to the
 * source item and checking for `system.identifier === "rage"`.
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
    // Only react when an effect is being enabled
    if (changes.disabled === false) {
        _processEffect(effect, userId);
    }
}

/**
 * Shared processing for both create and update hooks.
 * Defers the actual check by 250ms to ensure actor statuses are fully
 * updated, and debounces per-actor to avoid duplicate processing when
 * multiple statuses arrive simultaneously.
 * @param {ActiveEffect} effect
 * @param {string} userId
 */
function _processEffect(effect, userId) {
    if (game.user.id !== userId) return;

    const concEnabled = game.settings.get(MODULE_ID, "enableAutoEndConcentration");
    const rageEnabled = game.settings.get(MODULE_ID, "enableAutoEndRage");
    if (!concEnabled && !rageEnabled) return;

    debug(`Auto-End Concentration | Effect changed: ${effect.name}`);

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    // Capture the effect name now, before the deferred check
    const effectName = effect.name;

    // Debounce per actor — cancel any pending check for this actor
    const existingTimer = _debounceTimers.get(actor.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        _debounceTimers.delete(actor.id);
        _checkAndEndEffects(actor, effectName, concEnabled, rageEnabled);
    }, 250);
    _debounceTimers.set(actor.id, timer);
}

/**
 * Check whether the actor has any concentration-breaking status and, if so,
 * end all active concentration and/or rage effects.
 * @param {Actor} actor
 * @param {string} effectName       The name of the effect that triggered the check
 * @param {boolean} concEnabled     Whether auto-end concentration is enabled
 * @param {boolean} rageEnabled     Whether auto-end rage is enabled
 */
async function _checkAndEndEffects(actor, effectName, concEnabled, rageEnabled) {
    let breaksConcentration = false;
    for (const status of BREAK_CONCENTRATION_STATUSES) {
        if (actor.statuses.has(status)) {
            breaksConcentration = true;
            break;
        }
    }

    debug(`Auto-End Concentration | Breaks Concentration: ${breaksConcentration} | Actor Statuses: ${Array.from(actor.statuses).join(", ")}`);

    if (!breaksConcentration) return;

    // Collect all effect IDs to delete in a single batch
    const effectIdsToDelete = new Set();
    const endedTypes = [];

    // ── Concentration ──
    if (concEnabled) {
        const concEffects = Array.from(actor.concentration.effects);
        debug(`Auto-End Concentration | Concentration Effects: ${concEffects.length}`);
        if (concEffects.length) {
            for (const e of concEffects) effectIdsToDelete.add(e.id);
            endedTypes.push("concentration");
        }
    }

    // ── Rage ──
    if (rageEnabled) {
        const rageEffects = _findRageEffects(actor);
        debug(`Auto-End Concentration | Rage Effects: ${rageEffects.length}`);
        if (rageEffects.length) {
            for (const e of rageEffects) effectIdsToDelete.add(e.id);
            endedTypes.push("rage");
        }
    }

    if (!effectIdsToDelete.size) return;

    debug(`Auto-End Concentration | ${actor.name} gained a status that breaks ${endedTypes.join(" and ")}. Ending ${effectIdsToDelete.size} effect(s).`);

    try {
        await actor.deleteEmbeddedDocuments("ActiveEffect", Array.from(effectIdsToDelete));
    } catch (e) {
        console.error(`Nik's DnD5e Tweaks | Failed to end effects for ${actor.name}:`, e);
        return;
    }

    // Post one chat message per ended type
    const safeName = foundry.utils.escapeHTML?.(actor.name) ?? actor.name;
    const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;

    if (endedTypes.includes("concentration")) {
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${game.i18n.format("ND5T.AutoEndConcentration.ChatMessage", { name: `<strong>${safeName}</strong>`, effect: `<strong>${safeEffect}</strong>` })}</p>`
        });
    }

    if (endedTypes.includes("rage")) {
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${game.i18n.format("ND5T.AutoEndRage.ChatMessage", { name: `<strong>${safeName}</strong>`, effect: `<strong>${safeEffect}</strong>` })}</p>`
        });
    }
}

/**
 * Names that identify a rage effect when matched case-insensitively.
 * Used as a fallback when the origin item cannot be resolved or lacks
 * the `system.identifier` field (e.g. homebrew rage items).
 * @type {Set<string>}
 */
const RAGE_EFFECT_NAMES = new Set(["rage", "raging"]);

/**
 * Find all active rage effects on an actor.
 *
 * Detection uses two strategies (in order):
 * 1. Trace the effect's origin UUID to its source item and check for
 *    `system.identifier === "rage"`.  The origin can point to either an
 *    Item or an Activity (a sub-entity of an Item):
 *      - Actor.{id}.Item.{id}
 *      - Actor.{id}.Item.{id}.Activity.{id}
 * 2. Fall back to a case-insensitive name match against "Rage" / "Raging"
 *    for effects whose origin cannot be resolved or whose source item
 *    lacks the identifier field.
 *
 * @param {Actor} actor
 * @returns {ActiveEffect[]}
 */
function _findRageEffects(actor) {
    const rageEffects = [];
    for (const effect of actor.effects) {
        if (effect.disabled) continue;

        // Strategy 1: identifier-based (most reliable)
        if (effect.origin) {
            try {
                const origin = fromUuidSync(effect.origin);
                if (origin) {
                    const item = origin instanceof Item ? origin : origin.parent instanceof Item ? origin.parent : null;
                    if (item?.system?.identifier === "rage") {
                        rageEffects.push(effect);
                        continue;
                    }
                }
            } catch {
                // Origin couldn't be resolved — fall through to name check
            }
        }

        // Strategy 2: name-based fallback (covers homebrew / missing origin)
        if (RAGE_EFFECT_NAMES.has(effect.name.toLowerCase())) {
            rageEffects.push(effect);
        }
    }
    return rageEffects;
}

