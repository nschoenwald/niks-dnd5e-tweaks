import { MODULE_ID, debug } from "../main.js";

/**
 * Auto-Roll Concentration Saves on Damage
 *
 * Automatically rolls a Constitution saving throw for concentration when a
 * concentrating token/actor takes damage. Also appends an "End Concentration"
 * button to concentration roll chat cards to allow manual removal.
 */

export function initAutoRollConcentration() {
    Hooks.on("dnd5e.damageActor", _onDamageActor);

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

/**
 * Handler for the dnd5e.damageActor hook.
 * @param {Actor} actor
 * @param {{hp: number, temp: number, total: number}} changes
 * @param {object} update
 * @param {string} userId
 */
async function _onDamageActor(actor, changes, update, userId) {
    if (!game.settings.get(MODULE_ID, "enableAutoRollConcentration")) return;

    // Bug 3 fix: respect the dnd5e system-level "disable concentration tracking" setting.
    // If the GM has disabled concentration tracking globally, we should not auto-roll either.
    if (game.settings.get("dnd5e", "disableConcentration")) return;

    // Only process if total net HP change is negative (damage)
    if (!changes || typeof changes.total !== "number" || changes.total >= 0) return;

    // Respect dnd5e concentrationCheck option if set to false
    if (update?.dnd5e?.concentrationCheck === false) return;

    const damage = Math.abs(changes.total);
    if (damage <= 0) return;

    // Check if actor has active concentration effects (dnd5e 5.2+ API)
    const isConcentrating = actor.concentration?.effects?.size > 0;
    if (!isConcentrating) return;

    // Bug 1 fix: Prevent duplicate processing across multiple connected clients.
    //
    // actor.rollConcentration() requires the calling client to be an owner of the actor.
    // The correct routing logic is:
    //   • If I triggered the update: roll only if I own the actor.
    //   • If someone else triggered the update: only the primary GM steps in, and only
    //     if the updating user does NOT own the actor (if they did, their own client
    //     would have handled it in the branch above).
    //
    // GMs always have OWNER-level access, so `actor.isOwner` is always true for GMs.
    if (game.userId === userId) {
        // Bug 2 fix: I triggered this update — only proceed if I actually own the actor.
        // actor.rollConcentration() guards !this.isOwner internally and returns null silently,
        // so we must check here to avoid false-positive "rolling" log messages.
        if (!actor.isOwner) return;
    } else {
        // Someone else triggered the update. Step in as the primary GM fallback, but only
        // if the updater themselves do not own the actor (avoids double-rolling when the
        // actor owner is the one who applied damage and their client is the primary handler).
        const primaryGM = game.users.primaryGM ?? game.users.activeGM;
        if (!primaryGM?.isSelf) return;
        const updatingUser = game.users.get(userId);
        if (updatingUser && actor.testUserPermission(updatingUser, "OWNER")) return;
    }

    // Calculate DC: dnd5e rules specify Math.max(10, Math.floor(damage / 2)).
    // Use actor.getConcentrationDC() from dnd5e 5.2+ which also clamps to 30 for 2024 rules.
    const dc = typeof actor.getConcentrationDC === "function"
        ? actor.getConcentrationDC(damage)
        : Math.max(10, Math.floor(damage / 2));

    debug(`Auto-Roll Concentration | ${actor.name} took ${damage} damage while concentrating. Rolling concentration save (DC ${dc}).`);

    const fastForwardSetting = game.settings.get(MODULE_ID, "autoRollConcentrationFastForward");
    const fastForward = fastForwardSetting === "all"
        || (fastForwardSetting === "npcsOnly" && actor.type === "npc")
        || (fastForwardSetting === "playersOnly" && actor.type === "character");
    const autoEndOnFailure = game.settings.get(MODULE_ID, "autoEndConcentrationOnFailure");

    // Defer our roll so it appears AFTER the system's "click to roll" concentration prompt.
    //
    // The dnd5e system calls challengeConcentration() (which creates a chat prompt) inside
    // onUpdateHP() WITHOUT awaiting it, immediately followed by Hooks.callAll("dnd5e.damageActor").
    // Both the system's ChatMessage.create and our rollConcentration are in-flight concurrently,
    // racing to reach the server. A zero-delay tick was not sufficient — both socket requests
    // still arrived at the server in the wrong order. 200ms gives the system's message time to
    // complete its round trip and be assigned a lower server timestamp before we begin ours.
    await new Promise(resolve => setTimeout(resolve, 200));

    try {
        const rolls = await actor.rollConcentration(
            { target: dc },
            { configure: !fastForward },
            {
                // Flags must be nested under `data` — buildPost calls this.toMessage(rolls, message.data)
                // so only properties under message.data are written into the created ChatMessage.
                // Top-level message.flags would be silently ignored.
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

        // rollConcentration returns null if cancelled from dialog or if not an owner
        if (!rolls?.length) return;

        if (autoEndOnFailure) {
            const roll = rolls[0];
            // Bug 4 fix: use nullish coalescing — isSuccess returns undefined (unevaluated)
            // or false (no target set), never undefined for an evaluated roll with a target.
            const isSuccess = roll.isSuccess ?? (roll.total >= dc);

            if (!isSuccess) {
                debug(`Auto-Roll Concentration | ${actor.name} failed concentration save (${roll.total} vs DC ${dc}). Auto-ending concentration.`);
                if (typeof actor.endConcentration === "function") {
                    await actor.endConcentration();
                }
            }
        }
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Failed auto concentration roll for ${actor.name}:`, err);
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
    if (!actor) return;

    // The message was just created by buildPost. Find it in the recent message log by matching
    // the actor's speaker ID. We check the last 5 messages to guard against busy chat logs.
    const recentMessages = game.messages.contents.slice(-5).reverse();
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
}

/**
 * Process rendered chat messages to inject the "End Concentration" button into concentration roll cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function _onRenderChatMessage(message, html) {
    // Only process messages flagged as a concentration save by our module.
    // _onRollConcentration stamps this flag on ALL concentration saves (auto-rolled or manual)
    // so we don't need to rely on the native roll.options.isConcentration which is not set
    // by the dnd5e system on the serialised Roll object.
    if (!message.flags?.[MODULE_ID]?.isConcentrationSave) return;

    // Resolve the actor
    const actorUuid = message.flags?.[MODULE_ID]?.actorUuid;
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
