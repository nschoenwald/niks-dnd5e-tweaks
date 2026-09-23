import { MODULE_ID, log, debug, isFeatureActive } from "../main.js";

/**
 * Check if the current user has permission to change the advantage mode on this message.
 * Only GMs, the message author, and owners of the actor that rolled can modify the roll.
 *
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function canUserModifyRoll(message) {
    if (!message) return false;
    if (game.user.isGM) return true;
    if (message.isAuthor) return true;
    if (message.actor?.isOwner) return true;
    return false;
}

/**
 * Construct a new D20Roll from an existing roll with a new advantage mode.
 * Caches rolled results on roll.options to prevent re-roll exploitation when toggling
 * between Normal, Advantage, and Disadvantage.
 *
 * @param {D20Roll} roll
 * @param {-1|0|1} mode
 * @returns {Promise<D20Roll>}
 */
export async function constructD20(roll, mode) {
    const previousMode = roll.options.advantageMode ?? 0;
    if (mode === previousMode) return roll;

    // Cache original die results on roll options so toggling back and forth
    // reuses the exact same values rather than generating new random rolls.
    const currentValues = roll.d20?.results?.map(r => r.result) ?? [];
    const cachedValues = Array.isArray(roll.options.nd5tOriginalResults)
        ? [...roll.options.nd5tOriginalResults]
        : [...currentValues];

    const options = foundry.utils.mergeObject(roll.options, {
        advantageMode: mode,
        configured: false,
        nd5tOriginalResults: cachedValues
    }, { inplace: false });

    const newRoll = roll.constructor.fromTerms([...roll.terms], options);
    newRoll.d20 = new CONFIG.Dice.D20Die();
    newRoll.d20.applyAdvantage(mode);
    newRoll.configureModifiers();

    await newRoll.d20.evaluate({ allowInteractive: false });

    if (mode === 0) {
        // Normal mode: only the first die result is kept
        newRoll.d20.results = [{ result: cachedValues[0] ?? currentValues[0] ?? newRoll.d20.results[0]?.result ?? 10, active: true, discarded: false }];
    } else {
        // Advantage or Disadvantage: populate with cached dice where available,
        // or record newly evaluated dice into cachedValues
        const results = newRoll.d20.results.map((r, i) => {
            const val = cachedValues[i] !== undefined ? cachedValues[i] : r.result;
            cachedValues[i] = val;
            return { ...r, result: val, active: false, discarded: true };
        });

        if (mode === 1) {
            // Advantage: highest die is active
            const highest = Math.max(...results.map(r => r.result));
            const activeResult = results.find(r => r.result === highest);
            if (activeResult) {
                activeResult.active = true;
                activeResult.discarded = false;
            }
        } else {
            // Disadvantage: lowest die is active
            const lowest = Math.min(...results.map(r => r.result));
            const activeResult = results.find(r => r.result === lowest);
            if (activeResult) {
                activeResult.active = true;
                activeResult.discarded = false;
            }
        }
        newRoll.d20.results = results;
    }

    newRoll.options.nd5tOriginalResults = cachedValues;
    newRoll._total = newRoll._evaluateTotal();
    return newRoll;
}

/**
 * Update a D20Roll within a chat message to a new advantage mode.
 * Automatically synchronizes flavor text and triggers Dice So Nice animations if present.
 *
 * @param {ChatMessage} message
 * @param {-1|0|1} mode
 * @param {number} [rollIndex=0]
 * @returns {Promise<ChatMessage>}
 */
export async function updateMessageRoll(message, mode, rollIndex = 0) {
    if (!message?.rolls || rollIndex >= message.rolls.length) return message;
    const roll = message.rolls[rollIndex];
    if (!(roll instanceof CONFIG.Dice.D20Roll)) {
        throw new Error("Target roll must be an instance of D20Roll.");
    }

    const newRoll = await constructD20(roll, mode);

    // Dice So Nice 3D animation support
    if (game.dice3d) {
        const users = message.whisper?.length ? message.whisper : null;
        game.dice3d.showForRoll(newRoll, game.user, true, users, false, message.id, message.speaker);
    }

    const rolls = [...message.rolls];
    rolls.splice(rollIndex, 1, newRoll);

    // Update message flavor header to reflect advantage mode
    let flavor = message.flavor ?? "";
    const advLabel = game.i18n.localize("DND5E.Advantage");
    const disLabel = game.i18n.localize("DND5E.Disadvantage");
    const pattern = new RegExp(`\\s*\\((?:Advantage|Disadvantage|${advLabel}|${disLabel})\\)`, "gi");
    flavor = flavor.replace(pattern, "").trim();
    if (mode === 1) flavor += ` (${advLabel})`;
    else if (mode === -1) flavor += ` (${disLabel})`;

    await message.update({ rolls, flavor });
    debug(`Updated roll on message ${message.id} to mode ${mode}`);
    return message;
}

/**
 * Request an advantage mode change on a message.
 * If the current user has permission to update the message document directly, updates it.
 * Otherwise, emits a socket message to the active GM to perform the update on their behalf.
 *
 * @param {ChatMessage} message
 * @param {-1|0|1} mode
 * @param {number} rollIndex
 */
export async function requestAdvantageChange(message, mode, rollIndex) {
    if (!canUserModifyRoll(message)) return;

    if (message.canUserModify(game.user, "update")) {
        await updateMessageRoll(message, mode, rollIndex);
    } else {
        game.socket.emit(`module.${MODULE_ID}`, {
            action: "retroactiveAdvantageUpdate",
            messageId: message.id,
            mode,
            rollIndex,
            userId: game.user.id
        });
    }
}

/**
 * Handle incoming socket messages for retroactive advantage changes.
 * Dispatched from the central socket router in main.js.
 *
 * @param {object} data
 */
export async function onSocketMessage(data) {
    if (data?.action !== "retroactiveAdvantageUpdate") return;
    if (!game.users.activeGM?.isSelf) return;

    const message = game.messages.get(data.messageId);
    if (!message) return;

    const sender = game.users.get(data.userId);
    if (!sender) return;

    // Validate that sender is authorized to change this roll
    const isAuthorized = sender.isGM
        || (message.author?.id === data.userId)
        || (message.actor?.testUserPermission(sender, "OWNER"));

    if (!isAuthorized) {
        log(`Rejected unauthorized retroactive advantage request for message ${data.messageId} from user ${data.userId}`);
        return;
    }

    try {
        await updateMessageRoll(message, data.mode, data.rollIndex ?? 0);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to update roll via GM socket:", err);
    }
}

/**
 * Determine if the chat message card is rendered in Dark Mode.
 * In DnD5e v6, chat cards are light parchment by default unless chatLogTheme is "dark".
 *
 * @param {HTMLElement} targetEl
 * @returns {boolean}
 */
export function isChatDark(targetEl) {
    const dndTheme = game.settings.settings.has("dnd5e.chatLogTheme")
        ? game.settings.get("dnd5e", "chatLogTheme")
        : "";
    if (dndTheme === "dark") return true;
    if (dndTheme === "light") return false;

    const chatLog = targetEl?.closest(".chat-log, .chat-popout");
    if (chatLog?.classList.contains("theme-dark")) return true;
    if (chatLog?.classList.contains("theme-light")) return false;

    const message = targetEl?.closest(".chat-message, .message");
    if (message?.classList.contains("theme-dark")) return true;
    if (message?.classList.contains("theme-light")) return false;

    return false;
}

/**
 * Inject the Retroactive Advantage buttons into a rendered chat card.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement|JQuery} html
 */
function insertButtons(message, html) {
    if (!isFeatureActive("enableRetroactiveAdvantage", "clientEnableRetroactiveAdvantage")) return;
    if (!canUserModifyRoll(message)) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    // Unconditionally remove any existing menus in root to prevent duplicates
    root.querySelectorAll(".nd5t-retro-advantage").forEach(el => el.remove());

    // Find the first D20 roll
    const rollIndex = message.rolls?.findIndex(r => r instanceof CONFIG.Dice.D20Roll) ?? -1;
    if (rollIndex === -1) return;
    const roll = message.rolls[rollIndex];

    const diceRollEls = root.querySelectorAll(".dice-roll");
    const diceRollEl = diceRollEls[rollIndex] ?? diceRollEls[0];
    if (!diceRollEl) return;

    const currentMode = roll.options?.advantageMode ?? 0;
    const hoverOnly = game.settings.get(MODULE_ID, "retroactiveAdvantageHoverOnly");
    const isDark = isChatDark(diceRollEl);
    const themeClass = isDark ? "nd5t-theme-dark" : "nd5t-theme-light";

    const menu = root.ownerDocument.createElement("menu");
    menu.className = `nd5t-retro-advantage ${themeClass}` + (hoverOnly ? " nd5t-hover-only" : "");

    const options = [
        { key: "Advantage", mode: 1, label: "ADV" },
        { key: "Normal", mode: 0, label: "NORMAL" },
        { key: "Disadvantage", mode: -1, label: "DISADV" }
    ];

    for (const opt of options) {
        const fullLabel = game.i18n.localize(`DND5E.${opt.key}`);
        const button = root.ownerDocument.createElement("button");
        button.type = "button";
        button.dataset.advantageMode = String(opt.mode);
        button.dataset.tooltip = fullLabel;
        button.setAttribute("aria-label", fullLabel);
        button.className = "nd5t-retro-btn" + (currentMode === opt.mode ? " active" : "");
        button.disabled = (currentMode === opt.mode);
        button.textContent = opt.label;
        menu.appendChild(button);
    }

    menu.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-advantage-mode]");
        if (!btn || btn.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        const targetMode = Number(btn.dataset.advantageMode);
        requestAdvantageChange(message, targetMode, rollIndex);
    });

    // Insert menu outside .icon-row, directly after the roll row so it forms
    // its own full-width segmented control beneath the roll without shifting existing card elements.
    const iconRow = diceRollEl.closest(".icon-row");
    const targetEl = iconRow ?? diceRollEl;
    targetEl.insertAdjacentElement("afterend", menu);
}

/**
 * Tag existing chat messages already present in the DOM.
 */
function tagExistingMessages() {
    for (const msgEl of document.querySelectorAll(".chat-log .message, .chat-popout .message")) {
        const msgId = msgEl.dataset.messageId;
        const message = game.messages?.get?.(msgId);
        if (message) insertButtons(message, msgEl);
    }
}

/**
 * Initialize the Retroactive Advantage feature.
 */
export function initRetroactiveAdvantage() {
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        insertButtons(message, html);
    });

    Hooks.once("ready", () => {
        tagExistingMessages();
    });
}
