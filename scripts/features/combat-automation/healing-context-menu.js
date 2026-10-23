/**
 * Feature: Healing Roll Context Menu
 * Description: Adds right-click context menu options (Apply Damage, Apply Healing, Apply Temp HP) to healing roll chat cards.
 *
 * @introduced v14.7.0
 */
import { getSetting, log, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

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
    patchMethod(
        "CONFIG.ChatMessage.documentClass.prototype.canApplyDamage#get",
        function(wrapped) {
            if (!getSetting("enableHealingContextMenu")) {
                return wrapped();
            }

            const type = this.type ?? this.flags?.dnd5e?.roll?.type;
            const isHealing = type === "healing" || this.system?.isHealing;

            // The original getter rejects anything that isn't "damage".
            // We extend it to also allow "healing" (which covers both
            // regular healing and temp HP rolls in dnd5e).
            if (isHealing) {
                debug("canApplyDamage override: allowing healing roll type");
                return this.isRoll && this.isContentVisible && !!canvas.tokens?.controlled.length;
            }

            // For all other types, fall through to the original behavior
            return wrapped();
        },
        "MIXED"
    );

    log("Healing context menu patch applied — healing rolls now show Apply Damage/Healing/Temp HP options.");
}
