/**
 * Feature: Auto-End Class Features
 * Description: Automatically terminates active feature effects (such as Barbarian Rage, Bladesong, Starry Form, and Cloak of Shadows) when an actor gains an incapacitating condition.
 *
 * @introduced v14.13.3
 * @updated v14.67.2 (Chat message names the condition that ended the feature, not the last effect added)
 * @updated v14.67.3 (Debounce keyed by actor UUID so unlinked tokens of the same actor are each handled)
 * @updated v14.81.1 (Starry Form from PHB content 3.0: ends the form by deleting its self-enchantment)
 * @updated v14.111.1 (Bladesong and 12 more self-buffs from the official books; the 2014 Rage only ends on Unconscious)
 */
import { getSetting, debug } from "../../context.js";
import { getBreakingConditionName } from "./auto-end-concentration.js";
import { isModernRules } from "./conditional-damage.js";

const BREAK_CONCENTRATION_STATUSES = new Set([
    "incapacitated",
    "unconscious",
    "dead",
    "paralyzed",
    "petrified",
    "stunned"
]);

const UNCONSCIOUS_STATUSES = new Set(["unconscious", "dead"]);

/** Same effect name pattern the Bladework feature treats as an active Bladesong. */
const BLADESONG_PATTERN = /^bladesong\b/i;

/**
 * Configuration of class features that auto-end when the actor receives breaking conditions.
 * `itemEffect` marks the feature's own effect among the transfer effects on its item. It is opt-in because a
 * feature's other transfer effects can be permanent passives that must stay on.
 */
const CLASS_FEATURES = [
    {
        id: "rage",
        identifier: "rage",
        nameFallback: (name) => ["rage", "raging"].includes(name.toLowerCase()),
        // The system's 2024 and 2014 Rage: a transfer effect on the feature, which auto-apply enables there
        itemEffect: (effect) => ["G5XZTi4zYTFiHVll", "eWhL8hUr0c2ujDUm"].includes(effect.id)
            || ["rage", "raging"].includes(effect.name?.trim().toLowerCase()),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndRage.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        },
        // Persistent Rage (level 15+) and the 2014 Rage only end on Unconscious (or Dead)
        endingStatuses: (actor) => ((_getBarbarianLevel(actor) >= 15) || _isLegacyRage(actor))
            ? UNCONSCIOUS_STATUSES
            : BREAK_CONCENTRATION_STATUSES
    },
    {
        id: "wrath-of-the-sea",
        identifier: "wrath-of-the-sea",
        featureName: "Wrath of the Sea",
        nameFallback: (name) => name.toLowerCase().includes("wrath of the sea"),
        itemEffect: (effect) => (effect.id === "8B01lJSp8dorvWOi") || /^stormborn$/i.test(effect.name?.trim() ?? ""),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndClassFeature.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                feature: `<strong>Wrath of the Sea</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        }
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
        }
    },
    {
        id: "bladesong",
        identifier: "bladesong",
        featureName: "Bladesong",
        nameFallback: (name) => BLADESONG_PATTERN.test(name.trim()),
        // Heroes of Faerûn ships it as a disabled transfer effect on the feature, which using it can simply enable
        itemEffect: (effect) => (effect.flags?.["dnd-heroes-faerun"]?.bladesong === true)
            || BLADESONG_PATTERN.test(effect.name?.trim() ?? ""),
        chatMessage: (actorName, effectName) => {
            const safeName = foundry.utils.escapeHTML?.(actorName) ?? actorName;
            const safeEffect = foundry.utils.escapeHTML?.(effectName) ?? effectName;
            return game.i18n.format("ND5T.AutoEndClassFeature.ChatMessage", {
                name: `<strong>${safeName}</strong>`,
                feature: `<strong>Bladesong</strong>`,
                effect: `<strong>${safeEffect}</strong>`
            });
        }
    },
    // Transfer effects switched on by the feature
    _selfBuff({ id: "cloak-of-shadows", effectIds: ["Z6rTB7dAImnDFc8n"], effectName: /^cloak of shadows$/i }),
    _selfBuff({ id: "unbreakable-majesty", effectIds: ["KN7yYmUNAlfO4onh"], effectName: /^majestic presence$/i }),
    _selfBuff({
        id: "form-of-dread",
        sourceId: "rhwUPFormofDreOJ",
        effectIds: ["4vZQGHnDrz11Fy0j", "TH1kqbmgrvkMohdQ", "1oBMDR1fQh6rCruX"],
        effectName: /^form of (?:superior )?dread\b/i
    }),
    // Effects copied onto the actor
    _selfBuff({ id: "superior-defense", effectIds: ["zAtnsWRpAcTIkjpz"], effectName: /^superior defense$/i }),
    _selfBuff({ id: "draconic-flight", effectIds: ["waI4oHqhpbKUem0M"], effectName: /^draconic flight$/i }),
    _selfBuff({ id: "animated-shield", effectIds: ["EyOtzMokDEOeHxkn"], effectName: /^animated shield$/i }),
    _selfBuff({ id: "channel-divinity-paladin", effectIds: ["hr8wnlgs3uXphCnI"], effectName: /^divine sense$/i, useEffectName: true }),
    // Self-enchantments
    _selfBuff({ id: "elemental-attunement" }),
    _selfBuff({ id: "wrath-of-the-wild", sourceId: "rhwHWWrathofth3C" }),
    _selfBuff({ id: "boon-of-the-bright-sun" }),
    _selfBuff({ id: "shadowform" }),
    // Remote Viewing makes the user Incapacitated itself, so only another source ends it. Its end destroys the
    // token (the enchantment), while an unused token survives the user being Incapacitated.
    _selfBuff({
        id: "eerie-token",
        sourceId: "rhwEerieTokenSri",
        effectIds: ["XyMn08GyGTONDU2e"],
        effectName: /^remote viewing\b/i,
        ignoreOwnStatus: true,
        enchantmentsNeedEffect: true
    })
];

/**
 * Build the entry of a feature that buffs its user until they're Incapacitated. Only the listed effects count (by id,
 * so in any language, with an English name fallback): the same items carry permanent passives and effects for other
 * creatures, such as Form of Dread's Frightened.
 *
 * @param {object} config
 * @param {string} config.id                         Item identifier.
 * @param {string} [config.sourceId]                 Compendium item id, for items without a stored identifier.
 * @param {string[]} [config.effectIds]              Ids of the feature's own effects on the compendium item.
 * @param {RegExp} [config.effectName]               Fallback name of those effects.
 * @param {boolean} [config.useEffectName]           Name the effect in chat rather than the item.
 * @param {boolean} [config.ignoreOwnStatus]         The feature's effect itself carries an ending status.
 * @param {boolean} [config.enchantmentsNeedEffect]  Only remove enchantments together with an active effect.
 * @returns {object}
 */
function _selfBuff({ id, sourceId, effectIds = [], effectName, useEffectName = false, ignoreOwnStatus = false, enchantmentsNeedEffect = false }) {
    const ids = new Set(effectIds);
    const isEffect = (effect) => {
        if (effect.type === "enchantment") return false;
        const stats = effect._stats;
        return ids.has(effect.id) || ids.has(effect.system?.origin?.profile)
            || [stats?.compendiumSource, stats?.duplicateSource].some(uuid => ids.has(uuid?.split(".").pop()))
            || Boolean(effectName?.test(effect.name?.trim() ?? ""));
    };
    return {
        id,
        identifier: id,
        nameFallback: () => false,
        matchesItem: (item) => (item.identifier === id)
            || Boolean(sourceId && item._stats?.compendiumSource?.endsWith(`.Item.${sourceId}`)),
        actorEffect: isEffect,
        itemEffect: isEffect,
        useEffectName,
        ignoreOwnStatus,
        enchantmentsNeedEffect,
        chatMessage: (actorName, effectName, featureName) => {
            const escape = (text) => foundry.utils.escapeHTML?.(text) ?? text;
            return game.i18n.format("ND5T.AutoEndClassFeature.ChatMessage", {
                name: `<strong>${escape(actorName)}</strong>`,
                feature: `<strong>${escape(featureName)}</strong>`,
                effect: `<strong>${escape(effectName)}</strong>`
            });
        }
    };
}

/**
 * Per-actor debounce timers to prevent duplicate processing when multiple
 * status conditions are applied simultaneously.
 * @type {Map<string, number>}
 */
const _debounceTimers = new Map();

/**
 * Auto-End Class Features
 * Automatically ends feature effects (see CLASS_FEATURES) from a token when it receives conditions that end the
 * feature.
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

    const featureEnabled = getSetting("enableAutoEndRage");
    if (!featureEnabled) return;

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    const effectName = effect.name;

    // Keyed by UUID: unlinked tokens of the same actor share `actor.id`.
    const key = actor.uuid;
    const existingTimer = _debounceTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
        _debounceTimers.delete(key);
        _checkAndEndClassFeatures(actor, effectName).catch(err => {
            console.error(`Nik's DnD5e Tweaks | Failed processing class feature check:`, err);
        });
    }, 250);
    _debounceTimers.set(key, timer);
}

/**
 * The name of the condition that ends a feature right now.
 * @param {Actor} actor
 * @param {object} feature
 * @param {string} fallback  Used when the condition's effect can't be named.
 * @returns {string|null}    Null when nothing ends the feature.
 */
function _getEndingReason(actor, feature, fallback) {
    const statuses = feature.endingStatuses?.(actor) ?? BREAK_CONCENTRATION_STATUSES;
    if (feature.ignoreOwnStatus) {
        const other = (actor.appliedEffects ?? []).find(e => !feature.itemEffect(e) && [...statuses].some(s => e.statuses?.has(s)));
        return other ? (other.name ?? fallback) : null;
    }
    if (![...statuses].some(s => actor.statuses.has(s))) return null;
    return getBreakingConditionName(actor, statuses, fallback);
}

/**
 * Whether the actor's Rage follows the 2014 rules: its own source rules, else the world's.
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isLegacyRage(actor) {
    const rage = actor.items?.find(i => (i.type === "feat") && (i.system?.identifier === "rage"));
    const rules = rage?.system?.source?.rules;
    if (rules === "2024") return false;
    if (rules === "2014") return true;
    return !isModernRules();
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
 * and if so, end all active matching feature effects by disabling them.
 * @param {Actor} actor
 * @param {string} effectName       The name of the condition effect that triggered the check
 */
async function _checkAndEndClassFeatures(actor, effectName) {
    for (const feature of CLASS_FEATURES) {
        const reason = _getEndingReason(actor, feature, effectName);
        if (reason === null) continue;

        const matchingEffects = _findFeatureEffects(actor, feature);
        const itemEffects = _findFeatureItemEffects(actor, feature);
        const hasEffects = (matchingEffects.length > 0) || (itemEffects.length > 0);
        const enchantments = (feature.enchantmentsNeedEffect && !hasEffects) ? [] : _findFeatureEnchantments(actor, feature);
        if (!hasEffects && !enchantments.length) continue;

        debug(`Auto-End Class Features | ${actor.name} gained a status that ends ${feature.id}. Ending ${matchingEffects.length} effect(s), ${itemEffects.length} item effect group(s) and ${enchantments.length} enchantment(s).`);

        try {
            // Disable rather than delete so the effect stays on the actor and can be re-enabled on next use
            if (matchingEffects.length) {
                await actor.updateEmbeddedDocuments("ActiveEffect", matchingEffects.map(e => ({ _id: e.id, disabled: true })));
            }
            for (const [item, effects] of itemEffects) {
                await item.updateEmbeddedDocuments("ActiveEffect", effects.map(e => ({ _id: e.id, disabled: true })));
            }
            // Self-enchantments are deleted, as using the activity again would do: dnd5e then deletes the rider
            // effects that depend on them. A disabled enchantment would only be removed (not reapplied) by the
            // next use of the activity with the same profile.
            for (const [item, effects] of enchantments) {
                await item.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
            }
        } catch (e) {
            console.error(`Nik's DnD5e Tweaks | Failed to end ${feature.id} for ${actor.name}:`, e);
            continue;
        }

        const endedEffect = matchingEffects[0] ?? itemEffects[0]?.[1][0];
        const featureName = (feature.useEffectName ? endedEffect?.name : null)
            ?? (feature.matchesItem ? actor.items.find(i => feature.matchesItem(i))?.name : null)
            ?? endedEffect?.name;
        const chatContent = feature.chatMessage(actor.name, reason, featureName);
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
    if (feature.actorEffect) return actor.effects.filter(e => !e.disabled && feature.actorEffect(e));
    const matchingEffects = [];
    for (const effect of actor.effects) {
        if (effect.disabled) continue;

        // Strategy 1: identifier-based (most reliable)
        if (effect.origin) {
            try {
                const origin = fromUuidSync(effect.origin);
                if (origin) {
                    const item = origin instanceof Item ? origin : (origin.item ?? (origin.parent instanceof Item ? origin.parent : null));
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

/**
 * Find a feature's enabled transfer effects on its own item, grouped by item. These reach the actor without being
 * in `actor.effects`, so `_findFeatureEffects` can't see them.
 *
 * @param {Actor} actor
 * @param {object} feature
 * @returns {Array<[Item, ActiveEffect[]]>}
 */
function _findFeatureItemEffects(actor, feature) {
    if (!feature.itemEffect) return [];
    const result = [];
    for (const item of actor.items) {
        const isFeatureItem = feature.matchesItem?.(item)
            ?? ((item.system?.identifier === feature.identifier) || feature.nameFallback(item.name ?? ""));
        if (!isFeatureItem) continue;
        const effects = item.effects.filter(e => e.transfer && !e.disabled && feature.itemEffect(e));
        if (effects.length) result.push([item, effects]);
    }
    return result;
}

/**
 * Find active enchantments a feature applied to its own item (an Enchant activity with "self" set), grouped by
 * item. Starry Form (PHB content 3.0) works this way: the enchantment's rider effects live on the Starry Form
 * item and reach the actor as transferred effects, so they are not in `actor.effects`.
 *
 * @param {Actor} actor
 * @param {object} feature
 * @returns {Array<[Item, ActiveEffect[]]>}
 */
function _findFeatureEnchantments(actor, feature) {
    const result = [];
    for (const item of actor.items) {
        if (!(feature.matchesItem?.(item) ?? (item.system?.identifier === feature.identifier))) continue;
        const effects = item.effects.filter(e => e.isAppliedEnchantment && !e.disabled);
        if (effects.length) result.push([item, effects]);
    }
    return result;
}
