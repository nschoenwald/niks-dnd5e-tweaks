/**
 * Area Spell Automation: Using the save or damage activity against the triggered creatures; the delegated damage roll.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, getSetting, debug, isFeatureActive } from "../../../context.js";
import { isMidiActive } from "../../../utils/module-compat.js";
import { activityHasDamageDice } from "../auto-roll-attack-damage.js";
import { getBehaviorActivity, getConcentrationEffect } from "./activity.js";
import { pendingDamageTargets } from "./state.js";

/**
 * Use the emanation's damage activity against the given tokens without consuming resources,
 * starting concentration or placing a template.
 * @param {RegionBehavior} behavior
 * @param {TokenDocument[]} tokens
 */
export async function executeAreaSpell(behavior, tokens) {
    const activity = getBehaviorActivity(behavior);
    if (!activity?.item) {
        ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.ActivityMissing"));
        return;
    }
    if (!activity.item.isOwner) {
        ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.NoPermission"));
        return;
    }
    tokens = tokens.filter(t => t?.parent && t.actor);
    if (!tokens.length) return;

    // Limited uses (Cordon of Arrows): one per affected creature; the area ends when they run out
    const charges = behavior.system.charges;
    const limited = Number.isInteger(charges);
    if (limited) {
        if (charges <= 0) return;
        tokens = tokens.slice(0, charges);
    }

    const scaling = _getBehaviorScaling(behavior, activity);
    const slot = _findSpellSlotKey(activity.actor, activity.item.system.level + scaling);
    const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
    const usage = {
        consume: false,
        scaling,
        concentration: { begin: false },
        create: { measuredTemplate: false },
        nd5tDamageEmanation: true
    };
    if (slot) usage.spell = { slot };

    // The caster's player rolls the damage, not the GM who triggered the emanation: this client skips its own damage
    // roll (dnd5e's for damage activities, Auto-Open Damage Dialog for Saves for save activities) and asks them.
    const damageRoller = _getDamageRoller(activity);
    if (damageRoller) {
        usage.subsequentActions = false;
        usage.nd5tEmanationDamageDelegated = true;
    }

    debug(`Area Spells | Using ${activity.item.name} (${activity.name}) at +${scaling} against`, tokens.map(t => t.name));

    // Link the card to the caster's concentration, so effects applied from it (e.g. Deafened)
    // end together with the spell.
    const messageSystem = { targets: TargetsField.getDescriptors(tokens) };
    const concentration = getConcentrationEffect(activity.actor, activity.item);
    if (concentration) messageSystem.concentration = concentration.id;

    const restoreTargets = isMidiActive() ? _setUserTargets(tokens) : null;
    // A damage activity rolls its damage straight after the use; give that roll the same targets.
    if ((activity.type === "damage") && !damageRoller) pendingDamageTargets.set(activity.uuid, messageSystem.targets);
    try {
        // Always public: the targets' players roll their saves from this card, and the caster's player rolls the
        // damage from it. dnd5e would otherwise use the triggering user's chat mode (often private for a GM).
        const results = await activity.use(usage, { configure: false }, {
            rollMode: "public",
            data: {
                system: messageSystem,
                flags: { [MODULE_ID]: { damageEmanation: behavior.uuid } }
            }
        });
        if (damageRoller && results?.message?.id && activity.damage?.parts?.length) {
            game.socket.emit(`module.${MODULE_ID}`, {
                action: "damageEmanationRollDamage",
                userId: damageRoller.id,
                messageId: results.message.id,
                targets: messageSystem.targets,
                kind: activity.type
            });
            debug(`Area Spells | Asked ${damageRoller.name} to roll the damage of ${activity.item.name}`);
        }
    } finally {
        pendingDamageTargets.delete(activity.uuid);
        restoreTargets?.();
    }
    if (limited) await _spendCharges(behavior, activity, tokens.length);
}

/**
 * Spend uses of a limited emanation (Cordon of Arrows) and remove its area when none are left.
 * Behaviors can only be changed by a GM; without one, the count isn't tracked.
 * @param {RegionBehavior} behavior
 * @param {Activity} activity
 * @param {number} count
 */
async function _spendCharges(behavior, activity, count) {
    const left = Math.max(0, Number(behavior.system.charges) - count);
    if (!behavior.isOwner) {
        debug(`Area Spells | Can't track the uses of ${activity.item.name}: no permission to change the behavior`);
        return;
    }
    try {
        if (left > 0) {
            await behavior.update({ "system.charges": left });
            debug(`Area Spells | ${activity.item.name}: ${left} use(s) left`);
            return;
        }
        const region = behavior.region;
        const spell = activity.item.name;
        ui.notifications?.info(game.i18n.has("ND5T.DamageEmanation.ChargesSpent")
            ? game.i18n.format("ND5T.DamageEmanation.ChargesSpent", { spell })
            : `${spell}: all uses are spent, the area is removed.`);
        if (region?.isOwner) await region.delete();
        else await behavior.update({ "system.charges": 0 });
    } catch (err) {
        debug("Area Spells | Could not update the remaining uses", err);
    }
}

/**
 * The player who rolls an emanation's damage when another user (usually the GM) triggers it: an active player who
 * owns the caster, preferring the one whose character it is. Null when this client is that player, when no such
 * player is online (this client rolls, as before), or with midi-qol (its workflow rolls the damage).
 * @param {Activity} activity
 * @returns {User|null}
 */
function _getDamageRoller(activity) {
    const actor = activity?.actor;
    if (!actor || isMidiActive()) return null;
    const owners = game.users?.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER")) ?? [];
    const roller = owners.find(u => u.character?.id === actor.id) ?? owners[0] ?? null;
    return (roller && (roller.id !== game.user.id)) ? roller : null;
}

/**
 * Socket request on the caster's player's client: roll the damage of an emanation card, like clicking its Damage
 * button. Save activities follow the player's Auto-Open Damage Dialog for Saves setting (without it, the card's
 * button is there); damage activities always roll, as dnd5e does after using one.
 * @param {{messageId: string, targets: object[], kind: string}} data
 */
export async function rollDelegatedDamage({ messageId, targets, kind }, sender) {
    // The card may arrive a moment after the request
    let message = game.messages.get(messageId);
    for (let i = 0; !message && (i < 20); i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        message = game.messages.get(messageId);
    }
    // Only for an emanation card that the requesting user posted (the client that triggered the emanation)
    if (!message?.getFlag(MODULE_ID, "damageEmanation") || (message.author?.id !== sender.id)) {
        debug(`Area Spells | Ignoring a damage request from ${sender.name}: not their emanation card`);
        return;
    }
    const activity = message?.getAssociatedActivity?.({ scaled: true });
    if (!activity?.rollDamage) {
        debug(`Area Spells | Can't roll the delegated damage: card ${messageId} or its activity not found`);
        return;
    }
    if ((kind === "save") && !isFeatureActive("enableAutoRollSaveDamage", "clientEnableAutoRollSaveDamage")) return;
    const configure = !getSetting("autoRollStaticDamage") || activityHasDamageDice(activity);
    await activity.rollDamage({}, { configure }, { data: { system: { origin: messageId, targets } } });
}

/**
 * Levels above base at which the spell was cast.
 * @param {RegionBehavior} behavior
 * @param {Activity} activity
 * @returns {number}
 */
function _getBehaviorScaling(behavior, activity) {
    if (Number.isFinite(behavior.system.scaling)) return behavior.system.scaling;
    const concentrationScaling = Number(getConcentrationEffect(activity.actor, activity.item)?.getFlag("dnd5e", "scaling"));
    if (Number.isFinite(concentrationScaling)) return Math.max(0, concentrationScaling);
    const spellLevel = Number(behavior.region?.getFlag("dnd5e", "spellLevel"));
    return Number.isFinite(spellLevel) ? Math.max(0, spellLevel - activity.item.system.level) : 0;
}

/**
 * Spell slot key of the given level, so dnd5e scales the activity to the cast level.
 * @param {Actor5e} actor
 * @param {number} level
 * @returns {string|null}
 */
function _findSpellSlotKey(actor, level) {
    if (!(level > 0)) return null;
    const spells = actor?.system.spells ?? {};
    if (spells[`spell${level}`]) return `spell${level}`;
    return Object.entries(spells).find(([, data]) => data?.level === level)?.[0] ?? null;
}

/**
 * Temporarily target the given tokens (midi-qol reads the user's targets instead of the message's).
 * @param {TokenDocument[]} tokens
 * @returns {Function} Restores the previous targets.
 */
function _setUserTargets(tokens) {
    const previous = Array.from(game.user.targets).map(t => t.id);
    canvas.tokens?.setTargets(tokens.map(t => t.id), { mode: "replace" });
    return () => canvas.tokens?.setTargets(previous, { mode: "replace" });
}
