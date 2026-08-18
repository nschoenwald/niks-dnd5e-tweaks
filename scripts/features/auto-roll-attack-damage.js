import { MODULE_ID, debug, log } from "../main.js";

/**
 * Auto-Prompt & Auto-Roll Attack Damage on Hit
 *
 * Provides two independent configurable settings based on the **attacker's** actor role:
 *  - "Prompt for Attack Damage" (`promptForAttackDamage`): Opens the damage roll
 *    configuration dialog when an attack roll hits the target's AC.
 *    Choices: "For All" (default), "For Players", "For NPCs", "For None".
 *  - "Auto-Roll Attack Damage" (`autoRollAttackDamage`): Rolls damage immediately
 *    without showing a dialog when an attack roll hits.
 *    Choices: "For All", "For Players", "For NPCs", "For None" (default).
 *
 * Only fires when the attack total meets or exceeds at least one target's AC.
 * Misses and fumbles are ignored. Critical hits are treated as automatic hits.
 * Automatically disabled when midi-qol is active and configured to auto-apply damage.
 */

/**
 * Determine attacker actor role: "npcs" or "players".
 * @param {Actor5e} actor
 * @returns {"npcs"|"players"}
 */
function _getActorRole(actor) {
    const isNPC = actor.type === "npc" || (!actor.hasPlayerOwner && actor.type !== "character");
    return isNPC ? "npcs" : "players";
}

/**
 * Check if Auto-Roll is enabled for the given attacker role.
 * @param {"npcs"|"players"} role
 * @returns {boolean}
 */
function _shouldAutoRoll(role) {
    const setting = game.settings.get(MODULE_ID, "autoRollAttackDamage");
    if (setting === "all") return true;
    if (setting === "npcs" && role === "npcs") return true;
    if (setting === "players" && role === "players") return true;
    return false;
}

/**
 * Check if Prompt is enabled for the given attacker role.
 * @param {"npcs"|"players"} role
 * @returns {boolean}
 */
function _shouldPrompt(role) {
    const setting = game.settings.get(MODULE_ID, "promptForAttackDamage");
    if (setting === "all") return true;
    if (setting === "npcs" && role === "npcs") return true;
    if (setting === "players" && role === "players") return true;
    return false;
}

/**
 * Extract the D20Roll from an attack roll message.
 * @param {ChatMessage} message
 * @returns {D20Roll|Roll|null}
 */
function _getAttackD20Roll(message) {
    if (!message.rolls?.length) return null;
    for (const roll of message.rolls) {
        const d0 = roll.dice?.[0];
        if (d0?.faces === 20) {
            try {
                return dnd5e.dice.D20Roll.fromRoll(roll);
            } catch {
                return roll;
            }
        }
    }
    return message.rolls[0] || null;
}

/**
 * Handle a newly created chat message to see if it is a hit attack roll
 * from an attack activity, and if so prompt for or auto-roll damage.
 * @param {ChatMessage} message  The message that was just created.
 */
async function _onCreateChatMessage(message) {
    try {
        // Run on the client that authored the attack roll so dialogs pop up
        // on the attacker's screen and auto-rolls are attributed to them.
        const author = message.author ?? message.user;
        if (author) {
            if (author.id !== game.user.id) return;
        } else {
            const primaryGM = game.users.primaryGM ?? game.users.activeGM;
            if (!primaryGM?.isSelf) return;
        }

        // Only process attack rolls from attack activities
        const rollType = message.getFlag("dnd5e", "roll.type");
        const activityType = message.getFlag("dnd5e", "activity.type");
        if (rollType !== "attack") return;
        if (activityType !== "attack") return;

        // Only trigger on public rolls — skip private (GM), blind, and self rolls
        const isPublic = (!message.whisper?.length) && !message.blind;
        if (!isPublic) {
            debug("Auto-Roll Attack Damage | Non-public attack roll, skipping");
            return;
        }

        // Skip if midi-qol is active and configured to auto-apply damage
        if (game.modules.get("midi-qol")?.active) {
            const midiAutoApply = globalThis.MidiQOL?.configSettings?.()?.autoApplyDamage
                ?? game.settings.get("midi-qol", "ConfigSettings")?.autoApplyDamage;
            if (midiAutoApply && midiAutoApply.toLowerCase().includes("yes")) {
                debug("Auto-Roll Attack Damage | midi-qol detected and auto-applies damage — feature bypassed.");
                return;
            }
        }

        // Resolve the attacker actor
        let attackerActor = null;
        const subjectUuid = message.getFlag("dnd5e", "subject.uuid");
        if (subjectUuid) {
            attackerActor = fromUuidSync(subjectUuid);
        }
        if (!attackerActor && message.speaker?.actor) {
            attackerActor = game.actors.get(message.speaker.actor);
        }
        if (!attackerActor) {
            debug("Auto-Roll Attack Damage | Could not resolve attacker actor, skipping");
            return;
        }

        const role = _getActorRole(attackerActor);
        const autoRoll = _shouldAutoRoll(role);
        const prompt = !autoRoll && _shouldPrompt(role);

        if (!autoRoll && !prompt) {
            debug(`Auto-Roll Attack Damage | Neither auto-roll nor prompt active for role "${role}", skipping`);
            return;
        }

        // Resolve targets — prefer originating (usage) message targets, fall back to attack message
        const originatingId = message.getFlag("dnd5e", "originatingMessage");
        const originatingMessage = originatingId ? game.messages.get(originatingId) : null;
        const originTargets = originatingMessage?.getFlag("dnd5e", "targets");
        const attackTargets = message.getFlag("dnd5e", "targets");
        const targets = originTargets || attackTargets || [];

        if (!targets.length) {
            debug("Auto-Roll Attack Damage | No targets found, skipping");
            return;
        }

        // Extract the attack roll
        const attackRoll = _getAttackD20Roll(message);
        if (!attackRoll) {
            debug("Auto-Roll Attack Damage | No roll found in message, skipping");
            return;
        }

        const d0 = attackRoll.dice?.[0];
        const isCritical = Boolean(attackRoll.isCritical || attackRoll.options?.isCritical || (d0?.faces === 20 && d0?.total === 20));
        const isFumble = Boolean(attackRoll.isFumble || attackRoll.options?.isFumble || (d0?.faces === 20 && d0?.total === 1 && !isCritical));
        const attackTotal = attackRoll.total ?? 0;

        // Fumble is an automatic miss in 5e
        if (isFumble) {
            debug(`Auto-Roll Attack Damage | Attack was a fumble (natural 1), skipping`);
            return;
        }

        // Check whether at least one target was hit
        const hitTargets = targets.filter(target => {
            if (isCritical) return true;
            let ac = target.ac;
            if (ac === undefined || ac === null) {
                if (target.uuid) {
                    const targetDoc = fromUuidSync(target.uuid);
                    const targetActor = targetDoc?.actor ?? targetDoc;
                    ac = targetActor?.system?.attributes?.ac?.value;
                }
            }
            if (ac === undefined || ac === null) ac = Infinity;
            return attackTotal >= ac;
        });

        if (!hitTargets.length) {
            debug(`Auto-Roll Attack Damage | Attack total ${attackTotal} missed all targets, skipping`);
            return;
        }

        debug(`Auto-Roll Attack Damage | Attack by ${attackerActor.name} (role: ${role}) hit ${hitTargets.length} target(s) (total: ${attackTotal}, crit: ${isCritical}). ${autoRoll ? "Auto-rolling" : "Prompting for"} damage.`);

        // Resolve the item and activity
        const activityId = message.getFlag("dnd5e", "activity.id");
        const itemUuid = message.getFlag("dnd5e", "item.uuid")
            ?? originatingMessage?.getFlag("dnd5e", "item.uuid");

        let activity = null;
        if (itemUuid) {
            const item = fromUuidSync(itemUuid);
            activity = item?.system?.activities?.get(activityId) ?? item?.activities?.get(activityId);
        }

        if (!activity && activityId) {
            activity = attackerActor.items
                .flatMap(i => [...(i.system.activities?.values() ?? [])])
                .find(a => a.id === activityId);
        }

        if (!activity) {
            debug("Auto-Roll Attack Damage | Could not resolve activity, skipping");
            return;
        }

        // Verify the activity has damage parts to roll
        if (!activity.damage?.parts?.length) {
            debug("Auto-Roll Attack Damage | Activity has no damage parts, skipping");
            return;
        }

        // Trigger damage roll — either prompt (configure: true) or auto-roll (configure: false)
        await activity.rollDamage(
            {
                isCritical: isCritical,
                attack: { isCritical: isCritical },
                configure: !autoRoll
            },
            {
                configure: !autoRoll
            }
        );

    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in Auto-Roll Attack Damage handler:`, err);
    }
}

/**
 * Initialise the feature by registering the hook.
 * Called once during module setup.
 */
export function initAutoRollAttackDamage() {
    Hooks.on("createChatMessage", _onCreateChatMessage);
    debug("Auto-Roll Attack Damage | Initialized");
}
