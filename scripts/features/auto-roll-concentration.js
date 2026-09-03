import { MODULE_ID, debug } from "../main.js";

/**
 * Auto-Roll Concentration Saves on Damage
 *
 * Automatically rolls a Constitution saving throw for concentration when a
 * concentrating token/actor takes damage. Also appends an "End Concentration"
 * button to concentration roll chat cards to allow manual removal.
 */

export function initAutoRollConcentration() {
    _patchChallengeConcentration();
    _patchRollConcentration();

    Hooks.on("preUpdateActor", _onPreUpdateActor);
    Hooks.on("dnd5e.damageActor", _onDamageActor);
    Hooks.on("dnd5e.preRollConcentration", _onPreRollConcentration);

    // Hook every concentration save — including manually triggered ones (clicking the system's
    // DC prompt card, or rolling directly from the character sheet) — so the "End Concentration"
    // button is added regardless of who or what initiated the roll.
    Hooks.on("dnd5e.rollConcentration", _onRollConcentration);

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const rootElement = html instanceof HTMLElement ? html : html[0];
        if (rootElement) _onRenderChatMessage(message, rootElement);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (html instanceof HTMLElement) _onRenderChatMessage(message, html);
    });

    debug("Auto-Roll Concentration | Initialized");
}

const BOON_OF_THE_IRON_MIND_REGEX = /.*boon.*of.*the.*iron.*mind.*/i;

/**
 * Determine whether an actor has the Boon of the Iron Mind feat.
 * Matches:
 *   - item.system.identifier or item.identifier matching /.*boon.*of.*the.*iron.*mind.* /i (case-insensitive)
 *   - item.name matching "Boon of the Iron Mind" (case-insensitive fallback)
 *
 * @param {Actor|TokenDocument|Token} actor
 * @returns {boolean}
 */
export function hasBoonOfTheIronMind(actor) {
    const act = actor?.actor ?? actor;
    if (!act?.items) return false;

    for (const item of act.items) {
        const identifier = item.identifier ?? item.system?.identifier ?? "";
        if (BOON_OF_THE_IRON_MIND_REGEX.test(identifier)) {
            return true;
        }

        const name = item.name ?? "";
        if (BOON_OF_THE_IRON_MIND_REGEX.test(name) || name.toLowerCase().includes("boon of the iron mind")) {
            return true;
        }
    }

    return false;
}

let _challengeConcentrationPatched = false;

/**
 * Patch Actor5e.prototype.challengeConcentration to suppress the system's concentration
 * challenge chat card prompt for actors that possess the Boon of the Iron Mind feat.
 */
function _patchChallengeConcentration() {
    if (_challengeConcentrationPatched) return;
    const ActorClass = CONFIG.Actor?.documentClass;
    if (!ActorClass?.prototype?.challengeConcentration) return;

    const originalChallengeConcentration = ActorClass.prototype.challengeConcentration;
    ActorClass.prototype.challengeConcentration = async function (...args) {
        if (game.settings.get(MODULE_ID, "enableAutoRollConcentration") && hasBoonOfTheIronMind(this)) {
            debug(`Auto-Roll Concentration | ${this.name} has Boon of the Iron Mind — skipping concentration challenge prompt.`);
            return null;
        }
        return originalChallengeConcentration.apply(this, args);
    };
    _challengeConcentrationPatched = true;
}

let _rollConcentrationPatched = false;

/**
 * Patch Actor5e.prototype.rollConcentration to prevent roll prompts or rolls
 * for actors that possess the Boon of the Iron Mind feat.
 */
function _patchRollConcentration() {
    if (_rollConcentrationPatched) return;
    const ActorClass = CONFIG.Actor?.documentClass;
    if (!ActorClass?.prototype?.rollConcentration) return;

    const originalRollConcentration = ActorClass.prototype.rollConcentration;
    ActorClass.prototype.rollConcentration = async function (...args) {
        if (game.settings.get(MODULE_ID, "enableAutoRollConcentration") && hasBoonOfTheIronMind(this)) {
            debug(`Auto-Roll Concentration | ${this.name} has Boon of the Iron Mind — skipping rollConcentration.`);
            return null;
        }
        return originalRollConcentration.apply(this, args);
    };
    _rollConcentrationPatched = true;
}

/**
 * Handler for the preUpdateActor hook.
 * If the actor has the Boon of the Iron Mind feat, suppresses the dnd5e system's
 * concentration challenge prompt upon taking damage by setting options.dnd5e.concentrationCheck = false.
 *
 * @param {Actor} actor
 * @param {object} change
 * @param {object} options
 * @param {string} userId
 */
function _onPreUpdateActor(actor, change, options, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoRollConcentration")) return;
        if (!hasBoonOfTheIronMind(actor)) return;

        foundry.utils.setProperty(options, "dnd5e.concentrationCheck", false);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onPreUpdateActor for Auto-Roll Concentration:", err);
    }
}

/**
 * Handler for the dnd5e.preRollConcentration hook.
 * Cancels any concentration rolls for actors that possess the Boon of the Iron Mind feat.
 *
 * @param {BasicRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration} dialog
 * @param {BasicRollMessageConfiguration} message
 * @returns {boolean|void}
 */
function _onPreRollConcentration(config, dialog, message) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoRollConcentration")) return;

        const actor = config.subject ?? config.actor ?? (message?.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
        if (!actor || !hasBoonOfTheIronMind(actor)) return;

        debug(`Auto-Roll Concentration | ${actor.name} has Boon of the Iron Mind — cancelling concentration roll.`);
        return false;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onPreRollConcentration for Auto-Roll Concentration:", err);
    }
}

/**
 * Handler for the dnd5e.damageActor hook.
 * @param {Actor} actor
 * @param {{hp: number, temp: number, total: number}} changes
 * @param {object} update
 * @param {string} userId
 */
async function _onDamageActor(actor, changes, update, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoRollConcentration")) return;

        // Bug 3 fix: respect the dnd5e system-level "disable concentration tracking" setting.
        // If the GM has disabled concentration tracking globally, we should not auto-roll either.
        if (game.settings.get("dnd5e", "disableConcentration")) return;

        // Skip actors with Boon of the Iron Mind
        if (hasBoonOfTheIronMind(actor)) {
            debug(`Auto-Roll Concentration | ${actor.name} has Boon of the Iron Mind — skipping concentration roll.`);
            return;
        }

        // Automatically skip if midi-qol is active and configured to handle concentration checks
        if (game.modules.get("midi-qol")?.active) {
            const midiDoConc = globalThis.MidiQOL?.configSettings?.()?.doConcentrationCheck
                ?? game.settings.get("midi-qol", "ConfigSettings")?.doConcentrationCheck;
            if (midiDoConc && midiDoConc !== "none") {
                debug("Auto-Roll Concentration | midi-qol detected and handles concentration checks — feature bypassed to avoid duplicate rolls.");
                return;
            }
        }

        // Only process if total net HP change is negative (damage)
        if (!changes || typeof changes.total !== "number" || changes.total >= 0) return;

        // Respect dnd5e concentrationCheck option if set to false
        if (update?.dnd5e?.concentrationCheck === false) return;

        const damage = Math.abs(changes.total);
        if (damage <= 0) return;

        // Check if actor has active concentration effects (dnd5e 5.2+ API)
        const isConcentrating = actor.concentration?.effects?.size > 0;
        if (!isConcentrating) return;

        if (game.userId === userId) {
            if (!actor.isOwner) return;
        } else {
            const primaryGM = game.users.primaryGM ?? game.users.activeGM;
            if (!primaryGM?.isSelf) return;
            const updatingUser = game.users.get(userId);
            if (updatingUser && actor.testUserPermission(updatingUser, "OWNER")) return;
        }

        const dc = typeof actor.getConcentrationDC === "function"
            ? actor.getConcentrationDC(damage)
            : Math.max(10, Math.floor(damage / 2));

        debug(`Auto-Roll Concentration | ${actor.name} took ${damage} damage while concentrating. Rolling concentration save (DC ${dc}).`);

        const fastForwardSetting = game.settings.get(MODULE_ID, "autoRollConcentrationFastForward");
        const fastForward = fastForwardSetting === "all"
            || (fastForwardSetting === "npcsOnly" && actor.type === "npc")
            || (fastForwardSetting === "playersOnly" && actor.type === "character");
        const autoEndOnFailure = game.settings.get(MODULE_ID, "autoEndConcentrationOnFailure");

        await new Promise(resolve => setTimeout(resolve, 200));

        const rolls = await actor.rollConcentration(
            { target: dc },
            { configure: !fastForward },
            {
                data: {
                    flags: {
                        [MODULE_ID]: {
                            isConcentrationSave: true,
                            targetDC: dc,
                            actorUuid: actor.uuid
                        }
                    }
                }
            }
        );

        if (!rolls?.length) return;

        if (autoEndOnFailure) {
            const roll = rolls[0];
            const isSuccess = roll.isSuccess ?? (roll.total >= dc);

            if (!isSuccess) {
                debug(`Auto-Roll Concentration | ${actor.name} failed concentration save (${roll.total} vs DC ${dc}). Auto-ending concentration.`);
                if (typeof actor.endConcentration === "function") {
                    await actor.endConcentration();
                }
            }
        }
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Failed auto concentration roll for ${actor?.name}:`, err);
    }
}

/**
 * Hook that fires after any concentration save is rolled (auto or manual).
 * Backfills our module flag onto the resulting ChatMessage so the "End Concentration"
 * button will be injected when the message (re-)renders.
 * @param {D20Roll[]} rolls
 * @param {{ subject: Actor5e }} data
 */
function _onRollConcentration(rolls, { subject: actor } = {}) {
    try {
        if (!actor) return;

        // The message was just created by buildPost. Find it in the recent message log by matching
        // the actor's speaker ID. We check the last 10 messages to guard against busy chat logs.
        const recentMessages = game.messages.contents.slice(-10).reverse();
        const message = recentMessages.find(m =>
            m.speaker?.actor === actor.id &&
            m.flags?.dnd5e?.roll?.type === "save" &&
            !m.flags?.[MODULE_ID]?.isConcentrationSave
        );
        if (!message) return;

        // Stamp the flag — this triggers a message update which re-renders the card,
        // causing _onRenderChatMessage to run again and inject the button.
        message.setFlag(MODULE_ID, "isConcentrationSave", true);
        message.setFlag(MODULE_ID, "actorUuid", actor.uuid);
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onRollConcentration:`, err);
    }
}

/**
 * Process rendered chat messages to inject the "End Concentration" button into concentration roll cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function _onRenderChatMessage(message, html) {
    // Process messages flagged as a concentration save by our module or by midi-qol.
    // _onRollConcentration stamps this flag on ALL concentration saves (auto-rolled or manual)
    // so we don't need to rely on the native roll.options.isConcentration which is not set
    // by the dnd5e system on the serialised Roll object.
    const isMidiConc = message.flags?.["midi-qol"]?.isConcentrationCheck;
    if (!message.flags?.[MODULE_ID]?.isConcentrationSave && !isMidiConc) return;

    // Resolve the actor
    const actorUuid = message.flags?.[MODULE_ID]?.actorUuid ?? message.flags?.["midi-qol"]?.actorUuid;
    let actor = actorUuid ? fromUuidSync(actorUuid) : null;
    if (!actor && message.speaker?.actor) {
        actor = game.actors.get(message.speaker.actor);
    }
    if (!actor) return;

    // Avoid duplicate buttons if re-rendered
    if (html.querySelector(".nd5t-end-concentration-btn")) return;

    const isConcentrating = actor.concentration?.effects?.size > 0;
    const canManage = actor.isOwner || game.user.isGM;

    // Create the button element
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nd5t-end-concentration-btn";
    button.dataset.actorUuid = actor.uuid;

    if (!canManage) {
        button.disabled = true;
    }

    if (isConcentrating) {
        button.innerHTML = `<i class="fa-solid fa-brain" inert></i> ${game.i18n.localize("ND5T.AutoRollConcentration.EndConcentration")}`;
    } else {
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollConcentration.ConcentrationEnded")}`;
    }

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!canManage) return;

        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin" inert></i> ${game.i18n.localize("ND5T.AutoRollConcentration.EndingConcentration")}`;

        try {
            if (typeof actor.endConcentration === "function") {
                await actor.endConcentration();
            } else {
                for (const effect of actor.effects) {
                    if (effect.statuses.has("concentrating")) {
                        await effect.delete();
                    }
                }
            }
            button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollConcentration.ConcentrationEnded")}`;
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Failed to end concentration for ${actor.name}:`, err);
            button.disabled = false;
            button.innerHTML = `<i class="fa-solid fa-brain" inert></i> ${game.i18n.localize("ND5T.AutoRollConcentration.EndConcentration")}`;
        }
    });

    // Append to card body or footer
    const cardTarget = html.querySelector(".card-content") || html.querySelector(".message-content") || html;
    cardTarget.appendChild(button);
}
