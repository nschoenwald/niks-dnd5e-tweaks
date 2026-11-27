/**
 * Feature: Holy Aura Automation
 * Description: Creatures protected by Holy Aura have Advantage on all saving throws while inside the aura, attacks
 * against them have Disadvantage, and a Fiend or Undead that hits them with a melee attack must make the spell's
 * Constitution save or be Blinded.
 *
 * @introduced v14.105.0
 * @updated v14.118.1 (socket requests are checked against the sender)
 * @updated v14.119.0 (the save is triggered by the melee attack's damage roll, no AC check)
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { getMidiWorkflow, isMidiActive } from "../../utils/module-compat.js";
import { singleAttackTarget, addRollModes } from "../../utils/attack-context.js";

/**
 * Holy Aura
 *
 * The PHB 2024 spell places a 30 ft emanation on the caster ("Create Aura") and applies "Holy Protection" to the
 * creatures the caster picks, from the chat card. The effect already gives Advantage on all saves; the rest of the
 * spell isn't automated by dnd5e:
 *
 *  - dnd5e.preRollAttack: attacks against a single target with the effect have Disadvantage, unless the attacker
 *    is protected by the same casting. midi-qol attacks go through this hook too.
 *  - dnd5e.postAttackRollConfiguration / dnd5e.rollDamage: a Fiend or Undead hitting a protected target with a melee attack triggers
 *    the spell's save activity ("Fiend/Undead Save") against the attacker. A hit is a damage roll of the attack (the
 *    target remembered from the attack roll), with no AC check, since Foundry's view can be wrong (cover, forgotten
 *    bonuses); each attack triggers once. The attack is remembered before dnd5e creates its chat card, since damage
 *    can be rolled from that card (Prompt / Auto-Roll Attack Damage) before dnd5e.rollAttack. The active
 *    GM uses it without consumption (socket from other clients); the attacker rolls from the card and the Blinded
 *    effect is applied from it as usual.
 *  - dnd5e.preRollSavingThrow: Advantage on every save, for versions whose effect has no changes (harmless when
 *    the effect already grants it).
 *
 * "While in the aura": when the caster's area exists on the protected creature's scene (a region whose
 * `flags.dnd5e.item` is the spell), the creature only benefits while its token is inside it. Without an area
 * (homebrew versions without a template) the effect alone counts.
 *
 * Effects are recognized by this module's flag, or by the item they come from (identifier `holy-aura`, or a spell
 * named "Holy Aura" without identifier) as long as they aren't the Blinded or concentration effect. Their English
 * name ("Holy Protection" / "Holy Aura") is the last fallback.
 */

const SPELL_IDENTIFIER = "holy-aura";
const SPELL_NAME_FALLBACK = /^holy aura$/i;
const EFFECT_NAME_FALLBACK = /^holy (?:protection|aura)$/i;
const TRIGGER_TYPES = new Set(["fiend", "undead"]);
const MELEE_ACTION_TYPES = new Set(["mwak", "msak"]);
const SOCKET_ACTION = "holyAuraSave";

// ── Recognition ───────────────────────────────────────────────────────

/**
 * Resolve a UUID synchronously, returning null on errors.
 * @param {string} uuid
 * @returns {foundry.abstract.Document|null}
 */
function _safeFromUuid(uuid) {
    if (!uuid || (typeof uuid !== "string")) return null;
    try {
        return fromUuidSync(uuid);
    } catch {
        return null;
    }
}

/**
 * Whether an item is the Holy Aura spell.
 * @param {Item5e|null} item
 * @returns {boolean}
 */
function _isHolyAuraItem(item) {
    if (!(item instanceof Item)) return false;
    const identifier = item.identifier ?? item.system?.identifier ?? "";
    if (identifier) return identifier === SPELL_IDENTIFIER;
    return (item.type === "spell") && SPELL_NAME_FALLBACK.test(item.name ?? "");
}

/**
 * The item an applied effect comes from (dnd5e's `system.origin`, the core origin, or the effect it was copied from).
 * @param {ActiveEffect5e} effect
 * @returns {Item5e|null}
 */
function _originItem(effect) {
    const origin = effect.system?.origin ?? {};
    const candidates = [origin.item, origin.activity, effect.origin, effect._stats?.duplicateSource];
    for (const uuid of candidates) {
        let doc = _safeFromUuid(uuid);
        // Activities and item effects lead to their item
        while (doc && !(doc instanceof Item) && (doc.item || doc.parent)) {
            const next = doc.item ?? doc.parent;
            if (next instanceof Actor) break;
            doc = next;
        }
        if (doc instanceof Item) return doc;
    }
    return null;
}

/**
 * Whether an Active Effect is the protection of Holy Aura.
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _isHolyAuraEffect(effect) {
    if (effect.getFlag?.(MODULE_ID, "holyAura")) return true;
    if (effect.statuses?.has?.("blinded") || effect.statuses?.has?.("concentrating")) return false;
    if (_isHolyAuraItem(_originItem(effect))) return true;
    return EFFECT_NAME_FALLBACK.test(effect.name ?? "");
}

/**
 * Whether the actor's token is inside the caster's Holy Aura area, when that area exists on its scene.
 * @param {Actor5e} actor
 * @param {Item5e|null} item  The Holy Aura spell the effect comes from.
 * @returns {boolean}
 */
function _isInAura(actor, item) {
    if (!item) return true;
    const tokens = actor.getActiveTokens?.(false, true) ?? [];
    let foundArea = false;
    for (const token of tokens) {
        const regions = token.parent?.regions?.filter(r => r.getFlag?.("dnd5e", "item") === item.uuid) ?? [];
        if (!regions.length) continue;
        foundArea = true;
        if (regions.some(r => r.tokens?.has(token))) return true;
    }
    return !foundArea;
}

/**
 * The Holy Aura protection currently benefiting an actor, if any.
 * @param {Actor5e|null} actor
 * @returns {{effect: ActiveEffect5e, item: Item5e|null}|null}
 */
export function getHolyAuraProtection(actor) {
    for (const effect of actor?.effects ?? []) {
        if (!effect.active || !_isHolyAuraEffect(effect)) continue;
        const item = _originItem(effect);
        if (_isInAura(actor, item)) return { effect, item };
    }
    return null;
}

/**
 * The creature type of an actor (characters use their species' type, humanoid by default).
 * @param {Actor5e} actor
 * @returns {string}
 */
function _creatureType(actor) {
    const details = actor.system?.details;
    const type = details?.type?.value || details?.race?.system?.type?.value;
    return type || ((actor.type === "character") ? "humanoid" : "");
}

// ── Saving throws ─────────────────────────────────────────────────────

/**
 * dnd5e.preRollSavingThrow — Advantage on all saving throws inside the aura.
 * @param {AbilityRollProcessConfiguration} config
 */
function _onPreRollSavingThrow(config) {
    try {
        if (!getSetting("enableHolyAura")) return;
        const actor = config.subject;
        if (!getHolyAuraProtection(actor)) return;
        debug(`Holy Aura | ${actor.name} is protected — Advantage on the ${config.ability ?? ""} save`);
        addRollModes(config, { advantage: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Holy Aura: error while adjusting a saving throw`, err);
    }
}

// ── Attacks ───────────────────────────────────────────────────────────

/**
 * dnd5e.preRollAttack — Disadvantage on attacks against a protected creature.
 * @param {object} config  Attack roll process configuration.
 */
function _onPreRollAttack(config) {
    try {
        if (!getSetting("enableHolyAura")) return;
        const attacker = config.subject?.actor;
        if (!attacker) return;
        const target = singleAttackTarget(getMidiWorkflow(config));
        const protection = getHolyAuraProtection(target?.actor);
        if (!protection) return;
        // Creatures the caster chose aren't "other creatures"
        const own = getHolyAuraProtection(attacker);
        if (own && protection.item && (own.item === protection.item)) return;
        debug(`Holy Aura | ${target.name} is protected — Disadvantage for ${attacker.name}`);
        addRollModes(config, { disadvantage: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Holy Aura: error while adjusting an attack roll`, err);
    }
}

/** Actor UUID → the latest melee attack against a protected target: `{ activityUuid, targetUuid, time }`. */
const _pendingAttacks = new Map();
const PENDING_TTL = 10 * 60 * 1000;

/**
 * dnd5e.postAttackRollConfiguration — remember a Fiend's or Undead's melee attack against a protected creature for
 * its damage roll. Any other attack of the same actor drops the record.
 * @param {D20Roll[]} rolls
 * @param {{subject?: Activity}} config
 */
function _onPostAttackRollConfiguration(rolls, { subject } = {}) {
    try {
        const attacker = subject?.actor;
        if (!attacker) return;
        _pendingAttacks.delete(attacker.uuid);
        if (!getSetting("enableHolyAura")) return;
        const roll = rolls?.[0];
        if (!roll || !TRIGGER_TYPES.has(_creatureType(attacker))) return;
        const actionType = subject.getActionType?.(roll.options?.attackMode) ?? subject.actionType;
        if (!MELEE_ACTION_TYPES.has(actionType)) return;

        const targets = Array.from(game.user?.targets ?? []);
        if (targets.length !== 1) return;
        const target = targets[0].document ?? targets[0];
        if (!getHolyAuraProtection(target.actor)) return;
        _pendingAttacks.set(attacker.uuid, { activityUuid: subject.uuid, targetUuid: target.uuid, time: Date.now() });
        debug(`Holy Aura | ${attacker.name} attacked ${target.name} in melee — save on the damage roll`);
    } catch (err) {
        console.error(`${MODULE_ID} | Holy Aura: error while checking a melee attack`, err);
    }
}

/**
 * dnd5e.rollDamage — the damage roll of a remembered melee attack is a hit: the attacker makes the spell's save.
 * @param {DamageRoll[]} rolls
 * @param {{subject?: Activity}} data
 */
function _onRollDamage(rolls, { subject } = {}) {
    try {
        const attacker = subject?.actor;
        const pending = attacker ? _pendingAttacks.get(attacker.uuid) : null;
        if (!pending || (pending.activityUuid !== subject.uuid)) return;
        _pendingAttacks.delete(attacker.uuid);
        if (!getSetting("enableHolyAura") || ((Date.now() - pending.time) > PENDING_TTL)) return;
        const target = _safeFromUuid(pending.targetUuid);
        const protection = getHolyAuraProtection(target?.actor);
        if (!protection?.item) return;

        const attackerToken = subject.getUsageToken?.() ?? attacker.token ?? attacker.getActiveTokens?.(false, true)?.[0];
        if (!attackerToken?.uuid) return;
        debug(`Holy Aura | ${attacker.name} hit ${target.name} in melee — ${protection.item.name} save`);
        _requestSave(protection.item, attackerToken);
    } catch (err) {
        console.error(`${MODULE_ID} | Holy Aura: error while checking a melee hit`, err);
    }
}

/**
 * Have the active GM (or the spell's owner without a GM) use the save activity against the attacker.
 * @param {Item5e} item
 * @param {TokenDocument} token
 */
function _requestSave(item, token) {
    const gm = game.users.activeGM;
    if (gm?.isSelf || (!gm && item.isOwner)) {
        _runSave(item.uuid, token.uuid).catch(err => console.error(`${MODULE_ID} | Holy Aura: save failed`, err));
        return;
    }
    if (!gm) {
        ui.notifications?.warn(game.i18n.format("ND5T.HolyAura.NoGM", { name: token.name }));
        return;
    }
    game.socket.emit(`module.${MODULE_ID}`, { action: SOCKET_ACTION, userId: gm.id, itemUuid: item.uuid, tokenUuid: token.uuid });
}

/**
 * Use the spell's save activity against one creature, without consumption, concentration or template.
 * @param {string} itemUuid
 * @param {string} tokenUuid
 */
async function _runSave(itemUuid, tokenUuid) {
    const item = await fromUuid(itemUuid);
    const token = await fromUuid(tokenUuid);
    if (!item || !token?.actor) return;
    const activities = Array.from(item.system?.activities ?? []).filter(a => a.type === "save");
    const activity = activities.find(a => a.save?.ability?.has?.("con")) ?? activities[0];
    if (!activity) {
        ui.notifications?.warn(game.i18n.format("ND5T.HolyAura.NoSaveActivity", { spell: item.name }));
        return;
    }

    const TargetsField = dnd5e.dataModels.chatMessage.fields.TargetsField;
    let restoreTargets = null;
    if (isMidiActive() && canvas.tokens && (token.parent === canvas.scene)) {
        const previous = Array.from(game.user.targets).map(t => t.id);
        canvas.tokens.setTargets([token.id], { mode: "replace" });
        restoreTargets = () => canvas.tokens?.setTargets(previous, { mode: "replace" });
    }
    try {
        await activity.use({
            consume: false,
            concentration: { begin: false },
            create: { measuredTemplate: false }
        }, { configure: false }, {
            rollMode: "public",
            data: {
                system: { targets: TargetsField.getDescriptors([token]) },
                flags: { [MODULE_ID]: { holyAuraSave: true } }
            }
        });
    } finally {
        restoreTargets?.();
    }
}

/**
 * Socket handler: the active GM uses the save activity for another client. Only for a Holy Aura spell, and only
 * when the sender (from the server, not the payload) owns the caster or the creature making the save.
 * @param {object} data
 * @param {string} senderId
 */
export function onSocketMessage(data, senderId) {
    if ((data?.action !== SOCKET_ACTION) || (data.userId !== game.user.id)) return;
    const sender = game.users.get(senderId);
    const item = _safeFromUuid(data.itemUuid);
    const token = _safeFromUuid(data.tokenUuid);
    if (!sender || !(item instanceof Item) || !_isHolyAuraItem(item) || !token?.actor) return;
    const owns = actor => Boolean(actor && (sender.isGM || actor.testUserPermission(sender, "OWNER")));
    if (!owns(item.actor) && !owns(token.actor)) return;
    _runSave(data.itemUuid, data.tokenUuid).catch(err => console.error(`${MODULE_ID} | Holy Aura: save failed`, err));
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Holy Aura feature. Called once during "setup" from main.js.
 */
export function initHolyAura() {
    Hooks.on("dnd5e.preRollSavingThrow", _onPreRollSavingThrow);
    Hooks.on("dnd5e.preRollAttack", _onPreRollAttack);
    Hooks.on("dnd5e.postAttackRollConfiguration", _onPostAttackRollConfiguration);
    Hooks.on("dnd5e.rollDamage", _onRollDamage);
    debug("Holy Aura | Initialized");
}
