/**
 * Feature: Self-Targeted Activities Target Self
 * Description: When an activity that affects "Self" is used, its chat cards record the user's own token as the target
 *              instead of whatever the user still had targeted (e.g. an enemy from the previous attack).
 *
 * @introduced v14.73.0
 */
import { debug, getSetting, isFeatureActive } from "../../context.js";
import { isMidiActive } from "../../utils/module-compat.js";

/**
 * Self-Target Correction
 *
 * dnd5e stores `game.user.targets` on every activity chat card (`system.targets`), without checking the activity's
 * `target.affects.type`. A player who still has an enemy targeted and uses Second Wind or a self-buff therefore gets
 * a card that lists the enemy, and the "Targeted" mode of the damage / healing and effect trays (which reads
 * `chatMessage.system.targets`) points at the enemy.
 *
 * This feature rewrites the recorded targets of self-affecting activities to the actor's own token:
 *  - the usage card (`dnd5e.preUseActivity`, `messageConfig.data.system.targets`)
 *  - the damage / healing roll card (`dnd5e.preRollDamageV2`)
 *  - the formula roll card of utility activities (`dnd5e.preRollFormulaV2`)
 *
 * The user's own targets (`game.user.targets`) are left alone, so they can go straight back to attacking.
 * Attack rolls are not touched: dnd5e reads the targets for the hit check directly from the user.
 * When the actor has no token on the viewed scene, the cards record no targets.
 *
 * Bypassed while midi-qol is active: its workflow already swaps the targets of self activities for the actor's token.
 */

/** Usage configs whose targets were replaced, for the notification after the activity was actually used. */
const _replacedTargets = new WeakMap();

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the feature. Called once during "setup" from main.js.
 */
export function initSelfTargetCorrection() {
    Hooks.on("dnd5e.preUseActivity", _onPreUseActivity);
    Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
    Hooks.on("dnd5e.preRollDamageV2", _onPreRoll);
    Hooks.on("dnd5e.preRollFormulaV2", _onPreRoll);
}

// ── Hook handlers ────────────────────────────────────────────────────

/**
 * Rewrite the targets of the usage card.
 * @param {Activity} activity                         Activity being used (a clone).
 * @param {ActivityUseConfiguration} usageConfig      Usage configuration.
 * @param {ActivityDialogConfiguration} dialogConfig  Dialog configuration.
 * @param {ActivityMessageConfiguration} messageConfig  Message configuration.
 */
function _onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
    const replaced = _correctTargets(activity, messageConfig);
    if (replaced?.length) _replacedTargets.set(usageConfig, replaced);
}

/**
 * Tell the user that their targets were replaced, once the activity was actually used (not cancelled in its dialog).
 * @param {Activity} activity                     Activity that was used.
 * @param {ActivityUseConfiguration} usageConfig  Usage configuration.
 */
function _onPostUseActivity(activity, usageConfig) {
    const replaced = _replacedTargets.get(usageConfig);
    if (!replaced) return;
    _replacedTargets.delete(usageConfig);
    if (!getSetting("selfTargetCorrectionNotify")) return;
    ui.notifications.info(`${activity.item?.name ?? activity.name} only affects its user: `
        + `targeting ${activity.actor?.name ?? "yourself"} instead of ${_formatNames(replaced)}.`);
}

/**
 * Rewrite the targets of a damage / healing or formula roll card.
 * @param {BasicRollProcessConfiguration} config   Roll configuration (`subject` is the activity).
 * @param {BasicRollDialogConfiguration} dialog    Dialog configuration.
 * @param {BasicRollMessageConfiguration} message  Message configuration.
 */
function _onPreRoll(config, dialog, message) {
    _correctTargets(config?.subject, message);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Replace the recorded targets of a message config with the activity's own token.
 * @param {Activity} activity
 * @param {object} messageConfig  Message configuration with `data.system.targets`.
 * @returns {string[]|null}  Names of the targets that were replaced (empty when the user had none or only their own
 *                           token), or null when nothing was changed.
 */
function _correctTargets(activity, messageConfig) {
    if (activity?.target?.affects?.type !== "self") return null;
    const system = messageConfig?.data?.system;
    if (!Array.isArray(system?.targets)) return null;
    if (!isFeatureActive("enableSelfTargetCorrection", "clientEnableSelfTargetCorrection")) return null;
    if (isMidiActive()) return null;

    const actor = activity.actor;
    if (!actor) return null;
    const token = _findOwnToken(actor);
    const selfTargets = token ? _describe(token) : [];

    const ownUuid = token?.document.uuid;
    const replaced = system.targets.filter(t => !ownUuid || (t.token !== ownUuid)).map(t => t.name ?? "?");
    system.targets = selfTargets;
    debug(`Self-Target Correction: ${activity.item?.name} records ${token?.name ?? "no token"}`
        + (replaced.length ? ` instead of ${replaced.join(", ")}` : ""));
    return replaced;
}

/**
 * The actor's token on the viewed scene: its own token for unlinked actors, a controlled one, or the first active one.
 * @param {Actor5e} actor
 * @returns {Token5e|null}
 */
function _findOwnToken(actor) {
    const own = actor.token?.object;
    if (own && (own.document.parent === canvas?.scene)) return own;
    const controlled = canvas?.tokens?.controlled?.find(t => t.actor === actor);
    return controlled ?? actor.getActiveTokens()[0] ?? null;
}

/**
 * Describe a token for `system.targets`, the same way dnd5e does.
 * @param {Token5e} token
 * @returns {object[]}
 */
function _describe(token) {
    const TargetsField = dnd5e.dataModels?.chatMessage?.fields?.TargetsField;
    if (TargetsField?.getDescriptors) return TargetsField.getDescriptors([token]);
    // Fallback with the descriptor shape of dnd5e 6.0 / 6.1.
    const document = token.document;
    const actor = document.actor;
    const ac = actor.statuses.has("coverTotal") ? null : actor.system.attributes?.ac?.value;
    return [{ actor: actor.uuid, ac: ac ?? null, img: document.texture?.src, name: document.name, token: document.uuid }];
}

/**
 * Join target names for the notification.
 * @param {string[]} names
 * @returns {string}
 */
function _formatNames(names) {
    const unique = [...new Set(names)];
    if (unique.length <= 3) return game.i18n.getListFormatter().format(unique);
    return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}
