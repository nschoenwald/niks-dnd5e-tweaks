/**
 * Feature: Auto-Collapse Damage Trays (GM & Players)
 * Description: Automatically collapses damage application trays on chat cards when they are not actionable:
 * - For GMs: Collapses when damage originates from hostile NPCs targeting player characters (delegating damage application to players).
 * - For Players: Collapses when no targeted tokens are owned by the current player (such as NPC targets), preventing chat clutter and confusion.
 *
 * @introduced v14.31.0
 * @updated v14.38.0
 */
import { MODULE_ID, log, debug } from "../../main.js";

/**
 * Auto-Collapse Damage Trays (GM & Players)
 *
 * In DnD5e v6, damage chat cards feature a `<damage-application>` tray allowing
 * users to apply damage directly to targeted tokens. When DnD5e's setting
 * "Allow Players to Apply Damage" (`dnd5e.allowPlayerDamageTray`) is enabled,
 * player characters can apply damage themselves.
 *
 * - For GMs, having every incoming monster attack damage tray expanded creates
 *   unnecessary chat clutter when the player will be applying the damage themselves.
 * - For Players, damage rolls targeting NPCs (or other players' tokens) render an
 *   expanded damage tray with multiplier buttons and an "Apply" button that does
 *   literally nothing, as DnD5e strictly restricts damage application to tokens
 *   owned by the active user. Auto-collapsing these trays cleans up the player's
 *   chat log and prevents confusion.
 */

/**
 * Check whether a message's damage application tray should be auto-collapsed for the current user.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} [html]
 * @returns {boolean}
 */
export function shouldCollapseDamageTray(message, html) {
    // Must have DnD5e's allowPlayerDamageTray enabled
    const allowPlayerDamage = Boolean(game.settings.get("dnd5e", "allowPlayerDamageTray"));
    if (!allowPlayerDamage) return false;

    const el = html instanceof HTMLElement ? html : html?.[0] instanceof HTMLElement ? html[0] : null;

    // Check if the message is a damage roll or contains a damage application tray
    const isDamageRoll = message.type === "damage"
        || message.flags?.dnd5e?.roll?.type === "damage"
        || Boolean(el?.querySelector?.("damage-application"));
    if (!isDamageRoll) return false;

    // Case 1: GM view
    if (game.user?.isGM) {
        if (!game.settings.get(MODULE_ID, "enableAutoCollapseHostileDamageTrays")) return false;

        // Determine the source actor and token
        const sourceActor = message.getAssociatedActor?.()
            ?? (message.speaker?.actor ? game.actors.get(message.speaker.actor) : null)
            ?? message.speakerActor;

        const sourceToken = message.getAssociatedToken?.()
            ?? (message.speaker?.token ? canvas.tokens?.get(message.speaker.token) : null);

        if (!sourceActor) return false;

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

        if (!isHostile) return false;

        // Gather targets
        const targetActors = _resolveDamageTargets(message, el);
        if (!targetActors.length) return false;

        // Check if targets include player characters
        const hasPlayerCharacterTarget = targetActors.some(actor =>
            actor?.type === "character" || actor?.hasPlayerOwner
        );

        return hasPlayerCharacterTarget;
    }

    // Case 2: Player view
    if (!game.user?.isGM) {
        if (!game.settings.get(MODULE_ID, "enableAutoCollapsePlayerDamageTrays")) return false;

        // Gather targets
        const targetActors = _resolveDamageTargets(message, el);
        if (!targetActors.length) return false;

        // If the player owns ANY of the targeted actors, keep the tray expanded so they can apply damage / healing
        const ownsAnyTarget = targetActors.some(actor => actor?.isOwner);
        if (ownsAnyTarget) return false;

        // The player does not own any of the targets (e.g. rolls targeting NPCs or other players' characters).
        // Since DnD5e prevents non-GM players from applying damage to unowned tokens, collapse the tray.
        return true;
    }

    return false;
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
        const attackRolls = message.getAssociatedRolls("attack");
        const lastAttack = attackRolls?.pop?.();
        const attackTargets = lastAttack?.system?.targets;
        if (Array.isArray(attackTargets) && attackTargets.length > 0) {
            for (const target of attackTargets) {
                const actor = _resolveTargetDescriptor(target);
                if (actor) actors.add(actor);
            }
        }
    }

    // 3. Targets recorded in the DOM (<recorded-targets> pills/options)
    if (!actors.size && el) {
        const targetElements = el.querySelectorAll(
            "damage-application recorded-targets option, damage-application recorded-targets target-pill"
        );
        for (const item of targetElements) {
            const val = item.value ?? item.dataset?.uuid ?? item.getAttribute("value");
            if (val) {
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
 * @param {object} descriptor
 * @returns {Actor5e|null}
 */
function _resolveTargetDescriptor(descriptor) {
    if (!descriptor) return null;
    try {
        if (dnd5e?.dataModels?.chatMessage?.fields?.TargetsField?.resolve) {
            const resolved = dnd5e.dataModels.chatMessage.fields.TargetsField.resolve(descriptor);
            if (resolved?.actor) return resolved.actor;
            if (resolved?.token?.actor) return resolved.token.actor;
            if (resolved?.token?.document?.actor) return resolved.token.document.actor;
        }
    } catch (_) {}

    if (descriptor.actor) {
        try {
            const doc = fromUuidSync(descriptor.actor, { strict: false });
            if (doc instanceof Actor) return doc;
            if (doc?.actor) return doc.actor;
        } catch (_) {}
    }

    if (descriptor.token) {
        try {
            const tokenDoc = fromUuidSync(descriptor.token, { strict: false });
            if (tokenDoc instanceof Actor) return tokenDoc;
            if (tokenDoc?.actor) return tokenDoc.actor;
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

    // If the user has explicitly opened the tray on this card, preserve their explicit choice
    if (message._trayStates?.get("DAMAGE-APPLICATION") === true || message._trayStates?.get("damage-application") === true) {
        return;
    }

    const trays = el.querySelectorAll("damage-application");
    if (!trays.length) return;

    message._trayStates ??= new Map();
    message._trayStates.set("DAMAGE-APPLICATION", false);
    message._trayStates.set("damage-application", false);

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
    const ChatMessage5e = CONFIG.ChatMessage?.documentClass;
    if (ChatMessage5e?.prototype?._collapseTrays) {
        const originalCollapseTrays = ChatMessage5e.prototype._collapseTrays;
        ChatMessage5e.prototype._collapseTrays = function(html) {
            originalCollapseTrays.call(this, html);
            if (shouldCollapseDamageTray(this, html)) {
                _collapseTrayElement(this, html);
            }
        };
    }

    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        if (shouldCollapseDamageTray(message, html)) {
            _collapseTrayElement(message, html);
        }
    });

    Hooks.on("renderChatMessageHTML", (message, html) => {
        if (shouldCollapseDamageTray(message, html)) {
            _collapseTrayElement(message, html);
        }
    });

    debug("Auto-Collapse Damage Trays | Initialized");
}

