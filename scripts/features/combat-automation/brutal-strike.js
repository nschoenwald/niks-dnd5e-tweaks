/**
 * Feature: Brutal Strike
 * Description: Automates the 2024 Barbarian's Brutal Strike (level 9), Improved Brutal Strike (13) and Improved
 *              Brutal Strike (2) (17). The choice is made at the attack roll, next to Reckless Attack: a checkbox
 *              in the attack roll dialog, a third answer in the Reckless prompt, or a Yes / No prompt on later
 *              attacks of the turn when the dialog is skipped. The chosen roll forgoes Advantage (not offered with
 *              Disadvantage or several targets). On a hit, the damage roll gets the extra damage in the weapon's
 *              damage type, and the attacker's player (the GM when that player is offline) picks the effect(s):
 *              Forceful Blow (a chat reminder only, no token movement), Hamstring Blow, Staggering Blow and
 *              Sundering Blow, each until the start of the attacker's next turn.
 *
 * @introduced v14.113.0
 * @updated v14.114.0 (ticking Brutal Strike also ticks Reckless Attack; own copy of the damage roll data; debug
 *   lines from the damage roll to the picker; the hit is remembered before the attack's chat card exists, so damage
 *   rolled from that card (Prompt / Auto-Roll Attack Damage) gets the extra damage and the picker)
 * @updated v14.114.1 (combat-end cleanup leaves combatants to dnd5e; deletions tolerate effects removed meanwhile)
 * @updated v14.115.5 (Staggered stays until the start of the attacker's next turn after the save; only the
 *   Disadvantage is used up)
 */
import { MODULE_ID, debug, getSetting, isFeatureActive } from "../../context.js";
import { getMidiWorkflow } from "../../utils/module-compat.js";
import { deleteEffect, deleteEffects } from "../../utils/effect-deletion.js";
import { addRollModes, attackTargets, singleAttackTarget } from "../../utils/attack-context.js";
import { isActorReckless, registerRecklessExtension, RECKLESS_FIELD } from "./reckless-attack.js";
import { isSharedTurn } from "./summon-initiative.js";
import { getBrutalStrikeFormula } from "./conditional-damage.js";

/**
 * How it works
 *
 * Feature: the actor's feats with the identifiers `brutal-strike`, `improved-brutal-strike` and
 * `improved-brutal-strike-2` (English names as fallback for items without one) give the tier (1 / 2 / 3). 2014
 * items and items automated by midi-qol macros or Chris's Premades are ignored. The result is cached per actor and
 * cleared when one of its feats changes, so actors without Brutal Strike cost one Map lookup per roll.
 *
 * Choosing (client of the attacker): offered on the attacker's own turn, once per turn (any turn out of combat),
 * when the actor is Reckless or Reckless Attack is offered on this roll. dnd5e.preRollAttack marks the process
 * (`nd5tBrutalOffer`); the Reckless extension adds the checkbox. dnd5e.postBuildAttackRollConfig enables it only for
 * Strength attacks with Reckless (already, or offered on this roll), no Disadvantage and at most one target. Ticking
 * it ticks Reckless Attack too (which then creates its effect as usual); unticking Reckless unticks it. It marks the roll
 * (`options.nd5tBrutalStrike`) and moves the default button to Normal. dnd5e.postAttackRollConfiguration makes the
 * final roll a normal d20 roll, or drops the mark when the roll has Disadvantage after all.
 *
 * Remembering the attack: dnd5e.postAttackRollConfiguration (before evaluation, and before dnd5e creates the chat card
 * that Prompt / Auto-Roll Attack Damage rolls damage from) leaves a pending record per actor for the attack's activity
 * and its roll, kept 10 minutes on this client. Whether it hit is read from that roll once evaluated (crit, fumble,
 * total against the target's AC; unknown without an AC). dnd5e.rollAttack counts the turn as used, hit or miss, and
 * drops the record on a miss.
 * dnd5e.preRollDamage adds the extra damage as its own roll (scale value, weapon damage type, no extra crit dice);
 * with midi-qol only when the workflow hit something. dnd5e.rollDamage then opens the picker, on this client or,
 * through the socket, on the client of the actor's player (the active GM when no player owner is online).
 *
 * Effects: copied from the Brutal Strike item (the activity's effects, then the PHB effect ids, then the English
 * effect name), or built from our own definition when missing. Each gets a flag (`kind`, `source`, `combatId`) and
 * dnd5e's `sourceStart` expiry. A registry of actor UUID → our effect ids, kept by create / delete hooks, lets the
 * save and attack hooks skip every actor without them. Staggered: Disadvantage on the next save, which then marks
 * the effect (`saveUsed`); the effect itself stays until its expiry (no Opportunity Attacks until then).
 * Sundered: +5 on the next attack against the creature by anyone but its source, then removed. A new Hamstring
 * replaces the old one. Writes go through the owner, or the active GM via the socket.
 */

const FIELD = "nd5tBrutalStrike";
const FLAG = "brutalStrike";
const SOCKET = `module.${MODULE_ID}`;
const PENDING_TTL = 10 * 60 * 1000;
const DEFAULT_ICON = "icons/skills/melee/strike-axe-blood-red.webp";

const IDENTIFIERS = {
    base: "brutal-strike",
    improved: "improved-brutal-strike",
    improved2: "improved-brutal-strike-2"
};

/** English name fallbacks, only for items without an identifier. */
const NAME_FALLBACKS = {
    base: /^brutal strike$/i,
    improved: /^improved brutal strike$/i,
    improved2: /^improved brutal strike \(2\)$/i
};

/** Effect kinds in picker order, and the tier that unlocks each. */
const KINDS = ["forceful", "hamstring", "staggering", "sundering"];
const KIND_TIER = { forceful: 1, hamstring: 1, staggering: 2, sundering: 2 };
const KIND_KEY = { forceful: "Forceful", hamstring: "Hamstring", staggering: "Staggering", sundering: "Sundering" };

/** Activity and effect ids in the Player's Handbook's Brutal Strike item. */
const PHB_IDS = {
    forceful: { activity: "WKgVJp5AQRLqOlDh", effects: [] },
    hamstring: { activity: "l33Ty0yfpOXRiLve", effects: ["bg9jWpPRIJ0Q2vPY"] },
    staggering: { activity: "vcAdrcmUKQWA68QT", effects: ["uacly0JAXLVwAS6y"] },
    sundering: { activity: "MP1qQsApCj19F2M5", effects: ["Q0ou16II1WEcCdyW"] }
};

/** English activity / effect names, fallbacks for items without the PHB ids. */
const ACTIVITY_NAMES = { forceful: "Forceful Blow", hamstring: "Hamstring Blow", staggering: "Staggering Blow", sundering: "Sundering Blow" };
const EFFECT_NAMES = { hamstring: "Hamstrung", staggering: "Staggered", sundering: "Sundered" };

/** Changes of our own effects (the mechanics of Staggered and Sundered come from the roll hooks). */
const OWN_CHANGES = {
    hamstring: [{ key: "system.attributes.movement.bonus", type: "add", value: "-15", priority: 20 }],
    staggering: [],
    sundering: []
};

/** Actor UUID → `{ item, tier, sources }` or null (no usable Brutal Strike). */
const _features = new Map();

/** Actor UUID → turn key of the turn Brutal Strike was used on. */
const _usedTurn = new Map();

/** Actor UUID → pending Brutal Strike hit waiting for its damage roll. */
const _pending = new Map();

/** Actor UUID → Map(effect id → kind) of our effects on that actor. */
const _applied = new Map();

/** UUIDs of Staggered effects whose Disadvantage was used on this client (before the flag update arrives). */
const _staggerUsed = new Set();

/** Actor UUID → kinds last picked on this client (preselected next time). */
const _lastChoice = new Map();

// ── Settings / rules helpers ──────────────────────────────────────────

/** Whether this user chooses Brutal Strike with the automation. */
function _clientActive() {
    try {
        return isFeatureActive("enableBrutalStrike", "clientEnableBrutalStrike");
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
 * @param {Item5e} item
 * @returns {string}
 */
function _identifier(item) {
    return (item?.identifier || item?.system?.identifier || "").toLowerCase();
}

/**
 * Whether a feat is one of the Brutal Strike features.
 * @param {Item5e} item
 * @param {"base"|"improved"|"improved2"} key
 * @returns {boolean}
 */
function _matches(item, key) {
    const id = _identifier(item);
    return id ? (id === IDENTIFIERS[key]) : NAME_FALLBACKS[key].test(item?.name ?? "");
}

/**
 * Whether another module automates this Brutal Strike item (midi-qol on-use macro, Chris's Premades).
 * @param {Item5e} item
 * @returns {boolean}
 */
function _externallyAutomated(item) {
    const flags = item?.flags ?? {};
    return Boolean(flags["midi-qol"]?.onUseMacroName || flags["chris-premades"]);
}

/**
 * The actor's Brutal Strike: the feature item and its tier (1: level 9, 2: Improved, 3: Improved (2)). Cached.
 * @param {Actor5e|null} actor
 * @returns {{item: Item5e, tier: number, sources: object}|null}
 */
function _brutal(actor) {
    if (!actor?.items) return null;
    const key = actor.uuid;
    if (_features.has(key)) return _features.get(key);
    let item = null;
    let tier = 0;
    for (const i of actor.items) {
        if (i.type !== "feat") continue;
        if (_matches(i, "improved2")) tier = Math.max(tier, 3);
        else if (_matches(i, "improved")) tier = Math.max(tier, 2);
        else if (_matches(i, "base")) {
            item = i;
            tier = Math.max(tier, 1);
        }
    }
    const rules = item?.system?.source?.rules;
    const itemRules = (rules === "2014" || rules === "2024") ? rules : _worldRules();
    const value = (item && (itemRules === "2024") && !_externallyAutomated(item)) ? { item, tier, sources: {} } : null;
    _features.set(key, value);
    return value;
}

/**
 * createItem / updateItem / deleteItem: forget the cached feature of the item's actor.
 * @param {Item5e} item
 */
function _onItemChange(item) {
    if ((item?.type === "feat") && (item.parent instanceof Actor)) _features.delete(item.parent.uuid);
}

// ── Combat helpers ────────────────────────────────────────────────────

/**
 * @param {Actor5e} actor
 * @returns {Combat|null}
 */
function _combatOf(actor) {
    const combat = game.combat;
    if (!combat?.started || !actor) return null;
    return combat.getCombatantsByActor?.(actor)?.length ? combat : null;
}

/**
 * @param {Combat} combat
 * @param {Actor5e} actor
 * @returns {boolean}
 */
function _isOwnTurn(combat, actor) {
    const current = combat?.combatant?.actor;
    if (current && actor && ((current === actor) || (current.uuid === actor.uuid))) return true;
    return isSharedTurn(combat, actor);
}

/**
 * @param {Combat} combat
 * @returns {string}
 */
function _turnKey(combat) {
    return `${combat.id}:${combat.round}:${combat.turn}`;
}

/**
 * Whether Brutal Strike may be chosen now, ignoring the attack itself and Reckless Attack.
 * @param {Actor5e} actor
 * @returns {{item: Item5e, tier: number, sources: object}|null}
 */
function _offer(actor) {
    const feature = _brutal(actor);
    if (!feature || !_clientActive()) return null;
    const combat = _combatOf(actor);
    if (combat && (!_isOwnTurn(combat, actor) || (_usedTurn.get(actor.uuid) === _turnKey(combat)))) return null;
    return feature;
}

/**
 * Whether the attack has at most one target (Brutal Strike hits one creature).
 * @param {object} config  Attack roll process configuration.
 * @returns {boolean}
 */
function _targetsAllowed(config) {
    return attackTargets(getMidiWorkflow(config)).length <= 1;
}

// ── Attack rolls ──────────────────────────────────────────────────────

/**
 * dnd5e.preRollAttack: Sundering Blow's +5, the Brutal Strike offer, and the mark from a prompt.
 * Runs after Reckless Attack's hook, so its offer is known.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        const actor = config.subject?.actor;
        if (!actor) return;
        if (_applied.size) _addSunderingBonus(config, actor);
        if (!_offer(actor)) return;
        if (config[FIELD]) {
            // Chosen in a prompt before a skipped dialog
            for (const roll of config.rolls ?? []) {
                roll.options ??= {};
                roll.options[FIELD] = true;
            }
            debug(`Brutal Strike | ${actor.name} uses Brutal Strike`);
        } else if (config.nd5tRecklessOffer || isActorReckless(actor)) {
            config.nd5tBrutalOffer = true;
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: preRollAttack failed`, err);
    }
}

/**
 * Reckless extension: the Brutal Strike checkbox in the attack roll dialog.
 * @param {AttackRollConfigurationDialog} app
 * @param {object} context
 */
function _dialogFields(app, context) {
    if (!app.config?.nd5tBrutalOffer) return;
    const feature = _brutal(app.config.subject?.actor);
    if (!feature) return;
    const checked = app.form?.querySelector(`input[name="${FIELD}"]`)?.checked ?? false;
    context.fields ??= [];
    context.fields.push({
        field: new foundry.data.fields.BooleanField({
            label: feature.item.name || game.i18n.localize("ND5T.BrutalStrike.Label"),
            hint: game.i18n.localize("ND5T.BrutalStrike.DialogHint")
        }),
        name: FIELD,
        value: checked
    });
}

/**
 * The advantage mode the dialog shows without Brutal Strike.
 * @param {object} process
 * @param {object} rollConfig
 * @param {boolean} reckless  Reckless Attack ticked on this roll.
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

/** Dialog → the Brutal Strike / Reckless Attack checkbox states of its last build. */
const _dialogState = new WeakMap();

/**
 * dnd5e.postBuildAttackRollConfig: follow the checkbox when the dialog (re)builds a roll. Runs after Reckless Attack's.
 * Brutal Strike needs Reckless Attack: ticking it also ticks Reckless Attack (when that is offered on this roll), and
 * unticking Reckless Attack unticks it.
 * @param {object} process
 * @param {object} config
 * @param {number} index
 * @param {object} [options]
 * @param {RollConfigurationDialog} [options.app]
 * @param {FormDataExtended} [options.formData]
 */
function _onPostBuildAttackRollConfig(process, config, index, { app, formData } = {}) {
    try {
        if (!app || !process?.nd5tBrutalOffer) return;
        const actor = process.subject?.actor;
        const rollConfig = process.rolls?.[index];
        const ability = config.options?.ability ?? process.ability;
        const recklessInput = app.form?.querySelector(`input[name="${RECKLESS_FIELD}"]`) ?? null;
        const recklessOffered = Boolean(process.nd5tRecklessOffer && recklessInput && !recklessInput.disabled);
        const alreadyReckless = !process.nd5tRecklessOffer && isActorReckless(actor);
        const disadvantage = Boolean(rollConfig?.options?.disadvantage || process.disadvantage);
        const eligible = (ability === "str") && (alreadyReckless || recklessOffered)
            && !disadvantage && _targetsAllowed(process);

        const input = app.form?.querySelector(`input[name="${FIELD}"]`);
        if (input) {
            input.disabled = !eligible;
            input.closest(".form-group")?.classList.toggle("disabled", !eligible);
        }

        let checked = eligible && (formData?.object?.[FIELD] === true);
        let recklessTicked = recklessOffered && (formData?.object?.[RECKLESS_FIELD] === true);
        if (checked && recklessOffered && !recklessTicked) {
            // Reckless Attack was just unticked while Brutal Strike stayed ticked: Brutal Strike goes too.
            // Otherwise Brutal Strike was just ticked: Reckless Attack comes with it.
            const previous = _dialogState.get(app);
            if (previous?.brutal && previous.reckless) {
                checked = false;
                if (input) input.checked = false;
            } else {
                recklessTicked = true;
                recklessInput.checked = true;
                // Reckless Attack's hook already ran for this build without the tick: mark the roll here
                config.options ??= {};
                config.options[RECKLESS_FIELD] = true;
            }
        }
        if (index === 0) _dialogState.set(app, { brutal: checked, reckless: recklessTicked });

        config.options ??= {};
        if (checked) config.options[FIELD] = true;
        else delete config.options[FIELD];

        if (!rollConfig) return;
        rollConfig.options ??= {};
        const mode = checked ? CONFIG.Dice.D20Roll.ADV_MODE.NORMAL : _advantageMode(process, rollConfig, recklessTicked);
        if (rollConfig.options.advantageMode === mode) return;
        rollConfig.options.advantageMode = mode;
        const isOpen = () => app.state === foundry.applications.api.ApplicationV2.RENDER_STATES.RENDERED;
        if (isOpen()) queueMicrotask(() => isOpen() && app.render({ parts: ["buttons"] }));
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: postBuildAttackRollConfig failed`, err);
    }
}

/**
 * Whether a Brutal Strike attack roll hit: true, false, or null while it isn't evaluated or no AC is known.
 * @param {D20Roll|null} roll
 * @returns {boolean|null}
 */
function _hitOf(roll) {
    if (!roll?._evaluated) return null;
    if (roll.isCritical) return true;
    if (roll.isFumble) return false;
    return Number.isFinite(roll.options?.target) ? roll.total >= roll.options.target : null;
}

/**
 * Remember a Brutal Strike attack for its damage roll, before it is evaluated. dnd5e creates the attack's chat card
 * before `dnd5e.rollAttack`, and Prompt / Auto-Roll Attack Damage (or another module) can start the damage roll
 * from that card, so waiting for `dnd5e.rollAttack` is too late. Whether it hit is read from the roll later.
 * @param {AttackActivity|null} activity
 * @param {D20Roll} roll
 */
function _remember(activity, roll) {
    const actor = activity?.actor;
    if (!actor) return;
    _pending.set(actor.uuid, {
        activityUuid: activity.uuid,
        roll,
        targets: Array.from(game.user.targets, t => t.document?.uuid).filter(Boolean),
        time: Date.now(),
        damage: false
    });
}

/**
 * dnd5e.postAttackRollConfiguration: a Brutal Strike roll is a normal roll, whatever button was clicked. A roll
 * with Disadvantage can't be chosen: the mark is dropped.
 * @param {D20Roll[]} rolls
 */
function _onPostAttackRollConfiguration(rolls, config) {
    try {
        const ADV = CONFIG.Dice.D20Roll.ADV_MODE;
        for (const roll of rolls ?? []) {
            if (!roll.options?.[FIELD]) continue;
            if ((roll.options.advantageMode === ADV.DISADVANTAGE) || roll.options.disadvantage) {
                delete roll.options[FIELD];
                ui.notifications.warn(game.i18n.localize("ND5T.BrutalStrike.Disadvantage"));
                continue;
            }
            roll.options.advantage = false;
            if (roll.options.advantageMode !== ADV.NORMAL) {
                roll.options.advantageMode = ADV.NORMAL;
                roll.d20?.applyAdvantage(ADV.NORMAL);
                roll.resetFormula();
            }
            _remember(config?.subject, roll);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: postAttackRollConfiguration failed`, err);
    }
}

// ── Prompts for skipped dialogs ───────────────────────────────────────

/**
 * Reckless extension: "Reckless + Brutal Strike" in the Reckless prompt of a first attack.
 * @param {Actor5e} actor
 * @param {AttackActivity} activity
 * @param {{ability: string}} choices
 * @returns {object|null}
 */
function _promptChoice(actor, activity, choices) {
    if ((choices.ability !== "str") || !_offer(actor) || !_targetsAllowed({})) return null;
    return {
        action: "brutalStrike",
        label: game.i18n.localize("ND5T.BrutalStrike.PromptRecklessAndBrutal"),
        icon: "fa-solid fa-hammer-crash",
        apply: config => { config[FIELD] = true; }
    };
}

/**
 * Reckless extension: on a later attack of the turn with a skipped dialog, ask whether to use Brutal Strike.
 * @param {AttackActivity} activity
 * @param {object} config
 * @param {{ability: string}} choices
 */
async function _skippedPrompt(activity, config, choices) {
    if (config[FIELD] || (choices.ability !== "str")) return;
    const actor = activity.actor;
    // Out of combat there are no turns, so a "No" would be asked on every attack
    if (!_combatOf(actor) || !getSetting("brutalStrikeFollowPrompt")) return;
    const feature = _offer(actor);
    if (!feature || !isActorReckless(actor) || !_targetsAllowed(config)) return;
    const result = await foundry.applications.api.DialogV2.confirm({
        window: { title: feature.item.name || game.i18n.localize("ND5T.BrutalStrike.Label"), icon: "fa-solid fa-hammer-crash" },
        content: `<p>${game.i18n.format("ND5T.BrutalStrike.Prompt", { name: foundry.utils.escapeHTML(actor.name) })}</p>`,
        rejectClose: false,
        modal: true
    });
    if (result === true) config[FIELD] = true;
}

// ── After the attack ──────────────────────────────────────────────────

/**
 * dnd5e.rollAttack: use up Sundered, count the turn, and remember a hit for its damage roll.
 * @param {D20Roll[]} rolls
 * @param {object} data
 * @param {AttackActivity|null} data.subject
 */
function _onRollAttack(rolls, { subject } = {}) {
    try {
        const roll = rolls?.[0];
        if (!roll) return;
        if (roll.options?.nd5tSundered) _removeEffectByUuid(roll.options.nd5tSundered);
        if (!roll.options?.[FIELD]) return;
        const actor = subject?.actor;
        if (!actor) return;
        const combat = _combatOf(actor);
        if (combat) _usedTurn.set(actor.uuid, _turnKey(combat));

        const hit = _hitOf(roll);
        if (hit === false) {
            _pending.delete(actor.uuid);
            debug(`Brutal Strike | ${actor.name} missed: Brutal Strike is used up`);
            return;
        }
        // Remembered in postAttackRollConfiguration; a damage roll may already have used it (auto-rolled damage)
        const pending = _pending.get(actor.uuid);
        if (pending?.activityUuid === subject.uuid) pending.roll = roll;
        else _remember(subject, roll);
        debug(`Brutal Strike | ${actor.name} ${hit ? "hit" : "attacked (no AC known)"}${pending?.damage ? ", extra damage already added" : ": waiting for the damage roll"}`);
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: rollAttack failed`, err);
    }
}

/**
 * The pending Brutal Strike of a damage roll's activity, or null.
 * @param {Activity} activity
 * @returns {object|null}
 */
function _pendingFor(activity) {
    const actor = activity?.actor;
    const pending = actor ? _pending.get(actor.uuid) : null;
    if (!pending || (pending.activityUuid !== activity.uuid)) return null;
    if ((Date.now() - pending.time) > PENDING_TTL) {
        _pending.delete(actor.uuid);
        return null;
    }
    return pending;
}

/**
 * dnd5e.preRollDamage: add the extra damage to the damage roll of a Brutal Strike hit.
 * @param {object} config  Damage roll process configuration.
 */
function _onPreRollDamage(config) {
    try {
        if (!_pending.size || (config.hookNames && !config.hookNames.includes("damage"))) return;
        const activity = config.subject;
        const pending = _pendingFor(activity);
        if (!pending || pending.damage) return;
        const actor = activity.actor;
        if (_hitOf(pending.roll) === false) {
            _pending.delete(actor.uuid);
            return;
        }

        const workflow = getMidiWorkflow(config);
        if (workflow) {
            const hits = Array.from(workflow.hitTargets ?? [], t => (t?.document ?? t)?.uuid).filter(Boolean);
            if (!hits.length) {
                _pending.delete(actor.uuid);
                return;
            }
            pending.targets = hits;
        }

        const base = config.rolls?.[0];
        if (!base || config.rolls.some(r => r.options?.[FIELD])) return;
        const feature = _brutal(actor);
        const formula = getBrutalStrikeFormula(actor) || ((feature?.tier ?? 1) >= 3 ? "2d10" : "1d10");
        const flavor = (feature?.item.name || game.i18n.localize("ND5T.BrutalStrike.Label")).replace(/[[\]]/g, "");
        const type = base.options?.type ?? base.options?.types?.[0] ?? null;
        const types = base.options?.types?.length ? [...base.options.types] : (type ? [type] : []);
        const options = {
            type,
            types,
            flavor,
            properties: [...(base.options?.properties ?? [])],
            critical: { bonusDice: 0 },
            _nd5tTypedBonus: true,
            [FIELD]: true
        };
        if (config.isCritical) options.isCritical = true;
        // Own copy of the roll data: dnd5e writes this roll's damage type into `data.roll.damage`, which a shallow
        // copy would share with the weapon's roll
        config.rolls.push({ parts: [`${formula}[${flavor}]`], data: foundry.utils.deepClone(base.data ?? {}), options });
        pending.damage = true;
        debug(`Brutal Strike | +${formula} ${type ?? ""} damage for ${actor.name}`);
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: preRollDamage failed`, err);
    }
}

/**
 * dnd5e.rollDamage: after the damage of a Brutal Strike hit, ask for the effect(s).
 * @param {DamageRoll[]} rolls
 * @param {object} data
 * @param {Activity|null} data.subject
 */
function _onRollDamage(rolls, { subject } = {}) {
    try {
        const marked = Boolean(rolls?.some(r => r.options?.[FIELD]));
        const pending = _pending.size ? _pendingFor(subject) : null;
        if (!pending) {
            if (marked) debug(`Brutal Strike | Damage with Brutal Strike for ${subject?.actor?.name}, but no remembered hit for ${subject?.uuid}`);
            return;
        }
        debug(`Brutal Strike | Damage rolled for ${subject.actor.name}: extra damage added ${pending.damage}, marked roll ${marked}`);
        if (!pending.damage || !marked) return;
        _pending.delete(subject.actor.uuid);
        _requestPicker(subject.actor, pending.targets);
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: rollDamage failed`, err);
    }
}

// ── Picker ────────────────────────────────────────────────────────────

/**
 * Who picks the effect: the actor's player (its character first), or the active GM when none is online.
 * @param {Actor5e} actor
 * @returns {User|null}
 */
function _pickerUser(actor) {
    const owners = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
    return owners.find(u => u.character?.id === actor.id) ?? owners[0] ?? game.users.activeGM ?? null;
}

/**
 * Open the picker on the right client.
 * @param {Actor5e} actor
 * @param {string[]} targets  Token document UUIDs.
 */
function _requestPicker(actor, targets) {
    const user = _pickerUser(actor);
    const data = { actorUuid: actor.uuid, targets };
    if (!user || user.isSelf) {
        debug(`Brutal Strike | Opening the effect picker here for ${actor.name} (${targets.length} target(s))`);
        _openPicker(data);
        return;
    }
    debug(`Brutal Strike | ${user.name} picks the effect for ${actor.name}`);
    game.socket.emit(SOCKET, { action: "brutalStrikePicker", userId: user.id, ...data });
}

/**
 * The label of an effect kind: the item's activity name, or ours.
 * @param {{item: Item5e}} feature
 * @param {string} kind
 * @returns {string}
 */
function _kindLabel(feature, kind) {
    return _activity(feature.item, kind)?.name || game.i18n.localize(`ND5T.BrutalStrike.${KIND_KEY[kind]}.Label`);
}

/**
 * The picker: one effect (two different ones at Improved Brutal Strike (2)).
 * @param {{actorUuid: string, targets: string[]}} data
 */
async function _openPicker({ actorUuid, targets = [] }) {
    try {
        const actor = fromUuidSync(actorUuid, { strict: false });
        const feature = _brutal(actor);
        if (!feature) {
            debug(`Brutal Strike | No effect picker: ${actor?.name ?? actorUuid} has no usable Brutal Strike`);
            return;
        }
        const kinds = KINDS.filter(k => feature.tier >= KIND_TIER[k]);
        const max = feature.tier >= 3 ? 2 : 1;
        const last = _lastChoice.get(actor.uuid) ?? [];
        const inputType = max > 1 ? "checkbox" : "radio";
        const escape = foundry.utils.escapeHTML;
        const targetDocs = targets.map(uuid => fromUuidSync(uuid, { strict: false })).filter(Boolean);
        const targetNames = targetDocs.map(t => t.name).join(", ");

        const options = kinds.map((kind, i) => {
            const checked = last.length ? last.includes(kind) : ((max === 1) && (i === 0));
            return `<label class="nd5t-brutal-option">
                <input type="${inputType}" name="effect" value="${kind}"${checked ? " checked" : ""}>
                <span class="nd5t-brutal-text">
                    <strong>${escape(_kindLabel(feature, kind))}</strong>
                    <span class="nd5t-brutal-hint">${escape(game.i18n.localize(`ND5T.BrutalStrike.${KIND_KEY[kind]}.Hint`))}</span>
                </span>
            </label>`;
        }).join("");
        const lead = game.i18n.localize(max > 1 ? "ND5T.BrutalStrike.PickTwo" : "ND5T.BrutalStrike.PickOne");
        const on = targetNames ? `<p class="nd5t-brutal-target">${escape(game.i18n.format("ND5T.BrutalStrike.Target", { target: targetNames }))}</p>` : "";
        const content = `<div class="nd5t-brutal-strike-picker"><p>${escape(lead)}</p>${on}${options}</div>`;

        const picked = await foundry.applications.api.DialogV2.wait({
            window: { title: `${feature.item.name}: ${actor.name}`, icon: "fa-solid fa-hammer-crash" },
            content,
            rejectClose: false,
            buttons: [
                {
                    action: "apply",
                    label: game.i18n.localize("ND5T.BrutalStrike.Apply"),
                    icon: "fa-solid fa-check",
                    default: true,
                    callback: (event, button) => Array.from(button.form.querySelectorAll('input[name="effect"]:checked'), i => i.value)
                },
                { action: "skip", label: game.i18n.localize("ND5T.BrutalStrike.Skip"), icon: "fa-solid fa-xmark" }
            ],
            render: (event, dialog) => {
                if (max < 2) return;
                const root = dialog.element ?? event?.target?.element;
                const inputs = Array.from(root?.querySelectorAll('input[name="effect"]') ?? []);
                const limit = () => {
                    const full = inputs.filter(i => i.checked).length >= max;
                    for (const i of inputs) i.disabled = full && !i.checked;
                };
                for (const i of inputs) i.addEventListener("change", limit);
                limit();
            }
        });
        debug(`Brutal Strike | Effect picker closed for ${actor.name}`, picked);
        if (!Array.isArray(picked) || !picked.length) return;
        const chosen = KINDS.filter(k => picked.includes(k) && kinds.includes(k)).slice(0, max);
        _lastChoice.set(actor.uuid, chosen);
        await _applyChoice(actor, feature, chosen, targetDocs);
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: the effect picker failed`, err);
    }
}

// ── Effects ───────────────────────────────────────────────────────────

/**
 * The activity of an effect kind on the Brutal Strike item.
 * @param {Item5e} item
 * @param {string} kind
 * @returns {Activity|null}
 */
function _activity(item, kind) {
    const activities = item?.system?.activities;
    if (!activities) return null;
    return activities.get?.(PHB_IDS[kind].activity)
        ?? activities.find?.(a => a.name === ACTIVITY_NAMES[kind])
        ?? null;
}

/**
 * The item's effect for a kind, looked up once per cached feature.
 * @param {{item: Item5e, sources: object}} feature
 * @param {string} kind
 * @returns {ActiveEffect|null}
 */
function _sourceEffect(feature, kind) {
    if (kind in feature.sources) return feature.sources[kind];
    const item = feature.item;
    const fromActivity = (_activity(item, kind)?.effects ?? []).map(e => item.effects.get(e._id)).find(Boolean);
    const effect = fromActivity
        ?? PHB_IDS[kind].effects.map(id => item.effects.get(id)).find(Boolean)
        ?? item.effects.find(e => e.name === EFFECT_NAMES[kind])
        ?? null;
    feature.sources[kind] = effect;
    return effect;
}

/**
 * Data of one Brutal Strike effect: the item's own, or ours when the item has none.
 * @param {string} kind
 * @param {Actor5e} attacker
 * @param {{item: Item5e, sources: object}} feature
 * @returns {object}
 */
function _effectData(kind, attacker, feature) {
    const source = _sourceEffect(feature, kind);
    const key = KIND_KEY[kind];
    let data;
    if (source) {
        data = source.toObject();
        delete data._id;
        delete data.start;
        delete data.folder;
        data.duration = { ...(data.duration ?? {}), expiry: "sourceStart", expired: false };
    } else {
        data = {
            name: game.i18n.localize(`ND5T.BrutalStrike.${key}.Effect`),
            img: DEFAULT_ICON,
            description: `<p>${game.i18n.localize(`ND5T.BrutalStrike.${key}.Description`)}</p>`,
            duration: { expiry: "sourceStart" },
            system: { changes: foundry.utils.deepClone(OWN_CHANGES[kind]) }
        };
    }
    data.transfer = false;
    data.disabled = false;
    data.origin = feature.item.uuid;
    data.showIcon = CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS;
    data.system ??= {};
    data.system.origin = { ...(data.system.origin ?? {}), actor: attacker.uuid, item: feature.item.uuid };
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG}`, {
        kind,
        source: attacker.uuid,
        combatId: _combatOf(attacker)?.id ?? null
    });
    return data;
}

/**
 * Post the choice and apply the effects to the target(s).
 * @param {Actor5e} attacker
 * @param {{item: Item5e, tier: number, sources: object}} feature
 * @param {string[]} kinds
 * @param {TokenDocument[]} targets
 */
async function _applyChoice(attacker, feature, kinds, targets) {
    const escape = foundry.utils.escapeHTML;
    const effects = kinds.map(k => _kindLabel(feature, k)).join(game.i18n.localize("ND5T.BrutalStrike.And"));
    const targetNames = targets.map(t => t.name).join(", ");
    const name = attacker.name;
    let content = `<p>${escape(targetNames
        ? game.i18n.format("ND5T.BrutalStrike.Chat", { name, effects, targets: targetNames })
        : game.i18n.format("ND5T.BrutalStrike.ChatNoTarget", { name, effects }))}</p>`;
    if (kinds.includes("forceful")) {
        content += `<p>${escape(game.i18n.format("ND5T.BrutalStrike.Forceful.Reminder", { name, target: targetNames || "-" }))}</p>`;
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        flavor: feature.item.name,
        content: `<div class="nd5t-brutal-strike-card">${content}</div>`
    });

    const applied = kinds.filter(k => k !== "forceful");
    if (!applied.length) return;
    const effectData = applied.map(k => _effectData(k, attacker, feature));
    for (const token of targets) {
        const actor = token.actor;
        if (!actor) continue;
        if (actor.isOwner) await _applyOnActor(actor, effectData);
        else game.socket.emit(SOCKET, { action: "brutalStrikeApply", actorUuid: actor.uuid, effects: effectData });
    }
}

/**
 * Create Brutal Strike effects on an actor (owner or GM), replacing a Hamstring Blow and the attacker's earlier
 * effects of the same kinds.
 * @param {Actor5e} actor
 * @param {object[]} effectData
 */
async function _applyOnActor(actor, effectData) {
    const replace = new Set();
    for (const data of effectData) {
        const { kind, source } = data.flags?.[MODULE_ID]?.[FLAG] ?? {};
        for (const effect of actor.effects) {
            const flag = effect.flags?.[MODULE_ID]?.[FLAG];
            if (!flag || (flag.kind !== kind)) continue;
            // Only the most recent Hamstring Blow counts, whoever made it
            if ((kind === "hamstring") || (flag.source === source) || effect.duration?.expired) replace.add(effect.id);
        }
    }
    if (replace.size) await deleteEffects(actor, [...replace]);
    await actor.createEmbeddedDocuments("ActiveEffect", effectData);
    debug(`Brutal Strike | ${effectData.map(e => e.name).join(", ")} on ${actor.name}`);
}

/**
 * Mark a Staggered effect's Disadvantage as used (owner, or the active GM through the socket). The effect stays:
 * it still bars Opportunity Attacks until the start of the attacker's next turn.
 * @param {string} uuid
 */
async function _markStaggerUsed(uuid) {
    _staggerUsed.add(uuid);
    const effect = fromUuidSync(uuid, { strict: false });
    if (!effect || !(effect.parent instanceof Actor)) return;
    if (effect.isOwner) {
        try {
            await effect.setFlag(MODULE_ID, `${FLAG}.saveUsed`, true);
        } catch (err) {
            // The effect may have expired meanwhile
            if (effect.parent?.effects.has(effect.id)) throw err;
        }
    } else game.socket.emit(SOCKET, { action: "brutalStrikeStaggerUsed", uuid });
}

/**
 * Remove one of our effects (owner, or the active GM through the socket).
 * @param {string} uuid
 */
async function _removeEffectByUuid(uuid) {
    const effect = fromUuidSync(uuid, { strict: false });
    if (!effect || !(effect.parent instanceof Actor)) return;
    if (effect.isOwner) await deleteEffect(effect);
    else {
        game.socket.emit(SOCKET, { action: "brutalStrikeRemove", uuid });
    }
}

// ── Effect registry ───────────────────────────────────────────────────

/**
 * Add or remove one of our effects in the registry.
 * @param {ActiveEffect} effect
 * @param {boolean} present
 */
function _track(effect, present) {
    const kind = effect?.flags?.[MODULE_ID]?.[FLAG]?.kind;
    const actor = effect?.parent;
    if (!kind || !(actor instanceof Actor)) return;
    const key = actor.uuid;
    let ids = _applied.get(key);
    if (present) {
        if (!ids) _applied.set(key, ids = new Map());
        ids.set(effect.id, kind);
    } else {
        _staggerUsed.delete(effect.uuid);
        if (!ids) return;
        ids.delete(effect.id);
        if (!ids.size) _applied.delete(key);
    }
}

/** ready: register our effects already in the world (world actors, and unlinked tokens that carry effects). */
function _scanApplied() {
    const scan = actor => {
        for (const effect of actor?.effects ?? []) _track(effect, true);
    };
    for (const actor of game.actors) scan(actor);
    for (const scene of game.scenes) {
        for (const token of scene.tokens) {
            if (token.actorLink || !token.delta?.effects?.some(e => e.flags?.[MODULE_ID]?.[FLAG])) continue;
            scan(token.actor);
        }
    }
}

/**
 * One of our active effects of a kind on the actor.
 * @param {Actor5e} actor
 * @param {string} kind
 * @param {function(ActiveEffect): boolean} [filter]
 * @returns {ActiveEffect|null}
 */
function _activeEffect(actor, kind, filter) {
    const ids = actor ? _applied.get(actor.uuid) : null;
    if (!ids) return null;
    for (const [id, k] of ids) {
        if (k !== kind) continue;
        const effect = actor.effects.get(id);
        if (effect?.active && !effect.duration?.expired && (!filter || filter(effect))) return effect;
    }
    return null;
}

/**
 * Sundering Blow: +5 on the next attack against the creature by anyone but the Barbarian who sundered it.
 * @param {object} config
 * @param {Actor5e} attacker
 */
function _addSunderingBonus(config, attacker) {
    const target = singleAttackTarget(getMidiWorkflow(config));
    const effect = _activeEffect(target?.actor, "sundering",
        e => e.flags[MODULE_ID][FLAG].source !== attacker.uuid);
    const roll = config.rolls?.[0];
    if (!effect || !roll) return;
    roll.parts = [...(roll.parts ?? []), "5"];
    roll.options ??= {};
    roll.options.nd5tSundered = effect.uuid;
    debug(`Brutal Strike | ${target.name} is Sundered: +5 for ${attacker.name}`);
}

/**
 * dnd5e.preRollSavingThrow: Staggering Blow's Disadvantage on the next save.
 * @param {object} config
 */
function _onPreRollSavingThrow(config) {
    try {
        if (!_applied.size) return;
        const effect = _activeEffect(config.subject, "staggering",
            e => !e.flags[MODULE_ID][FLAG].saveUsed && !_staggerUsed.has(e.uuid));
        if (!effect) return;
        addRollModes(config, { disadvantage: true });
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            roll.options.nd5tStaggered = effect.uuid;
        }
        config.nd5tStaggered = effect.uuid;
        debug(`Brutal Strike | ${config.subject.name} is Staggered: Disadvantage on this save`);
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: preRollSavingThrow failed`, err);
    }
}

/**
 * dnd5e.rollSavingThrow: Staggered's Disadvantage is used up by that save (the effect stays until its expiry).
 * @param {D20Roll[]} rolls
 */
function _onRollSavingThrow(rolls) {
    const uuid = rolls?.find(r => r.options?.nd5tStaggered)?.options.nd5tStaggered;
    if (uuid) _markStaggerUsed(uuid).catch(err => console.error(`${MODULE_ID} | Brutal Strike: marking Staggered failed`, err));
}

/**
 * deleteCombat: forget turn usage, and (active GM) remove effects left over from that combat.
 * @param {Combat} combat
 */
async function _onDeleteCombat(combat) {
    try {
        for (const [key, turn] of _usedTurn) if (turn.startsWith(`${combat.id}:`)) _usedTurn.delete(key);
        if (!game.users.activeGM?.isSelf) return;
        // dnd5e's combat exit deletes the "start of next turn" effects of every combatant itself (unless Disable
        // Active Effect Expiry is on); deleting them here too made one of the two deletions fail
        const combatants = getSetting("disableActiveEffectExpiry")
            ? new Set()
            : new Set((combat.combatants ?? []).map(c => c.actor?.uuid).filter(Boolean));
        for (const [actorUuid, ids] of [..._applied]) {
            if (combatants.has(actorUuid)) continue;
            const actor = fromUuidSync(actorUuid, { strict: false });
            if (!actor) continue;
            const stale = [...ids.keys()].filter(id => actor.effects.get(id)?.flags?.[MODULE_ID]?.[FLAG]?.combatId === combat.id);
            if (stale.length) await deleteEffects(actor, stale);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Brutal Strike: cleanup after combat failed`, err);
    }
}

// ── Socket ────────────────────────────────────────────────────────────

/**
 * Socket messages: open the picker for its user, and (active GM) write effects other users can't.
 * @param {object} data
 * @returns {boolean}  Whether the message was a Brutal Strike message.
 */
export function brutalStrikeSocketMessage(data) {
    switch (data?.action) {
        case "brutalStrikePicker":
            if (data.userId === game.user.id) _openPicker(data);
            return true;
        case "brutalStrikeApply": {
            if (!game.users.activeGM?.isSelf) return true;
            const actor = fromUuidSync(data.actorUuid, { strict: false });
            if (actor instanceof Actor) _applyOnActor(actor, data.effects ?? []).catch(err => console.error(`${MODULE_ID} | Brutal Strike: applying effects failed`, err));
            return true;
        }
        case "brutalStrikeStaggerUsed":
            if (game.users.activeGM?.isSelf) _markStaggerUsed(data.uuid).catch(err => console.error(`${MODULE_ID} | Brutal Strike: marking Staggered failed`, err));
            return true;
        case "brutalStrikeRemove":
            if (game.users.activeGM?.isSelf) _removeEffectByUuid(data.uuid);
            return true;
        default:
            return false;
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize Brutal Strike. Called once during the "setup" phase from main.js, after Reckless Attack (its hooks
 * must run first). Nothing is registered while the world setting is off; changing it reloads.
 */
export function initBrutalStrike() {
    if (!getSetting("enableBrutalStrike")) return;
    registerRecklessExtension({
        appliesTo: actor => Boolean(_brutal(actor)),
        dialogFields: _dialogFields,
        promptChoice: _promptChoice,
        skippedPrompt: _skippedPrompt
    });
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    Hooks.on("dnd5e.postBuildAttackRollConfig", _onPostBuildAttackRollConfig);
    Hooks.on("dnd5e.postAttackRollConfiguration", _onPostAttackRollConfiguration);
    Hooks.on("dnd5e.rollAttack", _onRollAttack);
    Hooks.on("dnd5e.preRollDamage", _onPreRollDamage);
    Hooks.on("dnd5e.rollDamage", _onRollDamage);
    Hooks.on("dnd5e.preRollSavingThrow", _onPreRollSavingThrow);
    Hooks.on("dnd5e.rollSavingThrow", _onRollSavingThrow);
    Hooks.on("createItem", _onItemChange);
    Hooks.on("updateItem", _onItemChange);
    Hooks.on("deleteItem", _onItemChange);
    Hooks.on("createActiveEffect", effect => _track(effect, true));
    Hooks.on("deleteActiveEffect", effect => _track(effect, false));
    Hooks.on("deleteCombat", _onDeleteCombat);
    Hooks.once("ready", _scanApplied);
    document.body.classList.add("nd5t-brutal-strike");
    debug("Brutal Strike | Initialized");
}
