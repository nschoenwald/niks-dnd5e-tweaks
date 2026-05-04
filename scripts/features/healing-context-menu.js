import { MODULE_ID, log, debug } from "../main.js";

/**
 * Healing Context Menu Patch
 * 
 * The dnd5e system's ChatMessage5e.canApplyDamage getter only returns true
 * for rolls flagged with type "damage". This means healing rolls (type "healing")
 * don't show the right-click context menu options to apply damage/healing/temp HP
 * to selected tokens.
 * 
 * This patch overrides the canApplyDamage getter so it also returns true for
 * healing-type rolls, enabling the full suite of context menu options.
 * 
 * The applyChatCardDamage method in dnd5e already correctly handles healing types
 * internally (it checks CONFIG.DND5E.healingTypes and inverts the multiplier),
 * so no further patching is needed — only the visibility gate needs to be fixed.
 */

export function initHealingContextMenu() {
    if (!game.settings.get(MODULE_ID, "enableHealingContextMenu")) return;

    const ChatMessage5e = CONFIG.ChatMessage.documentClass;

    // Store the original descriptor so we can preserve any other behavior
    const originalDescriptor = Object.getOwnPropertyDescriptor(ChatMessage5e.prototype, "canApplyDamage");

    if (!originalDescriptor || !originalDescriptor.get) {
        log("Warning: Could not find canApplyDamage getter on ChatMessage5e — healing context menu patch skipped.");
        return;
    }

    const originalGetter = originalDescriptor.get;

    Object.defineProperty(ChatMessage5e.prototype, "canApplyDamage", {
        get() {
            const type = this.flags.dnd5e?.roll?.type;

            // The original getter rejects anything that isn't "damage".
            // We extend it to also allow "healing" (which covers both
            // regular healing and temp HP rolls in dnd5e).
            if (type === "healing") {
                debug("canApplyDamage override: allowing healing roll type");
                return this.isRoll && this.isContentVisible && !!canvas.tokens?.controlled.length;
            }

            // For all other types, fall through to the original behavior
            return originalGetter.call(this);
        },
        configurable: true,
        enumerable: originalDescriptor.enumerable
    });

    log("Healing context menu patch applied — healing rolls now show Apply Damage/Healing/Temp HP options.");
}
