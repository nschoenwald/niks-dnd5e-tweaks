/**
 * Area Spell Automation: The whispered prompt card, and its socket requests.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { MODULE_ID, debug } from "../../../context.js";
import { getBehaviorActivity } from "./activity.js";
import { CLAIM_TIMEOUT_MS } from "./config.js";
import { executeAreaSpell, rollDelegatedDamage } from "./execute.js";
import { claimedPrompts, pendingClaims, promptLocks, triggeredLocal } from "./state.js";
import { registerSocketHandlers } from "../../../utils/socket-router.js";

/**
 * Users who receive the prompt: GMs, plus the caster's owners in "Prompt Caster" mode.
 * @param {Actor5e} actor
 * @param {string} mode
 * @returns {string[]}
 */
function _getPromptRecipients(actor, mode) {
    const users = game.users.filter(u => u.isGM
        || ((mode === "promptCaster") && actor?.testUserPermission(u, "OWNER")));
    return users.map(u => u.id);
}

/**
 * Whisper a prompt asking whether the triggered creatures should make their saves.
 * Triggers from the same combat turn, or from consecutive turns of combatants with the same
 * initiative, are added to the open card for this emanation as long as nobody has used it yet.
 * @param {RegionBehavior} behavior
 * @param {{token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}[]} entries
 * @param {string} mode
 */
export async function postPrompt(behavior, entries, mode) {
    const previous = promptLocks.get(behavior.uuid) ?? Promise.resolve();
    const current = previous.then(() => _postPromptGroups(behavior, entries, mode));
    promptLocks.set(behavior.uuid, current.catch(() => {}));
    await current;
}

/**
 * Post or extend one prompt card per merge key in the batch.
 * @param {RegionBehavior} behavior
 * @param {{token: TokenDocument, turnKey: string|null, mergeKey: string|null, reason: string}[]} entries
 * @param {string} mode
 */
async function _postPromptGroups(behavior, entries, mode) {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.mergeKey)) groups.set(entry.mergeKey, []);
        groups.get(entry.mergeKey).push({
            tokenUuid: entry.token.uuid,
            turnKey: entry.turnKey,
            reason: entry.reason,
            name: entry.token.name,
            img: entry.token.texture?.src ?? "icons/svg/mystery-man.svg"
        });
    }

    const activity = getBehaviorActivity(behavior);
    const actor = activity?.actor;
    const itemName = activity?.item?.name ?? "";
    const kind = _getPromptKind(activity);

    for (const [mergeKey, groupEntries] of groups) {
        const existing = mergeKey ? _findOpenPrompt(behavior.uuid, mergeKey) : null;
        if (existing) {
            const prompt = existing.getFlag(MODULE_ID, "damageEmanationPrompt");
            // A creature already on the card keeps its row but takes the newer turn key, the one
            // now stored in `system.triggered`, so skipping it clears the right key.
            const byToken = new Map(prompt.entries.map(e => [e.tokenUuid, { ...e }]));
            for (const entry of groupEntries) {
                const known = byToken.get(entry.tokenUuid);
                if (known) known.turnKey = entry.turnKey;
                else byToken.set(entry.tokenUuid, entry);
            }
            const merged = Array.from(byToken.values());
            await existing.update({
                content: _buildPromptContent(itemName, merged, prompt.kind ?? "save"),
                [`flags.${MODULE_ID}.damageEmanationPrompt.entries`]: merged
            });
            debug(`Area Spells | Added ${groupEntries.length} creature(s) to open prompt ${existing.id}`);
            continue;
        }

        await ChatMessage.create({
            content: _buildPromptContent(itemName, groupEntries, kind),
            speaker: ChatMessage.getSpeaker({ actor }),
            whisper: _getPromptRecipients(actor, mode),
            flags: {
                [MODULE_ID]: {
                    damageEmanationPrompt: {
                        behaviorUuid: behavior.uuid,
                        mergeKey,
                        entries: groupEntries,
                        kind,
                        state: "pending"
                    }
                }
            }
        });
    }
}

/**
 * The newest unresolved prompt card of an emanation for a merge key, if this user can edit it.
 * @param {string} behaviorUuid
 * @param {string} mergeKey
 * @returns {ChatMessage|null}
 */
function _findOpenPrompt(behaviorUuid, mergeKey) {
    const messages = game.messages.contents;
    for (let i = messages.length - 1, checked = 0; (i >= 0) && (checked < 50); i--, checked++) {
        const message = messages[i];
        const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
        if (!prompt || (prompt.behaviorUuid !== behaviorUuid) || (prompt.mergeKey !== mergeKey)) continue;
        if ((prompt.state !== "pending") || claimedPrompts.has(message.id)
            || !message.canUserModify(game.user, "update")) return null;
        return message;
    }
    return null;
}

/**
 * Whether the prompt asks for saving throws or for damage (activities without a save).
 * @param {Activity|null} activity
 * @returns {"save"|"damage"}
 */
function _getPromptKind(activity) {
    return activity?.type === "damage" ? "damage" : "save";
}

/**
 * Build the prompt card's HTML.
 * @param {string} itemName
 * @param {{tokenUuid: string, reason: string, name: string, img: string}[]} entries
 * @param {"save"|"damage"} kind
 * @returns {string}
 */
function _buildPromptContent(itemName, entries, kind) {
    const suffix = kind === "damage" ? "Damage" : "";
    const rows = entries.map(({ tokenUuid, reason, name, img }) => {
        const reasonLabel = game.i18n.localize(`ND5T.DamageEmanation.Reason.${reason}`);
        return `
            <li class="nd5t-emanation-target">
                <label>
                    <input type="checkbox" data-token-uuid="${tokenUuid}" checked>
                    <img src="${img}" alt="">
                    <span class="nd5t-emanation-name">${foundry.utils.escapeHTML(name ?? "")}</span>
                    <span class="nd5t-emanation-reason">${reasonLabel}</span>
                </label>
            </li>`.trim();
    }).join("");

    return `
        <div class="dnd5e chat-card nd5t-emanation-prompt">
            <div class="card-content">
                <p>${game.i18n.format(`ND5T.DamageEmanation.PromptDescription${suffix}`, { itemName: foundry.utils.escapeHTML(itemName) })}</p>
                <ul class="nd5t-emanation-targets">${rows}</ul>
            </div>
            <div class="card-buttons nd5t-emanation-buttons">
                <button type="button" data-action="nd5t-emanation-trigger">
                    <i class="fa-solid fa-burst" inert></i> ${game.i18n.localize(`ND5T.DamageEmanation.Trigger${suffix}`)}
                </button>
                <button type="button" data-action="nd5t-emanation-skip">
                    <i class="fa-solid fa-xmark" inert></i> ${game.i18n.localize("ND5T.DamageEmanation.Skip")}
                </button>
            </div>
        </div>`.trim();
}

/**
 * Bind the prompt card's buttons.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function onRenderChatMessage(message, html) {
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt) return;
    const card = html.querySelector(".nd5t-emanation-prompt");
    if (!card || card.dataset.bound) return;
    card.dataset.bound = "true";

    if (prompt.state !== "pending") {
        _renderResolvedState(card, prompt);
        return;
    }

    const behavior = fromUuidSync(prompt.behaviorUuid, { strict: false });
    const actor = getBehaviorActivity(behavior)?.actor;
    const canAct = game.user.isGM || !!actor?.isOwner;
    for (const button of card.querySelectorAll(".nd5t-emanation-buttons button")) {
        if (!canAct) button.disabled = true;
        button.addEventListener("click", event => _onPromptButton(event, message, card));
    }
}

/**
 * Update rendered prompt cards once the prompt is resolved (flag changes don't re-render them).
 * @param {ChatMessage} message
 */
export function onUpdateChatMessage(message) {
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state === "pending")) return;
    for (const card of document.querySelectorAll(`[data-message-id="${message.id}"] .nd5t-emanation-prompt`)) {
        if (card.querySelector(".nd5t-emanation-buttons")) _renderResolvedState(card, prompt);
    }
}

/**
 * Show who resolved the prompt instead of its buttons.
 * @param {HTMLElement} card
 * @param {object} prompt
 */
function _renderResolvedState(card, prompt) {
    card.querySelectorAll(".nd5t-emanation-target input").forEach(input => {
        input.disabled = true;
        input.checked = (prompt.affected ?? []).includes(input.dataset.tokenUuid);
    });
    const buttons = card.querySelector(".nd5t-emanation-buttons");
    if (!buttons) return;
    const triggeredKey = prompt.kind === "damage" ? "ND5T.DamageEmanation.TriggeredDamage" : "ND5T.DamageEmanation.Triggered";
    const key = prompt.state === "triggered" ? triggeredKey : "ND5T.DamageEmanation.Skipped";
    const status = document.createElement("p");
    status.classList.add("nd5t-emanation-status");
    status.textContent = game.i18n.format(key, { user: prompt.resolvedBy ?? "" });
    buttons.replaceWith(status);
}

/**
 * Handle Trigger / Skip clicks on the prompt card.
 * @param {PointerEvent} event
 * @param {ChatMessage} message
 * @param {HTMLElement} card
 */
async function _onPromptButton(event, message, card) {
    event.preventDefault();
    event.stopPropagation();
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state !== "pending")) return;
    card.querySelectorAll(".nd5t-emanation-buttons button").forEach(b => b.disabled = true);

    const trigger = event.currentTarget.dataset.action === "nd5t-emanation-trigger";
    const selected = trigger
        ? Array.from(card.querySelectorAll(".nd5t-emanation-target input:checked")).map(i => i.dataset.tokenUuid)
        : [];

    // Claim the card first: only the click that resolves it rolls the saves, so two users clicking
    // at the same time can't both trigger them.
    let granted = false;
    try {
        granted = await _claimPrompt(message, selected);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Area Spells: Failed to resolve prompt", err);
    }
    if (!granted) {
        // Someone else resolved it (the card updates itself), or nobody could confirm the click
        const current = message.getFlag(MODULE_ID, "damageEmanationPrompt");
        if (current?.state === "pending") {
            card.querySelectorAll(".nd5t-emanation-buttons button").forEach(b => b.disabled = false);
        }
        return;
    }
    if (!selected.length) return;

    try {
        const behavior = await fromUuid(prompt.behaviorUuid);
        if (!behavior) {
            ui.notifications.warn(game.i18n.localize("ND5T.DamageEmanation.EmanationGone"));
            return;
        }
        const tokens = selected.map(uuid => fromUuidSync(uuid, { strict: false })).filter(Boolean);
        await executeAreaSpell(behavior, tokens);
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Area Spells: Failed to roll saves", err);
    }
}

/**
 * The user who resolves a prompt card: the active GM, otherwise the card's author if connected.
 * @param {ChatMessage} message
 * @returns {User|null}
 */
function _getPromptAuthority(message) {
    const activeGM = game.users.activeGM;
    if (activeGM) return activeGM;
    return message.author?.active ? message.author : null;
}

/**
 * Resolve the prompt on the resolving user's client and report whether this click won.
 * @param {ChatMessage} message
 * @param {string[]} affected  Token UUIDs that make the save.
 * @returns {Promise<boolean>}
 */
async function _claimPrompt(message, affected) {
    const data = { messageId: message.id, affected, resolvedBy: game.user.name };
    const authority = _getPromptAuthority(message);
    if (!authority) return false;
    if (authority.isSelf) return _applyPromptResolution(data);

    const requestId = foundry.utils.randomID();
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            pendingClaims.delete(requestId);
            resolve(false);
        }, CLAIM_TIMEOUT_MS);
        pendingClaims.set(requestId, granted => {
            clearTimeout(timer);
            pendingClaims.delete(requestId);
            resolve(granted);
        });
        game.socket.emit(`module.${MODULE_ID}`, {
            action: "damageEmanationResolve", requestId, userId: game.user.id, ...data
        });
    });
}

/**
 * Store the prompt's outcome. Creatures that were skipped may be triggered again this turn.
 * Runs only on the resolving user's client, which claims the card synchronously.
 * @param {{messageId: string, affected: string[], resolvedBy: string}} data
 * @returns {Promise<boolean>} Whether this call resolved the prompt.
 */
async function _applyPromptResolution({ messageId, affected, resolvedBy }) {
    const message = game.messages.get(messageId);
    const prompt = message?.getFlag(MODULE_ID, "damageEmanationPrompt");
    if (!prompt || (prompt.state !== "pending") || claimedPrompts.has(messageId)) return false;
    claimedPrompts.add(messageId);

    try {
        await message.setFlag(MODULE_ID, "damageEmanationPrompt", {
            ...prompt,
            state: affected.length ? "triggered" : "skipped",
            affected,
            resolvedBy
        });
    } finally {
        claimedPrompts.delete(messageId);
    }

    // Let skipped creatures trigger again this turn
    const local = triggeredLocal.get(prompt.behaviorUuid);
    const behavior = fromUuidSync(prompt.behaviorUuid, { strict: false });
    const triggered = { ...(behavior?.system.triggered ?? {}) };
    let changed = false;
    for (const { tokenUuid, turnKey } of prompt.entries ?? []) {
        if (!turnKey || affected.includes(tokenUuid)) continue;
        const tokenId = tokenUuid.split(".").pop();
        if (local?.get(tokenId) === turnKey) local.delete(tokenId);
        if (triggered[tokenId] === turnKey) {
            delete triggered[tokenId];
            changed = true;
        }
    }
    if (changed && behavior?.isOwner) {
        try {
            await behavior.update({ "system.triggered": foundry.data.operators.ForcedReplacement.create(triggered) });
        } catch (err) {
            debug("Area Spells | Could not clear skipped creatures", err);
        }
    }
    return true;
}

/**
 * Socket handler: resolve a prompt on behalf of another user, and tell them whether their click won. A prompt is
 * only resolved for a sender (from the server, not the payload) who is a GM or owns the caster, and only for the
 * creatures on the card.
 * @param {object} data
 * @param {string} senderId
 */
function onSocketMessage(data, senderId) {
    const sender = game.users.get(senderId);
    if (!sender) return;
    if (data?.action === "damageEmanationRollDamage") {
        if (data.userId === game.user.id) {
            rollDelegatedDamage(data, sender).catch(err => console.error("Nik's DnD5e Tweaks | Area Spells: Failed to roll the damage", err));
        }
        return;
    }
    if (data?.action === "damageEmanationClaimResult") {
        if (data.userId === game.user.id) pendingClaims.get(data.requestId)?.(data.granted);
        return;
    }
    if (data?.action !== "damageEmanationResolve") return;
    const message = game.messages.get(data.messageId);
    if (!message || !_getPromptAuthority(message)?.isSelf) return;
    const prompt = message.getFlag(MODULE_ID, "damageEmanationPrompt");
    const caster = getBehaviorActivity(fromUuidSync(prompt?.behaviorUuid, { strict: false }))?.actor;
    const mayResolve = sender.isGM || Boolean(caster?.testUserPermission(sender, "OWNER"));
    const onCard = new Set((prompt?.entries ?? []).map(e => e.tokenUuid));
    const affected = Array.isArray(data.affected) ? data.affected.filter(uuid => onCard.has(uuid)) : [];
    const resolution = mayResolve
        ? _applyPromptResolution({ messageId: data.messageId, affected, resolvedBy: sender.name })
        : Promise.resolve(false);
    resolution
        .catch(err => {
            console.error("Nik's DnD5e Tweaks | Area Spells: Failed to resolve prompt", err);
            return false;
        })
        .then(granted => {
            if (!data.requestId) return;
            game.socket.emit(`module.${MODULE_ID}`, {
                action: "damageEmanationClaimResult", requestId: data.requestId, userId: sender.id, granted
            });
        });
}

registerSocketHandlers("Area Spell Automation", ["damageEmanationResolve", "damageEmanationClaimResult", "damageEmanationRollDamage"], onSocketMessage);
