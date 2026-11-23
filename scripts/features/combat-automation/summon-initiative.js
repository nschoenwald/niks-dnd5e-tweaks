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
 *
 * @updated v14.111.0 (Shared Companion Turns)
 *
 * Shared Companion Turns (`getSharedTurnLeader`): companions whose rules say they act *during* the summoner's turn
 * (`sharedTurnItems`) don't get a turn of their own. Both combatants stay in `Combat#turns`, so turn numbers never
 * shift, and the summoner stays `combat.combatant`:
 * - Turn changes that land on the companion are redirected in `preUpdateCombat` (covers Next Turn, Previous Turn,
 *   rounds and direct updates). A defeated summoner gets skipped by core, so its companion then has a normal turn.
 * - Core walks over skipped turns and would fire the companion's start and end together when the summoner's turn
 *   ends, ending e.g. its Dodge at once. Those calls are dropped, and `_onStartTurn` / `_onEndTurn` of the summoner run
 *   the companion's events and region events right after its own.
 * - dnd5e's "start/end of the target's or source's turn" expiries compare against `combat.combatant`, which is never
 *   the companion. `isExpiryEvent` falls back to the summoner's turn edge. Core's own expiries already work: effects
 *   applied during the shared turn record the summoner as their start combatant.
 * - Turn marker, tracker row and `nextCombatant` follow. `isSharedTurn` is the check for "whose turn" code here.
 * - midi-qol counts an attack made outside `combat.combatant`'s turn as an opportunity attack that spends the Reaction,
 *   so the companion's non-reaction attacks during the shared turn pass its `notReaction` option.
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

/** Official items whose rules say the creature acts during the summoner's turn. */
export const DEFAULT_SHARED_TURN_ITEMS = "primal-companion, reanimated-companion, steel-defender, vestige-companion";

const RELEASED_FLAG = "summonInitiativeReleased";
const SYNC_OPTION = "nd5tSummonInitiative";
const SHARED_CONTEXT = "nd5tSharedTurn";
const BODY_CLASS = "nd5t-shared-companion-turns";

/** @type {Map<string, {source: string, ids: Set<string>}>} Parsed list settings. */
const _lists = new Map();

/** @type {Set<Combat>} Combats waiting for a sync. */
const _pendingSyncs = new Set();
let _syncChain = Promise.resolve();

/**
 * The item identifiers of a list setting.
 * @param {string} key
 * @returns {Set<string>}
 */
function _itemList(key) {
    const source = String(getSetting(key) ?? "");
    let list = _lists.get(key);
    if (list?.source !== source) {
        list = { source, ids: new Set(source.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)) };
        _lists.set(key, list);
    }
    return list.ids;
}

/**
 * The item that summoned this combatant's actor.
 * @param {Combatant} combatant
 * @returns {Item5e|null}
 */
function _summonItem(combatant) {
    const origin = combatant.actor?.getFlag("dnd5e", "summon.origin");
    if (typeof origin !== "string") return null;
    try {
        const item = fromUuidSync(origin, { strict: false });
        return item?.documentName === "Item" ? item : null;
    } catch {
        return null;
    }
}

/**
 * Whether an item's summons share the summoner's turn.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isSharedItem(item) {
    return Boolean(getSetting("enableSharedCompanionTurns"))
        && _itemList("sharedTurnItems").has(item.identifier?.toLowerCase());
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

    const item = _summonItem(combatant);
    if (!item) return null;
    if (!_itemList("summonInitiativeItems").has(item.identifier?.toLowerCase()) && !_isSharedItem(item)) return null;

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
 * The combatant whose turn this companion shares. Null while that combatant is defeated: core skips its turn then, so
 * the companion acts on a turn of its own.
 * @param {Combatant} combatant
 * @returns {Combatant|null}
 */
export function getSharedTurnLeader(combatant) {
    if (!combatant || !getSetting("enableSummonInitiative") || !getSetting("enableSharedCompanionTurns")) return null;
    const item = _summonItem(combatant);
    if (!item || !_isSharedItem(item)) return null;
    const leader = getSummonLeader(combatant);
    return (leader && !leader.isDefeated) ? leader : null;
}

/**
 * The companions sharing a combatant's turn, including companions of those companions.
 * @param {Combat} combat
 * @param {Combatant} leader
 * @returns {Combatant[]}
 */
export function getSharedTurnFollowers(combat, leader) {
    if (!leader || !getSetting("enableSummonInitiative") || !getSetting("enableSharedCompanionTurns")) return [];
    const followers = [];
    const seen = new Set([leader.id]);
    const collect = id => {
        for (const combatant of combat.turns ?? []) {
            if (seen.has(combatant.id) || (getSharedTurnLeader(combatant)?.id !== id)) continue;
            seen.add(combatant.id);
            followers.push(combatant);
            collect(combatant.id);
        }
    };
    collect(leader.id);
    return followers;
}

/**
 * The companion of this actor that is acting in the current shared turn.
 * @param {Combat} combat
 * @param {Actor5e} actor
 * @param {TokenDocument|null} [token]
 * @returns {Combatant|null}
 */
export function getSharedTurnCombatant(combat, actor, token = null) {
    if (!combat?.started || !combat.combatant || !actor) return null;
    return getSharedTurnFollowers(combat, combat.combatant).find(c => {
        if (token?.id && c.tokenId) return c.tokenId === token.id;
        return (c.actor === actor) || (c.actor?.uuid === actor.uuid);
    }) ?? null;
}

/**
 * Whether this actor is a companion acting in the current shared turn.
 * @param {Combat} combat
 * @param {Actor5e} actor
 * @param {TokenDocument|null} [token]
 * @returns {boolean}
 */
export function isSharedTurn(combat, actor, token = null) {
    return Boolean(getSharedTurnCombatant(combat, actor, token));
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

    // Nothing left to roll: say why, or the button (Carolingian UI keeps Roll NPCs visible for these) seems dead
    if (!kept.length) {
        const combatant = this.combatants.get(requested[0]);
        _notifyBlocked(combatant, getSummonLeader(combatant));
        return Promise.resolve(this);
    }
    return wrapped(kept, ...args);
}

/**
 * Wrapper for Combatant5e#getGroupingKey and #getInitiativeGroupingKey. dnd5e groups matching unlinked tokens wherever
 * they are in the order and draws the group at its first member (Carolingian UI flattens it there too), which could
 * pull a summon away from its summoner. An independent copy could also take its initiative from a follower. Followers
 * therefore only group with followers of the same leader.
 * @this {Combatant}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {string|null}
 */
function _wrapGroupingKey(wrapped, ...args) {
    const key = wrapped(...args);
    if ((key === null) || (key === undefined) || this.group) return key;
    const leader = getSummonLeader(this);
    return leader ? `${key}:follows:${leader.id}` : key;
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

    // Shared turns: nested under the summoner, active together
    const shared = Boolean(getSetting("enableSummonInitiative") && getSetting("enableSharedCompanionTurns"));
    document.body.classList.toggle(BODY_CLASS, shared);
    if (shared) _refreshSharedRows(element, combat);
}

/**
 * Mark companion rows. Uses its own class rather than core's `.active`: Carolingian UI's carousel moves a single
 * `.active` between cards (a second one would stay behind) and resizes the card that has it. It also skips tracker
 * renders while animating and shows cloned cards (`data-clone-source-id`), so this runs on turn changes too.
 * @param {ParentNode} root
 * @param {Combat} combat
 */
function _refreshSharedRows(root, combat) {
    const acting = new Set(getSharedTurnFollowers(combat, combat.combatant).map(c => c.id));
    for (const row of root.querySelectorAll("li.combatant")) {
        const id = row.dataset.combatantId ?? row.dataset.cloneSourceId;
        if (!id) continue;
        const isShared = Boolean(getSharedTurnLeader(combat.combatants.get(id)));
        row.classList.toggle("nd5t-shared-turn", isShared);
        row.classList.toggle("nd5t-shared-active", isShared && combat.started && acting.has(id));
    }
}

/**
 * Wrapper for Combat#nextTurn: when only companions are left in the round, start the next round properly, so its hooks
 * and midi-qol's initiative reroll run. Redirecting the turn in preUpdateCombat would come too late for those.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {Promise<Combat>}
 */
function _wrapNextTurn(wrapped, ...args) {
    if ((this.round === 0) || !this.turns?.length) return wrapped(...args);
    const remaining = this.turns.slice((this.turn ?? -1) + 1)
        .filter(c => !(this.settings.skipDefeated && c.isDefeated));
    if (remaining.length && remaining.every(c => getSharedTurnLeader(c))) return this.nextRound();
    return wrapped(...args);
}

/**
 * Keep turn changes off companions that share a turn.
 * @param {Combat} combat
 * @param {object} changed
 * @param {object} options
 */
function _onPreUpdateCombat(combat, changed, options) {
    try {
        if ((typeof changed.turn !== "number") || ((changed.round ?? combat.round) === 0)) return;
        const leader = getSharedTurnLeader(combat.turns?.[changed.turn]);
        if (!leader) return;

        const round = changed.round ?? combat.round;
        const roundDelta = round - (combat.round ?? 0);
        const direction = options.direction ?? (roundDelta || ((changed.turn >= (combat.turn ?? 0)) ? 1 : -1));

        // Going back, or arriving in a new round: the shared turn itself
        if ((direction < 0) || (roundDelta > 0)) changed.turn = combat.turns.indexOf(leader);
        else {
            const usable = c => !getSharedTurnLeader(c) && !(combat.settings.skipDefeated && c.isDefeated);
            let next = -1;
            for (let i = changed.turn + 1; i < combat.turns.length; i++) {
                if (usable(combat.turns[i])) {
                    next = i;
                    break;
                }
            }
            if (next < 0) {
                changed.round = round + 1;
                next = Math.max(combat.turns.findIndex(usable), 0);
            }
            changed.turn = next;
        }

        if (options.worldTime) {
            options.worldTime.delta = combat.getTimeDelta(combat.round, combat.turn, changed.round ?? round, changed.turn);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Shared Companion Turns: failed to redirect the turn:`, err);
    }
}

/**
 * Run a turn event for the companions of the combatant it just ran for.
 * @param {Combat} combat
 * @param {Combatant} leader
 * @param {object} context
 * @param {"_onStartTurn"|"_onEndTurn"} method
 * @param {string} regionEvent
 */
async function _runSharedEvents(combat, leader, context, method, regionEvent) {
    for (const follower of getSharedTurnFollowers(combat, leader)) {
        if (combat.settings.skipDefeated && follower.isDefeated) continue;
        const sharedContext = { ...context, [SHARED_CONTEXT]: true };
        try {
            await combat[method](follower, sharedContext);
            const token = follower.token;
            if (!token) continue;
            await Promise.allSettled(Array.from(token.regions ?? [], region => region._triggerEvent(regionEvent, {
                token, combatant: follower, combat, ...sharedContext
            })));
        } catch (err) {
            console.error(`${MODULE_ID} | Shared Companion Turns: ${method} failed for ${follower.name}:`, err);
        }
    }
}

/**
 * Wrapper for Combat#_onStartTurn.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {Combatant} combatant
 * @param {object} [context]
 * @param {...*} args
 */
async function _wrapOnStartTurn(wrapped, combatant, context = {}, ...args) {
    if (!context[SHARED_CONTEXT] && getSharedTurnLeader(combatant)) return;
    await wrapped(combatant, context, ...args);
    if (!context[SHARED_CONTEXT]) {
        await _runSharedEvents(this, combatant, context, "_onStartTurn", CONST.REGION_EVENTS.TOKEN_TURN_START);
    }
}

/**
 * Wrapper for Combat#_onEndTurn.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {Combatant} combatant
 * @param {object} [context]
 * @param {...*} args
 */
async function _wrapOnEndTurn(wrapped, combatant, context = {}, ...args) {
    if (!context[SHARED_CONTEXT] && getSharedTurnLeader(combatant)) return;
    await wrapped(combatant, context, ...args);
    if (!context[SHARED_CONTEXT]) {
        await _runSharedEvents(this, combatant, context, "_onEndTurn", CONST.REGION_EVENTS.TOKEN_TURN_END);
    }
}

/**
 * Wrapper for RegionDocument#_triggerEvent: drops core's turn events for a companion, which ran with its summoner.
 * @this {RegionDocument}
 * @param {Function} wrapped
 * @param {string} eventName
 * @param {object} eventData
 * @param {...*} args
 * @returns {Promise<void>}
 */
function _wrapRegionEvent(wrapped, eventName, eventData, ...args) {
    const isTurnEvent = (eventName === CONST.REGION_EVENTS.TOKEN_TURN_START)
        || (eventName === CONST.REGION_EVENTS.TOKEN_TURN_END);
    if (isTurnEvent && !eventData?.[SHARED_CONTEXT] && getSharedTurnLeader(eventData?.combatant)) {
        return Promise.resolve();
    }
    return wrapped(eventName, eventData, ...args);
}

/**
 * Wrapper for ActiveEffect5e#isExpiryEvent: "start/end of its turn" expiries of a companion follow the shared turn.
 * @this {ActiveEffect5e}
 * @param {Function} wrapped
 * @param {string} event
 * @param {object} [context]
 * @returns {boolean}
 */
function _wrapIsExpiryEvent(wrapped, event, context = {}) {
    const result = wrapped(event, context);
    if (result) return result;
    const special = this.specialDuration;
    if (!special || !this.start?.combat) return result;

    const isStart = special.endsWith("Start");
    if (event !== (isStart ? "turnStart" : "turnEnd")) return result;
    const combat = context.combat ?? game.combat;
    if (combat !== this.start.combat) return result;

    const origin = special.startsWith("target") ? this.actor : this.getSourceActor();
    const [combatant] = combat.getCombatantsByActor(origin);
    const leader = getSharedTurnLeader(combatant);
    if (!leader) return result;

    // Core also refreshes for each skipped turn, so only the summoner's own turn number counts
    const onLeaderEdge = isStart ? (combat.combatant === leader) : (combat.previous?.combatantId === leader.id);
    if (!onLeaderEdge || (context.turn !== combat.turns.indexOf(leader))) return result;
    return (this.start.round !== context.round) || (this.start.turn !== context.turn);
}

/**
 * Wrapper for the Combat#nextCombatant getter.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {Combatant|null}
 */
function _wrapNextCombatant(wrapped, ...args) {
    const next = wrapped(...args);
    if (!getSharedTurnLeader(next)) return next;
    const turn = this.turn ?? -1;
    for (let i = 1; i <= this.turns.length; i++) {
        const candidate = this.turns[(turn + i) % this.turns.length];
        if (getSharedTurnLeader(candidate)) continue;
        if (!this.settings.skipDefeated || !candidate.isDefeated) return candidate;
    }
    return next;
}

/**
 * Wrapper for Combat#_updateTurnMarkers: refresh the markers of companions in the current turn.
 * @this {Combat}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {*}
 */
function _wrapUpdateTurnMarkers(wrapped, ...args) {
    const result = wrapped(...args);
    if (canvas.ready && this.isView) {
        for (const follower of getSharedTurnFollowers(this, this.combatant)) {
            follower.token?.object?.renderFlags.set({ refreshTurnMarker: true });
        }
    }
    return result;
}

/**
 * Wrapper for Token#_refreshTurnMarker: core shows the marker for the current combatant's token, so that combatant
 * briefly reports the companion's token (the approach Legendary Action Placeholders uses too).
 * @this {Token}
 * @param {Function} wrapped
 * @param {...*} args
 * @returns {*}
 */
function _wrapRefreshTurnMarker(wrapped, ...args) {
    const combat = game.combat;
    const current = combat?.combatant;
    if (!combat?.started || !current || (current.tokenId === this.id)
        || !getSharedTurnFollowers(combat, current).some(c => c.tokenId === this.id)) return wrapped(...args);

    const descriptor = Object.getOwnPropertyDescriptor(current, "tokenId");
    Object.defineProperty(current, "tokenId", { value: this.id, configurable: true, writable: true });
    try {
        return wrapped(...args);
    } finally {
        if (descriptor) Object.defineProperty(current, "tokenId", descriptor);
        else delete current.tokenId;
    }
}

/**
 * Wrapper for the attack activity's use with midi-qol: a companion's attack in its shared turn isn't a reaction.
 * @this {Activity}
 * @param {Function} wrapped
 * @param {object} [usage]
 * @param {...*} args
 * @returns {Promise<*>}
 */
function _wrapAttackUse(wrapped, usage = {}, ...args) {
    if ((this.activation?.type !== "reaction") && isSharedTurn(game.combat, this.actor, this.actor?.token ?? null)) {
        usage = {
            ...usage,
            midiOptions: {
                ...usage.midiOptions,
                workflowOptions: { ...usage.midiOptions?.workflowOptions, notReaction: true }
            }
        };
    }
    return wrapped(usage, ...args);
}

export function initSummonInitiative() {
    patchMethod("CONFIG.Combat.documentClass.prototype.setupTurns", _wrapSetupTurns, "WRAPPER");
    patchMethod("CONFIG.Combat.documentClass.prototype.rollInitiative", _wrapRollInitiative, "MIXED");
    patchMethod("CONFIG.Actor.documentClass.prototype.rollInitiativeDialog", _wrapRollInitiativeDialog, "MIXED");
    patchMethod("CONFIG.Combatant.documentClass.prototype.getGroupingKey", _wrapGroupingKey, "WRAPPER");
    patchMethod("CONFIG.Combatant.documentClass.prototype.getInitiativeGroupingKey", _wrapGroupingKey, "WRAPPER");
    patchMethod("CONFIG.Combat.documentClass.prototype._onStartTurn", _wrapOnStartTurn, "MIXED");
    patchMethod("CONFIG.Combat.documentClass.prototype._onEndTurn", _wrapOnEndTurn, "MIXED");
    patchMethod("CONFIG.Combat.documentClass.prototype.nextCombatant#get", _wrapNextCombatant, "WRAPPER");
    patchMethod("Combat.prototype.nextTurn", _wrapNextTurn, "MIXED");
    patchMethod("Combat.prototype._updateTurnMarkers", _wrapUpdateTurnMarkers, "MIXED");
    patchMethod("CONFIG.Token.objectClass.prototype._refreshTurnMarker", _wrapRefreshTurnMarker, "WRAPPER");
    patchMethod("CONFIG.ActiveEffect.documentClass.prototype.isExpiryEvent", _wrapIsExpiryEvent, "WRAPPER");
    patchMethod("CONFIG.Region.documentClass.prototype._triggerEvent", _wrapRegionEvent, "MIXED");

    // Before Legendary Action Placeholders' hook, which may move the turn on from where this one lands
    Hooks.on("preUpdateCombat", _onPreUpdateCombat);

    Hooks.on("createCombatant", combatant => _queueSync(combatant.parent));
    Hooks.on("deleteCombatant", combatant => _queueSync(combatant.parent));
    Hooks.on("updateCombatant", _onUpdateCombatant);
    Hooks.on("updateCombat", (combat, changed) => {
        if (changed.combatants) _queueSync(combat); // midi-qol's per-round reroll
        if (combat.isView && (("turn" in changed) || ("round" in changed))) _refreshSharedRows(document, combat);
    });
    Hooks.on("combatStart", combat => _queueSync(combat));
    Hooks.on("renderCombatTracker", _onRenderCombatTracker);
    Hooks.once("ready", () => {
        // midi-qol swaps the activity classes before this point
        if (game.modules.get("midi-qol")?.active) {
            patchMethod("CONFIG.DND5E.activityTypes.attack.documentClass.prototype.use", _wrapAttackUse, "WRAPPER");
        }
        for (const combat of game.combats) _queueSync(combat);
    });

    debug("Summon Initiative | Initialized");
}
