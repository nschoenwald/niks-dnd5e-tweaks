/**
 * Feature: Players Roll Their Own Saves
 * Description: The Save and Check buttons of an activity's chat card roll only for the clicking user's side: the GM
 *              skips player characters whose player is online (marked on the card), and players never roll for a
 *              token that isn't a target.
 *
 * @introduced v14.93.0
 */
import { debug, getSetting, isFeatureActive } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isMidiActive } from "../../utils/module-compat.js";

/*
 * dnd5e (6.0.6 and 6.1.0): the Save / Check buttons of a usage card (`SaveActivity.#rollSave`,
 * `CheckActivity.#rollCheck`) roll for `UsageMessageData#evaluatedTargets`, which keeps every checked target the
 * clicking user owns. The GM owns everything, so a Fireball on a mixed group opens a roll dialog for every PC too.
 * Players only roll for their own tokens, but when none of their tokens is a target dnd5e falls back to the tokens they
 * have selected, so a player outside the area can roll by mistake.
 *
 * Both handlers are private, so the feature wraps their shared entry point `Activity#onChatAction` (also used by the
 * grouped-button context menu) and, while one of these actions runs for a card, the `evaluatedTargets` getter of that
 * card. dnd5e's own "Selected" target mode is left alone: it is the way to roll for anyone anyway.
 */

/** Chat card actions that roll for the card's targets. */
const ROLL_ACTIONS = new Set(["rollSave", "rollCheck"]);

/** Activity types whose buttons use those actions. */
const ACTIVITY_TYPES = ["save", "check"];

const GETTER_TARGET = "dnd5e.dataModels.chatMessage.UsageMessageData.prototype.evaluatedTargets#get";

/** Ids of usage messages whose roll action is running on this client (their getter skips player-rolled targets). */
const _filtering = new Set();

/**
 * Whether the feature should act for this user. midi-qol runs its own save workflow.
 * @returns {boolean}
 */
function _isActive() {
    return isFeatureActive("enablePlayersRollOwnSaves", "clientEnablePlayersRollOwnSaves") && !isMidiActive();
}

/**
 * The actor behind a target entry (TokenDocument, Token or Actor).
 * @param {TokenDocument|Token|Actor} target
 * @returns {Actor|null}
 */
function _actorOf(target) {
    if (!target) return null;
    return target instanceof Actor ? target : (target.actor ?? null);
}

/**
 * Whether a player rolls for this actor rather than the GM: a non-GM user owns it and, unless the GM also rolls for
 * offline players is off, is logged in.
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isPlayerRolled(actor) {
    if (!actor) return false;
    const offlineToGm = getSetting("playersRollOwnSavesOffline") !== false;
    return game.users.some(user => !user.isGM && (user.active || !offlineToGm)
        && actor.testUserPermission(user, "OWNER"));
}

/**
 * The card's targets, resolved, with their checked state on this client.
 * @param {ChatMessage} message  A usage message.
 * @returns {{actor: Actor|null, token: Token|null, name: string, checked: boolean}[]}
 */
function _resolveTargets(message) {
    const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
    const checked = message._targetState?.checked;
    return (message.system?.targets ?? []).map(descriptor => {
        const { actor, token } = TargetsField.resolve(descriptor);
        return {
            actor: actor ?? null,
            token: token ?? null,
            name: token?.name ?? descriptor.name ?? actor?.name ?? "",
            checked: checked?.get(descriptor.token) !== false
        };
    });
}

/**
 * Join names for a notification ("A, B and C").
 * @param {string[]} names
 * @returns {string}
 */
function _formatNames(names) {
    const unique = [...new Set(names)];
    try {
        return new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(unique);
    } catch {
        return unique.join(", ");
    }
}

/* -------------------------------------------- */
/*  Roll actions                                */
/* -------------------------------------------- */

/**
 * Wrapper for Activity#onChatAction of save and check activities.
 * @this {Activity}
 * @param {Function} wrapped
 * @param {PointerEvent} event
 * @param {HTMLElement} target
 * @param {ChatMessage} message
 * @returns {Promise<void>}
 */
async function _onChatAction(wrapped, event, target, message, ...rest) {
    const action = target?.dataset?.action ?? message?.system?.getButton?.(target)?.action;
    if (!ROLL_ACTIONS.has(action) || !message || !_isActive()) return wrapped(event, target, message, ...rest);
    // Only the card's recorded targets are changed; "Selected" mode (or no mode yet) works as in dnd5e
    if (message._targetState?.mode !== "targeted") return wrapped(event, target, message, ...rest);

    const targets = _resolveTargets(message);
    if (!targets.length) return wrapped(event, target, message, ...rest);

    if (!game.user.isGM) {
        // dnd5e would roll for the player's selected tokens when none of their tokens is a target
        if (targets.some(t => t.actor?.isOwner)) return wrapped(event, target, message, ...rest);
        ui.notifications.warn(game.i18n.localize("ND5T.PlayersRollOwnSaves.NotTargeted"));
        debug("Players Roll Their Own Saves | Blocked roll: none of the player's tokens is a target");
        return;
    }

    const checked = targets.filter(t => t.checked && t.actor);
    const playerRolled = checked.filter(t => isPlayerRolled(t.actor));
    const gmRolled = checked.filter(t => !isPlayerRolled(t.actor));

    if (playerRolled.length && !gmRolled.length) {
        ui.notifications.info(game.i18n.format("ND5T.PlayersRollOwnSaves.AllPlayers", {
            names: _formatNames(playerRolled.map(t => t.name))
        }));
        return;
    }
    if (playerRolled.length) {
        ui.notifications.info(game.i18n.format("ND5T.PlayersRollOwnSaves.Skipped", {
            names: _formatNames(playerRolled.map(t => t.name))
        }));
    }

    _filtering.add(message.id);
    try {
        return await wrapped(event, target, message, ...rest);
    } finally {
        _filtering.delete(message.id);
    }
}

/**
 * Wrapper for the UsageMessageData#evaluatedTargets getter: while this client runs a roll action of the card, the
 * GM's list leaves out player-rolled targets.
 * @this {UsageMessageData}
 * @param {Function} wrapped
 * @returns {(TokenDocument|Actor)[]|void}
 */
function _evaluatedTargets(wrapped) {
    const result = wrapped();
    if (!Array.isArray(result) || !_filtering.has(this.parent?.id)) return result;
    if (this.parent._targetState?.mode !== "targeted") return result;
    return result.filter(t => !isPlayerRolled(_actorOf(t)));
}

/* -------------------------------------------- */
/*  "Player rolls" marker                       */
/* -------------------------------------------- */

/**
 * Whether a usage card has a Save or Check button.
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function _hasRollButton(message) {
    return (message?.system?.buttons ?? []).some(b => ROLL_ACTIONS.has(b.action));
}

/**
 * Mark the target pills of player-rolled targets in a card's target list (GM only).
 * @param {HTMLElement} element  The card's recorded-targets element.
 */
function _markPills(element) {
    const message = element.chatMessage ?? game.messages.get(element.closest("[data-message-id]")?.dataset.messageId);
    const show = game.user.isGM && _isActive() && _hasRollButton(message) && (element.targetingMode === "targeted");
    const label = game.i18n.localize("ND5T.PlayersRollOwnSaves.PillTooltip");
    for (const pill of element.querySelectorAll("target-pill")) {
        const uuids = Array.from(pill.querySelectorAll("option"), o => o.value);
        const mark = show && (uuids.length > 0)
            && uuids.every(uuid => isPlayerRolled(fromUuidSync(uuid, { strict: false })?.actor));
        pill.toggleAttribute("data-nd5t-player-rolls", mark);
        let icon = pill.querySelector(":scope > .nd5t-player-rolls-icon");
        if (mark && !icon) {
            icon = document.createElement("i");
            icon.className = "fa-solid fa-user nd5t-player-rolls-icon";
            icon.inert = true;
            pill.prepend(icon);
        } else if (!mark) icon?.remove();
        if (mark) pill.dataset.tooltip = label;
        else if (pill.dataset.tooltip === label) delete pill.dataset.tooltip;
    }
}

/**
 * The target list on the card face (not the ones inside the damage / effect trays).
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
function _cardTargetLists(root) {
    return Array.from(root?.querySelectorAll?.("recorded-targets") ?? [])
        .filter(el => !el.closest("damage-application, effect-application, enchantment-application"));
}

/**
 * dnd5e.renderChatMessage: watch the card's target list and mark it.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function _onRenderChatMessage(message, html) {
    if (!game.user.isGM || !_hasRollButton(message)) return;
    for (const list of _cardTargetLists(html)) {
        if (!list._nd5tPlayerRollsWatched) {
            list._nd5tPlayerRollsWatched = true;
            list.addEventListener("recorded-targets:build", () => _markPills(list));
        }
        if (list.targetList) _markPills(list);
    }
}

/**
 * Re-mark every visible card, e.g. when a player logs in or out.
 */
function _refreshAllMarks() {
    if (!game.user.isGM) return;
    const lists = foundry.applications.detached?.querySelectorAll?.("recorded-targets")
        ?? document.querySelectorAll("recorded-targets");
    for (const list of lists) {
        if (list.closest("damage-application, effect-application, enchantment-application")) continue;
        if (list.targetList) _markPills(list);
    }
}

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

/**
 * Register the patches and hooks. Called once during the "setup" phase from main.js.
 */
export function initPlayersRollOwnSaves() {
    for (const type of ACTIVITY_TYPES) {
        const cls = CONFIG.DND5E.activityTypes?.[type]?.documentClass;
        if (typeof cls?.prototype?.onChatAction !== "function") continue;
        patchMethod(`CONFIG.DND5E.activityTypes.${type}.documentClass.prototype.onChatAction`, _onChatAction, "MIXED");
    }
    patchMethod(GETTER_TARGET, _evaluatedTargets, "WRAPPER");

    Hooks.on("dnd5e.renderChatMessage", _onRenderChatMessage);
    Hooks.on("userConnected", () => _refreshAllMarks());
    debug("Players Roll Their Own Saves | Initialized");
}

/**
 * Re-mark the visible cards after one of the feature's settings changed.
 */
export function refreshPlayersRollOwnSavesMarks() {
    _refreshAllMarks();
}
