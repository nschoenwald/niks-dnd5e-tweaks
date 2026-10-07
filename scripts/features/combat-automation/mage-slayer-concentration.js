/**
 * Feature: Mage Slayer: Concentration Disadvantage
 * Description: Imposes Disadvantage on concentration saving throws when the damage was dealt by an attacker possessing the Mage Slayer feat.
 *
 * @introduced v14.12.1
 */
import { MODULE_ID, debug } from "../../main.js";

/**
 * Mage Slayer — Concentration Breaker
 *
 * Implements the 2024 PHB Mage Slayer feat's "Concentration Breaker" benefit:
 *   "When you damage a creature that is concentrating, it has Disadvantage
 *    on the saving throw it makes to maintain Concentration."
 *
 * Implementation uses three hooks:
 *
 *  1. dnd5e.preApplyDamage / dnd5e.applyDamage — fires when damage is applied
 *     while options.originatingMessage or workflow is available. If the attacker
 *     holds the Mage Slayer feat, the defending actor's UUID (and ID for linked actors)
 *     is recorded in a pending Map and synced across clients via socket.
 *
 *  2. dnd5e.preRollConcentration — fires inside D20Roll.buildConfigure()
 *     before the concentration save is built (whether auto-rolled, rolled via dialog,
 *     or triggered from a concentration prompt card in chat). If the defending actor
 *     has a pending Mage Slayer entry, disadvantage is injected into the roll config.
 *     The system's own advantage/disadvantage resolver then handles the War Caster case:
 *       advantage + disadvantage → NORMAL (2024 rules).
 *
 *  3. dnd5e.rollConcentration — fires after the concentration saving throw has been
 *     evaluated and created, cleanly clearing the pending disadvantage entry.
 */

/**
 * Map of actor UUIDs/IDs that should roll their next concentration save with
 * disadvantage due to a Mage Slayer attacker.
 *
 * Key:   defender actor UUID or ID (string)
 * Value: timestamp (ms) when the entry was recorded
 *
 * @type {Map<string, number>}
 */
const _pendingMageSlayerDisadvantage = new Map();

/**
 * Maximum age (ms) of a pending Mage Slayer entry (5 minutes).
 * Ensures that if a concentration save is rolled via a chat prompt card or after discussion
 * in a roll configuration dialog, the disadvantage is still properly applied.
 */
const MAGE_SLAYER_TTL_MS = 300000;

// ── Attacker & Mage Slayer detection ──────────────────────────────────

/**
 * Determine whether an actor has the Mage Slayer feat.
 * Matches:
 *   - actor flag dnd5e.mageSlayer === true or niks-dnd5e-tweaks.mageSlayer === true
 *   - item.identifier or item.system.identifier starting with "mage-slayer"
 *   - item.name containing "mage slayer" or "magietöter" (case-insensitive, e.g. "Mage Slayer (2024)")
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function _hasMageSlayer(actor) {
    if (!actor) return false;

    // Check actor flags
    if (actor.getFlag?.("dnd5e", "mageSlayer") || actor.getFlag?.(MODULE_ID, "mageSlayer")) return true;

    if (!actor.items) return false;

    for (const item of actor.items) {
        const identifier = item.identifier ?? item.system?.identifier ?? "";
        if (identifier === "mage-slayer" || identifier.startsWith("mage-slayer")) return true;

        const name = (item.name ?? "").toLowerCase();
        if (name.includes("mage slayer") || name.includes("magietöter")) return true;
    }

    return false;
}

/**
 * Resolve the attacking actor from damage application options.
 * Handles:
 *   - options.originatingMessage (ChatMessage instance, UUID string, or ID)
 *   - options.origin (ChatMessage instance, Item/Activity/Actor document, or document UUID string)
 *   - options.message (ChatMessage instance)
 *   - options.workflow / options.item / options.midi / options.attacker (Midi-QOL & system workflows)
 *
 * @param {object} options
 * @returns {Actor|null}
 */
function _getAttackerActor(options) {
    if (!options) return null;

    // 1. Resolve ChatMessage or Document from options.originatingMessage, options.origin, or options.message
    let chatMessage = options.originatingMessage ?? options.message;
    if (!chatMessage && options.origin) {
        if (typeof options.origin === "string") {
            try {
                const doc = fromUuidSync(options.origin);
                if (doc instanceof Actor) return doc;
                if (doc?.actor) return doc.actor;
            } catch (e) {
                // Not a valid UUID
            }
        } else if (options.origin instanceof ChatMessage) {
            chatMessage = options.origin;
        } else if (options.origin instanceof Actor) {
            return options.origin;
        } else if (options.origin?.actor) {
            return options.origin.actor;
        }
    }

    if (chatMessage) {
        if (typeof chatMessage === "string") {
            chatMessage = game.messages?.get(chatMessage)
                ?? (chatMessage.includes(".") ? fromUuidSync(chatMessage) : null);
        }

        if (chatMessage) {
            const origMsg = typeof chatMessage.getOriginatingMessage === "function"
                ? chatMessage.getOriginatingMessage()
                : chatMessage;

            const origItemActor = origMsg.getAssociatedItem?.()?.actor ?? origMsg.item?.actor;
            if (origItemActor) return origItemActor;

            const origActivityActor = origMsg.getAssociatedActivity?.()?.actor ?? origMsg.activity?.actor;
            if (origActivityActor) return origActivityActor;

            const origActor = origMsg.getAssociatedActor?.();
            if (origActor) return origActor;

            const chatItemActor = chatMessage.getAssociatedItem?.()?.actor ?? chatMessage.item?.actor;
            if (chatItemActor) return chatItemActor;

            const chatActivityActor = chatMessage.getAssociatedActivity?.()?.actor ?? chatMessage.activity?.actor;
            if (chatActivityActor) return chatActivityActor;

            const chatActor = chatMessage.getAssociatedActor?.();
            if (chatActor) return chatActor;

            if (origMsg.speaker) {
                const speakerActor = ChatMessage.implementation?.getSpeakerActor?.(origMsg.speaker)
                    ?? ChatMessage.getSpeakerActor?.(origMsg.speaker);
                if (speakerActor) return speakerActor;
            }
            if (chatMessage.speaker) {
                const speakerActor = ChatMessage.implementation?.getSpeakerActor?.(chatMessage.speaker)
                    ?? ChatMessage.getSpeakerActor?.(chatMessage.speaker);
                if (speakerActor) return speakerActor;
            }
        }
    }

    // 2. Direct workflow / item / attacker references
    const wfActor = options?.workflow?.actor
        ?? options?.item?.actor
        ?? options?.midi?.workflow?.actor
        ?? options?.attacker?.actor
        ?? (options?.attacker instanceof Actor ? options.attacker : null);
    if (wfActor) return wfActor;

    return null;
}

// ── Damage processing ──────────────────────────────────────────────────

/**
 * Process a damage event on a defender actor to check if the attacker has Mage Slayer.
 *
 * @param {Actor} defenderActor
 * @param {number} amount
 * @param {object} options
 */
function _processDamageForMageSlayer(defenderActor, amount, options) {
    try {
        if (!game.settings.get(MODULE_ID, "enableMageSlayerConcentration")) return;

        // Skip if this damage event was already processed (e.g. by preApplyDamage)
        if (options?._nd5tMageSlayerProcessed) return;

        // Only care about actual damage
        if (amount <= 0) return;

        // Defender must be concentrating (canonical dnd5e 5.2+ effects set or concentrating status condition)
        const isConcentrating = (defenderActor?.concentration?.effects?.size > 0)
            || defenderActor?.statuses?.has("concentrating")
            || defenderActor?.statuses?.has(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating");
        if (!isConcentrating) return;

        const attackerActor = _getAttackerActor(options);
        if (!attackerActor) return;

        if (!_hasMageSlayer(attackerActor)) return;

        // Prevent redundant re-processing in applyDamage if preApplyDamage handled it
        if (options) options._nd5tMageSlayerProcessed = true;

        debug(`Mage Slayer | ${attackerActor.name} has Mage Slayer — flagging ${defenderActor.name} for concentration disadvantage`);
        const now = Date.now();

        // Always key by UUID (unique across unlinked and linked actors alike)
        if (defenderActor.uuid) _pendingMageSlayerDisadvantage.set(defenderActor.uuid, now);

        // For linked/world actors, also key by ID as a fallback (avoid for unlinked tokens to prevent cross-contamination)
        if (defenderActor.id && !defenderActor.isToken) {
            _pendingMageSlayerDisadvantage.set(defenderActor.id, now);
        }

        // Sync flag to other clients so the player client has it when rolling
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "mageSlayerConcentrationDisadvantage",
            actorId: defenderActor.id,
            actorUuid: defenderActor.uuid,
            isToken: defenderActor.isToken ?? false,
            timestamp: now
        });
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error processing Mage Slayer damage:`, err);
    }
}

/** Hook handler for dnd5e.preApplyDamage */
function _onPreApplyDamage(defenderActor, amount, _updates, options) {
    _processDamageForMageSlayer(defenderActor, amount, options);
}

/** Hook handler for dnd5e.applyDamage */
function _onApplyDamage(defenderActor, amount, options) {
    _processDamageForMageSlayer(defenderActor, amount, options);
}

// ── Concentration Roll hooks ──────────────────────────────────────────

/**
 * dnd5e.preRollConcentration — fires inside D20Roll.buildConfigure()
 * before any concentration save is built (auto-rolled or manual prompt click).
 *
 * @param {AbilityRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration}   _dialog
 * @param {BasicRollMessageConfiguration}  _message
 */
function _onPreRollConcentration(config, _dialog, _message) {
    try {
        if (!game.settings.get(MODULE_ID, "enableMageSlayerConcentration")) return;

        const actor = config.subject ?? config.actor;
        if (!actor) return;

        // Prefer exact actor UUID, fallback to ID for linked actors
        const timestamp = _pendingMageSlayerDisadvantage.get(actor.uuid)
            ?? _pendingMageSlayerDisadvantage.get(actor.id);
        if (timestamp === undefined) return;

        // Ignore stale entries older than TTL (5 minutes)
        if (Date.now() - timestamp > MAGE_SLAYER_TTL_MS) {
            debug(`Mage Slayer | Pending disadvantage entry for ${actor.name} expired — skipping`);
            if (actor.uuid) _pendingMageSlayerDisadvantage.delete(actor.uuid);
            if (actor.id && !actor.isToken) _pendingMageSlayerDisadvantage.delete(actor.id);
            return;
        }

        debug(`Mage Slayer | Injecting disadvantage into concentration save for ${actor.name}`);
        config.disadvantage = true;
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            roll.options.disadvantage = true;
        }
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onPreRollConcentration for Mage Slayer:`, err);
    }
}

/**
 * dnd5e.rollConcentration — fires after a concentration save is rolled and evaluated.
 * Cleanly consumes the pending Mage Slayer disadvantage entry.
 *
 * @param {D20Roll[]} rolls
 * @param {object}    data
 * @param {Actor5e}   data.subject
 */
function _onRollConcentration(rolls, { subject } = {}) {
    try {
        const actor = subject ?? rolls?.[0]?.options?.actor;
        if (!actor) return;

        if (actor.uuid) _pendingMageSlayerDisadvantage.delete(actor.uuid);
        if (actor.id && !actor.isToken) _pendingMageSlayerDisadvantage.delete(actor.id);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onRollConcentration for Mage Slayer:", err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Mage Slayer concentration feature.
 * Called once during the "setup" phase from main.js.
 */
export function initMageSlayerConcentration() {
    Hooks.on("dnd5e.preApplyDamage", _onPreApplyDamage);
    Hooks.on("dnd5e.applyDamage", _onApplyDamage);
    Hooks.on("dnd5e.preRollConcentration", _onPreRollConcentration);
    Hooks.on("dnd5e.rollConcentration", _onRollConcentration);
    debug("Mage Slayer Concentration | Initialized");
}

/**
 * Handle incoming socket messages for Mage Slayer concentration disadvantage.
 * @param {object} data
 */
export function onSocketMessage(data) {
    if (data?.type !== "mageSlayerConcentrationDisadvantage") return;
    const now = data.timestamp || Date.now();
    if (data.actorUuid) _pendingMageSlayerDisadvantage.set(data.actorUuid, now);
    if (data.actorId && !data.isToken) _pendingMageSlayerDisadvantage.set(data.actorId, now);
    debug(`Mage Slayer | Received socket disadvantage flag for actor ${data.actorUuid || data.actorId}`);
}
