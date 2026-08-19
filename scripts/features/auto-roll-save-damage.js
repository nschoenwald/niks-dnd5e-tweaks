import { MODULE_ID, debug, log } from "../main.js";

/**
 * Auto-Roll Save Damage
 *
 * When a Save activity (e.g. a spell with a saving throw and damage) is used,
 * automatically opens the damage roll dialog — matching the behaviour of Attack
 * activities, which already auto-open the attack roll dialog.
 *
 * The damage is NOT rolled automatically; the dialog simply opens so the user
 * can confirm or configure the roll, exactly as if they had clicked the
 * "Damage" button on the chat card.
 *
 * This feature is automatically disabled when midi-qol is active, because
 * midi-qol takes over the entire activity workflow (including auto-rolling
 * damage) and running both would produce duplicate damage rolls.
 */

let _hookId = null;

/**
 * Hook handler for dnd5e.postUseActivity.
 * @param {Activity} activity       The activity that was just used.
 * @param {object} usageConfig      Configuration data for the activation.
 * @param {object} results          Final details on the activation.
 */
function _onPostUseActivity(activity, usageConfig, results) {
    if (!game.settings.get(MODULE_ID, "enableAutoRollSaveDamage")) return;

    // Only act on Save-type activities that actually have damage parts
    if (activity.type !== "save") return;
    if (!activity.damage?.parts?.length) return;

    debug("Auto-Roll Save Damage | Save activity with damage detected, opening damage dialog", activity);
    activity.rollDamage(
        { event: usageConfig.event },
        {},
        {
            data: {
                "flags.dnd5e.originatingMessage": results?.message?.id,
                "flags.dnd5e.targets": results?.message?.getFlag("dnd5e", "targets")
            }
        }
    );
}

/**
 * Initialise the feature by registering the hook.
 * Called once during module setup.
 *
 * Automatically skips registration when midi-qol is active, since midi-qol
 * manages its own damage roll workflow for all activity types.
 */
export function initAutoRollSaveDamage() {
    if (game.modules.get("midi-qol")?.active) {
        log("Auto-Roll Save Damage | midi-qol detected — feature disabled to avoid duplicate damage rolls.");
        return;
    }
    _hookId = Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
    debug("Auto-Roll Save Damage | Initialized");
}

