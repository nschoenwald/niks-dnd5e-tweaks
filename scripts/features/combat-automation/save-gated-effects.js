/**
 * Feature: Effects Only on Failed Saves
 * Description: The effect tray of a Save activity's chat card skips targets that succeeded on the save, unless the
 *              effect has the activity's "Always Apply" option set (e.g. Faerie Fire only outlines creatures that
 *              failed their Dexterity save).
 *
 * @introduced v14.91.0
 */
import { MODULE_ID, debug, getSetting } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";

/*
 * dnd5e (6.0.6 and 6.1.0) stores the per-effect "Always Apply" option of Save activities (`effects[].onSave`) and
 * records each target's save result (`UsageMessageData#outcomes`), but the effect tray's Apply button
 * (`EffectApplicationElement#_onApplyEffects`) never reads either: it applies every checked effect to every target.
 * The only built-in help is the manual "Select Failures" button.
 *
 * Its target list (`#getTargets`) is private and `_prepareEffectData` only receives the actor, so a plain wrapper
 * can't skip single target/effect pairs. When at least one target saved against a checked effect without
 * "Always Apply", this MIXED handler runs its own copy of the apply loop (same code in 6.0.6 and 6.1.0) with the
 * save check added. Every other click goes to dnd5e's method unchanged.
 */

const TARGET = "dnd5e.applications.components.EffectApplicationElement.prototype._onApplyEffects";

let _patched = false;

/**
 * Register the effect tray patch. Called once during the "setup" phase from main.js.
 */
export function initSaveGatedEffects() {
    const applyPatch = () => {
        if (_patched) return;
        _patched = true;
        patchMethod(TARGET, _onApplyEffects, "MIXED");
        debug("Effects Only on Failed Saves | Patched EffectApplicationElement#_onApplyEffects");
    };
    if (foundry.utils.getProperty(globalThis, TARGET)) applyPatch();
    else customElements.whenDefined("effect-application").then(applyPatch);
}

/**
 * Whether the feature should act. midi-qol applies a save activity's effects to failed saves itself.
 * @returns {boolean}
 */
function _isActive() {
    return Boolean(getSetting("enableSaveGatedEffects")) && !isMidiActive();
}

/**
 * Wrapper for EffectApplicationElement#_onApplyEffects.
 * @this {EffectApplicationElement}
 * @param {Function} wrapped
 * @returns {Promise<void>}
 */
async function _onApplyEffects(wrapped, ...args) {
    if (!_isActive()) return wrapped(...args);

    let plan;
    try {
        plan = await _buildPlan(this);
    } catch (err) {
        console.warn(`${MODULE_ID} | Effects Only on Failed Saves: could not read the save results`, err);
        return wrapped(...args);
    }
    // Nobody saved against a gated effect: dnd5e's own method does exactly the right thing.
    if (!plan) return wrapped(...args);

    const operations = [];
    for (const { actor, effects } of plan.targets) {
        const data = [];
        const updates = [];
        for (const effect of effects) {
            try {
                const operation = await this._prepareEffectData(effect, actor);
                (operation.action === "create" ? data : updates).push(operation.data);
            } catch (err) {
                Hooks.onError("EffectApplicationElement._prepareEffectData", err, { notify: "warn", log: "warn" });
            }
        }
        if (data.length) operations.push({ data, action: "create", documentName: "ActiveEffect", parent: actor });
        if (updates.length) operations.push({ updates, action: "update", documentName: "ActiveEffect", parent: actor });
    }
    if (operations.length) await foundry.documents.modifyBatch(operations);

    _notifySkipped(plan.skipped);

    if (game.settings.get("dnd5e", "autoCollapseChatTrays") !== "manual") {
        this.querySelector(".collapsible")?.dispatchEvent(new PointerEvent("click", { bubbles: true, cancelable: true }));
    }
}

/**
 * Work out which checked effects go to which target.
 * @param {EffectApplicationElement} tray
 * @returns {Promise<{targets: {actor: Actor5e, effects: ActiveEffect5e[]}[], skipped: Map<string, string[]>}|null>}
 *   Null when no target that saved would receive a gated effect.
 */
async function _buildPlan(tray) {
    const message = tray.chatMessage;
    const activity = message?.getAssociatedActivity?.();
    const outcomes = message?.system?.outcomes;
    if (!activity || !(outcomes instanceof Map) || !outcomes.size) return null;

    const checked = tray.effects.filter(e => tray.effectChecked(e.uuid));
    const gated = new Set(checked.filter(e => _isGated(activity, e)));
    if (!gated.size) return null;

    // Save results are keyed by token UUID. Targets recorded without a token use the actor UUID instead.
    const successByActor = new Set();
    for (const [uuid, outcome] of outcomes) {
        if (outcome !== "success") continue;
        const actorUuid = fromUuidSync(uuid)?.actor?.uuid;
        if (actorUuid) successByActor.add(actorUuid);
    }
    const saved = (uuid, actor) => (outcomes.get(uuid) === "success") || successByActor.has(actor.uuid);

    const targets = [];
    const skipped = new Map();
    let anySkipped = false;
    for (const uuid of _getTargets(tray)) {
        const doc = await fromUuid(uuid);
        const actor = doc?.actor ?? doc;
        if (!actor?.isOwner) continue;
        let effects = checked;
        if (saved(uuid, actor)) {
            effects = checked.filter(e => !gated.has(e));
            anySkipped = true;
            for (const effect of gated) {
                if (!skipped.has(effect.name)) skipped.set(effect.name, []);
                skipped.get(effect.name).push(doc?.name ?? actor.name);
            }
        }
        targets.push({ actor, effects });
    }
    return anySkipped ? { targets, skipped } : null;
}

/**
 * Whether an effect only applies on a failed save: it is listed on a Save activity (which has the `onSave` option)
 * and "Always Apply" is off.
 * @param {Activity} activity
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _isGated(activity, effect) {
    const entry = activity.effects?.find?.(e => e?._id === effect.id);
    return Boolean(entry) && ("onSave" in entry) && !entry.onSave;
}

/**
 * Same target lookup as dnd5e's private EffectApplicationElement#getTargets.
 * @param {EffectApplicationElement} tray
 * @returns {string[]}
 */
function _getTargets(tray) {
    const recordedTargets = tray.targetList ?? tray.closest("[data-message-id]")?.querySelector("recorded-targets");
    if (recordedTargets) return recordedTargets.targets;
    return canvas.tokens?.controlled?.map(t => (t.actor ? t.document.uuid : null)).filter(_ => _) ?? [];
}

/**
 * Tell the user which targets didn't get an effect because they saved.
 * @param {Map<string, string[]>} skipped  Effect name → names of the targets that saved.
 */
function _notifySkipped(skipped) {
    const list = new Intl.ListFormat(game.i18n.lang, { type: "conjunction" });
    for (const [effect, names] of skipped) {
        ui.notifications.info(game.i18n.format("ND5T.SaveGatedEffects.Skipped", { effect, targets: list.format(names) }));
    }
}
