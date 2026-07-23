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
 *  1. dnd5e.preApplyDamage — fires before HP is modified and while
 *     options.originatingMessage is still available. If the attacker holds
 *     the Mage Slayer feat, the defending actor's ID is recorded in a
 *     short-lived Map together with the current timestamp.
 *
 *  2. dnd5e.preRollConcentration — fires inside D20Roll.buildConfigure()
 *     before the concentration roll is constructed. If the defending actor
 *     has a pending Mage Slayer entry (< 1 second old), disadvantage is
 *     injected into the roll config. The system's own advantage/disadvantage
 *     resolver then handles the War Caster case correctly:
 *       advantage + disadvantage → NORMAL (2024 rules).
 */

/**
 * Short-lived map of actor IDs that should roll their next concentration
 * save with disadvantage due to a Mage Slayer attacker.
 *
 * Key:   defender actor ID (string)
 * Value: timestamp (ms) when the entry was recorded
 *
 * Entries older than MAGE_SLAYER_TTL_MS are ignored to prevent a stale
 * entry from wrongly affecting a later, unrelated concentration save.
 *
 * @type {Map<string, number>}
 */
const _pendingMageSlayerDisadvantage = new Map();

/** Maximum age (ms) of a pending Mage Slayer entry. */
const MAGE_SLAYER_TTL_MS = 1000;

// ── Mage Slayer detection ─────────────────────────────────────────────

/**
 * Determine whether an actor has the Mage Slayer feat, using a 3-tier check:
 *   1. item.system.identifier === "mage-slayer"  (official 2024 compendium)
 *   2. actor flag dnd5e.mageSlayer === true        (legacy / custom flag)
 *   3. item.name.toLowerCase() === "mage slayer"  (homebrew fallback)
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
function _hasMageSlayer(actor) {
    if (!actor?.items) return false;

    // Tier 2: legacy flag (cheapest, check first)
    if (actor.getFlag("dnd5e", "mageSlayer")) return true;

    // Tiers 1 & 3: scan feat items
    for (const item of actor.items) {
        if (item.type !== "feat") continue;

        // Tier 1: official identifier
        if (item.system?.identifier === "mage-slayer") return true;

        // Tier 3: name-based fallback for homebrew
        if (item.name?.toLowerCase() === "mage slayer") return true;
    }

    return false;
}

// ── Hook handlers ─────────────────────────────────────────────────────

/**
 * dnd5e.preApplyDamage — fires before HP is written to the actor.
 *
 * At this point options.originatingMessage is the attacker's damage roll
 * chat message, whose speaker.actor is the attacker's actor ID.
 *
 * If the attacker has Mage Slayer and the defender is concentrating,
 * record a pending disadvantage entry for the defender.
 *
 * @param {Actor}  defenderActor  Actor that is about to take damage.
 * @param {number} amount         Net HP change (positive = damage).
 * @param {object} _updates       HP update delta (unused).
 * @param {object} options        Damage application options.
 */
function _onPreApplyDamage(defenderActor, amount, _updates, options) {
    if (!game.settings.get(MODULE_ID, "enableMageSlayerConcentration")) return;

    // Only care about actual damage
    if (amount <= 0) return;

    // Defender must be concentrating
    if (!defenderActor?.concentration?.effects?.size) return;

    // Resolve the attacking actor from the originating chat message
    const originMsg = options?.originatingMessage;
    if (!originMsg) return;

    const attackerActorId = originMsg.speaker?.actor;
    if (!attackerActorId) return;

    const attackerActor = game.actors.get(attackerActorId);
    if (!attackerActor) return;

    if (!_hasMageSlayer(attackerActor)) return;

    debug(`Mage Slayer | ${attackerActor.name} has Mage Slayer — flagging ${defenderActor.name} for concentration disadvantage`);
    _pendingMageSlayerDisadvantage.set(defenderActor.id, Date.now());
}

/**
 * dnd5e.preRollConcentration — fires inside D20Roll.buildConfigure()
 * before the concentration save is built.
 *
 * config.subject is the actor rolling the concentration save.
 * config.rolls[0].options carries the advantage/disadvantage booleans.
 *
 * If this actor has a fresh pending Mage Slayer entry, inject disadvantage.
 * The D20Roll resolver handles the advantage+disadvantage → NORMAL case
 * automatically (War Caster + Mage Slayer = normal roll, per 2024 rules).
 *
 * @param {AbilityRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration}   _dialog
 * @param {BasicRollMessageConfiguration}  _message
 */
function _onPreRollConcentration(config, _dialog, _message) {
    if (!game.settings.get(MODULE_ID, "enableMageSlayerConcentration")) return;

    const actor = config.subject;
    if (!actor?.id) return;

    const timestamp = _pendingMageSlayerDisadvantage.get(actor.id);
    if (timestamp === undefined) return;

    // Consume the entry regardless of TTL to avoid lingering state
    _pendingMageSlayerDisadvantage.delete(actor.id);

    // Ignore stale entries — this should rarely happen given the 200ms
    // auto-roll defer in auto-roll-concentration.js, but acts as a safety net
    // if the concentration save was triggered much later (e.g. manual click).
    if (Date.now() - timestamp > MAGE_SLAYER_TTL_MS) {
        debug(`Mage Slayer | Pending disadvantage entry for ${actor.name} expired — skipping`);
        return;
    }

    const roll = config.rolls?.[0];
    if (!roll) return;

    debug(`Mage Slayer | Injecting disadvantage into concentration save for ${actor.name}`);
    roll.options.disadvantage = true;
    // Note: if roll.options.advantage is already true (e.g. War Caster),
    // the D20Roll.applyKeybindings resolver (d20-roll.mjs line 96-100)
    // evaluates advantage=true + disadvantage=true → ADV_MODE.NORMAL.
    // This is correct 2024 PHB behavior — no special handling needed here.
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Mage Slayer concentration feature.
 * Called once during the "setup" phase from main.js.
 */
export function initMageSlayerConcentration() {
    Hooks.on("dnd5e.preApplyDamage", _onPreApplyDamage);
    Hooks.on("dnd5e.preRollConcentration", _onPreRollConcentration);
    debug("Mage Slayer Concentration | Initialized");
}
