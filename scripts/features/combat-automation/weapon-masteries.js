/**
 * Feature: Weapon Mastery Automation (Step 1: Slow & Sap)
 * Description: Automates weapon masteries on attack hits when the attacker has the required mastery.
 *              Strictly applies to player character actors (not NPCs).
 *              - Sap: Target creature gains Disadvantage on its next attack roll before the start of the attacker's next turn.
 *                     Expires after the creature makes an attack or at the start of the attacker's next turn.
 *              - Slow: Reduces target creature's Speed by 10 ft until the start of the attacker's next turn.
 *                      Uses system movement bonus to cleanly reduce active speeds without negative values.
 *              - Duplicate prevention: A creature can only be sapped or slowed once at a time.
 *              - Clean lifecycle: Lingering effects are automatically cleaned up when combat is terminated.
 *
 * @introduced v14.42.0
 */
import { MODULE_ID, debug, log, isFeatureActive } from "../../main.js";

const DEFAULT_SAP_ICON = "icons/skills/melee/sword-damaged-broken-glow-red.webp";
const DEFAULT_SLOW_ICON = "icons/creatures/invertebrates/snail-movement-green.webp";

const _pendingDeletions = new Set();

/**
 * Safely delete an ActiveEffect document, guarding against concurrent duplicate deletions
 * and suppressing errors if the effect was already deleted.
 * @param {ActiveEffect} effect
 * @param {Actor5e} actor
 */
async function _safeDeleteEffect(effect, actor) {
    if (!effect || effect._destroyed) return;
    const effectId = effect.id;
    if (_pendingDeletions.has(effectId)) return;
    _pendingDeletions.add(effectId);

    try {
        if (actor?.isOwner) {
            if (actor.effects?.has(effectId)) {
                await effect.delete();
            }
        } else if (actor) {
            game.socket.emit(`module.${MODULE_ID}`, {
                action: "removeWeaponMasteryEffect",
                targetActorUuid: actor.uuid,
                effectId: effectId
            });
        }
    } catch (err) {
        if (!err?.message?.includes("does not exist")) {
            console.error("Weapon Mastery | Error deleting effect:", err);
        }
    } finally {
        setTimeout(() => _pendingDeletions.delete(effectId), 1500);
    }
}

/**
 * Normalize an icon path by stripping any leading slash.
 * @param {string} [path]
 * @param {string} fallback
 * @returns {string}
 */
function normalizeIcon(path, fallback) {
    if (!path || typeof path !== "string") return fallback;
    return path.startsWith("/") ? path.slice(1) : path;
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
        if (d0?.faces === 20) return roll;
    }
    return message.rolls[0] || null;
}

/**
 * Check whether an actor has mastery with a specific weapon and mastery property.
 * Strictly applies to player character actors (not NPCs).
 *
 * @param {Actor5e} actor
 * @param {Item5e} weapon
 * @param {string} masteryName
 * @returns {boolean}
 */
function _actorHasMastery(actor, weapon, masteryName) {
    if (!actor || !weapon) return false;

    // Strictly restricted to player characters (not NPCs)
    if (actor.type !== "character") return false;

    // 1. If weapon.system.masteryOptions is populated by DnD5e, check it
    // DnD5e validates base item mastery and includes applicable bonus masteries here.
    const masteryOptions = weapon.system?.masteryOptions;
    if (Array.isArray(masteryOptions) && masteryOptions.some(m => m.value === masteryName)) {
        return true;
    }

    // 2. Check actor's weaponProf mastery trait (Set of base item identifiers)
    const baseItem = weapon.system?.type?.baseItem;
    const masteryValues = actor.system?.traits?.weaponProf?.mastery?.value;
    if (baseItem && masteryValues instanceof Set && masteryValues.has(baseItem)) {
        if (weapon.system?.mastery === masteryName) return true;
    }

    return false;
}

/**
 * Apply a weapon mastery ActiveEffect (Sap or Slow) to a target actor.
 * Prevents duplicates so a creature is never sapped or slowed more than once simultaneously.
 *
 * @param {"sap"|"slow"} mastery
 * @param {Actor5e} targetActor
 * @param {Actor5e} attackerActor
 * @param {Item5e} [weapon]
 */
export async function applyMasteryEffect(mastery, targetActor, attackerActor, weapon) {
    if (!targetActor || !attackerActor) return;

    // Check if target actor already has an active effect for this mastery (prevent duplicates)
    const existing = targetActor.effects.find(e => {
        if (e.flags?.[MODULE_ID]?.mastery === mastery) return true;
        if (e.flags?.dnd5e?.rules === mastery) return true;
        const nameLower = (e.name || "").toLowerCase();
        if (mastery === "sap") {
            return nameLower === "sapped (weapon mastery)" || nameLower === "sapped" || nameLower === "sap" || nameLower === "weapon mastery: sap";
        }
        if (mastery === "slow") {
            return nameLower === "slowed (weapon mastery)" || nameLower === "slowed" || nameLower === "slow" || nameLower === "weapon mastery: slow";
        }
        return false;
    });

    if (existing) {
        debug(`Weapon Mastery | ${mastery.toUpperCase()} already present on ${targetActor.name}, skipping duplicate`);
        return;
    }

    const sapIconSetting = game.settings.get(MODULE_ID, "masterySapIcon") || DEFAULT_SAP_ICON;
    const slowIconSetting = game.settings.get(MODULE_ID, "masterySlowIcon") || DEFAULT_SLOW_ICON;

    const icon = mastery === "sap"
        ? normalizeIcon(sapIconSetting, DEFAULT_SAP_ICON)
        : normalizeIcon(slowIconSetting, DEFAULT_SLOW_ICON);

    const label = mastery === "sap" ? "Sapped (Weapon Mastery)" : "Slowed (Weapon Mastery)";

    const combat = game.combat;
    const isCombatStarted = Boolean(combat?.started);
    const attackerCombatant = isCombatStarted
        ? (combat.getCombatantsByActor?.(attackerActor)?.[0]
            ?? combat.combatants.find(c => c.actor?.uuid === attackerActor.uuid || c.tokenId === attackerActor.token?.id || (c.actor?.id === attackerActor.id && !c.token?.actorLink)))
        : null;

    // Foundry V14 BaseActiveEffect schema strictly requires time and initiative in start SchemaField
    const effectStart = isCombatStarted ? {
        time: game.time.worldTime,
        combat: combat.id,
        combatant: attackerCombatant?.id ?? combat.combatant?.id ?? null,
        initiative: attackerCombatant?.initiative ?? combat.combatant?.initiative ?? 0,
        round: combat.round,
        turn: combat.turn
    } : null;

    const effectData = {
        name: label,
        img: icon,
        origin: weapon?.uuid ?? attackerActor.uuid,
        flags: {
            [MODULE_ID]: {
                mastery,
                sourceActorUuid: attackerActor.uuid,
                sourceCombatantId: attackerCombatant?.id ?? null,
                sourceRound: isCombatStarted ? combat.round : null,
                sourceTurn: isCombatStarted ? combat.turn : null
            },
            dnd5e: {
                rules: mastery,
                isTemporary: true
            }
        },
        duration: {
            value: 1,
            units: "rounds",
            expiry: "sourceStart"
        },
        start: effectStart
    };

    if (mastery === "sap") {
        effectData.changes = [
            {
                key: "system.rolls.attack.mode",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "-1",
                priority: 20
            }
        ];
        effectData.description = "<p>The creature has Disadvantage on its next attack roll before the start of the attacker's next turn.</p>";
    } else if (mastery === "slow") {
        // Native DnD5e 6.x movement bonus applies to all speeds > 0 without negative speeds on inactive modes
        effectData.changes = [
            {
                key: "system.attributes.movement.bonus",
                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                value: "-10",
                priority: 20
            }
        ];
        effectData.description = "<p>Speed is reduced by 10 feet until the start of the attacker's next turn.</p>";
    }

    if (targetActor.isOwner) {
        await ActiveEffect.createDocuments([effectData], { parent: targetActor });
        debug(`Weapon Mastery | ✓ Created ${mastery.toUpperCase()} effect on ${targetActor.name}`);
    } else {
        debug(`Weapon Mastery | Emitting socket to create ${mastery.toUpperCase()} on ${targetActor.name}`);
        game.socket.emit(`module.${MODULE_ID}`, {
            action: "applyWeaponMasteryEffect",
            targetActorUuid: targetActor.uuid,
            effectData
        });
    }
}

/**
 * Remove any Sap effects from an actor after they have made an attack roll.
 * @param {Actor5e} actor
 */
export async function removeSapFromActor(actor) {
    if (!actor) return;
    const sapEffects = actor.effects.filter(e => {
        if (e.flags?.[MODULE_ID]?.mastery === "sap") return true;
        const nameLower = (e.name || "").toLowerCase();
        return nameLower === "sapped (weapon mastery)" || nameLower === "sapped" || nameLower === "sap" || nameLower === "weapon mastery: sap";
    });
    if (!sapEffects.length) return;

    debug(`Weapon Mastery | Sapped creature ${actor.name} rolled an attack; removing ${sapEffects.length} Sap effect(s)`);
    for (const sapEffect of sapEffects) {
        await _safeDeleteEffect(sapEffect, actor);
    }
}

/**
 * Handle newly created chat messages to evaluate weapon mastery triggers.
 * @param {ChatMessage} message
 * @param {object} options
 * @param {string} userId
 */
async function _onCreateChatMessage(message, options, userId) {
    try {
        if (!isFeatureActive("enableWeaponMasteries", "clientEnableWeaponMasteries")) return;

        const isAuthor = message.author?.id ? message.author.id === game.user.id : (message.author === game.user || message.isAuthor);
        if (!isAuthor && userId !== game.user.id) return;

        // Check if message is an attack roll
        const rollType = message.type ?? message.getFlag("dnd5e", "roll.type");
        if (rollType !== "attack") return;

        // Resolve attacker actor
        let attackerActor = null;
        try {
            attackerActor = message.getAssociatedActor?.() ?? null;
        } catch {}
        if (!attackerActor) {
            const subjectUuid = message.system?.item?.uuid ?? message.getFlag("dnd5e", "subject.uuid");
            if (subjectUuid) {
                const doc = fromUuidSync(subjectUuid, { strict: false });
                attackerActor = doc?.actor ?? doc;
            }
        }
        if (!attackerActor && message.speaker?.token) {
            const scene = game.scenes.get(message.speaker.scene) ?? canvas.scene;
            const tokenDoc = scene?.tokens.get(message.speaker.token);
            attackerActor = tokenDoc?.actor;
        }
        if (!attackerActor && message.speaker?.actor) {
            attackerActor = game.actors.get(message.speaker.actor);
        }

        // If the attacking creature itself is sapped, remove Sap on ANY attack roll made
        if (attackerActor) {
            await removeSapFromActor(attackerActor);
        }

        // Strictly restrict Weapon Mastery application to player character actors
        if (!attackerActor || attackerActor.type !== "character") {
            debug("Weapon Mastery | Attacker is not a character actor, skipping mastery application");
            return;
        }

        // Check activity type with safe fallbacks (protects against DnD5e 6.0.6 private method errors)
        let activity = null;
        try {
            activity = message.getAssociatedActivity?.();
        } catch {}
        activity ??= (message.system?.activity?.uuid ? fromUuidSync(message.system.activity.uuid, { strict: false }) : null);

        const activityType = message.system?.activity?.type ?? activity?.type ?? message.getFlag("dnd5e", "activity.type");
        if (activityType !== "attack") return;

        // Resolve weapon item with safe fallbacks
        let weapon = activity?.item;
        if (!weapon) {
            try {
                weapon = message.getAssociatedItem?.();
            } catch {}
        }
        weapon ??= (message.system?.item?.uuid ? fromUuidSync(message.system.item.uuid, { strict: false }) : null);
        if (!weapon || weapon.type !== "weapon") return;

        // Resolve active mastery (prefer message/roll choice, fallback to weapon property if actor qualifies)
        let activeMastery = message.system?.mastery || message.rolls?.[0]?.options?.mastery;
        if (!activeMastery) {
            const weaponMastery = weapon.system?.mastery;
            if (weaponMastery && (weaponMastery === "sap" || weaponMastery === "slow")) {
                if (_actorHasMastery(attackerActor, weapon, weaponMastery)) {
                    activeMastery = weaponMastery;
                }
            }
        }

        if (activeMastery !== "sap" && activeMastery !== "slow") return;

        // Resolve targets and evaluate hit using existing system mechanism
        const attackTargets = message.system?.targets ?? message.getFlag("dnd5e", "targets");
        let originatingMessage = null;
        try {
            originatingMessage = (typeof message.getOriginatingMessage === "function" ? message.getOriginatingMessage() : null);
        } catch {}
        originatingMessage ??= (message.system?.origin ? (message.system.origin instanceof ChatMessage ? message.system.origin : game.messages.get(message.system.origin)) : null)
            ?? (message.getFlag("dnd5e", "originatingMessage") ? game.messages.get(message.getFlag("dnd5e", "originatingMessage")) : null);

        const originTargets = (originatingMessage && originatingMessage !== message)
            ? (originatingMessage.system?.targets ?? originatingMessage.getFlag("dnd5e", "targets"))
            : null;
        const targets = (attackTargets?.length ? attackTargets : null)
            || (originTargets?.length ? originTargets : null)
            || [];

        if (!targets.length) {
            debug("Weapon Mastery | No targets found on attack, skipping");
            return;
        }

        const attackRoll = _getAttackD20Roll(message);
        if (!attackRoll) return;

        const d0 = attackRoll.dice?.[0];
        const isCritical = Boolean(attackRoll.isCritical || attackRoll.options?.isCritical);
        const isFumble = Boolean(attackRoll.isFumble || attackRoll.options?.isFumble || (d0?.faces === 20 && d0?.total === 1 && !isCritical));
        const attackTotal = attackRoll.total ?? 0;
        if (isFumble) {
            debug("Weapon Mastery | Attack was a fumble (natural 1), skipping");
            return;
        }

        let hitTargets = [];
        if (message.system?.evaluatedTargets?.length) {
            hitTargets = message.system.evaluatedTargets.filter(target => !target.isMiss);
        } else {
            hitTargets = targets.filter(target => {
                if (isCritical) return true;
                let ac = target.ac;
                if (ac === undefined || ac === null) {
                    let targetActor = null;
                    if (target.token) {
                        const tokenDoc = fromUuidSync(target.token, { strict: false });
                        targetActor = tokenDoc?.actor;
                    }
                    if (!targetActor && target.actor) {
                        const doc = fromUuidSync(target.actor, { strict: false });
                        targetActor = doc?.actor ?? doc;
                    }
                    ac = targetActor?.system?.attributes?.ac?.value;
                }
                if (ac === undefined || ac === null) ac = Infinity;
                return attackTotal >= ac;
            });
        }

        if (!hitTargets.length) {
            debug("Weapon Mastery | Attack did not hit any targets, skipping");
            return;
        }

        debug(`Weapon Mastery | Attack hit ${hitTargets.length} target(s) with ${activeMastery.toUpperCase()} mastery`);

        for (const target of hitTargets) {
            let targetActor = null;
            if (target.token) {
                const tokenDoc = fromUuidSync(target.token, { strict: false });
                targetActor = tokenDoc?.actor;
            }
            if (!targetActor && target.actor) {
                const doc = fromUuidSync(target.actor, { strict: false });
                targetActor = doc?.actor ?? doc;
            }
            if (!targetActor && target.uuid) {
                const doc = fromUuidSync(target.uuid, { strict: false });
                targetActor = doc?.actor ?? doc;
            }
            if (!targetActor || !(targetActor instanceof Actor)) continue;
            await applyMasteryEffect(activeMastery, targetActor, attackerActor, weapon);
        }
    } catch (err) {
        console.error("Weapon Mastery | Error processing attack message:", err);
    }
}

/**
 * Hook dnd5e.rollAttack to remove Sap from any sapped creature that rolls an attack.
 * @param {D20Roll[]} rolls
 * @param {object} data
 */
async function _onRollAttack(rolls, data) {
    if (!isFeatureActive("enableWeaponMasteries", "clientEnableWeaponMasteries")) return;

    try {
        const actor = data.subject?.actor;
        if (actor) await removeSapFromActor(actor);
    } catch (err) {
        if (!err?.message?.includes("does not exist")) {
            console.error("Weapon Mastery | Error in dnd5e.rollAttack handler:", err);
        }
    }
}

/**
 * Hook updateCombat to expire Sap and Slow at the start of the source attacker's next turn.
 * @param {Combat} combat
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 */
async function _onUpdateCombat(combat, changed, options, userId) {
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (!primaryGM?.isSelf) return;
    if (!game.settings.get(MODULE_ID, "enableWeaponMasteries")) return;
    if (changed.turn === undefined && changed.round === undefined) return;

    try {
        const currentCombatant = combat.combatant;
        const currentActor = currentCombatant?.actor;
        if (!currentActor) return;

        for (const combatant of combat.combatants) {
            const targetActor = combatant.actor;
            if (!targetActor) continue;

            // Expire Sap & Slow effects at the start of the source's turn
            const masteryEffects = targetActor.effects.filter(e => {
                const mastery = e.flags?.[MODULE_ID]?.mastery;
                let m = mastery;
                if (!m) {
                    const nameLower = (e.name || "").toLowerCase();
                    if (nameLower.includes("sap")) m = "sap";
                    else if (nameLower.includes("slow")) m = "slow";
                }
                if (m !== "sap" && m !== "slow") return false;

                const sourceCombatantId = e.flags?.[MODULE_ID]?.sourceCombatantId;
                const sourceUuid = e.flags?.[MODULE_ID]?.sourceActorUuid;
                const isSourceMatch = (sourceCombatantId && sourceCombatantId === currentCombatant.id)
                    || (sourceUuid && (sourceUuid === currentActor.uuid || sourceUuid === currentActor.id));
                if (!isSourceMatch) return false;

                // Don't expire on the exact turn it was applied
                const sRound = e.flags?.[MODULE_ID]?.sourceRound;
                const sTurn = e.flags?.[MODULE_ID]?.sourceTurn;
                if (combat.round === sRound && combat.turn === sTurn) return false;
                return true;
            });

            for (const effect of masteryEffects) {
                const mName = effect.flags?.[MODULE_ID]?.mastery?.toUpperCase() ?? "MASTERY";
                debug(`Weapon Mastery | Expiring ${mName} on ${targetActor.name} at start of source ${currentActor.name}'s turn`);
                await _safeDeleteEffect(effect, targetActor);
            }
        }
    } catch (err) {
        console.error("Weapon Mastery | Error in updateCombat handler:", err);
    }
}

/**
 * Hook deleteCombat to clean up any remaining mastery effects when combat is ended.
 * Prevents orphaned effects from persisting indefinitely.
 * @param {Combat} combat
 */
async function _onDeleteCombat(combat) {
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (!primaryGM?.isSelf) return;
    if (!game.settings.get(MODULE_ID, "enableWeaponMasteries")) return;

    try {
        for (const combatant of combat.combatants ?? []) {
            const actor = combatant.actor;
            if (!actor) continue;

            const masteryEffects = actor.effects.filter(e => {
                const m = e.flags?.[MODULE_ID]?.mastery;
                let isMatch = m === "sap" || m === "slow";
                if (!isMatch) {
                    const nameLower = (e.name || "").toLowerCase();
                    isMatch = nameLower.includes("sap") || nameLower.includes("slow");
                }
                return isMatch && (
                    e.flags?.[MODULE_ID]?.sourceCombatantId === combatant.id
                    || e.start?.combat?.id === combat.id
                    || e.start?.combat === combat.id
                );
            });

            for (const effect of masteryEffects) {
                debug(`Weapon Mastery | Deleting lingering combat mastery effect ${effect.name} on ${actor.name}`);
                await _safeDeleteEffect(effect, actor);
            }
        }
    } catch (err) {
        console.error("Weapon Mastery | Error in deleteCombat handler:", err);
    }
}

/**
 * Handle incoming socket messages on GM client for applying/removing weapon mastery effects.
 * @param {object} data
 */
export async function weaponMasterySocketMessage(data) {
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (!primaryGM?.isSelf) return;

    try {
        if (data?.action === "applyWeaponMasteryEffect" && data.targetActorUuid && data.effectData) {
            const target = fromUuidSync(data.targetActorUuid, { strict: false });
            const actor = target?.actor ?? target;
            if (!actor || !(actor instanceof Actor)) return;

            const mastery = data.effectData?.flags?.[MODULE_ID]?.mastery;
            const existing = actor.effects.find(e => {
                if (e.flags?.[MODULE_ID]?.mastery === mastery) return true;
                if (e.flags?.dnd5e?.rules === mastery) return true;
                const nameLower = (e.name || "").toLowerCase();
                if (mastery === "sap") {
                    return nameLower === "sapped (weapon mastery)" || nameLower === "sapped" || nameLower === "sap" || nameLower === "weapon mastery: sap";
                }
                if (mastery === "slow") {
                    return nameLower === "slowed (weapon mastery)" || nameLower === "slowed" || nameLower === "slow" || nameLower === "weapon mastery: slow";
                }
                return false;
            });
            if (existing) {
                debug(`Weapon Mastery Socket | ${mastery} already present on ${actor.name}, skipping`);
                return;
            }

            await ActiveEffect.createDocuments([data.effectData], { parent: actor });
            debug(`Weapon Mastery Socket | GM created ${mastery} effect on ${actor.name}`);
        } else if (data?.action === "removeWeaponMasteryEffect" && data.targetActorUuid && data.effectId) {
            const target = fromUuidSync(data.targetActorUuid, { strict: false });
            const actor = target?.actor ?? target;
            if (!actor || !(actor instanceof Actor)) return;

            const effect = actor.effects.get(data.effectId);
            if (effect) {
                await _safeDeleteEffect(effect, actor);
                debug(`Weapon Mastery Socket | GM removed effect ${data.effectId} on ${actor.name}`);
            }
        }
    } catch (err) {
        console.error("Weapon Mastery | Error handling socket message:", err);
    }
}

/**
 * Initialize Weapon Mastery automation hooks.
 * Called once during init/setup from main.js.
 */
export function initWeaponMasteries() {
    Hooks.on("createChatMessage", _onCreateChatMessage);
    Hooks.on("dnd5e.rollAttack", _onRollAttack);
    Hooks.on("updateCombat", _onUpdateCombat);
    Hooks.on("deleteCombat", _onDeleteCombat);

    log("Weapon Mastery automation initialized (Slow & Sap)");
}
