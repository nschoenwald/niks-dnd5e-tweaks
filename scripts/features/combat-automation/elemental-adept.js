/**
 * Feature: Elemental Adept
 * Description: Applies the Elemental Adept feat automatically to spell damage of the chosen type: every 1 rolled on
 * a damage die counts as a 2. Part of Conditional Damage Bonuses, but without a toggle, like Great Weapon Fighting.
 *
 * @introduced v14.85.0
 * @updated v14.92.0 (Tells the owner once when the feat's name doesn't say the chosen type)
 */
import { isFeatureActive, log, debug } from "../../context.js";

/**
 * Elemental Adept
 * ---------------------------------------------------------------------------
 * The feat (identifier `elemental-adept`, PHB 2024) can be taken several times, once per damage type, but the item
 * doesn't record the chosen type (no advancement or effect for it). The type is read from the item's name instead,
 * e.g. "Elemental Adept (Fire)": the English name of acid, cold, fire, lightning or thunder (never a translated label;
 * other languages need the English word in the name).
 *
 * The roll's damage type is only final after the dialog (spells such as Chromatic Orb or Dragon's Breath let you
 * pick it there), so the modifier is added in `dnd5e.postDamageRollConfiguration`, when the DamageRolls exist but
 * aren't evaluated yet. Each literal die of a roll of a chosen type gets `min2` (Foundry's `Die#minimum`). Critical
 * dice are part of the same terms (DamageRoll scales them in its constructor), so they keep the modifier.
 */

const IDENTIFIER = "elemental-adept";
const NAME_PATTERN = /^elemental adept\b/i;
const TYPES = ["acid", "cold", "fire", "lightning", "thunder"];

/** Actors whose owner was already told this session that their Elemental Adept has no type in its name. */
const _warnedActors = new Set();

/**
 * Whether the actor has an Elemental Adept feat.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function hasElementalAdept(actor) {
    return Boolean(actor?.items?.some(item => (item.type === "feat")
        && ((item.system?.identifier === IDENTIFIER) || NAME_PATTERN.test(item.name?.trim() ?? ""))));
}

/**
 * Damage types the actor's Elemental Adept feats name.
 * @param {Actor5e} actor
 * @returns {Set<string>}
 */
export function getElementalAdeptTypes(actor) {
    const types = new Set();
    for (const item of actor?.items ?? []) {
        if (item.type !== "feat") continue;
        const name = item.name?.trim() ?? "";
        if ((item.system?.identifier !== IDENTIFIER) && !NAME_PATTERN.test(name)) continue;
        const lower = name.toLowerCase();
        for (const type of TYPES) {
            if (new RegExp(`(?:^|[^\\p{L}])${type}(?:$|[^\\p{L}])`, "iu").test(lower)) types.add(type);
        }
    }
    return types;
}

/**
 * Add `min2` to every literal die (more than 2 faces, no reroll or minimum yet) of a roll.
 * @param {Roll} roll
 * @returns {boolean}  Whether a die was changed.
 */
function applyMinimumTwo(roll) {
    let changed = false;
    for (const term of roll.terms ?? []) {
        if (!(term instanceof foundry.dice.terms.Die) || !(term.faces > 2)) continue;
        const modifiers = term.modifiers ?? [];
        if (modifiers.some(m => /min|r/i.test(m))) continue;
        modifiers.push("min2");
        term.modifiers = modifiers;
        changed = true;
    }
    if (changed) roll.resetFormula?.();
    return changed;
}

/**
 * Hook handler for `dnd5e.postDamageRollConfiguration`.
 * @param {DamageRoll[]} rolls
 * @param {object} config
 */
function onPostDamageRollConfiguration(rolls, config) {
    try {
        if (!isFeatureActive("enableConditionalDamage", "clientEnableConditionalDamage")) return;
        const item = config?.subject?.item;
        if (item?.type !== "spell") return;
        const actor = config.subject.actor ?? item.actor;
        const types = getElementalAdeptTypes(actor);
        if (!types.size) {
            // The feat is there but its name doesn't say the type: tell the owner once, when it would have mattered
            const eligible = (rolls ?? []).some(r => TYPES.includes(r.options?.type));
            if (eligible && hasElementalAdept(actor) && !_warnedActors.has(actor.uuid)) {
                _warnedActors.add(actor.uuid);
                ui.notifications?.warn(game.i18n.has("ND5T.ConditionalDamage.ElementalAdeptNoType")
                    ? game.i18n.format("ND5T.ConditionalDamage.ElementalAdeptNoType", { name: actor.name })
                    : `${actor.name}: Elemental Adept doesn't know your chosen damage type. Add it to the feat's name in English, e.g. "Elemental Adept (Fire)".`);
            }
            return;
        }

        for (const roll of rolls ?? []) {
            const type = roll.options?.type;
            if (!types.has(type) || roll.options?.nd5tElementalAdept) continue;
            if (applyMinimumTwo(roll)) {
                roll.options.nd5tElementalAdept = true;
                debug(`Elemental Adept: ${actor.name}'s ${item.name} rolls ${roll.formula} (${type})`);
            }
        }
    } catch (err) {
        console.error("niks-dnd5e-tweaks | Elemental Adept failed", err);
    }
}

export function initElementalAdept() {
    Hooks.on("dnd5e.postDamageRollConfiguration", onPostDamageRollConfiguration);
    log("Elemental Adept | Hooked dnd5e.postDamageRollConfiguration.");
}
