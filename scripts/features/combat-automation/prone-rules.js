/**
 * Feature: Prone Rules
 * Description: Automates the movement and attack rules of the Prone condition that dnd5e leaves to the table:
 *              - Crawling: a Prone creature's token switches to the Crawl movement action, and walking while
 *                Prone costs 1 extra foot per foot like crawling does.
 *              - Standing up: ending Prone on the creature's own turn in combat costs half its Speed. The cost is
 *                added to the first step it moves after standing, so it shows in the ruler and the movement
 *                history. Players can't stand up without enough movement left (the GM gets a warning instead).
 *              - Attacks: a Prone attacker has Disadvantage. An attack against a Prone creature has Advantage
 *                from within 5 feet and Disadvantage from farther away.
 *
 * @introduced v14.63.0
 * @updated v14.67.6 (Standing up no longer charged twice in the drag ruler)
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { getMidiWorkflow, isAc5eActive } from "../../utils/module-compat.js";
import { convertLength } from "../../utils/dnd5e-compat.js";

/**
 * How it works
 *
 * dnd5e 6.0 / 6.1 only set non-walking speeds to 0 while Prone (`conditionEffects.crawl`) and give the Crawl
 * movement action a doubled cost. Nothing selects Crawl for a Prone token, standing up is free, and Prone has
 * no effect on attack rolls.
 *
 * Crawling
 *  - createActiveEffect / deleteActiveEffect switch the token's `movementAction` to "crawl" and back. The
 *    previous action is kept in a token flag so a manual choice is restored.
 *  - `Token#_getMovementCostFunction` is wrapped so a "walk" step of a Prone creature costs `cost + distance`,
 *    the same formula dnd5e uses for Crawl. This covers keyboard moves and paths that still say "walk".
 *
 * Standing up
 *  Foundry can't record a movement cost without moving: every grid type returns a cost of 0 for a step that
 *  covers no distance (`common/grid/square.mjs` `_measurePath`, `c === 0`), and movement history can only be
 *  written by moving or undoing. So the cost is added to the first step taken from the spot where the
 *  creature stood up:
 *  - preDeleteActiveEffect (on the client removing Prone) blocks players who don't have half their Speed left.
 *  - deleteActiveEffect stores a marker on the token: combat, round, turn, cost and the position.
 *  - `Token#measureMovementPath` is wrapped. The first new segment (not yet in the movement history) that
 *    starts at the marked position gets the cost added, as do the cumulative totals after it. Foundry stores
 *    each history waypoint with its measured cost, so the charge stays in the history for the rest of the turn.
 *    A new segment that already carries a fixed cost was measured with the charge before (planned drag
 *    waypoints keep their measured cost and the ruler measures them again), so it isn't charged twice.
 *  - moveToken records the movement that paid the cost in `marker.consumedBy`. While that movement is in the
 *    history the cost isn't charged again; undoing it removes it from the history, so the next move pays again.
 *  The wrapper works on whole segments rather than inside the per-grid-space cost function, because Foundry
 *  takes the median of per-space costs for tokens bigger than one space, which would hide a single charge.
 *
 * Attacks
 *  - dnd5e.preRollAttack sets `advantage` / `disadvantage` on the roll config and its rolls, like
 *    Magic Resistance does for saves. dnd5e cancels the two out when both apply.
 *  - midi-qol calls dnd5e's rollAttack, so the hook runs for its workflows too. Its own once-hook runs after
 *    this one and only clears a side when a midi flag denies it (e.g. "no advantage").
 *  - Automated Conditions 5e handles Prone attack rolls itself, so this part steps aside while it is active.
 */

const PRONE = "prone";
const MARKER_FLAG = "proneStandUp";
const CRAWL_FLAG = "proneCrawlPrevious";

/** Distance within which an attack against a Prone creature has Advantage, in feet. */
const PRONE_ADVANTAGE_RANGE_FT = 5;

// ── Settings helpers ──────────────────────────────────────────────────

function _ruleActive(key) {
    try {
        return Boolean(getSetting("enableProneRules") && getSetting(key));
    } catch {
        return false;
    }
}

/** dnd5e's movement automation setting. "none" turns off all of its movement costs, so ours follow. */
function _movementAutomationOn() {
    try {
        return game.settings.get("dnd5e", "movementAutomation") !== "none";
    } catch {
        return true;
    }
}

const _crawlActive = () => _ruleActive("proneCrawlMovement") && _movementAutomationOn();
const _standUpActive = () => _ruleActive("proneStandUpCost") && _movementAutomationOn();
const _attacksActive = () => _ruleActive("proneAttackRolls") && !isAc5eActive();

// ── Actor / effect helpers ────────────────────────────────────────────

/**
 * Whether an actor is under the Prone condition (and not immune to it).
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isProne(actor) {
    if (!actor?.statuses?.has(PRONE)) return false;
    return !actor.system?.traits?.ci?.value?.has(PRONE);
}

/**
 * Whether an ActiveEffect is (or carries) the Prone condition.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function _isProneEffect(effect) {
    if (!effect) return false;
    return effect.system?.type === PRONE || Boolean(effect.statuses?.has(PRONE));
}

/**
 * The actor an effect applies to (actor, item on an actor, or an unlinked token's ActorDelta).
 * @param {ActiveEffect} effect
 * @returns {Actor5e|null}
 */
function _effectActor(effect) {
    const parent = effect?.parent;
    if (!parent) return null;
    if (parent instanceof Actor) return parent;
    if (parent instanceof Item) return parent.actor ?? null;
    if (parent.documentName === "ActorDelta") return parent.syntheticActor ?? parent.parent?.actor ?? null;
    return null;
}

/**
 * Token documents on the viewed scene that an effect's actor is represented by.
 * @param {ActiveEffect} effect
 * @returns {TokenDocument[]}
 */
function _effectTokens(effect) {
    if (effect?.parent?.documentName === "ActorDelta" && effect.parent.parent) return [effect.parent.parent];
    const actor = _effectActor(effect);
    if (!actor) return [];
    if (actor.isToken && actor.token) return [actor.token];
    if (!canvas?.scene) return [];
    return actor.getDependentTokens({ scenes: canvas.scene, concreteOnly: true });
}

/**
 * Whether this client should update a token for a change made by another user: the user who made the change
 * does it when they may update the token, otherwise the active GM.
 * @param {TokenDocument} doc
 * @param {string} userId  The user who made the change.
 * @returns {boolean}
 */
function _shouldHandle(doc, userId) {
    if (userId === game.user.id) return doc.canUserModify(game.user, "update");
    if (!game.users.activeGM?.isSelf) return false;
    const user = game.users.get(userId);
    return !user || !doc.canUserModify(user, "update");
}

// ── Combat / movement helpers ─────────────────────────────────────────

/**
 * The token of the combatant whose turn it is, if it belongs to this actor.
 * @param {Actor5e} actor
 * @returns {TokenDocument|null}
 */
function _ownTurnToken(actor) {
    const combat = game.combat;
    if (!combat?.started || !actor) return null;
    const token = combat.combatant?.token;
    if (!token?.actor) return null;
    return token.actor.uuid === actor.uuid ? token : null;
}

/**
 * Walking speed of an actor, converted to the scene's grid units.
 * @param {Actor5e} actor
 * @param {Scene} scene
 * @returns {number}
 */
function _walkSpeed(actor, scene) {
    const movement = actor?.system?.attributes?.movement ?? {};
    const speed = Number(movement.speeds?.walk ?? movement.walk ?? 0) || 0;
    const from = movement.units;
    const to = scene?.grid?.units;
    if (!speed || !from || !to || from === to || !(to in (CONFIG.DND5E.movementUnits ?? {}))) return speed;
    return convertLength(speed, from, to) ?? speed;
}

/**
 * Movement a token has spent according to its movement history (Foundry clears it at the start of its turn).
 * @param {TokenDocument} doc
 * @returns {number}
 */
function _spentMovement(doc) {
    let spent = 0;
    for (const waypoint of doc.movementHistory ?? []) {
        if (Number.isFinite(waypoint.cost)) spent += waypoint.cost;
    }
    return spent;
}

/**
 * Whether two positions are the same spot (x, y, elevation and level).
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function _samePosition(a, b) {
    if (!a || !b) return false;
    if (Math.round(a.x) !== Math.round(b.x) || Math.round(a.y) !== Math.round(b.y)) return false;
    if ((a.elevation ?? 0) !== (b.elevation ?? 0)) return false;
    return !a.level || !b.level || a.level === b.level;
}

/**
 * The stand-up marker of a token if it belongs to the current turn of the current combat.
 * @param {TokenDocument} doc
 * @returns {object|null}
 */
function _activeMarker(doc) {
    const marker = doc?.getFlag?.(MODULE_ID, MARKER_FLAG);
    if (!marker || !(marker.cost > 0)) return null;
    const combat = game.combat;
    if (!combat || combat.id !== marker.combatId) return null;
    if (combat.round !== marker.round || combat.turn !== marker.turn) return null;
    return marker;
}

/**
 * Find the first segment of a path that leaves the stand-up position and isn't part of the movement history.
 * @param {object[]} waypoints     The measured waypoints.
 * @param {object} marker          The stand-up marker.
 * @param {Set<string>} historyIds Movement IDs in the token's movement history.
 * @returns {number}               The index of the segment's end waypoint, or -1.
 */
function _findStandUpSegment(waypoints, marker, historyIds) {
    for (let i = 1; i < waypoints.length; i++) {
        const waypoint = waypoints[i];
        if (waypoint.movementId && historyIds.has(waypoint.movementId)) continue;
        const actionConfig = CONFIG.Token.movement.actions[waypoint.action];
        if (actionConfig?.teleport || (actionConfig?.measure === false)) continue;
        const previous = waypoints[i - 1];
        if (!_samePosition(previous, marker)) continue;
        if (_samePosition(previous, waypoint)) continue;
        return i;
    }
    return -1;
}

// ── Crawling ──────────────────────────────────────────────────────────

/**
 * Switch a token to Crawl when it becomes Prone, or back to its previous action when it stands up.
 * @param {TokenDocument} doc
 * @param {boolean} prone
 * @returns {object|null}  Update data, or null.
 */
function _crawlUpdate(doc, prone) {
    if (!("crawl" in CONFIG.Token.movement.actions)) return null;
    const previous = doc.getFlag(MODULE_ID, CRAWL_FLAG);
    if (prone) {
        if (!_crawlActive()) return null;
        if (previous !== undefined) return null;
        const current = doc._source.movementAction;
        if (current && (current !== CONFIG.Token.movement.defaultAction)) return null;
        return { movementAction: "crawl", [`flags.${MODULE_ID}.${CRAWL_FLAG}`]: current ?? "" };
    }
    if (previous === undefined) return null;
    const update = { [`flags.${MODULE_ID}.${CRAWL_FLAG}`]: _del };
    // Leave a different action the player picked meanwhile alone.
    if (doc._source.movementAction === "crawl") update.movementAction = previous || null;
    return update;
}

/**
 * Wrapper for `Token#_getMovementCostFunction`: walking while Prone costs as much as crawling.
 * @this {Token}
 */
function _wrapMovementCostFunction(wrapped, ...args) {
    const costFunction = wrapped(...args);
    if (!_crawlActive()) return costFunction;
    const actor = this.document?.actor;
    if (!actor?.system?.isCreature || !_isProne(actor)) return costFunction;
    return (from, to, distance, segment) => {
        const cost = costFunction(from, to, distance, segment);
        if (segment?.action !== "walk" || !Number.isFinite(cost)) return cost;
        return cost + distance;
    };
}

// ── Standing up ───────────────────────────────────────────────────────

/**
 * Wrapper for `Token#measureMovementPath`: add the stand-up cost to the first step after standing.
 * @this {Token}
 */
function _wrapMeasureMovementPath(wrapped, waypoints, ...args) {
    const result = wrapped(waypoints, ...args);
    try {
        if (!_standUpActive() || !Array.isArray(waypoints)) return result;
        const doc = this.document;
        const marker = _activeMarker(doc);
        if (!marker) return result;
        const historyIds = new Set((doc.movementHistory ?? []).map(w => w.movementId));
        if (marker.consumedBy && historyIds.has(marker.consumedBy)) return result;

        const index = _findStandUpSegment(waypoints, marker, historyIds);
        // A waypoint with a fixed cost was measured before (Foundry stores the measured cost on planned drag
        // waypoints, which the ruler measures again), so its cost already includes the stand-up charge.
        if ((index < 0) || Number.isFinite(waypoints[index]?.cost)) return result;
        const segment = result?.waypoints?.[index]?.backward;
        if (!segment) return result;
        segment.cost += marker.cost;
        for (let i = index; i < result.waypoints.length; i++) result.waypoints[i].cost += marker.cost;
        result.cost += marker.cost;
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: failed to add the stand-up cost`, err);
    }
    return result;
}

/**
 * Block standing up without enough movement left (players), or warn about it (GM).
 * @param {ActiveEffect} effect
 * @returns {boolean|void}
 */
function _onPreDeleteActiveEffect(effect) {
    try {
        if (!_standUpActive() || !_isProneEffect(effect) || !effect.active) return;
        const actor = _effectActor(effect);
        if (!actor?.system?.isCreature) return;
        const token = _ownTurnToken(actor);
        if (!token) return;

        const speed = _walkSpeed(actor, token.parent);
        const cost = Math.floor(speed / 2);
        const left = speed - _spentMovement(token);
        if ((speed > 0) && (left >= cost)) return;

        const units = token.parent?.grid?.units ?? "";
        const reason = speed > 0
            ? `${actor.name} needs ${cost} ${units} of movement to stand up but has only ${Math.max(left, 0)} ${units} left this turn.`
            : `${actor.name} has a Speed of 0 and can't stand up.`;
        if (game.user.isGM) {
            ui.notifications.warn(`Prone: ${reason} Removed anyway because you are the GM.`);
            return;
        }
        ui.notifications.warn(`Prone: ${reason}`);
        return false;
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: preDeleteActiveEffect failed`, err);
    }
}

/**
 * Stand-up marker update for a token that just ended Prone, or null outside its own turn.
 * @param {TokenDocument} doc
 * @param {Actor5e} actor
 * @returns {object|null}
 */
function _standUpUpdate(doc, actor) {
    if (!_standUpActive() || !actor?.system?.isCreature) return null;
    const turnToken = _ownTurnToken(actor);
    if (!turnToken || (turnToken !== doc && turnToken.uuid !== doc.uuid)) return null;
    const cost = Math.floor(_walkSpeed(actor, doc.parent) / 2);
    if (!(cost > 0)) return null;
    const combat = game.combat;
    const { x, y, elevation, level } = doc._source;
    return {
        [`flags.${MODULE_ID}.${MARKER_FLAG}`]: {
            combatId: combat.id, round: combat.round, turn: combat.turn,
            cost, x, y, elevation, level: level ?? null, consumedBy: null
        }
    };
}

/**
 * Note the movement that paid the stand-up cost, so it isn't charged again while that movement stands.
 * @param {TokenDocument} doc
 * @param {object} movement
 */
async function _onMoveToken(doc, movement) {
    try {
        if (!_standUpActive() || !movement?.recorded || !movement.user?.isSelf) return;
        const marker = _activeMarker(doc);
        if (!marker) return;
        const historyIds = new Set((doc.movementHistory ?? []).map(w => w.movementId));
        if (marker.consumedBy && historyIds.has(marker.consumedBy)) return;
        const path = [movement.origin, ...(movement.passed?.waypoints ?? [])];
        if (_findStandUpSegment(path, marker, new Set()) < 0) return;
        await doc.update({ [`flags.${MODULE_ID}.${MARKER_FLAG}.consumedBy`]: movement.id });
        debug(`Prone Rules | ${doc.name} paid ${marker.cost} for standing up (movement ${movement.id})`);
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: moveToken failed`, err);
    }
}

// ── Prone added / removed ─────────────────────────────────────────────

async function _onCreateActiveEffect(effect, _options, userId) {
    try {
        if (!_isProneEffect(effect) || !effect.active) return;
        for (const doc of _effectTokens(effect)) {
            if (!_shouldHandle(doc, userId)) continue;
            const update = _crawlUpdate(doc, true);
            if (update) await doc.update(update);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: createActiveEffect failed`, err);
    }
}

async function _onDeleteActiveEffect(effect, _options, userId) {
    try {
        if (!_isProneEffect(effect)) return;
        const actor = _effectActor(effect);
        // Another Prone effect may still apply (e.g. the rider of Unconscious). Checked on the effects rather
        // than `actor.statuses`, which an unlinked token's synthetic actor may not have refreshed yet.
        const stillProne = Array.from(actor?.allApplicableEffects?.() ?? [])
            .some(e => (e.id !== effect.id) && e.active && _isProneEffect(e));
        if (stillProne) return;
        for (const doc of _effectTokens(effect)) {
            if (!_shouldHandle(doc, userId)) continue;
            const update = { ...(_crawlUpdate(doc, false) ?? {}), ...(_standUpUpdate(doc, actor) ?? {}) };
            if (!Object.keys(update).length) continue;
            await doc.update(update);
            debug(`Prone Rules | ${doc.name} stood up`, update);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: deleteActiveEffect failed`, err);
    }
}

// ── Attacks ───────────────────────────────────────────────────────────

/**
 * Distance between two tokens in scene units: closest grid spaces, including the vertical gap.
 * @param {Token} a
 * @param {Token} b
 * @returns {number}
 */
function _tokenDistance(a, b) {
    const grid = canvas.grid;
    const docA = a.document;
    const docB = b.document;
    const height = doc => (doc.depth ?? Math.min(doc.width, doc.height)) * grid.distance;
    const gap = Math.max(0, docB.elevation - (docA.elevation + height(docA)), docA.elevation - (docB.elevation + height(docB)));

    if (grid.isGridless) {
        const ca = a.center;
        const cb = b.center;
        const radii = ((Math.max(docA.width, docA.height) + Math.max(docB.width, docB.height)) / 2) * grid.distance;
        // Measured like the grid case: between the centers of the closest spaces, so adjacent tokens are 5 ft apart.
        const flat = Math.max(0, (Math.hypot(ca.x - cb.x, ca.y - cb.y) / grid.size * grid.distance) - radii + grid.distance);
        return Math.hypot(flat, gap);
    }

    const spacesA = docA.getOccupiedGridSpaceOffsets();
    const spacesB = docB.getOccupiedGridSpaceOffsets();
    if (!spacesA.length || !spacesB.length) return Infinity;
    let best = Infinity;
    for (const oa of spacesA) {
        const pa = grid.getCenterPoint(oa);
        for (const ob of spacesB) {
            const pb = grid.getCenterPoint(ob);
            const { distance } = grid.measurePath([{ x: pa.x, y: pa.y, elevation: 0 }, { x: pb.x, y: pb.y, elevation: gap }]);
            if (distance < best) best = distance;
        }
    }
    return best;
}

/** The 5 ft reach of the Prone rule in the scene's units. */
function _advantageRange() {
    const units = canvas.scene?.grid?.units;
    if (!units || units === "ft" || !(units in (CONFIG.DND5E.movementUnits ?? {}))) return PRONE_ADVANTAGE_RANGE_FT;
    return convertLength(PRONE_ADVANTAGE_RANGE_FT, "ft", units) ?? PRONE_ADVANTAGE_RANGE_FT;
}

/**
 * The attacker's token on the viewed scene.
 * @param {Actor5e} actor
 * @param {object|null} workflow  midi-qol workflow, if any.
 * @returns {Token|null}
 */
function _attackerToken(actor, workflow) {
    const fromWorkflow = workflow?.token?.object ?? workflow?.token;
    if (fromWorkflow?.document) return fromWorkflow;
    if (actor.isToken) return actor.token?.object ?? null;
    const tokens = actor.getActiveTokens();
    return tokens.find(t => t.controlled) ?? tokens[0] ?? null;
}

/**
 * The attack's targets as Token placeables.
 * @param {object|null} workflow  midi-qol workflow, if any.
 * @returns {Token[]}
 */
function _attackTargets(workflow) {
    const source = workflow?.targets?.size ? workflow.targets : game.user.targets;
    return Array.from(source ?? [], t => t?.object ?? t).filter(t => t?.document);
}

/**
 * dnd5e.preRollAttack: Prone attackers have Disadvantage; attacks against a Prone target have Advantage from
 * within 5 feet and Disadvantage from farther away.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        if (!_attacksActive()) return;
        const actor = config.subject?.actor;
        if (!actor) return;
        let advantage = false;
        let disadvantage = false;

        if (_isProne(actor)) {
            disadvantage = true;
            debug(`Prone Rules | ${actor.name} attacks while Prone: Disadvantage`);
        }

        // Only a single target: with several, one roll can't carry a different mode for each of them.
        const workflow = getMidiWorkflow(config);
        const targets = canvas?.ready ? _attackTargets(workflow) : [];
        const target = targets.length === 1 ? targets[0] : null;
        if (target && _isProne(target.actor)) {
            const attacker = _attackerToken(actor, workflow);
            if (attacker && (attacker !== target) && (attacker.document.parent === target.document.parent)) {
                const distance = _tokenDistance(attacker, target);
                if (distance <= _advantageRange() + 1e-6) advantage = true;
                else disadvantage = true;
                debug(`Prone Rules | ${target.name} is Prone, attacker ${distance} away: ${advantage ? "Advantage" : "Disadvantage"}`);
            }
        }

        if (!advantage && !disadvantage) return;
        if (advantage) config.advantage = true;
        if (disadvantage) config.disadvantage = true;
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            if (advantage) roll.options.advantage = true;
            if (disadvantage) roll.options.disadvantage = true;
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Prone Rules: preRollAttack failed`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize Prone Rules. Called once during the "setup" phase from main.js.
 * Hooks and wrappers stay registered and check the settings on every call.
 */
export function initProneRules() {
    const tokenClass = "CONFIG.Token.objectClass.prototype";
    patchMethod(`${tokenClass}._getMovementCostFunction`, _wrapMovementCostFunction, "WRAPPER");
    patchMethod(`${tokenClass}.measureMovementPath`, _wrapMeasureMovementPath, "WRAPPER");
    Hooks.on("createActiveEffect", _onCreateActiveEffect);
    Hooks.on("preDeleteActiveEffect", _onPreDeleteActiveEffect);
    Hooks.on("deleteActiveEffect", _onDeleteActiveEffect);
    Hooks.on("moveToken", _onMoveToken);
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    debug("Prone Rules | Initialized");
}
