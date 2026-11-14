/**
 * Feature: Companion Level Sync
 * Description: When a summoner levels up or changes an ability score, their linked companions summoned by a
 * feature (Primal Companion, …) get their summon bonuses worked out again, keeping damage already taken.
 * Linked summons also arrive at full HP.
 *
 * @introduced v14.87.0
 * @updated v14.87.0 (Summon at Full HP)
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";

/**
 * Companion Level Sync
 *
 * dnd5e's SummonActivity#getChanges evaluates the activity's bonuses (AC, HD, HP, damage, matched proficiency,
 * attack and save) once, at summon time, and stores the results as fixed numbers in effects with static IDs.
 * Nothing updates them when the summoner changes, so a Beast Master's companion keeps its old stats until it is
 * summoned again (dnd5e 6.0.6 and 6.1.0).
 *
 * This feature calls getChanges again for each linked companion and applies only the parts that depend on the
 * summoner:
 * - actor effects with dnd5e's static IDs are updated, created (a bonus that used to be 0) or deleted (a bonus
 *   that is now 0);
 * - the activity's applied effects are updated if the companion still has them (never re-created);
 * - each item's "dnd5eItemChanges" enchantment is updated directly. getTokenData would send the item's whole
 *   effect list with the new copy in front of the old one, both with the same ID;
 * - flags.dnd5e.summon (level, mod) is updated;
 * - current HP moves by the same amount as max HP, so damage taken stays.
 *
 * Spell summons are skipped: their bonuses use @item.level, the level the spell was cast at, which only exists
 * during the cast. Outside it the item's base level would downgrade an upcast summon.
 *
 * Left alone: temp HP (would be granted again), size and type (chosen at summon time), flat AC (getChanges adds the
 * bonus onto the current flat value, which already contains the old bonus) and bonuses that roll dice.
 *
 * dnd5e's summon registry only tracks token actors, so linked companions are found in game.actors by their
 * flags.dnd5e.summon.origin, which is the UUID of the summoner's item.
 *
 * Summon at Full HP (separate setting): for linked actors, getTokenData raises max HP with an effect but never
 * touches current HP, so a Primal Companion imported at 5 / 5 arrives at 5 / 20 and a re-summoned one keeps the
 * damage of its last outing. Unlinked summons get bonus HP added to both and start fresh. dnd5e.postSummon fires on
 * the summoning client after the tokens exist; each linked summon is set to its max HP and loses Dead and
 * Unconscious. Applies to spell summons too: each summon is a new creature (or a new casting).
 */

const STATIC = {
    proficiency: "dnd5eMatchProficiency",
    ac: "dnd5eACBonus",
    hd: "dnd5eHDBonus",
    hp: "dnd5eHPBonus",
    damage: "dnd5eDamageChanges",
    items: "dnd5eItemChanges"
};

/** Delay before syncing, so the several hooks of one level-up lead to a single sync. */
const DEBOUNCE_MS = 500;

/**
 * Pending syncs by summoner UUID.
 * @type {Map<string, number>}
 */
const _pending = new Map();

const staticID = id => dnd5e.utils.staticID(id);

/**
 * Linked world actors summoned by one of this actor's items.
 * @param {Actor5e} summoner
 * @returns {Actor5e[]}
 */
function _linkedCompanions(summoner) {
    const prefix = `${summoner.uuid}.Item.`;
    return game.actors.filter(a => {
        if (a === summoner || !a.prototypeToken?.actorLink) return false;
        const origin = a.getFlag("dnd5e", "summon.origin");
        return (typeof origin === "string") && origin.startsWith(prefix);
    });
}

/**
 * Queue a sync for a summoner.
 * @param {Actor5e} actor
 */
function _schedule(actor) {
    if (!actor || (actor.documentName !== "Actor") || actor.isToken) return;
    if (!getSetting("enableCompanionLevelSync")) return;
    const key = actor.uuid;
    clearTimeout(_pending.get(key));
    _pending.set(key, setTimeout(() => {
        _pending.delete(key);
        syncCompanions(actor).catch(err => console.error(`${MODULE_ID} | Companion Level Sync failed`, err));
    }, DEBOUNCE_MS));
}

/**
 * Whether a bonus formula of the activity rolls dice with the given roll data.
 * @param {string} formula
 * @param {object} rollData
 * @returns {boolean}
 */
function _rollsDice(formula, rollData) {
    if (!formula) return false;
    try {
        return !new Roll(formula, rollData).isDeterministic;
    } catch {
        return true;
    }
}

/**
 * Work out a companion's summon bonuses again and apply them.
 * @param {Actor5e} summoner
 * @returns {Promise<void>}
 */
export async function syncCompanions(summoner) {
    for (const companion of _linkedCompanions(summoner)) {
        try {
            await _syncCompanion(summoner, companion);
        } catch (err) {
            console.error(`${MODULE_ID} | Companion Level Sync: ${companion.name} failed`, err);
        }
    }
}

/**
 * @param {Actor5e} summoner
 * @param {Actor5e} companion
 * @returns {Promise<void>}
 */
async function _syncCompanion(summoner, companion) {
    if (!companion.isOwner) {
        debug(`Companion Level Sync | ${companion.name}: not owned by this user, skipped`);
        return;
    }
    const flags = companion.getFlag("dnd5e", "summon") ?? {};
    const item = fromUuidSync(flags.origin);
    const activity = item?.system?.activities?.get?.(flags.activity);
    const profile = activity?.profiles?.find(p => p._id === flags.profile);
    if (item?.type === "spell") {
        debug(`Companion Level Sync | ${companion.name}: summoned by a spell, skipped`);
        return;
    }
    if (!activity || (activity.type !== "summon") || !profile) {
        debug(`Companion Level Sync | ${companion.name}: summon activity or profile not found, skipped`);
        return;
    }

    const { actorUpdates } = await activity.getChanges(companion, profile, {
        creatureSize: companion.system.traits?.size,
        creatureType: companion.system.details?.type?.value
    });

    // Bonuses that roll dice would be rolled again: keep their current effects
    const rollData = { ...activity.getRollData(), summon: companion.getRollData() };
    const keep = new Set();
    for (const field of ["ac", "hd", "hp"]) {
        if (_rollsDice(activity.bonuses?.[field], rollData)) keep.add(staticID(STATIC[field]));
    }
    // Flat AC: getChanges adds onto the current flat value, which already holds the old bonus
    const flatAC = companion.system.attributes?.ac?.calc === "flat";

    // Actor effects
    const managed = ["proficiency", "ac", "hd", "hp", "damage"].map(k => staticID(STATIC[k]));
    const newEffects = (actorUpdates.effects ?? []).filter(e => !keep.has(e._id));
    const toUpdate = [];
    const toCreate = [];
    for (const data of newEffects) {
        const existing = companion.effects.get(data._id);
        if (existing) {
            toUpdate.push({ _id: data._id, system: { changes: data.system?.changes ?? data.changes ?? [] } });
        } else if (managed.includes(data._id)) {
            toCreate.push(data);
        }
        // Applied effects the companion no longer has stay removed
    }
    const newIds = new Set(newEffects.map(e => e._id));
    const toDelete = managed.filter(id => !keep.has(id) && !newIds.has(id) && companion.effects.has(id)
        // A flat-AC companion never had an AC effect from dnd5e
        && !(flatAC && id === staticID(STATIC.ac)));

    // Item enchantments
    const itemEffectId = staticID(STATIC.items);
    const itemOps = [];
    for (const entry of actorUpdates.items ?? []) {
        const data = entry.effects?.find(e => e._id === itemEffectId);
        const target = data && companion.items.get(entry._id);
        if (!target) continue;
        const changes = data.system?.changes ?? data.changes ?? [];
        if (target.effects.has(itemEffectId)) {
            itemOps.push({ action: "update", documentName: "ActiveEffect", parent: target,
                updates: [{ _id: itemEffectId, system: { changes } }] });
        } else {
            itemOps.push({ action: "create", documentName: "ActiveEffect", parent: target, data: [data], keepId: true });
        }
    }

    const oldMax = companion.system.attributes.hp.max;
    const oldLevel = flags.level;
    const summonFlags = actorUpdates["flags.dnd5e.summon"];

    const ops = [
        { action: "update", documentName: "Actor", updates: [{ _id: companion.id, "flags.dnd5e.summon": summonFlags }] },
        { action: "update", documentName: "ActiveEffect", parent: companion, updates: toUpdate },
        { action: "create", documentName: "ActiveEffect", parent: companion, data: toCreate, keepId: true },
        { action: "delete", documentName: "ActiveEffect", parent: companion, ids: toDelete },
        ...itemOps
    ].filter(op => (op.updates ?? op.data ?? op.ids).length);
    await foundry.documents.modifyBatch(ops);

    // Keep damage taken: move current HP by the change in max HP
    const hp = companion.system.attributes.hp;
    const delta = hp.max - oldMax;
    if (delta && (hp.value > 0)) {
        await companion.update({ "system.attributes.hp.value": Math.clamp(hp.value + delta, 0, hp.max) });
    }

    debug(`Companion Level Sync | ${companion.name}: level ${oldLevel} → ${summonFlags?.level}, max HP ${oldMax} → ${hp.max}`,
        { toUpdate, toCreate, toDelete, itemOps, kept: [...keep], flatAC });
    if (oldLevel !== summonFlags?.level || delta) {
        ui.notifications.info(game.i18n.format("ND5T.CompanionLevelSync.Updated", {
            companion: companion.name, summoner: summoner.name
        }));
    }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * @param {AdvancementManager} manager
 */
function _onAdvancementComplete(manager) {
    _schedule(manager.actor);
}

/**
 * @param {Item5e} item
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
function _onUpdateItem(item, changes, options, userId) {
    if (userId !== game.user.id) return;
    if (!["class", "subclass"].includes(item.type)) return;
    if (!foundry.utils.hasProperty(changes, "system.levels")) return;
    _schedule(item.parent);
}

/**
 * @param {Actor5e} actor
 * @param {object} changes
 * @param {object} options
 * @param {string} userId
 */
function _onUpdateActor(actor, changes, options, userId) {
    if (userId !== game.user.id) return;
    if (!foundry.utils.hasProperty(changes, "system.abilities")
        && !foundry.utils.hasProperty(changes, "system.details.level")) return;
    _schedule(actor);
}

/**
 * Class items added or removed (multiclassing, or a class dropped onto the sheet).
 * @param {Item5e} item
 * @param {object} options
 * @param {string} userId
 */
function _onCreateOrDeleteItem(item, options, userId) {
    if (userId !== game.user.id) return;
    if (!["class", "subclass"].includes(item.type)) return;
    _schedule(item.parent);
}

/**
 * Summon at Full HP.
 * @param {SummonActivity} activity
 * @param {object} profile
 * @param {TokenDocument[]} tokens
 */
async function _onPostSummon(activity, profile, tokens) {
    if (!getSetting("enableSummonFullHp")) return;
    const actors = new Set((tokens ?? []).filter(t => t?.actorLink && t.actor?.isOwner).map(t => t.actor));
    for (const actor of actors) {
        try {
            const hp = actor.system.attributes?.hp;
            if (hp && (hp.value < hp.max)) {
                debug(`Summon at Full HP | ${actor.name}: ${hp.value} → ${hp.max}`);
                await actor.update({ "system.attributes.hp.value": hp.max });
            }
            for (const status of ["dead", "unconscious"]) {
                if (actor.statuses.has(status)) await actor.toggleStatusEffect(status, { active: false });
            }
        } catch (err) {
            console.error(`${MODULE_ID} | Summon at Full HP: ${actor.name} failed`, err);
        }
    }
}

export function initCompanionLevelSync() {
    Hooks.on("dnd5e.postSummon", _onPostSummon);
    Hooks.on("dnd5e.advancementManagerComplete", _onAdvancementComplete);
    Hooks.on("updateItem", _onUpdateItem);
    Hooks.on("createItem", _onCreateOrDeleteItem);
    Hooks.on("deleteItem", _onCreateOrDeleteItem);
    Hooks.on("updateActor", _onUpdateActor);
    debug("Companion Level Sync | Initialized");
}
