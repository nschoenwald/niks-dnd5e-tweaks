/**
 * Feature: Self Effect Application Prompt
 * Description: Whispers an interactive chat card with a one-click Apply button when an actor activates abilities that grant Active Effects to Self.
 *
 * @introduced v14.13.0
 * @updated v14.49.1 (Auto-Apply Effects list applies matching effects directly and collapses the usage card's effect tray)
 */
import { MODULE_ID, getSetting, debug, isFeatureActive } from "../../main.js";

/**
 * Self Effect Application
 *
 * When an actor uses an activity whose target is "self" and that activity has
 * one or more applicable Active Effects, whispers a chat card to the actor's
 * owners and all GMs so they can apply those effects with one click.
 *
 * The card mirrors the damage-prompt apply/undo pattern:
 *  - Per-effect "Apply" buttons
 *  - After applying, the button transitions to "Applied ✓" + an Undo button
 *  - Button state syncs across all clients via flag updates + the module socket
 */

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the Self Effect Application feature.
 * Called once during the "setup" phase from main.js.
 */
export function initSelfEffectApplication() {
    Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);

    Hooks.on("renderChatMessageHTML", (message, html) => {
        _bindSelfEffectButtons(message, html);
    });

    // Usage messages whose self effects were auto-applied render with the effect tray collapsed.
    // dnd5e.renderChatMessage fires after ChatMessage5e#_collapseTrays has set the tray state.
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
        if (!message.getFlag?.(MODULE_ID, "selfEffectAutoApplied")) return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (root) _collapseEffectTray(message, root);
    });

    // Sync button state across clients when the flag is updated.
    // Foundry does NOT re-fire renderChatMessageHTML on flag changes.
    Hooks.on("updateChatMessage", _onUpdateSelfEffectApplied);

    debug("Self Effect Application | Initialized");
}

// ── Core handler ─────────────────────────────────────────────────────

/**
 * Fires after an activity is used. Checks whether the activity targets "self"
 * and has applicable Active Effects, then sends a whispered prompt card.
 *
 * @param {Activity} activity           The activity that was used.
 * @param {ActivityUseConfiguration} usageConfig  Configuration for the usage.
 * @param {ActivityUsageResults} results           Results of the usage.
 */
/**
 * Check whether an activity or its parent item targets "self".
 * Handles direct activity targets, range units, item-level targets (essential for spells in DnD5e v5.2+),
 * and system labels.
 *
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isSelfTargeted(activity) {
    const item = activity.item;

    // 1. Direct activity target affects or template type
    const actTargetType = activity.target?.affects?.type || activity.target?.template?.type || activity.target?.type;
    if (actTargetType === "self") return true;

    // 2. Direct activity range units
    if (activity.range?.units === "self") return true;

    // 3. Item system target affects or template type (spells in DnD5e v5.2+ store target on item.system.target)
    const itemTargetType = item?.system?.target?.affects?.type
        || item?.system?.target?.template?.type
        || item?.system?.target?.type;
    if (itemTargetType === "self") return true;

    // 4. Item system range units
    if (item?.system?.range?.units === "self") return true;

    // 5. Formatted labels — intentionally omitted: activity.labels are
    //    locale-dependent strings and comparing them against the English
    //    "self" would silently break for non-English installations.
    //    All canonical self-target configurations are covered by checks 1–4.

    return false;
}

/**
 * Check whether an activity places an area-of-effect template (sphere, cone,
 * cube, cylinder, line, radius, square, etc.). AoE activities are never
 * self-targeted for the purpose of this feature.
 *
 * @param {Activity} activity
 * @returns {boolean}
 */
function _hasAreaOfEffect(activity) {
    const item = activity.item;

    // Activity-level template type
    const actTemplateType = activity.target?.template?.type;
    if (actTemplateType && actTemplateType !== "self") return true;

    // Item-system-level template type (DnD5e v5.2+ spells)
    const itemTemplateType = item?.system?.target?.template?.type;
    if (itemTemplateType && itemTemplateType !== "self") return true;

    return false;
}

/**
 * Check whether the actor using the activity was manually targeted on the canvas
 * or recorded in the usage chat message targets flag.
 *
 * @param {Actor5e} actor
 * @param {ActivityUsageResults} [results]
 * @returns {boolean}
 */
function _hasManualSelfTarget(actor, results) {
    if (!actor) return false;

    const actorUuid = actor.uuid;
    const actorId = actor.id;
    const activeTokens = actor.getActiveTokens();
    const activeTokenUuids = new Set(activeTokens.map(t => t.document?.uuid || t.uuid));
    const activeTokenIds = new Set(activeTokens.map(t => t.id || t.document?.id));

    // 1. Check chat message flags / system targets from the activity usage
    const msgTargets = results?.message?.system?.targets
        || results?.message?.getFlag?.("dnd5e", "targets")
        || results?.message?.flags?.dnd5e?.targets;
    if (Array.isArray(msgTargets) && msgTargets.length > 0) {
        const isSelfInMsg = msgTargets.some(t => {
            const targetActorUuid = t.actor ?? t.uuid;
            const targetTokenUuid = t.token ?? t.uuid;
            return targetActorUuid === actorUuid ||
                targetTokenUuid === actorUuid ||
                (targetActorUuid && actorId && targetActorUuid.includes(actorId)) ||
                activeTokenUuids.has(targetTokenUuid) ||
                (t.id && activeTokenIds.has(t.id));
        });
        if (isSelfInMsg) return true;
    }

    // 2. Check game.user.targets (canvas targeted tokens)
    if (game.user?.targets?.size > 0) {
        for (const token of game.user.targets) {
            if (token.actor === actor || token.actor?.uuid === actorUuid || (token.actor?.id && actorId && token.actor.id === actorId)) return true;
            if (token.document?.uuid && activeTokenUuids.has(token.document.uuid)) return true;
            if (token.id && activeTokenIds.has(token.id)) return true;
        }
    }

    return false;
}

function _cleanName(str) {
    return (str || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Hardcoded blacklist of terms for self effect application.
 * Any activity, item, roll, or usage whose name or identifier includes any of these
 * terms (case-insensitive) will not trigger the self effect application.
 *
 * @type {string[]}
 */
const SELF_EFFECT_BLACKLIST = [
    "smite"
];

/**
 * Check whether an individual ActiveEffect matches the hardcoded blacklist.
 *
 * @param {ActiveEffect5e} effect
 * @returns {boolean}
 */
function _isEffectBlacklisted(effect) {
    if (!effect) return false;
    const candidates = [
        effect.name,
        effect.label,
        effect.statuses ? Array.from(effect.statuses).join(" ") : ""
    ];
    for (const term of SELF_EFFECT_BLACKLIST) {
        const cleanTerm = term.trim().toLowerCase();
        if (!cleanTerm) continue;
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.toLowerCase().includes(cleanTerm)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Retrieve applicable Active Effects that are explicitly assigned to the used activity.
 *
 * @param {Activity} activity
 * @returns {Promise<ActiveEffect5e[]>}
 */
async function _getApplicableEffects(activity) {
    let effects = [];
    const item = activity.item;
    const itemName = item?.name || "Effect";

    // 1. Primary: DnD5e 6.0.0+ activity.getApplicableEffects()
    if (typeof activity.getApplicableEffects === "function") {
        const actEffects = await activity.getApplicableEffects();
        if (actEffects && actEffects.length > 0) {
            effects = Array.from(actEffects).filter(Boolean);
        }
    }

    // 2. Secondary: If getApplicableEffects() wasn't present or returned nothing,
    // resolve explicitly assigned effects from activity.applicableEffects or activity.effects.
    if (!effects.length) {
        const assignedEntries = activity.applicableEffects ?? activity.effects;
        const entryList = Array.isArray(assignedEntries)
            ? assignedEntries
            : (assignedEntries && typeof assignedEntries[Symbol.iterator] === "function" ? Array.from(assignedEntries) : []);

        if (entryList.length > 0) {
            for (const entry of entryList) {
                if (!entry) continue;
                // Direct ActiveEffect document (DnD5e 5.x)
                if (entry instanceof foundry.abstract.Document || entry.statuses || entry.changes) {
                    effects.push(entry);
                    continue;
                }
                // AppliedEffectField / EffectApplicationData
                let doc = null;
                if (typeof entry.getEffect === "function") {
                    try { doc = await entry.getEffect(); } catch (_) {}
                }
                if (!doc && entry.effect) {
                    doc = entry.effect;
                }
                if (!doc && entry._id && item?.effects) {
                    doc = item.effects.get(entry._id);
                }
                if (!doc && entry.uuid) {
                    try { doc = await fromUuid(entry.uuid); } catch (_) {}
                }
                if (doc) effects.push(doc);
            }
        }
    }

    // Filter to valid non-transfer effects that are not blacklisted
    effects = effects.filter(e => e && !e.transfer && !_isEffectBlacklisted(e));

    // Replace generic activity effect names (like "use", "cast", "utility", "effect") with the Item Name
    if (itemName && effects.length > 0) {
        effects = effects.map(e => {
            const eName = (e.name ?? e.label ?? "").trim().toLowerCase();
            if (!eName || eName === "use" || eName === "cast" || eName === "utility" || eName === "effect") {
                if (typeof e.toObject === "function") {
                    const obj = e.toObject();
                    obj.name = itemName;
                    return obj;
                }
                return { ...e, name: itemName };
            }
            return e;
        });
    }

    return effects;
}

/**
 * Check whether an activity, its parent item, or associated roll / usage matches
 * the hardcoded blacklist for self effect application.
 *
 * @param {Activity} activity
 * @param {ActivityUsageResults} [results]
 * @returns {boolean}
 */
function _isBlacklisted(activity, results) {
    if (!activity) return false;

    const candidates = [
        activity.name,
        activity.identifier,
        activity.id,
        activity.item?.name,
        activity.item?.identifier,
        activity.item?.system?.identifier,
        results?.message?.flavor,
        results?.message?.system?.title,
        results?.message?.flags?.dnd5e?.item?.name,
        results?.message?.flags?.dnd5e?.item?.identifier,
        results?.message?.flags?.dnd5e?.activity?.name,
        results?.message?.flags?.dnd5e?.activity?.identifier
    ];

    const rollCollections = [results?.rolls, results?.message?.rolls, results?.updates?.rolls];
    for (const collection of rollCollections) {
        if (!Array.isArray(collection)) continue;
        for (const r of collection) {
            if (!r) continue;
            if (typeof r.options?.flavor === "string") candidates.push(r.options.flavor);
            if (typeof r.options?.title === "string") candidates.push(r.options.title);
            if (typeof r.options?.type === "string") candidates.push(r.options.type);
            if (typeof r.options?.item?.name === "string") candidates.push(r.options.item.name);
        }
    }

    for (const term of SELF_EFFECT_BLACKLIST) {
        const cleanTerm = term.trim().toLowerCase();
        if (!cleanTerm) continue;

        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.toLowerCase().includes(cleanTerm)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check whether an activity or its parent item matches the configured list of always-prompt features.
 * Performs lookup primarily by Item Name or Item Identifier.
 *
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isAlwaysPromptFeature(activity) {
    const rawList = getSetting("selfEffectAlwaysPromptFeatures");
    if (!rawList || typeof rawList !== "string") return false;

    const list = rawList
        .split(",")
        .map(s => _cleanName(s))
        .filter(Boolean);

    if (!list.length) return false;

    const cItemName = _cleanName(activity.item?.name);
    const cIdentifier = _cleanName(activity.item?.system?.identifier);

    return list.some(entry => {
        if (!entry) return false;
        if (cItemName && (cItemName === entry || cItemName.includes(entry) || entry.includes(cItemName))) return true;
        if (cIdentifier && (cIdentifier === entry || cIdentifier.includes(entry) || entry.includes(cIdentifier))) return true;
        return false;
    });
}

/**
 * Clean names of Active Effects configured to be applied directly, without a prompt card.
 *
 * @returns {Set<string>}
 */
function _getAutoApplyEffectNames() {
    const rawList = getSetting("selfEffectAutoApplyEffects");
    if (!rawList || typeof rawList !== "string") return new Set();
    return new Set(rawList.split(",").map(s => _cleanName(s)).filter(Boolean));
}

/**
 * Serialize an effect into plain data that can be stored in flags or used for creation.
 *
 * @param {ActiveEffect5e|object} effect
 * @returns {object}
 */
function _serializeEffectData(effect) {
    const rawData = effect.toObject ? effect.toObject() : foundry.utils.deepClone(effect);
    if (rawData.statuses) {
        rawData.statuses = Array.from(rawData.statuses);
    } else if (effect.statuses) {
        rawData.statuses = Array.from(effect.statuses);
    }
    return rawData;
}

async function _onPostUseActivity(activity, usageConfig, results) {
    try {
        if (!isFeatureActive("enableSelfEffectApplication", "clientEnableSelfEffectApplication")) return;

        // Skip if midi-qol is active and configured to auto-apply item active effects
        if (game.modules.get("midi-qol")?.active) {
            const autoEffects = globalThis.MidiQOL?.configSettings?.()?.autoItemEffects
                ?? game.settings.get("midi-qol", "ConfigSettings")?.autoItemEffects;
            if (autoEffects && autoEffects !== "off" && autoEffects !== "none") {
                debug("Self Effect Application | midi-qol detected and auto-applies item effects — feature bypassed.");
                return;
            }
        }

        const actor = activity.item?.actor;
        if (!actor) return;

        // Skip activities, items, or rolls that match the hardcoded blacklist (e.g. Smite)
        if (_isBlacklisted(activity, results)) {
            debug(`Self Effect Application | Activity "${activity.name || activity.id}" on "${activity.item?.name}" matches hardcoded blacklist — skipping self-effect prompt.`);
            return;
        }

        // Skip activities that place an area-of-effect template — they are
        // never self-targeted for the purpose of this feature.
        if (_hasAreaOfEffect(activity)) {
            debug(`Self Effect Application | Activity "${activity.name}" on "${activity.item?.name}" has an AoE template — skipping self-effect prompt.`);
            return;
        }

        // Check if the activity/item intrinsically targets "self", if the actor manually targeted themselves,
        // or if the feature is explicitly configured in the always-prompt list.
        const isIntrinsicSelf = _isSelfTargeted(activity);
        const isManualSelf = _hasManualSelfTarget(actor, results);
        const isAlwaysPrompt = _isAlwaysPromptFeature(activity);

        if (!isIntrinsicSelf && !isManualSelf && !isAlwaysPrompt) return;

        // Retrieve applicable Active Effects explicitly assigned to this activity.
        const applicableEffects = await _getApplicableEffects(activity);
        if (!applicableEffects.length) {
            debug(`Self Effect Application | Activity "${activity.name || activity.id}" on "${activity.item?.name}" has no applicable effects assigned to it — skipping prompt card.`);
            return;
        }

        // Filter out effects that are already active on the target actor
        const unappliedEffects = applicableEffects.filter(effect => {
            const effectName = effect.name ?? effect.label;
            const effectUuid = effect.uuid ?? effect.id;
            return !_isEffectActiveOnActor(actor, effect, effectUuid, effectName, activity);
        });

        const autoApplyNames = _getAutoApplyEffectNames();
        const isAutoApplyEffect = effect => autoApplyNames.has(_cleanName(effect.name ?? effect.label));

        if (!unappliedEffects.length) {
            debug(`Self Effect Application | All self effects for "${activity.item?.name || activity.name}" are already active on "${actor.name}" — skipping prompt card.`);
            // Auto-apply effects that are already running still don't need the usage card's effect tray.
            if (applicableEffects.some(isAutoApplyEffect)) await _markUsageMessageAutoApplied(results?.message);
            return;
        }

        debug(`Self Effect Application | Item "${activity.item?.name}" on "${actor.name}" has ${unappliedEffects.length} unapplied self-targeted effect(s).`);

        // Check if there is an active concentration effect from this activity/item
        const requiresConcentration = activity.requiresConcentration || activity.item?.requiresConcentration;
        const concentrationId = results?.message?.system?.concentration;
        let concentrationEffect = concentrationId ? actor.effects.get(concentrationId) : null;
        if (!concentrationEffect && results?.effects?.length) {
            concentrationEffect = results.effects.find(e => _isConcentrationEffect(e)) || null;
        }
        if (!concentrationEffect && requiresConcentration && actor.concentration?.effects?.size > 0) {
            const itemUuid = activity.item?.uuid;
            const itemId = activity.item?.id;
            concentrationEffect = Array.from(actor.concentration.effects).find(e => {
                const itemFlag = e.getFlag?.("dnd5e", "item");
                return itemFlag?.id === itemId || itemFlag?.uuid === itemUuid || e.origin === itemUuid;
            }) || null;
        }
        const concentrationUuid = concentrationEffect?.uuid || null;

        // Effects listed in the auto-apply setting are applied straight away. The card is still
        // posted, with those effects already in their applied state so they can be undone.
        const autoApplyEffects = unappliedEffects.filter(isAutoApplyEffect);
        const effectsApplied = autoApplyEffects.length
            ? await _autoApplyEffects(actor, activity, autoApplyEffects, { concentrationUuid, message: results?.message })
            : {};

        await _sendSelfEffectPrompt(actor, activity, unappliedEffects, {
            concentrationUuid,
            message: results?.message,
            effectsApplied
        });
    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Error in _onPostUseActivity for Self Effect Application:`, err);
    }
}

/**
 * Helper to determine whether an ActiveEffect is a concentration effect.
 * Concentration effects track spell concentration in DnD5e and must never be
 * merged with, overwritten by, or deleted during buff application.
 *
 * @param {ActiveEffect5e|object} effect
 * @returns {boolean}
 */
function _isConcentrationEffect(effect) {
    if (!effect) return false;
    if (effect.system?.type === "concentrating") return true;
    const concentratingId = CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating";
    if (effect.statuses instanceof Set) {
        if (effect.statuses.has("concentrating") || effect.statuses.has(concentratingId)) return true;
    } else if (Array.isArray(effect.statuses)) {
        if (effect.statuses.includes("concentrating") || effect.statuses.includes(concentratingId)) return true;
    }
    return false;
}

/**
 * Check whether an effect is currently active as an applied buff on an actor.
 * Matches against Item Name, Effect Name, Source Effect UUID, or Status IDs.
 *
 * @param {Actor5e} actor
 * @param {ActiveEffect5e} effect
 * @param {string} effectUuid
 * @param {string} effectName
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isEffectActiveOnActor(actor, effect, effectUuid, effectName, activity) {
    const cleanItemName = _cleanName(activity.item?.name);
    const cleanEffectName = _cleanName(effectName || effect.name || effect.label);
    const effectStatuses = effect.statuses ? Array.from(effect.statuses) : [];

    return actor.effects.some(e => {
        // Must be enabled and not suppressed
        if (e.disabled || e.isSuppressed) return false;

        // Ignore static/passive item transfer effect definitions on the actor
        if (e.transfer) return false;

        // Concentration effects are tracked separately and must never be matched as this buff effect
        if (_isConcentrationEffect(e)) return false;

        // Match exact effect UUID, module flag, or duplicateSource stats
        if (effectUuid && (e.uuid === effectUuid || e.id === effect.id || e.getFlag?.(MODULE_ID, "sourceEffectUuid") === effectUuid || e._stats?.duplicateSource === effectUuid || e._stats?.compendiumSource === effectUuid || e.origin === effectUuid)) return true;

        // Match by status ID overlap
        if (effectStatuses.length > 0 && e.statuses?.size > 0) {
            if (effectStatuses.some(statusId => e.statuses.has(statusId))) return true;
        }

        // Match by exact clean item name or effect name
        const eName = _cleanName(e.name || e.label);
        if (eName) {
            if (cleanEffectName && eName === cleanEffectName) return true;
            if (cleanItemName && eName === cleanItemName) return true;
        }

        return false;
    });
}




// ── Direct application ───────────────────────────────────────────────

/**
 * Apply effects straight to the source actor, then flag the activity's usage message so its
 * effect application tray renders collapsed on all clients.
 *
 * @param {Actor5e} actor
 * @param {Activity} activity
 * @param {ActiveEffect5e[]} effects
 * @param {object} [options]
 * @param {string|null} [options.concentrationUuid]
 * @param {ChatMessage|null} [options.message]  The activity usage message.
 * @returns {Promise<Record<string, string>>} createdEffectId → source effect UUID for each applied effect,
 *                                            in the shape of the prompt card's `effectsApplied` flag.
 */
async function _autoApplyEffects(actor, activity, effects, { concentrationUuid = null, message = null } = {}) {
    const effectsApplied = {};
    for (const effect of effects) {
        const effectName = effect.name ?? effect.label ?? game.i18n.localize("ND5T.SelfEffectApplication.UnknownEffect");
        try {
            const effectUuid = effect.uuid ?? effect.id ?? "";
            const createdId = await _createEffectOnActor(actor, {
                effectUuid,
                effectName,
                effectData: _serializeEffectData(effect),
                activityUuid: activity.uuid,
                itemUuid: activity.item?.uuid,
                usageMessageUuid: message?.uuid,
                spellLevel: message?.system?.level ?? activity.item?.system?.level ?? null,
                concentrationUuid,
                fallbackMessage: message
            });
            effectsApplied[createdId ?? "unknown"] = effectUuid;
            debug(`Self Effect Application | ✓ Auto-applied effect "${effectName}" to "${actor.name}" (id: ${createdId})`);
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Self Effect Application: Failed to auto-apply effect "${effectName}" to "${actor.name}":`, err);
            ui.notifications.error(game.i18n.localize("ND5T.SelfEffectApplication.ApplyError"));
        }
    }

    if (Object.keys(effectsApplied).length) await _markUsageMessageAutoApplied(message);
    return effectsApplied;
}

/**
 * Collapse the usage message's effect application tray on this client, then flag the message
 * so every client renders it collapsed.
 *
 * @param {ChatMessage|null} message  The activity usage message.
 */
async function _markUsageMessageAutoApplied(message) {
    if (!message?.id) return;
    const element = _getChatMessageElement(message.id);
    if (element) _collapseEffectTray(message, element);
    if (!message.isOwner || message.getFlag?.(MODULE_ID, "selfEffectAutoApplied")) return;
    try {
        await message.setFlag(MODULE_ID, "selfEffectAutoApplied", true);
    } catch (err) {
        debug(`Self Effect Application | Could not flag usage message ${message.id} as auto-applied: ${err?.message ?? err}`);
    }
}

/**
 * Collapse the effect application tray(s) of a usage message whose self effects were auto-applied.
 *
 * Only the first collapse on each client is forced. `message._trayStates` cannot tell an
 * auto-opened tray from one the user opened: `ChatLog5e#updateMessage` records the tray's current
 * `open` state right before re-rendering, so the re-render caused by our own flag write records it
 * as open. After the first collapse, dnd5e's tray state tracking keeps whatever the user chooses.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} element  Rendered message element.
 */
function _collapseEffectTray(message, element) {
    if (message._nd5tEffectTrayCollapsed) return;
    const trays = element.querySelectorAll("effect-application");
    if (!trays.length) return;
    message._nd5tEffectTrayCollapsed = true;
    // Seed dnd5e's tray state so other renders of this message (popouts, notifications) start collapsed.
    message._trayStates ??= new Map();
    message._trayStates.set("EFFECT-APPLICATION", false);
    for (const tray of trays) tray.removeAttribute("open");
}

// ── Chat card creation ───────────────────────────────────────────────

/**
 * Build whisper targets: the actor's owners + all GMs.
 * @param {Actor5e} actor
 * @returns {string[]} User IDs to whisper to.
 */
function _getWhisperTargets(actor) {
    const ownerIds = [];
    for (const [id, level] of Object.entries(actor.ownership)) {
        if (level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
            if (id === "default") {
                ownerIds.push(...game.users.filter(u => !u.isGM).map(u => u.id));
            } else {
                ownerIds.push(id);
            }
        }
    }
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    return [...new Set([game.user.id, ...ownerIds, ...gmIds])];
}

/**
 * Send a whispered chat card listing all self-targeted effects with Apply buttons.
 * @param {Actor5e} actor
 * @param {Activity} activity
 * @param {ActiveEffect5e[]} effects
 * @param {object} [options]
 * @param {string|null} [options.concentrationUuid]
 * @param {ChatMessage|null} [options.message]
 * @param {Record<string, string>} [options.effectsApplied]  Effects already applied (auto-apply), keyed by created effect ID.
 */
async function _sendSelfEffectPrompt(actor, activity, effects, { concentrationUuid = null, message = null, effectsApplied = {} } = {}) {
    const item = activity.item;
    const whisperUsers = _getWhisperTargets(actor);

    // Serialize effect data into flags as an array (safe from DOMPurify AND Foundry dot-expansion).
    // Keys in objects are expanded by Foundry's setFlag/create if they contain dots (like UUIDs).
    const effectFlagData = effects.map(effect => ({
        uuid: effect.uuid ?? effect.id ?? "",
        data: _serializeEffectData(effect)
    }));

    // Build one button row per effect.
    const effectButtons = effects.map(effect => {
        const effectIcon = effect.img ?? "icons/svg/aura.svg";
        const effectName = effect.name ?? effect.label ?? game.i18n.localize("ND5T.SelfEffectApplication.UnknownEffect");
        const effectUuid = effect.uuid ?? effect.id ?? "";
        const applyLabel = game.i18n.format("ND5T.SelfEffectApplication.Apply", { effectName });

        return `
            <div class="nd5t-effect-row">
                <button
                    data-action="nd5t-apply-self-effect"
                    data-actor-uuid="${actor.uuid}"
                    data-effect-uuid="${effectUuid}"
                    data-effect-name="${effectName.replace(/"/g, "&quot;")}"
                    title="${applyLabel.replace(/"/g, "&quot;")}">
                    <img src="${effectIcon}" class="nd5t-effect-icon" alt="" />
                    ${applyLabel}
                </button>
            </div>`.trim();
    }).join("\n");

    const itemName = item?.name ?? activity.name ?? "";
    const isPlural = effects.length > 1;
    const appliedUuids = new Set(Object.values(effectsApplied));
    const allApplied = effects.every(effect => appliedUuids.has(effect.uuid ?? effect.id ?? ""));
    const descriptionKey = allApplied
        ? (isPlural ? "ND5T.SelfEffectApplication.AutoAppliedPlural" : "ND5T.SelfEffectApplication.AutoAppliedSingle")
        : (isPlural ? "ND5T.SelfEffectApplication.DescriptionPlural" : "ND5T.SelfEffectApplication.DescriptionSingle");
    const description = game.i18n.format(descriptionKey, { itemName, actorName: actor.name });

    const content = `
        <div class="dnd5e chat-card item-card nd5t-self-effect-prompt" data-actor-uuid="${actor.uuid}">
            <div class="card-content nd5t-self-effect-content">
                <p>${description}</p>
            </div>
            <div class="card-buttons nd5t-self-effect-buttons">
                ${effectButtons}
            </div>
        </div>
    `.trim();

    const chatMessage = await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor }),
        whisper: whisperUsers,
        flags: {
            [MODULE_ID]: {
                selfEffectPrompt: true,
                actorUuid: actor.uuid,
                activityUuid: activity.uuid,
                itemUuid: activity.item?.uuid,
                usageMessageUuid: message?.uuid,
                concentrationUuid: concentrationUuid,
                spellLevel: message?.system?.level ?? activity.item?.system?.level ?? null,
                effects: effectFlagData,       // effectUuid → effect plain object (for apply)
                effectsApplied                 // createdEffectId → effectUuid (for undo)
            }
        }
    });

    debug(`Self Effect Application | Sent prompt card (id: ${chatMessage?.id}) for "${actor.name}" with ${effects.length} effect(s).`);
}

// ── Button binding ───────────────────────────────────────────────────

/**
 * Bind click handlers to the Apply / Undo buttons inside a rendered chat message.
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function _bindSelfEffectButtons(message, element) {
    const prompt = element.querySelector(".nd5t-self-effect-prompt");
    if (!prompt) return;

    // Guard against double-binding if both render hooks fire.
    if (prompt.dataset.bound) return;
    prompt.dataset.bound = "true";

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"]');
    if (!buttons.length) return;

    // Restore applied visual state for any effects already in the flag map.
    // Read directly from flags object to avoid dot-expansion of UUID keys.
    const effectsApplied = message.flags?.[MODULE_ID]?.effectsApplied ?? {};
    if (Object.keys(effectsApplied).length > 0) {
        _applyAppliedState(message, prompt, effectsApplied);
    }

    // Bind click handlers to every Apply button that hasn't been applied yet.
    // (Buttons that were just transitioned to "applied" are already disabled and
    // won't fire clicks, but binding is harmless and keeps the logic simple.)
    buttons.forEach(button => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            await _handleApplyClick(event, message, button, prompt);
        });
    });
}

/**
 * Handle a click on an "Apply Effect" button.
 */
async function _handleApplyClick(event, message, button, prompt) {
    const actorUuid = button.dataset.actorUuid;
    const effectUuid = button.dataset.effectUuid;
    const effectName = button.dataset.effectName;

    // Read effect plain-object from message flags.
    // IMPORTANT: effects is stored as an array of { uuid, data } to avoid Foundry expanding dots in UUIDs.
    const allEffects = message.flags?.[MODULE_ID]?.effects ?? [];
    const effectEntry = Array.isArray(allEffects)
        ? allEffects.find(e => e.uuid === effectUuid)
        : null;

    const effectData = effectEntry?.data;
    if (!effectData) {
        console.error("Nik's DnD5e Tweaks | Self Effect Application: Effect data not found in flags for", effectUuid, "| Available effects:", allEffects);
        ui.notifications.warn(game.i18n.localize("ND5T.SelfEffectApplication.ApplyError"));
        return;
    }

    await _applyEffectData(message, button, prompt, actorUuid, effectUuid, effectName, effectData);
}

/**
 * Create (or re-enable) a self effect on an actor from a source effect.
 * Shared by the prompt card's Apply button and the direct auto-apply path.
 *
 * @param {Actor5e} actor
 * @param {object} options
 * @param {string} options.effectUuid               UUID of the source effect (may be empty).
 * @param {string} options.effectName               Display name of the effect.
 * @param {object} options.effectData               Plain object data of the effect.
 * @param {string} [options.activityUuid]           UUID of the activity that was used.
 * @param {string} [options.itemUuid]               UUID of the item that was used.
 * @param {string} [options.usageMessageUuid]       UUID of the activity usage chat message.
 * @param {number|null} [options.spellLevel]        Spell level the activity was used at.
 * @param {string|null} [options.concentrationUuid] UUID of the related concentration effect.
 * @param {ChatMessage|null} [options.fallbackMessage] Message used when the usage message cannot be resolved.
 * @returns {Promise<string|null>} ID of the created or re-enabled effect on the actor.
 */
async function _createEffectOnActor(actor, {
    effectUuid, effectName, effectData, activityUuid = null, itemUuid = null,
    usageMessageUuid = null, spellLevel = null, concentrationUuid = null, fallbackMessage = null
}) {
    let createdId = null;

    // Try to fetch source effect document (e.g. from item or actor)
    const sourceEffect = effectUuid ? await fromUuid(effectUuid) : null;
    itemUuid = itemUuid || (effectUuid ? effectUuid.split(".ActiveEffect")[0] : null);

    // Resolve activity and item first
    const activity = activityUuid ? await fromUuid(activityUuid) : null;
    const item = itemUuid ? await fromUuid(itemUuid) : (activity?.item ?? sourceEffect?.parent);
    const requiresConcentration = activity?.requiresConcentration ?? item?.requiresConcentration ?? false;

    // Resolve concentration effect if present and required
    concentrationUuid = concentrationUuid || null;
    if (concentrationUuid) {
        const conc = await fromUuid(concentrationUuid);
        if (!conc || conc.disabled) concentrationUuid = null;
    }
    if (!concentrationUuid && requiresConcentration && actor.concentration?.effects?.size > 0) {
        const itemId = item?.id ?? itemUuid?.split(".")?.pop();
        const conc = Array.from(actor.concentration.effects).find(e => {
            const itemFlag = e.getFlag?.("dnd5e", "item");
            return itemFlag?.id === itemId || itemFlag?.uuid === itemUuid || e.origin === itemUuid;
        });
        if (conc && !conc.disabled) concentrationUuid = conc.uuid;
    }

    const sourceKey = (sourceEffect?.inCompendium || effectData._stats?.compendiumSource) ? "compendiumSource" : "duplicateSource";
    const cleanTargetName = _cleanName(effectName || effectData.name || effectData.label);
    const effectStatuses = effectData.statuses ? Array.from(effectData.statuses) : [];
    const usageMessage = (usageMessageUuid ? await fromUuid(usageMessageUuid) : null) ?? fallbackMessage;

    // Get dynamic changes from activity if available (e.g. scaling or duration overrides)
    const activityChanges = activity?.getAppliedEffectChanges?.(
        sourceEffect ?? { duration: effectData.duration ?? {}, ...effectData },
        { chatMessage: usageMessage, target: actor }
    ) ?? {};

    const changes = foundry.utils.mergeObject(activityChanges, {
        flags: {
            dnd5e: {
                dependentOn: concentrationUuid || undefined,
                spellLevel: spellLevel || undefined
            },
            [MODULE_ID]: {
                sourceEffectUuid: effectUuid
            }
        },
        system: {
            origin: {
                [activity ? "activity" : "item"]: activity?.uuid ?? itemUuid ?? sourceEffect?.parent?.uuid,
                effect: concentrationUuid || undefined,
                message: usageMessageUuid || undefined,
                profile: activity ? activity.effects?.find(e => (e.uuid === effectUuid) || (e._id === sourceEffect?.id))?._id : undefined
            }
        }
    });

    if (sourceEffect && sourceEffect.transfer) {
        debug(`Self Effect Application | Enabling transferred source effect "${sourceEffect.name}" (${sourceEffect.id}) on ${actor.name}`);
        await sourceEffect.update({ disabled: false });
        createdId = sourceEffect.id;

        // Clean up any stale duplicate non-transfer effects created on actor by earlier module versions
        // CRITICAL: NEVER delete or match a concentration effect!
        const duplicateEffect = actor.effects.find(e =>
            e !== sourceEffect &&
            e.parent === actor &&
            !e.transfer &&
            !_isConcentrationEffect(e) &&
            (e.origin === effectUuid || e.getFlag?.(MODULE_ID, "sourceEffectUuid") === effectUuid || (e._stats?.[sourceKey] === effectUuid))
        );
        if (duplicateEffect) {
            debug(`Self Effect Application | Cleaning up stale duplicate effect "${duplicateEffect.name}" (${duplicateEffect.id}) on ${actor.name}`);
            await duplicateEffect.delete();
        }
    } else {
        // Find existing non-transfer effect on actor:
        // Match by source effect UUID, duplicateSource, module flag, or exact origin/name if disabled.
        // CRITICAL: NEVER match a concentration effect!
        const existingEffect = actor.effects.find(e => {
            if (e.transfer) return false;
            if (_isConcentrationEffect(e)) return false;

            // Match by DnD5e's duplicateSource / compendiumSource
            if (effectUuid && (e._stats?.[sourceKey] === effectUuid || e._stats?.duplicateSource === effectUuid || e._stats?.compendiumSource === effectUuid)) return true;

            // Match by module flag
            if (effectUuid && e.getFlag?.(MODULE_ID, "sourceEffectUuid") === effectUuid) return true;

            // Match by exact origin UUID (ActiveEffect UUID, not item UUID)
            if (effectUuid && e.origin === effectUuid) return true;

            // Match by exact clean name ONLY IF disabled (re-enabling previously disabled effect)
            if (e.disabled && cleanTargetName) {
                const eName = _cleanName(e.name || e.label);
                if (eName === cleanTargetName) return true;
            }

            return false;
        });

        if (existingEffect) {
            debug(`Self Effect Application | Re-enabling existing effect "${existingEffect.name}" (${existingEffect.id}) on ${actor.name}`);
            const baseDuration = foundry.utils.deepClone(effectData.duration ?? {});
            delete baseDuration.startTime;
            delete baseDuration.startRound;
            delete baseDuration.startTurn;
            baseDuration.expired = false;

            const updateData = foundry.utils.mergeObject({
                _id: existingEffect.id,
                disabled: false,
                duration: baseDuration,
                start: ActiveEffect.implementation.getEffectStart?.() ?? { startTime: game.time.worldTime }
            }, changes);

            if (effectStatuses.length > 0) updateData.statuses = effectStatuses;
            if (effectData.img) updateData.img = effectData.img;
            if (effectData.name) updateData.name = effectData.name;

            // Properly handle changes in both DnD5e 6.x (system.changes) and legacy (changes)
            const baseChanges = sourceEffect?.system?.changes ?? effectData.system?.changes;
            if (baseChanges) {
                let systemChanges = foundry.utils.deepClone(baseChanges);
                if (typeof ActiveEffect.implementation.forApplication === "function") {
                    systemChanges = await ActiveEffect.implementation.forApplication(systemChanges, activity ?? item ?? actor, actor);
                }
                updateData.system = updateData.system ?? {};
                updateData.system.changes = systemChanges;
            } else if (effectData.changes) {
                updateData.changes = foundry.utils.deepClone(effectData.changes);
            }

            await existingEffect.update(updateData);
            createdId = existingEffect.id;
        } else {
            const baseData = sourceEffect?.toObject ? sourceEffect.toObject() : foundry.utils.deepClone(effectData);
            delete baseData._id;

            const data = foundry.utils.mergeObject(baseData, {
                disabled: false,
                transfer: false,
                origin: effectUuid || itemUuid || undefined,
                _stats: {
                    [sourceKey]: effectUuid,
                    [sourceEffect?.inCompendium ? "duplicateSource" : "compendiumSource"]: null
                }
            });

            if (effectStatuses.length > 0) data.statuses = effectStatuses;

            foundry.utils.mergeObject(data, changes);

            // For DnD5e 6.x, evaluate changes via ActiveEffect.implementation.forApplication
            if (data.system?.changes && typeof ActiveEffect.implementation.forApplication === "function") {
                data.system.changes = await ActiveEffect.implementation.forApplication(
                    data.system.changes,
                    activity ?? item ?? actor,
                    actor
                );
            }

            const [created] = await ActiveEffect.createDocuments([data], { parent: actor });
            createdId = created?.id;
        }
    }

    return createdId;
}

/**
 * Actually create the active effect on the actor.
 */
async function _applyEffectData(message, button, prompt, actorUuid, effectUuid, effectName, effectData) {
    const actor = await fromUuid(actorUuid);
    if (!actor) {
        ui.notifications.warn(game.i18n.localize("ND5T.SelfEffectApplication.ActorNotFound"));
        return;
    }

    button.disabled = true;

    debug(`Self Effect Application | Applying effect "${effectName}" to "${actor.name}"`);

    try {
        const flagsData = message.flags?.[MODULE_ID] ?? {};
        const createdId = await _createEffectOnActor(actor, {
            effectUuid,
            effectName,
            effectData,
            activityUuid: flagsData.activityUuid,
            itemUuid: flagsData.itemUuid,
            usageMessageUuid: flagsData.usageMessageUuid,
            spellLevel: flagsData.spellLevel,
            concentrationUuid: flagsData.concentrationUuid,
            fallbackMessage: message
        });

        debug(`Self Effect Application | ✓ Effect "${effectName}" applied to "${actor.name}" (id: ${createdId})`);

        // Build the new effectsApplied map.
        // Keys are the SHORT created-effect IDs (no dots), values are the source effectUuids.
        const existingApplied = message.flags?.[MODULE_ID]?.effectsApplied ?? {};
        const newApplied = { ...existingApplied, [createdId ?? "unknown"]: effectUuid };

        // Immediately update DOM for clicking client.
        _applyAppliedState(message, prompt, newApplied);

        // Persist the flag (GM writes directly; players ask via socket).
        _requestMarkApplied(message.id, newApplied);

    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Self Effect Application: Failed to apply effect "${effectName}" to "${actor.name}":`, err);
        button.disabled = false;
        ui.notifications.error(game.i18n.localize("ND5T.SelfEffectApplication.ApplyError"));
    }
}

// ── Visual state transitions ─────────────────────────────────────────

/**
 * Transition the card into the "applied" state for the given set of applied effects.
 * Disables applied buttons and adds Undo buttons for each.
 * @param {ChatMessage} message
 * @param {HTMLElement} prompt
 * @param {Record<string, string|true>} effectsApplied  effectUuid → created effect id on actor (or true)
 */
function _applyAppliedState(message, prompt, effectsApplied) {
    if (!effectsApplied || Object.keys(effectsApplied).length === 0) return;

    // effectsApplied structure: { [createdEffectId]: effectUuid }
    // Build a reverse map: effectUuid → createdEffectId for quick lookup.
    const byEffectUuid = {};
    for (const [createdId, effectUuid] of Object.entries(effectsApplied)) {
        byEffectUuid[effectUuid] = createdId;
    }

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"]');
    buttons.forEach(button => {
        const effectUuid = button.dataset.effectUuid;
        if (!byEffectUuid.hasOwnProperty(effectUuid)) return;

        // Already transitioned?
        if (button.dataset.applied === "true") return;
        button.dataset.applied = "true";
        button.disabled = true;

        const createdId = byEffectUuid[effectUuid];
        const effectName = button.dataset.effectName;
        const actorUuid = button.dataset.actorUuid;

        if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
        button.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Applied")}`;
        button.style.flex = "1";

        const row = button.closest(".nd5t-effect-row") || button.parentElement;
        row.style.display = "flex";
        row.style.flexDirection = "row";
        row.style.gap = "4px";

        // Add Undo button on the right side of the row
        if (createdId && typeof createdId === "string") {
            const undoBtn = document.createElement("button");
            undoBtn.className = "nd5t-self-effect-undo-btn";
            undoBtn.dataset.effectUuid = effectUuid;
            undoBtn.dataset.createdId = createdId;
            undoBtn.dataset.actorUuid = actorUuid;
            undoBtn.dataset.effectName = effectName;
            undoBtn.title = game.i18n.format("ND5T.SelfEffectApplication.UndoHint", { effectName });
            undoBtn.innerHTML = `<i class="fas fa-undo"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Undo")}`;
            undoBtn.style.flex = "0 0 auto";
            undoBtn.style.width = "auto";
            undoBtn.style.padding = "0 12px";

            undoBtn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                await _handleUndoClick(message, button, undoBtn, prompt, actorUuid, createdId, effectUuid, effectName);
            });

            row.appendChild(undoBtn);
        }
    });
}

/**
 * Restore the card to its unapplied state for the given effect.
 * @param {HTMLElement} prompt
 * @param {string} effectUuid
 */
function _revertAppliedState(prompt, effectUuid) {
    const button = prompt.querySelector(`button[data-action="nd5t-apply-self-effect"][data-effect-uuid="${effectUuid}"]`);
    if (!button) return;

    const row = button.closest(".nd5t-effect-row") || button.parentElement;
    const undoBtn = row.querySelector(`.nd5t-self-effect-undo-btn[data-effect-uuid="${effectUuid}"]`);
    if (undoBtn) undoBtn.remove();

    button.dataset.applied = "";
    button.disabled = false;
    button.style.flex = "";

    if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
    }
}

// ── Undo handling ────────────────────────────────────────────────────

/**
 * Handle a click on an "Undo" button.
 */
async function _handleUndoClick(message, applyButton, undoButton, prompt, actorUuid, createdId, effectUuid, effectName) {
    undoButton.disabled = true;
    undoButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

    debug(`Self Effect Application | Undoing effect "${effectName}" on actor ${actorUuid}, effect id ${createdId}`);

    try {
        const actor = await fromUuid(actorUuid);
        // Look up the created effect document directly on the actor first
        let effect = actor?.effects?.get(createdId);
        if (!effect && effectUuid) {
            // Only fall back to effectUuid if it was a transferred effect on an item
            const candidate = await fromUuid(effectUuid);
            if (candidate?.transfer) effect = candidate;
        }

        if (effect) {
            // Guard: Never touch or remove a concentration effect on undo
            if (!_isConcentrationEffect(effect)) {
                if (effect.parent === actor && !effect.transfer) {
                    await effect.delete();
                    debug(`Self Effect Application | ✓ Deleted effect ${createdId} on "${actor?.name ?? actorUuid}"`);
                } else {
                    await effect.update({ disabled: true });
                    debug(`Self Effect Application | ✓ Disabled effect ${createdId} on "${actor?.name ?? actorUuid}"`);
                }
            } else {
                debug(`Self Effect Application | Skipped undo for concentration effect ${createdId} on "${actor?.name ?? actorUuid}"`);
            }
        } else {
            debug(`Self Effect Application | Effect ${createdId} no longer found on "${actor?.name ?? actorUuid}" (already removed or expired)`);
        }

        // Build a new effectsApplied without this effect's entry.
        const existingApplied = message.flags?.[MODULE_ID]?.effectsApplied ?? {};
        const newApplied = { ...existingApplied };
        delete newApplied[createdId];

        _revertAppliedState(prompt, effectUuid);
        _requestMarkApplied(message.id, newApplied);

    } catch (err) {
        console.error(`Nik's DnD5e Tweaks | Self Effect Application: Failed to undo effect "${effectName}":`, err);
        undoButton.disabled = false;
        undoButton.innerHTML = `<i class="fas fa-undo"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Undo")}`;
        ui.notifications.error(game.i18n.localize("ND5T.SelfEffectApplication.UndoError"));
    }
}

// ── Flag sync ────────────────────────────────────────────────────────

/**
 * Handle updateChatMessage to sync button states across all clients
 * when the effectsApplied flag changes. Foundry does NOT re-fire the
 * renderChatMessageHTML hook on flag updates.
 * @param {ChatMessage} message
 * @param {object} updateData
 */
function _onUpdateSelfEffectApplied(message, updateData) {
    const updateFlags = updateData?.flags?.[MODULE_ID];
    if (!updateFlags) return;

    // Only care about our self-effect prompt messages.
    if (!message.getFlag(MODULE_ID, "selfEffectPrompt")) return;

    const li = _getChatMessageElement(message.id);
    if (!li) return;
    const prompt = li.querySelector(".nd5t-self-effect-prompt");
    if (!prompt) return;

    // Handle unset (full undo — effectsApplied removed entirely)
    if (updateFlags.hasOwnProperty("-=effectsApplied") || updateFlags.effectsApplied === null) {
        debug("Self Effect Application | updateChatMessage: effectsApplied cleared for message", message.id);
        // Revert all applied buttons.
        const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"][data-applied="true"]');
        buttons.forEach(btn => _revertAppliedState(prompt, btn.dataset.effectUuid));
        return;
    }

    // Handle set/update
    const effectsApplied = updateFlags.effectsApplied;
    if (effectsApplied && typeof effectsApplied === "object") {
        debug("Self Effect Application | updateChatMessage: effectsApplied updated for message", message.id, effectsApplied);
        _syncButtonStates(message, prompt, effectsApplied);
    }
}

/**
 * Sync each button's applied/unapplied visual state with the current effectsApplied map.
 */
function _syncButtonStates(message, prompt, effectsApplied) {
    // effectsApplied: { [createdEffectId]: effectUuid }
    // Build a set of effectUuids that are currently applied.
    const appliedUuids = new Set(Object.values(effectsApplied));

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"]');
    buttons.forEach(button => {
        const effectUuid = button.dataset.effectUuid;
        const isApplied = appliedUuids.has(effectUuid);
        const wasApplied = button.dataset.applied === "true";

        if (isApplied && !wasApplied) {
            // Newly applied — transition to applied state.
            _applyAppliedState(message, prompt, effectsApplied);
        } else if (!isApplied && wasApplied) {
            // Reverted — transition back.
            _revertAppliedState(prompt, effectUuid);
        }
    });
}

/**
 * Helper to safely find a chat message element in the DOM.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function _getChatMessageElement(id) {
    return document.querySelector(`.message[data-message-id="${id}"]`)
        ?? document.querySelector(`li[data-message-id="${id}"]`);
}

// ── Socket sync ──────────────────────────────────────────────────────

/**
 * Request that the effectsApplied flag be written to the message.
 * If the current user is the message author or a GM, writes directly.
 * Otherwise, emits a socket message so the GM can write it.
 * @param {string} messageId
 * @param {Record<string, string|true>} effectsApplied
 */
function _requestMarkApplied(messageId, effectsApplied) {
    const msg = game.messages.get(messageId);
    if (!msg) return;
    const authorId = msg.author?.id ?? msg.user?.id;

    if (game.user.id === authorId || game.user.isGM) {
        _writeEffectsAppliedFlag(messageId, effectsApplied);
    } else {
        debug("Self Effect Application | Emitting socket to update effectsApplied:", messageId, effectsApplied);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "selfEffectApplied",
            messageId,
            effectsApplied
        });
    }
}

/**
 * Write (or clear) the effectsApplied flag on a message.
 * Must be called on the message author or a GM client.
 * @param {string} messageId
 * @param {Record<string, string|true>} effectsApplied
 */
async function _writeEffectsAppliedFlag(messageId, effectsApplied) {
    const message = game.messages.get(messageId);
    if (!message) return;

    if (Object.keys(effectsApplied).length === 0) {
        // Clear the flag entirely when nothing is applied.
        await message.unsetFlag(MODULE_ID, "effectsApplied");
        debug("Self Effect Application | ✓ Cleared effectsApplied flag on message", messageId);
    } else {
        await message.setFlag(MODULE_ID, "effectsApplied", effectsApplied);
        debug("Self Effect Application | ✓ Wrote effectsApplied flag on message", messageId, effectsApplied);
    }
}

/**
 * Handle incoming socket messages relevant to self-effect application.
 * Called by the central socket dispatcher in main.js.
 * @param {object} data  The socket payload.
 */
export function onSocketMessage(data) {
    if (data?.type !== "selfEffectApplied") return;

    const msg = game.messages.get(data.messageId);
    if (!msg) return;

    // Only the message author or the primary GM should write the flag.
    const authorId = msg.author?.id ?? msg.user?.id;
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (game.user.id !== authorId && !primaryGM?.isSelf) return;

    debug("Self Effect Application | Socket received: selfEffectApplied for message", data.messageId, data.effectsApplied);
    _writeEffectsAppliedFlag(data.messageId, data.effectsApplied);
}
