/**
 * Feature: Reckless Attack
 * Description: Lets a creature with Reckless Attack decide on its first attack roll of the turn, without using the
 *              feature itself: a checkbox in the attack roll dialog, or a Yes / No prompt when the dialog is
 *              skipped. Attacking recklessly gives the attack Advantage and puts a Reckless effect on the attacker
 *              until the start of its next turn, during which:
 *              - 2014 rules: its melee weapon attacks using Strength have Advantage for the rest of this turn.
 *              - 2024 rules: its attack rolls using Strength have Advantage until the start of its next turn.
 *              - Both: attack rolls against it have Advantage.
 *
 * @introduced v14.80.0
 * @updated v14.80.1 (dnd5e's "start of next turn" effect expiry; the effect is also added out of combat)
 * @updated v14.85.0 (exports isActorReckless for Frenzy)
 */
import { MODULE_ID, debug, getSetting, isFeatureActive } from "../../context.js";
import { getMidiWorkflow } from "../../utils/module-compat.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { attackerToken, singleAttackTarget, addRollModes } from "../../utils/attack-context.js";

/**
 * How it works
 *
 * The feature (`identifier` "reckless-attack") is found on the actor; its own source rules (2014 / 2024) pick the
 * rules, falling back to the world's rules version.
 *
 * Offering the choice: the attacker has the feature, isn't Reckless yet, the personal setting is on and, in
 * combat, it is the attacker's own turn and its first attack roll this turn (attack rolls are counted on this
 * client in dnd5e.rollAttack). Out of combat there are no turns: the dialog offers the choice whenever the
 * creature isn't Reckless yet, but skipped dialogs don't prompt (a "No" would be asked again on every attack).
 *  - The attack must use Strength (2014: also be a melee weapon attack, so thrown counts as ranged).
 *  - Dialog: dnd5e.preRollAttack sets `config.nd5tRecklessOffer`; `AttackRollConfigurationDialog
 *    #_prepareConfigurationContext` is wrapped to add a checkbox to its configuration fields. Every rebuild runs
 *    dnd5e.postBuildAttackRollConfig, which disables the checkbox when the ability / attack mode doesn't
 *    qualify, marks the roll (`options.nd5tReckless`) when ticked, and updates the roll's advantage mode in the
 *    dialog config so the default button (and Roll Mode Highlight) follow. The button clicked decides the final
 *    mode, as always in dnd5e. The submit rebuild reads the form too, so the mark reaches the final roll.
 *  - Skipped dialog: `AttackActivity#rollAttack` (dnd5e's own class, so midi-qol's subclass has already decided
 *    whether to skip the dialog) is wrapped. If the dialog won't show, a Yes / No prompt asks first. Yes sets
 *    `config.nd5tReckless`, which dnd5e merges into the roll process config, and dnd5e.preRollAttack adds
 *    Advantage and the roll mark.
 *
 * After the roll: dnd5e.rollAttack creates the Reckless effect on the attacker when the roll is marked. It uses
 * dnd5e's own pseudo expiry `targetStart` ("until the start of your next turn", `ActiveEffect5e#isExpiryEvent`,
 * dnd5e 6.0 and 6.1): it ends on the start of the affected actor's next turn (skipping the turn it was made on),
 * out of combat when game time advances, and an effect made out of combat at the first turn start of a combat.
 * `targetStart` reads the turn from the actor the effect is on (the attacker), where `sourceStart` would have to
 * find it through the origin first. A deleteCombat hook removes effects left over from a combat that ended. An active effect from the Reckless Attack feature itself counts as Reckless
 * too, so using the feature by hand doesn't double anything.
 *
 * Advantage while Reckless (dnd5e.preRollAttack): the Reckless creature's qualifying attacks (2014: only during
 * the turn it attacked recklessly, from the effect's start; out of combat while the effect lasts), and attacks
 * against a Reckless single target.
 */

const IDENTIFIER = "reckless-attack";
const FLAG = "reckless";
const FIELD = "nd5tReckless";

/** Turn key of the last attack roll per actor UUID, on this client. */
const _lastAttackTurn = new Map();

// ── Settings / rules helpers ──────────────────────────────────────────

/** Whether Reckless Attack is on in the world (Advantage from Reckless creatures). */
function _worldActive() {
    try {
        return Boolean(getSetting("enableRecklessAttack"));
    } catch {
        return false;
    }
}

/** Whether this user is offered the choice. */
function _offerActive() {
    try {
        return isFeatureActive("enableRecklessAttack", "clientEnableRecklessAttack");
    } catch {
        return false;
    }
}

function _worldRules() {
    try {
        const version = dnd5e?.settings?.rulesVersion ?? game.settings.get("dnd5e", "rulesVersion");
        return version === "legacy" ? "2014" : "2024";
    } catch {
        return "2024";
    }
}

/**
 * Rules of a Reckless Attack item: its own source rules, or the world's.
 * @param {Item5e|null} item
 * @returns {"2014"|"2024"}
 */
function _itemRules(item) {
    const rules = item?.system?.source?.rules;
    return (rules === "2014" || rules === "2024") ? rules : _worldRules();
}

/**
 * Whether an item is the Reckless Attack feature.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isFeature(item) {
    return ((item?.identifier || item?.system?.identifier || "").toLowerCase() === IDENTIFIER);
}

/**
 * The actor's Reckless Attack feature.
 * @param {Actor5e|null} actor
 * @returns {Item5e|null}
 */
function _feature(actor) {
    return actor?.items?.find(i => (i.type === "feat") && _isFeature(i)) ?? null;
}

/**
 * Whether an attack qualifies for Reckless Attack's Advantage.
 * @param {"2014"|"2024"} rules
 * @param {string} ability     Ability the attack uses.
 * @param {string} actionType  "mwak", "rwak", "msak" or "rsak".
 * @returns {boolean}
 */
function _qualifies(rules, ability, actionType) {
    if (ability !== "str") return false;
    return (rules === "2024") || (actionType === "mwak");
}

// ── Combat helpers ────────────────────────────────────────────────────

/**
 * The started combat the actor is in, if any.
 * @param {Actor5e} actor
 * @returns {Combat|null}
 */
function _combatOf(actor) {
    const combat = game.combat;
    if (!combat?.started || !actor) return null;
    return combat.getCombatantsByActor?.(actor)?.length ? combat : null;
}

/**
 * Whether it is the actor's turn in the combat.
 * @param {Combat} combat
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isOwnTurn(combat, actor) {
    const current = combat?.combatant?.actor;
    return Boolean(current && actor && ((current === actor) || (current.uuid === actor.uuid)));
}

/**
 * @param {Combat} combat
 * @returns {string}
 */
function _turnKey(combat) {
    return `${combat.id}:${combat.round}:${combat.turn}`;
}

// ── Reckless state ────────────────────────────────────────────────────

/**
 * The actor's active Reckless effect (ours or one from the feature itself) and the rules it follows.
 * @param {Actor5e|null} actor
 * @returns {{effect: ActiveEffect, rules: "2014"|"2024"}|null}
 */
function _recklessState(actor) {
    if (!actor?.allApplicableEffects) return null;
    for (const effect of actor.allApplicableEffects()) {
        if (!effect.active || effect.duration?.expired) continue;
        const flag = effect.getFlag?.(MODULE_ID, FLAG);
        if (flag) return { effect, rules: flag.rules === "2014" ? "2014" : "2024" };
        // An effect from the feature itself: on the feature item, or with the feature as its origin
        let item = (effect.parent instanceof Item) ? effect.parent : null;
        if (!item && effect.origin) {
            try {
                const origin = fromUuidSync(effect.origin, { strict: false });
                if (origin instanceof Item) item = origin;
            } catch {
                // Origin not resolvable
            }
        }
        if (item && _isFeature(item) && (item.actor?.uuid === actor.uuid)) return { effect, rules: _itemRules(item) };
    }
    return null;
}

/**
 * Whether the actor attacked recklessly and the Reckless effect is still on (used by Frenzy in Conditional Damage).
 * @param {Actor5e|null} actor
 * @returns {boolean}
 */
export function isActorReckless(actor) {
    return Boolean(_recklessState(actor));
}

/**
 * Whether a Reckless effect started on the current turn of the current combat (2014: Advantage only that turn).
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function _startedThisTurn(effect) {
    const combat = game.combat;
    const start = effect.start;
    const startCombat = start?.combat?.id ?? start?.combat ?? null;
    // Made out of combat and still out of combat: there are no turns, so it lasts as long as the effect
    if (!startCombat) return !_combatOf(effect.actor);
    if (!combat?.started) return false;
    return (startCombat === combat.id) && (start.round === combat.round) && (start.turn === combat.turn);
}

/**
 * Whether the actor may decide to attack recklessly now (ignoring the attack's ability and type).
 * @param {Actor5e} actor
 * @returns {{feature: Item5e, rules: "2014"|"2024", combat: Combat|null}|null}
 */
function _offer(actor) {
    if (!_offerActive()) return null;
    const feature = _feature(actor);
    if (!feature || _recklessState(actor)) return null;
    const combat = _combatOf(actor);
    if (combat) {
        if (!_isOwnTurn(combat, actor)) return null;
        if (_lastAttackTurn.get(actor.uuid) === _turnKey(combat)) return null;
    }
    return { feature, rules: _itemRules(feature), combat };
}

// ── Attack rolls ──────────────────────────────────────────────────────

/**
 * dnd5e.preRollAttack: Advantage from attacking recklessly now, from being Reckless, and against a Reckless target.
 * Offers the choice in the dialog.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        if (!_worldActive()) return;
        const activity = config.subject;
        const actor = activity?.actor;
        if (!actor) return;
        let advantage = false;

        const actionType = activity.getActionType?.(config.attackMode);
        if (config[FIELD]) {
            // Chosen in the prompt before a skipped dialog
            advantage = true;
            for (const roll of config.rolls ?? []) {
                roll.options ??= {};
                roll.options[FIELD] = true;
            }
            debug(`Reckless Attack | ${actor.name} attacks recklessly`);
        } else {
            const state = _recklessState(actor);
            if (state) {
                if (_qualifies(state.rules, config.ability, actionType)
                    && ((state.rules === "2024") || _startedThisTurn(state.effect))) {
                    advantage = true;
                    debug(`Reckless Attack | ${actor.name} is Reckless: Advantage`);
                }
            } else if (_offer(actor)) {
                config.nd5tRecklessOffer = true;
            }
        }

        // Attacks against a Reckless creature
        const workflow = getMidiWorkflow(config);
        const target = singleAttackTarget(workflow);
        if (target?.actor && _recklessState(target.actor)) {
            const attacker = attackerToken(actor, workflow);
            if (attacker !== target) {
                advantage = true;
                debug(`Reckless Attack | ${target.name} is Reckless: Advantage for ${actor.name}`);
            }
        }

        if (advantage) addRollModes(config, { advantage: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: preRollAttack failed`, err);
    }
}

// ── Dialog ────────────────────────────────────────────────────────────

/**
 * Wrapper for `AttackRollConfigurationDialog#_prepareConfigurationContext`: add the Reckless Attack checkbox.
 * @this {AttackRollConfigurationDialog}
 */
async function _wrapPrepareConfigurationContext(wrapped, context, options) {
    context = await wrapped(context, options);
    try {
        if (!this.config?.nd5tRecklessOffer) return context;
        const feature = _feature(this.config.subject?.actor);
        const label = feature?.name || game.i18n.localize("ND5T.RecklessAttack.Label");
        const checked = this.form?.querySelector(`input[name="${FIELD}"]`)?.checked ?? false;
        context.fields ??= [];
        context.fields.push({
            field: new foundry.data.fields.BooleanField({ label }),
            name: FIELD,
            value: checked
        });
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: adding the dialog checkbox failed`, err);
    }
    return context;
}

/**
 * The roll's advantage mode in the dialog config, with or without attacking recklessly.
 * @param {object} process   The dialog's roll process configuration.
 * @param {object} rollConfig  One of its roll configurations.
 * @param {boolean} reckless
 * @returns {number}
 */
function _advantageMode(process, rollConfig, reckless) {
    const ADV = CONFIG.Dice.D20Roll.ADV_MODE;
    const advantage = Boolean(rollConfig.options?.advantage || process.advantage || reckless);
    const disadvantage = Boolean(rollConfig.options?.disadvantage || process.disadvantage);
    if (advantage && !disadvantage) return ADV.ADVANTAGE;
    if (!advantage && disadvantage) return ADV.DISADVANTAGE;
    return ADV.NORMAL;
}

/**
 * dnd5e.postBuildAttackRollConfig: follow the checkbox when the dialog (re)builds a roll.
 * @param {object} process  The dialog's roll process configuration.
 * @param {object} config   The roll configuration being built.
 * @param {number} index
 * @param {object} [options]
 * @param {RollConfigurationDialog} [options.app]
 * @param {FormDataExtended} [options.formData]
 */
function _onPostBuildAttackRollConfig(process, config, index, { app, formData } = {}) {
    try {
        if (!app || !process?.nd5tRecklessOffer) return;
        const activity = process.subject;
        const feature = _feature(activity?.actor);
        if (!feature) return;
        const ability = config.options?.ability ?? process.ability;
        const attackMode = config.options?.attackMode ?? process.attackMode;
        const eligible = _qualifies(_itemRules(feature), ability, activity.getActionType?.(attackMode));

        const input = app.form?.querySelector(`input[name="${FIELD}"]`);
        if (input) {
            input.disabled = !eligible;
            input.closest(".form-group")?.classList.toggle("disabled", !eligible);
        }
        const checked = eligible && (formData?.object?.[FIELD] === true);
        config.options ??= {};
        if (checked) config.options[FIELD] = true;
        else delete config.options[FIELD];

        // Default button: the dialog reads the advantage mode from its own config's rolls
        const rollConfig = process.rolls?.[index];
        if (!rollConfig) return;
        rollConfig.options ??= {};
        const mode = _advantageMode(process, rollConfig, checked);
        if (rollConfig.options.advantageMode === mode) return;
        rollConfig.options.advantageMode = mode;
        // Only while the dialog is open: the submit rebuild runs as it closes, and rendering would reopen it
        const isOpen = () => app.state === foundry.applications.api.ApplicationV2.RENDER_STATES.RENDERED;
        if (isOpen()) queueMicrotask(() => isOpen() && app.render({ parts: ["buttons"] }));
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: postBuildAttackRollConfig failed`, err);
    }
}

// ── Skipped dialog ────────────────────────────────────────────────────

/**
 * Whether dnd5e will skip the roll dialog: the caller (or midi-qol) said so, or a fast-forward key is held.
 * @param {object} config
 * @param {object} dialog
 * @returns {boolean}
 */
function _dialogSkipped(config, dialog) {
    if (dialog?.configure === false) return true;
    if (dialog?.configure === true) return false;
    const probe = {};
    CONFIG.Dice.D20Roll.applyKeybindings({ event: config?.event, rolls: [] }, probe, {});
    return probe.configure === false;
}

/**
 * The ability and attack mode the attack will use, as dnd5e's rollAttack works them out.
 * @param {AttackActivity} activity
 * @param {object} config
 * @returns {{ability: string|undefined, attackMode: string|undefined}}
 */
function _attackChoices(activity, config) {
    let ability = config.ability ?? activity.item?.getFlag("dnd5e", `last.${activity.id}.ability`);
    const abilityOptions = activity._getAbilityOptions?.() ?? [];
    if (abilityOptions.length && !abilityOptions.find(a => a.value === ability)) ability = abilityOptions[0]?.value;
    ability ??= activity.ability;
    let attackMode = config.attackMode ?? activity.item?.getFlag("dnd5e", `last.${activity.id}.attackMode`);
    const attackModes = activity.item?.system?.attackModes ?? [];
    if (!attackModes.find(m => m.value === attackMode)) attackMode = attackModes[0]?.value;
    return { ability, attackMode };
}

/**
 * Ask whether to attack recklessly.
 * @param {Actor5e} actor
 * @param {Item5e} feature
 * @param {"2014"|"2024"} rules
 * @returns {Promise<boolean>}
 */
async function _prompt(actor, feature, rules) {
    const content = `<p>${game.i18n.format(`ND5T.RecklessAttack.Prompt${rules}`, { name: foundry.utils.escapeHTML(actor.name) })}</p>`;
    const result = await foundry.applications.api.DialogV2.confirm({
        window: { title: feature.name || game.i18n.localize("ND5T.RecklessAttack.Label"), icon: "fa-solid fa-face-angry" },
        content,
        rejectClose: false,
        modal: true
    });
    return result === true;
}

/**
 * Wrapper for `AttackActivity#rollAttack` (dnd5e's class): ask before a first attack whose dialog is skipped.
 * @this {AttackActivity}
 */
async function _wrapRollAttack(wrapped, config = {}, dialog = {}, message = {}) {
    try {
        config ??= {};
        if (_worldActive() && !config[FIELD] && !config.midiOptions?.isDummy) {
            const actor = this.actor;
            const offer = actor ? _offer(actor) : null;
            // Out of combat there is no first attack of a turn, so no prompt there
            if (offer?.combat && _dialogSkipped(config, dialog)) {
                const { ability, attackMode } = _attackChoices(this, config);
                if (_qualifies(offer.rules, ability, this.getActionType?.(attackMode))) {
                    if (await _prompt(actor, offer.feature, offer.rules)) config[FIELD] = true;
                }
            }
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: prompt failed`, err);
    }
    return wrapped(config, dialog, message);
}

// ── After the roll ────────────────────────────────────────────────────

/**
 * dnd5e.rollAttack: count the attack for this turn, and make the attacker Reckless if it chose to be.
 * @param {D20Roll[]} rolls
 * @param {object} data
 * @param {AttackActivity|null} data.subject
 */
async function _onRollAttack(rolls, { subject } = {}) {
    try {
        const actor = subject?.actor;
        if (!actor) return;
        const combat = _combatOf(actor);
        if (combat && _isOwnTurn(combat, actor)) _lastAttackTurn.set(actor.uuid, _turnKey(combat));

        if (!_worldActive() || !rolls?.[0]?.options?.[FIELD]) return;
        if (_recklessState(actor) || !actor.isOwner) return;
        const feature = _feature(actor);
        const rules = _itemRules(feature);
        await actor.createEmbeddedDocuments("ActiveEffect", [{
            name: feature?.name || game.i18n.localize("ND5T.RecklessAttack.Label"),
            img: feature?.img || "icons/svg/combat.svg",
            origin: feature?.uuid ?? null,
            description: `<p>${game.i18n.localize(`ND5T.RecklessAttack.Description${rules}`)}</p>`,
            duration: { expiry: "targetStart" },
            showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
            flags: { [MODULE_ID]: { [FLAG]: { rules, combatId: combat?.id ?? null } } }
        }]);
        debug(`Reckless Attack | ${actor.name} is Reckless until the start of its next turn (${rules} rules)`);
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: creating the effect failed`, err);
    }
}

/**
 * deleteCombat: remove Reckless effects left over from that combat.
 * @param {Combat} combat
 */
async function _onDeleteCombat(combat) {
    try {
        if (!game.users.activeGM?.isSelf) return;
        for (const combatant of combat.combatants ?? []) {
            const actor = combatant.actor;
            const ids = (actor?.effects ?? [])
                .filter(e => e.getFlag(MODULE_ID, FLAG)?.combatId === combat.id)
                .map(e => e.id);
            if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Reckless Attack: cleanup after combat failed`, err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize Reckless Attack. Called once during the "setup" phase from main.js.
 * Hooks and wrappers stay registered and check the settings on every call.
 */
export function initRecklessAttack() {
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    Hooks.on("dnd5e.postBuildAttackRollConfig", _onPostBuildAttackRollConfig);
    Hooks.on("dnd5e.rollAttack", _onRollAttack);
    Hooks.on("deleteCombat", _onDeleteCombat);
    patchMethod("dnd5e.applications.dice.AttackRollConfigurationDialog.prototype._prepareConfigurationContext",
        _wrapPrepareConfigurationContext, "WRAPPER");
    patchMethod("dnd5e.documents.activity.AttackActivity.prototype.rollAttack", _wrapRollAttack, "WRAPPER");
    debug("Reckless Attack | Initialized");
}
