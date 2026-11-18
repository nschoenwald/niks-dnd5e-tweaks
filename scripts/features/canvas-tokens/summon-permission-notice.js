/**
 * Feature: Summoning Permission Notice
 * Description: When a player uses a summoning activity but isn't allowed to summon, a chat message whispered to the
 *              player and the GMs names what is missing and where to change it. At most once per day per player.
 *
 * @introduced v14.103.0
 */
import { MODULE_ID, debug, getSetting } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * How it works
 *
 * What a player needs to summon (dnd5e 6.0.6 and 6.1.0):
 *  - `SummonActivity#canSummon`: the core permission "Create Tokens" (TOKEN_CREATE) and the dnd5e world setting
 *    "Allow Summoning". Without them dnd5e silently leaves the summon option out of the usage dialog and hides the
 *    card's "Place Summons" button.
 *  - `Actor5e.fetchExisting`: "Create Actors" (ACTOR_CREATE) when the creature has to be imported from a compendium
 *    (or a linked world actor copied) and no earlier imported copy exists. dnd5e throws
 *    `DND5E.ACTOR.Warning.CreateActor`.
 *  - `SummonActivity#placeSummons`: ownership of the world actor to summon (`DND5E.SUMMON.Warning.NoOwnership`).
 *
 * Detection: `dnd5e.postUseActivity` for a summon activity with available profiles while `canSummon` is false (only
 * on a scene, where dnd5e would otherwise offer it); a wrapper around `placeSummons` for the two errors, which it
 * rethrows so dnd5e still shows its own error. GMs are never notified about themselves.
 *
 * Once per day: the local date of the last notice is stored on the player's own User
 * (`flags.niks-dnd5e-tweaks.summonPermissionNotice`; players may update their own User's flags). Without the
 * "Whisper Messages" permission the message can't be sent, and a notification is shown instead.
 */

const FLAG = "summonPermissionNotice";

function _active() {
    try {
        return Boolean(getSetting("enableSummonPermissionNotice"));
    } catch {
        return false;
    }
}

/** @returns {string} Today's local date, YYYY-MM-DD. */
function _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** @returns {string} The localized name of the current user's role. */
function _roleLabel() {
    const name = CONST.USER_ROLE_NAMES?.[game.user.role] ?? "PLAYER";
    return game.i18n.localize(`USER.Role${name.titleCase()}`);
}

/**
 * A missing core permission, localized.
 * @param {string} key  Key of CONST.USER_PERMISSIONS.
 * @returns {string}
 */
function _permissionEntry(key) {
    const label = game.i18n.localize(CONST.USER_PERMISSIONS[key]?.label ?? key);
    return game.i18n.format("ND5T.SummonPermission.CorePermission", {
        permission: `<strong>${label}</strong>`,
        role: _roleLabel(),
        where: game.i18n.localize("PERMISSION.Configure")
    });
}

/**
 * What the current user lacks for dnd5e's own summon check.
 * @returns {string[]} HTML list entries.
 */
function _missingForCanSummon() {
    const missing = [];
    if (!game.settings.get("dnd5e", "allowSummoning")) {
        const label = game.i18n.localize("SETTINGS.DND5E.PERMISSIONS.AllowSummoning.Name");
        missing.push(game.i18n.format("ND5T.SummonPermission.SystemSetting", {
            setting: `<strong>${label}</strong>`,
            system: game.system.title
        }));
    }
    if (!game.user.can("TOKEN_CREATE")) missing.push(_permissionEntry("TOKEN_CREATE"));
    return missing;
}

/**
 * Post the notice, unless this player already got one today.
 * @param {Item5e|null} item  The summoning item.
 * @param {string[]} missing  HTML list entries.
 */
async function _notify(item, missing) {
    if (!missing.length || game.user.isGM || !_active()) return;
    const today = _today();
    if (game.user.getFlag(MODULE_ID, FLAG) === today) return;
    await game.user.setFlag(MODULE_ID, FLAG, today);

    const escape = foundry.utils.escapeHTML;
    const intro = game.i18n.format("ND5T.SummonPermission.Intro", {
        user: `<strong>${escape(game.user.name)}</strong>`,
        item: `<strong>${escape(item?.name ?? "")}</strong>`
    });
    const content = `<p>${intro}</p><ul>${missing.map(m => `<li>${m}</li>`).join("")}</ul>`
        + `<p>${game.i18n.localize("ND5T.SummonPermission.Footer")}</p>`;

    if (!game.user.can("MESSAGE_WHISPER")) {
        ui.notifications.warn(`${intro} ${missing.map(m => m.replace(/<[^>]+>/g, "")).join(" ")}`, { permanent: true });
        return;
    }
    const whisper = [game.user.id, ...game.users.filter(u => u.isGM).map(u => u.id)];
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: item?.actor ?? null }),
        content,
        whisper
    });
    debug(`Summoning Permission Notice | ${game.user.name} can't summon with ${item?.name}`);
}

/**
 * dnd5e.postUseActivity: a summon activity used while dnd5e doesn't let this user summon.
 * @param {Activity} activity
 */
function _onPostUseActivity(activity) {
    try {
        if ((activity?.type !== "summon") || game.user.isGM || !_active()) return;
        if (activity.canSummon || !canvas.scene || !activity.availableProfiles?.length) return;
        void _notify(activity.item, _missingForCanSummon()).catch(err =>
            console.error(`${MODULE_ID} | Summoning Permission Notice failed`, err));
    } catch (err) {
        console.error(`${MODULE_ID} | Summoning Permission Notice failed`, err);
    }
}

/**
 * Wrapper for `SummonActivity#placeSummons`: name the missing permission when dnd5e refuses to import or use the
 * creature. The error is rethrown.
 * @this {SummonActivity}
 */
async function _wrapPlaceSummons(wrapped, ...args) {
    try {
        return await wrapped(...args);
    } catch (err) {
        try {
            const message = err?.message ?? "";
            let entry = null;
            if (!game.user.can("ACTOR_CREATE") && (message === game.i18n.localize("DND5E.ACTOR.Warning.CreateActor"))) {
                entry = _permissionEntry("ACTOR_CREATE");
            } else {
                const ownership = game.i18n.localize("DND5E.SUMMON.Warning.NoOwnership").split("{actor}");
                if ((ownership.length === 2) && message.startsWith(ownership[0]) && message.endsWith(ownership[1])) {
                    const actor = message.slice(ownership[0].length, message.length - ownership[1].length);
                    entry = game.i18n.format("ND5T.SummonPermission.Ownership", {
                        actor: `<strong>${foundry.utils.escapeHTML(actor)}</strong>`
                    });
                }
            }
            if (entry) await _notify(this.item, [entry]);
        } catch (notifyErr) {
            console.error(`${MODULE_ID} | Summoning Permission Notice failed`, notifyErr);
        }
        throw err;
    }
}

/**
 * Initialize the notice. Called once during the "setup" phase from main.js.
 */
export function initSummonPermissionNotice() {
    Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
    patchMethod("dnd5e.documents.activity.SummonActivity.prototype.placeSummons", _wrapPlaceSummons, "WRAPPER");
    debug("Summoning Permission Notice | Initialized");
}
