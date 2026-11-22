/**
 * Feature: Evasion Automation
 * Description: A creature with Evasion takes no damage when it succeeds on a Dexterity save against damage that a
 * save halves, and only half damage when it fails. It doesn't benefit while Incapacitated.
 *
 * @introduced v14.108.0
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";
import { hasStatus } from "../../utils/creature-sight.js";

/**
 * Evasion
 *
 * The official items (`evasion`, `leading-evasion`) are passive features without effects; their Foundry note tells
 * the table to set the damage tray's multiplier by hand. This feature does that:
 *
 *  - DamageApplicationElement#getMergedOptions (6.0.6 and 6.1, public): for a Save activity whose damage is halved on
 *    a success, the multiplier becomes 0 after a successful Dexterity save and 0.5 after a failed one. A multiplier
 *    picked by hand (whole tray or one target) is left alone. The tray's "picked by hand" state is private, so
 *    _onChangeMultiplier is wrapped to remember it.
 *  - Player Damage Prompt: asks `evasionAppliesToActivity` and offers Half / None instead of Full / Half.
 *  - midi-qol computes damage itself and already knows the rule as "Super Saver". Workflow#checkSuperSaver is wrapped
 *    so a creature with the feature counts as one. It receives the ability actually rolled.
 *
 * Leading Evasion's option to share the benefit with nearby creatures isn't automated.
 */

const IDENTIFIERS = new Set(["evasion", "leading-evasion"]);
const NAME_FALLBACK = /^(?:leading )?evasion$/i;
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

/**
 * Trays whose whole-tray multiplier was picked by hand.
 * @type {WeakSet<HTMLElement>}
 */
const _handPicked = new WeakSet();

/**
 * Whether an actor is Incapacitated (or worse).
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isIncapacitated(actor) {
    if (INCAPACITATING.some(status => hasStatus(actor, status))) return true;
    const hp = actor.system?.attributes?.hp;
    return (Number(hp?.max) > 0) && (Number(hp?.value) <= 0);
}

/**
 * Whether an actor currently benefits from Evasion: by the feature's identifier, its English name for items without
 * one, or the flag `flags.niks-dnd5e-tweaks.evasion`.
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function hasEvasion(actor) {
    if (!actor || _isIncapacitated(actor)) return false;
    if (actor.flags?.[MODULE_ID]?.evasion) return true;
    return actor.items?.some(item => {
        if (item.type !== "feat") return false;
        const identifier = item.system?.identifier;
        return identifier ? IDENTIFIERS.has(identifier) : NAME_FALLBACK.test(item.name ?? "");
    }) ?? false;
}

/**
 * Whether Evasion changes the outcome of this activity for an actor, before anyone rolled: the activity's only save
 * is Dexterity and it halves damage. Used by the Player Damage Prompt.
 * @param {Actor5e|null} actor
 * @param {Activity|null} activity
 * @returns {boolean}
 */
export function evasionAppliesToActivity(actor, activity) {
    if (!getSetting("enableEvasion") || isMidiActive()) return false;
    if (activity?.damage?.onSave !== "half") return false;
    const abilities = activity.save?.ability;
    return (abilities?.size === 1) && abilities.has("dex") && hasEvasion(actor);
}

/**
 * Resolve the actor behind a damage tray target UUID (token or actor).
 * @param {string} uuid
 * @returns {Actor5e|null}
 */
function _actorFromUuid(uuid) {
    try {
        const doc = fromUuidSync(uuid);
        return (doc instanceof Actor) ? doc : (doc?.actor ?? null);
    } catch {
        return null;
    }
}

/**
 * Whether the save a target rolled for this usage was a Dexterity save. Activities offering several abilities are
 * decided by the target's latest roll.
 * @param {ChatMessage5e} damageMessage
 * @param {ChatMessage5e} usageMessage
 * @param {string} uuid  The target's token UUID.
 * @returns {boolean}
 */
function _rolledDexterity(damageMessage, usageMessage, uuid) {
    const activity = damageMessage.getAssociatedActivity?.() ?? usageMessage.getAssociatedActivity?.();
    const abilities = activity?.save?.ability;
    if (!abilities?.has?.("dex")) return false;
    if (abilities.size === 1) return true;

    const rolls = usageMessage.getAssociatedRolls?.("save") ?? [];
    const own = Array.from(rolls)
        .filter(message => message.getAssociatedToken?.()?.uuid === uuid)
        .sort((a, b) => a.timestamp - b.timestamp);
    return own.at(-1)?.system?.ability === "dex";
}

/**
 * Wrapper for DamageApplicationElement#getMergedOptions.
 * @this {DamageApplicationElement}
 * @param {Function} wrapped
 * @param {string} uuid  The target's UUID.
 * @param {...*} args
 * @returns {DamageApplicationOptions}
 */
function _wrapGetMergedOptions(wrapped, uuid, ...args) {
    const options = wrapped(uuid, ...args);
    try {
        if (!getSetting("enableEvasion") || isMidiActive()) return options;
        const system = this.chatMessage?.system;
        if (system?.onSave !== "half") return options;

        const outcome = system.origin?.system?.outcomes?.get?.(uuid);
        if ((outcome !== "success") && (outcome !== "failure")) return options;
        if (_handPicked.has(this) || (this.getTargetOptions?.(uuid)?.multiplier != null)) return options;

        const multiplier = (outcome === "success") ? 0 : 0.5;
        if (options?.multiplier === multiplier) return options;

        if (!hasEvasion(_actorFromUuid(uuid))) return options;
        if (!_rolledDexterity(this.chatMessage, system.origin, uuid)) return options;

        return { ...options, multiplier };
    } catch (err) {
        console.error(`${MODULE_ID} | Evasion: error while adjusting the damage tray`, err);
        return options;
    }
}

/**
 * Wrapper for DamageApplicationElement#_onChangeMultiplier: remember that the tray's multiplier was picked by hand.
 * @this {DamageApplicationElement}
 * @param {Function} wrapped
 * @param {PointerEvent} event
 * @param {...*} args
 * @returns {*}
 */
function _wrapOnChangeMultiplier(wrapped, event, ...args) {
    if (event?.target?.closest?.(".multiplier-button")) _handPicked.add(this);
    return wrapped(event, ...args);
}

/**
 * Wrapper for midi-qol's Workflow#checkSuperSaver: a creature with Evasion is a Super Saver on Dexterity saves.
 * @this {Workflow}
 * @param {Function} wrapped
 * @param {Token} token
 * @param {Set<string>|undefined} abilities  The ability rolled, or the activity's abilities.
 * @param {...*} args
 * @returns {Promise<boolean>}
 */
async function _wrapCheckSuperSaver(wrapped, token, abilities, ...args) {
    if (await wrapped(token, abilities, ...args)) return true;
    try {
        if (!getSetting("enableEvasion")) return false;
        if ((abilities?.size !== 1) || !abilities.has("dex")) return false;
        return hasEvasion(token?.actor);
    } catch (err) {
        console.error(`${MODULE_ID} | Evasion: error while checking midi-qol's Super Saver`, err);
        return false;
    }
}

/**
 * Initialize the Evasion feature. Called once during "setup" from main.js, after Circle of Power.
 */
export function initEvasion() {
    const tray = "dnd5e.applications.components.DamageApplicationElement.prototype";
    patchMethod(`${tray}.getMergedOptions`, _wrapGetMergedOptions, "WRAPPER");
    patchMethod(`${tray}._onChangeMultiplier`, _wrapOnChangeMultiplier, "WRAPPER");

    if (isMidiActive()) {
        Hooks.once("ready", () => {
            if (typeof globalThis.MidiQOL?.Workflow?.prototype?.checkSuperSaver !== "function") {
                debug("Evasion | midi-qol's Workflow#checkSuperSaver not found");
                return;
            }
            patchMethod("MidiQOL.Workflow.prototype.checkSuperSaver", _wrapCheckSuperSaver, "WRAPPER");
        });
    }
    debug("Evasion | Initialized");
}
