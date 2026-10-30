/**
 * Feature: Auto-Open Damage Dialog for Saves
 * Description: Automatically opens the damage roll dialog when a Save-type activity containing damage is activated.
 *
 * @introduced v14.7.0
 * @updated v14.58.1 (Damage roll uses the targets of the placed area template, not the ones recorded before placement)
 */
import { getSetting, debug, log, isFeatureActive } from "../../main.js";
import { activityHasDamageDice } from "./auto-roll-attack-damage.js";
import { isMidiActive } from "../../utils/module-compat.js";

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
 * If the damage formula is purely static / deterministic (no dice) and the
 * "Auto-Roll Flat / Static Damage" setting is active, the damage is rolled
 * immediately without prompting for configuration.
 *
 * This feature is automatically disabled when midi-qol is active, because
 * midi-qol takes over the entire activity workflow (including auto-rolling
 * damage) and running both would produce duplicate damage rolls.
 */

/**
 * Hook handler for dnd5e.postUseActivity.
 * @param {Activity} activity       The activity that was just used.
 * @param {object} usageConfig      Configuration data for the activation.
 * @param {object} results          Final details on the activation.
 */
function _onPostUseActivity(activity, usageConfig, results) {
    if (!isFeatureActive("enableAutoRollSaveDamage", "clientEnableAutoRollSaveDamage")) return;

    // Only act on Save-type activities that actually have damage parts
    if (activity.type !== "save") return;
    if (!activity.damage?.parts?.length) return;

    const autoRollStatic = getSetting("autoRollStaticDamage");
    const hasDice = activityHasDamageDice(activity);
    const shouldConfigure = !autoRollStatic || hasDice;

    debug("Auto-Roll Save Damage | Save activity with damage detected", {
        hasDice,
        autoRollStatic,
        shouldConfigure
    });

    // dnd5e records the usage message's targets before the area template is placed, so after a placement they can
    // still be the previous cast's targets. Template Targeting syncs the new ones to the message asynchronously, too
    // late for this hook, so read the user's current targets instead whenever a template was placed.
    const currentTargets = () => dnd5e.dataModels?.chatMessage?.fields?.TargetsField?.getDescriptors?.(game.user.targets) ?? [];
    const targets = (!results?.templates?.length && results?.message?.system?.targets?.length)
        ? results.message.system.targets
        : currentTargets();

    if (results?.message?._targetState) {
        results.message._targetState.mode = "targeted";
    }

    activity.rollDamage(
        { event: usageConfig.event },
        { configure: shouldConfigure },
        {
            data: {
                system: {
                    origin: results?.message?.id,
                    targets
                }
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
    if (isMidiActive()) {
        log("Auto-Roll Save Damage | midi-qol detected — feature disabled to avoid duplicate damage rolls.");
        return;
    }
    Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
    debug("Auto-Roll Save Damage | Initialized");
}

