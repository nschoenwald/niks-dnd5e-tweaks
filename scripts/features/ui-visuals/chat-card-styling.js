/**
 * Feature: Chat Card Styling Improvements
 * Description: Enhances DnD5e chat cards with color-coded borders, distinct theme styling for light and dark modes, enlarged action buttons with text labels, roll badges, and multi-dice breakdown indicators.
 *
 * @introduced v14.28.0
 */
import { MODULE_ID, log, isFeatureActive } from "../../main.js";

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
 * Determine the subtype for a healing roll ("temphp" vs "healing").
 *
 * Checks message.rolls (DamageRoll options and term flavors) first,
 * falling back to the associated activity's configured healing types.
 *
 * @param {ChatMessage} message
 * @returns {"temphp"|"healing"}
 */
function _getHealingSubtype(message) {
    if (!message) return "healing";

    // 1. Inspect rolls
    if (message.rolls?.length) {
        let hasTempHp = false;
        let hasRealHealing = false;

        for (const roll of message.rolls) {
            const rollType = roll.options?.type;
            if (rollType === "temphp") hasTempHp = true;
            else if (rollType === "healing") hasRealHealing = true;

            // Also check roll terms flavor if type wasn't explicit on roll.options
            if (roll.terms?.length) {
                for (const term of roll.terms) {
                    const flavor = term.flavor?.toLowerCase().trim();
                    if (flavor === "temphp") hasTempHp = true;
                    else if (flavor === "healing") hasRealHealing = true;
                }
            }
        }

        if (hasTempHp && !hasRealHealing) return "temphp";
        if (hasRealHealing) return "healing";
    }

    // 2. Fallback to associated activity
    const activity = (typeof message.getAssociatedActivity === "function" ? message.getAssociatedActivity() : null)
        ?? (message.system?.activity?.uuid ? fromUuidSync(message.system.activity.uuid) : null);
    const healingTypes = activity?.healing?.types;
    if (healingTypes) {
        const hasType = (t) => healingTypes instanceof Set
            ? healingTypes.has(t)
            : Array.isArray(healingTypes)
                ? healingTypes.includes(t)
                : false;
        if (hasType("temphp") && !hasType("healing")) return "temphp";
    }

    return "healing";
}

/**
 * Format the subtitle of healing rolls: for temporary HP rolls, replace the
 * default system subtitle ("Healing Roll") with "Temp HP Roll".
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} root
 */
function _formatHealingSubtitle(message, root) {
    const rawRollType = message.type ?? message.flags?.dnd5e?.roll?.type;
    const rollType = rawRollType?.toLowerCase();
    if (rollType !== "healing") return;
    if (root.dataset.nd5tCardSubtype !== "temphp") return;

    const subtitleEl = root.querySelector(".card-header .name-stacked .subtitle");
    if (!subtitleEl) return;

    if (!subtitleEl.dataset.originalSubtitle) {
        subtitleEl.dataset.originalSubtitle = subtitleEl.textContent;
    }

    const localizedHealing = game.i18n?.localize?.("DND5E.HEAL.HealingRoll") ?? "Healing Roll";
    const tempHpLabel = game.i18n?.localize?.("ND5T.ChatCard.TempHpRoll") ?? "Temp HP Roll";

    let text = subtitleEl.textContent;
    if (localizedHealing && text.includes(localizedHealing)) {
        text = text.replace(localizedHealing, tempHpLabel);
    } else {
        text = text.replace(/Healing Roll/gi, tempHpLabel);
    }
    subtitleEl.textContent = text;
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

    const subType = root.dataset.nd5tCardSubtype;
    const accentVar = (rollType === "healing" && subType === "temphp")
        ? "var(--nd5t-temphp-border-color)"
        : `var(--nd5t-${rollType}-border-color)`;
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

        // Tag the sub-type (e.g. "death" / "concentration" for saves, "initiative" for checks, "temphp" for healing)
        // so CSS can use [data-nd5t-card-subtype] to apply precise micro-labels without adding
        // extra JS-only card classes.
        let subType = message.system?.type;
        if (rollType === "healing") {
            const healingSubtype = _getHealingSubtype(message);
            if (healingSubtype === "temphp") {
                subType = "temphp";
                root.classList.add("nd5t-temphp-card");
            } else {
                root.classList.remove("nd5t-temphp-card");
            }
        }
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
    _formatHealingSubtitle(message, root);
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

    // Dynamically adjust roll result horizontal positioning on all dice buttons
    // so centered totals never collide with multi-die badges.
    _adjustRollResultPositions(root);
}


/**
 * Map of ResizeObserver instances keyed by the Window object they were created in.
 * `ResizeObserver` is window-context-specific — an observer created in the main
 * window cannot observe elements living in a detached popout window, and vice-versa.
 * Using a WeakMap ensures each window context gets its own observer and allows
 * garbage collection when popout windows are closed.
 * @type {WeakMap<Window, ResizeObserver>}
 */
const _rollResultResizeObservers = new WeakMap();

/**
 * Get or create the ResizeObserver for the given window context.
 * Automatically recalculates roll result positioning whenever buttons change size
 * (e.g. sidebar expand/collapse, popout resize, window resizing).
 * @param {Window} [win] - The window context; defaults to the main `window`.
 * @returns {ResizeObserver|null}
 */
function _getRollResultResizeObserver(win = window) {
    if (typeof ResizeObserver === "undefined") return null;
    const WinResizeObserver = win.ResizeObserver ?? ResizeObserver;
    if (!_rollResultResizeObservers.has(win)) {
        const observer = new WinResizeObserver((entries) => {
            for (const entry of entries) {
                const btn = entry.target;
                if (btn instanceof win.HTMLElement) {
                    _adjustButtonRollResult(btn);
                }
            }
        });
        _rollResultResizeObservers.set(win, observer);
    }
    return _rollResultResizeObservers.get(win);
}

/**
 * Adjust the horizontal position of the roll result inside a dice-roll button.
 *
 * Normally, .result is centered horizontally in button.dice-roll.
 * However, when multiple d20 dice are shown (advantage, disadvantage, Elven
 * Accuracy) or in narrow chat containers / long roll values, the right edge of
 * the centered roll result could overlap the d20 icons.
 *
 * If (and ONLY if) an overlap would occur, this pushes the roll result from the
 * center to the left just enough to clear the d20s with a clean breathing gap (6px),
 * while preventing it from colliding with the left-hand icon.
 * If there is sufficient clearance, no shift is applied and the result remains
 * perfectly centered.
 *
 * @param {HTMLButtonElement} btn
 */
function _adjustButtonRollResult(btn) {
    if (!btn || !btn.isConnected) return;

    const resultEl = btn.querySelector(".result");
    if (!resultEl) return;

    const diceEl = btn.querySelector(".nd5t-d20-multi, .d20die");
    if (!diceEl) {
        resultEl.style.removeProperty("transform");
        return;
    }

    // Reset transform first so we measure the natural unshifted layout
    resultEl.style.transform = "";

    const btnRect = btn.getBoundingClientRect();
    const resultRect = resultEl.getBoundingClientRect();
    const diceRect = diceEl.getBoundingClientRect();

    // If unrendered / hidden (0 size), nothing to measure
    if (btnRect.width === 0 || resultRect.width === 0 || diceRect.width === 0) return;

    const isRTL = getComputedStyle(btn).direction === "rtl";
    const minGap = 6; // px minimum breathing room between roll result and dice

    const iconsEl = btn.querySelector(".icons");
    const iconsRect = (iconsEl && iconsEl.offsetWidth > 0) ? iconsEl.getBoundingClientRect() : null;

    if (!isRTL) {
        // LTR: icons on left, dice on right.
        // Overlap occurs if result's right boundary + minGap extends past dice's left boundary.
        const overlap = (resultRect.right + minGap) - diceRect.left;

        if (overlap > 0) {
            // Overlap detected: push to the left, bounded by the left icons/edge.
            const leftBound = iconsRect ? (iconsRect.right + minGap) : (btnRect.left + 8 + minGap);
            const maxLeftShift = Math.max(0, resultRect.left - leftBound);
            const shift = Math.min(Math.ceil(overlap), Math.floor(maxLeftShift));

            if (shift > 0) {
                resultEl.style.transform = `translateX(-${shift}px)`;
            } else {
                resultEl.style.transform = "";
            }
        } else {
            // Sufficient space: keep natural centered position
            resultEl.style.transform = "";
        }
    } else {
        // RTL: dice on left, icons on right.
        // Overlap occurs if dice's right boundary + minGap extends past result's left boundary.
        const overlap = (diceRect.right + minGap) - resultRect.left;

        if (overlap > 0) {
            const rightBound = iconsRect ? (iconsRect.left - minGap) : (btnRect.right - 8 - minGap);
            const maxRightShift = Math.max(0, rightBound - resultRect.right);
            const shift = Math.min(Math.ceil(overlap), Math.floor(maxRightShift));

            if (shift > 0) {
                resultEl.style.transform = `translateX(${shift}px)`;
            } else {
                resultEl.style.transform = "";
            }
        } else {
            resultEl.style.transform = "";
        }
    }
}

/**
 * Adjust the roll result positions for all dice-roll buttons in a given container.
 * Also registers them with the ResizeObserver for their window context.
 *
 * @param {HTMLElement} root
 */
function _adjustRollResultPositions(root) {
    if (!root) return;
    const diceButtons = root.querySelectorAll("button.dice-roll");
    if (!diceButtons.length) return;

    // Derive the window context from the element's ownerDocument so popout
    // windows use their own observer rather than the main window's observer.
    const win = root.ownerDocument?.defaultView ?? window;
    const observer = _getRollResultResizeObserver(win);

    for (const btn of diceButtons) {
        observer?.observe(btn);
        if (btn.isConnected && btn.offsetWidth > 0) {
            _adjustButtonRollResult(btn);
        } else {
            requestAnimationFrame(() => {
                if (btn.isConnected) _adjustButtonRollResult(btn);
            });
        }
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
        if (message) {
            _tagMessageElement(message, msgEl);
            _expandD20DieDisplay(message, msgEl);
        }
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

    // Disconnect and reset all resize observers across all window contexts
    for (const observer of _rollResultResizeObservers.values?.() ?? []) {
        try { observer.disconnect(); } catch (_) {}
    }
    // WeakMap entries are garbage-collected automatically when their window keys are
    // closed/collected; explicitly delete the main window entry to allow recreation.
    _rollResultResizeObservers.delete(window);

    // Restore roll result transform
    for (const res of document.querySelectorAll("button.dice-roll .result")) {
        res.style.removeProperty("transform");
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
        if (app?.message && el) {
            _tagMessageElement(app.message, el);
            _expandD20DieDisplay(app.message, el);
        }
    });
}
