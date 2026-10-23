/**
 * Feature: Hide Private GM Rolls from Players
 * Description: Completely suppresses whispered, private, and blind GM rolls from player chat logs, preventing empty placeholder cards with hidden content from revealing secret rolls.
 *
 * @introduced v14.30.0
 */
import { getSetting, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Hide Private GM Rolls from Players
 *
 * In Foundry VTT, when a GM makes a whispered, private, or blind roll (e.g. /gmroll,
 * /blindroll, /selfroll, or rolling an activity/attack card privately), ChatMessage.prototype.visible
 * contains a hardcoded core check: `if ( this.isRoll ) return true;`.
 *
 * Because of this override, Foundry displays an empty chat card with hidden contents ("???")
 * to players, alerting them that the GM rolled behind the screen.
 *
 * This feature patches `ChatMessage.prototype.visible` so that whispered, private, and blind
 * rolls authored by a GM are completely invisible to non-GM players (unless the player is an
 * explicit whisper recipient).
 */

export function initHidePrivateGMRolls() {
    patchMethod(
        "CONFIG.ChatMessage.documentClass.prototype.visible#get",
        function(wrapped) {
            // If the feature is disabled, use default Foundry behavior
            if (!getSetting("enableHidePrivateGMRolls")) {
                return wrapped();
            }

            // GMs should always see all messages according to core logic
            if (game.user?.isGM) {
                return wrapped();
            }

            // Determine if the message author is a GM
            const author = this.author ?? game.users?.get(this.user ?? this._source?.author);
            const isAuthorGM = Boolean(author?.isGM);

            // If the message was not authored by a GM, use default behavior
            if (!isAuthorGM) {
                return wrapped();
            }

            // The author is a GM, and current user is a non-GM player.
            // Check if this message is a whispered, private, or blind roll.
            const hasWhisper = Array.isArray(this.whisper) && this.whisper.length > 0;
            const isBlind = Boolean(this.blind);
            const isRoll = Boolean(
                this.isRoll
                || (this.rolls && this.rolls.length > 0)
                || this.flags?.dnd5e?.roll
                || this.type === "roll"
            );

            if ((hasWhisper || isBlind) && isRoll) {
                // Blind rolls by GM are never visible to non-GM players
                if (isBlind) return false;

                // For whispered rolls, only visible if the player is explicitly in the whisper list
                const isRecipient = hasWhisper && this.whisper.includes(game.user.id);
                if (!isRecipient) return false;

                return wrapped();
            }

            return wrapped();
        },
        "MIXED"
    );

    // Defense-in-depth: if any other module manually rendered or injected an invisible message
    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!getSetting("enableHidePrivateGMRolls")) return;
        if (game.user?.isGM) return;
        if (!message.visible) {
            const el = html instanceof HTMLElement ? html : html?.[0];
            if (el) {
                el.style.display = "none";
                el.remove?.();
            }
        }
    });

    debug("Hide Private GM Rolls | Initialized");
}
