/**
 * Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, Great Weapon Master, Brutal Strike, Charger, Savage Attacker, Cleave, Boon of Irresistible Offense & Genie's Wrath)
 *
 * Offers toggles in damage roll configuration dialogs when an actor is actively
 * concentrating on Hex or Hunter's Mark, attacks with a ranged or finesse weapon (Sneak Attack),
 * attacks with a Heavy weapon under 2024 rules with Great Weapon Master (+PB bonus flavored with GWM),
 * attacks with Brutal Strike (@scale.brutal-strike.damage or @scale.barbarian.brutal-strike bonus matching weapon damage type, once per turn),
 * attacks after moving 10+ ft with Charger (+1d8 bonus, once per turn),
 * attacks with Savage Attacker (rolling weapon damage dice twice and keeping higher, once per turn),
 * attacks with a Cleave mastery weapon (damage malus removing ability score modifier unless negative),
 * scores a natural 20 attack roll with Boon of Irresistible Offense (+Ability Score bonus),
 * or hits with an attack roll on their turn with Genie's Wrath (+PB of the patron's damage type, once per turn).
 * Remembers choices per actor (except one-offs and once-per-turn bonuses).
 * A bonus is hidden only when the actor lacks it or the roll is the wrong kind for it (wrong weapon, spell school,
 * damage type; an active spell like Hex that isn't running). When its situational conditions fail (turn, uses,
 * rage, form, target, movement, natural 20) it is offered unticked, with the reasons as the toggle's tooltip.
 * Sneak Attack starts on only when the attack qualifies: Advantage, an ally who isn't Incapacitated within
 * 5 ft of the target (without Disadvantage), or Rakish Audacity.
 *
 * @updated v14.75.0 (Sneak Attack detects Advantage, Disadvantage, allies next to the target and Rakish Audacity)
 * @updated v14.76.0 (Genie's Wrath: +PB on your turn, once per turn, with a remembered damage type dropdown)
 * @updated v14.85.0 (PHB class feature, species and spell bonuses: Colossus Slayer, Divine Strike, Primal Strike, Divine Fury,
 *   Frenzy, Dreadful Strikes, Dread Ambusher, Elemental Epitome, Fire's Burn, Frost's Chill, Celestial Revelation, Lunar Form,
 *   Psionic Strike, Hand of Harm, Eldritch Smite, Lifedrinker, Empowered Evocation, Radiant Soul; Assassinate; Foe Slayer)
 * @updated v14.88.0 (Bonuses from other official books: Pull of Death, Polar Strikes, Power from Pain, Ominous Strikes,
 *   Arcane Jolt, Lightning Launcher, Guided Precision, Arcane Firearm, Alchemical Savant, Arcane Conduit, Power from
 *   Beyond, Power Surge, Dreaded Necrosis, Perfect Poisoner; healing rolls and feature damage rolls are considered)
 * @updated v14.104.0 (World of Warcraft: Fury of the Small, Touch of the Grave, Death and Decay, Touch of the Void,
 *   Havoc, Rain of Fire, Combo Strikes with a per-target melee hit counter)
 * @updated v14.111.0 (a companion sharing its summoner's turn counts as attacking on its own turn)
 * @updated v14.113.0 (no Brutal Strike toggle while Brutal Strike automation adds that damage itself)
 * @updated v14.114.1 (replacing the Entropic Embrace marker tolerates it being removed meanwhile)
 * @updated v14.119.0 (Combo Strikes counts melee attacks whose damage was rolled, no AC check)
 * @updated v14.120.0 (split into modules, no change in behavior)
 * @updated v14.120.2 (attack lookup through the shared attack-lookup helper)
 * @updated v14.121.0 (bonuses whose situational conditions fail are offered unticked with the reasons as tooltip,
 *   instead of being hidden: off-turn, already used this turn, no uses left, not raging / Reckless / transformed, no
 *   natural 20, Charger movement, target conditions; Divine Fury needs a weapon or Unarmed Strike)
 */
import { log, debug } from "../../../context.js";
import { lastAttackRollsByActor, meleeHits, pruneStaleAttackRolls, recordAttackRoll, recordMeleeHit } from "./attack-cache.js";
import { clearCombatTurnUsage } from "./combat-turn.js";
import { patchDamageRollConfigurationDialog } from "./dialog.js";
import { applyPerfectPoisoner, onEntropicEmbraceCast, onPreRollDamage } from "./roll-hooks.js";

// Used by other features
export { isModernRules, getBrutalStrikeFormula } from "./core-bonuses.js";
export { getActiveCombat, getCombatTurnKey, hasUsedBonusThisTurn, markBonusUsedThisTurn } from "./combat-turn.js";

/*
 * Modules:
 *  - core-bonuses.js     eligibility and formulas of Sneak Attack, Genie's Wrath, GWM, Brutal Strike, Charger,
 *                        Savage Attacker, Boon of Irresistible Offense, Cleave
 *  - combat-turn.js      combat, turn and movement checks, once-per-turn usage
 *  - attack-cache.js     remembered attack rolls (natural 20, targets, Combo Strikes melee hits)
 *  - preferences.js      remembered toggle choices and damage types per actor
 *  - feature-helpers.js  helpers for the class feature, species and spell bonuses
 *  - feature-bonuses.js  class feature, feat and species bonuses (all books)
 *  - spell-bonuses.js    spell damage and healing bonuses (all books)
 *  - collect.js          which bonuses apply to a roll (Hex, Hunter's Mark and the rest), their roll configs
 *  - roll-hooks.js       the damage roll hooks, Perfect Poisoner, Entropic Embrace
 *  - dialog.js           toggles, dropdowns and tooltips in the damage roll dialog
 */

let _isInitialized = false;

/**
 * Initialize the Conditional Damage Bonuses feature.
 */
export function initConditionalDamage() {
    if (_isInitialized) return;
    _isInitialized = true;

    // Listen to preRollDamage to identify active concentration effects and sneak attack eligibility
    Hooks.on("dnd5e.preRollDamage", onPreRollDamage);

    // Track evaluated attack rolls for correlating d20 results with damage rolls (e.g. for Boon of Irresistible Offense)
    Hooks.on("dnd5e.rollAttack", (rolls, { subject } = {}) => {
        const roll = rolls?.[0];
        if (!roll) return;
        const actor = subject?.actor ?? roll.data?.actor;
        if (!actor) return;
        recordAttackRoll(actor, roll, {
            activityId: subject?.id,
            itemId: subject?.item?.id,
            targets: Array.from(game.user?.targets ?? [], t => t.document?.uuid)
        });
    });

    Hooks.on("createChatMessage", (message) => {
        const rollType = message.getFlag?.("dnd5e", "roll.type") ?? message.flags?.dnd5e?.roll?.type;
        const isAttack = rollType === "attack"
            || message.type === "attack"
            || message.system?.constructor?.name === "AttackMessageData";
        if (isAttack && message.rolls?.length) {
            const actor = (typeof message.getAssociatedActor === "function" ? message.getAssociatedActor() : null)
                ?? (message.speaker?.actor ? game.actors?.get(message.speaker.actor) : null)
                ?? (message.speaker ? ChatMessage.getSpeakerActor?.(message.speaker) : null);
            if (actor) {
                const actorKey = actor.uuid || actor.id;
                const existing = lastAttackRollsByActor.get(actorKey);
                const activityId = message.getAssociatedActivity?.()?.id
                    ?? message.getFlag?.("dnd5e", "activity.id")
                    ?? existing?.activityId;
                const itemId = message.getAssociatedItem?.()?.id
                    ?? message.getFlag?.("dnd5e", "item.id")
                    ?? existing?.itemId;
                const targets = (message.system?.targets ?? []).map(t => t?.token).filter(Boolean);
                recordAttackRoll(actor, message.rolls[0], {
                    activityId,
                    itemId,
                    messageId: message.id,
                    targets: targets.length ? targets : existing?.targets
                });
            }
        }
    });

    // Mark cached attack rolls as having rolled damage when a damage roll is executed
    // Entropic Embrace: mark the caster for the spell's minute, so Touch of the Void can be offered
    Hooks.on("dnd5e.postUseActivity", onEntropicEmbraceCast);

    // Perfect Poisoner: maximize the poison dice of the final rolls (the type picked in the dialog counts)
    Hooks.on("dnd5e.postDamageRollConfiguration", applyPerfectPoisoner);

    Hooks.on("dnd5e.rollDamage", (rolls, { subject } = {}) => {
        const actor = subject?.actor
            ?? rolls?.[0]?.data?.actor
            ?? (rolls?.[0]?.options?.actor ? game.actors?.get(rolls[0].options.actor) : null)
            ?? (typeof rolls?.[0]?.parent?.getAssociatedActor === "function" ? rolls[0].parent.getAssociatedActor() : null);
        if (!actor) return;
        // Count the melee hit before the cached attack is marked as used
        try {
            recordMeleeHit(actor, subject, rolls);
        } catch (err) {
            debug("Conditional Damage | Could not count the melee hit", err);
        }
        const actorKey = actor.uuid || actor.id;
        const cached = lastAttackRollsByActor.get(actorKey);
        if (cached) cached.damageRolled = true;
    });

    // Clean up combat turn usage tracking and combat attack cache when a combat encounter is removed
    Hooks.on("deleteCombat", (combat) => {
        clearCombatTurnUsage(combat?.id);
        if (combat?.id) {
            for (const [key, entry] of meleeHits.entries()) {
                if (entry.turnKey?.startsWith(`${combat.id}-`)) meleeHits.delete(key);
            }
        }
        if (combat?.id) {
            for (const [key, entry] of lastAttackRollsByActor.entries()) {
                if (entry.combatId === combat.id) {
                    lastAttackRollsByActor.delete(key);
                }
            }
        }
    });

    // Periodically prune stale attacks as combat turns or rounds progress
    Hooks.on("combatTurn", () => pruneStaleAttackRolls());
    Hooks.on("combatRound", () => pruneStaleAttackRolls());

    // Patch DamageRollConfigurationDialog once configuration class is available
    if (CONFIG.Dice?.DamageRoll?.DefaultConfigurationDialog) {
        patchDamageRollConfigurationDialog();
    } else {
        Hooks.once("ready", () => {
            patchDamageRollConfigurationDialog();
        });
    }

    log("Initialized Conditional Damage Bonuses");
}
