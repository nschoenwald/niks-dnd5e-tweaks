import { MODULE_ID, debug } from "../main.js";

/**
 * Initialize the Death Save Prompt feature.
 */
export function initDeathSavePrompt() {
    Hooks.on("updateCombat", (combat, update, options, userId) => {
        try {
            if (update.turn !== undefined || update.round !== undefined) {
                handleDeathSavePrompt(combat);
            }
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Error in updateCombat hook for Death Save Prompt:`, err);
        }
    });

    Hooks.on("combatStart", (combat, update) => {
        try {
            handleDeathSavePrompt(combat);
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Error in combatStart hook for Death Save Prompt:`, err);
        }
    });

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
        _bindDeathSaveButton(message, element);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _bindDeathSaveButton(message, html);
    });
}

let lastPromptKey = null;

/**
 * Bind click handler to the death save button inside a chat message.
 * Shared between the V13 (renderChatMessage) and V14 (renderChatMessageHTML) hooks.
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function _bindDeathSaveButton(message, element) {
    const prompt = element.querySelector(".nd5t-death-save-prompt");
    if (!prompt) return;

    const button = prompt.querySelector('button[data-action="nd5t-death-save"]');
    if (button) {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const speaker = message.speaker;
            const actor = ChatMessage.getSpeakerActor(speaker);
            if (actor) {
                await actor.rollDeathSave({ event: event });
            } else {
                ui.notifications.warn("Could not find actor for death save roll.");
            }
        });
    }
}

/**
 * Handle checking if a death save prompt should be sent.
 *
 * Strategy:
 *   1. If the current client owns the actor → call actor.rollDeathSave() directly,
 *      opening the pre-configured roll dialog for the player immediately.
 *   2. If the current client is the primary GM and no owner is connected →
 *      post the fallback whispered chat card so an unattended actor can still roll.
 *
 * @param {Combat} combat - The current combat.
 */
async function handleDeathSavePrompt(combat) {
    if (!game.settings.get(MODULE_ID, "enableDeathSavePrompt")) return;

    const combatant = combat.combatant;
    const actor = combatant?.actor;

    if (!actor || actor.type !== "character") return;

    const hp = actor.system.attributes.hp.value;
    const death = actor.system.attributes.death;

    // Only prompt when at 0 HP and not yet stabilized/resolved (< 3 successes or failures)
    if (!(hp === 0 && death.success < 3 && death.failure < 3)) return;

    // Deduplicate per combatant per round — each client checks independently
    const key = `${combatant.id}-${combat.round}`;
    if (lastPromptKey === key) return;
    lastPromptKey = key;

    debug(`Death Save Prompt | ${actor.name} needs a death save (round ${combat.round}).`);

    // ── Path 1: owning player client → open roll dialog directly ──────────────
    // actor.isOwner is true for the actor's owning player(s) and always true for GMs.
    // We exclude GMs here so they don't auto-pop a dialog for every player actor.
    if (actor.isOwner && !game.user.isGM) {
        debug(`Death Save Prompt | Opening death save dialog for ${actor.name} on owning client.`);
        queueMicrotask(async () => {
            try {
                await actor.rollDeathSave();
            } catch (err) {
                console.error(`Nik's DnD5e Tweaks | Failed opening death save dialog:`, err);
            }
        });
        return;
    }

    // ── Path 2: GM fallback for unattended actors ──────────────────────────────
    // Only run on the primary/active GM to avoid duplicate chat messages.
    // Check whether any non-GM owner of this actor is currently connected.
    // If an owner is online, their client will handle Path 1 — no card needed.
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (!primaryGM?.isSelf) return;

    const hasConnectedOwner = game.users.some(u =>
        !u.isGM && u.active && actor.testUserPermission(u, "OWNER")
    );
    if (hasConnectedOwner) return; // Owner client is handling it via Path 1

    debug(`Death Save Prompt | No connected owner for ${actor.name}. Sending GM fallback chat card.`);
    queueMicrotask(async () => {
        try {
            await sendDeathSavePrompt(actor);
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Failed sending GM death save prompt:`, err);
        }
    });
}

/**
 * Send a whispered death save prompt message (GM fallback for unattended actors).
 * @param {Actor} actor - The actor to prompt for.
 */
async function sendDeathSavePrompt(actor) {
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
        <div class="dnd5e chat-card item-card nd5t-death-save-prompt">
            <header class="card-header flexrow">
                <h3>${actor.name}</h3>
            </header>
            <div class="card-content">
                <p><strong>${actor.name}</strong> starts their turn with 0 HP. Please roll a Death Saving Throw.</p>
            </div>
            <div class="card-buttons">
                <button data-action="nd5t-death-save">
                    <i class="fas fa-dice-d20"></i> Death Saving Throw
                </button>
            </div>
        </div>
    `;

    await ChatMessage.create({
        content: content,
        speaker: ChatMessage.getSpeaker({ actor: actor }),
        whisper: whisperUsers
    });
}
