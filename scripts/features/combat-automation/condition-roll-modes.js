/**
 * Feature: Condition Advantage & Disadvantage
 * Description: Applies the Advantage / Disadvantage of the system's conditions that dnd5e leaves to the table:
 *              - Blinded / Invisible: a creature that can't see its target attacks with Disadvantage, and attacks
 *                against a creature that can't see the attacker have Advantage. Blindsight, Truesight and See
 *                Invisibility (in range) let a creature see through them.
 *              - Restrained: Disadvantage on its attacks, Advantage on attacks against it.
 *              - Paralyzed, Petrified, Stunned, Unconscious: Advantage on attacks against it.
 *              - Poisoned (plus 2014 exhaustion level 3 and Heavily Encumbered): Disadvantage on its attacks,
 *                from the system's own condition effects, which it only applies to checks and saves.
 *              - Frightened: Disadvantage on its attacks and ability checks.
 *              - Grappled (2024 rules): Disadvantage on attacks against anyone but the grappler.
 *              - Dodging: Disadvantage on attacks against it while it can see the attacker.
 *              - Paralyzed, Unconscious: a hit from within 5 feet is a critical hit.
 *              - Paralyzed, Petrified, Stunned, Unconscious: Strength and Dexterity saves fail automatically
 *                (the roll's total is capped at 0).
 *              Prone stays in Prone Rules.
 *
 * @introduced v14.80.0
 */
import { getSetting, debug, MODULE_ID } from "../../context.js";
import {
    getMidiSettings, getMidiWorkflow, isAc5eActive, midiHandlesCantSee, midiHandlesConditionRules
} from "../../utils/module-compat.js";
import { convertLength } from "../../utils/dnd5e-compat.js";
import { tokenDistance, feetToSceneUnits } from "../../utils/token-distance.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { attackerToken, singleAttackTarget, addRollModes } from "../../utils/attack-context.js";

/**
 * How it works
 *
 * dnd5e 6.0 / 6.1 apply the speed, check and save parts of conditions (`CONFIG.DND5E.conditionEffects`) but none
 * of their attack roll parts. It even lists `attackDisadvantage` (Poisoned, 2014 exhaustion 3) and
 * `physicalAttackDisadvantage` (Heavily Encumbered) without reading them anywhere.
 *
 *  - dnd5e.preRollAttack adds `advantage` / `disadvantage` to the roll config and its rolls, like Prone Rules.
 *    dnd5e cancels the two out when both apply, so every source only has to add its side.
 *  - Rules that depend on the target need exactly one target on the attacker's scene; with several, one roll
 *    can't carry a different mode for each of them. The attacker's own conditions apply without a target.
 *  - "Can see" only looks at conditions and senses, not at walls or light: Blindsight sees through Blinded and
 *    Invisible, Truesight and See Invisibility see Invisible creatures, each within its range. Ranges come from
 *    the actor's senses and the token's detection modes, whichever is larger.
 *  - The grappler is the actor behind the Grappled effect's origin (the item or effect that applied it). A
 *    Grappled status toggled by hand has no origin, so the rule can't tell who the grappler is and skips it.
 *  - Frightened applies whether or not the source of fear is in sight.
 *  - dnd5e.preRollAbilityCheck covers ability checks, skills, tools and initiative (all roll as ability checks),
 *    for Frightened.
 *
 * Critical hits within 5 feet (Paralyzed, Unconscious)
 *  - dnd5e.preRollAttack marks the rolls (`options.nd5tCritOnHit`, holding the target's AC as a fallback for
 *    `options.target`) when the single target is Paralyzed or Unconscious and the attacker is within 5 feet.
 *    The mark is a roll option, so it is saved with the chat message.
 *  - `D20Roll#isCritical` is wrapped: a marked roll that hits (total >= AC, not a natural 1) is critical.
 *    dnd5e reads `isCritical` for the damage dialog's default button, the hit / miss list of the attack card
 *    and the roll's styling, so all of them follow. A miss stays a miss.
 *  - midi-qol decides criticals from the dice and its own flags, not from `isCritical`, so the
 *    "midi-qol.AttackRollComplete" hook sets `workflow.isCritical` when the target was hit (midi's hit check,
 *    or the total against the AC when midi doesn't check hits).
 *
 * Automatically failed Strength / Dexterity saves (Paralyzed, Petrified, Stunned, Unconscious)
 *  - dnd5e.preRollSavingThrow marks the rolls with `options.nd5tMaximumTotal = 0` and a critical threshold of
 *    21, so a natural 20 isn't shown or counted as critical. The message flavor says why the save fails.
 *  - dnd5e's own `maximum` option only clamps the d20 (and ignores 0), so the `D20Roll#total` getter is wrapped
 *    to cap the total of a marked roll. dnd5e's success / failure against the DC, midi-qol's save check and the
 *    chat card all read `total`. The cap is a roll option too, so rolls rebuilt from a message keep it.
 *
 *  - Steps aside completely while Automated Conditions 5e or midi-qol's optional Condition Rules are active, and
 *    leaves Blinded / Invisible to midi-qol's "Invisible / can't see" rule while that is on. midi-qol workflows
 *    otherwise go through dnd5e's rollAttack, so the hook runs for them too.
 */

const HELPLESS = ["paralyzed", "petrified", "stunned", "unconscious"];
/** Conditions that turn a hit from within 5 feet into a critical hit. */
const CRIT_WITHIN_5_FT = ["paralyzed", "unconscious"];
/** Conditions that make Strength and Dexterity saves fail. */
const FAIL_STR_DEX_SAVES = ["paralyzed", "petrified", "stunned", "unconscious"];
const AUTO_CRIT_RANGE_FT = 5;

/** Roll option: a hit is critical. Value: the target's AC when the roll was configured (or true). */
const CRIT_ON_HIT = "nd5tCritOnHit";
/** Roll option: the highest total the roll can have. */
const MAXIMUM_TOTAL = "nd5tMaximumTotal";

// ── Settings helpers ──────────────────────────────────────────────────

/** Whether another module applies the conditions to rolls itself. */
function _handledElsewhere() {
    return isAc5eActive() || midiHandlesConditionRules();
}

/**
 * Whether one of the condition groups is switched on.
 * @param {string} key  Setting key of the group.
 * @returns {boolean}
 */
function _ruleActive(key) {
    try {
        return Boolean(getSetting("enableConditionRollModes") && getSetting(key));
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

// ── Actor helpers ─────────────────────────────────────────────────────

/**
 * Whether an actor has a status and isn't immune to it.
 * @param {Actor5e|null} actor
 * @param {string} status
 * @returns {boolean}
 */
function _has(actor, status) {
    if (!actor?.statuses?.has(status)) return false;
    return !actor.system?.traits?.ci?.value?.has(status);
}

/**
 * Whether an actor is Dodging: it ends while Incapacitated or without movement, as in dnd5e's own check.
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
function _isDodging(actor) {
    if (!_has(actor, "dodging") || actor.statuses.has("incapacitated")) return false;
    return !actor.hasConditionEffect?.("noMovement");
}

/**
 * Range of a sense in the viewed scene's units: the actor's sense or the token's detection mode, whichever
 * reaches farther.
 * @param {Token} token
 * @param {Actor5e} actor
 * @param {string|null} sense          Key in the actor's `senses.ranges`.
 * @param {string} detectionMode       Detection mode id on the token.
 * @returns {number}
 */
function _senseRange(token, actor, sense, detectionMode) {
    let range = 0;
    const senses = actor?.system?.attributes?.senses;
    const value = sense ? Number(senses?.ranges?.[sense] ?? 0) : 0;
    if (value > 0) {
        const from = senses?.units;
        const to = canvas.scene?.grid?.units;
        range = (from && to && (from !== to) && (to in (CONFIG.DND5E.movementUnits ?? {})))
            ? (convertLength(value, from, to) ?? value) : value;
    }
    const mode = token?.document?.detectionModes?.[detectionMode];
    if (mode?.enabled && (Number(mode.range) > range)) range = Number(mode.range);
    return range;
}

/**
 * Whether a creature can see another as far as conditions and senses go (walls and light are left out).
 * @param {Token} viewer
 * @param {Token} subject
 * @param {number} distance  Distance between them in scene units.
 * @returns {boolean}
 */
function _canSee(viewer, subject, distance) {
    const viewerActor = viewer.actor;
    const reaches = range => range + 1e-6 >= distance;
    if (reaches(_senseRange(viewer, viewerActor, "blindsight", "blindsight"))) return true;
    if (_has(viewerActor, "blinded")) return false;
    if (!_has(subject.actor, "invisible")) return true;
    return reaches(Math.max(
        _senseRange(viewer, viewerActor, "truesight", "seeAll"),
        _senseRange(viewer, viewerActor, null, "seeInvisibility")
    ));
}

/**
 * The actor behind a document an effect's origin points to (an actor, its item, or an effect on either).
 * @param {foundry.abstract.Document|null} doc
 * @returns {Actor5e|null}
 */
function _originActor(doc) {
    let current = doc;
    for (let i = 0; current && (i < 4); i++) {
        if (current instanceof Actor) return current;
        if (current instanceof Item) return current.actor ?? null;
        if (current.documentName === "ActorDelta") return current.syntheticActor ?? null;
        current = current.parent;
    }
    return null;
}

/**
 * UUIDs of the actors grappling this one, from the origins of its Grappled effects.
 * @param {Actor5e} actor
 * @returns {Set<string>}
 */
function _grapplers(actor) {
    const grapplers = new Set();
    for (const effect of actor.allApplicableEffects?.() ?? []) {
        if (!effect.active || !effect.statuses?.has("grappled") || !effect.origin) continue;
        let origin = null;
        try {
            origin = fromUuidSync(effect.origin, { strict: false });
        } catch {
            continue;
        }
        const grappler = _originActor(origin);
        if (grappler && (grappler.uuid !== actor.uuid)) grapplers.add(grappler.uuid);
    }
    return grapplers;
}

// ── Attacks ───────────────────────────────────────────────────────────

/**
 * Ability an attack is rolled with: the one chosen for this roll, or the activity's default.
 * @param {object} config
 * @returns {string|undefined}
 */
function _attackAbility(config) {
    return config.ability || config.subject?.ability || undefined;
}

/**
 * dnd5e.preRollAttack: add the attack roll parts of the attacker's and the target's conditions.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        if (_handledElsewhere()) return;
        const actor = config.subject?.actor;
        if (!actor) return;

        const advantage = [];
        const disadvantage = [];

        const workflow = getMidiWorkflow(config);
        let target = singleAttackTarget(workflow);
        const attacker = target ? attackerToken(actor, workflow) : null;
        if (!attacker || (attacker === target) || (attacker.document.parent !== target.document.parent)) target = null;
        const targetActor = target?.actor ?? null;
        const distance = target ? tokenDistance(attacker, target) : Infinity;

        // Blinded / Invisible
        if (_ruleActive("condRollsBlindedInvisible") && !midiHandlesCantSee()) {
            if (target) {
                if (!_canSee(attacker, target, distance)) disadvantage.push("attacker can't see the target");
                if (!_canSee(target, attacker, distance)) advantage.push("target can't see the attacker");
            } else {
                if (_has(actor, "blinded")) disadvantage.push("Blinded attacker");
                if (_has(actor, "invisible")) advantage.push("Invisible attacker");
            }
        }

        // Restrained
        if (_ruleActive("condRollsRestrained")) {
            if (_has(actor, "restrained")) disadvantage.push("Restrained attacker");
            if (_has(targetActor, "restrained")) advantage.push("Restrained target");
        }

        // Paralyzed, Petrified, Stunned, Unconscious
        if (_ruleActive("condRollsHelpless")) {
            const status = HELPLESS.find(s => _has(targetActor, s));
            if (status) advantage.push(`${status} target`);
        }

        // Poisoned, 2014 exhaustion 3, Heavily Encumbered (the system's own attack condition effects)
        if (_ruleActive("condRollsPoisoned")) {
            const physical = CONFIG.DND5E.abilities[_attackAbility(config)]?.type === "physical";
            if (actor.hasConditionEffect?.("attackDisadvantage")
                || (physical && actor.hasConditionEffect?.("physicalAttackDisadvantage"))) {
                disadvantage.push("Poisoned, exhausted or encumbered attacker");
            }
        }

        // Frightened
        if (_ruleActive("condRollsFrightened") && _has(actor, "frightened")) disadvantage.push("Frightened attacker");

        // Grappled (2024): Disadvantage against anyone but the grappler
        if (_ruleActive("condRollsGrappled") && target && _isModernRules() && _has(actor, "grappled")) {
            const grapplers = _grapplers(actor);
            if (grapplers.size && !grapplers.has(targetActor?.uuid)) disadvantage.push("Grappled, target isn't the grappler");
            else if (!grapplers.size) debug(`Condition Advantage & Disadvantage | ${actor.name} is Grappled by an unknown creature: skipped`);
        }

        // Dodging
        if (_ruleActive("condRollsDodging") && target && _isDodging(targetActor) && _canSee(target, attacker, distance)) {
            disadvantage.push("target is Dodging");
        }

        // Paralyzed, Unconscious: a hit from within 5 feet is critical
        if (_ruleActive("condRollsAutoCrit") && target && (distance <= feetToSceneUnits(AUTO_CRIT_RANGE_FT) + 1e-6)) {
            const status = CRIT_WITHIN_5_FT.find(s => _has(targetActor, s));
            if (status) {
                const ac = Number(targetActor.system?.attributes?.ac?.value);
                for (const roll of config.rolls ?? []) {
                    roll.options ??= {};
                    roll.options[CRIT_ON_HIT] = Number.isFinite(ac) ? ac : true;
                }
                debug(`Condition Advantage & Disadvantage | ${target.name} is ${status} and within 5 feet: a hit is critical`);
            }
        }

        if (!advantage.length && !disadvantage.length) return;
        debug(`Condition Advantage & Disadvantage | ${actor.name} attacks${target ? ` ${target.name}` : ""}`, { advantage, disadvantage });
        addRollModes(config, { advantage: advantage.length > 0, disadvantage: disadvantage.length > 0 });
    } catch (err) {
        console.error(`${MODULE_ID} | Condition Advantage & Disadvantage: preRollAttack failed`, err);
    }
}

// ── Critical hits within 5 feet ───────────────────────────────────────

/**
 * Whether a marked attack roll hits: the total reaches the AC (the roll's own target, or the AC stored when it
 * was marked) and the d20 isn't a natural 1.
 * @param {D20Roll} roll
 * @returns {boolean}
 */
function _markedRollHits(roll) {
    const mark = roll.options?.[CRIT_ON_HIT];
    if (!mark || !roll._evaluated || roll.isFumble) return false;
    const ac = Number.isNumeric(roll.options.target) ? Number(roll.options.target) : mark;
    return (typeof ac === "number") && Number.isFinite(ac) && (roll.total >= ac);
}

/**
 * Wrapper for the `D20Roll#isCritical` getter: a marked attack roll that hits is critical.
 * @this {D20Roll}
 */
function _wrapIsCritical(wrapped) {
    const result = wrapped();
    if (result || !this.options?.[CRIT_ON_HIT]) return result;
    try {
        return _markedRollHits(this) || result;
    } catch {
        return result;
    }
}

/**
 * midi-qol.AttackRollComplete: midi decides criticals from the dice and its own flags, so a marked hit is made
 * critical on the workflow.
 * @param {object} workflow  midi-qol workflow.
 */
function _onMidiAttackRollComplete(workflow) {
    try {
        const roll = workflow?.attackRoll;
        if (!roll?.options?.[CRIT_ON_HIT] || workflow.isCritical || workflow.isFumble) return;
        if (_handledElsewhere() || !_ruleActive("condRollsAutoCrit")) return;
        const checksHits = (getMidiSettings()?.autoCheckHit ?? "none") !== "none";
        const hit = checksHits ? (workflow.hitTargets?.size > 0) : _markedRollHits(roll);
        if (!hit) return;
        workflow.isCritical = true;
        debug(`Condition Advantage & Disadvantage | midi-qol attack by ${workflow.actor?.name} is a critical hit`);
    } catch (err) {
        console.error(`${MODULE_ID} | Condition Advantage & Disadvantage: midi-qol critical hit failed`, err);
    }
}

// ── Automatically failed saves ────────────────────────────────────────

/**
 * Wrapper for the `D20Roll#total` getter: cap the total of a marked roll.
 * @this {D20Roll}
 */
function _wrapTotal(wrapped) {
    const total = wrapped();
    const maximum = this.options?.[MAXIMUM_TOTAL];
    return ((typeof maximum === "number") && (total > maximum)) ? maximum : total;
}

/**
 * dnd5e.preRollSavingThrow: Paralyzed, Petrified, Stunned and Unconscious creatures fail Strength and Dexterity
 * saves.
 * @param {object} config   Saving throw process configuration.
 * @param {object} _dialog
 * @param {object} message  Message configuration.
 */
function _onPreRollSavingThrow(config, _dialog, message) {
    try {
        if (_handledElsewhere() || !_ruleActive("condRollsAutoFailSaves")) return;
        if (!["str", "dex"].includes(config.ability)) return;
        const subject = config.subject;
        const actor = subject instanceof Actor ? subject : subject?.actor;
        const status = FAIL_STR_DEX_SAVES.find(s => _has(actor, s));
        if (!status) return;
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            roll.options[MAXIMUM_TOTAL] = 0;
            roll.options.criticalSuccess = 21;
        }
        const flavor = message?.data?.flavor;
        if (typeof flavor === "string") {
            const condition = game.i18n.localize(CONFIG.DND5E.conditionTypes[status]?.name ?? status);
            message.data.flavor = `${flavor} (${game.i18n.format("ND5T.ConditionRollModes.AutoFail", { condition })})`;
        }
        debug(`Condition Advantage & Disadvantage | ${actor.name} fails the ${config.ability} save automatically (${status})`);
    } catch (err) {
        console.error(`${MODULE_ID} | Condition Advantage & Disadvantage: preRollSavingThrow failed`, err);
    }
}

// ── Ability checks ────────────────────────────────────────────────────

/**
 * dnd5e.preRollAbilityCheck (ability checks, skills, tools, initiative): Frightened creatures have Disadvantage.
 * @param {object} config  Ability check process configuration.
 */
function _onPreRollAbilityCheck(config) {
    try {
        if (_handledElsewhere() || !_ruleActive("condRollsFrightened")) return;
        const subject = config.subject;
        const actor = subject instanceof Actor ? subject : subject?.actor;
        if (!_has(actor, "frightened")) return;
        debug(`Condition Advantage & Disadvantage | ${actor.name} makes an ability check while Frightened`);
        addRollModes(config, { disadvantage: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Condition Advantage & Disadvantage: preRollAbilityCheck failed`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize Condition Advantage & Disadvantage. Called once during the "setup" phase from main.js.
 * The hooks stay registered and check the settings on every call.
 */
export function initConditionRollModes() {
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    Hooks.on("dnd5e.preRollAbilityCheck", _onPreRollAbilityCheck);
    Hooks.on("dnd5e.preRollSavingThrow", _onPreRollSavingThrow);
    Hooks.on("midi-qol.AttackRollComplete", _onMidiAttackRollComplete);
    // The wrappers only act on rolls this feature marked, so they stay on whatever the settings say.
    patchMethod("CONFIG.Dice.D20Roll.prototype.isCritical#get", _wrapIsCritical, "WRAPPER");
    patchMethod("CONFIG.Dice.D20Roll.prototype.total#get", _wrapTotal, "WRAPPER");
    debug("Condition Advantage & Disadvantage | Initialized");
}
