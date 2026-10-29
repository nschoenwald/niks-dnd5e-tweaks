/**
 * Feature: Readable Text Size
 * Description: Enlarges description body text (item descriptions, biographies, journal pages, expanded item
 * summaries, item tooltips and optionally chat card descriptions) and loosens its line spacing, without
 * changing the size of the rest of the interface.
 *
 * The GM sets the world default; each player can override it.
 *
 * @introduced v14.56.0
 */
import { MODULE_ID, log } from "../../main.js";

const LEVEL_CLASSES = {
    comfortable: "nd5t-readable-text-comfortable",
    large: "nd5t-readable-text-large"
};

/**
 * Resolve the effective level and chat option: the player's override, or the GM's world setting.
 * @returns {{ level: string, chat: boolean }}
 */
function _getEffectiveSettings() {
    const clientLevel = game.settings.get(MODULE_ID, "clientReadableTextSize");
    const clientChat = game.settings.get(MODULE_ID, "clientReadableTextSizeChat");
    // Anything other than an explicit override (incl. unknown stored values) follows the world setting
    const level = (clientLevel === "off" || clientLevel in LEVEL_CLASSES)
        ? clientLevel : game.settings.get(MODULE_ID, "readableTextSize");
    const chat = (clientChat === "on" || clientChat === "off")
        ? clientChat === "on" : game.settings.get(MODULE_ID, "readableTextSizeChat");
    return { level, chat };
}

/**
 * Apply the body classes for the current settings. The CSS does all the work.
 */
export function updateReadableTextSize() {
    const { level, chat } = _getEffectiveSettings();
    const body = document.body;
    const active = level in LEVEL_CLASSES;

    body.classList.toggle("nd5t-readable-text", active);
    for (const [key, cls] of Object.entries(LEVEL_CLASSES)) body.classList.toggle(cls, key === level);
    body.classList.toggle("nd5t-readable-text-chat", active && chat);

    log(`Readable Text Size: ${active ? level : "off"}${active && chat ? " (incl. chat cards)" : ""}`);
}
