/**
 * Conditional Damage Bonuses: Class feature, feat and species bonuses to attacks and other damage rolls (PHB 2024, other official books, World of Warcraft).
 * Part of the feature in `./index.js` (history and overview there).
 */
import { isActorReckless } from "../reckless-attack.js";
import { previousMeleeHits } from "./attack-cache.js";
import { hasUsedBonusThisTurn } from "./combat-turn.js";
import { isEligibleBrutalStrikeAttack } from "./core-bonuses.js";
import { MARTIAL_ARTS_DIE, PSIONIC_ENERGY_DIE, RAGE_DAMAGE, activeFeatureEffects, classLevels, diceWithMod, effectsFrom, facesByLevel, findFeature, firstDieFacesOfType, identifierOf, isActorRaging, isBloodied, isPactWeapon, isUnarmedStrike, originalActor, resolveTargetDocs, resource, scaleDieFaces, usesText } from "./feature-helpers.js";
import { getActorBonusType, getActorConditionalPreference } from "./preferences.js";

/** Damage types offered by bonuses with a type choice. */
const DIVINE_STRIKE_TYPES = ["radiant", "necrotic"];

const PRIMAL_STRIKE_TYPES = ["cold", "fire", "lightning", "thunder"];

const DIVINE_FURY_TYPES = ["necrotic", "radiant"];

const ELEMENTAL_EPITOME_TYPES = ["acid", "cold", "fire", "lightning", "thunder"];

const LIFEDRINKER_TYPES = ["necrotic", "psychic", "radiant"];

/**
 * Add the class feature and species bonuses that ride on attacks (PHB 2024).
 *
 * @param {object} ctx
 * @param {object[]} out
 */
export function addFeatureAttackBonuses(ctx, out) {
    const { actor, item, activity, config, dialog, message, baseDamageType, turnKey, isMyTurn } = ctx;
    const isWeapon = item?.type === "weapon";
    const unarmed = isUnarmedStrike(item, activity);
    const original = originalActor(actor);
    const feature = (ids, pattern, filter) => findFeature(actor, ids, pattern, filter)
        ?? (original ? findFeature(original, ids, pattern, filter) : null);
    const levels = id => classLevels(actor, id) || classLevels(original, id);
    const used = (usageId) => hasUsedBonusThisTurn(actor, usageId, turnKey);
    const add = (bonus) => out.push({ turnKey, oneOff: true, ...bonus });

    // Remembered pick, or the first type
    const pickType = (bonusId, types) => getActorBonusType(actor, bonusId, types) ?? types[0];

    // Colossus Slayer (Hunter's Prey): +1d8 once per turn when the target is missing hit points
    if (isWeapon && feature(["hunters-prey"], /^hunter's prey(?::\s*colossus slayer)?$|^colossus slayer$/i)) {
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const hurt = targets.some(doc => {
            const hp = doc.actor.system?.attributes?.hp;
            return hp && (Number(hp.max) > 0) && (Number(hp.value) < Number(hp.max));
        });
        const usedNow = used("colossusSlayer");
        add({
            id: "colossusSlayer",
            spellName: "Colossus Slayer",
            formula: "1d8[Colossus Slayer]",
            formulaDisplay: "1d8",
            damageType: baseDamageType,
            matchWeaponType: true,
            flavor: "Colossus Slayer",
            labelKey: "ND5T.ConditionalDamage.ColossusSlayer.Label",
            defaultLabel: "Colossus Slayer (+1d8)",
            tooltipKey: `ND5T.ConditionalDamage.ColossusSlayer.Reason.${!targets.length ? "NoTarget" : (hurt ? "Hurt" : "Full")}`,
            tooltipFallback: !targets.length
                ? "No target found. Check the target's hit points yourself."
                : (hurt ? "The target is missing hit points." : "The target has all its hit points."),
            // Hunter's Prey can be switched to Horde Breaker: a choice made while the target qualified is remembered
            rememberWhen: hurt && !usedNow,
            defaultActive: hurt && !usedNow && getActorConditionalPreference(actor, "colossusSlayer", true)
        });
    }

    // Divine Strike (Cleric Blessed Strikes): +1d8 (2d8 at 14) radiant or necrotic, once on each of your turns
    if (isWeapon && isMyTurn && feature(["divine-strike"], /^(?:blessed strikes:\s*)?divine strike$/i)) {
        const dice = levels("cleric") >= 14 ? "2d8" : "1d8";
        add({
            id: "divineStrike",
            spellName: "Divine Strike",
            formula: `${dice}[Divine Strike]`,
            formulaDisplay: dice,
            damageType: "radiant",
            damageTypes: [...DIVINE_STRIKE_TYPES],
            flavor: "Divine Strike",
            labelKey: "ND5T.ConditionalDamage.DivineStrike.Label",
            defaultLabel: `Divine Strike (+${dice})`,
            defaultActive: !used("divineStrike")
        });
    }

    // Primal Strike (Druid Elemental Fury): +1d8 (2d8 at 15), weapon or Wild Shape attack, once on each of your turns
    if ((isWeapon || actor.isPolymorphed) && isMyTurn
        && feature(["primal-strike"], /^(?:elemental fury:\s*)?primal strike$/i)) {
        const dice = levels("druid") >= 15 ? "2d8" : "1d8";
        add({
            id: "primalStrike",
            spellName: "Primal Strike",
            formula: `${dice}[Primal Strike]`,
            formulaDisplay: dice,
            damageType: pickType("primalStrike", PRIMAL_STRIKE_TYPES),
            damageTypes: [...PRIMAL_STRIKE_TYPES],
            rememberType: true,
            flavor: "Primal Strike",
            labelKey: "ND5T.ConditionalDamage.PrimalStrike.Label",
            defaultLabel: `Primal Strike (+${dice})`,
            defaultActive: !used("primalStrike")
        });
    }

    // Divine Fury (Zealot): +1d6 + half Barbarian level on the first hit of each of your turns while raging
    if (isMyTurn && feature(["divine-fury"], /^divine fury$/i) && isActorRaging(actor)) {
        const half = Math.floor(levels("barbarian") / 2);
        const { formula, display } = diceWithMod("1d6", half, "Divine Fury");
        add({
            id: "divineFury",
            spellName: "Divine Fury",
            formula,
            formulaDisplay: display,
            damageType: pickType("divineFury", DIVINE_FURY_TYPES),
            damageTypes: [...DIVINE_FURY_TYPES],
            rememberType: true,
            flavor: "Divine Fury",
            labelKey: "ND5T.ConditionalDamage.DivineFury.Label",
            defaultLabel: `Divine Fury (+${display})`,
            defaultActive: !used("divineFury")
        });
    }

    // Frenzy (Berserker): Rage Damage d6s on the first Strength-based hit of your turn, raging and Reckless
    if (isMyTurn && feature(["frenzy"], /^frenzy$/i) && isActorRaging(actor) && isActorReckless(actor)
        && isEligibleBrutalStrikeAttack(item, activity, config, actor)) {
        const count = Number(actor.system?.scale?.barbarian?.["rage-damage"]?.value
            ?? original?.system?.scale?.barbarian?.["rage-damage"]?.value)
            || facesByLevel(levels("barbarian"), RAGE_DAMAGE);
        const dice = `${count}d6`;
        add({
            id: "frenzy",
            spellName: "Frenzy",
            formula: `${dice}[Frenzy]`,
            formulaDisplay: dice,
            damageType: baseDamageType,
            matchWeaponType: true,
            flavor: "Frenzy",
            labelKey: "ND5T.ConditionalDamage.Frenzy.Label",
            defaultLabel: `Frenzy (+${dice})`,
            defaultActive: !used("frenzy")
        });
    }

    // Dreadful Strikes (Fey Wanderer): +1d4 (1d6 at 11) psychic, each creature once per turn
    if (isWeapon && feature(["dreadful-strikes"], /^dreadful strikes?$/i)) {
        const dice = levels("ranger") >= 11 ? "1d6" : "1d4";
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const usageId = targets.length === 1 ? `dreadfulStrikes:${targets[0].uuid}` : "dreadfulStrikes";
        add({
            id: "dreadfulStrikes",
            usageId,
            spellName: "Dreadful Strikes",
            formula: `${dice}[Dreadful Strikes]`,
            formulaDisplay: dice,
            damageType: "psychic",
            flavor: "Dreadful Strikes",
            labelKey: "ND5T.ConditionalDamage.DreadfulStrikes.Label",
            defaultLabel: `Dreadful Strikes (+${dice})`,
            defaultActive: !used(usageId)
        });
    }

    // Dread Ambusher (Gloom Stalker): +2d6 (2d8 at 11) psychic once per turn, Wisdom modifier uses per Long Rest
    const ambusher = isWeapon ? feature(["dread-ambusher"], /^dread ambusher$/i) : null;
    const ambusherRes = resource(ambusher);
    if (ambusherRes?.available && !used("dreadAmbusher")) {
        const dice = levels("ranger") >= 11 ? "2d8" : "2d6";
        add({
            id: "dreadAmbusher",
            spellName: "Dread Ambusher",
            formula: `${dice}[Dread Ambusher]`,
            formulaDisplay: dice,
            damageType: "psychic",
            flavor: "Dread Ambusher",
            usesLeft: ambusherRes.usesLeft,
            usesTracked: ambusherRes.tracked,
            consume: ambusherRes.consume,
            labelKey: "ND5T.ConditionalDamage.DreadAmbusher.Label",
            defaultLabel: `Dread Ambusher (+${dice}, ${usesText({ usesLeft: ambusherRes.usesLeft, usesTracked: ambusherRes.tracked })})`,
            defaultActive: false
        });
    }

    // Elemental Epitome (Monk 17): +1 Martial Arts die on an Unarmed Strike, once on each of your turns, while
    // Elemental Attunement is active
    if (unarmed && isMyTurn && feature(["elemental-epitome"], /^elemental epitome$/i)) {
        const attunement = feature(["elemental-attunement"], /^elemental attunement/i);
        const attuned = !attunement
            || (attunement.effects ?? []).some(e => (e.type === "enchantment") && !e.disabled && (e.isAppliedEnchantment === true))
            || /\(active\)/i.test(attunement.name ?? "");
        if (attuned) {
            const dice = `1d${scaleDieFaces(actor, "monk", "die", 0) || scaleDieFaces(original, "monk", "die", 0)
                || facesByLevel(levels("monk"), MARTIAL_ARTS_DIE)}`;
            add({
                id: "elementalEpitome",
                spellName: "Elemental Epitome",
                formula: `${dice}[Elemental Epitome]`,
                formulaDisplay: dice,
                damageType: pickType("elementalEpitome", ELEMENTAL_EPITOME_TYPES),
                damageTypes: [...ELEMENTAL_EPITOME_TYPES],
                rememberType: true,
                flavor: "Elemental Epitome",
                labelKey: "ND5T.ConditionalDamage.ElementalEpitome.Label",
                defaultLabel: `Elemental Epitome (+${dice})`,
                defaultActive: !used("elementalEpitome")
            });
        }
    }

    // Fire's Burn / Frost's Chill (Goliath Giant Ancestry): on a hit with an attack roll, Proficiency Bonus uses
    for (const giant of [
        { id: "firesBurn", ids: ["fires-burn"], pattern: /^fire's burn/i, name: "Fire's Burn", dice: "1d10", type: "fire", key: "FiresBurn" },
        { id: "frostsChill", ids: ["frosts-chill"], pattern: /^frost's chill/i, name: "Frost's Chill", dice: "1d6", type: "cold", key: "FrostsChill" }
    ]) {
        const giantItem = feature(giant.ids, giant.pattern);
        const giantRes = resource(giantItem);
        if (!giantRes?.available) continue;
        add({
            id: giant.id,
            spellName: giant.name,
            formula: `${giant.dice}[${giant.name}]`,
            formulaDisplay: giant.dice,
            damageType: giant.type,
            flavor: giant.name,
            usesLeft: giantRes.usesLeft,
            usesTracked: giantRes.tracked,
            consume: giantRes.consume,
            labelKey: `ND5T.ConditionalDamage.${giant.key}.Label`,
            defaultLabel: `${giant.name} (+${giant.dice}, ${usesText({ usesLeft: giantRes.usesLeft, usesTracked: giantRes.tracked })})`,
            turnKey: null,
            defaultActive: false
        });
    }

    // Lunar Form (Moon Druid 10): +2d10 radiant on a Wild Shape form's attack, once on each of your turns
    if (actor.isPolymorphed && isMyTurn && feature(["lunar-form"], /^lunar form$/i)) {
        add({
            id: "lunarForm",
            spellName: "Lunar Form",
            formula: "2d10[Lunar Form]",
            formulaDisplay: "2d10",
            damageType: "radiant",
            flavor: "Lunar Form",
            labelKey: "ND5T.ConditionalDamage.LunarForm.Label",
            defaultLabel: "Lunar Form (+2d10)",
            defaultActive: !used("lunarForm")
        });
    }

    // Psionic Strike (Psi Warrior): Psionic Energy Die + Intelligence modifier force, once on each of your turns
    const psionic = isWeapon && isMyTurn
        ? feature(["psionic-power"], /^psionic power$/i, i => Array.from(i.system?.activities ?? []).some(a => a.type === "damage"))
        : null;
    const psionicRes = resource(psionic);
    if (psionicRes?.available && !used("psionicStrike")) {
        const faces = scaleDieFaces(actor, "psi-warrior", "die", 0) || scaleDieFaces(original, "psi-warrior", "die", 0)
            || facesByLevel(levels("fighter"), PSIONIC_ENERGY_DIE);
        const { formula, display } = diceWithMod(`1d${faces}`, Number(actor.system?.abilities?.int?.mod ?? 0), "Psionic Strike");
        add({
            id: "psionicStrike",
            spellName: "Psionic Strike",
            formula,
            formulaDisplay: display,
            damageType: "force",
            flavor: "Psionic Strike",
            usesLeft: psionicRes.usesLeft,
            usesTracked: psionicRes.tracked,
            consume: psionicRes.consume,
            labelKey: "ND5T.ConditionalDamage.PsionicStrike.Label",
            defaultLabel: `Psionic Strike (+${display}, ${usesText({ usesLeft: psionicRes.usesLeft, usesTracked: psionicRes.tracked })})`,
            defaultActive: false
        });
    }

    // Hand of Harm (Warrior of Mercy): 1 Focus Point, Martial Arts die + Wisdom modifier necrotic, once per turn
    if (unarmed && !used("handOfHarm") && feature(["hand-of-harm"], /^hand of harm$/i)) {
        const focus = feature(["monks-focus"], /^monk's focus$/i);
        const focusRes = resource(focus);
        if (focusRes?.available) {
            const faces = scaleDieFaces(actor, "monk", "die", 0) || scaleDieFaces(original, "monk", "die", 0)
                || facesByLevel(levels("monk"), MARTIAL_ARTS_DIE);
            const { formula, display } = diceWithMod(`1d${faces}`, Number(actor.system?.abilities?.wis?.mod ?? 0), "Hand of Harm");
            add({
                id: "handOfHarm",
                spellName: "Hand of Harm",
                formula,
                formulaDisplay: display,
                damageType: "necrotic",
                flavor: "Hand of Harm",
                usesLeft: focusRes.usesLeft,
                usesTracked: focusRes.tracked,
                usesUnit: "focus",
                consume: focusRes.consume,
                labelKey: "ND5T.ConditionalDamage.HandOfHarm.Label",
                defaultLabel: `Hand of Harm (+${display}, ${usesText({ usesLeft: focusRes.usesLeft, usesTracked: focusRes.tracked, usesUnit: "focus" })})`,
                defaultActive: false
            });
        }
    }

    // Eldritch Smite (invocation): a Pact Magic slot, (1 + slot level)d8 force with the pact weapon, once per turn
    const pactWeapon = isWeapon && isPactWeapon(item, actor);
    const pact = actor.system?.spells?.pact;
    if (pactWeapon && (Number(pact?.value ?? 0) > 0) && (Number(pact?.level ?? 0) > 0) && !used("eldritchSmite")
        && feature(["eldritch-smite"], /^(?:eldritch invocation:\s*)?eldritch smite$/i)) {
        const dice = `${1 + Number(pact.level)}d8`;
        add({
            id: "eldritchSmite",
            spellName: "Eldritch Smite",
            formula: `${dice}[Eldritch Smite]`,
            formulaDisplay: dice,
            damageType: "force",
            flavor: "Eldritch Smite",
            usesLeft: Number(pact.value),
            consume: { type: "pactSlot" },
            labelKey: "ND5T.ConditionalDamage.EldritchSmite.Label",
            defaultLabel: `Eldritch Smite (+${dice}, uses a Pact slot)`,
            defaultActive: false
        });
    }

    // Lifedrinker (invocation): +1d6 necrotic, psychic or radiant with the pact weapon
    if (pactWeapon && feature(["lifedrinker"], /^(?:eldritch invocation:\s*)?lifedrinker$/i)) {
        add({
            id: "lifedrinker",
            spellName: "Lifedrinker",
            formula: "1d6[Lifedrinker]",
            formulaDisplay: "1d6",
            damageType: pickType("lifedrinker", LIFEDRINKER_TYPES),
            damageTypes: [...LIFEDRINKER_TYPES],
            rememberType: true,
            flavor: "Lifedrinker",
            labelKey: "ND5T.ConditionalDamage.Lifedrinker.Label",
            defaultLabel: "Lifedrinker (+1d6)",
            turnKey: null,
            oneOff: false,
            defaultActive: true
        });
    }

    // Polar Strikes (Winter Walker, Frigid Explorer): +1d4 cold (1d6 at Ranger 11), weapon hits, each creature once
    // per turn
    if (isWeapon && feature(["frigid-explorer"], /^frigid explorer$/i)) {
        const dice = levels("ranger") >= 11 ? "1d6" : "1d4";
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const usageId = targets.length === 1 ? `polarStrikes:${targets[0].uuid}` : "polarStrikes";
        add({
            id: "polarStrikes",
            usageId,
            spellName: "Polar Strikes",
            formula: `${dice}[Polar Strikes]`,
            formulaDisplay: dice,
            damageType: "cold",
            flavor: "Polar Strikes",
            labelKey: "ND5T.ConditionalDamage.PolarStrikes.Label",
            defaultLabel: `Polar Strikes (+${dice})`,
            defaultActive: !used(usageId)
        });
    }

    // Power from Pain (Boon of Bloodshed): + Proficiency Bonus once per turn on an attack made while Bloodied
    if (feature(["boon-of-bloodshed"], /^boon of bloodshed$/i) && isBloodied(actor)) {
        const pb = Number(actor.system?.attributes?.prof ?? 2);
        add({
            id: "powerFromPain",
            spellName: "Power from Pain",
            formula: `${pb}[Power from Pain]`,
            formulaDisplay: String(pb),
            damageType: baseDamageType,
            matchWeaponType: true,
            flat: true,
            flavor: "Power from Pain",
            labelKey: "ND5T.ConditionalDamage.PowerFromPain.Label",
            defaultLabel: `Power from Pain (+${pb})`,
            defaultActive: !used("powerFromPain")
        });
    }

    // Ominous Strikes (Hollow Warden, Ancient Might): + Wisdom modifier on a hit against a Frightened creature
    const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0);
    if ((wisMod > 0) && feature(["ancient-might"], /^ancient might$/i)) {
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const frightened = targets.some(doc => doc.actor?.statuses?.has("frightened"));
        add({
            id: "ominousStrikes",
            spellName: "Ominous Strikes",
            formula: `${wisMod}[Ominous Strikes]`,
            formulaDisplay: String(wisMod),
            damageType: baseDamageType,
            matchWeaponType: true,
            flat: true,
            flavor: "Ominous Strikes",
            labelKey: "ND5T.ConditionalDamage.OminousStrikes.Label",
            defaultLabel: `Ominous Strikes (+${wisMod})`,
            tooltipKey: `ND5T.ConditionalDamage.OminousStrikes.Reason.${!targets.length ? "NoTarget" : (frightened ? "Frightened" : "NotFrightened")}`,
            tooltipFallback: !targets.length
                ? "No target found. Check yourself whether it's Frightened."
                : (frightened ? "The target is Frightened." : "The target isn't Frightened."),
            turnKey: null,
            defaultActive: frightened
        });
    }

    // Arcane Jolt (Battle Smith): +2d6 force (4d6 with Improved Defender) with a magic weapon, once per turn,
    // Intelligence modifier uses per Long Rest
    const magicWeapon = isWeapon && (Boolean(item.system?.properties?.has?.("mgc")) || (Number(item.system?.magicalBonus) > 0));
    const jolt = magicWeapon && !used("arcaneJolt") ? feature(["arcane-jolt"], /^arcane jolt$/i) : null;
    const joltRes = resource(jolt);
    if (joltRes?.available) {
        const dice = feature(["improved-defender"], /^improved defender$/i) ? "4d6" : "2d6";
        add({
            id: "arcaneJolt",
            spellName: "Arcane Jolt",
            formula: `${dice}[Arcane Jolt]`,
            formulaDisplay: dice,
            damageType: "force",
            flavor: "Arcane Jolt",
            usesLeft: joltRes.usesLeft,
            usesTracked: joltRes.tracked,
            consume: joltRes.consume,
            labelKey: "ND5T.ConditionalDamage.ArcaneJolt.Label",
            defaultLabel: `Arcane Jolt (+${dice}, ${usesText({ usesLeft: joltRes.usesLeft, usesTracked: joltRes.tracked })})`,
            defaultActive: false
        });
    }

    // Lightning Launcher (Armorer, Infiltrator model): +1d6 lightning once on each of your turns with the launcher
    if (isWeapon && isMyTurn && ((identifierOf(item) === "lightning-launcher") || /lightning launcher/i.test(item.name ?? ""))) {
        add({
            id: "lightningLauncher",
            spellName: "Lightning Launcher",
            formula: "1d6[Lightning Launcher]",
            formulaDisplay: "1d6",
            damageType: "lightning",
            flavor: "Lightning Launcher",
            labelKey: "ND5T.ConditionalDamage.LightningLauncher.Label",
            defaultLabel: "Lightning Launcher (+1d6)",
            defaultActive: !used("lightningLauncher")
        });
    }

    // Dreaded Necrosis (Undead Patron, Grave Touched): one extra damage die for necrotic damage while in Form of
    // Dread, once per turn
    if (feature(["grave-touched"], /^grave touched$/i)
        && activeFeatureEffects(actor, ["form-of-dread"], /^form of (?:superior )?dread\b/i).length) {
        const faces = firstDieFacesOfType(config, "necrotic");
        if (faces) {
            const dice = `1d${faces}`;
            add({
                id: "dreadedNecrosis",
                spellName: "Dreaded Necrosis",
                formula: `${dice}[Dreaded Necrosis]`,
                formulaDisplay: dice,
                damageType: "necrotic",
                flavor: "Dreaded Necrosis",
                labelKey: "ND5T.ConditionalDamage.DreadedNecrosis.Label",
                defaultLabel: `Dreaded Necrosis (+${dice})`,
                defaultActive: !used("dreadedNecrosis")
            });
        }
    }
    // Death and Decay (World of Warcraft): attacks against a creature your Death and Decay cursed deal +1d6 necrotic
    if (feature(["death-and-decay"], null, i => i.type === "spell") || actor.items?.some(i => identifierOf(i) === "death-and-decay")) {
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const cursed = targets.some(doc => effectsFrom(doc.actor, /^cursed$/i, ["death-and-decay"], actor).length);
        if (cursed) {
            add({
                id: "deathAndDecay",
                spellName: "Death and Decay",
                formula: "1d6[Death and Decay]",
                formulaDisplay: "1d6",
                damageType: "necrotic",
                flavor: "Death and Decay",
                labelKey: "ND5T.ConditionalDamage.DeathAndDecay.Label",
                defaultLabel: "Death and Decay (+1d6)",
                turnKey: null,
                defaultActive: true
            });
        }
    }

    // Metamorphosis: Havoc (World of Warcraft): +1d6 fire on melee weapon hits while in the Havoc form
    const meleeWeapon = isWeapon && ((activity?.getActionType?.(config?.attackMode) ?? activity?.actionType) === "mwak");
    if (meleeWeapon && effectsFrom(actor, /^havoc$/i, ["metamorphosis"]).length) {
        add({
            id: "havoc",
            spellName: "Havoc",
            formula: "1d6[Havoc]",
            formulaDisplay: "1d6",
            damageType: "fire",
            flavor: "Havoc",
            labelKey: "ND5T.ConditionalDamage.Havoc.Label",
            defaultLabel: "Havoc (+1d6)",
            turnKey: null,
            defaultActive: true
        });
    }

    // Combo Strikes (Fists of Fury feat, World of Warcraft): +1 Unarmed Strike damage for each earlier melee hit on
    // the creature this turn
    if (unarmed && turnKey && feature(["fists-of-fury"], /^fists of fury$/i)) {
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        if (targets.length === 1) {
            const combo = previousMeleeHits(actor, targets[0].uuid, turnKey);
            if (combo > 0) {
                add({
                    id: "comboStrikes",
                    spellName: "Combo Strikes",
                    formula: `${combo}[Combo Strikes]`,
                    formulaDisplay: String(combo),
                    damageType: baseDamageType,
                    matchWeaponType: true,
                    flat: true,
                    flavor: "Combo Strikes",
                    labelKey: "ND5T.ConditionalDamage.ComboStrikes.Label",
                    defaultLabel: `Combo Strikes (+${combo})`,
                    turnKey: null,
                    defaultActive: true
                });
            }
        }
    }
}
