/**
 * Feature: Circle of Power Automation
 * Description: Creatures inside a Circle of Power aura roll saves against spells and magical effects with
 * Advantage, and take no damage instead of half when they succeed on such a save.
 *
 * @introduced v14.105.0
 * @updated v14.108.1 (midi-qol: failed saves keep full damage, using Semi Super Saver instead of Super Saver)
 */
import { MODULE_ID, getSetting, debug, log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";
import { resolveSaveSource, classifyMagicSource } from "./magic-resistance.js";

/**
 * Circle of Power
 *
 * The PHB 2024 spell places a 30 ft emanation whose dnd5e "Apply Active Effect" region behavior gives the caster
 * and allies inside a "Circle's Power" effect (removed when they leave). The effect has no changes: dnd5e can't
 * express either rule of the spell. This feature adds them:
 *
 *  - dnd5e.preRollSavingThrow: a creature with the effect gets Advantage on saves whose source is a spell or a
 *    magical effect (source resolution shared with Magic Resistance). Concentration saves are made against
 *    damage and stay unchanged.
 *  - DamageApplicationElement#getMergedOptions (6.0.6 and 6.1, public): when the damage tray would halve the
 *    damage of a magical source for a successful save, the multiplier becomes 0 for creatures with the effect.
 *    A multiplier the user picked by hand (whole tray or one target) is left alone.
 *  - midi-qol computes damage itself: the effect gets midi's `semiSuperSaver.all` flag instead (preCreateActiveEffect).
 *    Not `superSaver`, which would also halve damage on a failed save (that is Evasion's rule, not this spell's).
 *
 * Versions without the region behavior (homebrew or imported items, matched by identifier): when the spell places
 * its area, the active GM attaches this module's own region behavior, a subclass of dnd5e's that creates the
 * effect itself.
 *
 * Effects are recognized by this module's flag, the PHB effect's compendium source, or the region behavior that
 * applied them (its region's item is Circle of Power). Their English name is the last fallback.
 */

const SPELL_IDENTIFIER = "circle-of-power";
const PHB_EFFECT_ID = "phbeffCirclesPow";
const EFFECT_IMG = "icons/magic/defensive/barrier-shield-dome-pink.webp";
const NAME_FALLBACK = /^circle(?:'s| of) power$/i;
const SPELL_NAME_FALLBACK = /^circle of power$/i;

/**
 * Region behavior type of this module. Built on use: main.js imports this file before it defines MODULE_ID.
 * @returns {string}
 */
const behaviorType = () => `${MODULE_ID}.circleOfPower`;

// ── Recognition ───────────────────────────────────────────────────────

/**
 * Resolve a UUID synchronously, returning null on errors (unknown or compendium documents).
 * @param {string} uuid
 * @returns {foundry.abstract.Document|null}
 */
function _safeFromUuid(uuid) {
    if (!uuid || (typeof uuid !== "string")) return null;
    try {
        return fromUuidSync(uuid);
    } catch {
        return null;
    }
}

/**
 * Whether an item is the Circle of Power spell.
 * @param {Item5e|null} item
 * @returns {boolean}
 */
function _isCircleItem(item) {
    if (!item) return false;
    const identifier = item.identifier ?? item.system?.identifier ?? "";
    if (identifier) return identifier === SPELL_IDENTIFIER;
    return (item.type === "spell") && SPELL_NAME_FALLBACK.test(item.name ?? "");
}

/**
 * Whether a region was placed by Circle of Power.
 * @param {RegionDocument|null} region
 * @returns {boolean}
 */
function _isCircleRegion(region) {
    return _isCircleItem(_safeFromUuid(region?.getFlag?.("dnd5e", "item")));
}

/**
 * Whether an Active Effect is the aura effect of Circle of Power.
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _isCircleEffect(effect) {
    if (effect.getFlag?.(MODULE_ID, "circleOfPower")) return true;
    const source = effect._stats?.compendiumSource ?? "";
    if (source.endsWith(`.${PHB_EFFECT_ID}`)) return true;
    const originUuid = [effect.origin, effect.system?.origin?.behavior].find(u => u?.includes?.(".RegionBehavior."));
    if (originUuid && _isCircleRegion(_safeFromUuid(originUuid)?.parent)) return true;
    return NAME_FALLBACK.test(effect.name ?? "");
}

/**
 * The active Circle of Power effect on an actor, if any.
 * @param {Actor5e|null} actor
 * @returns {ActiveEffect5e|null}
 */
export function getCircleOfPowerEffect(actor) {
    for (const effect of actor?.effects ?? []) {
        if (effect.active && _isCircleEffect(effect)) return effect;
    }
    return null;
}

/**
 * Resolve the actor behind a damage tray target UUID (token or actor).
 * @param {string} uuid
 * @returns {Actor5e|null}
 */
function _actorFromUuid(uuid) {
    const doc = _safeFromUuid(uuid);
    if (!doc) return null;
    return (doc instanceof Actor) ? doc : (doc.actor ?? null);
}

// ── Saving throws ─────────────────────────────────────────────────────

/**
 * dnd5e.preRollSavingThrow — Advantage on saves against spells and magical effects inside the aura.
 * @param {AbilityRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration}   _dialog
 * @param {BasicRollMessageConfiguration}  message
 */
function _onPreRollSavingThrow(config, _dialog, message) {
    try {
        if (!getSetting("enableCircleOfPower")) return;
        if (config.isConcentration || config.hookNames?.includes("concentration")) return;

        const actor = config.subject;
        if (!getCircleOfPowerEffect(actor)) return;

        const { item, itemType } = resolveSaveSource(config, message);
        if (!classifyMagicSource(item, itemType)) return;

        debug(`Circle of Power | ${actor.name} is in the aura — Advantage against ${item?.name ?? itemType}`);
        config.advantage = true;
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            roll.options.advantage = true;
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Circle of Power: error while adjusting a saving throw`, err);
    }
}

// ── Damage tray ───────────────────────────────────────────────────────

/**
 * Wrapper for DamageApplicationElement#getMergedOptions: a successful save against half damage of a magical source
 * means no damage for creatures in the aura.
 * @this {DamageApplicationElement}
 * @param {Function} wrapped
 * @param {string} uuid  The target's UUID.
 * @param {...*} args
 * @returns {DamageApplicationOptions}
 */
function _wrapGetMergedOptions(wrapped, uuid, ...args) {
    const options = wrapped(uuid, ...args);
    try {
        if ((options?.multiplier !== 0.5) || !getSetting("enableCircleOfPower")) return options;
        const system = this.chatMessage?.system;
        if (system?.onSave !== "half") return options;
        if (system.origin?.system?.outcomes?.get?.(uuid) !== "success") return options;
        // Halved by hand (whole tray, default 1, or this target) rather than by the save
        if ((this.multiplier === 0.5) || (this.getTargetOptions?.(uuid)?.multiplier != null)) return options;

        const actor = _actorFromUuid(uuid);
        if (!getCircleOfPowerEffect(actor)) return options;

        const item = this.chatMessage.getAssociatedItem?.() ?? system.origin.getAssociatedItem?.() ?? null;
        if (!classifyMagicSource(item, item?.type ?? system.item?.type ?? null)) return options;

        debug(`Circle of Power | ${actor.name} saved inside the aura — no damage from ${item?.name ?? "the effect"}`);
        return { ...options, multiplier: 0 };
    } catch (err) {
        console.error(`${MODULE_ID} | Circle of Power: error while adjusting the damage tray`, err);
        return options;
    }
}

// ── midi-qol ──────────────────────────────────────────────────────────

/** midi-qol change: no damage instead of half on a successful save, full damage on a failed one. */
const MIDI_SEMI_SUPER_SAVER = { key: "flags.midi-qol.semiSuperSaver.all", type: "override", value: "1", priority: 20 };

/**
 * preCreateActiveEffect — give the aura effect midi-qol's Semi Super Saver flag when midi computes the damage.
 * @param {ActiveEffect5e} effect
 */
function _onPreCreateActiveEffect(effect) {
    try {
        if (!isMidiActive() || !getSetting("enableCircleOfPower")) return;
        if (!(effect.parent instanceof Actor) || !_isCircleEffect(effect)) return;
        const changes = Array.from(effect.system?.changes ?? []);
        if (changes.some(c => c.key === MIDI_SEMI_SUPER_SAVER.key)) return;
        effect.updateSource({ "system.changes": [...changes, { ...MIDI_SEMI_SUPER_SAVER }] });
    } catch (err) {
        console.error(`${MODULE_ID} | Circle of Power: error while adding the midi-qol flag`, err);
    }
}

// ── Region behavior for versions without one ──────────────────────────

/**
 * Register this module's region behavior type: dnd5e's "Apply Active Effect" behavior, creating the Circle of Power
 * effect itself instead of copying effects from UUIDs. Called during "init".
 */
export function registerCircleOfPowerTypes() {
    const Base = globalThis.dnd5e?.dataModels?.regionBehavior?.ApplyActiveEffect5eRegionBehaviorType;
    if (!Base) {
        log("Circle of Power | dnd5e's Apply Active Effect region behavior not found, fallback not registered");
        return;
    }

    class CircleOfPowerRegionBehaviorType extends Base {
        /** @override */
        async _getEffectsToCreate(_actor, _effects) {
            const changes = isMidiActive() ? [{ ...MIDI_SEMI_SUPER_SAVER }] : [];
            return [{
                name: game.i18n.localize("ND5T.CircleOfPower.EffectName"),
                img: EFFECT_IMG,
                origin: this.behavior.uuid,
                description: `<p>${game.i18n.localize("ND5T.CircleOfPower.EffectDescription")}</p>`,
                system: { changes, magical: true },
                flags: { [MODULE_ID]: { circleOfPower: true } }
            }];
        }
    }

    CONFIG.RegionBehavior.dataModels[behaviorType()] = CircleOfPowerRegionBehaviorType;
    CONFIG.RegionBehavior.typeIcons[behaviorType()] = "fa-solid fa-person-rays";
}

/**
 * createRegion — active GM: attach the fallback behavior to a Circle of Power area whose activity has no
 * "Apply Active Effect" behavior of its own (dnd5e attaches that one in the same hook).
 * @param {RegionDocument} region
 * @param {object} options
 */
async function _onCreateRegion(region, options) {
    try {
        if (!game.user.isActiveGM || !getSetting("enableCircleOfPower")) return;
        if (options?.dnd5e?.createActivityBehaviors === false) return;
        if (!_isCircleRegion(region)) return;
        if (!CONFIG.RegionBehavior.dataModels[behaviorType()]) return;

        let activity = null;
        try {
            activity = await fromUuid(region.getFlag("dnd5e", "activity"));
        } catch {
            activity = null;
        }
        const hasOwn = activity?.applicableBehaviors?.some(b => (b.type === "applyActiveEffect") && b.config?.effects?.size);
        if (hasOwn) return;
        const existing = region.behaviors?.some(b => [behaviorType(), "dnd5e.applyActiveEffect"].includes(b.type));
        if (existing) return;

        const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
        const caster = _safeFromUuid(region.getFlag("dnd5e", "origin"));
        // Same rule as dnd5e's "allies" target: relative to a hostile caster, allies are the hostile tokens
        const disposition = (caster?.disposition === HOSTILE) ? HOSTILE : FRIENDLY;

        await region.createEmbeddedDocuments("RegionBehavior", [{
            type: behaviorType(),
            name: game.i18n.localize(`TYPES.RegionBehavior.${behaviorType()}`),
            system: { dispositions: [disposition] }
        }]);
        debug(`Circle of Power | Attached the aura behavior to "${region.name}"`);
    } catch (err) {
        console.error(`${MODULE_ID} | Circle of Power: could not attach the aura behavior`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Circle of Power feature. Called once during "setup" from main.js.
 */
export function initCircleOfPower() {
    Hooks.on("dnd5e.preRollSavingThrow", _onPreRollSavingThrow);
    Hooks.on("preCreateActiveEffect", _onPreCreateActiveEffect);
    Hooks.on("createRegion", _onCreateRegion);
    patchMethod("dnd5e.applications.components.DamageApplicationElement.prototype.getMergedOptions",
        _wrapGetMergedOptions, "WRAPPER");
    debug("Circle of Power | Initialized");
}
