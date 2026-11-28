/**
 * Area Spell Automation: Constants and the per-spell rules (profiles by item identifier).
 * Part of the feature in `./index.js` (history and overview there).
 */

// Stored in every placed area: keep the old "damage emanation" ids, existing worlds depend on them.
export const DAMAGE_EMANATION_BEHAVIOR_TYPE = "niks-dnd5e-tweaks.damageEmanation";

export const ACTIVITY_BEHAVIOR_TYPE = "niksDamageEmanation";

/**
 * Region events an area can react to, in display order.
 *  - enter:          a creature enters the area.
 *  - emanationEnter: the area moves into a creature's space.
 *  - turnStart:      a creature starts its turn inside the area.
 *  - turnEnd:        a creature ends its turn inside the area.
 */
export const TRIGGER_TYPES = ["enter", "emanationEnter", "turnStart", "turnEnd"];

/** Triggers of spells without their own profile ("enters the area or ends its turn there"). */
export const DEFAULT_TRIGGERS = new Set(["enter", "emanationEnter", "turnEnd"]);

/**
 * Spell-specific rules, by item identifier.
 * @typedef {object} SpellProfile
 * @property {string[]} [triggers]                 Events that trigger the spell (default: DEFAULT_TRIGGERS).
 * @property {boolean} [requiresSight]             Only creatures the caster can see are affected.
 * @property {number} [drift]                      Feet the area moves away from the caster at the start of each of the caster's turns.
 * @property {boolean} [excludeCaster]             The caster is never affected, even by a placed area.
 * @property {boolean} [requirePlacingActivity]    Only the activity that applies the trigger may place the area
 *                                                 (Control Water: only the Whirlpool option, not the other options' area).
 * @property {RegExp} [activityName]               The activity to use, by name (Lightning Ring: "Emanation Save", not
 *                                                 the separate "Lightning Line").
 * @property {{activityName: RegExp, triggers: string[]}[]} [behaviors]
 *                                                 Several behaviors, each with its own activity and triggers (Hunger of
 *                                                 Hadar: damage at the start of a turn, a save at the end of a turn).
 * @property {boolean} [upcastChoice]              Only one of the behaviors gets the upcast bonus, chosen by the
 *                                                 caster in the usage dialog (Hunger of Hadar: "the Cold or Acid
 *                                                 damage (your choice) increases by 1d6"). Defaults to the first.
 * @property {(scaling: number) => number} [charges]
 *                                                 Uses before the area ends: each affected creature uses one (Cordon of
 *                                                 Arrows' pieces of ammunition).
 * @type {Map<string, SpellProfile>}
 */
const SPELL_PROFILES = new Map([
    ["conjure-woodland-beings", { requiresSight: true }],
    ["yolandes-regal-presence", { requiresSight: true }],
    ["cloudkill", { drift: 10 }],
    ["doomtide", { drift: 10 }],
    ["incendiary-cloud", { drift: 10 }],
    ["control-water", { requirePlacingActivity: true }],
    ["web", { triggers: ["enter", "emanationEnter", "turnStart"] }],
    ["sleet-storm", { triggers: ["enter", "emanationEnter", "turnStart"] }],
    ["stinking-cloud", { triggers: ["turnStart"] }],
    ["gust-of-wind", { triggers: ["turnEnd"], excludeCaster: true }],
    ["lightning-ring", { activityName: /emanation/i }],
    ["hunger-of-hadar", { upcastChoice: true, behaviors: [
        { activityName: /start of turn/i, triggers: ["turnStart"] },
        { activityName: /end of turn/i, triggers: ["turnEnd"] }
    ] }],
    // 4 pieces of ammunition, 2 more per slot level above 2nd; "a creature other than you"
    ["cordon-of-arrows", { excludeCaster: true, triggers: ["enter", "turnEnd"], charges: scaling => 4 + (2 * scaling) }],
    // World of Warcraft: "Creatures of your choice that start their turn in the Emanation take 1d8 Radiant damage"
    ["consecration", { triggers: ["turnStart"], activityName: /consecration damage/i }],
    ["hand-of-guldan", { activityName: /spirit damage/i }],
    ["rain-of-fire", { activityName: /falling fire/i }],
    // "a creature that enters the Cylinder for the first time on a turn or ends its turn there"
    ["starfall", { triggers: ["enter", "turnEnd"], activityName: /aoe damage/i }]
]);

/**
 * The profile of a spell.
 * @param {Item5e} item
 * @returns {SpellProfile}
 */
export function getProfile(item) {
    return SPELL_PROFILES.get(item?.system?.identifier) ?? {};
}

/** Actor types that count as creatures. */
export const CREATURE_ACTOR_TYPES = new Set(["character", "npc"]);

/** How long triggers are collected before they are processed together. */
export const BATCH_DELAY_MS = 300;

/** How long tokens are ignored for "emanation enters" events after the emanation appears around them. */
export const SUPPRESSED_ENTER_TTL_MS = 10000;

/** How long a player waits for the GM (or the card's author) to confirm a prompt click. */
export const CLAIM_TIMEOUT_MS = 5000;

/** Name of the usage dialog field and usage config key that hold the chosen activity id. */
export const UPCAST_CHOICE_KEY = "nd5tUpcastActivity";
