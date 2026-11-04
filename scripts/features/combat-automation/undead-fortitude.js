/**
 * Feature: Undead Fortitude Automation
 * Description: When damage would reduce a creature with Undead Fortitude to 0 HP, it rolls a Constitution save
 * (DC 5 + the damage taken) and stays at 1 HP on a success. Radiant damage and critical hits skip the save.
 *
 * @introduced v14.65.0
 */
import { MODULE_ID, getSetting, debug } from "../../main.js";

/**
 * Undead Fortitude
 *
 * dnd5e (and the 2024 Monster Manual) ship Undead Fortitude as a description-only feat.
 *
 * Implementation:
 *
 *  dnd5e.calculateDamage — fires inside Actor5e#calculateDamage with the typed damage descriptions after
 *  resistances and immunities. Whether Radiant damage got through is remembered for the options object,
 *  which Actor5e#applyDamage passes on unchanged to dnd5e.preApplyDamage.
 *
 *  dnd5e.preApplyDamage — fires synchronously before the HP update. If the update would take the creature
 *  from above 0 to 0 HP, the update is changed to leave it at 1 HP and the save is rolled afterwards. On a
 *  failure (or a cancelled roll) the creature then drops from 1 to 0. Holding it at 1 HP while the save is
 *  open keeps 0 HP automation (Dead status, defeated, death animations) from firing on a creature that
 *  may survive. The hook can't wait for the roll, so cancelling the update and re-applying it later is not
 *  an option without skipping other modules' preApplyDamage handlers.
 *
 *  midi-qol: midi calls dnd5e.preApplyDamage itself (GMAction) with its calcDamageOptions and updates the
 *  actor with the same `updates` object, so the clamp works there too. Critical hits come from
 *  `options.midi.isCritical`. Its options object may not be the one calculateDamage saw, so Radiant falls
 *  back to the damage rolls on the originating card (ignores Radiant immunity, which undead with this
 *  feature practically never have). midi-qol has no Undead Fortitude handling of its own.
 */

const HP_KEY = "system.attributes.hp.value";

/** Known item identifiers (2014 & 2024 Zombie, Ogre Zombie, …). */
const KNOWN_IDENTIFIERS = new Set(["undead-fortitude"]);

/** Name fallbacks for feats without an identifier (homebrew / imported statblocks), lowercase. */
const NAME_FALLBACKS = ["undead fortitude"];

/**
 * Whether Radiant damage got through, per damage application options object.
 * @type {WeakMap<object, boolean>}
 */
const _radiantByOptions = new WeakMap();

/**
 * Actors with a save in progress on this client, by UUID.
 * @type {Set<string>}
 */
const _pending = new Set();

// ── Detection ─────────────────────────────────────────────────────────

/**
 * Find the Undead Fortitude feature of an actor.
 * Matches the actor flag niks-dnd5e-tweaks.undeadFortitude, the item identifier, or the feat name.
 *
 * @param {Actor5e} actor
 * @returns {{ name: string }|null}
 */
function _getUndeadFortitude(actor) {
    for (const item of actor.items ?? []) {
        if (item.type !== "feat") continue;
        const identifier = item.identifier ?? item.system?.identifier ?? "";
        const name = (item.name ?? "").toLowerCase();
        if (KNOWN_IDENTIFIERS.has(identifier) || NAME_FALLBACKS.some(f => name.includes(f))) {
            return { name: item.name };
        }
    }
    if (actor.getFlag?.(MODULE_ID, "undeadFortitude")) {
        return { name: game.i18n.localize("ND5T.UndeadFortitude.Name") };
    }
    return null;
}

/**
 * Chat messages the damage came from: the damage tray's roll (`origin`), the context menu's message
 * (`originatingMessage`), or midi-qol's item card (both, set by midi's withDamageOrigin).
 * @param {object} options  Damage application options.
 * @returns {ChatMessage[]}
 */
function _sourceMessages(options) {
    const messages = [options?.origin, options?.originatingMessage].filter(m => m instanceof ChatMessage);
    return [...new Set(messages)];
}

/**
 * Whether the damage came from a critical hit.
 * @param {object} options  Damage application options.
 * @returns {boolean}
 */
function _isCriticalHit(options) {
    if (options?.midi?.isCritical) return true;
    return _sourceMessages(options).some(m => m.rolls?.some(r => r.isCritical === true));
}

/**
 * Whether Radiant damage was part of the damage taken.
 * @param {object} options  Damage application options.
 * @returns {boolean}
 */
function _isRadiant(options) {
    if (_radiantByOptions.has(options)) return _radiantByOptions.get(options);
    const DamageRoll = CONFIG.Dice.DamageRoll;
    return _sourceMessages(options).some(m => m.rolls?.some(r => (r instanceof DamageRoll)
        && ((r.options?.type === "radiant") || r.options?.types?.includes?.("radiant"))));
}

// ── Hooks ─────────────────────────────────────────────────────────────

/**
 * dnd5e.calculateDamage — remember whether Radiant damage got through.
 * @param {Actor5e} actor
 * @param {DamageDescription[]} damages  Calculated damages.
 * @param {object} options               Damage application options.
 */
function _onCalculateDamage(actor, damages, options) {
    try {
        if (!getSetting("enableUndeadFortitude") || !options || (typeof options !== "object")) return;
        const radiant = Array.isArray(damages) && damages.some(d => (d.type === "radiant") && (d.value > 0));
        _radiantByOptions.set(options, radiant);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onCalculateDamage for Undead Fortitude:", err);
    }
}

/**
 * dnd5e.preApplyDamage — hold the creature at 1 HP and roll the save.
 * @param {Actor5e} actor
 * @param {number} amount   Damage that will be applied.
 * @param {object} updates  Actor updates, changed in place.
 * @param {object} options  Damage application options.
 */
function _onPreApplyDamage(actor, amount, updates, options) {
    try {
        if (!getSetting("enableUndeadFortitude")) return;
        if (!(amount > 0) || !actor?.isOwner) return;

        const current = actor.system?.attributes?.hp?.value ?? 0;
        const next = updates?.[HP_KEY];
        if (!(current > 0) || (typeof next !== "number") || (next > 0)) return;

        const feature = _getUndeadFortitude(actor);
        if (!feature) return;

        // A second hit while the first save is open takes the creature to 0 normally
        if (_pending.has(actor.uuid)) return;

        if (_isRadiant(options)) {
            debug(`Undead Fortitude | ${actor.name} took Radiant damage — no save.`);
            _whisperSkipped(actor, feature, "ND5T.UndeadFortitude.SkippedRadiant");
            return;
        }
        if (_isCriticalHit(options)) {
            debug(`Undead Fortitude | ${actor.name} was hit by a critical hit — no save.`);
            _whisperSkipped(actor, feature, "ND5T.UndeadFortitude.SkippedCritical");
            return;
        }

        const dc = 5 + Math.trunc(amount);
        updates[HP_KEY] = 1;
        _pending.add(actor.uuid);
        debug(`Undead Fortitude | ${actor.name} would drop to 0 HP from ${amount} damage — held at 1 HP, rolling DC ${dc}.`);

        // Roll once the HP update is out
        setTimeout(() => _rollSave(actor, feature, dc), 200);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onPreApplyDamage for Undead Fortitude:", err);
    }
}

// ── Save ──────────────────────────────────────────────────────────────

/**
 * Roll the Constitution save, and drop the creature from its placeholder 1 HP to 0 unless it succeeds.
 * @param {Actor5e} actor
 * @param {{ name: string }} feature
 * @param {number} dc
 */
async function _rollSave(actor, feature, dc) {
    let success = false;
    try {
        const rolls = await actor.rollSavingThrow(
            { ability: "con", target: dc },
            { configure: !getSetting("undeadFortitudeFastForward") },
            {
                data: {
                    flavor: game.i18n.format("ND5T.UndeadFortitude.Flavor", { feature: feature.name, dc }),
                    flags: { [MODULE_ID]: { undeadFortitude: { dc } } }
                }
            }
        );
        const roll = rolls?.[0];
        success = !!roll && (roll.isSuccess ?? (roll.total >= dc));
        debug(`Undead Fortitude | ${actor.name} ${roll ? `rolled ${roll.total} vs DC ${dc}` : "save cancelled"} — ${success ? "stays at 1 HP" : "drops to 0 HP"}.`);
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Undead Fortitude save failed for ${actor?.name}:`, err);
    } finally {
        _pending.delete(actor.uuid);
    }

    if (success) return;

    try {
        // Take away the placeholder hit point. Healing or more damage in the meantime is kept.
        const hp = actor.system?.attributes?.hp?.value ?? 0;
        if (hp <= 0) return;
        await actor.update({ [HP_KEY]: hp - 1 }, { dnd5e: { concentrationCheck: false } });
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Undead Fortitude could not drop ${actor?.name} to 0 HP:`, err);
    }
}

/**
 * Tell the GMs why Undead Fortitude didn't trigger.
 * @param {Actor5e} actor
 * @param {{ name: string }} feature
 * @param {string} key  Localization key.
 */
function _whisperSkipped(actor, feature, key) {
    const whisper = game.users.filter(u => u.isGM).map(u => u.id);
    if (!whisper.length) return;
    ChatMessage.create({
        content: `<p>${game.i18n.format(key, {
            name: foundry.utils.escapeHTML(actor.name),
            feature: foundry.utils.escapeHTML(feature.name)
        })}</p>`,
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper
    }).catch(err => console.error("Nik's DnD5e Tweaks | Undead Fortitude chat message failed:", err));
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Undead Fortitude feature.
 * Called once during the "setup" phase from main.js.
 */
export function initUndeadFortitude() {
    Hooks.on("dnd5e.calculateDamage", _onCalculateDamage);
    Hooks.on("dnd5e.preApplyDamage", _onPreApplyDamage);
    debug("Undead Fortitude | Initialized");
}
