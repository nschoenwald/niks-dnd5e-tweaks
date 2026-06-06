import { MODULE_ID, debug, log } from "../main.js";

/**
 * Player Damage Prompt
 *
 * When the GM rolls damage from an attack activity that hit a player-owned
 * token, whispers a chat message to the owning player showing a damage
 * breakdown (with resistance/vulnerability/immunity adjustments) and a
 * one-click "Apply Damage" button.
 *
 * The feature hooks into `createChatMessage` to detect damage roll messages
 * from attack activities, traces back to the originating usage message for
 * target data, and finds the matching attack roll to determine hit/miss and
 * critical status.
 */

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the Player Damage Prompt feature.
 * Called once during the "setup" phase from main.js.
 */
export function initPlayerDamagePrompt() {
    Hooks.on("createChatMessage", _onCreateChatMessage);

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
        _bindApplyDamageButton(message, element);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _bindApplyDamageButton(message, html);
    });

    // Socket listener — any client can ask the GM to mark a message as applied
    game.socket.on(`module.${MODULE_ID}`, _onSocketMessage);

    debug("Player Damage Prompt | Initialized (socket listener registered)");
}

// ── Core handler ─────────────────────────────────────────────────────

/**
 * Handle a newly created chat message to see if it is a damage roll from
 * an attack activity that hit a targeted token.
 * @param {ChatMessage} message  The message that was just created.
 */
async function _onCreateChatMessage(message) {
    if (!game.user.isGM) return;

    // Check if at least one damage prompt mode is enabled
    const playerPromptEnabled = game.settings.get(MODULE_ID, "enablePlayerDamagePrompt");
    const gmPromptEnabled = playerPromptEnabled && game.settings.get(MODULE_ID, "enableGmDamagePrompt");
    if (!playerPromptEnabled && !gmPromptEnabled) return;

    // Only process damage rolls from attack activities
    const rollType = message.getFlag("dnd5e", "roll.type");
    const activityType = message.getFlag("dnd5e", "activity.type");
    if (rollType !== "damage") return;
    if (activityType !== "attack") return;

    // Only trigger on public rolls — skip private (GM), blind, and self rolls
    const isPublic = (!message.whisper?.length) && !message.blind;
    if (!isPublic) {
        debug("Player Damage Prompt | Non-public roll detected (whisper/blind), skipping");
        return;
    }

    // Determine if this damage was rolled by a player (non-GM author)
    const messageAuthor = message.author ?? message.user;
    const isPlayerAttack = messageAuthor && !messageAuthor.isGM;

    debug("Player Damage Prompt | Attack damage roll detected",
        "| Message ID:", message.id,
        "| Author:", messageAuthor?.name, `(${isPlayerAttack ? "player" : "GM"})`,
        "| Roll type:", rollType,
        "| Activity type:", activityType,
        "| Activity ID:", message.getFlag("dnd5e", "activity.id"),
        "| Settings: playerPrompt=", playerPromptEnabled, "gmPrompt=", gmPromptEnabled);

    // Find the originating (usage) message to get original targets
    const originatingId = message.getFlag("dnd5e", "originatingMessage");
    const originatingMessage = originatingId ? game.messages.get(originatingId) : null;
    debug("Player Damage Prompt | Originating message:",
        originatingId ? `ID ${originatingId}` : "(none)",
        "| Found:", !!originatingMessage);

    // Prefer targets from the originating (usage) message, fall back to the damage message
    const originTargets = originatingMessage?.getFlag("dnd5e", "targets");
    const damageTargets = message.getFlag("dnd5e", "targets");
    const targets = originTargets || damageTargets || [];
    debug("Player Damage Prompt | Targets from originating message:", originTargets?.length ?? 0,
        "| Targets from damage message:", damageTargets?.length ?? 0,
        "| Using:", targets.length, "targets",
        targets.length ? targets.map(t => `${t.name || t.uuid} (AC ${t.ac})`) : []);

    if (!targets.length) {
        debug("Player Damage Prompt | No targets found, skipping");
        return;
    }

    // Find the attack roll message (shares the same originatingMessage)
    const attackMessage = _findAttackMessage(originatingId);
    if (!attackMessage) {
        debug("Player Damage Prompt | No attack roll message found in last 30 messages for originatingId:", originatingId);
        return;
    }
    debug("Player Damage Prompt | Found attack roll message:", attackMessage.id,
        "| Rolls count:", attackMessage.rolls.length);

    // Extract the D20Roll from the attack message
    const attackRoll = _getAttackD20Roll(attackMessage);
    if (!attackRoll) {
        debug("Player Damage Prompt | No valid D20 attack roll found in message", attackMessage.id);
        return;
    }
    debug("Player Damage Prompt | Attack roll:",
        "total =", attackRoll.total,
        "| isCritical =", !!attackRoll.isCritical,
        "| isFumble =", !!attackRoll.isFumble,
        "| formula =", attackRoll.formula);

    // Aggregate damage by type from the damage rolls
    const damageByType = _aggregateDamage(message.rolls);
    if (Object.keys(damageByType).length === 0) {
        debug("Player Damage Prompt | No damage entries found in", message.rolls.length, "rolls, skipping");
        return;
    }
    debug("Player Damage Prompt | Aggregated damage by type:",
        Object.entries(damageByType).map(([t, v]) => `${v} ${t}`).join(", "),
        "| Raw rolls:", message.rolls.length);

    // Build a per-roll DamageDescription array (preserving properties for applyDamage)
    const rawDamages = _buildDamageDescriptions(message.rolls);
    debug("Player Damage Prompt | Built", rawDamages.length, "DamageDescriptions:",
        rawDamages.map(d => `${d.value} ${d.type} [${d.properties.join(",") || "no props"}]`));

    // Process each target
    debug("Player Damage Prompt | Processing", targets.length, "target(s)...");
    for (const target of targets) {
        await _processTarget(target, attackRoll, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled);
    }
}

// ── Message helpers ──────────────────────────────────────────────────

/**
 * Search the most recent messages for the attack roll that shares the
 * same originating (usage) message as the damage roll.
 * @param {string|null} originatingId  ID of the originating usage message.
 * @returns {ChatMessage|null}
 */
function _findAttackMessage(originatingId) {
    if (!originatingId) return null;
    const messages = game.messages.contents;
    const startIdx = Math.max(0, messages.length - 30);
    for (let i = messages.length - 1; i >= startIdx; i--) {
        const msg = messages[i];
        if (msg.getFlag("dnd5e", "roll.type") === "attack"
            && msg.getFlag("dnd5e", "originatingMessage") === originatingId) {
            return msg;
        }
    }
    return null;
}

/**
 * Extract the D20Roll from an attack roll message.  The system stores
 * basic Roll objects in the message; we convert the first d20-based roll
 * to a D20Roll so that we can access `isCritical` / `total`.
 * @param {ChatMessage} attackMessage
 * @returns {D20Roll|Roll|null}
 */
function _getAttackD20Roll(attackMessage) {
    for (const roll of attackMessage.rolls) {
        const d0 = roll.dice?.[0];
        if (d0?.faces === 20) {
            try {
                return dnd5e.dice.D20Roll.fromRoll(roll);
            } catch {
                return roll; // fall back to the raw roll
            }
        }
    }
    return attackMessage.rolls[0] || null;
}

// ── Damage helpers ───────────────────────────────────────────────────

/**
 * Read the damage type from a DamageRoll.
 * Handles both Set (live) and Array (deserialised JSON) forms.
 * @param {Roll} roll
 * @returns {string}
 */
function _getDamageType(roll) {
    const types = roll.options?.types;
    if (types) {
        if (types instanceof Set) return [...types][0] ?? "untyped";
        if (Array.isArray(types)) return types[0] ?? "untyped";
    }
    return roll.options?.type || "untyped";
}

/**
 * Read the damage properties from a DamageRoll (e.g. "magical").
 * @param {Roll} roll
 * @returns {string[]}
 */
function _getDamageProperties(roll) {
    const props = roll.options?.properties;
    if (!props) return [];
    if (props instanceof Set) return [...props];
    if (Array.isArray(props)) return props;
    return [];
}

/**
 * Aggregate damage across all rolls, grouping by damage type.
 * @param {Roll[]} rolls
 * @returns {Record<string, number>}  Map of type → total damage.
 */
function _aggregateDamage(rolls) {
    const byType = {};
    for (const roll of rolls) {
        const type = _getDamageType(roll);
        // Skip healing types
        if (CONFIG.DND5E?.healingTypes?.[type]) continue;
        byType[type] = (byType[type] || 0) + roll.total;
    }
    return byType;
}

/**
 * Build an array of DamageDescription objects from the raw rolls,
 * preserving per-roll type and properties so that `applyDamage` can
 * correctly evaluate bypasses, etc.
 * @param {Roll[]} rolls
 * @returns {Array<{value: number, type: string, properties: string[]}>}
 */
function _buildDamageDescriptions(rolls) {
    const descriptions = [];
    for (const roll of rolls) {
        const type = _getDamageType(roll);
        if (CONFIG.DND5E?.healingTypes?.[type]) continue;
        descriptions.push({
            value: roll.total,
            type,
            properties: _getDamageProperties(roll)
        });
    }
    return descriptions;
}

// ── Per-target processing ────────────────────────────────────────────

/**
 * Determine whether an actor is player-owned (at least one non-GM user
 * with OWNER permission).
 * @param {Actor} actor
 * @returns {boolean}
 */
function _isPlayerOwned(actor) {
    for (const [id, level] of Object.entries(actor.ownership)) {
        if (level !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
        if (id === "default") return true;
        const user = game.users.get(id);
        if (user && !user.isGM) return true;
    }
    return false;
}

/**
 * Collect the user IDs that should receive the whisper.  Respects the
 * `damagePromptVisibility` setting to include or exclude GMs.
 * @param {Actor} actor
 * @returns {string[]}
 */
function _getWhisperTargets(actor) {
    const owners = [];
    for (const [id, level] of Object.entries(actor.ownership)) {
        if (level !== CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
        if (id === "default") {
            owners.push(...game.users.filter(u => !u.isGM).map(u => u.id));
        } else {
            const user = game.users.get(id);
            if (user && !user.isGM) owners.push(id);
        }
    }

    const includeGM = game.settings.get(MODULE_ID, "damagePromptVisibility") === "gmAndPlayer";
    if (includeGM) {
        const gms = game.users.filter(u => u.isGM).map(u => u.id);
        owners.push(...gms);
    }

    return [...new Set(owners)];
}

/**
 * Process a single target: resolve the token/actor, check hit, calculate
 * effective damage, and send the whisper prompt.
 * @param {object}  target              Target descriptor from message flags.
 * @param {Roll}    attackRoll           The D20Roll for the attack.
 * @param {Record<string, number>} damageByType  Aggregated damage map.
 * @param {Array}   rawDamages           Per-roll DamageDescriptions for applyDamage.
 * @param {boolean} isPlayerAttack       Whether the attacker is a player (non-GM).
 * @param {boolean} playerPromptEnabled  Whether the player damage prompt setting is on.
 * @param {boolean} gmPromptEnabled      Whether the GM damage prompt setting is on.
 */
async function _processTarget(target, attackRoll, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled) {
    debug(`Player Damage Prompt | ── Processing target: ${target.name || target.uuid} (AC ${target.ac})`);

    const tokenDoc = fromUuidSync(target.uuid);
    if (!tokenDoc) {
        debug(`Player Damage Prompt |    ✗ Could not resolve token UUID: ${target.uuid}`);
        return;
    }
    const actor = tokenDoc.actor ?? tokenDoc; // tokenDoc might itself be an Actor
    if (!actor?.system?.attributes?.hp) {
        debug(`Player Damage Prompt |    ✗ Actor has no HP attribute (possibly a group actor): ${actor?.name}`);
        return;
    }

    debug(`Player Damage Prompt |    Resolved actor: ${actor.name} (${actor.uuid})`,
        "| HP:", `${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}`,
        "| Temp HP:", actor.system.attributes.hp.temp || 0);

    // Determine target ownership and which prompt mode applies
    const playerOwned = _isPlayerOwned(actor);
    let whisperTargets;

    if (playerOwned && playerPromptEnabled) {
        // Player-owned target → whisper to player (+ maybe GM per visibility setting)
        whisperTargets = _getWhisperTargets(actor);
        debug(`Player Damage Prompt |    Player-owned target, using player prompt mode`);
    } else if (!playerOwned && gmPromptEnabled && isPlayerAttack) {
        // NPC target hit by a player → whisper to GM only
        whisperTargets = game.users.filter(u => u.isGM).map(u => u.id);
        debug(`Player Damage Prompt |    NPC target hit by player, using GM prompt mode`);
    } else {
        debug(`Player Damage Prompt |    ✗ ${actor.name}: no matching prompt mode`,
            `| playerOwned=${playerOwned}`,
            `| isPlayerAttack=${isPlayerAttack}`,
            `| playerPrompt=${playerPromptEnabled}`,
            `| gmPrompt=${gmPromptEnabled}`);
        return;
    }

    // Determine hit / crit
    const isCritical = !!attackRoll.isCritical;
    const attackTotal = attackRoll.total;
    const targetAC = target.ac;

    debug(`Player Damage Prompt |    Hit check: roll ${attackTotal} vs AC ${targetAC}`,
        `| Critical: ${isCritical}`,
        `| Result: ${isCritical ? "CRITICAL HIT" : (attackTotal >= targetAC ? "HIT" : "MISS")}`);

    if (!isCritical && attackTotal < targetAC) {
        debug(`Player Damage Prompt |    ✗ Attack missed, skipping`);
        return;
    }

    // Log actor traits for damage calculation
    const dr = actor.system.traits?.dr?.value ?? new Set();
    const di = actor.system.traits?.di?.value ?? new Set();
    const dv = actor.system.traits?.dv?.value ?? new Set();
    const dm = actor.system.traits?.dm?.amount ?? {};
    const dmEntries = Object.entries(dm).filter(([, v]) => v !== 0);
    debug(`Player Damage Prompt |    Actor traits:`,
        `Resistances: [${[...dr].join(", ") || "none"}]`,
        `| Immunities: [${[...di].join(", ") || "none"}]`,
        `| Vulnerabilities: [${[...dv].join(", ") || "none"}]`,
        `| Damage Mods: [${dmEntries.length ? dmEntries.map(([t, v]) => `${t}: ${v}`).join(", ") : "none"}]`);

    // Calculate effective damage and trait summary
    const { effectiveDamage, traitText } = _calculateEffectiveDamage(actor, damageByType);
    const totalRaw = Object.values(damageByType).reduce((sum, v) => sum + v, 0);
    debug(`Player Damage Prompt |    Effective damage: ${effectiveDamage} (raw: ${totalRaw})`,
        traitText ? `| Trait text: ${traitText.replace(/<[^>]+>/g, "")}` : "| No trait modifiers");

    // Send the whisper
    debug(`Player Damage Prompt |    Sending whisper to ${whisperTargets.length} user(s):`,
        whisperTargets.map(id => game.users.get(id)?.name || id));

    await _sendDamagePrompt(actor, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperTargets);
    debug(`Player Damage Prompt |    ✓ Whisper sent for ${actor.name}`);
}

// ── Damage calculation ───────────────────────────────────────────────

/**
 * Preview effective damage accounting for resistances, immunities,
 * vulnerabilities, and flat damage modifications (e.g. Heavy Armor Master).
 * The actual `applyDamage` call uses the full system calculation.
 * @param {Actor} actor
 * @param {Record<string, number>} damageByType
 * @returns {{effectiveDamage: number, traitText: string}}
 */
function _calculateEffectiveDamage(actor, damageByType) {
    const dr = actor.system.traits?.dr?.value ?? new Set();
    const di = actor.system.traits?.di?.value ?? new Set();
    const dv = actor.system.traits?.dv?.value ?? new Set();

    // Damage modifications — flat per-type adjustments (negative = reduction)
    // Structure: { bludgeoning: -3, piercing: -3, slashing: -3 }
    const dm = actor.system.traits?.dm?.amount ?? {};

    let effectiveDamage = 0;
    let totalRaw = 0;
    const resistant = [];
    const immune = [];
    const vulnerable = [];
    const reduced = []; // types with flat damage reduction

    for (const [type, amount] of Object.entries(damageByType)) {
        totalRaw += amount;

        const isImmune = di.has(type);
        const isResistant = dr.has(type);
        const isVulnerable = dv.has(type);
        const flatMod = dm[type] ?? 0; // negative = reduction

        if (isImmune) {
            immune.push(type);
            effectiveDamage += 0;
            continue;
        }

        // 2024 Rules order: (1) Adjustments, (2) Resistance, (3) Vulnerability

        // 1. Flat adjustments (bonuses/penalties like Heavy Armor Master)
        let effective = amount;
        if (flatMod < 0) {
            reduced.push(type);
            effective = Math.max(0, effective + flatMod); // flatMod is negative
        }

        // 2. Resistance (halve, rounded down)
        if (isResistant && !isVulnerable) {
            resistant.push(type);
            effective = Math.floor(effective / 2);
        }

        // 3. Vulnerability (double)
        if (isVulnerable && !isResistant) {
            vulnerable.push(type);
            effective = effective * 2;
        }

        // If both resistant and vulnerable, they cancel out — no modification
        // (flat adjustment still applies)

        effectiveDamage += effective;
    }

    // Build human-readable trait summary
    const parts = [];
    if (resistant.length) parts.push(`resistant to ${_formatTypeList(resistant)} damage`);
    if (immune.length) parts.push(`immune to ${_formatTypeList(immune)} damage`);
    if (vulnerable.length) parts.push(`vulnerable to ${_formatTypeList(vulnerable)} damage`);
    if (reduced.length) {
        const reductions = reduced.map(type => {
            const mod = dm[type];
            return `${_localizeType(type)} (${mod})`;
        });
        parts.push(`reducing ${reductions.join(", ")} damage`);
    }

    let traitText = "";
    if (parts.length && effectiveDamage !== totalRaw) {
        traitText = `You are ${parts.join(" and ")}, so the effective damage is <strong>${effectiveDamage}</strong>.`;
    }

    return { effectiveDamage, traitText };
}

// ── Formatting helpers ───────────────────────────────────────────────

/**
 * Look up the localised label for a damage type.
 * @param {string} type  Internal type key (e.g. "fire").
 * @returns {string}     Localised label (e.g. "Fire").
 */
function _localizeType(type) {
    const cfg = CONFIG.DND5E?.damageTypes?.[type];
    if (cfg?.label) return game.i18n.localize(cfg.label);
    return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Join a list of damage type keys into a human-readable string
 * ("Fire", "Fire and Poison", "Fire, Poison and Force").
 * @param {string[]} types
 * @returns {string}
 */
function _formatTypeList(types) {
    const labels = types.map(_localizeType);
    if (labels.length <= 1) return labels[0] || "";
    return labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
}

/**
 * Build the "10 Bludgeoning damage, 5 Fire damage and 3 Poison damage"
 * portion of the prompt.
 * @param {Record<string, number>} damageByType
 * @returns {string}  HTML string.
 */
function _formatDamageBreakdown(damageByType) {
    const parts = Object.entries(damageByType).map(([type, amount]) =>
        `<strong>${amount} ${_localizeType(type)}</strong> damage`
    );
    if (parts.length <= 1) return parts[0] || "";
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// ── Whisper creation ─────────────────────────────────────────────────

/**
 * Create and send the whispered damage prompt.
 * @param {Actor}    actor            The target actor.
 * @param {number}   attackTotal      The attack roll total.
 * @param {boolean}  isCritical       Whether the attack was a critical hit.
 * @param {Record<string, number>} damageByType  Aggregated damage map.
 * @param {number}   effectiveDamage  Net damage after traits.
 * @param {string}   traitText        Human-readable trait summary HTML.
 * @param {Array}    rawDamages       Per-roll DamageDescriptions for applyDamage.
 * @param {string[]} whisperUsers     User IDs to whisper to.
 */
async function _sendDamagePrompt(actor, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperUsers) {
    // Hit description
    let hitText;
    if (isCritical) {
        hitText = `<strong>${actor.name}</strong> was <strong class="nd5t-crit-text">CRITICALLY HIT</strong>`;
    } else {
        hitText = `<strong>${actor.name}</strong> was hit with an Attack Roll of <strong>${attackTotal}</strong>`;
    }

    const damageText = _formatDamageBreakdown(damageByType);

    // Serialise damage descriptions for the button (properties as arrays)
    const damagesJson = JSON.stringify(rawDamages).replace(/'/g, "&#39;");

    const content = `
        <div class="dnd5e chat-card nd5t-damage-prompt">
            <div class="card-content">
                <p>${hitText} for ${damageText}.</p>
                ${traitText ? `<p class="nd5t-trait-info">${traitText}</p>` : ""}
            </div>
            <div class="card-buttons">
                <button data-action="nd5t-apply-damage"
                        data-actor-uuid="${actor.uuid}"
                        data-damages='${damagesJson}'>
                    <i class="fas fa-heart-crack"></i>
                    Apply ${effectiveDamage} Damage
                </button>
            </div>
        </div>
    `;

    await ChatMessage.create({
        content,
        whisper: whisperUsers,
        speaker: ChatMessage.getSpeaker({ actor })
    });
}

// ── Button handling ──────────────────────────────────────────────────

/**
 * Bind a click handler to the "Apply Damage" button inside a rendered
 * chat message.  Shared between V13 (renderChatMessage) and V14
 * (renderChatMessageHTML) hooks.
 * @param {ChatMessage} message
 * @param {HTMLElement}  element
 */
function _bindApplyDamageButton(message, element) {
    const prompt = element.querySelector(".nd5t-damage-prompt");
    if (!prompt) return;

    const button = prompt.querySelector('button[data-action="nd5t-apply-damage"]');
    if (!button) return;

    // If the button is already disabled in the stored content, nothing to do
    if (button.disabled) return;

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const actorUuid = button.dataset.actorUuid;
        const damages = JSON.parse(button.dataset.damages);

        debug("Player Damage Prompt | Button clicked",
            "| Message ID:", message.id,
            "| Actor UUID:", actorUuid,
            "| Damages:", damages);

        // Reconstruct property Sets for applyDamage
        for (const d of damages) {
            if (d.properties) d.properties = new Set(d.properties);
        }

        const actor = fromUuidSync(actorUuid);
        if (!actor) {
            debug("Player Damage Prompt | ✗ Could not resolve actor UUID:", actorUuid);
            ui.notifications.warn("Could not find the actor to apply damage to.");
            return;
        }

        debug(`Player Damage Prompt | Applying damage to ${actor.name}`,
            `| HP before: ${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}`,
            `| Temp HP: ${actor.system.attributes.hp.temp || 0}`);

        try {
            await actor.applyDamage(damages);

            debug(`Player Damage Prompt | ✓ Damage applied to ${actor.name}`,
                `| HP after: ${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}`,
                `| Temp HP: ${actor.system.attributes.hp.temp || 0}`);

            // Immediately disable the button in the DOM
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-check"></i> Damage Applied';

            // Ask the GM to persist the disabled state in the message content
            _requestMarkApplied(message.id);
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Failed to apply damage:", err);
            debug("Player Damage Prompt | ✗ applyDamage failed:", err.message);
            ui.notifications.error("Failed to apply damage. See the console for details.");
        }
    });
}

// ── Socket sync ──────────────────────────────────────────────────────

/**
 * Request that the message content be updated to show the button as
 * disabled.  If the current user is the GM (message author), update
 * directly; otherwise emit a socket event so the GM's client does it.
 * @param {string} messageId
 */
function _requestMarkApplied(messageId) {
    if (game.user.isGM) {
        _markMessageApplied(messageId);
    } else {
        debug("Player Damage Prompt | Emitting socket to mark message applied:", messageId);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "damagePromptApplied",
            messageId
        });
    }
}

/**
 * Handle incoming socket messages for this module.
 * @param {object} data  The socket payload.
 */
function _onSocketMessage(data) {
    if (data?.type !== "damagePromptApplied") return;
    if (!game.user.isGM) return; // Only the GM should update the message
    debug("Player Damage Prompt | Socket received: damagePromptApplied for message", data.messageId);
    _markMessageApplied(data.messageId);
}

/**
 * Update a chat message's content to replace the Apply Damage button
 * with a disabled "Damage Applied" button.  Must be called on the GM's
 * client (the message author).
 * @param {string} messageId
 */
async function _markMessageApplied(messageId) {
    const message = game.messages.get(messageId);
    if (!message) {
        debug("Player Damage Prompt | ✗ Could not find message to mark applied:", messageId);
        return;
    }

    // Replace the active button with a disabled one in the stored content.
    // The button tag spans multiple lines (attributes on separate lines),
    // so we use [\s\S] to match across newlines.
    const updatedContent = message.content.replace(
        /<button\s+data-action="nd5t-apply-damage"[\s\S]*?<\/button>/,
        '<button data-action="nd5t-apply-damage" disabled><i class="fas fa-check"></i> Damage Applied</button>'
    );

    if (updatedContent === message.content) {
        debug("Player Damage Prompt | Button already marked as applied in message", messageId);
        return;
    }

    await message.update({ content: updatedContent });
    debug("Player Damage Prompt | ✓ Message content updated with disabled button:", messageId);
}
