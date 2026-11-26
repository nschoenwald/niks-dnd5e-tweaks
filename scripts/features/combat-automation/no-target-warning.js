/**
 * Feature: No-Target Warning
 * Description: Warns in the attack and damage / healing roll dialogs when nothing is targeted. Targeting a token while
 *              the dialog is open removes the warning, and the roll then uses that target. When the dialog is
 *              skipped, a notification (or, by personal choice, a confirmation) takes its place.
 *
 * @introduced v14.115.0
 */
import { MODULE_ID, debug, getSetting, isFeatureActive } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";

/**
 * No-Target Warning
 *
 * dnd5e reads the user's targets before the roll dialog opens: `AttackActivity#rollAttack` takes the AC of a single
 * target as the hit check (`config.target` → `roll.options.target`) and both attack and damage rolls store the targets
 * in the chat card (`message.data.system.targets`). Targeting a token while the dialog is open therefore changed
 * nothing. This feature:
 *  - adds a warning line to the top of the attack and damage / healing dialogs while the roll has no target, kept up
 *    to date through the `targetToken` hook;
 *  - after the dialog (`dnd5e.post{Attack,Damage}RollConfiguration`), replaces the card's targets and the hit check
 *    with the user's current targets, when the ones captured came from the user's targets and they changed since;
 *  - when the dialog is skipped, shows a notification or asks "Roll anyway / Cancel" (wrapper on
 *    `BasicRoll.buildConfigure`, since hooks can't wait for a dialog). The confirmation only appears for rolls the user
 *    started with a click; damage rolled by automation (e.g. Auto-Roll Attack Damage) only gets the notification.
 *
 * Skipped: activities that affect Self, rolls without an activity (enricher links), and depending on the scene
 * setting scenes without tokens or rolls outside combat.
 *
 * midi-qol: its workflow takes the targets when the activity is used, so the targets aren't refreshed after the
 * dialog, the warning doesn't promise that, and the confirmation is never shown (midi has "Requires Targets").
 */

/** Open attack / damage dialogs that this feature watches. */
const _openDialogs = new Set();

/**
 * Per roll (keyed by its message config object): the targets the dialog opened with.
 * @type {WeakMap<object, {fromUser: boolean, openedTarget: number|undefined}>}
 */
const _states = new WeakMap();

const BANNER_CLASS = "nd5t-no-target-banner";

// ── Checks ────────────────────────────────────────────────────────────

/** @returns {boolean} */
function _active() {
    return isFeatureActive("enableNoTargetWarning", "clientEnableNoTargetWarning");
}

/** @returns {Function|undefined} dnd5e's TargetsField class */
function _targetsField() {
    return dnd5e?.dataModels?.chatMessage?.fields?.TargetsField;
}

/**
 * Which kind of roll this is, or null when it shouldn't be warned about.
 * @param {object} config  The roll process configuration.
 * @returns {"attack"|"damage"|"healing"|null}
 */
function _rollKind(config) {
    const activity = config?.subject;
    if (!activity?.item || !activity.type) return null;
    if (activity.target?.affects?.type === "self") return null;
    const hooks = config.hookNames ?? [];
    let kind = null;
    if (hooks.includes("attack")) kind = "attack";
    else if (hooks.includes("damage")) kind = (activity.type === "heal") ? "healing" : "damage";
    if (!kind) return null;
    const setting = { attack: "noTargetWarningAttack", damage: "noTargetWarningDamage", healing: "noTargetWarningHealing" }[kind];
    return getSetting(setting) ? kind : null;
}

/** @returns {boolean} Whether the scene setting allows a warning right now. */
function _sceneAllows() {
    switch (getSetting("noTargetWarningScene")) {
        case "always": return true;
        case "combat": return Boolean(game.combat?.started);
        default: return (canvas?.scene?.tokens?.size ?? 0) > 0;
    }
}

/**
 * The targets the roll's chat card will record.
 * @param {object} message  The roll message configuration.
 * @returns {object[]}
 */
function _cardTargets(message) {
    const targets = foundry.utils.getProperty(message ?? {}, "data.system.targets");
    return Array.isArray(targets) ? targets : [];
}

/** @returns {string[]} The token uuids the user has targeted. */
function _userTargetUuids() {
    return Array.from(game.user.targets ?? [], t => t.document?.uuid).filter(Boolean);
}

/**
 * Do both lists name the same tokens?
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function _sameTokens(a, b) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every(uuid => set.has(uuid));
}

/**
 * Will the roll have a target, given what the user has targeted now?
 * @param {object} message  The roll message configuration.
 * @returns {boolean}
 */
function _hasTarget(message) {
    const state = _states.get(message);
    if (state?.fromUser && !isMidiActive()) return (game.user.targets?.size ?? 0) > 0;
    return _cardTargets(message).length > 0;
}

// ── Dialog banner ─────────────────────────────────────────────────────

/**
 * Show or hide the warning line in a dialog.
 * @param {RollConfigurationDialog} app
 */
function _updateBanner(app) {
    const content = app.element?.querySelector(".window-content");
    if (!content) return;
    const show = _active() && _sceneAllows() && !_hasTarget(app.message);
    let banner = content.querySelector(`:scope > .${BANNER_CLASS}`);
    if (!show) {
        banner?.remove();
        return;
    }
    if (banner) return;
    const key = isMidiActive() ? "ND5T.NoTargetWarning.DialogMidi" : "ND5T.NoTargetWarning.Dialog";
    banner = document.createElement("div");
    banner.className = BANNER_CLASS;
    banner.setAttribute("role", "status");
    banner.innerHTML = `<i class="fa-solid fa-crosshairs" inert></i><span>${foundry.utils.escapeHTML(game.i18n.localize(key))}</span>`;
    content.prepend(banner);
}

/**
 * renderRollConfigurationDialog: add the warning to attack and damage / healing dialogs, and note the targets the
 * dialog opened with.
 * @param {RollConfigurationDialog} app
 */
function _onRenderDialog(app) {
    try {
        if (!_active() || !_rollKind(app.config)) return;
        if (!_openDialogs.has(app)) {
            _openDialogs.add(app);
            const message = app.message;
            if (message && !_states.has(message)) {
                const card = _cardTargets(message).map(t => t.token).filter(Boolean);
                _states.set(message, {
                    fromUser: _sameTokens(card, _userTargetUuids()),
                    openedTarget: app.config.target
                });
            }
        }
        _updateBanner(app);
    } catch (err) {
        console.error(`${MODULE_ID} | No-Target Warning: dialog warning failed`, err);
    }
}

/**
 * closeRollConfigurationDialog: stop watching the dialog.
 * @param {RollConfigurationDialog} app
 */
function _onCloseDialog(app) {
    _openDialogs.delete(app);
}

/**
 * targetToken: update the warning of open dialogs when the user's targets change.
 * @param {User} user
 */
function _onTargetToken(user) {
    if (!_openDialogs.size || (user !== game.user)) return;
    for (const app of _openDialogs) {
        if (app.rendered) _updateBanner(app);
        else _openDialogs.delete(app);
    }
}

// ── Targets after the dialog ──────────────────────────────────────────

/**
 * dnd5e.postAttackRollConfiguration / dnd5e.postDamageRollConfiguration: when the targets captured before the dialog
 * were the user's and the user targeted differently while it was open, use the current ones.
 * @param {BasicRoll[]} rolls
 * @param {object} config
 * @param {object} dialog
 * @param {object} message
 */
function _onPostRollConfiguration(rolls, config, dialog, message) {
    try {
        const state = message ? _states.get(message) : null;
        if (!state?.fromUser || isMidiActive() || !rolls?.length) return;
        const TargetsField = _targetsField();
        if (!TargetsField?.getDescriptors) return;
        const current = TargetsField.getDescriptors();
        const card = _cardTargets(message);
        if (_sameTokens(card.map(t => t.token), current.map(t => t.token))) return;
        foundry.utils.setProperty(message, "data.system.targets", current);

        // The hit check, unless the caller set its own target (then it differs from what the dialog opened with)
        if ((config.hookNames ?? []).includes("attack") && (config.target === state.openedTarget)) {
            const ac = (current.length === 1) ? (current[0].ac ?? undefined) : undefined;
            config.target = ac;
            for (const roll of rolls) {
                for (const options of [roll.options, roll.d20?.options]) {
                    if (!options) continue;
                    if (ac === undefined) delete options.target;
                    else options.target = ac;
                }
            }
        }
        debug(`No-Target Warning | Targets updated after the dialog: ${current.map(t => t.name).join(", ") || "none"}`);
    } catch (err) {
        console.error(`${MODULE_ID} | No-Target Warning: updating the targets failed`, err);
    }
}

// ── Skipped dialog ────────────────────────────────────────────────────

/**
 * Ask whether to roll without a target.
 * @param {Item5e} item
 * @returns {Promise<boolean>}
 */
async function _confirm(item) {
    const answer = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("ND5T.NoTargetWarning.ConfirmTitle"), icon: "fa-solid fa-crosshairs" },
        content: `<p>${game.i18n.format("ND5T.NoTargetWarning.ConfirmContent", { item: foundry.utils.escapeHTML(item?.name ?? "") })}</p>`,
        yes: { label: game.i18n.localize("ND5T.NoTargetWarning.RollAnyway"), icon: "fa-solid fa-dice-d20", default: true },
        no: { label: game.i18n.localize("Cancel"), icon: "fa-solid fa-xmark" },
        rejectClose: false
    });
    return answer === true;
}

/**
 * Wrapper on BasicRoll.buildConfigure (static): after a roll whose dialog was skipped, warn when it has no target.
 * Returning no rolls is dnd5e's own "dialog cancelled" result.
 * @param {Function} wrapped
 * @param {object} config
 * @param {object} dialog
 * @param {object} message
 * @returns {Promise<BasicRoll[]>}
 */
async function _wrapBuildConfigure(wrapped, config = {}, dialog = {}, message = {}) {
    const rolls = await wrapped(config, dialog, message);
    try {
        if (!rolls?.length || (dialog?.configure !== false) || !_active()) return rolls;
        const kind = _rollKind(config);
        if (!kind || !_sceneAllows() || _cardTargets(message).length) return rolls;
        const item = config.subject.item;
        const mode = getSetting("noTargetWarningSkipped");
        if (mode === "none") return rolls;
        // Only rolls the user started with a click get the confirmation; automation and midi get the notification
        if ((mode === "confirm") && config.event?.isTrusted && !isMidiActive()) {
            if (await _confirm(item)) return rolls;
            debug(`No-Target Warning | ${item?.name}: roll cancelled, no target`);
            return [];
        }
        ui.notifications.warn(game.i18n.format("ND5T.NoTargetWarning.Notify", { item: item?.name ?? "" }));
    } catch (err) {
        console.error(`${MODULE_ID} | No-Target Warning: skipped-dialog warning failed`, err);
    }
    return rolls;
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the No-Target Warning. Called once during the "setup" phase from main.js.
 * Does nothing when the world setting is off (changing it reloads the game).
 */
export function initNoTargetWarning() {
    if (!getSetting("enableNoTargetWarning")) return;
    Hooks.on("renderRollConfigurationDialog", _onRenderDialog);
    Hooks.on("closeRollConfigurationDialog", _onCloseDialog);
    Hooks.on("targetToken", _onTargetToken);
    Hooks.on("dnd5e.postAttackRollConfiguration", _onPostRollConfiguration);
    Hooks.on("dnd5e.postDamageRollConfiguration", _onPostRollConfiguration);
    patchMethod("dnd5e.dice.BasicRoll.buildConfigure", _wrapBuildConfigure, "WRAPPER");
    document.body.classList.add("nd5t-no-target-warning");
    debug("No-Target Warning | Initialized");
}
