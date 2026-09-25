import { MODULE_ID, log, isFeatureActive } from "../main.js";

/**
 * Roll types that this feature applies card-specific styling to.
 * Other message.type values ("base", "usage", "rest", etc.) are intentionally
 * excluded — they don't have distinct roll-type visuals.
 * @type {Set<string>}
 */
const STYLED_ROLL_TYPES = new Set(["attack", "damage", "check", "save", "healing", "hitdie", "recharge"]);

/**
 * Format the subtitle of damage rolls so it only shows "Damage Roll"
 * instead of "Attack • Damage Roll".
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function _formatDamageSubtitle(message, root) {
    const rawRollType = message.type ?? message.flags?.dnd5e?.roll?.type;
    const rollType = rawRollType?.toLowerCase();
    if (rollType !== "damage") return;
    const subtitleEl = root.querySelector(".card-header .name-stacked .subtitle");
    if (!subtitleEl) return;
    // Guard: only stash the original once so double-hook calls don't overwrite it.
    if (!subtitleEl.dataset.originalSubtitle) {
        subtitleEl.dataset.originalSubtitle = subtitleEl.textContent;
    }
    const text = subtitleEl.textContent.trim();
    // Split on common subtitle delimiters including em-dash, en-dash, bullets, and pipe.
    const parts = text.split(/\s*(?:[•\u2022\u2023\u25E6\u2043\u2219·\-|]|\u2013|\u2014|&bull;)\s*/);
    if (parts.length > 1) {
        subtitleEl.textContent = parts[parts.length - 1].trim();
    }
}

/**
 * Override Foundry's inline player border color with the themed roll-type accent border.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function _applyCardBorders(message, root) {
    const rawRollType = message.type ?? message.flags?.dnd5e?.roll?.type;
    const rollType = rawRollType?.toLowerCase();
    const isStyledRoll = Boolean(rollType && STYLED_ROLL_TYPES.has(rollType));
    const isWhisper = Boolean(message.whisper?.length);
    const isBlind = Boolean(message.blind);
    const isEmote = message.style === CONST.CHAT_MESSAGE_STYLES?.EMOTE;

    // Guard: only stash the original border-color once so double-hook calls don't overwrite it.
    if (root.style.borderColor && !root.dataset.originalBorderColor) {
        root.dataset.originalBorderColor = root.style.borderColor;
    }
    if (isStyledRoll || isWhisper || isBlind || isEmote) {
        root.style.removeProperty("border-color");
    }

    if (!isStyledRoll) return;

    const accentVar = `var(--nd5t-${rollType}-border-color)`;
    const goldVar = "var(--dnd5e-color-gold, #c9a227)";

    root.style.setProperty("border-top-color", goldVar, "important");
    root.style.setProperty("border-right-color", goldVar, "important");
    root.style.setProperty("border-bottom-color", goldVar, "important");
    root.style.setProperty("border-color", goldVar, "important");
    root.style.setProperty("border-left", `4px solid ${accentVar}`, "important");
    root.style.setProperty("border-left-color", accentVar, "important");
    root.style.setProperty("border-left-width", "4px", "important");
    root.style.setProperty("border-left-style", "solid", "important");
}

/**
 * Tag a rendered chat message element with its roll/card type
 * (e.g. nd5t-attack-card, nd5t-damage-card), visibility type (blind, private, whisper),
 * apply border styling, and format subtitle.
 *
 * Both renderChatMessageHTML and dnd5e.renderChatMessage call this for the same message.
 * This is intentional: renderChatMessageHTML fires early (before card templates fill in
 * the subtitle), while dnd5e.renderChatMessage fires after the system templates are done.
 * The dataset guards in _applyCardBorders and _formatDamageSubtitle make double calls safe.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function _tagMessageElement(message, root) {
    if (!root) return;
    const rawRollType = message.type ?? message.flags?.dnd5e?.roll?.type;
    const rollType = rawRollType?.toLowerCase();
    const isStyledRoll = Boolean(rollType && STYLED_ROLL_TYPES.has(rollType));

    // Only add styled classes for known roll types — avoids nd5t-base-card, nd5t-usage-card, etc.
    if (isStyledRoll) {
        root.dataset.nd5tCardType = rollType;
        root.classList.add(`nd5t-${rollType}-card`);

        // Tag the sub-type (e.g. "death" / "concentration" for saves, "initiative" for checks)
        // so CSS can use [data-nd5t-card-subtype] to apply precise micro-labels without adding
        // extra JS-only card classes.
        const subType = message.system?.type;
        if (subType) {
            root.dataset.nd5tCardSubtype = subType;
        } else {
            delete root.dataset.nd5tCardSubtype;
        }
    }

    // Determine message visibility type (blind roll, private roll, whisper, emote)
    const isBlind = Boolean(message.blind);
    const isWhisper = Boolean(message.whisper?.length);
    const isRoll = Boolean(message.isRoll || message.rolls?.length > 0 || isStyledRoll);

    if (isBlind) {
        root.dataset.nd5tVisibility = "blind";
        root.classList.add("nd5t-blind-card");
        root.classList.remove("nd5t-private-roll", "nd5t-whisper-card");
    } else if (isWhisper) {
        if (isRoll) {
            root.dataset.nd5tVisibility = "private";
            root.classList.add("nd5t-private-roll");
            root.classList.remove("nd5t-whisper-card", "nd5t-blind-card");
        } else {
            root.dataset.nd5tVisibility = "whisper";
            root.classList.add("nd5t-whisper-card");
            root.classList.remove("nd5t-private-roll", "nd5t-blind-card");
        }
    } else if (message.style === CONST.CHAT_MESSAGE_STYLES?.EMOTE) {
        root.dataset.nd5tVisibility = "emote";
        root.classList.remove("nd5t-private-roll", "nd5t-whisper-card", "nd5t-blind-card");
    } else {
        delete root.dataset.nd5tVisibility;
        root.classList.remove("nd5t-private-roll", "nd5t-whisper-card", "nd5t-blind-card");
    }

    _applyCardBorders(message, root);
    _formatDamageSubtitle(message, root);
}

/**
 * Expand the d20 die indicator in roll buttons to show ALL individual dice,
 * not just the final kept result. This makes advantage / disadvantage / Elven
 * Accuracy (3d20) immediately visible in the chat card.
 *
 * The dnd5e system renders .d20die as position:absolute at inset-inline-end:8px
 * inside the button. Cloning that element produces stacked copies at the same
 * position. Instead, we replace the single .d20die with a custom
 * .nd5t-d20-multi span (also absolutely positioned at the same anchor) that
 * holds one badge per die — each badge is a hex icon + number pair in its own
 * inline-flex row.
 *
 * Idempotent: the data-nd5t-d20-expanded attribute prevents double-processing.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function _expandD20DieDisplay(message, root) {
    if (!root) return;
    if (!message?.rolls?.length) return;

    const diceButtons = root.querySelectorAll("button.dice-roll");
    if (!diceButtons.length) return;

    let rollIndex = 0;
    for (const btn of diceButtons) {
        // Guard: skip already-expanded buttons.
        if (btn.dataset.nd5tD20Expanded) {
            rollIndex++;
            continue;
        }

        const originalD20Span = btn.querySelector(".d20die");
        if (!originalD20Span) {
            rollIndex++;
            continue;
        }

        const roll = message.rolls[rollIndex];
        rollIndex++;

        // Only D20Roll instances expose .d20.
        const d20Die = roll?.d20;
        if (!d20Die) continue;

        const allResults = d20Die.results;
        if (!allResults || allResults.length <= 1) continue;

        // Keep the original order of rolls (chronological order as rolled)
        const multi = document.createElement("span");
        multi.className = "nd5t-d20-multi";

        for (let i = 0; i < allResults.length; i++) {
            const r = allResults[i];
            const isActive = r.active ?? !r.discarded;

            const badge = document.createElement("span");
            badge.className = "nd5t-d20-badge" + (isActive ? " nd5t-d20-active" : " nd5t-d20-discarded");

            // Hex icon — same classes as the original .d20die > i
            const icon = document.createElement("i");
            icon.className = "fa-fw fa-solid fa-hexagon fa-rotate-90";
            icon.setAttribute("inert", "");

            // Number span
            const rollSpan = document.createElement("span");
            rollSpan.className = "roll";
            rollSpan.textContent = r.result;

            badge.appendChild(icon);
            badge.appendChild(rollSpan);
            multi.appendChild(badge);
        }

        // Replace the original .d20die with our multi element.
        originalD20Span.replaceWith(multi);

        btn.dataset.nd5tD20Expanded = "1";
    }
}


/**
 * Scan all chat message elements in the current DOM and tag/format them.
 */
function _tagExistingMessages() {
    // #chat-log is always also .chat-log, so omit it to avoid querySelectorAll duplication.
    for (const msgEl of document.querySelectorAll(".chat-log .message, .chat-popout .message")) {
        const msgId = msgEl.dataset.messageId;
        const message = game.messages?.get?.(msgId);
        if (message) _tagMessageElement(message, msgEl);
    }
}

/**
 * Enable Chat Card Styling Improvements.
 * Adds the styling class to document.body and any active popout windows,
 * and tags/formats existing chat messages in the DOM.
 */
export function enableChatCardStyling() {
    document.body.classList.add("nd5t-chat-card-styling");
    for (const popout of foundry.applications?.detached?.querySelectorAll?.(".chat-popout") ?? []) {
        popout.ownerDocument?.body?.classList.add("nd5t-chat-card-styling");
    }
    _tagExistingMessages();
    log("Chat Card Styling Improvements enabled");
}

/**
 * Disable Chat Card Styling Improvements.
 * Removes the styling class from document.body and any active popout windows,
 * and restores original borders, subtitles, and card-type classes.
 */
export function disableChatCardStyling() {
    document.body.classList.remove("nd5t-chat-card-styling");
    for (const popout of foundry.applications?.detached?.querySelectorAll?.(".chat-popout") ?? []) {
        popout.ownerDocument?.body?.classList.remove("nd5t-chat-card-styling");
    }
    for (const msgEl of document.querySelectorAll(".chat-log .message, .chat-popout .message")) {
        // Restore subtitle
        const subtitleEl = msgEl.querySelector(".card-header .name-stacked .subtitle");
        if (subtitleEl?.dataset.originalSubtitle) {
            subtitleEl.textContent = subtitleEl.dataset.originalSubtitle;
            delete subtitleEl.dataset.originalSubtitle;
        }

        // Remove card-type and visibility classes and data attributes
        for (const cls of [...msgEl.classList]) {
            if ((cls.startsWith("nd5t-") && cls.endsWith("-card")) || cls === "nd5t-private-roll") {
                msgEl.classList.remove(cls);
            }
        }
        delete msgEl.dataset.nd5tCardType;
        delete msgEl.dataset.nd5tCardSubtype;
        delete msgEl.dataset.nd5tVisibility;

        // Restore inline borders
        msgEl.style.removeProperty("border-left");
        msgEl.style.removeProperty("border-left-color");
        msgEl.style.removeProperty("border-left-width");
        msgEl.style.removeProperty("border-left-style");
        msgEl.style.removeProperty("border-top-color");
        msgEl.style.removeProperty("border-right-color");
        msgEl.style.removeProperty("border-bottom-color");
        if (msgEl.dataset.originalBorderColor) {
            msgEl.style.borderColor = msgEl.dataset.originalBorderColor;
            delete msgEl.dataset.originalBorderColor;
        } else {
            msgEl.style.removeProperty("border-color");
        }
    }
    log("Chat Card Styling Improvements disabled");
}

/**
 * Initialize Chat Card Styling Improvements feature.
 */
export function initChatCardStyling() {
    if (isFeatureActive("enableChatCardStyling", "clientEnableChatCardStyling")) {
        enableChatCardStyling();
    }

    // Tag and format messages as they are rendered in HTML.
    // Both hooks call _tagMessageElement; the dataset guards inside make double-runs safe.
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!isFeatureActive("enableChatCardStyling", "clientEnableChatCardStyling")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        _tagMessageElement(message, root);
    });

    // dnd5e.renderChatMessage fires after system card templates (damage-card.hbs, etc.)
    // have rendered, ensuring the subtitle element exists when we try to format it.
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        if (!isFeatureActive("enableChatCardStyling", "clientEnableChatCardStyling")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        _tagMessageElement(message, root);
        // Expand multi-die displays (advantage / disadvantage / Elven Accuracy)
        // after the system has injected .d20die spans into the button.
        _expandD20DieDisplay(message, root);
    });

    // Re-tag messages once game is ready (chat log populated with historical messages).
    // Note: enableChatCardStyling() already calls _tagExistingMessages() at init time,
    // but the ready hook is needed for the case where the chat log finishes rendering
    // after initChatCardStyling runs (e.g., late-loading or deferred chat population).
    Hooks.once("ready", () => {
        if (isFeatureActive("enableChatCardStyling", "clientEnableChatCardStyling")) {
            _tagExistingMessages();
        }
    });

    // Ensure popouts in detached windows also receive the styling class.
    Hooks.on("renderChatPopout", (app, element) => {
        if (!isFeatureActive("enableChatCardStyling", "clientEnableChatCardStyling")) return;
        const el = element instanceof HTMLElement ? element : element?.[0];
        const doc = el?.ownerDocument;
        if (doc && !doc.body.classList.contains("nd5t-chat-card-styling")) {
            doc.body.classList.add("nd5t-chat-card-styling");
        }
    });
}
