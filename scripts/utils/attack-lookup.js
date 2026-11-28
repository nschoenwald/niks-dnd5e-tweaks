/**
 * Finding the usage card and the attack behind a roll, the way D&D 5e 6.x links them.
 *
 * An activity's use posts a usage card. Every roll made from it (attack, damage, save) stores that card as its
 * `system.origin`, and dnd5e keeps an index of those rolls per card (`ChatMessage5e#getAssociatedRolls`). dnd5e's
 * own Damage button finds the attack with `usageCard.getAssociatedRolls("attack").pop()`. The old flags
 * (`flags.dnd5e.originatingMessage`, `roll.type`, …) were migrated away in dnd5e 6.0 and aren't read here.
 *
 * @introduced v14.120.2
 */

/**
 * Whether a chat message is an attack roll.
 * @param {ChatMessage|null} message
 * @returns {boolean}
 */
export function isAttackMessage(message) {
    return message?.type === "attack";
}

/**
 * A chat message from a message, its id, or null.
 * @param {ChatMessage|string|null|undefined} value
 * @returns {ChatMessage|null}
 */
function _toMessage(value) {
    if (!value) return null;
    if (typeof value === "string") return game.messages?.get(value) ?? null;
    return (value instanceof ChatMessage) ? value : null;
}

/**
 * The usage card a roll message was made from (`system.origin`), or null when it has none. Unlike dnd5e's
 * `getOriginatingMessage()`, this never returns the message itself.
 * @param {ChatMessage|null} message
 * @returns {ChatMessage|null}
 */
export function getUsageCard(message) {
    if (!message) return null;
    const origin = message.getOriginatingMessage?.() ?? null;
    return (origin && (origin !== message)) ? origin : null;
}

/**
 * The newest attack roll made from a card, ignoring `exclude`.
 * @param {ChatMessage|null} card
 * @param {ChatMessage|null} [exclude]
 * @returns {ChatMessage|null}
 */
function _latestAttackOf(card, exclude = null) {
    const attacks = card?.getAssociatedRolls?.("attack") ?? [];
    for (let i = attacks.length - 1; i >= 0; i--) {
        if (attacks[i] !== exclude) return attacks[i];
    }
    return null;
}

/**
 * The attack roll that belongs to a chat message:
 *  - an attack message is its own attack;
 *  - otherwise the newest attack made from the same usage card (a damage card, or the usage card itself);
 *  - a damage card whose origin is the attack card itself (auto-rolled damage before 14.120.2) gets that attack.
 * @param {ChatMessage|string|null} messageOrId
 * @returns {ChatMessage|null}
 */
export function getAttackForMessage(messageOrId) {
    const message = _toMessage(messageOrId);
    if (!message) return null;
    if (isAttackMessage(message)) return message;
    const card = getUsageCard(message);
    if (isAttackMessage(card)) return card;
    return _latestAttackOf(card ?? message, message);
}

/**
 * The card a damage roll is being made from, before its own chat card exists (`dnd5e.preRollDamage`, the damage
 * dialog): the origin set on the message data (rolls started by code, e.g. Auto-Roll Attack Damage), otherwise the
 * chat card whose button was clicked (dnd5e reads the same element when it posts the roll).
 * @param {object} [config]   Damage roll process configuration.
 * @param {object} [dialog]   Damage roll dialog configuration.
 * @param {object} [message]  Damage roll message configuration.
 * @returns {ChatMessage|null}
 */
export function getOriginForDamageRoll(config, dialog, message) {
    return _toMessage(message?.data?.system?.origin)
        ?? _toMessage(config?.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId)
        ?? _toMessage(dialog?.options?.originatingMessage);
}

/**
 * The d20 roll of an attack message.
 * @param {ChatMessage|null} attackMessage
 * @returns {Roll|null}
 */
export function getAttackD20(attackMessage) {
    return attackMessage?.rolls?.find(r => (r.dice ?? []).some(d => d.faces === 20)) ?? null;
}
