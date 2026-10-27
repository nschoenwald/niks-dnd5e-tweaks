/**
 * Utility: Module Compatibility
 * Description: Central helpers that tell features whether midi-qol, Automated Conditions 5e or
 *              Automated Masteries 5e are active and which jobs they have been configured to take
 *              over, so the module can yield instead of doing the same job twice.
 *
 * @introduced v14.51.0
 */

const MIDI_ID = "midi-qol";
const AC5E_ID = "automated-conditions-5e";
const WM5E_ID = "wm5e";

/**
 * Whether Automated Conditions 5e is active. It computes advantage / disadvantage for d20 rolls
 * and marks its recommended roll button in roll dialogs.
 * @returns {boolean}
 */
export function isAc5eActive() {
    return Boolean(game.modules.get(AC5E_ID)?.active);
}

/**
 * Whether Automated Masteries 5e is active. It automates all eight weapon masteries
 * (including Sap, Slow, Graze and Cleave) on its own.
 * @returns {boolean}
 */
export function isWm5eActive() {
    return Boolean(game.modules.get(WM5E_ID)?.active);
}

/**
 * Whether midi-qol is installed and enabled in this world.
 * @returns {boolean}
 */
export function isMidiActive() {
    return Boolean(game.modules.get(MIDI_ID)?.active);
}

/**
 * Read midi-qol's live configuration settings object.
 * Prefers the live object exposed by midi's API and falls back to the stored world setting.
 * @returns {object|null}  The settings object, or null when midi-qol is inactive or unreadable.
 */
export function getMidiSettings() {
    if (!isMidiActive()) return null;
    try {
        return globalThis.MidiQOL?.configSettings?.() ?? game.settings.get(MIDI_ID, "ConfigSettings") ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether midi-qol automatically applies damage to targets ("Yes", "Yes + damage card", ...).
 * @returns {boolean}
 */
export function midiAutoAppliesDamage() {
    const value = getMidiSettings()?.autoApplyDamage;
    return typeof value === "string" && value.toLowerCase().startsWith("yes");
}

/**
 * Whether midi-qol automatically applies item Active Effects to targets.
 * @returns {boolean}
 */
export function midiAppliesItemEffects() {
    const value = getMidiSettings()?.autoItemEffects;
    return Boolean(value) && value !== "off" && value !== "none";
}

/**
 * Whether midi-qol rolls concentration saves itself when a concentrating actor takes damage.
 * "chatOnly" is dnd5e's default prompt passed through unchanged, so it does not count.
 * @returns {boolean}
 */
export function midiHandlesConcentration() {
    const value = getMidiSettings()?.doConcentrationCheck;
    return value === "chat" || value === "item";
}

/**
 * Whether midi-qol ends concentration itself when a concentration save made through
 * `Actor5e#rollConcentration` fails. midi skips this in its "item" mode, where the
 * concentration check item's own workflow handles the result.
 * @returns {boolean}
 */
export function midiEndsConcentrationOnFailure() {
    const settings = getMidiSettings();
    return Boolean(settings?.removeConcentration) && settings.doConcentrationCheck !== "item";
}

/**
 * Whether midi-qol applies a dead / unconscious status when a creature drops to 0 HP.
 * @returns {boolean}
 */
export function midiAppliesZeroHPStatus() {
    const value = getMidiSettings()?.addDead;
    return Boolean(value) && value !== "none";
}

/**
 * Whether midi-qol marks the combatant of a creature at 0 HP as defeated.
 * Mirrors midi's own split: characters, player-owned and important NPCs use the player setting.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function midiMarksDefeated(actor) {
    const settings = getMidiSettings();
    if (!settings || !midiAppliesZeroHPStatus()) return false;
    const isPlayerSide = actor?.type === "character" || actor?.hasPlayerOwner || actor?.system?.traits?.important;
    return Boolean(isPlayerSide ? settings.markPlayerDefeated : settings.markNonPlayerDefeated);
}

/**
 * Whether a chat message is a midi-qol workflow card or a roll midi-qol evaluated as part of a
 * workflow. Changing such a message after the fact does not update midi's results.
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function isMidiMessage(message) {
    if (!message || !isMidiActive()) return false;
    if (message.system?.midi) return true;
    const flags = message.flags?.[MIDI_ID];
    return Boolean(flags && typeof flags === "object" && Object.keys(flags).length);
}

/**
 * Resolve the midi-qol workflow attached to a roll process configuration, if any.
 * midi passes either the workflow itself or its id / item card uuid in `config.midiOptions`.
 * @param {object} config  Roll process configuration.
 * @returns {object|null}  The midi Workflow, or null.
 */
export function getMidiWorkflow(config) {
    if (!isMidiActive()) return null;
    const options = config?.midiOptions ?? {};
    const workflow = options.workflow ?? config?.workflow;
    if (workflow) return workflow;
    const id = options.workflowId ?? options.itemCardUuid;
    if (!id) return null;
    try {
        return globalThis.MidiQOL?.Workflow?.getWorkflow?.(id) ?? null;
    } catch {
        return null;
    }
}

/**
 * Resolve the item behind a midi-qol roll configuration: the workflow's item, or the item of
 * the workflow's chat card when the workflow is no longer in memory.
 * @param {object} config  Roll process configuration.
 * @returns {Item5e|null}
 */
export function getMidiSourceItem(config) {
    const workflow = getMidiWorkflow(config);
    const item = workflow?.saveActivity?.item ?? workflow?.item ?? workflow?.activity?.item;
    if (item) return item;
    const cardUuid = config?.midiOptions?.itemCardUuid;
    if (!cardUuid) return null;
    try {
        return fromUuidSync(cardUuid)?.getAssociatedItem?.() ?? null;
    } catch {
        return null;
    }
}
