/**
 * Feature: Auto-Collapse Damage Trays (GM & Players)
 * Description: Automatically collapses damage and healing application trays on chat cards when they are not actionable:
 * - For GMs: Collapses when damage or effects originate from hostile NPCs targeting player characters (delegating application to players).
 * - For Players: Collapses when no targeted tokens are owned by the current player (such as damage rolls targeting NPCs), preventing chat clutter and confusion.
 * - For Healing / Temp HP: Keeps trays open for players even when aimed at enemy NPCs (assumed combat mistargets), and automatically switches targeting to selected tokens instead.
 *
 * @introduced v14.31.0
 * @updated v14.46.4
 */
import { MODULE_ID, log, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Auto-Collapse Damage Trays (GM & Players)
 *
 * In DnD5e v6, damage and healing chat cards feature a `<damage-application>` tray allowing
 * users to apply damage, healing, or temporary HP directly to targeted tokens. When DnD5e's setting
 * "Allow Players to Apply Damage" (`dnd5e.allowPlayerDamageTray`) is enabled,
 * player characters can apply damage/healing themselves.
 *
 * - For GMs, having every incoming monster attack damage tray expanded creates
 *   unnecessary chat clutter when the player will be applying the damage themselves.
 * - For Players, damage rolls targeting NPCs (or other players' tokens) render an
 *   expanded damage tray with multiplier buttons and an "Apply" button that does
 *   literally nothing, as DnD5e strictly restricts damage application to tokens
 *   owned by the active user. Auto-collapsing these trays cleans up the player's
 *   chat log and prevents confusion.
 * - For Healing / Temporary HP rolls aimed at enemies, players frequently have an enemy
 *   targeted from a previous attack. In this scenario, the tray stays expanded for players
 *   and automatically switches from "Targeted" to "Selected" tokens, allowing immediate healing.
 */

/**
 * Check whether a message represents a damage, healing, or temporary HP roll with a `<damage-application>` tray.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {boolean}
 */
export function hasDamageApplicationTray(message, html) {
    if (!message) return false;
    if (message.type === "damage" || message.type === "healing") return true;
    if (message.system?.canApplyDamage === true || message.system?.isHealing === true) return true;
    const rollType = message.flags?.dnd5e?.roll?.type;
    if (rollType === "damage" || rollType === "healing") return true;
    const DamageRoll = CONFIG.Dice?.DamageRoll;
    if (DamageRoll && message.rolls?.some(r => r instanceof DamageRoll)) return true;

    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
    if (el?.querySelector?.("damage-application") || el?.matches?.("damage-application")) return true;
    return false;
}

/**
 * Check whether a message represents a healing or temporary HP roll.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {boolean}
 */
export function isHealingOrTempHpRoll(message, html) {
    if (!message) return false;
    if (message.type === "healing" || message.system?.isHealing === true) return true;
    if (message.flags?.dnd5e?.roll?.type === "healing") return true;
    try {
        if (message.getAssociatedActivity?.()?.type === "heal") return true;
    } catch {
        // Safe fallback in case getAssociatedActivity fails on foreign or malformed messages
    }

    const healingTypes = new Set(
        CONFIG.DND5E?.healingTypes ? Object.keys(CONFIG.DND5E.healingTypes) : ["healing", "temphp", "maximum"]
    );
    healingTypes.add("healing");
    healingTypes.add("temphp");
    healingTypes.add("temp");
    healingTypes.add("maximum");

    if (message.rolls?.length) {
        const hasHealingType = message.rolls.some(r => {
            const t = r.options?.type;
            if (t && healingTypes.has(t)) return true;
            if (Array.isArray(r.options?.types) && r.options.types.some(type => healingTypes.has(type))) return true;
            return false;
        });
        if (hasHealingType) return true;
    }

    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
    const tray = el?.matches?.("damage-application") ? el : el?.querySelector?.("damage-application");
    if (tray?.damages?.length) {
        if (tray.damages.some(d => healingTypes.has(d.type))) return true;
    }

    return false;
}

/**
 * Determine whether an actor is an NPC or hostile/enemy target.
 * Owned tokens (even if NPC-type summons or pets) are never considered enemy mistargets.
 *
 * @param {Actor5e} actor
 * @returns {boolean}
 */
export function isNpcOrEnemy(actor) {
    if (!actor) return false;
    if (actor.isOwner) return false;
    if (actor.type === "character" || actor.hasPlayerOwner) return false;
    if (actor.type === "npc") return true;

    const token = actor.token ?? actor.getActiveTokens?.()?.[0];
    const disposition = token?.document?.disposition
        ?? token?.disposition
        ?? actor.prototypeToken?.disposition;

    if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE || disposition === -1) return true;
    if (disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL || disposition === 0) return true;

    return !actor.hasPlayerOwner;
}

/**
 * Check whether a message represents a player-originating healing / temporary HP roll
 * that was aimed exclusively at NPCs or enemy targets (assumed mistargeted from previous combat actions).
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {boolean}
 */
export function isPlayerHealingAimedAtNpc(message, html) {
    if (!message) return false;
    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;

    if (message._nd5tIsHealingMistarget !== undefined && (!el || message._nd5tHadHtml)) {
        return message._nd5tIsHealingMistarget;
    }

    if (!hasDamageApplicationTray(message, el)) {
        message._nd5tIsHealingMistarget = false;
        if (el) message._nd5tHadHtml = true;
        return false;
    }

    if (!isHealingOrTempHpRoll(message, el)) {
        message._nd5tIsHealingMistarget = false;
        if (el) message._nd5tHadHtml = true;
        return false;
    }

    // Determine the caster / source actor
    let sourceActor = null;
    try {
        sourceActor = message.getAssociatedActor?.()
            ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null)
            ?? message.speakerActor;
    } catch {
        sourceActor = (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null) ?? message.speakerActor;
    }

    // Must originate from a player character, player-owned actor, or non-GM author
    const isPlayerCaster = Boolean(
        sourceActor?.type === "character"
        || sourceActor?.hasPlayerOwner
        || sourceActor?.isOwner
        || (!message.author?.isGM && message.author)
    );
    if (!isPlayerCaster) {
        message._nd5tIsHealingMistarget = false;
        if (el) message._nd5tHadHtml = true;
        return false;
    }

    const targetActors = _resolveDamageTargets(message, el);
    if (!targetActors.length) {
        message._nd5tIsHealingMistarget = false;
        if (el) message._nd5tHadHtml = true;
        return false;
    }

    // If the player owns ANY of the targeted actors, this was an intentional target on their own token
    const hasAnyOwnedTarget = targetActors.some(actor => actor?.isOwner);
    if (hasAnyOwnedTarget) {
        message._nd5tIsHealingMistarget = false;
        if (el) message._nd5tHadHtml = true;
        return false;
    }

    // Must be aimed exclusively at unowned NPCs / enemies
    const isMistarget = targetActors.every(actor => isNpcOrEnemy(actor));
    message._nd5tIsHealingMistarget = isMistarget;
    if (el) message._nd5tHadHtml = true;
    return isMistarget;
}

/**
 * For player healing / temp HP rolls aimed at NPCs/enemies:
 * Ensure the tray is open, and automatically switch the target mode to "selected".
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function _handlePlayerHealingMistarget(message, html) {
    if (!message) return;

    // Set message target state mode to "selected" so any newly connected recorded-targets element defaults to selected
    message._targetState ??= { checked: new Map(), mode: "" };
    message._targetState.mode = "selected";

    // Ensure tray states indicate open (unless user has explicitly collapsed it previously)
    if (message._trayStates?.get("DAMAGE-APPLICATION") !== false && message._trayStates?.get("damage-application") !== false) {
        message._trayStates ??= new Map();
        message._trayStates.set("DAMAGE-APPLICATION", true);
        message._trayStates.set("damage-application", true);
    }

    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
    if (!el) return;

    el.removeAttribute("data-nd5t-tray-collapsed");

    // If the user hasn't explicitly collapsed the tray, ensure it is open
    if (message._trayStates?.get("DAMAGE-APPLICATION") !== false && message._trayStates?.get("damage-application") !== false) {
        const trays = el.querySelectorAll("damage-application");
        for (const tray of trays) {
            tray.setAttribute("open", "");
            tray.querySelector(".collapsible")?.classList.remove("collapsed");
            if (tray.targetList) {
                tray.targetList.suspended = false;
                if (tray.targetList.targetingMode !== "selected") {
                    tray.targetList.targetingMode = "selected";
                }
            }
        }

        const cardTrays = el.querySelectorAll("damage-application .card-tray, .card-tray.damage-tray");
        for (const ct of cardTrays) {
            ct.classList.remove("collapsed");
        }
    }

    // Switch any existing recorded-targets elements to "selected" mode
    const recordedTargets = el.querySelectorAll("recorded-targets");
    for (const rt of recordedTargets) {
        if (rt.targetingMode !== "selected") {
            rt.targetingMode = "selected";
        }
    }

    // Schedule a microtask for when elements are attached to the DOM so connected custom elements update
    queueMicrotask(() => {
        const containers = new Set();
        if (el.isConnected) containers.add(el);
        if (message.id) {
            for (const card of document.querySelectorAll(`[data-message-id="${message.id}"]`)) {
                containers.add(card);
            }
        }
        if (!containers.size) return;

        for (const targetContainer of containers) {
            if (message._trayStates?.get("DAMAGE-APPLICATION") !== false && message._trayStates?.get("damage-application") !== false) {
                targetContainer.removeAttribute("data-nd5t-tray-collapsed");
                for (const tray of targetContainer.querySelectorAll("damage-application")) {
                    tray.setAttribute("open", "");
                    tray.querySelector(".collapsible")?.classList.remove("collapsed");
                    if (tray.targetList) {
                        tray.targetList.suspended = false;
                        if (tray.targetList.targetingMode !== "selected") {
                            tray.targetList.targetingMode = "selected";
                        }
                    }
                }
                for (const ct of targetContainer.querySelectorAll("damage-application .card-tray, .card-tray.damage-tray")) {
                    ct.classList.remove("collapsed");
                }
            }

            const rts = targetContainer.querySelectorAll("recorded-targets");
            for (const rt of rts) {
                rt.suspended = false;
                if (rt.targetingMode !== "selected") {
                    rt.targetingMode = "selected";
                }
            }
        }
    });
}

/**
 * Check whether a message's damage application tray should be auto-collapsed for the current user.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {boolean}
 */
export function shouldCollapseDamageTray(message, html) {
    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;

    if (message?._nd5tShouldCollapseTray !== undefined && (!el || message._nd5tHadHtml)) {
        return message._nd5tShouldCollapseTray;
    }

    // Must have DnD5e's allowPlayerDamageTray enabled
    const allowPlayerDamage = Boolean(game.settings.get("dnd5e", "allowPlayerDamageTray"));
    if (!allowPlayerDamage) {
        if (message) {
            message._nd5tShouldCollapseTray = false;
            if (el) message._nd5tHadHtml = true;
        }
        return false;
    }

    // Check if the message is a damage / healing / temp HP roll or contains a damage application tray
    if (!hasDamageApplicationTray(message, el)) {
        if (message) {
            message._nd5tShouldCollapseTray = false;
            if (el) message._nd5tHadHtml = true;
        }
        return false;
    }

    let shouldCollapse = false;

    // Case 1: GM view
    if (game.user?.isGM) {
        if (!game.settings.get(MODULE_ID, "enableAutoCollapseHostileDamageTrays")) {
            if (message) {
                message._nd5tShouldCollapseTray = false;
                if (el) message._nd5tHadHtml = true;
            }
            return false;
        }

        // Determine the source actor and token
        let sourceActor = null;
        try {
            sourceActor = message.getAssociatedActor?.()
                ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null)
                ?? message.speakerActor;
        } catch {
            sourceActor = (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null) ?? message.speakerActor;
        }

        let sourceToken = null;
        try {
            sourceToken = message.getAssociatedToken?.()
                ?? (message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null);
        } catch {
            sourceToken = (message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null);
        }

        if (!sourceActor) {
            if (message) {
                message._nd5tShouldCollapseTray = false;
                if (el) message._nd5tHadHtml = true;
            }
            return false;
        }

        // Check if the source is a hostile NPC
        const isNPC = sourceActor.type === "npc" || !sourceActor.hasPlayerOwner;
        const disposition = sourceToken?.document?.disposition
            ?? sourceToken?.disposition
            ?? sourceActor.prototypeToken?.disposition;

        const isHostile = isNPC && (
            disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE
            || disposition === -1
            || (disposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY && disposition !== 1)
        );

        if (isHostile) {
            // Gather targets
            const targetActors = _resolveDamageTargets(message, el);
            if (targetActors.length) {
                // Check if targets include player characters
                shouldCollapse = targetActors.some(actor =>
                    actor?.type === "character" || actor?.hasPlayerOwner
                );
            }
        }
    } else {
        // Case 2: Player view
        if (!game.settings.get(MODULE_ID, "enableAutoCollapsePlayerDamageTrays")) {
            if (message) {
                message._nd5tShouldCollapseTray = false;
                if (el) message._nd5tHadHtml = true;
            }
            return false;
        }

        // Special handling for healing / temp HP rolls aimed at NPCs/enemies:
        // Do NOT collapse for players; keep the tray open so they can apply healing to their selected tokens!
        if (isPlayerHealingAimedAtNpc(message, el)) {
            if (message) {
                message._nd5tShouldCollapseTray = false;
                if (el) message._nd5tHadHtml = true;
            }
            return false;
        }

        // Gather targets
        const targetActors = _resolveDamageTargets(message, el);
        if (targetActors.length) {
            // If the player owns ANY of the targeted actors, keep the tray expanded
            const ownsAnyTarget = targetActors.some(actor => actor?.isOwner);
            if (!ownsAnyTarget) {
                // Unowned targets: player cannot apply damage/healing anyway, so collapse
                shouldCollapse = true;
            }
        }
    }

    if (message) {
        message._nd5tShouldCollapseTray = shouldCollapse;
        if (el) message._nd5tHadHtml = true;
    }
    return shouldCollapse;
}

/**
 * Backward-compatible alias for shouldCollapseDamageTray.
 * @type {typeof shouldCollapseDamageTray}
 */
export const shouldCollapseHostileDamageTray = shouldCollapseDamageTray;

/**
 * Resolve target actors associated with a damage message or its rendered markup.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {Actor5e[]}
 */
function _resolveDamageTargets(message, html) {
    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
    const actors = new Set();

    // 1. Direct message targets in system.targets
    const msgTargets = message.system?.targets;
    if (Array.isArray(msgTargets) && msgTargets.length > 0) {
        for (const target of msgTargets) {
            const actor = _resolveTargetDescriptor(target);
            if (actor) actors.add(actor);
        }
    }

    // 2. Associated attack roll targets
    if (!actors.size && typeof message.getAssociatedRolls === "function") {
        try {
            const attackRolls = message.getAssociatedRolls("attack");
            const lastAttack = attackRolls?.pop?.();
            const attackTargets = lastAttack?.system?.targets;
            if (Array.isArray(attackTargets) && attackTargets.length > 0) {
                for (const target of attackTargets) {
                    const actor = _resolveTargetDescriptor(target);
                    if (actor) actors.add(actor);
                }
            }
        } catch {
            // Defensive: ignore failures in associated rolls
        }
    }

    // 3. Targets from originating message (e.g. usage card that triggered the damage/heal roll)
    if (!actors.size && typeof message.getOriginatingMessage === "function") {
        try {
            const origin = message.getOriginatingMessage();
            if (origin && typeof origin === "object") {
                const originTargets = origin?.system?.targets;
                if (Array.isArray(originTargets) && originTargets.length > 0) {
                    for (const target of originTargets) {
                        const actor = _resolveTargetDescriptor(target);
                        if (actor) actors.add(actor);
                    }
                }
            }
        } catch {
            // Defensive: ignore failures in originating message lookup
        }
    }

    // 4. Targets recorded in the DOM (<recorded-targets> pills/options)
    if (!actors.size && el) {
        const targetElements = el.querySelectorAll(
            "damage-application recorded-targets option, damage-application recorded-targets target-pill, recorded-targets option, recorded-targets target-pill, damage-application [data-uuid]"
        );
        for (const item of targetElements) {
            const rawVal = item.value ?? item.dataset?.uuid ?? item.getAttribute("value");
            const values = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
            for (const val of values) {
                if (typeof val !== "string") continue;
                try {
                    const doc = fromUuidSync(val, { strict: false });
                    const actor = doc?.actor ?? (doc instanceof Actor ? doc : null);
                    if (actor) actors.add(actor);
                } catch (_) {}
            }
        }
    }

    return Array.from(actors);
}

/**
 * Resolve an actor from a target descriptor.
 *
 * @param {object|string} descriptor
 * @returns {Actor5e|null}
 */
function _resolveTargetDescriptor(descriptor) {
    if (!descriptor) return null;
    if (descriptor instanceof Actor) return descriptor;
    if (descriptor?.actor instanceof Actor) return descriptor.actor;

    try {
        if (dnd5e?.dataModels?.chatMessage?.fields?.TargetsField?.resolve) {
            const resolved = dnd5e.dataModels.chatMessage.fields.TargetsField.resolve(descriptor);
            if (resolved?.actor) return resolved.actor;
            if (resolved?.token?.actor) return resolved.token.actor;
            if (resolved?.token?.document?.actor) return resolved.token.document.actor;
        }
    } catch (_) {}

    if (descriptor.token) {
        if (descriptor.token instanceof Actor) return descriptor.token;
        if (descriptor.token?.actor instanceof Actor) return descriptor.token.actor;
        if (typeof descriptor.token === "string") {
            try {
                const tokenDoc = fromUuidSync(descriptor.token, { strict: false });
                if (tokenDoc?.actor) return tokenDoc.actor;
                if (tokenDoc instanceof Actor) return tokenDoc;
            } catch (_) {}
        }
    }

    if (descriptor.actor) {
        if (descriptor.actor instanceof Actor) return descriptor.actor;
        if (typeof descriptor.actor === "string") {
            try {
                const doc = fromUuidSync(descriptor.actor, { strict: false });
                if (doc instanceof Actor) return doc;
                if (doc?.actor) return doc.actor;
            } catch (_) {}
        }
    }

    if (typeof descriptor === "string") {
        try {
            const doc = fromUuidSync(descriptor, { strict: false });
            if (doc instanceof Actor) return doc;
            if (doc?.actor) return doc.actor;
        } catch (_) {}
    }

    return null;
}

/**
 * Collapse the damage application tray on a chat card element.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function _collapseTrayElement(message, html) {
    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;
    if (!el) return;

    if (el.dataset.nd5tTrayCollapsed === "true") return;

    // If the user has explicitly opened the tray on this card, preserve their explicit choice
    if (message._trayStates?.get("DAMAGE-APPLICATION") === true || message._trayStates?.get("damage-application") === true) {
        return;
    }

    const trays = el.querySelectorAll("damage-application");
    if (!trays.length) return;

    el.dataset.nd5tTrayCollapsed = "true";

    message._trayStates ??= new Map();
    message._trayStates.set("DAMAGE-APPLICATION", false);
    message._trayStates.set("damage-application", false);
    message._nd5tAutoCollapsed = true;

    for (const tray of trays) {
        tray.removeAttribute("open");
        tray.querySelector(".collapsible")?.classList.toggle("collapsed", true);
        if (tray.targetList) tray.targetList.suspended = true;
    }

    const cardTrays = el.querySelectorAll("damage-application .card-tray, .card-tray.damage-tray");
    for (const ct of cardTrays) {
        ct.classList.add("collapsed");
    }
}

/**
 * Initialize the Auto-Collapse Damage Trays feature.
 */
export function initAutoCollapseDamageTrays() {
    patchMethod(
        "CONFIG.ChatMessage.documentClass.prototype._collapseTrays",
        function(wrapped, html) {
            wrapped(html);
            if (!hasDamageApplicationTray(this, html)) return;
            if (!game.user?.isGM && isPlayerHealingAimedAtNpc(this, html)) {
                _handlePlayerHealingMistarget(this, html);
            } else if (shouldCollapseDamageTray(this, html)) {
                _collapseTrayElement(this, html);
            }
        },
        "WRAPPER"
    );

    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        if (!hasDamageApplicationTray(message, html)) return;
        if (!game.user?.isGM && isPlayerHealingAimedAtNpc(message, html)) {
            _handlePlayerHealingMistarget(message, html);
        } else if (shouldCollapseDamageTray(message, html)) {
            _collapseTrayElement(message, html);
        }
    });

    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (!hasDamageApplicationTray(message, html)) return;
        if (!game.user?.isGM && isPlayerHealingAimedAtNpc(message, html)) {
            _handlePlayerHealingMistarget(message, html);
        } else if (shouldCollapseDamageTray(message, html)) {
            _collapseTrayElement(message, html);
        }
    });

    debug("Auto-Collapse Damage Trays | Initialized");
}
