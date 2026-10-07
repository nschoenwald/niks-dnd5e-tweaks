/**
 * Feature: Prevent Rolling as Group Actors
 * Description: Prevents players from making rolls as group actors (such as when controlling
 * a party exploration token or using an item from the party inventory). The roll automatically
 * falls back to their assigned player character actor instead.
 *
 * @introduced v14.40.0
 */

import { MODULE_ID, log, isFeatureActive } from "../../main.js";

/**
 * Checks whether a speaker object resolves to a group actor.
 * @param {object|null|undefined} speaker - Speaker data { scene, actor, token, alias }.
 * @returns {boolean} True if the speaker resolves to a group actor.
 */
export function isSpeakerGroupActor(speaker) {
    if (!speaker || typeof speaker !== "object") return false;

    // Check explicit actor ID
    if (speaker.actor) {
        const actor = game.actors?.get(speaker.actor);
        if (actor?.type === "group") return true;
    }

    // Check token document or placeable
    if (speaker.token) {
        const token = canvas.tokens?.get(speaker.token)?.document
            ?? canvas.scene?.tokens.get(speaker.token);
        if (token?.actor?.type === "group") return true;

        if (!token && typeof fromUuidSync === "function") {
            try {
                const doc = fromUuidSync(speaker.token);
                if (doc?.actor?.type === "group") return true;
            } catch {
                // Ignore invalid UUIDs
            }
        }
    }

    return false;
}

/**
 * Wraps ChatMessage.getSpeaker to prevent players from acquiring group actor speaker data.
 */
function wrapGetSpeaker() {
    const targets = [
        foundry?.documents?.ChatMessage,
        getDocumentClass("ChatMessage")
    ].filter(cls => cls && typeof cls.getSpeaker === "function");

    const uniqueClasses = Array.from(new Set(targets));

    for (const Cls of uniqueClasses) {
        if (Cls.getSpeaker._nd5tPreventGroupWrapped) continue;

        const originalGetSpeaker = Cls.getSpeaker;

        Cls.getSpeaker = function(options = {}) {
            // Only intervene if setting is active, user is a player (not GM), and has an assigned character
            if (!isFeatureActive("enablePreventGroupActorRolls") || game.user?.isGM || !game.user?.character) {
                return originalGetSpeaker.call(this, options);
            }

            const character = game.user.character;

            // 1. Explicit group actor passed
            if (options.actor) {
                const actorObj = typeof options.actor === "string" ? game.actors?.get(options.actor) : options.actor;
                if (actorObj?.type === "group") {
                    return originalGetSpeaker.call(this, {
                        scene: options.scene ?? canvas.scene?.id,
                        actor: character
                    });
                }
            }

            // 2. Explicit group token passed
            if (options.token) {
                const tokenObj = typeof options.token === "string"
                    ? (canvas.tokens?.get(options.token)?.document ?? canvas.scene?.tokens.get(options.token))
                    : options.token;
                const tokenActor = tokenObj?.actor ?? tokenObj?.document?.actor;
                if (tokenActor?.type === "group") {
                    return originalGetSpeaker.call(this, {
                        scene: options.scene ?? canvas.scene?.id,
                        actor: character
                    });
                }
            }

            // 3. When no actor or token was passed, check canvas controlled tokens
            if (!options.actor && !options.token && canvas.ready) {
                const controlled = canvas.tokens?.controlled ?? [];
                if (controlled.length > 0) {
                    // Prefer any controlled token that is NOT a group actor
                    const nonGroupToken = controlled.find(t => t.actor?.type !== "group");
                    if (nonGroupToken) {
                        return originalGetSpeaker.call(this, {
                            ...options,
                            token: nonGroupToken.document
                        });
                    }

                    // All controlled tokens are group actors (e.g. party token) — fall back to character
                    return originalGetSpeaker.call(this, {
                        scene: options.scene ?? canvas.scene?.id,
                        actor: character
                    });
                }
            }

            // Call original getSpeaker
            const speaker = originalGetSpeaker.call(this, options);

            // Safety check: if speaker resolved to a group actor, redirect to player character
            if (isSpeakerGroupActor(speaker)) {
                return originalGetSpeaker.call(this, {
                    scene: options.scene ?? canvas.scene?.id,
                    actor: character
                });
            }

            return speaker;
        };

        Cls.getSpeaker._nd5tPreventGroupWrapped = true;
    }
}

/**
 * Initializes the Prevent Rolling as Group Actors feature.
 */
export function initPreventGroupActorRolls() {
    wrapGetSpeaker();

    // Hook: chatMessage — fires when a user submits chat input (e.g. /r 1d20 or /roll 1d20+@mod)
    // Ensures chatData.speaker and actor are redirected to the assigned character before roll evaluation
    Hooks.on("chatMessage", (chatLog, message, chatData) => {
        if (!isFeatureActive("enablePreventGroupActorRolls")) return;
        if (game.user?.isGM || !game.user?.character) return;

        if (isSpeakerGroupActor(chatData.speaker)) {
            chatData.speaker = ChatMessage.getSpeaker({
                actor: game.user.character,
                scene: chatData.speaker?.scene
            });
        }
    });

    // Hook: dnd5e.preRoll — fires for DnD5e structured rolls (attacks, damage, saves, checks, skills, tools)
    // Updates message speaker and supplements roll data with character stats if originating from a group
    Hooks.on("dnd5e.preRoll", (config, dialog, message) => {
        if (!isFeatureActive("enablePreventGroupActorRolls")) return;
        if (game.user?.isGM || !game.user?.character) return;

        const character = game.user.character;

        if (isSpeakerGroupActor(message?.data?.speaker)) {
            message.data.speaker = ChatMessage.getSpeaker({
                actor: character,
                scene: message.data.speaker.scene
            });
        }

        if (config?.rolls) {
            for (const r of config.rolls) {
                if (r.data && (config.subject?.actor?.type === "group" || r.data.actor?.type === "group")) {
                    const charData = character.getRollData();
                    foundry.utils.mergeObject(r.data, charData, { overwrite: false });
                }
            }
        }
    });

    // Hook: preCreateChatMessage — final pre-flight guard for any chat message containing rolls
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
        if (!isFeatureActive("enablePreventGroupActorRolls")) return;
        const user = game.users?.get(userId) ?? message.author ?? game.user;
        if (user?.isGM || !user?.character) return;

        const isRoll = message.isRoll
            || (Array.isArray(data.rolls) && data.rolls.length > 0)
            || (Array.isArray(message.rolls) && message.rolls.length > 0)
            || (data.rolls instanceof Map && data.rolls.size > 0)
            || ["attack", "damage", "save", "check", "roll"].includes(message.type);

        if (!isRoll) return;

        if (isSpeakerGroupActor(message.speaker)) {
            const fallbackSpeaker = ChatMessage.getSpeaker({
                actor: user.character,
                scene: message.speaker?.scene
            });
            message.updateSource({ speaker: fallbackSpeaker });
        }
    });

    log("Initialized Prevent Rolling as Group Actors");
}
