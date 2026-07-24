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
async function _onPostUseActivity(activity, usageConfig, results) {
    if (!game.settings.get(MODULE_ID, "enableSelfEffectApplication")) return;

    // Only the primary GM runs this to avoid duplicate cards.
    const primaryGM = game.users.primaryGM ?? game.users.activeGM;
    if (!primaryGM?.isSelf) return;

    // The activity must have "self" as its target type.
    const targetType = activity.target?.affects?.type;
    if (targetType !== "self") return;

    // The activity must have applicable Active Effects.
    const applicableEffects = activity.applicableEffects;
    if (!applicableEffects?.length) return;

    const actor = activity.item?.actor;
    if (!actor) return;

    debug(`Self Effect Application | Activity "${activity.name}" on "${actor.name}" has ${applicableEffects.length} self-targeted effect(s).`);

    await _sendSelfEffectPrompt(actor, activity, applicableEffects);
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
    return [...new Set([...ownerIds, ...gmIds])];
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

    // Build one button row per effect.
    const effectButtons = effects.map(effect => {
        const effectData = JSON.stringify(effect.toObject()).replace(/"/g, "&quot;");
        const effectIcon = effect.img ?? "icons/svg/aura.svg";
        const effectName = effect.name ?? effect.label ?? game.i18n.localize("ND5T.SelfEffectApplication.UnknownEffect");
        const effectUuid = effect.uuid;
        const applyLabel = game.i18n.format("ND5T.SelfEffectApplication.Apply", { effectName });

        return `
            <button
                data-action="nd5t-apply-self-effect"
                data-actor-uuid="${actor.uuid}"
                data-effect-uuid="${effectUuid}"
                data-effect-data="${effectData}"
                data-effect-name="${effectName.replace(/"/g, "&quot;")}"
                title="${applyLabel.replace(/"/g, "&quot;")}">
                <img src="${effectIcon}" class="nd5t-effect-icon" alt="" />
                ${applyLabel}
            </button>`.trim();
    }).join("\n");

    const itemIcon = item?.img ?? "icons/svg/aura.svg";
    const itemName = item?.name ?? activity.name ?? "";
    const description = game.i18n.format("ND5T.SelfEffectApplication.Description", { itemName, actorName: actor.name });

    const content = `
        <div class="dnd5e chat-card item-card nd5t-self-effect-prompt" data-actor-uuid="${actor.uuid}">
            <header class="card-header flexrow">
                <img src="${itemIcon}" title="${itemName.replace(/"/g, "&quot;")}" width="36" height="36" />
                <h3>${itemName}</h3>
            </header>
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
                effectsApplied: {}  // effectUuid → created effect UUID on actor (for undo)
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
    const effectsApplied = message.getFlag(MODULE_ID, "effectsApplied") ?? {};
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

    // Reconstruct the effect data from the JSON attribute.
    let effectData;
    try {
        effectData = JSON.parse(button.dataset.effectData.replace(/&quot;/g, '"'));
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Self Effect Application: Failed to parse effect data", err);
        return;
    }

    const actor = await fromUuid(actorUuid);
    if (!actor) {
        ui.notifications.warn(game.i18n.localize("ND5T.SelfEffectApplication.ActorNotFound"));
        return;
    }

    // Disable button immediately for the clicking client to prevent double-clicks.
    button.disabled = true;

    debug(`Self Effect Application | Applying effect "${effectName}" to "${actor.name}"`);

    try {
        // Strip the id so a fresh one is generated on creation.
        delete effectData._id;

        // Set origin so this effect can be identified for undo.
        if (effectUuid) effectData.origin = effectUuid;

        const [created] = await ActiveEffect.createDocuments([effectData], { parent: actor });
        const createdId = created?.id;

        debug(`Self Effect Application | ✓ Effect "${effectName}" applied to "${actor.name}" (created id: ${createdId})`);

        // Build the new effectsApplied map: effectUuid → created effect id.
        const existingApplied = message.getFlag(MODULE_ID, "effectsApplied") ?? {};
        const newApplied = { ...existingApplied, [effectUuid]: createdId ?? true };

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

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"]');
    buttons.forEach(button => {
        const effectUuid = button.dataset.effectUuid;
        if (!effectsApplied.hasOwnProperty(effectUuid)) return;

        // Already transitioned?
        if (button.dataset.applied === "true") return;
        button.dataset.applied = "true";
        button.disabled = true;

        const createdId = effectsApplied[effectUuid];
        const effectName = button.dataset.effectName;
        const actorUuid = button.dataset.actorUuid;

        // Replace button text with "Applied ✓"
        const originalHtml = button.innerHTML;
        button.innerHTML = `<i class="fas fa-check"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Applied")}`;

        // Build the row container if not already a flex row.
        const container = button.parentElement;
        if (!container.dataset.undoSetup) {
            container.dataset.undoSetup = "true";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "4px";
        }

        // Add Undo button only if we have the created effect id to delete.
        if (createdId && typeof createdId === "string") {
            const undoBtn = document.createElement("button");
            undoBtn.className = "nd5t-self-effect-undo-btn";
            undoBtn.dataset.effectUuid = effectUuid;
            undoBtn.dataset.createdId = createdId;
            undoBtn.dataset.actorUuid = actorUuid;
            undoBtn.dataset.effectName = effectName;
            undoBtn.title = game.i18n.format("ND5T.SelfEffectApplication.UndoHint", { effectName });
            undoBtn.innerHTML = `<i class="fas fa-undo"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Undo")}`;

            undoBtn.addEventListener("click", async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();

                await _handleUndoClick(message, button, undoBtn, prompt, originalHtml, actorUuid, createdId, effectUuid, effectName);
            });

            // Insert undo button directly after the apply button in the container.
            button.insertAdjacentElement("afterend", undoBtn);
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

    const undoBtn = prompt.querySelector(`.nd5t-self-effect-undo-btn[data-effect-uuid="${effectUuid}"]`);
    if (undoBtn) undoBtn.remove();

    button.dataset.applied = "";
    button.disabled = false;
    // Restore original HTML — the apply button text
    const effectName = button.dataset.effectName;
    const effectIcon = button.querySelector("img")?.outerHTML ?? "";
    const applyLabel = game.i18n.format("ND5T.SelfEffectApplication.Apply", { effectName });
    button.innerHTML = `${effectIcon} ${applyLabel}`;

    // Note: the click handler from _bindSelfEffectButtons is still attached.
    // We don't need to re-bind — enabling the button is sufficient.
}

// ── Undo handling ────────────────────────────────────────────────────

/**
 * Handle a click on an "Undo" button.
 */
async function _handleUndoClick(message, applyButton, undoButton, prompt, originalHtml, actorUuid, createdId, effectUuid, effectName) {
    undoButton.disabled = true;
    undoButton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize("ND5T.SelfEffectApplication.Undoing")}`;

    debug(`Self Effect Application | Undoing effect "${effectName}" on actor ${actorUuid}, effect id ${createdId}`);

    try {
        const actor = await fromUuid(actorUuid);
        if (actor) {
            const effect = actor.effects.get(createdId);
            if (effect) {
                await effect.delete();
                debug(`Self Effect Application | ✓ Deleted effect ${createdId} from "${actor.name}"`);
            } else {
                debug(`Self Effect Application | Effect ${createdId} no longer found on "${actor.name}" (already removed?)`);
            }
        }

        // Build a new effectsApplied without this effect's entry.
        const existingApplied = message.getFlag(MODULE_ID, "effectsApplied") ?? {};
        const newApplied = { ...existingApplied };
        delete newApplied[effectUuid];

        // Immediately revert DOM for clicking client.
        _revertAppliedState(prompt, effectUuid);

        // Persist the updated flag.
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
    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-self-effect"]');
    buttons.forEach(button => {
        const effectUuid = button.dataset.effectUuid;
        const isApplied = effectsApplied.hasOwnProperty(effectUuid);
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

    // Only the message author or a GM should write the flag.
    const authorId = msg.author?.id ?? msg.user?.id;
    if (game.user.id !== authorId && !game.user.isGM) return;

    debug("Self Effect Application | Socket received: selfEffectApplied for message", data.messageId, data.effectsApplied);
    _writeEffectsAppliedFlag(data.messageId, data.effectsApplied);
}
