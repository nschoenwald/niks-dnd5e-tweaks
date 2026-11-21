/**
 * Feature: Ranged Attacks in Close Combat
 * Description: A ranged attack roll (weapon, thrown weapon, spell or any other ranged attack) has Disadvantage
 *              while the attacker is within 5 feet of an enemy who can see it and isn't Incapacitated.
 *              Crossbow Expert, Sharpshooter, Spell Sniper (2024) and Gunner lift it for the attacks they cover.
 *
 * @introduced v14.106.0
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { getMidiWorkflow, isAc5eActive, midiHandlesNearbyFoe } from "../../utils/module-compat.js";
import { tokenDistance, feetToSceneUnits } from "../../utils/token-distance.js";
import { attackerToken, addRollModes } from "../../utils/attack-context.js";
import { hasStatus, canSee } from "../../utils/creature-sight.js";

/**
 * How it works
 *
 * dnd5e 6.0 / 6.1 don't apply this rule at all.
 *
 *  - dnd5e.preRollAttack: the attack is ranged when the activity's action type for the chosen attack mode is
 *    "rwak" or "rsak" (`AttackActivity#getActionType`, which turns a thrown or ranged mode of a melee weapon
 *    into "rwak"). The mode is the one the roll starts with; switching it in the roll dialog doesn't redo the
 *    check.
 *  - Enemies are tokens on the attacker's scene with the opposite disposition: Hostile (and Secret) for a
 *    Friendly or Neutral attacker, Friendly for a Hostile or Secret one. Hidden tokens, non-creatures and
 *    creatures at 0 HP don't count.
 *  - "Within 5 feet" uses the shared token distance (closest spaces, including height). "Can see" uses the
 *    shared sight check (Blinded, Invisible, Blindsight, Truesight, See Invisibility) plus a sight-wall test
 *    between the token centers, so an enemy behind a wall doesn't count. Light isn't checked.
 *  - Incapacitated covers the Incapacitated status and the conditions that include it (Paralyzed, Petrified,
 *    Stunned, Unconscious), plus Dead.
 *  - Exceptions by identifier (English name as fallback):
 *      crossbow-expert: 2024 version crossbows only, 2014 version all ranged attacks;
 *      sharpshooter (2024): attacks with Ranged weapons; spell-sniper (2024): spell attacks;
 *      gunner: weapons with the Firearm property.
 *    The version comes from the feat's `system.source.rules`, or the world's rules version when that is empty.
 *    midi-qol's `flags.midi-qol.ignoreNearbyFoes` is honoured when it is set to true.
 *  - Steps aside while Automated Conditions 5e is active or midi-qol's optional "Nearby Foe" rule is on, which
 *    both apply this rule. midi-qol workflows otherwise go through dnd5e's rollAttack, so the hook runs for them.
 */

const RANGE_FT = 5;
const RANGED_ACTION_TYPES = new Set(["rwak", "rsak"]);
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
const CROSSBOWS = new Set(["handcrossbow", "heavycrossbow", "lightcrossbow"]);
const { FRIENDLY, NEUTRAL, HOSTILE, SECRET } = CONST.TOKEN_DISPOSITIONS;

// ── Settings helpers ──────────────────────────────────────────────────

function _active() {
    try {
        return Boolean(getSetting("enableRangedCloseCombat")) && !isAc5eActive() && !midiHandlesNearbyFoe();
    } catch {
        return false;
    }
}

function _isModernRules() {
    try {
        return (dnd5e?.settings?.rulesVersion ?? game.settings.get("dnd5e", "rulesVersion")) === "modern";
    } catch {
        return false;
    }
}

// ── Exceptions ────────────────────────────────────────────────────────

/**
 * Find a feat on the actor by identifier, or by its English name as a fallback.
 * @param {Actor5e} actor
 * @param {string} identifier
 * @param {string} name
 * @returns {Item5e|undefined}
 */
function _findFeat(actor, identifier, name) {
    const lower = name.toLowerCase();
    return actor.items.find(i => (i.type === "feat")
        && ((i.system?.identifier === identifier) || (i.name?.trim().toLowerCase() === lower)));
}

/**
 * Whether a feat is the 2024 version: its source rules, or the world's rules version when that is empty.
 * @param {Item5e} feat
 * @returns {boolean}
 */
function _is2024(feat) {
    const rules = feat.system?.source?.rules;
    if (rules) return String(rules) === "2024";
    return _isModernRules();
}

/**
 * Whether midi-qol's ignoreNearbyFoes flag is set to true on the actor (formulas aren't evaluated).
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _midiIgnoreFlag(actor) {
    const value = actor.flags?.["midi-qol"]?.ignoreNearbyFoes;
    return (value === true) || (value === 1) || (value === "1") || (String(value).toLowerCase() === "true");
}

/**
 * The feature that lets this attack ignore the rule, if any.
 * @param {Actor5e} actor
 * @param {Item5e} item
 * @param {string} actionType  "rwak" or "rsak".
 * @returns {string|null}      Name of the feature, or null.
 */
function _exemption(actor, item, actionType) {
    if (_midiIgnoreFlag(actor)) return "midi-qol ignoreNearbyFoes";
    const weapon = item?.type === "weapon" ? item.system : null;

    const crossbowExpert = _findFeat(actor, "crossbow-expert", "Crossbow Expert");
    if (crossbowExpert) {
        if (!_is2024(crossbowExpert)) return crossbowExpert.name;
        if (weapon && CROSSBOWS.has(weapon.type?.baseItem)) return crossbowExpert.name;
    }
    if (weapon && (CONFIG.DND5E.weaponTypeMap?.[weapon.type?.value] === "ranged")) {
        const sharpshooter = _findFeat(actor, "sharpshooter", "Sharpshooter");
        if (sharpshooter && _is2024(sharpshooter)) return sharpshooter.name;
    }
    if (actionType === "rsak") {
        const spellSniper = _findFeat(actor, "spell-sniper", "Spell Sniper");
        if (spellSniper && _is2024(spellSniper)) return spellSniper.name;
    }
    if (weapon?.properties?.has?.("fir")) {
        const gunner = _findFeat(actor, "gunner", "Gunner");
        if (gunner) return gunner.name;
    }
    return null;
}

// ── Enemies ───────────────────────────────────────────────────────────

/**
 * Dispositions that are enemies of a token with this disposition.
 * @param {number} disposition
 * @returns {number[]}
 */
function _enemyDispositions(disposition) {
    if ((disposition === HOSTILE) || (disposition === SECRET)) return [FRIENDLY];
    if ((disposition === FRIENDLY) || (disposition === NEUTRAL)) return [HOSTILE, SECRET];
    return [];
}

/**
 * Whether an actor is Incapacitated (or worse) for this rule.
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isIncapacitated(actor) {
    if (INCAPACITATING.some(s => hasStatus(actor, s))) return true;
    const hp = actor.system?.attributes?.hp;
    return (Number(hp?.max) > 0) && (Number(hp?.value) <= 0);
}

/**
 * Whether a sight-blocking wall stands between two tokens' centers.
 * @param {Token} from
 * @param {Token} to
 * @returns {boolean}
 */
function _wallBetween(from, to) {
    try {
        return Boolean(from.checkCollision(to.center, { origin: from.center, type: "sight", mode: "any" }));
    } catch (err) {
        debug("Ranged Attacks in Close Combat | wall check failed", err);
        return false;
    }
}

/**
 * The first enemy within 5 feet of the attacker who can see it and isn't Incapacitated.
 * @param {Token} attacker
 * @returns {Token|null}
 */
function _threateningEnemy(attacker) {
    const dispositions = _enemyDispositions(attacker.document.disposition);
    if (!dispositions.length) return null;
    const reach = feetToSceneUnits(RANGE_FT) + 1e-6;
    for (const token of canvas.tokens?.placeables ?? []) {
        if ((token === attacker) || token.document.hidden) continue;
        if (!dispositions.includes(token.document.disposition)) continue;
        const actor = token.actor;
        if (!actor?.system?.isCreature || _isIncapacitated(actor)) continue;
        const distance = tokenDistance(token, attacker);
        if (distance > reach) continue;
        if (!canSee(token, attacker, distance) || _wallBetween(token, attacker)) continue;
        return token;
    }
    return null;
}

// ── Attacks ───────────────────────────────────────────────────────────

/**
 * dnd5e.preRollAttack: Disadvantage on a ranged attack while an enemy who can see the attacker is within 5 feet.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        if (!_active() || !canvas?.ready) return;
        const activity = config.subject;
        const actor = activity?.actor;
        if (!actor) return;
        const attackMode = config.attackMode ?? config.rolls?.[0]?.options?.attackMode;
        const actionType = activity.getActionType?.(attackMode) ?? activity.actionType;
        if (!RANGED_ACTION_TYPES.has(actionType)) return;

        const attacker = attackerToken(actor, getMidiWorkflow(config));
        if (!attacker || (attacker.document.parent !== canvas.scene)) return;
        const enemy = _threateningEnemy(attacker);
        if (!enemy) return;

        const exemption = _exemption(actor, activity.item, actionType);
        if (exemption) {
            debug(`Ranged Attacks in Close Combat | ${actor.name} is next to ${enemy.name}, ignored (${exemption})`);
            return;
        }
        debug(`Ranged Attacks in Close Combat | ${actor.name} makes a ranged attack next to ${enemy.name}: Disadvantage`);
        addRollModes(config, { disadvantage: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Ranged Attacks in Close Combat: preRollAttack failed`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize Ranged Attacks in Close Combat. Called once during the "setup" phase from main.js.
 * The hook stays registered and checks the setting on every call.
 */
export function initRangedCloseCombat() {
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    debug("Ranged Attacks in Close Combat | Initialized");
}
