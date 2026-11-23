/**
 * Feature: Summon Initiative
 * Description: Summoned creatures whose rules say they act with their summoner use the summoner's initiative, take
 * their turn directly after them and never roll their own.
 *
 * @introduced v14.110.0
 *
 * Who follows (`getSummonLeader`): a combatant whose actor has `flags.dnd5e.summon.origin` pointing at an item whose
 * identifier is in the `summonInitiativeItems` list, while the item's owner is in the same combat. dnd5e keeps that
 * flag on the actor, so summons made before the combat count the same as summons made during it. The result is worked
 * out from document data on every client, so nothing has to be stored per combatant. Not followed: members of core
 * combatant groups (their initiative belongs to the group), unlinked summoners with several copies in the combat
 * (the summoner can't be told apart) and creatures released by a manual edit.
 *
 * Turn order: dnd5e breaks initiative ties by actor name, so an equal number isn't enough. `setupTurns` is wrapped to
 * move each follower directly after its leader. `_sortCombatants` isn't wrapped because core passes it to
 * Array#sort unbound. Fractional initiatives aren't used: they would collide with the Dexterity tiebreaker decimals
 * and with the integer grouping of the tracker and of Legendary Action Placeholders.
 *
 * Rolling: `Combat#rollInitiative` (tracker d20, Roll All, Roll NPCs, encounter placement, Actor#rollInitiative) drops
 * followers, `Actor#rollInitiativeDialog` (sheet and token HUD) stops before its dialog, and the tracker shows a link
 * icon instead of the d20. midi-qol's per-round reroll writes straight into the Combat update, so followers are
 * corrected right after it.
 *
 * Manual override: a GM typing a different number releases the creature (flag `summonInitiativeReleased`), so it stays
 * where it was put and can roll. Resetting its initiative makes it follow again.
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/** Official items whose rules place the creature with its summoner's initiative or turn. */
export const DEFAULT_SUMMON_INITIATIVE_ITEMS = [
    "animate-objects", "axe-of-the-dwarvish-lords", "baba-yagas-dancing-broom", "bag-of-tricks",
    "blessing-earthen-ring", "blue-elemental-gem", "bowl-of-commanding-water-elementals",
    "brazier-of-commanding-fire-elementals", "censer-of-controlling-air-elementals", "domestic-wonder",
    "elemental-gem", "emerald-elemental-gem", "find-steed", "giant-insect", "homunculus-servant", "primal-companion",
    "reanimated-companion", "red-elemental-gem", "staff-of-the-python", "steel-defender",
    "stone-of-controlling-earth-elementals", "summon-aberration", "summon-beast", "summon-celestial",
    "summon-construct", "summon-dinosaur", "summon-dragon", "summon-elemental", "summon-fey", "summon-fiend",
    "summon-plant", "summon-undead", "vestige-companion", "yellow-elemental-gem"
].join(", ");

const RELEASED_FLAG = "summonInitiativeReleased";
const SYNC_OPTION = "nd5tSummonInitiative";

let _listSource = null;
let _listIds = new Set();

/** @type {Set<Combat>} Combats waiting for a sync. */
const _pendingSyncs = new Set();
let _syncChain = Promise.resolve();

/**
 * The configured item identifiers.
 * @returns {Set<string>}
 */
function _followerItems() {
    const source = getSetting("summonInitiativeItems") ?? "";
    if (source !== _listSource) {
        _listSource = source;
        _listIds = new Set(String(source).split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
    }
    return _listIds;
}

/**
 * Whether a combatant can take part as a summoner or follower at all.
 * @param {Combatant} combatant
 * @returns {boolean}
 */
function _isEligible(combatant) {
    return Boolean(combatant?.actor) && !combatant.group && !combatant.getFlag(MODULE_ID, "isLegendaryPlaceholder");
}

/**
 * The combatant this summoned creature acts after, if any.
 * @param {Combatant} combatant
 * @returns {Combatant|null}
 */
export function getSummonLeader(combatant) {
    if (!getSetting("enableSummonInitiative") || !_isEligible(combatant)) return null;
    if (combatant.getFlag(MODULE_ID, RELEASED_FLAG)) return null;

    const origin = combatant.actor.getFlag("dnd5e", "summon.origin");
    if (typeof origin !== "string") return null;

    let item;
    try {
        item = fromUuidSync(origin, { strict: false });
    } catch {
        return null;
    }
    if (item?.documentName !== "Item" || !_followerItems().has(item.identifier?.toLowerCase())) return null;

    const summoner = item.actor;
    if (!summoner || summoner === combatant.actor) return null;

    const others = combatant.parent.combatants.contents
        .filter(c => (c.id !== combatant.id) && _isEligible(c))
        .sort((a, b) => a.id.localeCompare(b.id));

    // Linked summoner, or the exact token whose item made the summon
    const exact = others.find(c => c.actor?.uuid === summoner.uuid);
    if (exact) return exact;

    // Item on the world actor, summoner on the scene as an unlinked token: only a single copy is unambiguous
    if (summoner.isToken) return null;
    const copies = others.filter(c => (c.actorId === summoner.id) && !c.token?.actorLink);
    return copies.length === 1 ? copies[0] : null;
}

/**
 * Put every follower directly after its leader, keeping the order otherwise.
 * @param {Combatant[]} turns
 * @returns {Combatant[]}
 */
export function orderSummonTurns(turns) {
    const leaders = new Map();
    const followers = new Map();
    for (const combatant of turns) {
        const leader = getSummonLeader(combatant);
        if (!leader) continue;
        leaders.set(combatant.id, leader.id);
        if (!followers.has(leader.id)) followers.set(leader.id, []);
        followers.get(leader.id).push(combatant);
    }
    if (!leaders.size) return turns;

    const ordered = [];
    const placed = new Set();
    const place = combatant => {
        if (placed.has(combatant.id)) return;
        placed.add(combatant.id);
        ordered.push(combatant);
        for (const follower of followers.get(combatant.id) ?? []) place(follower);
    };
    for (const combatant of turns) {
        if (!leaders.has(combatant.id)) place(combatant);
    }
    // Only creatures summoning each other in a loop are left
    for (const combatant of turns) place(combatant);
    return ordered;
}

/**
 * Wrapper for Combat#setupTurns.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {Combatant[]}
 */
function _wrapSetupTurns(wrapped, ...args) {
    const hadPrevious = Boolean(this.previous);
    const turns = wrapped(...args);
    try {
        const ordered = orderSummonTurns(turns);
        if (ordered.every((c, i) => c === turns[i])) return turns;
        if (this.turn !== null) ordered.forEach((c, i) => c.turnNumber = i);
        this.turns = ordered;
        this.current = this._getCurrentState(ordered[this.turn]);
        if (!hadPrevious) this.previous = { ...this.current };
        return ordered;
    } catch (err) {
        console.error(`${MODULE_ID} | Summon Initiative: failed to order turns:`, err);
        return turns;
    }
}

/**
 * A leader's name for this user. A hidden summoner's name stays hidden from players.
 * @param {Combatant} leader
 * @returns {string|null}
 */
function _visibleName(leader) {
    return (leader.hidden && !game.user.isGM) ? null : leader.name;
}

/**
 * Tell the user why a creature doesn't roll.
 * @param {Combatant} combatant
 * @param {Combatant} leader
 */
function _notifyBlocked(combatant, leader) {
    const name = _visibleName(leader);
    const message = name
        ? game.i18n.format("ND5T.SummonInitiative.Blocked", { creature: combatant.name, name })
        : game.i18n.format("ND5T.SummonInitiative.BlockedHidden", { creature: combatant.name });
    ui.notifications.info(message);
}

/**
 * Wrapper for Combat#rollInitiative: followers never roll.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {string|string[]} ids
 * @param {...*} args
 * @returns {Promise<Combat>}
 */
function _wrapRollInitiative(wrapped, ids, ...args) {
    const requested = (typeof ids === "string") ? [ids] : Array.from(ids ?? []);
    const kept = requested.filter(id => !getSummonLeader(this.combatants.get(id)));
    if (kept.length === requested.length) return wrapped(ids, ...args);

    if (requested.length === 1) {
        const combatant = this.combatants.get(requested[0]);
        _notifyBlocked(combatant, getSummonLeader(combatant));
    }
    if (!kept.length) return Promise.resolve(this);
    return wrapped(kept, ...args);
}

/**
 * Wrapper for Actor5e#rollInitiativeDialog: no dialog for a creature that wouldn't roll.
 * @this {Actor}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {Promise<void>}
 */
function _wrapRollInitiativeDialog(wrapped, ...args) {
    const combatants = game.combat?.combatants.filter(c => c.actor === this) ?? [];
    const leader = combatants.length ? getSummonLeader(combatants[0]) : null;
    if (leader && combatants.every(c => getSummonLeader(c))) {
        _notifyBlocked(combatants[0], leader);
        return Promise.resolve();
    }
    return wrapped(...args);
}

/**
 * Copy leaders' initiative to their followers.
 * @param {Combat} combat
 */
async function _syncCombat(combat) {
    if (!game.user.isActiveGM || !game.combats?.has(combat.id) || !getSetting("enableSummonInitiative")) return;

    const updates = [];
    const firstValues = [];
    for (const combatant of combat.combatants) {
        const leader = getSummonLeader(combatant);
        if (!leader) continue;
        const initiative = leader.initiative ?? null;
        if ((combatant.initiative ?? null) === initiative) continue;
        updates.push({ _id: combatant.id, initiative });
        if ((combatant.initiative ?? null) === null) firstValues.push(combatant.id);
    }
    if (!updates.length) return;

    debug(`Summon Initiative | Syncing ${updates.length} followers in combat ${combat.id}.`);
    await combat.updateEmbeddedDocuments("Combatant", updates, { turnEvents: false, [SYNC_OPTION]: true });

    // dnd5e recovers "on initiative" uses when a creature rolls; followers get them when they receive a value
    for (const id of firstValues) {
        const combatant = combat.combatants.get(id);
        if (Number.isNumeric(combatant?.initiative)) await combat._recoverUses?.({ initiative: combatant });
    }

    // A follower of a follower gets its value from the update above
    _queueSync(combat);
}

/**
 * Queue a sync, one at a time, with repeated requests for a combat merged.
 * @param {Combat} combat
 */
function _queueSync(combat) {
    if (!combat || !game.user.isActiveGM || _pendingSyncs.has(combat)) return;
    _pendingSyncs.add(combat);
    _syncChain = _syncChain
        .then(() => {
            _pendingSyncs.delete(combat);
            return _syncCombat(combat);
        })
        .catch(err => console.error(`${MODULE_ID} | Summon Initiative: failed to sync initiative:`, err));
}

/**
 * A combatant's initiative changed.
 * @param {Combatant} combatant
 * @param {object} changed
 * @param {object} options
 */
async function _onUpdateCombatant(combatant, changed, options) {
    if (!game.user.isActiveGM || !("initiative" in changed) || options?.[SYNC_OPTION]) return;
    if (!getSetting("enableSummonInitiative")) return;
    try {
        // Reset: the creature follows its summoner again
        if (combatant.getFlag(MODULE_ID, RELEASED_FLAG) && (changed.initiative === null)) {
            await combatant.unsetFlag(MODULE_ID, RELEASED_FLAG);
        } else {
            // Followers only change through the sync, so a different value is a manual edit
            const leader = getSummonLeader(combatant);
            if (leader && Number.isNumeric(changed.initiative) && (changed.initiative !== leader.initiative)) {
                await combatant.setFlag(MODULE_ID, RELEASED_FLAG, true);
                return;
            }
        }
        _queueSync(combatant.parent);
    } catch (err) {
        console.error(`${MODULE_ID} | Summon Initiative: failed to handle initiative change:`, err);
    }
}

/**
 * Replace the tracker's roll button of followers with a link icon.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function _onRenderCombatTracker(app, element) {
    const combat = app.viewed;
    if (!combat || !(element instanceof HTMLElement)) return;
    for (const button of element.querySelectorAll(".combatant[data-combatant-id] button.combatant-control.roll")) {
        const combatant = combat.combatants.get(button.closest("[data-combatant-id]").dataset.combatantId);
        const leader = getSummonLeader(combatant);
        if (!leader) continue;
        const name = _visibleName(leader);
        const label = name
            ? game.i18n.format("ND5T.SummonInitiative.Follows", { name: foundry.utils.escapeHTML(name) })
            : game.i18n.localize("ND5T.SummonInitiative.FollowsHidden");
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-link nd5t-summon-initiative";
        icon.dataset.tooltip = label;
        icon.setAttribute("aria-label", label);
        button.replaceWith(icon);
    }
}

export function initSummonInitiative() {
    patchMethod("CONFIG.Combat.documentClass.prototype.setupTurns", _wrapSetupTurns, "WRAPPER");
    patchMethod("CONFIG.Combat.documentClass.prototype.rollInitiative", _wrapRollInitiative, "MIXED");
    patchMethod("CONFIG.Actor.documentClass.prototype.rollInitiativeDialog", _wrapRollInitiativeDialog, "MIXED");

    Hooks.on("createCombatant", combatant => _queueSync(combatant.parent));
    Hooks.on("deleteCombatant", combatant => _queueSync(combatant.parent));
    Hooks.on("updateCombatant", _onUpdateCombatant);
    Hooks.on("updateCombat", (combat, changed) => {
        if (changed.combatants) _queueSync(combat); // midi-qol's per-round reroll
    });
    Hooks.on("combatStart", combat => _queueSync(combat));
    Hooks.on("renderCombatTracker", _onRenderCombatTracker);
    Hooks.once("ready", () => {
        for (const combat of game.combats) _queueSync(combat);
    });

    debug("Summon Initiative | Initialized");
}
