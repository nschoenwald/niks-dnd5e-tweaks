import { MODULE_ID, debug } from "../main.js";

/**
 * Mage Slayer — Concentration Breaker
 *
 * Implements the 2024 PHB Mage Slayer feat's "Concentration Breaker" benefit:
 *   "When you damage a creature that is concentrating, it has Disadvantage
 *    on the saving throw it makes to maintain Concentration."
 *
 * Implementation uses two hooks:
 *
 *  1. dnd5e.preApplyDamage / dnd5e.applyDamage — fires when damage is applied
 *     while options.originatingMessage or workflow is available. If the attacker
 *     holds the Mage Slayer feat, the defending actor's ID/UUID is recorded in a
 *     pending Map.
 *
 *  2. dnd5e.preRollConcentration — fires inside D20Roll.buildConfigure()
 *     before the concentration save is built (whether auto-rolled, rolled via dialog,
 *     or triggered from a concentration prompt card in chat). If the defending actor
 *     has a pending Mage Slayer entry, disadvantage is injected into the roll config.
 *     The system's own advantage/disadvantage resolver then handles the War Caster case:
 *       advantage + disadvantage → NORMAL (2024 rules).
 */

/**
 * Map of actor IDs/UUIDs that should roll their next concentration save with
 * disadvantage due to a Mage Slayer attacker.
 *
 * Key:   defender actor ID or UUID (string)
 * Value: timestamp (ms) when the entry was recorded
 *
 * @type {Map<string, number>}
 */
const _pendingMageSlayerDisadvantage = new Map();

/**
 * Maximum age (ms) of a pending Mage Slayer entry (60 seconds).
 * Ensures that if a concentration save is rolled via a chat prompt card or after a delay
 * in a roll configuration dialog, the disadvantage is still properly applied.
 */
const MAGE_SLAYER_TTL_MS = 60000;

// ── Attacker & Mage Slayer detection ──────────────────────────────────

/**
 * Determine whether an actor has the Mage Slayer feat.
 * Matches:
 *   - actor flag dnd5e.mageSlayer === true
 *   - item.system.identifier starting with "mage-slayer"
 *   - item.name containing "mage slayer" (case-insensitive, e.g. "Mage Slayer (2024)")
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function _hasMageSlayer(actor) {
    if (!actor) return false;

    // Check actor flag
    if (actor.getFlag?.("dnd5e", "mageSlayer")) return true;

    if (!actor.items) return false;

    for (const item of actor.items) {
        const identifier = item.system?.identifier ?? "";
        if (identifier === "mage-slayer" || identifier.startsWith("mage-slayer")) return true;

        const name = (item.name ?? "").toLowerCase();
        if (name.includes("mage slayer")) return true;
    }

    return false;
}

/**
 * Resolve the attacking actor from damage application options.
 * Handles:
 *   - options.originatingMessage (ChatMessage instance or ID)
 *   - options.origin (ChatMessage instance, Item/Activity document, or document UUID string)
 *   - options.message (ChatMessage instance)
 *   - options.workflow / options.item / options.midi (Midi-QOL & system workflows)
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
                if (doc?.actor) return doc.actor;
                if (doc instanceof Actor) return doc;
            } catch (e) {
                // Not a valid UUID
            }
        } else if (options.origin instanceof ChatMessage) {
            chatMessage = options.origin;
        } else if (options.origin?.actor) {
            return options.origin.actor;
        }
    }

    if (chatMessage) {
        if (typeof chatMessage === "string") {
            chatMessage = game.messages?.get(chatMessage);
        }

        if (chatMessage) {
            const origMsg = typeof chatMessage.getOriginatingMessage === "function"
                ? chatMessage.getOriginatingMessage()
                : chatMessage;

            if (origMsg.item?.actor) return origMsg.item.actor;
            if (origMsg.activity?.actor) return origMsg.activity.actor;
            if (chatMessage.item?.actor) return chatMessage.item.actor;
            if (chatMessage.activity?.actor) return chatMessage.activity.actor;

            if (origMsg.speaker) {
                const speakerActor = ChatMessage.getSpeakerActor(origMsg.speaker);
                if (speakerActor) return speakerActor;
            }
            if (chatMessage.speaker) {
                const speakerActor = ChatMessage.getSpeakerActor(chatMessage.speaker);
                if (speakerActor) return speakerActor;
            }
        }
    }

    // 2. Direct workflow / item references
    const wfActor = options?.workflow?.actor
        ?? options?.item?.actor
        ?? options?.midi?.workflow?.actor;
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

        // Only care about actual damage
        if (amount <= 0) return;

        // Defender must be concentrating
        if (!defenderActor?.concentration?.effects?.size) return;

        const attackerActor = _getAttackerActor(options);
        if (!attackerActor) return;

        if (!_hasMageSlayer(attackerActor)) return;

        debug(`Mage Slayer | ${attackerActor.name} has Mage Slayer — flagging ${defenderActor.name} for concentration disadvantage`);
        const now = Date.now();
        if (defenderActor.id) _pendingMageSlayerDisadvantage.set(defenderActor.id, now);
        if (defenderActor.uuid) _pendingMageSlayerDisadvantage.set(defenderActor.uuid, now);
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

// ── Concentration Roll hook ───────────────────────────────────────────

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

        const actor = config.subject;
        if (!actor) return;

        const timestamp = _pendingMageSlayerDisadvantage.get(actor.id)
            ?? _pendingMageSlayerDisadvantage.get(actor.uuid);
        if (timestamp === undefined) return;

        // Clean up both keys
        if (actor.id) _pendingMageSlayerDisadvantage.delete(actor.id);
        if (actor.uuid) _pendingMageSlayerDisadvantage.delete(actor.uuid);

        // Ignore stale entries older than TTL (60 seconds)
        if (Date.now() - timestamp > MAGE_SLAYER_TTL_MS) {
            debug(`Mage Slayer | Pending disadvantage entry for ${actor.name} expired — skipping`);
            return;
        }

        debug(`Mage Slayer | Injecting disadvantage into concentration save for ${actor.name}`);
        config.disadvantage = true;
        if (config.rolls?.[0]) {
            config.rolls[0].options ??= {};
            config.rolls[0].options.disadvantage = true;
        }
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onPreRollConcentration for Mage Slayer:`, err);
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
    debug("Mage Slayer Concentration | Initialized");
}

