/**
 * Feature: Aggregate Short Rest Hit Dice Rolls
 * Description: Aggregates multiple hit dice rolls made during a short rest into a single chat card
 *              and consolidates changelogs into two summary entries (HP & Hit Dice) when niks-tiny-changelogs
 *              is active. Rolls 3D dice locally for the triggering player on each click without chat spam.
 *
 * @introduced v14.41.0
 */
import { MODULE_ID, log, debug, isFeatureActive } from "../../main.js";

/**
 * Map of active short rest aggregation sessions.
 * Key: Actor ID / UUID / Token ID / Name
 * Value: Session object
 * @type {Map<string, object>}
 */
const activeSessions = new Map();

/**
 * Checks whether the feature is currently active.
 * @returns {boolean}
 */
export function isAggregateShortRestRollsActive() {
    return isFeatureActive("enableAggregateShortRestRolls", "clientEnableAggregateShortRestRolls");
}

/**
 * Finds an open ShortRestDialog for the given actor.
 * Compatible with Foundry V14 ApplicationV2 (foundry.applications.instances) and classic ui.windows.
 * @param {Actor} actor
 * @returns {Application|null}
 */
function findShortRestAppForActor(actor) {
    if (!actor) return null;
    const actorId = actor.id;
    const actorUuid = actor.uuid;
    const actorName = actor.name;

    // Check Foundry ApplicationV2 instances
    if (foundry.applications?.instances) {
        for (const app of foundry.applications.instances.values()) {
            if (!app.rendered) continue;
            const isShortRest = app.config?.type === "short"
                || app.options?.classes?.includes("short-rest")
                || app.constructor?.name === "ShortRestDialog";
            if (isShortRest && app.actor) {
                if (app.actor === actor) return app;
                if (actorId && app.actor.id === actorId) return app;
                if (actorUuid && app.actor.uuid === actorUuid) return app;
                if (actorName && app.actor.name === actorName) return app;
            }
        }
    }

    // Check classic ui.windows
    if (ui.windows) {
        for (const app of Object.values(ui.windows)) {
            if (!app.rendered) continue;
            const isShortRest = app.options?.classes?.includes("short-rest")
                || app.constructor?.name === "ShortRestDialog";
            if (isShortRest && app.actor) {
                if (app.actor === actor) return app;
                if (actorId && app.actor.id === actorId) return app;
                if (actorUuid && app.actor.uuid === actorUuid) return app;
                if (actorName && app.actor.name === actorName) return app;
            }
        }
    }

    return null;
}

/**
 * Resolves an active session for an actor using all available identifiers.
 * @param {Actor} actor
 * @returns {object|null}
 */
function getSessionForActor(actor) {
    if (!actor) return null;
    if (actor._nd5tShortRestSession && !actor._nd5tShortRestSession.isFinalized) {
        return actor._nd5tShortRestSession;
    }

    const actorId = actor.id;
    const actorUuid = actor.uuid;
    const actorName = actor.name;
    const tokenId = actor.token?.id || (actor.isToken ? actor.id : null);
    const tokenUuid = actor.token?.uuid;

    for (const session of activeSessions.values()) {
        if (session.isFinalized) continue;
        if (session.actor === actor) return session;
        if (actorId && (session.actor?.id === actorId || session.actorId === actorId)) return session;
        if (actorUuid && (session.actor?.uuid === actorUuid || session.actorUuid === actorUuid)) return session;
        if (tokenId && (session.actor?.token?.id === tokenId || session.tokenId === tokenId)) return session;
        if (tokenUuid && (session.actor?.token?.uuid === tokenUuid || session.tokenUuid === tokenUuid)) return session;
        if (actorName && (session.actor?.name === actorName || session.actorName === actorName)) return session;
    }
    return null;
}

/**
 * Creates or retrieves a session for an actor.
 * @param {Actor} actor
 * @param {Application|null} dialog
 * @returns {object}
 */
function createSessionForActor(actor, dialog = null) {
    if (!actor) return null;
    const existing = getSessionForActor(actor);
    if (existing) {
        if (dialog) existing.dialog = dialog;
        return existing;
    }

    const session = {
        actor,
        userId: game.userId,
        actorId: actor.id,
        actorUuid: actor.uuid,
        actorName: actor.name,
        tokenId: actor.token?.id || (actor.isToken ? actor.id : null),
        tokenUuid: actor.token?.uuid,
        initialHp: actor.system?.attributes?.hp?.value ?? 0,
        initialHd: actor.system?.attributes?.hd?.value ?? 0,
        rolls: [],
        spentByDenom: {},
        lastRoll: null,
        dialog,
        isFinalized: false
    };

    actor._nd5tShortRestSession = session;
    if (dialog) dialog._nd5tShortRestSession = session;

    if (actor.uuid) activeSessions.set(actor.uuid, session);
    if (actor.id) activeSessions.set(actor.id, session);
    if (actor.name) activeSessions.set(actor.name, session);
    if (session.tokenId) activeSessions.set(session.tokenId, session);
    if (session.tokenUuid) activeSessions.set(session.tokenUuid, session);

    log(`Aggregate Short Rest | Session created for ${actor.name} (${actor.uuid}). Initial HP: ${session.initialHp}.`);
    return session;
}

/**
 * Completely cleans up a session from active maps and references.
 * @param {object} session
 */
function cleanUpSession(session) {
    if (!session) return;
    if (session.actor) delete session.actor._nd5tShortRestSession;
    if (session.dialog) delete session.dialog._nd5tShortRestSession;
    for (const [key, s] of activeSessions.entries()) {
        if (s === session) activeSessions.delete(key);
    }
}

/**
 * Formats a list of hit dice into a readable string (e.g. "2d8, 1d10" or "3d8").
 * @param {Record<string, number>} spentByDenom
 * @returns {string}
 */
function formatSpentDiceSummary(spentByDenom) {
    const parts = Object.entries(spentByDenom)
        .filter(([, count]) => count > 0)
        .map(([denom, count]) => `${count}${denom}`);
    return parts.join(", ") || "0 Hit Dice";
}

/**
 * Builds recipient IDs for changelog messages, compatible with niks-tiny-changelogs rules.
 * @param {Actor} actor
 * @returns {string[]}
 */
function getChangelogRecipients(actor) {
    const TINY_MOD_ID = "niks-tiny-changelogs";
    let visibility = "gm-player";
    try {
        if (game.modules.get(TINY_MOD_ID)?.active) {
            visibility = game.settings.get(TINY_MOD_ID, "messageVisibility") ?? "gm-player";
        }
    } catch {
        visibility = "gm-player";
    }

    const gmUsers = game.users.filter(u => u.isGM);
    const nonGmUsers = game.users.filter(u => !u.isGM);
    const owners = actor.testUserPermission
        ? game.users.filter(u => actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER))
        : [];

    const uniq = (...lists) => [...new Map(lists.flat().map(u => [u.id, u])).values()];

    if (visibility === "gm") return gmUsers.map(u => u.id);
    if (visibility === "player") return nonGmUsers.length > 0 ? nonGmUsers.map(u => u.id) : gmUsers.map(u => u.id);

    if (actor.type === "npc") {
        let npcMode = "gm-owners";
        try {
            if (game.modules.get(TINY_MOD_ID)?.active) {
                npcMode = game.settings.get(TINY_MOD_ID, "npcAudience") ?? "gm-owners";
            }
        } catch {}
        if (npcMode === "gm") return gmUsers.map(u => u.id);
        if (npcMode === "everyone" || npcMode === "gm-players") return [];
        const recipients = uniq(gmUsers, owners).map(u => u.id);
        return recipients.length > 0 ? recipients : gmUsers.map(u => u.id);
    }

    if (visibility === "everyone") return [];

    const recipients = uniq(gmUsers, owners).map(u => u.id);
    return recipients.length > 0 ? recipients : gmUsers.map(u => u.id);
}

/**
 * Creates and posts the two aggregated changelog messages if niks-tiny-changelogs is active.
 * @param {object} session
 * @param {number} totalHealingGained
 */
async function postAggregatedTinyChangelogs(session, totalHealingGained) {
    const TINY_MOD_ID = "niks-tiny-changelogs";
    if (!game.modules.get(TINY_MOD_ID)?.active) return;

    const actor = session.actor;
    const actorLink = `@UUID[${actor.uuid}]{${actor.token?.name ?? actor.name}}`;
    const recipients = getChangelogRecipients(actor);

    // 1. Hit Dice Changelog
    const totalDice = session.rolls.length;
    const denomKeys = Object.keys(session.spentByDenom);
    let diceDesc;
    if (denomKeys.length === 1) {
        const denom = denomKeys[0];
        diceDesc = totalDice === 1 ? denom : `${totalDice} ${denom}`;
    } else {
        const parts = Object.entries(session.spentByDenom).map(([denom, count]) => `${count} ${denom}`);
        diceDesc = `${totalDice} Hit Dice (${parts.join(", ")})`;
    }

    const hdLine = `<i class="fa-solid fa-heart-pulse"></i> <span class="tm-actor">${actorLink}</span> <span class="tm-text">expended ${diceDesc}</span>`;
    const hdMsgData = {
        content: `<div class="tiny-monitor-line">${hdLine}</div>`,
        flags: {
            [MODULE_ID]: { isAggregatedChangelog: true },
            [TINY_MOD_ID]: {
                isMonitorMsg: true,
                kind: "hitdice",
                cls: "tiny-monitor-loss"
            }
        }
    };
    if (recipients.length > 0) hdMsgData.whisper = recipients;
    await ChatMessage.create(hdMsgData);

    // 2. Hit Points Changelog (if any healing gained or HP changed)
    if (totalHealingGained > 0) {
        let isSimple = false;
        try {
            isSimple = Boolean(game.settings.get(TINY_MOD_ID, "simpleOutput"));
        } catch {
            isSimple = false;
        }

        const newHp = actor.system?.attributes?.hp?.value ?? session.initialHp;
        const oldHp = session.initialHp;

        const hpText = isSimple
            ? `HP: + ${totalHealingGained}`
            : `HP: ${oldHp} + ${totalHealingGained} → ${newHp}`;

        const hpLine = `<i class="fa-solid fa-heart"></i> <span class="tm-actor">${actorLink}</span> <span class="tm-text">${hpText}</span>`;
        const hpMsgData = {
            content: `<div class="tiny-monitor-line">${hpLine}</div>`,
            flags: {
                [MODULE_ID]: { isAggregatedChangelog: true },
                [TINY_MOD_ID]: {
                    isMonitorMsg: true,
                    kind: "hp",
                    cls: "tiny-monitor-gain"
                }
            }
        };
        if (recipients.length > 0) hpMsgData.whisper = recipients;
        await ChatMessage.create(hpMsgData);
    }
}

/**
 * Combines multiple individual hit die rolls into a single evaluated BasicRoll.
 * Produces a clean consolidated formula (e.g. "8d8 + 40") whose tooltip contains
 * all individual rolled dice and modifiers, rendering as a single summary roll.
 * @param {BasicRoll[]} rolls
 * @returns {BasicRoll}
 */
function createAggregatedRoll(rolls) {
    if (!rolls?.length) return null;
    if (rolls.length === 1) return rolls[0];

    const { Die, NumericTerm, OperatorTerm } = foundry.dice.terms;
    const RollClass = CONFIG.Dice.BasicRoll || Roll;

    try {
        // Group dice results by denomination (faces)
        const diceByFaces = new Map();
        let totalRollsSum = 0;
        let totalDiceSum = 0;

        for (const roll of rolls) {
            totalRollsSum += (roll.total ?? 0);
            for (const die of (roll.dice || [])) {
                const faces = Number(die.faces) || 8;
                if (!diceByFaces.has(faces)) diceByFaces.set(faces, []);
                const resultsArr = diceByFaces.get(faces);

                for (const r of (die.results || [])) {
                    resultsArr.push({
                        result: r.result,
                        active: r.active !== false
                    });
                    if (r.active !== false) totalDiceSum += r.result;
                }
            }
        }

        // Build the consolidated terms array
        const terms = [];
        let isFirst = true;

        // Sort by faces descending (e.g. d12, d10, d8, d6)
        const sortedFaces = Array.from(diceByFaces.keys()).sort((a, b) => b - a);

        for (const faces of sortedFaces) {
            const results = diceByFaces.get(faces);
            if (!results.length) continue;

            if (!isFirst) {
                terms.push(new OperatorTerm({ operator: "+" }));
            }
            isFirst = false;

            // Die with pre-cast results is automatically marked _evaluated: true by constructor
            const dieTerm = new Die({
                faces,
                number: results.length,
                results: results
            });
            terms.push(dieTerm);
        }

        // Calculate modifier delta (sum of ability/flat bonuses across all rolls)
        const modifier = totalRollsSum - totalDiceSum;
        if (modifier !== 0) {
            terms.push(new OperatorTerm({ operator: modifier >= 0 ? "+" : "-" }));
            terms.push(new NumericTerm({ number: Math.abs(modifier) }));
        }

        // Ensure all terms are marked evaluated so Roll.fromTerms succeeds
        for (const term of terms) {
            if (!term._evaluated) {
                try {
                    term.evaluate();
                } catch (_) {
                    term._evaluated = true;
                }
            }
        }

        const combinedRoll = RollClass.fromTerms(terms, { rollType: "hitDie" });
        return combinedRoll;
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to create consolidated roll from terms:", err);
        return rolls[0];
    }
}

/**
 * Creates the single aggregated Hit Dice roll chat card containing a single consolidated roll.
 * @param {object} session
 * @param {number} totalHealingGained
 */
async function postAggregatedHitDiceRollCard(session, totalHealingGained) {
    if (!session.rolls.length) return;

    const actor = session.actor;
    const rolls = session.rolls;
    const totalRollSum = rolls.reduce((sum, r) => sum + (r.total || 0), 0);
    const totalDiceCount = rolls.length;
    const diceSummary = formatSpentDiceSummary(session.spentByDenom);

    let consolidatedRoll = null;
    try {
        consolidatedRoll = createAggregatedRoll(rolls);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error creating aggregated roll:", err);
    }
    const rollList = (consolidatedRoll && consolidatedRoll._evaluated) ? [consolidatedRoll] : rolls;

    const chatData = {
        author: game.user.id,
        speaker: ChatMessage.implementation.getSpeaker({ actor, alias: actor.name }),
        flavor: `${game.i18n.localize("DND5E.REST.Short.Label")} — ${diceSummary}`,
        rolls: rollList,
        type: "hitDie",
        flags: {
            [MODULE_ID]: {
                isAggregatedHitDice: true,
                diceCount: totalDiceCount,
                spentByDenom: session.spentByDenom,
                totalHealing: totalHealingGained,
                totalRollSum: totalRollSum
            },
            "dice-so-nice": {
                // Prevent DSN from re-rolling all dice in 3D since they were already animated per click
                skip: true
            }
        }
    };

    ChatMessage.applyMode(chatData, CONFIG.Dice.BasicRoll.getMessageMode());
    return ChatMessage.create(chatData);
}

/**
 * Finalizes an active short rest session, creating the single roll card and changelogs.
 * Can be triggered on rest completion or when the dialog closes with rolls made.
 * @param {object} session
 */
async function finalizeSession(session) {
    if (!session || session.isFinalized) return;
    session.isFinalized = true;

    cleanUpSession(session);

    if (!session.rolls.length) {
        debug(`Aggregate Short Rest | Session closed for ${session.actor.name} with 0 rolls.`);
        return;
    }

    log(`Aggregate Short Rest | Finalizing ${session.rolls.length} rolls for ${session.actor.name}.`);

    // Compute actual healing gained
    const currentHp = session.actor.system?.attributes?.hp?.value ?? session.initialHp;
    const healingGained = Math.max(0, currentHp - session.initialHp);

    try {
        // 1. Post the single aggregated chat card
        await postAggregatedHitDiceRollCard(session, healingGained);

        // 2. Post the two aggregated changelogs
        await postAggregatedTinyChangelogs(session, healingGained);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Failed to finalize aggregated short rest rolls:", err);
    }
}


/**
 * Tests whether a chat message belongs to an actor with an active short rest session.
 * @param {ChatMessage} message
 * @param {object} data
 * @param {object} session
 * @returns {boolean}
 */
function isMessageForSession(message, data, session) {
    if (!session?.actor) return false;
    const actor = session.actor;
    const content = message?.content || data?.content || "";
    const speakerActor = message?.speaker?.actor || data?.speaker?.actor;

    if (speakerActor && (speakerActor === actor.id || speakerActor === actor.token?.id || speakerActor === session.actorId)) {
        return true;
    }

    if (actor.id && content.includes(actor.id)) return true;
    if (actor.uuid && content.includes(actor.uuid)) return true;
    if (session.actorId && content.includes(session.actorId)) return true;
    if (session.actorUuid && content.includes(session.actorUuid)) return true;
    if (session.tokenId && content.includes(session.tokenId)) return true;

    if (actor.name && content.includes(actor.name)) return true;
    if (actor.name && content.includes(actor.name.slice(0, 10))) return true;
    if (actor.token?.name && content.includes(actor.token.name)) return true;

    const uuidMatch = content.match(/@UUID\[([^\]]+)\]/);
    if (uuidMatch) {
        const docUuid = uuidMatch[1];
        if (docUuid === actor.uuid || docUuid === session.actorUuid) return true;
        try {
            const doc = fromUuidSync(docUuid);
            const docActor = doc instanceof Actor ? doc : doc?.actor;
            if (docActor && (docActor === actor || docActor.id === actor.id || docActor.id === session.actorId)) return true;
        } catch {}
    }

    return false;
}

/**
 * Initializes the Aggregate Short Rest Hit Dice Rolls feature.
 */
export function initAggregateShortRestRolls() {
    log("Initializing Aggregate Short Rest Hit Dice Rolls feature.");

    const Actor5eClass = CONFIG.Actor.documentClass || dnd5e?.documents?.Actor5e;
    if (!Actor5eClass?.prototype?.rollHitDie) {
        console.warn("Nik's DnD5e Tweaks | Actor5e.prototype.rollHitDie not found. Short rest hit dice aggregation disabled.");
        return;
    }

    // =========================================================================
    // 1. Wrap Actor5e.prototype.rollHitDie
    // Intercepts EVERY hit die roll made during a short rest (via dialog, sheet, or auto-spend).
    // Suppresses individual chat message creation, immediately applies HP & HD database updates,
    // and animates local 3D dice for the rolling player.
    // =========================================================================
    const origRollHitDie = Actor5eClass.prototype.rollHitDie;
    Actor5eClass.prototype.rollHitDie = async function(config = {}, dialog = {}, message = {}) {
        if (!isAggregateShortRestRollsActive()) {
            return origRollHitDie.call(this, config, dialog, message);
        }

        // Check if this actor has an active session or an open ShortRestDialog
        let session = getSessionForActor(this);
        const shortRestApp = findShortRestAppForActor(this);

        if (!session && shortRestApp) {
            session = createSessionForActor(this, shortRestApp);
        }

        // If not currently in a short rest session, execute standard roll workflow
        if (!session) {
            return origRollHitDie.call(this, config, dialog, message);
        }

        // Suppress individual chat card creation directly via messageConfig
        const messageConfig = foundry.utils.mergeObject(message || {}, { create: false });
        messageConfig.create = false;

        log(`Aggregate Short Rest | Rolling hit die for ${this.name} with message creation suppressed.`);
        const rolls = await origRollHitDie.call(this, config, dialog, messageConfig);

        if (rolls?.length) {
            for (const r of rolls) {
                session.rolls.push(r);
                session.lastRoll = r;

                for (const die of (r.dice || [])) {
                    const d = `d${die.faces}`;
                    session.spentByDenom[d] = (session.spentByDenom[d] || 0) + (die.number || 1);
                }

                // Play 3D dice locally for the active player only (no chat broadcast)
                if (game.dice3d?.showForRoll) {
                    try {
                        game.dice3d.showForRoll(r, game.user, false);
                    } catch (e) {
                        debug("Aggregate Short Rest | DSN 3D dice error:", e);
                    }
                }
            }
        }

        return rolls;
    };
    log("Aggregate Short Rest | Successfully wrapped Actor5e.prototype.rollHitDie");

    // =========================================================================
    // 2. Hook: dnd5e.preShortRest — Pre-initialize session when short rest starts
    // =========================================================================
    Hooks.on("dnd5e.preShortRest", (actor, config) => {
        if (!isAggregateShortRestRollsActive()) return;
        createSessionForActor(actor);
    });

    // =========================================================================
    // 3. Hook: renderShortRestDialog — Store dialog reference & attach close listener
    // =========================================================================
    Hooks.on("renderShortRestDialog", (app, element, context, options) => {
        if (!isAggregateShortRestRollsActive()) return;
        const actor = app.actor;
        if (!actor) return;

        let session = getSessionForActor(actor);
        if (!session) {
            session = createSessionForActor(actor, app);
        } else {
            session.dialog = app;
        }

        // Attach close event listener to the dialog instance
        if (!app._nd5tCloseBound) {
            app._nd5tCloseBound = true;
            app.addEventListener("close", async () => {
                if (!isAggregateShortRestRollsActive()) return;
                const s = getSessionForActor(actor);
                if (!s || s.isFinalized) return;
                if (!app.rested) {
                    if (s.rolls.length > 0) {
                        log(`Aggregate Short Rest | Dialog closed without resting with ${s.rolls.length} rolls for ${actor.name}. Finalizing.`);
                        await finalizeSession(s);
                    } else {
                        s.isFinalized = true;
                        cleanUpSession(s);
                    }
                }
            }, { once: true });
        }
    });

    // =========================================================================
    // 4. Hook: closeShortRestDialog — Anti-cheat safety net when dialog closes/cancels
    // =========================================================================
    Hooks.on("closeShortRestDialog", async (app) => {
        if (!isAggregateShortRestRollsActive()) return;
        const actor = app.actor;
        if (!actor) return;

        const session = getSessionForActor(actor);
        if (!session || session.isFinalized) return;

        if (!app.rested) {
            if (session.rolls.length > 0) {
                log(`Aggregate Short Rest | Dialog closed without resting with ${session.rolls.length} rolls for ${actor.name}. Finalizing.`);
                await finalizeSession(session);
            } else {
                session.isFinalized = true;
                cleanUpSession(session);
            }
        }
    });

    // =========================================================================
    // 5. Hook: dnd5e.restCompleted — Finalize on normal rest completion
    // =========================================================================
    Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
        if (!isAggregateShortRestRollsActive()) return;
        const session = getSessionForActor(actor);
        if (!session || session.isFinalized) return;

        await finalizeSession(session);
    });

    // =========================================================================
    // 6. Hook: preCreateChatMessage — Suppress individual changelogs & stray hitDie cards during rest
    // =========================================================================
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
        if (!isAggregateShortRestRollsActive()) return;

        // Never suppress our own aggregated messages
        if (message.flags?.[MODULE_ID]?.isAggregatedChangelog
            || data?.flags?.[MODULE_ID]?.isAggregatedChangelog
            || message.flags?.[MODULE_ID]?.isAggregatedHitDice
            || data?.flags?.[MODULE_ID]?.isAggregatedHitDice) {
            return true;
        }

        // 1. Suppress individual tiny-changelogs (hp and hitdice) during an active rest session
        const tinyFlag = message.flags?.["niks-tiny-changelogs"] ?? data?.flags?.["niks-tiny-changelogs"];
        if (tinyFlag?.isMonitorMsg && (tinyFlag.kind === "hp" || tinyFlag.kind === "hitdice")) {
            for (const session of activeSessions.values()) {
                if (session.isFinalized) continue;
                if (isMessageForSession(message, data, session)) {
                    debug(`Aggregate Short Rest | Suppressed tiny-changelog (${tinyFlag.kind}) for ${session.actor.name}.`);
                    return false;
                }
            }
        }

        // 2. Safety net: Suppress stray individual hitDie roll chat cards during an active rest session
        const isHitDieMsg = (message.type === "hitDie" || data?.type === "hitDie" || message.flags?.dnd5e?.roll?.type === "hitDie");
        if (isHitDieMsg) {
            for (const session of activeSessions.values()) {
                if (session.isFinalized) continue;
                if (isMessageForSession(message, data, session)) {
                    debug(`Aggregate Short Rest | Suppressed individual hitDie card for ${session.actor.name}.`);
                    return false;
                }
            }
        }
    });

    // =========================================================================
    // 7. Hook: diceSoNiceMessagePreProcess — Prevent DSN from re-rolling all dice on the aggregated message
    // =========================================================================
    Hooks.on("diceSoNiceMessagePreProcess", (messageId, interception) => {
        const msg = game.messages.get(messageId);
        if (msg?.flags?.[MODULE_ID]?.isAggregatedHitDice) {
            interception.willTrigger3DRoll = false;
        }
    });
}
