import { MODULE_ID, debug, log } from "../main.js";

/**
 * Player Damage Prompt
 *
 * When the GM rolls damage from an attack activity that hit a player-owned
 * token, whispers a chat message to the owning player showing a damage
 * breakdown (with resistance/vulnerability/immunity adjustments) and a
 * one-click "Apply Damage" button.
 *
 * The feature uses two `createChatMessage` hooks:
 * 1. Damage roll handler — detects damage rolls from attack activities,
 *    traces back to the originating usage message for target data, and
 *    finds the matching attack roll to determine hit/crit status.
 * 2. Attack roll handler — detects attack rolls that missed their target
 *    and checks for Graze weapon mastery.  This is necessary because on
 *    a miss the player won't roll damage, so the damage handler never
 *    fires.
 */

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the Player Damage Prompt feature.
 * Called once during the "setup" phase from main.js.
 */
export function initPlayerDamagePrompt() {
    Hooks.on("createChatMessage", _onCreateChatMessage);
    Hooks.on("createChatMessage", _onCreateChatMessage_Attack);

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

// ── Dice So Nice integration ─────────────────────────────────────────

/**
 * If the "Wait for Dice So Nice" setting is enabled and the Dice So Nice
 * module is active, return a Promise that resolves when the dice
 * animation for the given message has finished.  Otherwise resolves
 * immediately.
 *
 * Uses the `diceSoNiceRollComplete` hook fired by DSN after each roll
 * animation completes.  Includes a safety timeout to avoid hanging
 * indefinitely if the hook never fires (e.g. DSN disabled for a
 * particular roll, or the message has no 3D dice).
 *
 * @param {string} messageId  The chat message ID to wait for.
 * @returns {Promise<void>}
 */
function _waitForDiceSoNice(messageId) {
    // Check if the setting is enabled
    if (!game.settings.get(MODULE_ID, "waitForDiceSoNice")) return Promise.resolve();

    // Check if Dice So Nice is active
    if (!game.modules.get("dice-so-nice")?.active) return Promise.resolve();

    // Check if the message is actually animating 3D dice
    const msg = game.messages.get(messageId);
    if (!msg?._dice3danimating) {
        debug("Player Damage Prompt | DSN: message", messageId, "is not animating, skipping wait");
        return Promise.resolve();
    }

    debug("Player Damage Prompt | DSN: waiting for dice animation to complete for message", messageId);

    return new Promise(resolve => {
        const TIMEOUT_MS = 15000; // Safety timeout: 15 seconds max
        let resolved = false;

        const hookId = Hooks.on("diceSoNiceRollComplete", (completedId) => {
            if (completedId !== messageId) return;
            if (resolved) return;
            resolved = true;
            Hooks.off("diceSoNiceRollComplete", hookId);
            clearTimeout(timer);
            debug("Player Damage Prompt | DSN: dice animation completed for message", messageId);
            resolve();
        });

        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            Hooks.off("diceSoNiceRollComplete", hookId);
            debug("Player Damage Prompt | DSN: timeout waiting for dice animation on message", messageId, "- proceeding anyway");
            resolve();
        }, TIMEOUT_MS);
    });
}

// ── Core handler ─────────────────────────────────────────────────────

/**
 * Handle a newly created chat message to see if it is a damage roll from
 * an attack activity that hit a targeted token.
 * @param {ChatMessage} message  The message that was just created.
 */
async function _onCreateChatMessage(message) {
    const activeGM = game.users.activeGM;
    if (activeGM) {
        if (game.user.id !== activeGM.id) return;
    } else {
        const authorId = message.author?.id ?? message.user?.id;
        if (game.user.id !== authorId) return;
    }

    // Check if at least one damage prompt mode is enabled
    const playerPromptEnabled = game.settings.get(MODULE_ID, "enablePlayerDamagePrompt");
    const gmPromptEnabled = playerPromptEnabled && game.settings.get(MODULE_ID, "enableGmDamagePrompt");
    if (!playerPromptEnabled && !gmPromptEnabled) return;

    // Only process damage rolls from attack activities by default,
    // unless non-attack damage prompts are enabled.
    const rollType = message.getFlag("dnd5e", "roll.type");
    const activityType = message.getFlag("dnd5e", "activity.type");
    if (rollType !== "damage" && rollType !== "healing") return;

    const nonAttackPromptEnabled = game.settings.get(MODULE_ID, "enableNonAttackDamagePrompt");
    if (activityType !== "attack" && !nonAttackPromptEnabled) return;

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
    let attackMessage = null;
    let attackRoll = null;
    
    if (activityType === "attack") {
        attackMessage = _findAttackMessage(originatingId);
        if (!attackMessage) {
            debug("Player Damage Prompt | No attack roll message found in last 30 messages for originatingId:", originatingId);
            return;
        }
        debug("Player Damage Prompt | Found attack roll message:", attackMessage.id,
            "| Rolls count:", attackMessage.rolls.length);
    }

    if (activityType === "attack") {
        // Extract the D20Roll from the attack message
        attackRoll = _getAttackD20Roll(attackMessage);
        if (!attackRoll) {
            debug("Player Damage Prompt | No valid D20 attack roll found in message", attackMessage.id);
            return;
        }
        debug("Player Damage Prompt | Attack roll:",
            "total =", attackRoll.total,
            "| isCritical =", !!attackRoll.isCritical,
            "| isFumble =", !!attackRoll.isFumble,
            "| formula =", attackRoll.formula);
    }

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

    // Wait for Dice So Nice animation to finish (if enabled)
    await _waitForDiceSoNice(message.id);

    // Process each target
    debug("Player Damage Prompt | Processing", targets.length, "target(s)...");
    for (const target of targets) {
        await _processTarget(target, attackRoll, attackMessage, message, originatingMessage, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled, activityType);
    }
}

/**
 * Handle a newly created chat message to see if it is an attack roll
 * that missed its target.  On a miss, checks for Graze weapon mastery
 * and sends a graze damage prompt if applicable.
 *
 * This is separated from the damage roll handler because on a miss the
 * player won't roll damage — so the damage handler never fires.
 * @param {ChatMessage} message  The message that was just created.
 */
async function _onCreateChatMessage_Attack(message) {
    const activeGM = game.users.activeGM;
    if (activeGM) {
        if (game.user.id !== activeGM.id) return;
    } else {
        const authorId = message.author?.id ?? message.user?.id;
        if (game.user.id !== authorId) return;
    }

    // Check if at least one damage prompt mode is enabled
    const playerPromptEnabled = game.settings.get(MODULE_ID, "enablePlayerDamagePrompt");
    const gmPromptEnabled = playerPromptEnabled && game.settings.get(MODULE_ID, "enableGmDamagePrompt");
    if (!playerPromptEnabled && !gmPromptEnabled) return;

    // Only process attack rolls from attack activities
    const rollType = message.getFlag("dnd5e", "roll.type");
    const activityType = message.getFlag("dnd5e", "activity.type");
    if (rollType !== "attack") return;
    if (activityType !== "attack") return;

    // Only trigger on public rolls — skip private (GM), blind, and self rolls
    const isPublic = (!message.whisper?.length) && !message.blind;
    if (!isPublic) {
        debug("Player Damage Prompt | Graze: Non-public attack roll detected (whisper/blind), skipping");
        return;
    }

    // The DnD5e system stores the chosen mastery in flags.dnd5e.roll.mastery.
    // Only proceed if this attack used the Graze mastery.
    const rollMastery = message.getFlag("dnd5e", "roll.mastery");
    if (rollMastery !== "graze") return;

    debug("Player Damage Prompt | Graze: Attack roll with Graze mastery detected",
        "| Message ID:", message.id,
        "| Roll type:", rollType,
        "| Activity type:", activityType,
        "| Mastery:", rollMastery);

    // Find the originating (usage) message to get original targets
    const originatingId = message.getFlag("dnd5e", "originatingMessage");
    const originatingMessage = originatingId ? game.messages.get(originatingId) : null;

    // Prefer targets from the originating (usage) message, fall back to the attack message
    const originTargets = originatingMessage?.getFlag("dnd5e", "targets");
    const attackTargets = message.getFlag("dnd5e", "targets");
    const targets = originTargets || attackTargets || [];
    debug("Player Damage Prompt | Graze: Targets:", targets.length,
        targets.length ? targets.map(t => `${t.name || t.uuid} (AC ${t.ac})`) : []);

    if (!targets.length) {
        debug("Player Damage Prompt | Graze: No targets found, skipping");
        return;
    }

    // Extract the D20Roll from the attack message
    const attackRoll = _getAttackD20Roll(message);
    if (!attackRoll) {
        debug("Player Damage Prompt | Graze: No valid D20 attack roll found in message", message.id);
        return;
    }

    const isCritical = !!attackRoll.isCritical;
    const attackTotal = attackRoll.total;

    // Wait for Dice So Nice animation to finish (if enabled)
    await _waitForDiceSoNice(message.id);

    // Process each target — only handle misses (graze candidates)
    for (const target of targets) {
        const targetAC = target.ac;

        // Skip hits and crits — those are handled by the damage handler
        if (isCritical || attackTotal >= targetAC) {
            debug(`Player Damage Prompt | Graze: Attack hit ${target.name || target.uuid} (${attackTotal} >= AC ${targetAC}), skipping (handled by damage handler)`);
            continue;
        }

        debug(`Player Damage Prompt | Graze: Attack missed ${target.name || target.uuid} (${attackTotal} < AC ${targetAC}), checking for Graze mastery...`);

        // Resolve the target token/actor
        const { tokenDoc, actor } = _resolveTarget(target.uuid);
        if (!actor) {
            debug(`Player Damage Prompt | Graze: Could not resolve token UUID: ${target.uuid}`);
            continue;
        }
        if (!actor.system?.attributes?.hp) {
            debug(`Player Damage Prompt | Graze: Actor has no HP attribute: ${actor.name}`);
            continue;
        }

        // Determine target ownership and which prompt mode applies
        const playerOwned = _isPlayerOwned(actor);
        let whisperTargets;

        if (playerOwned && playerPromptEnabled) {
            whisperTargets = _getWhisperTargets(actor);
        } else if (!playerOwned && gmPromptEnabled) {
            whisperTargets = game.users.filter(u => u.isGM).map(u => u.id);
        } else {
            debug(`Player Damage Prompt | Graze: No matching prompt mode for ${actor.name}, skipping`);
            continue;
        }

        const tokenName = tokenDoc?.name || target.name || actor.name;
        await _handleGrazeMastery(actor, tokenDoc, tokenName, attackRoll, message, originatingMessage, whisperTargets);
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
 * Read the primary damage type from a DamageRoll.
 * Prefers the resolved singular `type` (what the system uses for
 * aggregation and damage application) over the `types` Set (which
 * may contain multiple selectable types from the DamageData schema
 * in an undefined iteration order).
 * @param {Roll} roll
 * @returns {string}
 */
function _getDamageType(roll) {
    // Prefer the resolved singular type (set by the system when rolling)
    if (roll.options?.type) return roll.options.type;
    // Fall back to the types Set (from the DamageData schema)
    const types = roll.options?.types;
    if (types) {
        if (types instanceof Set) return [...types][0] ?? "untyped";
        if (Array.isArray(types)) return types[0] ?? "untyped";
    }
    return "untyped";
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
 * Split a single damage roll into per-type value chunks by inspecting
 * term-level flavor annotations (e.g. "1d8[slashing] + 2d6[fire]").
 * Falls back to the roll's overall type when terms have no flavor.
 *
 * This mirrors the DnD5e system's internal `chunkTerms` logic used by
 * `aggregateDamageRolls`, ensuring split damage types are handled
 * correctly for resistance/immunity/vulnerability calculations.
 *
 * @param {Roll} roll
 * @returns {Array<{value: number, type: string, properties: string[]}>}
 */
function _splitRollByType(roll) {
    const defaultType = _getDamageType(roll);
    const properties = _getDamageProperties(roll);
    const OperatorTerm = foundry.dice.terms.OperatorTerm;
    const isValidType = (t) => !!(CONFIG.DND5E?.damageTypes?.[t] || CONFIG.DND5E?.healingTypes?.[t]);

    // If the roll has no terms, fall back to the simple path
    if (!roll.terms?.length) {
        return [{ value: roll.total, type: defaultType, properties }];
    }

    // Quick check: are there any flavor-annotated terms with a type
    // different from the default?  If not, skip the expensive chunking.
    let hasMultipleTypes = false;
    for (const term of roll.terms) {
        if (term instanceof OperatorTerm) continue;
        const flavor = term.flavor?.toLowerCase().trim();
        if (flavor && isValidType(flavor) && flavor !== defaultType) {
            hasMultipleTypes = true;
            break;
        }
    }

    if (!hasMultipleTypes) {
        return [{ value: roll.total, type: defaultType, properties }];
    }

    // ── Term-level chunking ──────────────────────────────────────
    // Split on + / − operators; keep × / ÷ within chunks.
    // For each chunk, detect the damage type from term flavors.
    debug("Player Damage Prompt | Splitting multi-type roll:",
        roll.formula, "| Default type:", defaultType);

    const chunks = [];
    let currentTerms = [];
    let currentType = null;
    let negative = false;

    const pushChunk = () => {
        if (currentTerms.length === 0) return;
        const type = currentType ?? defaultType;

        // Compute the chunk total from its already-evaluated term totals.
        // Terms within a chunk are connected by * / operators, so we
        // reconstruct the expression string and safeEval it.
        const expression = currentTerms.map(t => t.total).join(" ");
        let value;
        try {
            value = Roll.safeEval(expression);
        } catch {
            // Fallback: sum non-operator term totals
            value = currentTerms.reduce((sum, t) =>
                (t instanceof OperatorTerm) ? sum : sum + (t.total ?? 0), 0);
        }
        if (negative) value = -value;

        chunks.push({ value, type, properties: [...properties] });
        currentTerms = [];
        currentType = null;
        negative = false;
    };

    for (const term of roll.terms) {
        if ((term instanceof OperatorTerm) && ["+", "-"].includes(term.operator)) {
            pushChunk();
            if (term.operator === "-") negative = !negative;
            continue;
        }

        currentTerms.push(term);
        const flavor = term.flavor?.toLowerCase().trim();
        if (flavor && isValidType(flavor)) {
            currentType = currentType ?? flavor;
        }
    }
    pushChunk();

    debug("Player Damage Prompt | Split result:",
        chunks.map(c => `${c.value} ${c.type}`).join(", "),
        "| Original total:", roll.total);

    return chunks;
}

/**
 * Aggregate damage across all rolls, grouping by damage type.
 * Handles rolls with split damage types (multiple types within a
 * single roll via term-level flavor annotations).
 * @param {Roll[]} rolls
 * @returns {Record<string, number>}  Map of type → total damage.
 */
function _aggregateDamage(rolls) {
    const byType = {};
    for (const roll of rolls) {
        for (const chunk of _splitRollByType(roll)) {
            byType[chunk.type] = (byType[chunk.type] || 0) + chunk.value;
        }
    }
    return byType;
}

/**
 * Build an array of DamageDescription objects from the raw rolls,
 * preserving per-chunk type and properties so that `applyDamage` can
 * correctly evaluate bypasses, etc.
 * Handles rolls with split damage types by creating one
 * DamageDescription per type chunk rather than per roll.
 * @param {Roll[]} rolls
 * @returns {Array<{value: number, type: string, properties: string[]}>}
 */
function _buildDamageDescriptions(rolls) {
    const descriptions = [];
    for (const roll of rolls) {
        for (const chunk of _splitRollByType(roll)) {
            descriptions.push(chunk);
        }
    }
    return descriptions;
}

// ── Target resolution ────────────────────────────────────────────────

/**
 * Resolve a target UUID to a TokenDocument and Actor.  The DnD5e system
 * stores target UUIDs that point to synthetic actors on unlinked tokens
 * (e.g. `Scene.x.Token.y.Actor.z`).  `fromUuidSync` on such a UUID
 * returns the Actor — not the TokenDocument — so the token's custom
 * name (e.g. "Goblin B") is lost.  This helper extracts the Token UUID
 * prefix and resolves both documents.
 * @param {string} uuid  The target UUID from DnD5e flags.
 * @returns {{tokenDoc: TokenDocument|null, actor: Actor|null}}
 */
function _resolveTarget(uuid) {
    const resolved = fromUuidSync(uuid);
    if (!resolved) return { tokenDoc: null, actor: null };

    // If fromUuidSync already returned a TokenDocument, we're done
    if (resolved.documentName === "Token") {
        return { tokenDoc: resolved, actor: resolved.actor ?? resolved };
    }

    // The UUID points to a synthetic Actor — extract the Token UUID
    // from the prefix (Scene.x.Token.y) and resolve the TokenDocument
    const tokenUuidMatch = uuid.match(/^(Scene\.[^.]+\.Token\.[^.]+)/);
    if (tokenUuidMatch) {
        const tokenDoc = fromUuidSync(tokenUuidMatch[1]);
        if (tokenDoc?.documentName === "Token") {
            return { tokenDoc, actor: tokenDoc.actor ?? resolved };
        }
    }

    // Fallback: resolved is the Actor itself (linked token or direct Actor UUID)
    return { tokenDoc: null, actor: resolved };
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
 * effective damage, and send the whisper prompt.  On a miss, checks for
 * Graze weapon mastery and sends a graze damage prompt if applicable.
 * @param {object}  target              Target descriptor from message flags.
 * @param {Roll}    attackRoll           The D20Roll for the attack.
 * @param {ChatMessage} attackMessage    The attack roll chat message.
 * @param {ChatMessage} damageMessage    The damage roll chat message.
 * @param {ChatMessage|null} originatingMessage  The originating usage message.
 * @param {Record<string, number>} damageByType  Aggregated damage map.
 * @param {Array}   rawDamages           Per-roll DamageDescriptions for applyDamage.
 * @param {boolean} isPlayerAttack       Whether the attacker is a player (non-GM).
 * @param {boolean} gmPromptEnabled      Whether the GM damage prompt setting is on.
 * @param {string}  activityType         The activity type (e.g. "attack", "save").
 */
async function _processTarget(target, attackRoll, attackMessage, damageMessage, originatingMessage, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled, activityType) {
    debug(`Player Damage Prompt | ── Processing target: ${target.name || target.uuid} (AC ${target.ac})`);

    const { tokenDoc, actor } = _resolveTarget(target.uuid);
    if (!actor) {
        debug(`Player Damage Prompt |    ✗ Could not resolve token UUID: ${target.uuid}`);
        return;
    }
    if (!actor.system?.attributes?.hp) {
        debug(`Player Damage Prompt |    ✗ Actor has no HP attribute (possibly a group actor): ${actor.name}`);
        return;
    }

    debug(`Player Damage Prompt |    Resolved actor: ${actor.name} (${actor.uuid})`,
        "| Token doc:", tokenDoc ? `${tokenDoc.name} (${tokenDoc.uuid})` : "(none)",
        "| HP:", `${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}`,
        "| Temp HP:", actor.system.attributes.hp.temp || 0);

    // Determine target ownership and which prompt mode applies
    const playerOwned = _isPlayerOwned(actor);
    let whisperTargets;

    if (playerOwned && playerPromptEnabled) {
        // Player-owned target → whisper to player (+ maybe GM per visibility setting)
        whisperTargets = _getWhisperTargets(actor);
        debug(`Player Damage Prompt |    Player-owned target, using player prompt mode`);
    } else if (!playerOwned && gmPromptEnabled) {
        // NPC target hit → whisper to GM only
        whisperTargets = game.users.filter(u => u.isGM).map(u => u.id);
        debug(`Player Damage Prompt |    NPC target hit, using GM prompt mode`);
    } else {
        debug(`Player Damage Prompt |    ✗ ${actor.name}: no matching prompt mode`,
            `| playerOwned=${playerOwned}`,
            `| isPlayerAttack=${isPlayerAttack}`,
            `| playerPrompt=${playerPromptEnabled}`,
            `| gmPrompt=${gmPromptEnabled}`);
        return;
    }

    // Determine hit / crit
    let isCritical = false;
    let attackTotal = 0;
    
    if (activityType === "attack") {
        isCritical = !!attackRoll.isCritical;
        attackTotal = attackRoll.total;
        const targetAC = target.ac;

        debug(`Player Damage Prompt |    Hit check: roll ${attackTotal} vs AC ${targetAC}`,
            `| Critical: ${isCritical}`,
            `| Result: ${isCritical ? "CRITICAL HIT" : (attackTotal >= targetAC ? "HIT" : "MISS")}`);

        if (!isCritical && attackTotal < targetAC) {
            // Attack missed — graze is handled by the attack roll handler
            debug(`Player Damage Prompt |    Attack missed — skipping (graze handled by attack roll handler)`);
            return;
        }
    } else {
        // Non-attack activity. Assume it affects the target.
        debug(`Player Damage Prompt |    Non-attack activity (${activityType}) — assuming target is affected`);
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

    const tokenName = tokenDoc?.name || target.name || actor.name;
    const itemUuid = damageMessage.getFlag("dnd5e", "item.uuid");
    const sourceItem = itemUuid ? fromUuidSync(itemUuid) : null;
    
    let hasHalfDamage = false;
    if (activityType === "save" && sourceItem) {
        const activityId = damageMessage.getFlag("dnd5e", "activity.id");
        if (activityId && sourceItem.system?.activities) {
            const activity = sourceItem.system.activities.get?.(activityId) ?? sourceItem.system.activities[activityId];
            if (activity?.damage?.onSave === "half") {
                hasHalfDamage = true;
            }
        }
    }
    
    await _sendDamagePrompt(actor, tokenDoc, tokenName, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperTargets, false, activityType, sourceItem, hasHalfDamage);
    debug(`Player Damage Prompt |    ✓ Whisper sent for ${actor.name}`);
}

// ── Damage calculation ───────────────────────────────────────────────

/**
 * Resolve all dm.amount formula strings to numeric values.
 * The DnD5e system stores damage modifications as formula strings
 * (e.g. "-3", "@prof", "1d4") — not numbers.  This mirrors the
 * system's own resolution via `simplifyBonus` in `calculateDamage`.
 * @param {Record<string, string>} dmAmount  Raw dm.amount from actor data.
 * @param {Actor} actor                       The actor (for roll data).
 * @returns {Record<string, number>}          Map of type → numeric modifier.
 */
function _resolveModifications(dmAmount, actor) {
    const rollData = actor.getRollData({ deterministic: true });
    const resolved = {};
    for (const [type, formula] of Object.entries(dmAmount)) {
        if (!formula) continue;
        // Use the system's simplifyBonus if available, otherwise parse manually
        if (typeof dnd5e?.utils?.simplifyBonus === "function") {
            resolved[type] = dnd5e.utils.simplifyBonus(formula, rollData);
        } else {
            // Fallback: try evaluating as a deterministic roll
            if (Number.isNumeric(formula)) {
                resolved[type] = Number(formula);
            } else {
                try {
                    const roll = new Roll(formula, rollData);
                    resolved[type] = roll.isDeterministic ? roll.evaluateSync().total : 0;
                } catch {
                    resolved[type] = 0;
                }
            }
        }
    }
    return resolved;
}

/**
 * Preview effective damage accounting for resistances, immunities,
 * vulnerabilities, and flat damage modifications (e.g. Heavy Armor Master).
 * The actual `applyDamage` call uses the full system calculation.
 *
 * Mirrors the system's `calculateDamage` logic for modifications:
 * - dm.amount values are formula strings that must be resolved to numbers
 * - Modifications apply to healing types too (e.g. dm.amount.healing)
 * - An "ALL" modification applies to all non-healing damage types
 * - Modifications cannot flip the sign of a damage value (clamped to 0)
 * @param {Actor} actor
 * @param {Record<string, number>} damageByType
 * @returns {{effectiveDamage: number, traitText: string}}
 */
function _calculateEffectiveDamage(actor, damageByType) {
    const dr = actor.system.traits?.dr?.value ?? new Set();
    const di = actor.system.traits?.di?.value ?? new Set();
    const dv = actor.system.traits?.dv?.value ?? new Set();

    // Resolve damage modification formulas to numbers
    const dmRaw = actor.system.traits?.dm?.amount ?? {};
    const modifications = _resolveModifications(dmRaw, actor);

    let effectiveDamage = 0;
    let totalRaw = 0;
    const resistant = [];
    const immune = [];
    const vulnerable = [];
    const modified = []; // types with flat damage modifications (positive or negative)

    for (const [type, amount] of Object.entries(damageByType)) {
        totalRaw += amount;

        const isHealingType = !!CONFIG.DND5E?.healingTypes?.[type];
        const isImmune = !isHealingType && di.has(type);
        const isResistant = !isHealingType && dr.has(type);
        const isVulnerable = !isHealingType && dv.has(type);

        if (isImmune) {
            immune.push(type);
            effectiveDamage += 0;
            continue;
        }

        let effective = amount;

        // 2024 Rules order: (1) Adjustments, (2) Resistance, (3) Vulnerability

        // 1. Flat adjustments (bonuses/penalties like Heavy Armor Master)
        //    Apply per-type modification, then "ALL" for non-healing types.
        //    Mirrors the system's applyModification which prevents sign flips.
        const typeMod = modifications[type] ?? 0;
        const allMod = (!isHealingType && modifications["ALL"]) ? modifications["ALL"] : 0;
        const totalMod = typeMod + allMod;

        if (totalMod !== 0) {
            // Prevent sign flip: if adding the modification would change
            // the sign of the value, clamp to 0 instead.
            if (Math.sign(effective) !== Math.sign(effective + totalMod)) {
                effective = 0;
            } else {
                effective += totalMod;
            }
            modified.push({ type, mod: totalMod });
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
    if (modified.length) {
        const descriptions = modified.map(({ type, mod }) => {
            const sign = mod > 0 ? "+" : "";
            const label = _localizeType(type);
            return `${label} (${sign}${mod})`;
        });
        parts.push(`reducing ${descriptions.join(", ")} damage`);
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
    const cfg = CONFIG.DND5E?.damageTypes?.[type] || CONFIG.DND5E?.healingTypes?.[type];
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
    const parts = Object.entries(damageByType).map(([type, amount]) => {
        if (CONFIG.DND5E?.healingTypes?.[type]) {
            return `${amount} ${_localizeType(type)}`;
        }
        return `${amount} ${_localizeType(type)} damage`;
    });
    if (parts.length <= 1) return parts[0] || "";
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// ── Graze weapon mastery ─────────────────────────────────────────────

/**
 * Resolve the weapon Item from one or more chat messages.
 * In DnD5e 5.2+, the system stores item info in `flags.dnd5e.item`
 * (via the Activity `messageFlags` getter).  Both the attack roll
 * and damage roll messages carry this flag.
 * @param {...ChatMessage|null} messages  Messages to search (nulls are skipped).
 * @returns {Item|null}
 */
function _resolveWeaponItem(...messages) {
    for (const msg of messages) {
        if (!msg) continue;

        // DnD5e 5.2+ stores item UUID in flags.dnd5e.item.uuid
        const itemUuid = msg.getFlag("dnd5e", "item.uuid");
        if (itemUuid) {
            try {
                const item = fromUuidSync(itemUuid);
                if (item) return item;
            } catch { /* continue to next message */ }
        }
    }
    return null;
}


/**
 * Compute the Graze damage: the ability modifier used for the attack,
 * using the weapon's primary damage type.
 * @param {Roll}        attackRoll     The D20Roll for the attack.
 * @param {ChatMessage} attackMessage  The attack roll chat message.
 * @param {Item}        item           The weapon Item.
 * @returns {{ value: number, type: string, properties: string[] }|null}
 *          Null if the modifier is ≤ 0 (no damage to deal).
 */
function _getGrazeDamage(attackRoll, attackMessage, item) {
    // Determine which ability was used for the attack
    const ability = attackRoll.options?.ability || attackRoll.data?.mod?.ability || "str";

    // Resolve the attacker actor from the attack message speaker
    const attackerActor = ChatMessage.getSpeakerActor(attackMessage.speaker);
    if (!attackerActor) {
        debug(`Player Damage Prompt |    ✗ Could not resolve attacker actor from speaker`);
        return null;
    }

    const mod = attackerActor.system?.abilities?.[ability]?.mod;
    if (mod == null || mod <= 0) {
        debug(`Player Damage Prompt |    Graze: ability modifier for ${ability} is ${mod}, skipping`);
        return null;
    }

    // Determine the damage type from the weapon
    // Try the activity's damage parts first, then the item's base damage
    let damageType = "bludgeoning"; // fallback
    const activityId = attackMessage.getFlag("dnd5e", "activity.id");
    if (activityId && item.system?.activities) {
        const activity = item.system.activities.get?.(activityId) ?? item.system.activities[activityId];
        const firstPart = activity?.damage?.parts?.[0];
        if (firstPart) {
            // The types field is a Set in DnD5e 5.2+
            const types = firstPart.types;
            if (types instanceof Set) damageType = [...types][0] ?? damageType;
            else if (Array.isArray(types)) damageType = types[0] ?? damageType;
            else if (typeof firstPart.type === "string") damageType = firstPart.type;
        }
    }
    // Fallback: check item-level damage
    if (damageType === "bludgeoning" && item.system?.damage?.base) {
        const baseTypes = item.system.damage.base.types;
        if (baseTypes instanceof Set) damageType = [...baseTypes][0] ?? damageType;
        else if (Array.isArray(baseTypes)) damageType = baseTypes[0] ?? damageType;
    }

    // Get damage properties from the item (e.g. "magical")
    const properties = [];
    const itemProps = item.system?.properties;
    if (itemProps instanceof Set) {
        if (itemProps.has("mgc")) properties.push("mgc");
    }

    debug(`Player Damage Prompt |    Graze damage: ${mod} ${damageType}`,
        `| ability=${ability} mod=${mod}`,
        `| damageType=${damageType}`,
        `| properties=[${properties.join(", ")}]`);

    return { value: mod, type: damageType, properties };
}

/**
 * Handle the Graze weapon mastery when an attack misses.  Resolves the
 * weapon, checks mastery, computes graze damage, and sends the prompt.
 * @param {Actor}           targetActor         The target actor.
 * @param {TokenDocument}   tokenDoc            The target token document.
 * @param {Roll}            attackRoll          The D20Roll for the attack.
 * @param {ChatMessage}     attackMessage       The attack roll message.
 * @param {ChatMessage|null} originatingMessage The originating usage message.
 * @param {string[]}        whisperTargets      User IDs to whisper to.
 */
async function _handleGrazeMastery(targetActor, tokenDoc, targetName, attackRoll, attackMessage, originatingMessage, whisperTargets) {
    // Resolve the weapon item from message flags (needed for damage type)
    const weaponItem = _resolveWeaponItem(attackMessage, originatingMessage);
    if (!weaponItem) {
        debug(`Player Damage Prompt |    ✗ Graze: could not resolve weapon item from message flags`);
        return;
    }
    debug(`Player Damage Prompt |    Resolved weapon: ${weaponItem.name} (mastery: ${weaponItem.system?.mastery || "none"})`);

    // Note: mastery eligibility was already verified via flags.dnd5e.roll.mastery
    // in _onCreateChatMessage_Attack — the DnD5e system only sets this flag when
    // the actor has actually mastered the weapon.

    // Compute graze damage (ability modifier only)
    const grazeDamage = _getGrazeDamage(attackRoll, attackMessage, weaponItem);
    if (!grazeDamage) {
        debug(`Player Damage Prompt |    ✗ Graze: no positive damage to deal, skipping`);
        return;
    }

    // Build graze damage structures for the prompt
    const grazeDamageByType = { [grazeDamage.type]: grazeDamage.value };
    const grazeRawDamages = [grazeDamage];

    // Calculate effective graze damage accounting for target traits
    const { effectiveDamage, traitText } = _calculateEffectiveDamage(targetActor, grazeDamageByType);

    debug(`Player Damage Prompt |    Graze: effective damage ${effectiveDamage}`,
        traitText ? `| ${traitText.replace(/<[^>]+>/g, "")}` : "| No trait modifiers");

    // Send the graze damage prompt
    await _sendDamagePrompt(targetActor, tokenDoc, targetName, attackRoll.total, false, grazeDamageByType, effectiveDamage, traitText, grazeRawDamages, whisperTargets, true, "attack", weaponItem);
    debug(`Player Damage Prompt |    ✓ Graze whisper sent for ${targetActor.name}`);
}

// ── Whisper creation ─────────────────────────────────────────────────

/**
 * Create and send the whispered damage prompt.
 * @param {Actor}    actor            The target actor.
 * @param {string}   tokenName        The display name of the target token.
 * @param {number}   attackTotal      The attack roll total.
 * @param {boolean}  isCritical       Whether the attack was a critical hit.
 * @param {Record<string, number>} damageByType  Aggregated damage map.
 * @param {number}   effectiveDamage  Net damage after traits.
 * @param {string}   traitText        Human-readable trait summary HTML.
 * @param {Array}    rawDamages       Per-roll DamageDescriptions for applyDamage.
 * @param {string[]} whisperUsers     User IDs to whisper to.
 * @param {boolean}  [grazeMode=false]  If true, format as a Graze damage prompt.
 * @param {string}   [activityType="attack"]  The type of activity.
 * @param {Item|null} [sourceItem=null]       The source item of the damage.
 * @param {boolean}  [hasHalfDamage=false]    Whether the activity does half damage on save.
 */
async function _sendDamagePrompt(actor, tokenDoc, tokenName, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperUsers, grazeMode = false, activityType = "attack", sourceItem = null, hasHalfDamage = false) {
    const isToken = tokenDoc?.documentName === "Token";
    const speakerToken = isToken ? tokenDoc : null;

    const allHealing = Object.keys(damageByType).length > 0 && Object.keys(damageByType).every(t => CONFIG.DND5E?.healingTypes?.[t]);
    const allTempHP = Object.keys(damageByType).length > 0 && Object.keys(damageByType).every(t => t === "temphp");
    const isPureHealing = allHealing && !allTempHP;

    let damageText = _formatDamageBreakdown(damageByType);
    if (isPureHealing) {
        damageText = damageText.replace(/Healing/gi, "Hit Points");
    }

    // Bold the damage breakdown only when no trait modifiers change the value;
    // when traits apply, the effective damage is already bolded in traitText.
    const damageDisplay = traitText ? damageText : `<strong>${damageText}</strong>`;
    
    // Hit description
    let descriptionHtml = "";
    if (grazeMode) {
        descriptionHtml = `<strong>${tokenName}</strong> was <span class="nd5t-graze-text">GRAZED</span> (attack missed) for ${damageDisplay}.`;
    } else if (activityType === "attack") {
        if (isCritical) {
            descriptionHtml = `<strong>${tokenName}</strong> was <span class="nd5t-crit-text">CRITICALLY HIT</span> by an Attack Roll of ${attackTotal} for ${damageDisplay}.`;
        } else {
            descriptionHtml = `<strong>${tokenName}</strong> was hit with an Attack Roll of ${attackTotal} for ${damageDisplay}.`;
        }
    } else if (activityType === "save") {
        descriptionHtml = `<strong>${tokenName}</strong> must make a Saving Throw for ${damageDisplay}.`;
    } else {
        if (sourceItem && sourceItem.parent) {
            if (isPureHealing) {
                descriptionHtml = `<strong>${tokenName}</strong> recovers ${damageDisplay} from <strong>${sourceItem.parent.name}'s</strong> <strong>${sourceItem.name}</strong>.`;
            } else {
                descriptionHtml = `<strong>${tokenName}</strong> receives ${damageDisplay} from <strong>${sourceItem.parent.name}'s</strong> <strong>${sourceItem.name}</strong>.`;
            }
        } else {
            if (isPureHealing) {
                descriptionHtml = `<strong>${tokenName}</strong> recovers ${damageDisplay} from an ability.`;
            } else {
                descriptionHtml = `<strong>${tokenName}</strong> is affected by an ability for ${damageDisplay}.`;
            }
        }
    }
    
    // Serialise damage descriptions for the button (properties as arrays)
    const damagesJson = JSON.stringify(rawDamages).replace(/'/g, "&#39;");

    let actionWord = "Damage";
    let iconFull = "fa-heart-crack";
    let iconHalf = "fa-heart-broken";
    if (allTempHP) {
        actionWord = "Temp HP";
        iconFull = "fa-shield-halved";
        iconHalf = "fa-shield-halved";
    } else if (allHealing) {
        actionWord = "Healing";
        iconFull = "fa-heart";
        iconHalf = "fa-heart";
    } else if (Object.keys(damageByType).some(t => CONFIG.DND5E?.healingTypes?.[t])) {
        actionWord = "Points";
    }

    let buttonsHtml = '';
    if (activityType === "save") {
        const fullSuffix = hasHalfDamage ? " (Full)" : "";
        buttonsHtml = `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="1">
                <i class="fas ${iconFull}"></i>
                Apply ${effectiveDamage} ${actionWord}${fullSuffix}
            </button>
        `;
        
        if (hasHalfDamage) {
            const halfEffective = Math.floor(effectiveDamage / 2);
            buttonsHtml += `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="0.5">
                <i class="fas ${iconHalf}"></i>
                Apply ${halfEffective} ${actionWord} (Half)
            </button>
            `;
        }
    } else {
        const buttonLabel = grazeMode ? `Apply ${effectiveDamage} ${actionWord} (Graze)` : `Apply ${effectiveDamage} ${actionWord}`;
        buttonsHtml = `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="1">
                <i class="fas ${iconFull}"></i>
                ${buttonLabel}
            </button>
        `;
    }

    const content = `
        <div class="dnd5e chat-card nd5t-damage-prompt">
            <div class="card-content" style="margin-bottom: 8px; font-size: 13px;">
                ${descriptionHtml}
                ${traitText ? `<div class="nd5t-trait-info">${traitText}</div>` : ""}
            </div>
            <div class="card-buttons" style="display: flex; flex-direction: column; gap: 4px;">
                ${buttonsHtml}
            </div>
        </div>
    `;

    const newMessage = await ChatMessage.create({
        content,
        whisper: whisperUsers,
        speaker: Object.assign(ChatMessage.getSpeaker({ actor, token: speakerToken }), { alias: tokenName }),
        flags: {
            [MODULE_ID]: { damagePrompt: true }
        }
    });

    // Clean up stale damage prompts (>10 min old) for the same recipients
    if (newMessage) _cleanupStaleDamagePrompts(newMessage);
}

// ── Stale prompt cleanup ─────────────────────────────────────────────

/**
 * Delete damage prompt chat messages older than 10 minutes.
 * Only runs on the GM client (the message author) to avoid duplicate
 * deletions.
 * @param {ChatMessage} newMessage  The newly created damage prompt.
 */
function _cleanupStaleDamagePrompts(newMessage) {
    const activeGM = game.users.activeGM;
    if (activeGM) {
        if (game.user.id !== activeGM.id) return;
    } else {
        const authorId = newMessage.author?.id ?? newMessage.user?.id;
        if (game.user.id !== authorId) return;
    }

    const STALE_MS = 10 * 60 * 1000; // 10 minutes
    const cutoff = Date.now() - STALE_MS;

    const stale = game.messages.filter(m => {
        if (m.id === newMessage.id) return false; // don't delete ourselves
        if (!m.getFlag(MODULE_ID, "damagePrompt")) return false; // not a damage prompt
        if (m.timestamp * 1000 >= cutoff) return false; // too recent
        return true;
    });

    if (!stale.length) return;

    debug(`Player Damage Prompt | Cleaning up ${stale.length} stale damage prompt(s) (>10 min old)`);

    const ids = stale.map(m => m.id);
    ChatMessage.deleteDocuments(ids).catch(err => {
        console.error("Nik's DnD5e Tweaks | Failed to delete stale damage prompts:", err);
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

    // Allow individual players to suppress damage prompts
    if (!game.user.isGM && game.settings.get(MODULE_ID, "suppressDamagePrompt")) {
        prompt.style.display = "none";
        return;
    }

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-damage"]');
    if (!buttons.length) return;

    // If damage was already applied (flag set by _markMessageApplied),
    // disable the buttons in the DOM. We cannot rely on the HTML `disabled`
    // attribute persisting in the stored content because Foundry's HTML
    // sanitiser strips it during rendering.
    if (message.getFlag(MODULE_ID, "damageApplied")) {
        buttons.forEach(button => {
            button.disabled = true;
            if (button.dataset.multiplier === "1" || buttons.length === 1) {
                button.innerHTML = '<i class="fas fa-check"></i> Damage Applied';
            } else {
                button.style.display = "none";
            }
        });
        return;
    }

    buttons.forEach(button => {
        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const actorUuid = button.dataset.actorUuid;
            const damages = JSON.parse(button.dataset.damages);
            const multiplier = parseFloat(button.dataset.multiplier || "1");

            debug("Player Damage Prompt | Button clicked",
                "| Message ID:", message.id,
                "| Actor UUID:", actorUuid,
                "| Multiplier:", multiplier,
                "| Damages:", damages);

            // Reconstruct property Sets for applyDamage
            for (const d of damages) {
                if (d.properties) d.properties = new Set(d.properties);
                if (multiplier !== 1) {
                    d.value = Math.max(0, Math.floor(d.value * multiplier));
                }
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

                // Immediately disable the buttons in the DOM
                buttons.forEach(b => {
                    b.disabled = true;
                    if (b === button || buttons.length === 1) {
                        b.innerHTML = '<i class="fas fa-check"></i> Damage Applied';
                    } else {
                        b.style.display = "none";
                    }
                });

                // Ask the GM to persist the disabled state in the message content
                _requestMarkApplied(message.id);
            } catch (err) {
                console.error("Nik's DnD5e Tweaks | Failed to apply damage:", err);
                debug("Player Damage Prompt | ✗ applyDamage failed:", err.message);
                ui.notifications.error("Failed to apply damage. See the console for details.");
            }
        });
    });
}

// ── Socket sync ──────────────────────────────────────────────────────

/**
 * Request that the message be flagged as applied so the button appears
 * disabled on all clients.  If the current user is the GM (message
 * author), set the flag directly; otherwise emit a socket event so
 * the GM's client does it.
 * @param {string} messageId
 */
function _requestMarkApplied(messageId) {
    const msg = game.messages.get(messageId);
    if (!msg) return;
    const authorId = msg.author?.id ?? msg.user?.id;

    if (game.user.id === authorId || game.user.isGM) {
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
    
    // The client who authored the prompt must update it (or a GM)
    const msg = game.messages.get(data.messageId);
    if (!msg) return;
    const authorId = msg.author?.id ?? msg.user?.id;
    if (game.user.id !== authorId && !game.user.isGM) return;

    debug("Player Damage Prompt | Socket received: damagePromptApplied for message", data.messageId);
    _markMessageApplied(data.messageId);
}

/**
 * Mark a damage prompt chat message as applied by setting a flag.
 * The flag is read by `_bindApplyDamageButton` during the subsequent
 * re-render to disable the button in the DOM.  We use a flag rather
 * than persisting the `disabled` HTML attribute in the message content
 * because Foundry's HTML sanitiser strips `disabled` during rendering.
 *
 * Must be called on the GM's client (the message author).
 * @param {string} messageId
 */
async function _markMessageApplied(messageId) {
    const message = game.messages.get(messageId);
    if (!message) {
        debug("Player Damage Prompt | ✗ Could not find message to mark applied:", messageId);
        return;
    }

    // Check if already marked
    if (message.getFlag(MODULE_ID, "damageApplied")) {
        debug("Player Damage Prompt | Button already marked as applied in message", messageId);
        return;
    }

    await message.setFlag(MODULE_ID, "damageApplied", true);
    debug("Player Damage Prompt | ✓ Message flagged as damage applied:", messageId);
}
