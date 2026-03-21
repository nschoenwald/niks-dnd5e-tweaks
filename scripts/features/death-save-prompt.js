import { debug } from "../main.js";

const MODULE_ID = "niks-dnd5e-tweaks";

/**
 * Initialize the Death Save Prompt feature.
 */
export function initDeathSavePrompt() {
    Hooks.on("updateCombat", (combat, update, options, userId) => {
        if (update.turn !== undefined || update.round !== undefined) {
            handleDeathSavePrompt(combat);
        }
    });

    Hooks.on("combatStart", (combat, update) => {
        handleDeathSavePrompt(combat);
    });

    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
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
    });
}

/**
 * Handle checking if a death save prompt should be sent.
 * @param {Combat} combat - The current combat.
 */
async function handleDeathSavePrompt(combat) {
    if (!game.settings.get(MODULE_ID, "enableDeathSavePrompt")) return;
    
    // Only the GM should send the message to avoid duplicates
    if (!game.user.isGM) return;

    const combatant = combat.combatant;
    const actor = combatant?.actor;

    if (!actor || actor.type !== "character") return;

    const hp = actor.system.attributes.hp.value;
    const death = actor.system.attributes.death;

    // Check if at 0 HP and hasn't yet stabilized or died (3 successes or 3 failures)
    if (hp === 0 && death.success < 3 && death.failure < 3) {
        debug(`Prompting for death save for ${actor.name}`);
        await sendDeathSavePrompt(actor);
    }
}

/**
 * Send a whispered death save prompt message.
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
        whisper: whisperUsers,
        type: CONST.CHAT_MESSAGE_STYLES?.WHISPER || CONST.CHAT_MESSAGE_TYPES.WHISPER
    });
}
