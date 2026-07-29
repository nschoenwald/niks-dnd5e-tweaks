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
 * Configuration of class features that auto-end when the actor receives breaking conditions.
 */
const CLASS_FEATURES = [
    {
        id: "rage",
        identifier: "rage",
        nameFallback: (name) => ["rage", "raging"].includes(name.toLowerCase()),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndRage.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        },
        shouldEnd: (actor) => {
            const barbarianLevel = _getBarbarianLevel(actor);
            if (barbarianLevel >= 15) {
                // Persistent Rage (Level 15+): Rage ends early ONLY on Unconscious (or Dead) condition
                return actor.statuses.has("unconscious") || actor.statuses.has("dead");
            }
            return _hasIncapacitatingStatus(actor);
        }
    },
    {
        id: "wrath-of-the-sea",
        identifier: "wrath-of-the-sea",
        featureName: "Wrath of the Sea",
        nameFallback: (name) => name.toLowerCase().includes("wrath of the sea"),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndClassFeature.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                feature: `<strong>Wrath of the Sea</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        },
        shouldEnd: (actor) => _hasIncapacitatingStatus(actor)
    },
    {
        id: "starry-form",
        identifier: "starry-form",
        featureName: "Starry Form",
        nameFallback: (name) => name.toLowerCase().startsWith("starry form"),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndClassFeature.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                feature: `<strong>Starry Form</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        },
        shouldEnd: (actor) => _hasIncapacitatingStatus(actor)
    }
];

/**
 * Per-actor debounce timers to prevent duplicate processing when multiple
 * status conditions are applied simultaneously.
 * @type {Map<string, number>}
 */
const _debounceTimers = new Map();

/**
 * Auto-End Class Features
 * Automatically ends class feature active effects (Barbarian Rage, Sea Druid Wrath of the Sea,
 * Star Druid Starry Form) from a token when it receives conditions that end the feature.
 */
export function initAutoEndClassFeatures() {
    Hooks.on("createActiveEffect", _onCreateActiveEffect);
    Hooks.on("updateActiveEffect", _onUpdateActiveEffect);
    debug("Auto-End Class Features | Initialized");
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
        console.error(`Nik's DnD5e Tweaks | Error in _onCreateActiveEffect for Auto-End Class Features:`, err);
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
        console.error(`Nik's DnD5e Tweaks | Error in _onUpdateActiveEffect for Auto-End Class Features:`, err);
    }
}

/**
 * Shared processing for active effect hooks.
 * Defers check by 250ms to ensure actor statuses are fully updated,
 * and debounces per-actor.
 * @param {ActiveEffect} effect
 * @param {string} userId
 */
function _processEffect(effect, userId) {
    if (game.user.id !== userId) return;

    const featureEnabled = game.settings.get(MODULE_ID, "enableAutoEndRage");
    if (!featureEnabled) return;

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    const effectName = effect.name;

    const existingTimer = _debounceTimers.get(actor.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        _debounceTimers.delete(actor.id);
        _checkAndEndClassFeatures(actor, effectName).catch(err => {
            console.error(`Nik's DnD5e Tweaks | Failed processing class feature check:`, err);
        });
    }, 250);
    _debounceTimers.set(actor.id, timer);
}

/**
 * Helper to check if an actor has any concentration-breaking / incapacitating status condition.
 * @param {Actor} actor
 * @returns {boolean}
 */
function _hasIncapacitatingStatus(actor) {
    for (const status of BREAK_CONCENTRATION_STATUSES) {
        if (actor.statuses.has(status)) return true;
    }
    return false;
}

/**
 * Helper to get the Barbarian class level of an actor.
 * @param {Actor} actor
 * @returns {number}
 */
function _getBarbarianLevel(actor) {
    if (!actor) return 0;
    const cls = actor.classes?.barbarian
        ?? actor.itemTypes?.class?.find(c => c.identifier === "barbarian" || c.name?.toLowerCase() === "barbarian");
    return cls?.system?.levels ?? 0;
}

/**
 * Check whether the actor has conditions that break configured class features,
 * and if so, end all active matching feature effects.
 * @param {Actor} actor
 * @param {string} effectName       The name of the condition effect that triggered the check
 */
async function _checkAndEndClassFeatures(actor, effectName) {
    for (const feature of CLASS_FEATURES) {
        if (!feature.shouldEnd(actor)) continue;

        const matchingEffects = _findFeatureEffects(actor, feature);
        if (!matchingEffects.length) continue;

        debug(`Auto-End Class Features | ${actor.name} gained a status that ends ${feature.id}. Ending ${matchingEffects.length} effect(s).`);

        const effectIdsToDelete = matchingEffects.map(e => e.id);
        try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", effectIdsToDelete);
        } catch (e) {
            console.error(`Nik's DnD5e Tweaks | Failed to end ${feature.id} for ${actor.name}:`, e);
            continue;
        }

        const chatContent = feature.chatMessage(actor.name, effectName);
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p>${chatContent}</p>`
        });
    }
}

/**
 * Find all active effects on an actor matching a specific class feature.
 *
 * Detection uses two strategies (in order):
 * 1. Trace the effect's origin UUID to its source item/activity and check for
 *    `system.identifier === feature.identifier` or `activity.identifier === feature.identifier`.
 * 2. Fall back to feature.nameFallback(effect.name).
 *
 * @param {Actor} actor
 * @param {object} feature
 * @returns {ActiveEffect[]}
 */
function _findFeatureEffects(actor, feature) {
    const matchingEffects = [];
    for (const effect of actor.effects) {
        if (effect.disabled) continue;

        // Strategy 1: identifier-based (most reliable)
        if (effect.origin) {
            try {
                const origin = fromUuidSync(effect.origin);
                if (origin) {
                    const item = origin instanceof Item ? origin : origin.parent instanceof Item ? origin.parent : null;
                    const activityIdentifier = !(origin instanceof Item) ? origin.identifier : null;
                    if (item?.system?.identifier === feature.identifier || activityIdentifier === feature.identifier) {
                        matchingEffects.push(effect);
                        continue;
                    }
                }
            } catch {
                // Origin couldn't be resolved — fall through to name check
            }
        }

        // Strategy 2: name-based fallback
        if (feature.nameFallback(effect.name)) {
            matchingEffects.push(effect);
        }
    }
    return matchingEffects;
}
