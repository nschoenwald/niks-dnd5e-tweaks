/**
 * Feature: Indomitable Might Automation
 * Description: A creature with Indomitable Might (Barbarian 18, 2014 and 2024) uses its Strength score in place of
 *              the total of a Strength check or Strength saving throw when the total is lower.
 *
 * @introduced v14.102.0
 */
import { MODULE_ID, debug, getSetting } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * How it works
 *
 * dnd5e has no Active Effect for this: its roll `minimum` (also used by Reliable Talent and midi-qol's `min` flags)
 * clamps the d20 result (`D20Roll#configureModifiers` → `D20Die#applyRange`), not the total.
 *
 *  - Marking: `dnd5e.postAbilityCheckRollConfiguration` and `dnd5e.postSavingThrowRollConfiguration` fire after the
 *    roll dialog, before evaluation, for ability checks, skill and tool checks, initiative, saves and concentration
 *    saves. When the final ability is Strength (for skills the one picked in the dialog, read from
 *    `message.data.system.ability`) and the actor has the feature, each roll gets `options.nd5tMinimumTotal` (the
 *    Strength score) and `options.nd5tMinimumTotalLabel` (the feature's name). Roll options are serialized, so the
 *    raised total survives reloads.
 *  - Total: the `D20Roll#total` getter is wrapped (like Condition Advantage & Disadvantage's `nd5tMaximumTotal`):
 *    a marked roll whose total is lower returns the Strength score, so success / failure against a DC, the chat
 *    card and midi-qol's save checks all see it. A roll that automatically fails (`nd5tMaximumTotal`, e.g. a
 *    Paralyzed creature's Strength save) isn't marked.
 *  - Label: the static `D20Roll._prepareMessageData` is wrapped to add "(Indomitable Might)" to the message
 *    flavor when the total was raised.
 *
 * Recognized: feats with the identifier `indomitable-might`, feats named "Indomitable Might", and actors with the
 * flag `flags.niks-dnd5e-tweaks.indomitableMight` (homebrew, settable by Active Effect).
 */

const IDENTIFIER = "indomitable-might";
const NAMES = new Set(["indomitable might"]);
const MINIMUM = "nd5tMinimumTotal";
const LABEL = "nd5tMinimumTotalLabel";
/** Set by Condition Advantage & Disadvantage on rolls that fail automatically. */
const MAXIMUM = "nd5tMaximumTotal";

function _active() {
    try {
        return Boolean(getSetting("enableIndomitableMight"));
    } catch {
        return false;
    }
}

/**
 * The name to show for the actor's Indomitable Might, or null if it has none.
 * @param {Actor5e} actor
 * @returns {string|null}
 */
function _featureName(actor) {
    const item = actor?.items?.find(i => (i.type === "feat")
        && (((i.identifier || i.system?.identifier || "").toLowerCase() === IDENTIFIER)
            || NAMES.has((i.name ?? "").trim().toLowerCase())));
    if (item) return item.name;
    if (actor?.getFlag?.(MODULE_ID, "indomitableMight")) return game.i18n.localize("ND5T.IndomitableMight.Label");
    return null;
}

/**
 * dnd5e.post…RollConfiguration: mark Strength checks and saves of a creature with Indomitable Might.
 * @param {D20Roll[]} rolls  Built, not yet evaluated rolls.
 * @param {object} config   Roll process configuration.
 * @param {object} _dialog
 * @param {object} message  Message configuration.
 */
function _onPostRollConfiguration(rolls, config, _dialog, message) {
    try {
        if (!_active() || !rolls?.length) return;
        const ability = message?.data?.system?.ability ?? config?.ability;
        if (ability !== "str") return;
        const actor = (config.subject instanceof Actor) ? config.subject : config.subject?.actor;
        const score = Number(actor?.system?.abilities?.str?.value);
        if (!Number.isFinite(score)) return;
        const label = _featureName(actor);
        if (!label) return;
        for (const roll of rolls) {
            if (!roll?.validD20Roll || (typeof roll.options?.[MAXIMUM] === "number")) continue;
            roll.options[MINIMUM] = score;
            roll.options[LABEL] = label;
        }
        debug(`Indomitable Might | ${actor.name}: Strength roll total at least ${score}`);
    } catch (err) {
        console.error(`${MODULE_ID} | Indomitable Might: marking the roll failed`, err);
    }
}

/**
 * Whether a marked, evaluated roll's own total is below its minimum.
 * @param {D20Roll} roll
 * @returns {boolean}
 */
function _isRaised(roll) {
    const minimum = roll?.options?.[MINIMUM];
    if ((typeof minimum !== "number") || (typeof roll.options[MAXIMUM] === "number")) return false;
    return Number.isNumeric(roll._total) && (roll._total < minimum);
}

/**
 * Wrapper for the `D20Roll#total` getter: raise a marked roll's total to the Strength score.
 * @this {D20Roll}
 */
function _wrapTotal(wrapped) {
    const total = wrapped();
    if ((typeof this.options?.[MINIMUM] !== "number") || !Number.isNumeric(total)) return total;
    if (typeof this.options[MAXIMUM] === "number") return total;
    return Math.max(total, this.options[MINIMUM]);
}

/**
 * Wrapper for the static `D20Roll._prepareMessageData`: name the feature in the flavor when it raised a total.
 * @this {typeof D20Roll}
 */
function _wrapPrepareMessageData(wrapped, rolls, messageData, ...args) {
    const result = wrapped(rolls, messageData, ...args);
    try {
        const raised = (rolls ?? []).find(r => _isRaised(r));
        if (raised && messageData) {
            const label = raised.options[LABEL] || game.i18n.localize("ND5T.IndomitableMight.Label");
            messageData.flavor = `${messageData.flavor ?? ""} (${label})`;
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Indomitable Might: message flavor failed`, err);
    }
    return result;
}

/**
 * Initialize Indomitable Might. Called once during the "setup" phase from main.js.
 * The wrappers only act on marked rolls, so they stay registered whatever the setting says.
 */
export function initIndomitableMight() {
    Hooks.on("dnd5e.postAbilityCheckRollConfiguration", _onPostRollConfiguration);
    Hooks.on("dnd5e.postSavingThrowRollConfiguration", _onPostRollConfiguration);
    patchMethod("CONFIG.Dice.D20Roll.prototype.total#get", _wrapTotal, "WRAPPER");
    patchMethod("CONFIG.Dice.D20Roll._prepareMessageData", _wrapPrepareMessageData, "WRAPPER");
    debug("Indomitable Might | Initialized");
}
