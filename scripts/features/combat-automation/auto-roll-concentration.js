/**
 * Feature: Auto-Roll Concentration Saves
 * Description: Automatically triggers Constitution saving throws when a concentrating actor takes damage, routes roll prompts to connected player owners, and appends an End Concentration button.
 *
 * @introduced v14.12.0
 */
import { MODULE_ID, debug } from "../../main.js";

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

/**
 * Retrieve the items currently being concentrated on by an actor.
 * Extracts name, icon, and UUID from active effects and item data.
 *
 * @param {Actor|TokenDocument|Token} actor
 * @returns {Array<{name: string, img: string, uuid: string|null}>}
 */
export function getConcentratingItems(actor) {
    const act = actor?.actor ?? actor;
    if (!act) return [];

    const items = [];
    const seenKeys = new Set();

    // 1. Inspect actor.concentration.effects (canonical in dnd5e 5.2+ / 6.x)
    for (const effect of act.concentration?.effects ?? []) {
        if (!effect.active) continue;

        const itemFlag = effect.getFlag("dnd5e", "item");
        let name = itemFlag?.data?.name ?? itemFlag?.name;
        let img = itemFlag?.data?.img ?? itemFlag?.img;
        let uuid = itemFlag?.uuid ?? null;

        // Try resolving live embedded item from actor by id
        if (itemFlag?.id) {
            const liveItem = act.items?.get(itemFlag.id);
            if (liveItem) {
                name = liveItem.name;
                img = liveItem.img;
                uuid = liveItem.uuid;
            }
        }

        // If no flag item or missing name, try effect origin document
        if (!name && effect.origin) {
            try {
                const originDoc = fromUuidSync(effect.origin);
                if (originDoc) {
                    name = originDoc.name;
                    img = originDoc.img;
                    uuid = originDoc.uuid;
                }
            } catch (e) {
                // Ignore invalid origin UUID
            }
        }

        // Fallback: strip leading status prefix from effect name (e.g. "Concentrating: Bless" -> "Bless")
        if (!name && effect.name) {
            name = effect.name.replace(/^[^:]+:\s*/, "").trim();
            img = effect.img;
        }

        const key = (uuid || name || "").toLowerCase();
        if (name && !seenKeys.has(key)) {
            seenKeys.add(key);
            items.push({
                name,
                img: img || effect.img || "icons/svg/aura.svg",
                uuid: uuid || null
            });
        }
    }

    // 2. Fallback to actor.concentration.items if effects yielded nothing
    if (items.length === 0 && act.concentration?.items?.size) {
        for (const item of act.concentration.items) {
            const key = (item.uuid || item.name || "").toLowerCase();
            if (item?.name && !seenKeys.has(key)) {
                seenKeys.add(key);
                items.push({
                    name: item.name,
                    img: item.img || "icons/svg/aura.svg",
                    uuid: item.uuid || null
                });
            }
        }
    }

    return items;
}

let _challengeConcentrationPatched = false;

/**
 * Patch Actor5e.prototype.challengeConcentration to:
 * 1. Suppress the system's concentration challenge prompt for actors with Boon of the Iron Mind.
 * 2. When a connected player owner is online, whisper the challenge prompt ONLY to connected player owners (not GM).
 */
function _patchChallengeConcentration() {
    if (_challengeConcentrationPatched) return;
    const ActorClass = CONFIG.Actor?.documentClass;
    if (!ActorClass?.prototype?.challengeConcentration) return;

    const originalChallengeConcentration = ActorClass.prototype.challengeConcentration;
    ActorClass.prototype.challengeConcentration = async function (options = {}, ...args) {
        if (game.settings.get(MODULE_ID, "enableAutoRollConcentration")) {
            if (hasBoonOfTheIronMind(this)) {
                debug(`Auto-Roll Concentration | ${this.name} has Boon of the Iron Mind — skipping concentration challenge prompt.`);
                return null;
            }

            const connectedOwners = game.users.filter(u => !u.isGM && u.active && this.testUserPermission(u, "OWNER"));
            if (connectedOwners.length > 0) {
                const isConcentrating = this.concentration?.effects?.size > 0;
                if (!isConcentrating) return null;

                const dc = options?.dc ?? 10;
                const button = { dc, format: "short", type: "concentration" };
                if (options?.ability in CONFIG.DND5E.abilities) button.ability = options.ability;

                debug(`Auto-Roll Concentration | Whispering concentration challenge prompt for ${this.name} only to connected player owner(s).`);
                return ChatMessage.implementation.create({
                    speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
                    system: { broadcast: false, buttons: [button] },
                    type: "prompt",
                    whisper: connectedOwners.map(u => u.id)
                });
            }
        }
        return originalChallengeConcentration.call(this, options, ...args);
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

        // Determine which client is responsible for rolling / prompting concentration.
        // If the actor has any active non-GM owner connected, that player's client must handle it.
        // Even if the GM applies damage, the prompt pops up for the player and NOT the GM.
        // If no player owner is connected (or for NPCs), the primary active GM handles it.
        const connectedOwners = game.users
            .filter(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"))
            .sort((a, b) => a.id.localeCompare(b.id));
        const hasConnectedOwner = connectedOwners.length > 0;

        if (hasConnectedOwner) {
            const isPrimaryOwner = connectedOwners[0].id === game.userId;
            if (!isPrimaryOwner) return;
        } else {
            const primaryGM = game.users.primaryGM ?? game.users.activeGM;
            if (!primaryGM?.isSelf) return;
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

        const concentratingItems = getConcentratingItems(actor);

        const rolls = await actor.rollConcentration(
            { target: dc },
            { configure: !fastForward },
            {
                data: {
                    flags: {
                        [MODULE_ID]: {
                            isConcentrationSave: true,
                            targetDC: dc,
                            actorUuid: actor.uuid,
                            concentratingItems
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
            (m.system?.type === "concentration" || m.type === "save" || m.flags?.dnd5e?.roll?.type === "save") &&
            !m.flags?.[MODULE_ID]?.isConcentrationSave
        );
        if (!message) return;

        // Stamp the flags — this triggers a message update which re-renders the card,
        // causing _onRenderChatMessage to run again and inject the pill and button.
        const concentratingItems = message.flags?.[MODULE_ID]?.concentratingItems ?? getConcentratingItems(actor);
        const updates = {
            [`flags.${MODULE_ID}.isConcentrationSave`]: true,
            [`flags.${MODULE_ID}.actorUuid`]: actor.uuid
        };
        if (concentratingItems?.length) {
            updates[`flags.${MODULE_ID}.concentratingItems`] = concentratingItems;
        }
        message.update(updates);
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

    // 1. Inject Concentrating Items Pill Container (Above Roll)
    const concentratingItems = message.flags?.[MODULE_ID]?.concentratingItems
        ?? getConcentratingItems(actor);

    if (!html.querySelector(".nd5t-concentrating-pill-container") && concentratingItems.length > 0) {
        const pillContainer = document.createElement("div");
        pillContainer.className = "nd5t-concentrating-pill-container";

        for (const item of concentratingItems) {
            const pill = document.createElement("div");
            pill.className = "nd5t-concentrating-pill";
            if (item.uuid) {
                pill.dataset.action = "showDocument";
                pill.dataset.uuid = item.uuid;
            }

            const imgEl = document.createElement("img");
            imgEl.className = "nd5t-concentrating-icon gold-icon";
            imgEl.src = item.img || "icons/svg/aura.svg";
            imgEl.alt = item.name;

            const labelEl = document.createElement("span");
            labelEl.className = "nd5t-concentrating-label";
            const prefix = game.i18n.localize("ND5T.AutoRollConcentration.ConcentratingOn");
            labelEl.innerHTML = `${prefix} <strong>${foundry.utils.escapeHTML(item.name)}</strong>`;

            pill.appendChild(imgEl);
            pill.appendChild(labelEl);

            if (item.uuid) {
                pill.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const doc = await fromUuid(item.uuid);
                    doc?.sheet?.render(true);
                });
            }

            pillContainer.appendChild(pill);
        }

        // Insert above the roll result
        const rollSection = html.querySelector(".chat-card + section.icon-row, .icon-row:has(button.dice-roll), button.dice-roll")
            ?.closest("section.icon-row, .dice-roll")
            ?? html.querySelector("button.dice-roll");

        if (rollSection && rollSection.parentNode) {
            rollSection.parentNode.insertBefore(pillContainer, rollSection);
        } else {
            const cardTarget = html.querySelector(".card-content") || html.querySelector(".message-content") || html;
            cardTarget.prepend(pillContainer);
        }
    }

    // 2. Inject "End Concentration" Button
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
