/**
 * Feature: Level Change Resources
 * Description: Keeps current HP, spell slots, Hit Dice and limited uses correct when a character gains or loses
 * levels: new resources are available, expended ones stay expended, and damage taken stays.
 *
 * @introduced v14.109.0
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";

/**
 * Level Change Resources
 *
 * dnd5e 6.0.6 and 6.1.0 (upstream: foundryvtt/dnd5e#5101, open, no fixed version):
 * - Spell slots store what remains, so a higher maximum leaves new slots expended, and a lower one leaves surplus
 *   regular slots that the sheet shows as temporary.
 * - HP advancement moves current HP by the level's own HP only. Retroactive gains (Constitution, Tough) raise the
 *   maximum alone, and a lost level can take a creature to 0 HP.
 * - Hit Dice and limited uses store what was spent, and nothing trims that when the maximum drops.
 *
 * The state before and after the change is compared, so every source of a changed maximum is covered:
 * - Advancement manager: dnd5e.preAdvancementManagerComplete, corrections go into the manager's own single update.
 * - Direct changes (advancements disabled, a level change with no steps, a class added or removed without the
 *   manager): state is remembered in the pre-hook and corrected after the update.
 *
 * Slots are skipped automatically if dnd5e stops storing `value` in the source, which is the upstream fix proposed
 * in #5101 (a `spent` field), so the two can't stack.
 */

/** Item types whose presence or level changes an actor's level-based resources. */
const LEVEL_ITEM_TYPES = new Set(["class", "subclass"]);

/** A remembered state older than this belongs to an update that never completed. */
const SNAPSHOT_TTL_MS = 5000;

/** Delay after an update, so the several item hooks of one batch lead to a single correction. */
const SETTLE_MS = 50;

/**
 * Remembered states for direct changes, by actor UUID.
 * @type {Map<string, {before: object, at: number, timer: number|null}>}
 */
const _pending = new Map();

/* -------------------------------------------- */
/*  Calculations                                */
/* -------------------------------------------- */

/**
 * Current HP after a maximum change: damage taken stays. Losing a level never drops a conscious creature to 0.
 * @param {number} value
 * @param {number} oldMax
 * @param {number} newMax
 * @returns {number}
 */
function _adjustHp(value, oldMax, newMax) {
    const floor = value > 0 ? 1 : 0;
    return Math.min(Math.max(value + newMax - oldMax, floor), Math.max(newMax, 0));
}

/**
 * Remaining slots after a maximum change. New slots are available, lost slots come out of the expended ones first,
 * and temporary slots above the old maximum are kept.
 * @param {number} value
 * @param {number} oldMax
 * @param {number} newMax
 * @returns {number}
 */
function _adjustSlots(value, oldMax, newMax) {
    const temporary = Math.max(value - oldMax, 0);
    const regular = value - temporary;
    return Math.min(regular + Math.max(newMax - oldMax, 0), newMax) + temporary;
}

/**
 * Spent count after a maximum change. Lost uses come out of the spent ones first, matching spell slots.
 * @param {number} spent
 * @param {number} oldMax
 * @param {number} newMax
 * @returns {number}
 */
function _adjustSpent(spent, oldMax, newMax) {
    if (newMax < oldMax) return newMax - Math.min(Math.max(oldMax - spent, 0), newMax);
    return Math.min(spent, oldMax);
}

/**
 * @param {*} value
 * @returns {boolean}  Whether the value is a real number (uses.max can be an empty string).
 */
function _isNumber(value) {
    return (value !== "") && (value !== null) && (value !== undefined) && Number.isFinite(Number(value));
}

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

/**
 * @param {Item5e} item
 * @returns {Object<string, {spent: number, max: number}>}  The item's spent-based pools by update path.
 */
function _capturePools(item) {
    const pools = {};
    const add = (path, data) => {
        if (_isNumber(data?.spent) && _isNumber(data?.max)) {
            pools[path] = { spent: Number(data.spent), max: Number(data.max) };
        }
    };
    if (item.type === "class") add("system.hd.spent", item.system.hd);
    add("system.uses.spent", item.system.uses);
    for (const activity of item.system.activities?.contents ?? []) {
        add(`system.activities.${activity.id}.uses.spent`, activity.uses);
    }
    return pools;
}

/**
 * @param {Actor5e} actor  A prepared actor.
 * @returns {object}       The level-dependent resources of the actor.
 */
function _captureState(actor) {
    const source = actor._source.system;
    const state = { hp: null, slots: {}, actorPools: {}, items: new Map() };

    const hp = actor.system.attributes?.hp;
    if (hp && Number.isFinite(hp.effectiveMax)) {
        state.hp = { value: hp.value ?? 0, max: hp.effectiveMax, source: source.attributes?.hp?.value ?? 0 };
    }

    for (const [key, slot] of Object.entries(actor.system.spells ?? {})) {
        const stored = source.spells?.[key];
        // Slots dnd5e prepared but never stored count as 0; a stored entry without `value` means a changed schema
        if (stored && !("value" in stored)) continue;
        state.slots[key] = { value: slot.value ?? 0, max: slot.max ?? 0, source: stored?.value ?? 0 };
    }

    // NPCs keep Hit Dice on the actor
    const hd = actor.system.attributes?.hd;
    if (_isNumber(source.attributes?.hd?.spent) && _isNumber(hd?.max)) {
        state.actorPools["system.attributes.hd.spent"] = { spent: Number(source.attributes.hd.spent), max: Number(hd.max) };
    }

    for (const item of actor.items) {
        const pools = _capturePools(item);
        if (!foundry.utils.isEmpty(pools)) state.items.set(item.id, pools);
    }
    return state;
}

/**
 * @param {Object<string, {spent: number, max: number}>} before
 * @param {Object<string, {spent: number, max: number}>} after
 * @returns {Object<string, number>}  Changed spent values by update path.
 */
function _diffPools(before, after) {
    const changes = {};
    for (const [path, pool] of Object.entries(after)) {
        const old = before[path];
        if (!old || (old.max === pool.max)) continue;
        const spent = _adjustSpent(old.spent, old.max, pool.max);
        if (spent !== pool.spent) changes[path] = spent;
    }
    return changes;
}

/**
 * @param {object} before  State before the level change.
 * @param {object} after   State after the level change.
 * @returns {{actor: Object<string, number>, items: Map<string, Object<string, number>>}}
 */
function _computeCorrections(before, after) {
    const actor = _diffPools(before.actorPools, after.actorPools);

    if (before.hp && after.hp) {
        const value = _adjustHp(before.hp.value, before.hp.max, after.hp.max);
        if (value !== after.hp.source) actor["system.attributes.hp.value"] = value;
    }

    for (const [key, slot] of Object.entries(after.slots)) {
        const old = before.slots[key];
        if (!old || (old.max === slot.max)) continue;
        const value = _adjustSlots(old.value, old.max, slot.max);
        if (value !== slot.source) actor[`system.spells.${key}.value`] = value;
    }

    const items = new Map();
    for (const [id, pools] of after.items) {
        const changes = _diffPools(before.items.get(id) ?? {}, pools);
        if (!foundry.utils.isEmpty(changes)) items.set(id, changes);
    }
    return { actor, items };
}

/* -------------------------------------------- */
/*  Advancement Manager                         */
/* -------------------------------------------- */

/**
 * Must never return false: that would cancel the level-up.
 * @param {AdvancementManager} manager
 * @param {object} actorUpdates  The actor's full source, about to be saved.
 * @param {object[]} toCreate
 * @param {object[]} toUpdate    Item sources, about to be saved.
 */
function _onPreAdvancementComplete(manager, actorUpdates, toCreate, toUpdate) {
    if (!getSetting("enableLevelChangeResources")) return;
    try {
        const { actor, items } = _computeCorrections(_captureState(manager.actor), _captureState(manager.clone));
        for (const [path, value] of Object.entries(actor)) foundry.utils.setProperty(actorUpdates, path, value);
        for (const itemSource of toUpdate) {
            for (const [path, value] of Object.entries(items.get(itemSource._id) ?? {})) {
                foundry.utils.setProperty(itemSource, path, value);
            }
        }
        debug(`Level Change Resources | ${manager.actor.name}`, actor, items);
    } catch (err) {
        console.error(`${MODULE_ID} | Level Change Resources: ${manager.actor?.name} failed`, err);
    }
}

/* -------------------------------------------- */
/*  Direct Changes                              */
/* -------------------------------------------- */

/**
 * @param {Item5e} item
 * @param {object} options
 * @returns {boolean}  Whether this item operation is a level change outside the advancement manager.
 */
function _isDirectChange(item, options) {
    return LEVEL_ITEM_TYPES.has(item.type) && (item.parent?.documentName === "Actor") && !options?.isAdvancement;
}

/**
 * @param {Item5e} item
 * @param {object} options
 */
function _remember(item, options) {
    if (!_isDirectChange(item, options) || !getSetting("enableLevelChangeResources")) return;
    const actor = item.parent;
    const entry = _pending.get(actor.uuid);
    if (entry && ((Date.now() - entry.at) <= SNAPSHOT_TTL_MS)) return;
    if (entry?.timer) clearTimeout(entry.timer);
    try {
        _pending.set(actor.uuid, { before: _captureState(actor), at: Date.now(), timer: null });
    } catch (err) {
        console.error(`${MODULE_ID} | Level Change Resources: ${actor.name} failed`, err);
    }
}

/**
 * @param {Actor5e} actor
 * @returns {Promise<void>}
 */
async function _applyDirect(actor) {
    const entry = _pending.get(actor.uuid);
    if (!entry) return;
    _pending.delete(actor.uuid);
    try {
        const { actor: actorChanges, items } = _computeCorrections(entry.before, _captureState(actor));
        const item = Array.from(items, ([_id, changes]) => ({ _id, ...changes }));
        if (foundry.utils.isEmpty(actorChanges) && !item.length) return;
        debug(`Level Change Resources | ${actor.name}`, actorChanges, item);
        // isAdvancement: a level change is not damage or healing (no concentration save, no scrolling numbers)
        await actor.performBulkUpdate({ actor: actorChanges, item }, { isAdvancement: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Level Change Resources: ${actor.name} failed`, err);
    }
}

/**
 * @param {Item5e} item
 * @param {object} options
 * @param {string} userId
 */
function _settle(item, options, userId) {
    if ((userId !== game.user.id) || !_isDirectChange(item, options)) return;
    const actor = item.parent;
    const entry = _pending.get(actor.uuid);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => _applyDirect(actor), SETTLE_MS);
}

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

export function initLevelChangeResources() {
    Hooks.on("dnd5e.preAdvancementManagerComplete", _onPreAdvancementComplete);

    Hooks.on("preUpdateItem", (item, changes, options) => {
        if (foundry.utils.hasProperty(changes, "system.levels")) _remember(item, options);
    });
    Hooks.on("preCreateItem", (item, data, options) => _remember(item, options));
    Hooks.on("preDeleteItem", (item, options) => _remember(item, options));

    Hooks.on("updateItem", (item, changes, options, userId) => {
        if (foundry.utils.hasProperty(changes, "system.levels")) _settle(item, options, userId);
    });
    Hooks.on("createItem", _settle);
    Hooks.on("deleteItem", _settle);
    debug("Level Change Resources | Initialized");
}
