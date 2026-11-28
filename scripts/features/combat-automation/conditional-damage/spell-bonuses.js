/**
 * Conditional Damage Bonuses: Bonuses to spell damage and healing (PHB 2024, other official books, World of Warcraft).
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID } from "../../../context.js";
import { hasUsedBonusThisTurn } from "./combat-turn.js";
import { activeFeatureEffects, classLevels, findFeature, getRollTypes, identifierOf, resolveTargetDocs, resource, safeUuid, sizeRank, usesText } from "./feature-helpers.js";

/** Spells of the Cartographer Spells table (Forge of the Artificer). */
const CARTOGRAPHER_SPELLS = new Set([
    "faerie-fire", "guiding-bolt", "healing-word", "locate-object", "mind-spike", "call-lightning", "clairvoyance",
    "banishment", "locate-creature", "scrying", "teleportation-circle"
]);

/**
 * Whether a spell is being cast with a spell slot: a leveled spell whose activity uses a slot and that isn't
 * innate, at will or a ritual.
 *
 * @param {Item5e} item
 * @param {Activity|null} activity
 * @returns {boolean}
 */
function _castWithSlot(item, activity) {
    if (!(Number(item?.system?.level) > 0)) return false;
    const method = item.system?.method ?? item.system?.preparation?.mode ?? "spell";
    if (["innate", "atwill", "ritual"].includes(method)) return false;
    return activity?.consumption?.spellSlot !== false;
}

/**
 * Add the bonuses for spell damage (Empowered Evocation, Radiant Soul) and Celestial Revelation, which also works
 * with attacks. Spell bonuses work with every spell damage roll, saving throw spells included.
 *
 * @param {object} ctx
 * @param {object[]} out
 */
export function addSpellBonuses(ctx, out) {
    const { actor, item, activity, config, dialog, message, baseDamageType, turnKey, isMyTurn, isAttack, isHealing } = ctx;
    const isSpell = item?.type === "spell";
    const isDamage = !isHealing;
    const used = (usageId) => hasUsedBonusThisTurn(actor, usageId, turnKey);
    const spellClass = isSpell ? (item.system?.classIdentifier ?? "") : "";
    const school = isSpell ? item.system?.school : null;
    const intMod = Number(actor.system?.abilities?.int?.mod ?? 0);
    // Type of a spell bonus: the spell's own damage type, or healing
    const spellType = isHealing ? "healing" : baseDamageType;

    // Damage types of the roll's parts
    const rollTypes = new Set();
    for (const roll of config?.rolls ?? []) {
        if (roll?.options?._nd5tConditionalId) continue;
        const types = roll?.options?.types ?? (roll?.options?.type ? [roll.options.type] : []);
        for (const type of types) if (type) rollTypes.add(type);
    }

    // Empowered Evocation (Evoker): + Intelligence modifier to a Wizard Evocation spell's damage
    if (isSpell && isDamage && (school === "evo") && findFeature(actor, ["empowered-evocation"], /^empowered evocation$/i)) {
        if ((!spellClass || spellClass === "wizard") && intMod > 0) {
            out.push({
                id: "empoweredEvocation",
                spellName: "Empowered Evocation",
                formula: `${intMod}[Empowered Evocation]`,
                formulaDisplay: String(intMod),
                damageType: baseDamageType,
                matchWeaponType: true,
                flat: true,
                flavor: "Empowered Evocation",
                labelKey: "ND5T.ConditionalDamage.EmpoweredEvocation.Label",
                defaultLabel: `Empowered Evocation (+${intMod})`,
                defaultActive: true
            });
        }
    }

    // Radiant Soul (Celestial Patron): + Charisma modifier to a radiant or fire spell, once on each of your turns
    const soulTypes = ["radiant", "fire"].filter(t => rollTypes.has(t));
    const chaMod = Number(actor.system?.abilities?.cha?.mod ?? 0);
    if (isSpell && isDamage && soulTypes.length && (chaMod > 0) && findFeature(actor, ["radiant-soul"], /^radiant soul$/i)) {
        out.push({
            id: "radiantSoul",
            spellName: "Radiant Soul",
            formula: `${chaMod}[Radiant Soul]`,
            formulaDisplay: String(chaMod),
            damageType: soulTypes.includes(baseDamageType) ? baseDamageType : soulTypes[0],
            ...(soulTypes.length > 1 ? { damageTypes: soulTypes } : {}),
            flat: true,
            oneOff: true,
            turnKey,
            flavor: "Radiant Soul",
            labelKey: "ND5T.ConditionalDamage.RadiantSoul.Label",
            defaultLabel: `Radiant Soul (+${chaMod})`,
            blocked: [!isMyTurn && "NotYourTurn"],
            defaultActive: !used("radiantSoul")
        });
    }

    // Celestial Revelation (Aasimar): + Proficiency Bonus to an attack or spell, once on each of your turns, while
    // transformed. Necrotic Shroud deals necrotic damage, Heavenly Wings and Inner Radiance radiant.
    // Offered unticked off-turn or while not transformed
    if ((isAttack || isSpell) && isDamage && findFeature(actor, ["celestial-revelation"], /^celestial revelation$/i)) {
        const revelation = activeFeatureEffects(actor, ["celestial-revelation"],
            /^(?:heavenly wings|inner radiance|searing radiance|necrotic shroud)$/i);
        const pb = Number(actor.system?.attributes?.prof ?? 2);
        const necrotic = revelation.some(e => /necrotic shroud/i.test(e.name ?? ""));
        out.push({
            id: "celestialRevelation",
            spellName: "Celestial Revelation",
            formula: `${pb}[Celestial Revelation]`,
            formulaDisplay: String(pb),
            damageType: necrotic ? "necrotic" : "radiant",
            flat: true,
            oneOff: true,
            turnKey,
            flavor: "Celestial Revelation",
            labelKey: "ND5T.ConditionalDamage.CelestialRevelation.Label",
            defaultLabel: `Celestial Revelation (+${pb})`,
            blocked: [!isMyTurn && "NotYourTurn", !revelation.length && "NotTransformed"],
            defaultActive: !used("celestialRevelation")
        });
    }

    // Pull of Death (Grave Domain, Circle of Mortality): +1d4 necrotic (1d6 at Cleric 11) once per turn, attack or
    // spell, against a creature that's missing hit points
    if ((isAttack || isSpell) && isDamage && findFeature(actor, ["circle-of-mortality"], /^circle of mortality$/i)) {
        const targets = resolveTargetDocs(actor, { config, dialog, message, activity });
        const hurt = targets.some(doc => {
            const hp = doc.actor.system?.attributes?.hp;
            return hp && (Number(hp.max) > 0) && (Number(hp.value) < Number(hp.max));
        });
        const dice = classLevels(actor, "cleric") >= 11 ? "1d6" : "1d4";
        out.push({
            id: "pullOfDeath",
            spellName: "Pull of Death",
            formula: `${dice}[Pull of Death]`,
            formulaDisplay: dice,
            damageType: "necrotic",
            flavor: "Pull of Death",
            oneOff: true,
            turnKey,
            labelKey: "ND5T.ConditionalDamage.PullOfDeath.Label",
            defaultLabel: `Pull of Death (+${dice})`,
            tooltipKey: `ND5T.ConditionalDamage.ColossusSlayer.Reason.${!targets.length ? "NoTarget" : (hurt ? "Hurt" : "Full")}`,
            tooltipFallback: !targets.length
                ? "No target found. Check the target's hit points yourself."
                : (hurt ? "The target is missing hit points." : "The target has all its hit points."),
            defaultActive: hurt && !used("pullOfDeath")
        });
    }

    // Guided Precision (Cartographer): + Intelligence modifier once per turn to a Cartographer list spell, or to an
    // attack against a creature outlined by your Faerie Fire
    if (isDamage && (intMod > 0) && findFeature(actor, ["guided-precision"], /^guided precision$/i)) {
        const listed = isSpell && CARTOGRAPHER_SPELLS.has(identifierOf(item) || (item.name ?? "").slugify?.({ strict: true }));
        let outlined = false;
        if (!listed && isAttack) {
            outlined = resolveTargetDocs(actor, { config, dialog, message, activity }).some(doc =>
                (doc.actor?.appliedEffects ?? []).some(e => /^(?:outlined|faerie fire)\b/i.test(e.name ?? "")
                    && (!e.origin || e.origin.includes(actor.id))));
        }
        // An attack against a creature that doesn't look outlined is offered unticked
        if (listed || isAttack) {
            out.push({
                id: "guidedPrecision",
                spellName: "Guided Precision",
                formula: `${intMod}[Guided Precision]`,
                formulaDisplay: String(intMod),
                damageType: baseDamageType,
                matchWeaponType: true,
                flat: true,
                oneOff: true,
                turnKey,
                flavor: "Guided Precision",
                labelKey: "ND5T.ConditionalDamage.GuidedPrecision.Label",
                defaultLabel: `Guided Precision (+${intMod})`,
                blocked: [!listed && !outlined && "NotOutlined"],
                defaultActive: !used("guidedPrecision")
            });
        }
    }

    // Arcane Firearm (Artillerist): +1d8 to one damage roll of an Artificer spell cast through the firearm
    if (isSpell && isDamage && (spellClass === "artificer") && findFeature(actor, ["arcane-firearm"], /^arcane firearm$/i)) {
        out.push({
            id: "arcaneFirearm",
            spellName: "Arcane Firearm",
            formula: "1d8[Arcane Firearm]",
            formulaDisplay: "1d8",
            damageType: baseDamageType,
            matchWeaponType: true,
            flavor: "Arcane Firearm",
            labelKey: "ND5T.ConditionalDamage.ArcaneFirearm.Label",
            defaultLabel: "Arcane Firearm (+1d8)",
            defaultActive: true
        });
    }

    // Alchemical Savant (Alchemist): + Intelligence modifier (minimum 1) to one healing roll, or one acid, fire or
    // poison damage roll, of a spell cast with Alchemist's Supplies
    const savantTypes = isHealing ? ["healing"] : ["acid", "fire", "poison"].filter(t => getRollTypes(config).has(t));
    if (isSpell && savantTypes.length && findFeature(actor, ["alchemical-savant"], /^alchemical savant$/i)) {
        const bonus = Math.max(1, intMod);
        out.push({
            id: "alchemicalSavant",
            spellName: "Alchemical Savant",
            formula: `${bonus}[Alchemical Savant]`,
            formulaDisplay: String(bonus),
            damageType: savantTypes.includes(baseDamageType) ? baseDamageType : savantTypes[0],
            ...(savantTypes.length > 1 ? { damageTypes: savantTypes } : {}),
            flat: true,
            flavor: "Alchemical Savant",
            labelKey: "ND5T.ConditionalDamage.AlchemicalSavant.Label",
            defaultLabel: `Alchemical Savant (+${bonus})`,
            defaultActive: true
        });
    }

    // Arcane Conduit (Reanimator): + Intelligence modifier once per turn to an Artificer Evocation or Necromancy spell
    if (isSpell && isDamage && (spellClass === "artificer") && ["evo", "nec"].includes(school) && (intMod > 0)
        && findFeature(actor, ["arcane-conduit"], /^arcane conduit$/i)) {
        out.push({
            id: "arcaneConduit",
            spellName: "Arcane Conduit",
            formula: `${intMod}[Arcane Conduit]`,
            formulaDisplay: String(intMod),
            damageType: baseDamageType,
            matchWeaponType: true,
            flat: true,
            oneOff: true,
            turnKey,
            flavor: "Arcane Conduit",
            labelKey: "ND5T.ConditionalDamage.ArcaneConduit.Label",
            defaultLabel: `Arcane Conduit (+${intMod})`,
            defaultActive: !used("arcaneConduit")
        });
    }

    // Power from Beyond (College of Spirits, Empowered Channeling): +1d6 once per turn to a Bard spell cast with a
    // spell slot, damage or healing
    if (isSpell && (spellClass === "bard") && _castWithSlot(item, activity)
        && findFeature(actor, ["empowered-channeling"], /^empowered channeling$/i)) {
        out.push({
            id: "powerFromBeyond",
            spellName: "Power from Beyond",
            formula: "1d6[Power from Beyond]",
            formulaDisplay: "1d6",
            damageType: spellType,
            ...(isHealing ? {} : { matchWeaponType: true }),
            oneOff: true,
            turnKey,
            flavor: "Power from Beyond",
            labelKey: "ND5T.ConditionalDamage.PowerFromBeyond.Label",
            defaultLabel: "Power from Beyond (+1d6)",
            defaultActive: !used("powerFromBeyond")
        });
    }

    // Power Surge (Arcane Overload): + Proficiency Bonus to one damage roll of an Evocation spell, once per Long Rest
    const overload = (isSpell && isDamage && (school === "evo")) ? findFeature(actor, ["arcane-overload"], /^arcane overload$/i) : null;
    const overloadRes = resource(overload);
    if (overloadRes) {
        const pb = Number(actor.system?.attributes?.prof ?? 2);
        out.push({
            id: "powerSurge",
            spellName: "Power Surge",
            formula: `${pb}[Power Surge]`,
            formulaDisplay: String(pb),
            damageType: baseDamageType,
            matchWeaponType: true,
            flat: true,
            oneOff: true,
            usesLeft: overloadRes.usesLeft,
            usesTracked: overloadRes.tracked,
            consume: overloadRes.consume,
            flavor: "Power Surge",
            labelKey: "ND5T.ConditionalDamage.PowerSurge.Label",
            defaultLabel: `Power Surge (+${pb}, ${usesText({ usesLeft: overloadRes.usesLeft, usesTracked: overloadRes.tracked })})`,
            blocked: [!overloadRes.available && "NoUses"],
            defaultActive: false
        });
    }

    // Perfect Poisoner (Boon of Poison Mastery): once per turn, poison damage dice from an attack, spell or feature
    // roll their highest number. Applied to the final rolls in dnd5e.postDamageRollConfiguration.
    if (isDamage && getRollTypes(config, true).has("poison") && findFeature(actor, ["boon-of-poison-mastery"], /^boon of poison mastery$/i)) {
        out.push({
            id: "perfectPoisoner",
            spellName: "Perfect Poisoner",
            flavor: "Perfect Poisoner",
            isWeaponModifier: true,
            formulaDisplay: "max",
            oneOff: true,
            turnKey,
            labelKey: "ND5T.ConditionalDamage.PerfectPoisoner.Label",
            defaultLabel: "Perfect Poisoner (max poison dice)",
            defaultActive: !used("perfectPoisoner")
        });
    }

    // Damage from an attack or a spell (World of Warcraft species traits and spells below)
    const attackOrSpell = isDamage && (isAttack || isSpell);
    const targets = attackOrSpell ? resolveTargetDocs(actor, { config, dialog, message, activity }) : [];

    // Fury of the Small (Goblin): + Proficiency Bonus against a larger creature, once per turn, PB uses per Long Rest
    const fury = attackOrSpell ? findFeature(actor, ["fury-of-the-small"], /^fury of the small$/i) : null;
    const furyRes = resource(fury);
    const ownSize = sizeRank(actor);
    const larger = targets.some(doc => (ownSize !== null) && ((sizeRank(doc.actor) ?? -1) > ownSize));
    if (furyRes) {
        const pb = Number(actor.system?.attributes?.prof ?? 2);
        out.push({
            id: "furyOfTheSmall",
            spellName: "Fury of the Small",
            formula: `${pb}[Fury of the Small]`,
            formulaDisplay: String(pb),
            damageType: baseDamageType,
            matchWeaponType: true,
            flat: true,
            oneOff: true,
            turnKey,
            usesLeft: furyRes.usesLeft,
            usesTracked: furyRes.tracked,
            consume: furyRes.consume,
            flavor: "Fury of the Small",
            labelKey: "ND5T.ConditionalDamage.FuryOfTheSmall.Label",
            defaultLabel: `Fury of the Small (+${pb}, ${usesText({ usesLeft: furyRes.usesLeft, usesTracked: furyRes.tracked })})`,
            blocked: [!furyRes.available && "NoUses", !larger && "NotLarger"],
            defaultActive: false
        });
    }

    // Touch of the Grave (Forsaken): + (Proficiency Bonus)d4 necrotic when you deal damage, once per Long Rest
    const grave = attackOrSpell ? findFeature(actor, ["touch-of-the-grave"], /^touch of the grave$/i) : null;
    const graveRes = resource(grave);
    if (graveRes) {
        const dice = `${Number(actor.system?.attributes?.prof ?? 2)}d4`;
        out.push({
            id: "touchOfTheGrave",
            spellName: "Touch of the Grave",
            formula: `${dice}[Touch of the Grave]`,
            formulaDisplay: dice,
            damageType: "necrotic",
            oneOff: true,
            usesLeft: graveRes.usesLeft,
            usesTracked: graveRes.tracked,
            consume: graveRes.consume,
            flavor: "Touch of the Grave",
            labelKey: "ND5T.ConditionalDamage.TouchOfTheGrave.Label",
            defaultLabel: `Touch of the Grave (+${dice}, ${usesText({ usesLeft: graveRes.usesLeft, usesTracked: graveRes.tracked })})`,
            blocked: [!graveRes.available && "NoUses"],
            defaultActive: false
        });
    }

    // Entropic Embrace (Void Elf), Touch of the Void: once on each of your turns, +1d4 necrotic on damage or +1d4 on
    // healing (1d4 more per slot level above 1st), while the spell lasts (marker effect created when it's cast)
    const embrace = (attackOrSpell || (isHealing && isSpell))
        ? (actor.appliedEffects ?? []).find(e => !e.disabled && e.getFlag?.(MODULE_ID, "entropicEmbrace"))
        : null;
    if (embrace) {
        const level = Math.max(1, Number(embrace.getFlag(MODULE_ID, "entropicEmbrace")?.level ?? 1));
        const dice = `${level}d4`;
        out.push({
            id: "touchOfTheVoid",
            spellName: "Touch of the Void",
            formula: `${dice}[Touch of the Void]`,
            formulaDisplay: dice,
            damageType: isHealing ? "healing" : "necrotic",
            oneOff: true,
            turnKey,
            flavor: "Touch of the Void",
            labelKey: "ND5T.ConditionalDamage.TouchOfTheVoid.Label",
            defaultLabel: `Touch of the Void (+${dice})`,
            blocked: [!isMyTurn && "NotYourTurn"],
            defaultActive: !used("touchOfTheVoid")
        });
    }

    // Rain of Fire (World of Warcraft): spell attacks against a creature inside your Rain of Fire deal +1d6 necrotic
    const spellAttack = isAttack && ["msak", "rsak"].includes(activity?.actionType ?? "");
    if (spellAttack && canvas?.scene) {
        const rains = canvas.scene.regions.filter(r => {
            const item = safeUuid(r.getFlag?.("dnd5e", "item"));
            return (identifierOf(item) === "rain-of-fire") && (item?.actor === actor || item?.actor?.uuid === actor.uuid);
        });
        const inside = rains.length && targets.some(doc => rains.some(r => doc.regions?.has?.(r) || doc.testInsideRegion?.(r)));
        // Offered while you have a Rain of Fire on the scene; unticked when the target isn't inside it
        if (rains.length) {
            out.push({
                id: "rainOfFire",
                spellName: "Rain of Fire",
                formula: "1d6[Rain of Fire]",
                formulaDisplay: "1d6",
                damageType: "necrotic",
                flavor: "Rain of Fire",
                labelKey: "ND5T.ConditionalDamage.RainOfFire.Label",
                defaultLabel: "Rain of Fire (+1d6)",
                blocked: [!inside && "NotInRain"],
                defaultActive: true
            });
        }
    }
}
