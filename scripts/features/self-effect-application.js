import { MODULE_ID, debug } from "../main.js";

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

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
        _bindSelfEffectButtons(message, element);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _bindSelfEffectButtons(message, html);
    });

    // Sync button state across clients when the flag is updated.
    // Foundry does NOT re-fire renderChatMessage on flag changes.
    Hooks.on("updateChatMessage", _onUpdateSelfEffectApplied);

    // Socket listener — non-GM clients ask the GM to write flags.
    Hooks.once("ready", () => {
        game.socket.on(`module.${MODULE_ID}`, _onSocketMessage);
        debug("Self Effect Application | Socket listener registered");
    });

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

    // 5. Formatted labels (fallback for localized/custom target descriptions)
    if (activity.labels?.target?.toLowerCase() === "self") return true;
    if (activity.labels?.range?.toLowerCase() === "self") return true;
    if (item?.labels?.target?.toLowerCase() === "self") return true;
    if (item?.labels?.range?.toLowerCase() === "self") return true;

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

    // 1. Check chat message flags from the activity usage
    const msgTargets = results?.message?.getFlag?.("dnd5e", "targets")
        || results?.message?.flags?.dnd5e?.targets;
    if (Array.isArray(msgTargets) && msgTargets.length > 0) {
        const isSelfInMsg = msgTargets.some(t =>
            t.uuid === actorUuid ||
            (t.uuid && actorId && t.uuid.includes(actorId)) ||
            activeTokenUuids.has(t.uuid) ||
            (t.id && activeTokenIds.has(t.id))
        );
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

/**
 * Retrieve applicable Active Effects for an activity or its parent item.
 *
 * @param {Activity} activity
 * @returns {ActiveEffect5e[]}
 */
function _getApplicableEffects(activity) {
    // 1. Check activity.applicableEffects first
    const actEffects = activity.applicableEffects;
    if (actEffects && actEffects.length > 0) return Array.from(actEffects);

    // 2. Fall back to non-transfer ActiveEffects on the item itself
    const item = activity.item;
    if (item?.effects?.size > 0 || item?.effects?.length > 0) {
        const itemEffects = Array.from(item.effects.values ? item.effects.values() : item.effects);
        const nonTransfer = itemEffects.filter(e => !e.transfer);
        if (nonTransfer.length > 0) return nonTransfer;
    }

    return [];
}

async function _onPostUseActivity(activity, usageConfig, results) {
    if (!game.settings.get(MODULE_ID, "enableSelfEffectApplication")) return;

    // Skip if midi-qol is active and configured to auto-apply item active effects
    if (game.modules.get("midi-qol")?.active) {
        const autoEffects = globalThis.MidiQOL?.configSettings?.()?.autoItemEffects
            ?? game.settings.get("midi-qol", "ConfigSettings")?.autoItemEffects;
        if (autoEffects && autoEffects !== "off" && autoEffects !== "none") {
            debug("Self Effect Application | midi-qol detected and auto-applies item effects — feature bypassed.");
            return;
        }
    }

    // Ignore CastActivity containers since the cast spell's own activity will execute
    if (activity.type === "cast") return;

    const actor = activity.item?.actor;
    if (!actor) return;

    // Check if the activity/item intrinsically targets "self" or if the actor manually targeted themselves
    const isIntrinsicSelf = _isSelfTargeted(activity);
    const isManualSelf = _hasManualSelfTarget(actor, results);

    if (!isIntrinsicSelf && !isManualSelf) return;

    // Retrieve applicable Active Effects from the activity or parent item.
    const applicableEffects = _getApplicableEffects(activity);
    if (!applicableEffects.length) return;

    // Filter out effects that are already active on the target actor
    const unappliedEffects = applicableEffects.filter(effect => {
        const effectName = effect.name ?? effect.label;
        const effectUuid = effect.uuid ?? effect.id;
        return !_isEffectActiveOnActor(actor, effect, effectUuid, effectName, activity);
    });

    if (!unappliedEffects.length) {
        debug(`Self Effect Application | All self effects for "${activity.name}" are already active on "${actor.name}" — skipping prompt card.`);
        return;
    }

    debug(`Self Effect Application | Activity "${activity.name}" on "${actor.name}" has ${unappliedEffects.length} unapplied self-targeted effect(s).`);

    await _sendSelfEffectPrompt(actor, activity, unappliedEffects);
}

/**
 * Check whether an effect is already active on an actor.
 *
 * @param {Actor5e} actor
 * @param {ActiveEffect5e} effect
 * @param {string} effectUuid
 * @param {string} effectName
 * @param {Activity} activity
 * @returns {boolean}
 */
function _isEffectActiveOnActor(actor, effect, effectUuid, effectName, activity) {
    if (effect.transfer && !effect.disabled && !effect.isSuppressed) return true;

    const cleanName = (effectName || "").trim().toLowerCase();
    const itemUuid = activity.item?.uuid;

    return actor.effects.some(e => {
        if (e.disabled || e.isSuppressed) return false;

        if (effectUuid && (e.uuid === effectUuid || e.id === effect.id || e.origin === effectUuid)) return true;
        if (itemUuid && e.origin === itemUuid) return true;
        const eName = (e.name || e.label || "").trim().toLowerCase();
        if (cleanName && eName && (eName === cleanName || eName.includes(cleanName) || cleanName.includes(eName))) return true;

        return false;
    });
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
 */
async function _sendSelfEffectPrompt(actor, activity, effects) {
    const item = activity.item;
    const whisperUsers = _getWhisperTargets(actor);

    // Serialize effect data into flags as an array (safe from DOMPurify AND Foundry dot-expansion).
    // Keys in objects are expanded by Foundry's setFlag/create if they contain dots (like UUIDs).
    const effectFlagData = effects.map(effect => ({
        uuid: effect.uuid ?? effect.id ?? "",
        data: effect.toObject ? effect.toObject() : effect
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
    const descriptionKey = isPlural ? "ND5T.SelfEffectApplication.DescriptionPlural" : "ND5T.SelfEffectApplication.DescriptionSingle";
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
                effects: effectFlagData,       // effectUuid → effect plain object (for apply)
                effectsApplied: {}             // effectUuid → created effect id on actor (for undo)
            }
        }
    });

    debug(`Self Effect Application | Sent prompt card (id: ${chatMessage?.id}) for "${actor.name}" with ${effects.length} effect(s).`);
}

// ── Button binding ───────────────────────────────────────────────────

/**
 * Bind click handlers to the Apply / Undo buttons inside a rendered chat message.
 * Shared between V13 (renderChatMessage) and V14 (renderChatMessageHTML) hooks.
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function _bindSelfEffectButtons(message, element) {
    const prompt = element.querySelector(".nd5t-self-effect-prompt");
    if (!prompt) return;

    // Guard against double-binding if both V13 + V14 render hooks fire.
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
        let createdId = null;

        // Try to fetch source effect document (e.g. from item or actor)
        const sourceEffect = effectUuid ? await fromUuid(effectUuid) : null;
        const itemUuid = effectUuid ? effectUuid.split(".ActiveEffect")[0] : null;
        const cleanTargetName = (effectName || effectData.name || effectData.label || "").trim().toLowerCase();

        if (sourceEffect && sourceEffect.transfer) {
            debug(`Self Effect Application | Enabling transferred source effect "${sourceEffect.name}" (${sourceEffect.id}) on ${actor.name}`);
            await sourceEffect.update({ disabled: false });
            createdId = sourceEffect.id;

            // Clean up any stale duplicate non-transfer effects created on actor by earlier module versions
            const duplicateEffect = actor.effects.find(e =>
                e !== sourceEffect &&
                e.parent === actor &&
                !e.transfer &&
                (e.origin === effectUuid || e.origin === itemUuid || (cleanTargetName && (e.name || e.label || "").trim().toLowerCase() === cleanTargetName))
            );
            if (duplicateEffect) {
                debug(`Self Effect Application | Cleaning up stale duplicate effect "${duplicateEffect.name}" (${duplicateEffect.id}) on ${actor.name}`);
                await duplicateEffect.delete();
            }
        } else {
            // Find existing effect on actor: match by effect UUID, parent item UUID, or normalized name/label
            const existingEffect = actor.effects.find(e => {
                if (effectUuid && (e.uuid === effectUuid || e.id === sourceEffect?.id || e.origin === effectUuid)) return true;
                if (itemUuid && e.origin === itemUuid) return true;
                const eName = (e.name || e.label || "").trim().toLowerCase();
                if (cleanTargetName && eName && (eName === cleanTargetName || eName.includes(cleanTargetName) || cleanTargetName.includes(eName))) return true;
                return false;
            });

            if (existingEffect) {
                debug(`Self Effect Application | Enabling existing effect "${existingEffect.name}" (${existingEffect.id}) on ${actor.name}`);
                await existingEffect.update({ disabled: false, origin: effectUuid || existingEffect.origin });
                createdId = existingEffect.id;
            } else {
                const data = foundry.utils.deepClone(effectData);
                delete data._id;
                data.disabled = false;
                data.transfer = false;
                if (effectUuid) data.origin = effectUuid;

                const [created] = await ActiveEffect.createDocuments([data], { parent: actor });
                createdId = created?.id;
            }
        }

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
        let effect = effectUuid ? await fromUuid(effectUuid) : null;
        if (!effect && actor) {
            effect = actor.effects.get(createdId);
        }

        if (effect) {
            // Disable the effect on undo rather than deleting it.
            // Deleting can permanently destroy the source effect if it lives on the actor or item.
            await effect.update({ disabled: true });
            debug(`Self Effect Application | ✓ Disabled effect ${createdId} on "${actor?.name ?? actorUuid}"`);
        } else {
            debug(`Self Effect Application | Effect ${createdId} no longer found on "${actor?.name ?? actorUuid}"`);
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
 * renderChatMessage hook on flag updates.
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
 * @param {object} data  The socket payload.
 */
function _onSocketMessage(data) {
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
