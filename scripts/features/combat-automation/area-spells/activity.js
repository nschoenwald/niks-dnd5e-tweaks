/**
 * Area Spell Automation: Finding the activity an area uses; the spell list, triggers and concentration checks.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, getSetting, debug } from "../../../context.js";
import { ACTIVITY_BEHAVIOR_TYPE, DAMAGE_EMANATION_BEHAVIOR_TYPE, DEFAULT_TRIGGERS, getProfile } from "./config.js";

/**
 * Whether an activity can be used when the emanation triggers: a save (with or without damage,
 * e.g. Grease) or a damage roll without a save (e.g. Cloud of Daggers).
 * @param {Activity} activity
 * @returns {boolean}
 */
export function isTriggerActivity(activity) {
    if (activity?.type === "save") return true;
    return (activity?.type === "damage") && !!activity.damage?.parts?.length;
}

/**
 * Find the activity the emanation uses when it triggers. In this order:
 *  1. a separate save with damage that uses no spell slot ("Emanation Save", "Per Turn Save"),
 *  2. a separate damage roll that uses no spell slot (Wall of Fire, Forbiddance),
 *  3. the activity that placed the area ("Cast and Save", Moonbeam, Grease, Cloud of Daggers),
 *  4. a separate save without damage that uses no spell slot (Stinking Cloud's "Start of Turn Save"),
 *  5. any other save or damage activity.
 * @param {Item5e} item
 * @param {Activity} [placingActivity]
 * @returns {Activity|null}
 */
export function resolveDamageActivity(item, placingActivity) {
    const candidates = Array.from(item?.system.activities ?? []).filter(isTriggerActivity);
    if (!candidates.length) return null;
    const named = getProfile(item).activityName;
    const byName = named ? candidates.find(a => named.test(a.name ?? "")) : null;
    if (byName) return byName;
    const separate = candidates.filter(a => (a.id !== placingActivity?.id) && !a.consumption?.spellSlot);
    const hasDamage = a => !!a.damage?.parts?.length;
    return separate.find(a => (a.type === "save") && hasDamage(a))
        ?? separate.find(a => a.type === "damage")
        ?? candidates.find(a => a.id === placingActivity?.id)
        ?? separate[0]
        ?? candidates[0];
}

/**
 * The activity an emanation behavior uses: its Damage Activity, otherwise the one resolved from
 * its Spell field (regions drawn by hand, e.g. Forbiddance).
 * @param {RegionBehavior} behavior
 * @returns {Activity|null}
 */
export function getBehaviorActivity(behavior) {
    const system = behavior?.system;
    if (!system) return null;
    if (system.activity) return _safeFromUuid(system.activity) ?? _recoverActivity(behavior);
    if (!system.spell) return null;
    const item = _safeFromUuid(system.spell);
    return item?.system?.activities ? resolveDamageActivity(item) : null;
}

/**
 * fromUuidSync without throwing on malformed or foreign UUIDs.
 * @param {string} uuid
 * @returns {foundry.abstract.Document|object|null}
 */
function _safeFromUuid(uuid) {
    if (!uuid || (typeof uuid !== "string")) return null;
    try {
        return fromUuidSync(uuid, { strict: false }) ?? null;
    } catch {
        return null;
    }
}

/** Behaviors whose activity was already repaired on this client. */
const _repairedBehaviors = new Set();

/**
 * Find the activity of a behavior whose stored activity is gone (the spell was removed and added back, or replaced by
 * another version): the region's item if it still exists, otherwise the caster's spell with the same identifier or
 * name (the caster from the region's origin token, else from the old activity's UUID). The behavior is repaired
 * when this client may change it (GM).
 * @param {RegionBehavior} behavior
 * @returns {Activity|null}
 */
function _recoverActivity(behavior) {
    const region = behavior.region;
    if (!region) return null;
    const info = region.getFlag(MODULE_ID, "emanationItem") ?? {};
    let item = _safeFromUuid(region.getFlag("dnd5e", "item"));
    if (!item?.system?.activities) {
        const oldUuid = behavior.system.activity;
        const actor = _safeFromUuid(region.getFlag("dnd5e", "origin"))?.actor
            ?? (oldUuid?.includes(".Item.") ? _safeFromUuid(oldUuid.split(".Item.")[0]) : null);
        const identifier = info.identifier;
        const name = String(info.name ?? "").toLowerCase();
        item = actor?.items?.find(i => (i.type === "spell")
            && ((identifier && (i.system?.identifier === identifier)) || (name && (i.name?.toLowerCase() === name)))) ?? null;
    }
    if (!item?.system?.activities) return null;

    // Several behaviors (Hunger of Hadar): the profile entry with the same triggers; otherwise the usual pick
    const own = Array.from(behavior.system.triggers ?? []).sort().join(",");
    const entry = getProfile(item).behaviors?.find(b => [...b.triggers].sort().join(",") === own);
    const activity = (entry ? Array.from(item.system.activities).find(a => entry.activityName.test(a.name ?? "")) : null)
        ?? resolveDamageActivity(item);
    if (!activity) return null;

    if (behavior.isOwner && !_repairedBehaviors.has(behavior.uuid)) {
        _repairedBehaviors.add(behavior.uuid);
        behavior.update({ "system.activity": activity.uuid })
            .then(() => debug(`Area Spells | Repaired "${region.name}": now uses ${item.name} (${activity.name})`))
            .catch(err => debug("Area Spells | Could not repair the behavior", err));
    }
    return activity;
}

/** Notices already shown on this client, by key. */
const _shownNotices = new Set();

/**
 * Show a warning once per client and key.
 * @param {string} key
 * @param {string} i18nKey
 * @param {object} data
 * @param {string} fallback
 */
export function notifyOnce(key, i18nKey, data, fallback) {
    if (_shownNotices.has(key)) return;
    _shownNotices.add(key);
    ui.notifications?.warn(game.i18n.has(i18nKey) ? game.i18n.format(i18nKey, data) : fallback);
}

/**
 * The events that trigger an emanation: the behavior's own Triggers, otherwise the spell's.
 * @param {RegionBehavior} behavior
 * @param {Item5e} item
 * @returns {Set<string>}
 */
export function getTriggers(behavior, item) {
    const own = behavior.system.triggers;
    if (own?.size) return own;
    const triggers = getProfile(item).triggers;
    return triggers ? new Set(triggers) : DEFAULT_TRIGGERS;
}

/**
 * Whether an item is on the Area Spells list (by identifier or slugified name).
 * @param {Item5e} item
 * @returns {boolean}
 */
export function isListedSpell(item) {
    if (!item) return false;
    const raw = getSetting("damageEmanationSpells");
    if (!raw || typeof raw !== "string") return false;
    const listed = new Set(raw.split(",").map(s => s.trim().slugify({ strict: true })).filter(Boolean));
    const identifier = item.system?.identifier || item.name?.slugify({ strict: true });
    return listed.has(identifier) || listed.has(item.name?.slugify({ strict: true }));
}

/**
 * Whether the activity already carries the Area Spell Trigger activity behavior,
 * in which case dnd5e creates the region behavior itself.
 * @param {Activity} activity
 * @returns {boolean}
 */
export function hasActivityBehavior(activity) {
    // Only behaviors whose level range matches the cast, the same ones dnd5e turns into region behaviors
    return Array.from(activity?.applicableBehaviors ?? []).some(b => b.type === ACTIVITY_BEHAVIOR_TYPE);
}

/**
 * The Area Spell Trigger behaviors of a region.
 * @param {RegionDocument} region
 * @returns {RegionBehavior[]}
 */
export function getEmanationBehaviors(region) {
    return Array.from(region?.behaviors ?? []).filter(b => b.type === DAMAGE_EMANATION_BEHAVIOR_TYPE);
}

/**
 * The caster's concentration effect for an item.
 * @param {Actor5e} actor
 * @param {Item5e} item
 * @returns {ActiveEffect5e|null}
 */
export function getConcentrationEffect(actor, item) {
    if (!actor || !item) return null;
    const status = CONFIG.specialStatusEffects.CONCENTRATING;
    return actor.effects.find(e => e.statuses?.has(status) && (e.getFlag("dnd5e", "item")?.id === item.id)) ?? null;
}

/**
 * Whether the caster is still concentrating on the spell, if the spell needs concentration.
 * @param {Activity} activity
 * @returns {boolean}
 */
export function isSpellStillActive(activity) {
    const { actor, item } = activity;
    if (!item?.system.properties?.has("concentration")) return true;
    if (game.settings.get("dnd5e", "disableConcentration")) return true;
    if (!(actor?.system.attributes?.concentration?.limit > 0)) return true;
    return !!getConcentrationEffect(actor, item);
}
