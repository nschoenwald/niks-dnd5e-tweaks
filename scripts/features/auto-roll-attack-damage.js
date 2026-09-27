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
    if (!game.settings.get(MODULE_ID, "clientEnableAutoRollAttackDamage")) return false;
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
    if (!game.settings.get(MODULE_ID, "clientEnableAttackDamagePrompt")) return false;
    const setting = game.settings.get(MODULE_ID, "promptForAttackDamage");
    if (setting === "all") return true;
    if (setting === "npcs" && role === "npcs") return true;
    if (setting === "players" && role === "players") return true;
    return false;
}

/**
 * Inspect a roll process configuration (or rollConfig object) to determine
 * whether all damage/healing formula parts are purely deterministic and contain no dice.
 *
 * @param {object} config Configuration data for the pending roll (e.g. from dnd5e.preRollDamage or getDamageConfig)
 * @returns {boolean} True if there is at least one formula part and none contain dice.
 */
export function isRollConfigPurelyStatic(config) {
    if (config?.rolls?.length) {
        let hasParts = false;
        for (const roll of config.rolls) {
            if (!roll.parts?.length) continue;
            const formula = roll.parts
                .filter(p => p !== null && p !== undefined && p !== "")
                .map(String)
                .join(" + ");
            if (!formula) continue;
            hasParts = true;

            // Fast check for dice notation (e.g. 1d8, 2d6, d4, 1df)
            if (/\d*d\d+/i.test(formula)) return false;

            try {
                const parsed = Roll.create(formula, roll.data ?? {});
                if (parsed.dice?.length > 0 || !parsed.isDeterministic) return false;
            } catch {
                if (/\d*d\d+/i.test(formula)) return false;
            }
        }
        if (hasParts) return true;
    }

    // Fallback: inspect subject activity directly if present
    const activity = config?.subject;
    if (activity) {
        if (activity.healing?.formula) {
            const formula = String(activity.healing.formula);
            if (/\d*d\d+/i.test(formula)) return false;
            try {
                const rollData = activity.getRollData?.() ?? {};
                const parsed = Roll.create(formula, rollData);
                if (parsed.dice?.length === 0 && parsed.isDeterministic) return true;
            } catch {
                if (/\d*d\d+/i.test(formula)) return false;
            }
        }

        if (activity.damage?.parts?.length) {
            let hasParts = false;
            for (const part of activity.damage.parts) {
                if (part.custom?.enabled && part.custom.formula) {
                    const formula = String(part.custom.formula);
                    if (/\d*d\d+/i.test(formula)) return false;
                    try {
                        const rollData = activity.getRollData?.() ?? {};
                        const parsed = Roll.create(formula, rollData);
                        if (parsed.dice?.length > 0 || !parsed.isDeterministic) return false;
                    } catch {
                        if (/\d*d\d+/i.test(formula)) return false;
                    }
                    hasParts = true;
                } else {
                    if (part.denomination && part.denomination > 0 && part.number !== 0) return false;
                    if (part.bonus || part.number) hasParts = true;
                }
            }
            if (hasParts) return true;
        }
    }

    return false;
}

/**
 * Check whether an Activity's damage or healing formula contains any dice, or if it is
 * purely deterministic (static values, ability modifiers, derived stats).
 *
 * @param {Activity} activity
 * @param {object} [config={}]
 * @returns {boolean} True if the damage/healing contains at least one die; false if purely static/derived.
 */
export function activityHasDamageDice(activity, config = {}) {
    if (!activity) return false;

    try {
        if (typeof activity.getDamageConfig === "function") {
            const rollConfig = activity.getDamageConfig(config);
            if (rollConfig?.rolls?.length) {
                return !isRollConfigPurelyStatic(rollConfig);
            }
        }
    } catch (err) {
        debug("Auto-Roll Attack Damage | Error in activityHasDamageDice getDamageConfig:", err);
    }

    // Fallback: inspect activity.healing or activity.damage.parts directly
    if (activity.healing?.formula) {
        const formula = String(activity.healing.formula);
        if (/\d*d\d+/i.test(formula)) return true;
        try {
            const rollData = activity.getRollData?.() ?? {};
            const parsed = Roll.create(formula, rollData);
            if (parsed.dice?.length > 0 || !parsed.isDeterministic) return true;
        } catch {
            if (/\d*d\d+/i.test(formula)) return true;
        }
        return false;
    }

    if (activity.damage?.parts?.length) {
        for (const part of activity.damage.parts) {
            if (part.custom?.enabled && part.custom.formula) {
                if (/\d*d\d+/i.test(part.custom.formula)) return true;
                try {
                    const rollData = activity.getRollData?.() ?? {};
                    const parsed = Roll.create(part.custom.formula, rollData);
                    if (parsed.dice?.length > 0 || !parsed.isDeterministic) return true;
                } catch {
                    if (/\d*d\d+/i.test(part.custom.formula)) return true;
                }
            } else {
                if (part.denomination && part.denomination > 0 && part.number !== 0) return true;
            }
        }
    }

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
        const rollType = message.type ?? message.getFlag("dnd5e", "roll.type");
        const activity = message.getAssociatedActivity?.()
            ?? (message.system?.activity?.uuid ? fromUuidSync(message.system.activity.uuid) : null);
        const activityType = message.system?.activity?.type ?? activity?.type ?? message.getFlag("dnd5e", "activity.type");
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
        let attackerActor = message.getAssociatedActor?.() ?? null;
        if (!attackerActor) {
            const subjectUuid = message.system?.item?.uuid ?? message.getFlag("dnd5e", "subject.uuid");
            if (subjectUuid) {
                const doc = fromUuidSync(subjectUuid);
                attackerActor = doc?.actor ?? doc;
            }
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
        const originatingMessage = (typeof message.getOriginatingMessage === "function" ? message.getOriginatingMessage() : null)
            ?? (message.system?.origin ? game.messages.get(message.system.origin) : null)
            ?? (message.getFlag("dnd5e", "originatingMessage") ? game.messages.get(message.getFlag("dnd5e", "originatingMessage")) : null);
        const originatingId = originatingMessage?.id ?? message.system?.origin ?? message.getFlag("dnd5e", "originatingMessage");
        const originTargets = originatingMessage?.system?.targets ?? originatingMessage?.getFlag("dnd5e", "targets");
        const attackTargets = message.system?.targets ?? message.getFlag("dnd5e", "targets");
        const targets = (originTargets?.length ? originTargets : null)
            || (attackTargets?.length ? attackTargets : null)
            || [];

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
                const targetUuid = target.actor ?? target.token ?? target.uuid;
                if (targetUuid) {
                    const targetDoc = fromUuidSync(targetUuid);
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
        let resolvedActivity = activity;
        if (!resolvedActivity) {
            const activityId = message.system?.activity?.id ?? message.getFlag("dnd5e", "activity.id");
            const itemUuid = message.system?.item?.uuid
                ?? originatingMessage?.system?.item?.uuid
                ?? message.getFlag("dnd5e", "item.uuid")
                ?? originatingMessage?.getFlag("dnd5e", "item.uuid");

            if (itemUuid) {
                const item = fromUuidSync(itemUuid);
                resolvedActivity = item?.system?.activities?.get(activityId) ?? item?.activities?.get(activityId);
            }

            if (!resolvedActivity && activityId) {
                resolvedActivity = attackerActor.items
                    .flatMap(i => [...(i.system.activities?.values() ?? [])])
                    .find(a => a.id === activityId);
            }
        }

        if (!resolvedActivity) {
            debug("Auto-Roll Attack Damage | Could not resolve activity, skipping");
            return;
        }

        // Verify the activity has damage parts to roll
        if (!resolvedActivity.damage?.parts?.length) {
            debug("Auto-Roll Attack Damage | Activity has no damage parts, skipping");
            return;
        }

        // Determine whether to configure (show dialog) or auto-roll immediately
        const autoRollStatic = game.settings.get(MODULE_ID, "autoRollStaticDamage");
        const hasDice = activityHasDamageDice(resolvedActivity, { isCritical });
        const shouldConfigure = !autoRoll && (!autoRollStatic || hasDice);

        debug("Auto-Roll Attack Damage | Hit detected, rolling damage", {
            autoRoll,
            autoRollStatic,
            hasDice,
            shouldConfigure,
            isCritical
        });

        // Trigger damage roll — either prompt (configure: true) or auto-roll (configure: false)
        await resolvedActivity.rollDamage(
            {
                isCritical: isCritical,
                attack: { isCritical: isCritical },
                configure: shouldConfigure
            },
            {
                configure: shouldConfigure
            },
            {
                data: {
                    system: {
                        origin: originatingId ?? message.id,
                        targets: targets
                    }
                }
            }
        );

    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in Auto-Roll Attack Damage handler:`, err);
    }
}

/**
 * Hook handler for dnd5e.preRollDamage.
 * Intercepts any damage or healing roll before the configuration dialog is displayed.
 * If the formula consists purely of static or deterministic values (such as flat bonuses,
 * ability modifiers, or level multipliers like @classes.barbarian.levels) and contains no dice,
 * automatically suppresses the dialog (dialog.configure = false) when autoRollStaticDamage is enabled.
 *
 * @param {DamageRollProcessConfiguration} config
 * @param {DamageRollDialogConfiguration} dialog
 * @param {DamageRollMessageConfiguration} message
 */
function _onPreRollDamage(config, dialog, message) {
    if (dialog.configure === false) return;
    if (!game.settings.get(MODULE_ID, "autoRollStaticDamage")) return;

    if (isRollConfigPurelyStatic(config)) {
        debug("Auto-Roll Static Damage | Suppressing damage/healing dialog for deterministic roll", {
            subject: config.subject?.name,
            rolls: config.rolls
        });
        dialog.configure = false;
    }
}

/**
 * Initialise the feature by registering the hooks.
 * Called once during module setup.
 */
export function initAutoRollAttackDamage() {
    Hooks.on("createChatMessage", _onCreateChatMessage);
    Hooks.on("dnd5e.preRollDamage", _onPreRollDamage);
    debug("Auto-Roll Attack Damage & Static Damage/Healing | Initialized");
}
