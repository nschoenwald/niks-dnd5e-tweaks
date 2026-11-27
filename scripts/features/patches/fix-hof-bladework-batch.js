/**
 * Feature: Heroes of Faerûn Bladework Batching Patch
 * Description: Turning Bladesong on or off no longer stalls the game. Heroes of Faerûn's Bladework enchantments are
 * added to (and removed from) all of the Bladesinger's weapons in one request instead of one per weapon.
 *
 * @introduced v14.116.1
 */
import { MODULE_ID, log, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Bladesong Hitches
 * ---------------------------------------------------------------------------
 * Heroes of Faerûn (2.0.1, `scripts/automation/bladesong.mjs`) enchants every weapon the Bladesinger is proficient
 * with when Bladesong starts, and removes the enchantments when it ends:
 *   for (const item of actor.itemTypes.weapon) await item.createEmbeddedDocuments("ActiveEffect", [data], {keepId});
 *   for (const item of actor.itemTypes.weapon) await item.effects.get(staticID)?.delete();
 * Each awaited call is its own server round trip, and on every connected client each one re-prepares the whole actor
 * (`Actor#_onCreateDescendantDocuments` calls `reset()` for effects on items), re-renders the character sheet and
 * refreshes its tokens. A Bladesinger with eight weapons triggers eight of each, one after another.
 *
 * The first call of such a loop is intercepted and does the work for all of the actor's weapons in one
 * `foundry.documents.modifyBatch` request (one operation per weapon, same data, same filter as HoF). HoF's loop then
 * finds the enchantment already there (`item.effects.has(staticID)`) or already gone (`get` returns undefined) and
 * skips the rest. Every operation but the last carries `render: false` and a defer flag, so each client renders the
 * sheet and re-prepares the actor once, when the last operation arrives (the options travel with the operation to
 * every client). Hooks still fire per enchantment.
 *
 * Deleting a single Bladework enchantment by hand (its origin Bladesong still on) isn't batched. If the batch fails,
 * the single call HoF made runs as before. Not fixed upstream yet (HoF 2.0.1), so not version-gated.
 */
const HOF_ID = "dnd-heroes-faerun";
/** Option on all batched operations but the last: skip the actor's re-preparation for that one. */
const DEFER_RESET = `${MODULE_ID}DeferReset`;

/** HoF's static enchantment id, `dnd5e.utils.staticID("HoFBladework")`. */
let _staticId = null;
/** Set while a batch is being built, so its own dry runs and calls aren't intercepted again. */
let _batching = false;

/**
 * The weapons HoF would enchant: proficient, without the enchantment yet.
 * @param {Actor5e} actor
 * @returns {Item5e[]}
 */
function _weaponsToEnchant(actor) {
    return (actor.itemTypes?.weapon ?? []).filter(item => (item.system?.proficiencyMultiplier >= 1)
        && !item.effects.has(_staticId));
}

/**
 * Batch operations for one action across several parents. All but the last skip rendering and the actor's reset.
 * @param {object[]} entries  `{parent, ...operationData}` per parent
 * @param {string} action
 * @returns {object[]}
 */
function _operations(entries, action) {
    return entries.map((entry, index) => {
        const last = index === entries.length - 1;
        return { action, documentName: "ActiveEffect", ...entry, render: last, ...(last ? {} : { [DEFER_RESET]: true }) };
    });
}

/**
 * Wrapper for Item#createEmbeddedDocuments: HoF's first Bladework creation enchants all weapons at once.
 * @param {Function} wrapped
 * @param {string} embeddedName
 * @param {object[]} data
 * @param {object} [operation]
 * @returns {Promise<Document[]>}
 */
async function _wrapCreateEmbedded(wrapped, embeddedName, data = [], operation = {}, ...rest) {
    const actor = this.actor;
    if (_batching || (embeddedName !== "ActiveEffect") || (data.length !== 1) || (data[0]?._id !== _staticId)
        || !operation?.keepId || !actor || (this.type !== "weapon")) {
        return wrapped(embeddedName, data, operation, ...rest);
    }
    const weapons = _weaponsToEnchant(actor);
    if ((weapons.length < 2) || !weapons.includes(this)) return wrapped(embeddedName, data, operation, ...rest);

    // This item last: its result is what HoF awaits
    weapons.splice(weapons.indexOf(this), 1);
    weapons.push(this);
    _batching = true;
    try {
        const ops = _operations(weapons.map(parent => ({
            parent, data: [foundry.utils.deepClone(data[0])], keepId: true
        })), "create");
        const results = await foundry.documents.modifyBatch(ops);
        debug(`Fix: Bladework Batching | Enchanted ${weapons.length} weapons of ${actor.name} in one request`);
        return results.at(-1) ?? [];
    } catch (err) {
        debug("Fix: Bladework Batching | Batch failed, falling back to one weapon", err);
    } finally {
        _batching = false;
    }
    return this.effects.has(_staticId) ? [this.effects.get(_staticId)] : wrapped(embeddedName, data, operation, ...rest);
}

/**
 * Whether a Bladework enchantment is being removed because its Bladesong ended (origin disabled or gone).
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _bladesongEnded(effect) {
    if (!effect.origin) return false;
    const origin = fromUuidSync(effect.origin, { strict: false });
    return !origin || (origin.disabled === true);
}

/**
 * Wrapper for ActiveEffect#delete: HoF's first Bladework deletion removes it from all weapons at once.
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {Promise<ActiveEffect5e|undefined>}
 */
async function _wrapDelete(wrapped, ...args) {
    const item = this.parent;
    const actor = item?.actor;
    if (_batching || (this.id !== _staticId) || !(item instanceof Item) || !actor || !_bladesongEnded(this)) {
        return wrapped(...args);
    }
    const items = actor.items.filter(i => i.effects.has(_staticId));
    if ((items.length < 2) || !items.includes(item)) return wrapped(...args);

    items.splice(items.indexOf(item), 1);
    items.push(item);
    _batching = true;
    try {
        const results = await foundry.documents.modifyBatch(_operations(items.map(parent => ({
            parent, ids: [_staticId]
        })), "delete"));
        debug(`Fix: Bladework Batching | Removed Bladework from ${items.length} weapons of ${actor.name} in one request`);
        return results.at(-1)?.[0] ?? this;
    } catch (err) {
        debug("Fix: Bladework Batching | Batch failed, falling back to one weapon", err);
    } finally {
        _batching = false;
    }
    return item.effects.has(_staticId) ? wrapped(...args) : this;
}

/**
 * Wrapper for Actor#_onCreateDescendantDocuments / _onDeleteDescendantDocuments: skip the actor's reset for batched
 * operations that another one follows. The last operation resets it with all changes in place.
 * @param {Function} wrapped
 * @param {...*} args  (parent, collection, documents, data|ids, options, userId)
 * @returns {*}
 */
function _wrapDescendantEvent(wrapped, ...args) {
    if (!args[4]?.[DEFER_RESET] || !(args[0] instanceof Item)) return wrapped(...args);
    const actor = this;
    actor.reset = () => {};
    try {
        return wrapped(...args);
    } finally {
        delete actor.reset;
    }
}

export function initFixHofBladeworkBatch() {
    // Every client applies the deferred resets, so these run whether or not HoF is active here
    patchMethod("CONFIG.Actor.documentClass.prototype._onCreateDescendantDocuments", _wrapDescendantEvent, "WRAPPER");
    patchMethod("CONFIG.Actor.documentClass.prototype._onDeleteDescendantDocuments", _wrapDescendantEvent, "WRAPPER");
    if (!game.modules.get(HOF_ID)?.active) return;
    _staticId = dnd5e.utils.staticID("HoFBladework");
    patchMethod("CONFIG.Item.documentClass.prototype.createEmbeddedDocuments", _wrapCreateEmbedded, "WRAPPER");
    patchMethod("CONFIG.ActiveEffect.documentClass.prototype.delete", _wrapDelete, "WRAPPER");
    log("Fix: Bladework Batching | Patched Heroes of Faerûn's Bladework enchantments to apply in one request.");
}
