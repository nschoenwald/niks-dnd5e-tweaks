/**
 * Feature: Death Ward Automation
 * Description: The first time a creature under Death Ward would drop to 0 HP, it drops to 1 HP instead and the
 * spell's effect is removed.
 *
 * @introduced v14.66.0
 */
import { MODULE_ID, getSetting, debug } from "../../main.js";

/**
 * Death Ward
 *
 * The PHB 2024 spell applies a "Protection from Death" effect without changes; nothing in dnd5e or midi-qol
 * acts on it.
 *
 * dnd5e.preApplyDamage — fires synchronously before the HP update (Actor5e#applyDamage, and midi-qol's
 * GMAction with the same `updates` object). If the update would take the creature from above 0 to 0 HP and it
 * has an active Death Ward effect, the update is changed to 1 HP and the effect is deleted afterwards.
 *
 * Registered before Undead Fortitude, so a creature with both keeps 1 HP from the ward and doesn't roll.
 * The instant-death clause (effects that kill without damage) isn't automated.
 */

const HP_KEY = "system.attributes.hp.value";
const FLAG_KEY = `flags.${MODULE_ID}.deathWard`;

/** Effect names, lowercase: the spell's own name and the PHB 2024 effect name. */
const EFFECT_NAMES = ["death ward", "protection from death"];

/**
 * Effects whose deletion is already on its way, by UUID, so two quick hits don't both use the ward.
 * @type {Set<string>}
 */
const _consumed = new Set();

/**
 * Whether an effect is a Death Ward: by name, by the identifier of the item it came from, or because it
 * sets the flag niks-dnd5e-tweaks.deathWard.
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _isDeathWard(effect) {
    const name = (effect.name ?? "").toLowerCase();
    if (EFFECT_NAMES.some(n => name.includes(n))) return true;

    const changes = effect.system?.changes ?? effect.changes ?? [];
    if (changes.some?.(c => c.key === FLAG_KEY)) return true;

    if (effect.getFlag?.(MODULE_ID, "deathWard")) return true;

    try {
        const origin = effect.origin ? fromUuidSync(effect.origin) : null;
        const item = origin instanceof Item ? origin : (origin?.parent instanceof Item ? origin.parent : null);
        if (item?.system?.identifier === "death-ward") return true;
    } catch {
        // Origin in an unloaded compendium or a deleted actor
    }
    return false;
}

/**
 * Find an active Death Ward effect on an actor.
 * @param {Actor5e} actor
 * @returns {ActiveEffect5e|null}
 */
function _findDeathWard(actor) {
    for (const effect of actor.allApplicableEffects?.() ?? actor.effects ?? []) {
        if (!effect.active || _consumed.has(effect.uuid)) continue;
        if (_isDeathWard(effect)) return effect;
    }
    return null;
}

/**
 * dnd5e.preApplyDamage — keep the creature at 1 HP and end the ward.
 * @param {Actor5e} actor
 * @param {number} amount   Damage that will be applied.
 * @param {object} updates  Actor updates, changed in place.
 */
function _onPreApplyDamage(actor, amount, updates) {
    try {
        if (!getSetting("enableDeathWard")) return;
        if (!(amount > 0) || !actor?.isOwner) return;

        const current = actor.system?.attributes?.hp?.value ?? 0;
        const next = updates?.[HP_KEY];
        if (!(current > 0) || (typeof next !== "number") || (next > 0)) return;

        const effect = _findDeathWard(actor);
        if (!effect) return;

        updates[HP_KEY] = 1;
        _consumed.add(effect.uuid);
        debug(`Death Ward | ${actor.name} would drop to 0 HP — drops to 1 HP instead, ending ${effect.name}.`);

        // End the ward once the HP update is out
        setTimeout(() => _endWard(actor, effect), 100);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onPreApplyDamage for Death Ward:", err);
    }
}

/**
 * Delete the ward's effect and announce it.
 * @param {Actor5e} actor
 * @param {ActiveEffect5e} effect
 */
async function _endWard(actor, effect) {
    try {
        if (effect.parent?.effects?.has(effect.id)) await effect.delete();
        await ChatMessage.create({
            content: `<p>${game.i18n.format("ND5T.DeathWard.Triggered", {
                name: foundry.utils.escapeHTML(actor.name)
            })}</p>`,
            speaker: ChatMessage.getSpeaker({ actor })
        });
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Death Ward could not end for ${actor?.name}:`, err);
    } finally {
        _consumed.delete(effect.uuid);
    }
}

/**
 * Initialize the Death Ward feature.
 * Called once during the "setup" phase from main.js, before Undead Fortitude.
 */
export function initDeathWard() {
    Hooks.on("dnd5e.preApplyDamage", _onPreApplyDamage);
    debug("Death Ward | Initialized");
}
