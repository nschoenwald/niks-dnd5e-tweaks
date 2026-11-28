/**
 * Conditional Damage Bonuses: The damage roll hooks: adding the bonus rolls, Perfect Poisoner, Entropic Embrace.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, isFeatureActive, debug } from "../../../context.js";
import { deleteEffects } from "../../../utils/effect-deletion.js";
import { lastAttackRollsByActor } from "./attack-cache.js";
import { createConditionalRollConfig, getActiveConditionalBonuses } from "./collect.js";
import { markBonusUsedThisTurn } from "./combat-turn.js";
import { applySavageAttackerToParts } from "./core-bonuses.js";
import { consumeBonusResource, identifierOf, matchesWeaponType } from "./feature-helpers.js";
import { getActorConditionalPreference } from "./preferences.js";

/**
 * Hook handler for `dnd5e.preRollDamage`.
 * Inspects actor concentration effects and prepares eligible conditional damage rolls.
 *
 * @param {DamageRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration} dialog
 * @param {BasicRollMessageConfiguration} message
 */
export function onPreRollDamage(config, dialog = {}, message = {}) {
    if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;

    // Must be a damage roll hook
    if (config.hookNames && !config.hookNames.includes("damage")) return;

    // Initiative rolls or rolls with non-damage subjects must never receive conditional damage bonuses
    if (config.rolls?.some(r => r.options?.type === "initiative" || r.data?.roll?.type === "initiative")) return;

    // Temporary hit points never get bonuses. Healing rolls only get the spell bonuses that also add to healing
    // (Alchemical Savant, Power from Beyond); getActiveConditionalBonuses handles that.
    if (config.rolls?.some(r => r.options?.type === "temphp")) return;
    const rollType = config.subject?.type ?? message?.type ?? message?.system?.type ?? message?.data?.type;
    const isHealing = (rollType === "heal") || (rollType === "healing")
        || Boolean(config.rolls?.some(r => r.options?.type === "healing"));

    // Damage rolls are associated with activities/items, not an Actor directly (e.g. rollInitiative passes subject: this [Actor])
    if (config.subject instanceof Actor) return;

    // Most bonuses require hitting with an attack. Other activities (a saving throw spell like Fireball, a damage
    // activity like Magic Missile, a feature's damage) only get the spell bonuses and Perfect Poisoner; see
    // getActiveConditionalBonuses.

    // Resolve the rolling actor
    const actor = config.subject?.actor
        ?? dialog?.options?.actor
        ?? (config.subject?.item?.actor)
        ?? (config.rolls?.[0]?.data?.actor)
        ?? (typeof message?.getAssociatedActor === "function" ? message.getAssociatedActor() : null)
        ?? (message?.speaker ? ChatMessage.getSpeakerActor?.(message.speaker) : null)
        ?? (message?.data?.speaker ? ChatMessage.getSpeakerActor?.(message.data.speaker) : null)
        ?? (canvas?.tokens?.controlled?.[0]?.actor)
        ?? null;
    if (!actor) return;

    // Resolve the item being rolled
    const item = config.subject?.item
        ?? (config.rolls?.[0]?.data?.item instanceof Item ? config.rolls[0].data.item : null)
        ?? (actor.items?.get(config.rolls?.[0]?.data?.item?.id ?? config.rolls?.[0]?.data?.item?._id))
        ?? null;

    // Detect active conditional bonuses (Hex, Hunter's Mark, Sneak Attack, GWM, etc.)
    const activeDefs = getActiveConditionalBonuses(actor, { item, activity: config.subject, config, dialog, message, isHealing });
    if (!activeDefs.length) return;

    // Prepare bonus metadata on the process configuration
    config._nd5tConditionalBonuses = activeDefs.map(def => {
        const isOneOffOrTurnTracked = def.id === "cleave"
            || def.id === "brutalStrike"
            || def.id === "charger"
            || def.id === "boonOfIrresistibleOffense"
            || def.id === "savageAttacker"
            || def.id === "geniesWrath"
            || Boolean(def.oneOff)
            || (def.id === "sneakAttack" && (def.turnKey || def.eligibility?.state !== "unknown"));
        const lastChoice = isOneOffOrTurnTracked
            ? def.defaultActive
            : getActorConditionalPreference(actor, def.id, def.defaultActive);
        return {
            ...def,
            actor,
            active: lastChoice
        };
    });

    const baseRoll = config.rolls?.[0];
    const baseRollData = baseRoll?.data ?? actor.getRollData?.() ?? {};
    const baseProperties = baseRoll?.options?.properties ?? [];
    const isCritical = Boolean(config.isCritical);

    const isFastForward = dialog.configure === false || Boolean(config.event?.shiftKey) || Boolean(config.options?.fastForward);

    if (baseRoll) {
        baseRoll._nd5tOriginalParts = [...(baseRoll.parts ?? [])];
        baseRoll._nd5tOriginalMod = baseRoll.data?.mod;

        const savageBonus = config._nd5tConditionalBonuses.find(b => b.id === "savageAttacker" && b.active);
        if (savageBonus) {
            baseRoll.parts = applySavageAttackerToParts(baseRoll._nd5tOriginalParts);
            baseRoll.options ??= {};
            baseRoll.options._nd5tSavageAttacker = true;
        }
    }

    if (isFastForward) {
        for (const bonus of config._nd5tConditionalBonuses) {
            if (bonus.active && bonus.turnKey) {
                markBonusUsedThisTurn(actor, bonus.usageId ?? bonus.id, bonus.turnKey);
            }
            if (bonus.active && bonus.consume) consumeBonusResource(bonus);
        }
        if (actor) {
            const actorKey = actor.uuid || actor.id;
            const cached = lastAttackRollsByActor.get(actorKey);
            if (cached) cached.damageRolled = true;
        }
    }

    // For any bonus that is currently active, add the roll configuration upfront.
    // This ensures fast-forward rolls (holding Shift / dialog.configure === false)
    // honor the actor's last chosen state, critical mode, and weapon properties.
    config.rolls ??= [];
    for (const bonus of config._nd5tConditionalBonuses) {
        if (!bonus.active || bonus.isMalus || bonus.isWeaponModifier) continue;

        const alreadyPresent = config.rolls.some(r => r.options?._nd5tConditionalId === bonus.id);
        if (!alreadyPresent) {
            const properties = matchesWeaponType(bonus) ? baseProperties : [];
            config.rolls.push(createConditionalRollConfig(bonus, baseRollData, { isCritical, properties }));
        }
    }
}

/**
 * Ensure all eligible conditional rolls are present in the dialog configuration upfront.
 * Inactive rolls are flagged with `options._nd5tInactive = true` so they can be rendered in the dialog
 * in a disabled/greyed-out state without causing layout shifts when toggled.
 *
 * @param {DamageRollProcessConfiguration} config
 */
export function ensureAllConditionalRollsInConfig(config) {
    if (!config || (config.hookNames && !config.hookNames.includes("damage"))) return;
    const bonuses = config._nd5tConditionalBonuses;
    if (!bonuses?.length) return;

    config.rolls ??= [];
    const baseIndex = config.rolls.findIndex(r => !r.options?._nd5tConditionalId && !r.options?._nd5tTypedBonus);
    const baseRoll = baseIndex >= 0 ? config.rolls[baseIndex] : config.rolls[0];
    const baseRollData = baseRoll?.data ?? {};
    const baseProperties = baseRoll?.options?.properties ?? [];
    const isCritical = Boolean(config.isCritical);

    for (const bonus of bonuses) {
        if (bonus.isMalus || bonus.isWeaponModifier) continue;

        let rollConfig = config.rolls.find(r => r.options?._nd5tConditionalId === bonus.id);
        if (!rollConfig) {
            const properties = matchesWeaponType(bonus) ? baseProperties : [];
            rollConfig = createConditionalRollConfig(bonus, baseRollData, { isCritical, properties });
            if (!bonus.active) {
                rollConfig.options._nd5tInactive = true;
            }
            config.rolls.push(rollConfig);
        } else {
            if (!bonus.active) {
                rollConfig.options ??= {};
                rollConfig.options._nd5tInactive = true;
            } else if (rollConfig.options?._nd5tInactive) {
                delete rollConfig.options._nd5tInactive;
            }
        }
    }
}

/**
 * dnd5e.postDamageRollConfiguration: when Perfect Poisoner is ticked, every die of the poison rolls rolls its
 * highest number (`min<faces>`), critical dice included.
 * @param {DamageRoll[]} rolls
 * @param {object} config
 */
export function applyPerfectPoisoner(rolls, config) {
    try {
        const bonus = config?._nd5tConditionalBonuses?.find(b => b.id === "perfectPoisoner");
        if (!bonus?.active) return;
        for (const roll of rolls ?? []) {
            if ((roll.options?.type !== "poison") || roll.options?._nd5tInactive) continue;
            let changed = false;
            for (const term of roll.terms ?? []) {
                if (!(term instanceof foundry.dice.terms.Die) || !(term.faces > 1)) continue;
                term.modifiers = [...(term.modifiers ?? []), `min${term.faces}`];
                changed = true;
            }
            if (changed) {
                roll.resetFormula?.();
                roll.options.nd5tPerfectPoisoner = true;
            }
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Conditional Damage: Perfect Poisoner failed`, err);
    }
}

/**
 * When Entropic Embrace (World of Warcraft, no effect of its own) is cast, give the caster a 1-minute marker effect
 * that records the cast level. Touch of the Void is offered while it lasts.
 * @param {Activity} activity
 */
export async function onEntropicEmbraceCast(activity) {
    try {
        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
        const item = activity?.item;
        if ((identifierOf(item) !== "entropic-embrace") || (activity.type !== "utility") || !activity.actor?.isOwner) return;
        const actor = activity.actor;
        const level = Number(item.system?.level ?? 1) + Number(item.getFlag?.("dnd5e", "scaling") ?? 0);
        const old = actor.effects.filter(e => e.getFlag?.(MODULE_ID, "entropicEmbrace")).map(e => e.id);
        if (old.length) await deleteEffects(actor, old);
        await actor.createEmbeddedDocuments("ActiveEffect", [{
            name: item.name,
            img: item.img,
            origin: item.uuid,
            transfer: false,
            duration: { value: 60, units: "seconds" },
            flags: { [MODULE_ID]: { entropicEmbrace: { level } } }
        }]);
    } catch (err) {
        debug("Conditional Damage | Could not mark Entropic Embrace", err);
    }
}
