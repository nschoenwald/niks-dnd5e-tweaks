import { MODULE_ID, debug } from "../main.js";

/**
 * Auto-Prompt / Roll Initiative on Combat Add
 *
 * Automatically prompts connected players with their initiative roll dialog (or rolls immediately)
 * when their token/combatant is added to an active combat encounter.
 *
 * Supported fast-forward modes:
 *  - "none": Never fast-forwards. Connected players get the roll dialog, and GM gets dialog for NPCs.
 *  - "npcsOnly": Fast-forwards for NPCs, while connected players get the roll dialog.
 *  - "all": Fast-forwards for all actors (NPCs and players).
 *  - "playersOnly": Fast-forwards for players, shows dialog for NPCs.
 *
 * For unattended player characters (no non-GM owner connected), sends a fallback whispered chat card
 * with a clickable "Roll Initiative" button so the GM can roll on their behalf.
 */

const _handledCombatantIds = new Set();

export function initAutoRollInitiative() {
    Hooks.on("createCombatant", _onCreateCombatant);
    Hooks.on("updateCombatant", _onUpdateCombatant);
    Hooks.on("deleteCombatant", _onDeleteCombatant);

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
        if (element instanceof HTMLElement) _bindInitiativeButton(message, element);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (html instanceof HTMLElement) _bindInitiativeButton(message, html);
    });

    debug("Auto-Prompt Initiative | Initialized");
}

/**
 * Handler for createCombatant hook.
 * @param {Combatant} combatant
 * @param {object} options
 * @param {string} userId
 */
function _onCreateCombatant(combatant, options, userId) {
    try {
        if (!game.settings.get(MODULE_ID, "enableAutoRollInitiative")) return;

        // Skip if combatant already has initiative
        if (combatant.initiative !== null && combatant.initiative !== undefined) return;

        // Skip legendary action placeholder combatants
        if (combatant.getFlag(MODULE_ID, "isLegendaryPlaceholder")) return;

        // Skip tokens created via summon activities
        if (_isSummonedCombatant(combatant)) {
            debug(`Auto-Prompt Initiative | Skipping summoned combatant "${combatant.name}".`);
            return;
        }

        // Deduplicate handling for the same combatant
        if (_handledCombatantIds.has(combatant.id)) return;
        _handledCombatantIds.add(combatant.id);

        // Keep set size bounded
        if (_handledCombatantIds.size > 200) {
            const first = _handledCombatantIds.values().next().value;
            _handledCombatantIds.delete(first);
        }

        const actor = combatant.actor;
        if (!actor) return;

        const isNPC = actor.type === "npc" || combatant.isNPC;
        const isCharacter = actor.type === "character";

        const fastForwardSetting = game.settings.get(MODULE_ID, "autoRollInitiativeFastForward");
        const fastForward = fastForwardSetting === "all"
            || (fastForwardSetting === "npcsOnly" && isNPC)
            || (fastForwardSetting === "playersOnly" && isCharacter);

        // ── Path 1: Connected Owning Player Client ──────────────────────────
        if (actor.isOwner && !game.user.isGM) {
            const connectedOwners = game.users.filter(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
            const isPrimaryOwner = connectedOwners[0]?.id === game.userId;
            if (!isPrimaryOwner) return;

            debug(`Auto-Prompt Initiative | ${fastForward ? "Rolling" : "Prompting"} initiative for ${actor.name} on player client.`);
            queueMicrotask(async () => {
                try {
                    if (fastForward) {
                        if (typeof actor.rollInitiative === "function") {
                            await actor.rollInitiative({
                                createCombatants: false,
                                rerollInitiative: false,
                                dialog: false,
                                initiativeOptions: { dialog: false }
                            });
                        } else {
                            await combatant.rollInitiative();
                        }
                    } else {
                        if (typeof actor.rollInitiativeDialog === "function") {
                            await actor.rollInitiativeDialog({
                                createCombatants: false,
                                rerollInitiative: false
                            });
                        } else if (typeof actor.rollInitiative === "function") {
                            await actor.rollInitiative({
                                createCombatants: false,
                                rerollInitiative: false,
                                dialog: true,
                                initiativeOptions: { dialog: true, configure: true }
                            });
                        } else {
                            await combatant.rollInitiative();
                        }
                    }
                } catch (err) {
                    console.error(`${MODULE_ID} | Error rolling initiative for ${actor.name}:`, err);
                }
            });
            return;
        }

        // ── Path 2 & 3: Primary GM Client Handling ──────────────────────────
        const primaryGM = game.users.primaryGM ?? game.users.activeGM;
        if (!primaryGM?.isSelf) return;

        const hasConnectedOwner = game.users.some(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));

        // If player character has an active connected owner, the player client handles it via Path 1
        if (isCharacter && hasConnectedOwner) return;

        // If player character is unattended (no connected owner)
        if (isCharacter && !hasConnectedOwner) {
            if (fastForward) {
                debug(`Auto-Prompt Initiative | No connected owner for ${actor.name}. Fast-forwarding initiative on GM client.`);
                queueMicrotask(async () => {
                    try {
                        if (typeof actor.rollInitiative === "function") {
                            await actor.rollInitiative({
                                createCombatants: false,
                                rerollInitiative: false,
                                dialog: false,
                                initiativeOptions: { dialog: false }
                            });
                        } else {
                            await combatant.rollInitiative();
                        }
                    } catch (err) {
                        console.error(`${MODULE_ID} | Failed fast-forward initiative for ${actor.name}:`, err);
                    }
                });
            } else {
                debug(`Auto-Prompt Initiative | No connected owner for ${actor.name}. Sending GM fallback chat card.`);
                queueMicrotask(async () => {
                    try {
                        await sendInitiativePrompt(combatant, actor);
                    } catch (err) {
                        console.error(`${MODULE_ID} | Failed sending GM initiative prompt:`, err);
                    }
                });
            }
            return;
        }

        // NPC / GM-controlled combatant
        debug(`Auto-Prompt Initiative | ${fastForward ? "Rolling" : "Prompting"} initiative for NPC ${actor.name} on GM client.`);
        queueMicrotask(async () => {
            try {
                if (fastForward) {
                    if (typeof actor.rollInitiative === "function") {
                        await actor.rollInitiative({
                            createCombatants: false,
                            rerollInitiative: false,
                            dialog: false,
                            initiativeOptions: { dialog: false }
                        });
                    } else {
                        await combatant.rollInitiative();
                    }
                } else {
                    if (typeof actor.rollInitiativeDialog === "function") {
                        await actor.rollInitiativeDialog({
                            createCombatants: false,
                            rerollInitiative: false
                        });
                    } else if (typeof actor.rollInitiative === "function") {
                        await actor.rollInitiative({
                            createCombatants: false,
                            rerollInitiative: false,
                            dialog: true,
                            initiativeOptions: { dialog: true, configure: true }
                        });
                    } else {
                        await combatant.rollInitiative();
                    }
                }
            } catch (err) {
                console.error(`${MODULE_ID} | Error rolling initiative for NPC ${actor.name}:`, err);
            }
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Error in createCombatant hook for Auto-Prompt Initiative:`, err);
    }
}

/**
 * Send a whispered initiative prompt message (GM fallback for unattended actors).
 * @param {Combatant} combatant
 * @param {Actor} actor
 */
async function sendInitiativePrompt(combatant, actor) {
    const owners = [];
    for (let [id, level] of Object.entries(actor.ownership)) {
        if (level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
            if (id === "default") owners.push(...game.users.filter(u => !u.isGM).map(u => u.id));
            else owners.push(id);
        }
    }

    const gms = game.users.filter(u => u.isGM).map(u => u.id);
    const whisperUsers = [...new Set([...owners, ...gms])];

    const content = `
        <div class="dnd5e chat-card item-card nd5t-initiative-prompt" data-combatant-id="${combatant.id}">
            <header class="card-header flexrow">
                <h3>${actor.name}</h3>
            </header>
            <div class="card-content">
                <p>${game.i18n.format("ND5T.AutoRollInitiative.PromptMessage", { name: `<strong>${actor.name}</strong>` })}</p>
            </div>
            <div class="card-buttons">
                <button type="button" data-action="nd5t-roll-initiative" data-combatant-id="${combatant.id}" data-actor-uuid="${actor.uuid}">
                    <i class="fas fa-dice-d20"></i> ${game.i18n.localize("ND5T.AutoRollInitiative.RollInitiative")}
                </button>
            </div>
        </div>
    `;

    await ChatMessage.create({
        content: content,
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        whisper: whisperUsers,
        flags: {
            [MODULE_ID]: {
                isInitiativePrompt: true,
                combatantId: combatant.id,
                actorUuid: actor.uuid
            }
        }
    });
}

/**
 * Bind click handler to the initiative button inside a chat message.
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function _bindInitiativeButton(message, element) {
    const prompt = element.querySelector(".nd5t-initiative-prompt");
    if (!prompt) return;
    if (prompt.dataset.bound) return;
    prompt.dataset.bound = "true";

    const button = prompt.querySelector('button[data-action="nd5t-roll-initiative"]');
    if (!button) return;

    const combatantId = button.dataset.combatantId;
    const combat = game.combat ?? game.combats?.active;
    const combatant = combat?.combatants.get(combatantId);

    if (combatant && combatant.initiative !== null && combatant.initiative !== undefined) {
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.InitiativeRolled")}`;
        return;
    }

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (button.disabled) return;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-spinner fa-spin" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.Rolling")}`;

        try {
            const currentCombat = game.combat ?? game.combats?.active;
            const currentCombatant = currentCombat?.combatants.get(combatantId);
            const targetActor = currentCombatant?.actor ?? (button.dataset.actorUuid ? fromUuidSync(button.dataset.actorUuid) : null);

            if (currentCombatant && currentCombatant.initiative !== null && currentCombatant.initiative !== undefined) {
                button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.InitiativeRolled")}`;
                return;
            }

            if (typeof targetActor?.rollInitiativeDialog === "function") {
                await targetActor.rollInitiativeDialog({
                    createCombatants: false,
                    rerollInitiative: true,
                    event: event
                });
            } else if (typeof targetActor?.rollInitiative === "function") {
                await targetActor.rollInitiative({
                    createCombatants: false,
                    rerollInitiative: true,
                    dialog: true,
                    initiativeOptions: { dialog: true, configure: true, event: event },
                    event: event
                });
            } else if (currentCombatant) {
                await currentCombat.rollInitiative([currentCombatant.id]);
            } else {
                ui.notifications.warn("Could not find combatant in active combat.");
                button.disabled = false;
                button.innerHTML = `<i class="fas fa-dice-d20"></i> ${game.i18n.localize("ND5T.AutoRollInitiative.RollInitiative")}`;
                return;
            }

            const updatedCombatant = currentCombat?.combatants.get(combatantId);
            if (updatedCombatant && updatedCombatant.initiative !== null && updatedCombatant.initiative !== undefined) {
                button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.InitiativeRolled")}`;
            } else {
                button.disabled = false;
                button.innerHTML = `<i class="fas fa-dice-d20"></i> ${game.i18n.localize("ND5T.AutoRollInitiative.RollInitiative")}`;
            }
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Failed rolling initiative from prompt button:`, err);
            button.disabled = false;
            button.innerHTML = `<i class="fas fa-dice-d20"></i> ${game.i18n.localize("ND5T.AutoRollInitiative.RollInitiative")}`;
        }
    });
}

/**
 * Handler for updateCombatant hook.
 * Dynamically disables any open chat prompt buttons when initiative is rolled.
 * @param {Combatant} combatant
 * @param {object} update
 * @param {object} options
 * @param {string} userId
 */
function _onUpdateCombatant(combatant, update, options, userId) {
    if (update.initiative !== undefined || (combatant.initiative !== null && combatant.initiative !== undefined)) {
        _syncInitiativeCardButtons(combatant);
    }
}

/**
 * Handler for deleteCombatant hook.
 * Disables prompt buttons if a combatant was removed from combat.
 * @param {Combatant} combatant
 */
function _onDeleteCombatant(combatant) {
    _syncInitiativeCardButtons(combatant, true);
}

/**
 * Synchronize the state of any rendered initiative prompt buttons in the DOM.
 * @param {Combatant} combatant
 * @param {boolean} [isDeleted=false]
 */
function _syncInitiativeCardButtons(combatant, isDeleted = false) {
    if (!combatant?.id) return;
    const buttons = document.querySelectorAll(`button[data-action="nd5t-roll-initiative"][data-combatant-id="${combatant.id}"]`);
    for (const button of buttons) {
        button.disabled = true;
        if (isDeleted) {
            button.innerHTML = `<i class="fa-solid fa-times" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.CombatantRemoved")}`;
        } else {
            button.innerHTML = `<i class="fa-solid fa-check" inert></i> ${game.i18n.localize("ND5T.AutoRollInitiative.InitiativeRolled")}`;
        }
    }
}

/**
 * Check if combatant is from a summoned token.
 * @param {Combatant} combatant
 * @returns {boolean}
 */
function _isSummonedCombatant(combatant) {
    const actor = combatant.actor;
    const token = combatant.token;
    if (actor?.getFlag?.("dnd5e", "summon") || actor?.getFlag?.("dnd5e", "summon.origin") || actor?.flags?.dnd5e?.summon) return true;
    if (token?.getFlag?.("dnd5e", "summon") || token?.getFlag?.("dnd5e", "summon.origin") || token?.flags?.dnd5e?.summon) return true;
    if (token?.delta?.flags?.dnd5e?.summon) return true;
    return false;
}
