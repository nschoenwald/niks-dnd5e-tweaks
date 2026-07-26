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

    // When a message's flags are updated (e.g. damageApplied is set by the
    // GM after a player clicks Apply), Foundry does NOT re-fire the
    // renderChatMessage hook.  We must listen for updateChatMessage and
    // manually update the button DOM on all clients.
    Hooks.on("updateChatMessage", _onUpdateDamageApplied);

    // Socket listener — any client can ask the GM to mark a message as applied.
    // We register this in 'ready' to ensure the listener isn't dropped during startup.
    Hooks.once("ready", () => {
        game.socket.on(`module.${MODULE_ID}`, _onSocketMessage);
        debug("Player Damage Prompt | Socket listener registered");
    });

    debug("Player Damage Prompt | Initialized hooks");
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

    // Skip if midi-qol is active and configured to auto-apply damage
    if (game.modules.get("midi-qol")?.active) {
        const midiAutoApply = globalThis.MidiQOL?.configSettings?.()?.autoApplyDamage
            ?? game.settings.get("midi-qol", "ConfigSettings")?.autoApplyDamage;
        if (midiAutoApply && midiAutoApply.toLowerCase().includes("yes")) {
            debug("Player Damage Prompt | midi-qol detected and auto-applies damage — feature bypassed.");
            return;
        }
    }

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

        const tokenName = _getTokenName(tokenDoc, target, actor);
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

/**
 * Extract the true/unhidden display name of a token or actor.
 * Modules like `hide-npc-names` override `TokenDocument.prototype.name` with a
 * getter that returns a hidden name (e.g. "Unidentified Creature") for non-GMs.
 * To ensure chat cards created on player clients retain the original name (so that
 * GMs see the real name while `hide-npc-names` dynamically hides it for players),
 * we bypass the getter by reading `tokenDoc.__name` or `tokenDoc._source.name`.
 * @param {TokenDocument|null} tokenDoc
 * @param {object|null} target
 * @param {Actor|null} actor
 * @returns {string} The unhidden display name.
 */
function _getTokenName(tokenDoc, target, actor) {
    return tokenDoc?.__name || tokenDoc?._source?.name || tokenDoc?.name || target?.name || actor?.name || "";
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
    const { effectiveDamage, traitText, details } = _calculateEffectiveDamage(actor, damageByType);
    const totalRaw = Object.values(damageByType).reduce((sum, v) => sum + v, 0);
    debug(`Player Damage Prompt |    Effective damage: ${effectiveDamage} (raw: ${totalRaw})`,
        traitText ? `| Trait text: ${traitText.replace(/<[^>]+>/g, "")}` : "| No trait modifiers");

    // Send the whisper
    debug(`Player Damage Prompt |    Sending whisper to ${whisperTargets.length} user(s):`,
        whisperTargets.map(id => game.users.get(id)?.name || id));

    const tokenName = _getTokenName(tokenDoc, target, actor);
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
    
    await _sendDamagePrompt(actor, tokenDoc, tokenName, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperTargets, false, activityType, sourceItem, hasHalfDamage, details);
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
    const details = [];  // per-type breakdown for structured layout

    for (const [type, amount] of Object.entries(damageByType)) {
        totalRaw += amount;

        const isHealingType = !!CONFIG.DND5E?.healingTypes?.[type];
        const isImmune = !isHealingType && di.has(type);
        const isResistant = !isHealingType && dr.has(type);
        const isVulnerable = !isHealingType && dv.has(type);

        if (isImmune) {
            immune.push(type);
            details.push({ type, raw: amount, effective: 0, modifier: "immune" });
            effectiveDamage += 0;
            continue;
        }

        let effective = amount;
        let modifier = ""; // annotation for the structured table

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
            const sign = totalMod > 0 ? "+" : "";
            modifier = `${sign}${totalMod}`;
        }

        // 2. Resistance (halve, rounded down)
        if (isResistant && !isVulnerable) {
            resistant.push(type);
            effective = Math.floor(effective / 2);
            modifier = modifier ? `${modifier}, resist` : "resist";
        }

        // 3. Vulnerability (double)
        if (isVulnerable && !isResistant) {
            vulnerable.push(type);
            effective = effective * 2;
            modifier = modifier ? `${modifier}, vuln` : "vuln";
        }

        // If both resistant and vulnerable, they cancel out — no modification
        // (flat adjustment still applies)

        details.push({ type, raw: amount, effective, modifier });
        effectiveDamage += effective;
    }

    // Build human-readable trait summary (localized)
    const parts = [];
    if (resistant.length) {
        parts.push(game.i18n.format("ND5T.DamagePrompt.TraitResistant", { types: _formatTypeList(resistant) }));
    }
    if (immune.length) {
        parts.push(game.i18n.format("ND5T.DamagePrompt.TraitImmune", { types: _formatTypeList(immune) }));
    }
    if (vulnerable.length) {
        parts.push(game.i18n.format("ND5T.DamagePrompt.TraitVulnerable", { types: _formatTypeList(vulnerable) }));
    }
    if (modified.length) {
        const descriptions = modified.map(({ type, mod }) => {
            const sign = mod > 0 ? "+" : "";
            const label = _localizeType(type);
            return `${label} (${sign}${mod})`;
        });
        parts.push(game.i18n.format("ND5T.DamagePrompt.TraitReducing", { descriptions: descriptions.join(", ") }));
    }

    let traitText = "";
    if (parts.length && effectiveDamage !== totalRaw) {
        traitText = game.i18n.format("ND5T.DamagePrompt.TraitSummary", {
            traits: parts.join(` ${game.i18n.localize("ND5T.DamagePrompt.And")} `),
            effective: String(effectiveDamage)
        });
    }

    return { effectiveDamage, traitText, details };
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
    const { effectiveDamage, traitText, details } = _calculateEffectiveDamage(targetActor, grazeDamageByType);

    debug(`Player Damage Prompt |    Graze: effective damage ${effectiveDamage}`,
        traitText ? `| ${traitText.replace(/<[^>]+>/g, "")}` : "| No trait modifiers");

    // Send the graze damage prompt
    await _sendDamagePrompt(targetActor, tokenDoc, targetName, attackRoll.total, false, grazeDamageByType, effectiveDamage, traitText, grazeRawDamages, whisperTargets, true, "attack", weaponItem, false, details);
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
async function _sendDamagePrompt(actor, tokenDoc, tokenName, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperUsers, grazeMode = false, activityType = "attack", sourceItem = null, hasHalfDamage = false, details = []) {
    const isToken = tokenDoc?.documentName === "Token";
    const speakerToken = isToken ? tokenDoc : null;

    const allHealing = Object.keys(damageByType).length > 0 && Object.keys(damageByType).every(t => CONFIG.DND5E?.healingTypes?.[t]);
    const allTempHP = Object.keys(damageByType).length > 0 && Object.keys(damageByType).every(t => t === "temphp");
    const isPureHealing = allHealing && !allTempHP;

    // Determine action word and icons based on damage/healing type
    const { actionWord, actionKey, iconFull, iconHalf } = _getActionInfo(damageByType, allHealing, allTempHP);

    // Serialise damage descriptions for the button (properties as arrays)
    const damagesJson = JSON.stringify(rawDamages).replace(/'/g, "&#39;");

    // Build buttons HTML (shared between both layouts)
    const buttonsHtml = _buildButtonsHtml(actor, damagesJson, effectiveDamage, actionWord, actionKey, iconFull, iconHalf, activityType, hasHalfDamage, grazeMode);

    // Choose layout based on setting
    const layout = game.settings.get(MODULE_ID, "damagePromptLayout");
    let bodyHtml;
    if (layout === "structured") {
        bodyHtml = _buildStructuredLayout(tokenName, attackTotal, isCritical, grazeMode, activityType, sourceItem, isPureHealing, details, effectiveDamage, traitText);
    } else {
        bodyHtml = _buildClassicLayout(tokenName, attackTotal, isCritical, grazeMode, activityType, sourceItem, isPureHealing, damageByType, traitText);
    }

    const content = `
        <div class="dnd5e chat-card nd5t-damage-prompt">
            <div class="card-content nd5t-prompt-content">
                ${bodyHtml}
            </div>
            <div class="card-buttons nd5t-prompt-buttons">
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

/**
 * Determine the action word, i18n key, and icons based on damage/healing type.
 * @returns {{actionWord: string, actionKey: string, iconFull: string, iconHalf: string}}
 */
function _getActionInfo(damageByType, allHealing, allTempHP) {
    let actionKey = "ND5T.DamagePrompt.ApplyDamage";
    let iconFull = "fa-heart-crack";
    let iconHalf = "fa-heart-broken";
    if (allTempHP) {
        actionKey = "ND5T.DamagePrompt.ApplyTempHP";
        iconFull = "fa-shield-halved";
        iconHalf = "fa-shield-halved";
    } else if (allHealing) {
        actionKey = "ND5T.DamagePrompt.ApplyHealing";
        iconFull = "fa-heart";
        iconHalf = "fa-heart";
    } else if (Object.keys(damageByType).some(t => CONFIG.DND5E?.healingTypes?.[t])) {
        actionKey = "ND5T.DamagePrompt.ApplyPoints";
    }
    // Resolve the action word from the key (used for suffix-based labels)
    const actionWord = game.i18n.format(actionKey, { amount: "" }).replace(/^Apply\s*/, "").trim();
    return { actionWord, actionKey, iconFull, iconHalf };
}

/**
 * Build the buttons HTML shared between both layouts.
 * @returns {string} HTML string for the buttons.
 */
function _buildButtonsHtml(actor, damagesJson, effectiveDamage, actionWord, actionKey, iconFull, iconHalf, activityType, hasHalfDamage, grazeMode) {
    let buttonsHtml = '';
    if (activityType === "save") {
        const fullLabel = game.i18n.format(actionKey, { amount: effectiveDamage });
        const fullSuffix = hasHalfDamage ? game.i18n.localize("ND5T.DamagePrompt.ApplyFullSuffix") : "";
        buttonsHtml = `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="1">
                <i class="fas ${iconFull}"></i>
                ${fullLabel}${fullSuffix}
            </button>
        `;

        if (hasHalfDamage) {
            const halfEffective = Math.floor(effectiveDamage / 2);
            const halfLabel = game.i18n.format(actionKey, { amount: halfEffective });
            const halfSuffix = game.i18n.localize("ND5T.DamagePrompt.ApplyHalfSuffix");
            buttonsHtml += `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="0.5">
                <i class="fas ${iconHalf}"></i>
                ${halfLabel}${halfSuffix}
            </button>
            `;
        }
    } else {
        const baseLabel = game.i18n.format(actionKey, { amount: effectiveDamage });
        const grazeSuffix = grazeMode ? game.i18n.localize("ND5T.DamagePrompt.ApplyGrazeSuffix") : "";
        buttonsHtml = `
            <button data-action="nd5t-apply-damage"
                    data-actor-uuid="${actor.uuid}"
                    data-damages='${damagesJson}'
                    data-multiplier="1">
                <i class="fas ${iconFull}"></i>
                ${baseLabel}${grazeSuffix}
            </button>
        `;
    }
    return buttonsHtml;
}

/**
 * Build the classic (text-based) layout body HTML.
 * This preserves the original damage prompt format.
 * @returns {string} HTML string for the card content body.
 */
function _buildClassicLayout(tokenName, attackTotal, isCritical, grazeMode, activityType, sourceItem, isPureHealing, damageByType, traitText) {
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
        descriptionHtml = game.i18n.format("ND5T.DamagePrompt.Grazed", {
            damage: damageDisplay,
            grazeBadge: game.i18n.localize("ND5T.DamagePrompt.GrazeBadge")
        });
    } else if (activityType === "attack") {
        if (isCritical) {
            descriptionHtml = game.i18n.format("ND5T.DamagePrompt.CriticalHit", {
                attackTotal, damage: damageDisplay,
                critBadge: game.i18n.localize("ND5T.DamagePrompt.CritBadge")
            });
        } else {
            descriptionHtml = game.i18n.format("ND5T.DamagePrompt.HitBy", {
                attackTotal, damage: damageDisplay
            });
        }
    } else if (activityType === "save") {
        descriptionHtml = game.i18n.format("ND5T.DamagePrompt.SavingThrow", {
            damage: damageDisplay
        });
    } else {
        descriptionHtml = _buildGenericDescription(damageDisplay, sourceItem, isPureHealing);
    }

    let html = descriptionHtml;
    if (traitText) {
        html += `<div class="nd5t-trait-info">${traitText}</div>`;
    }
    return html;
}

/**
 * Build the structured (table-based) layout body HTML.
 * Shows a per-type damage breakdown table with raw, modifier, and effective columns.
 * @returns {string} HTML string for the card content body.
 */
function _buildStructuredLayout(tokenName, attackTotal, isCritical, grazeMode, activityType, sourceItem, isPureHealing, details, effectiveDamage, traitText) {
    // Header line: "TokenName — Hit Type"
    let hitType = "";
    let hitDetail = "";
    let hitTypeClass = "";

    if (grazeMode) {
        hitType = game.i18n.localize("ND5T.DamagePrompt.GrazeBadge");
        hitTypeClass = "nd5t-status-badge nd5t-graze-text";
    } else if (activityType === "attack") {
        if (isCritical) {
            hitType = game.i18n.localize("ND5T.DamagePrompt.CritBadge");
            hitTypeClass = "nd5t-status-badge nd5t-crit-text";
        }
    } else if (activityType === "save") {
        hitDetail = game.i18n.localize("ND5T.DamagePrompt.Structured.SaveDescription");
    } else {
        // Generic / non-attack: show source item if available
        if (sourceItem && sourceItem.parent) {
            hitDetail = `${sourceItem.parent.name} — ${sourceItem.name}`;
        }
    }

    // Determine the section header
    let sectionHeader;
    if (isPureHealing) {
        sectionHeader = game.i18n.localize("ND5T.DamagePrompt.Structured.HeaderHealing");
    } else if (Object.keys(details).length > 0 && details.every(d => d.type === "temphp")) {
        sectionHeader = game.i18n.localize("ND5T.DamagePrompt.Structured.HeaderTempHP");
    } else {
        sectionHeader = game.i18n.localize("ND5T.DamagePrompt.Structured.Header");
    }

    // Build header HTML
    let headerHtml = "";
    if (hitType || hitDetail) {
        headerHtml += `<div class="nd5t-structured-header">`;
        if (hitType) {
            headerHtml += `<span class="${hitTypeClass}">${hitType}</span>`;
            if (hitDetail) {
                headerHtml += ` — <span class="nd5t-hit-detail">${hitDetail}</span>`;
            }
        } else {
            headerHtml += `<span class="nd5t-hit-detail">${hitDetail}</span>`;
        }
        headerHtml += `</div>`;
    }

    // Column headers
    const colType = game.i18n.localize("ND5T.DamagePrompt.Structured.ColType");
    const colRaw = game.i18n.localize("ND5T.DamagePrompt.Structured.ColRaw");
    const colMod = game.i18n.localize("ND5T.DamagePrompt.Structured.ColModifier");
    const colEff = game.i18n.localize("ND5T.DamagePrompt.Structured.ColEffective");
    const totalLabel = game.i18n.localize("ND5T.DamagePrompt.Structured.Total");

    // Determine if we need the full breakdown (raw / modifier / effective)
    // or a simple two-column layout (type / damage)
    const hasModifiers = details.some(d => d.modifier);

    // Build table rows
    let rowsHtml = "";
    for (const d of details) {
        const typeLabel = _localizeType(d.type);
        rowsHtml += `<tr>`;
        rowsHtml += `<td>${typeLabel}</td>`;
        if (hasModifiers) {
            const modHtml = _getModifierCellHtml(d.modifier);
            rowsHtml += `<td class="nd5t-num-cell">${d.raw}</td>`;
            rowsHtml += `<td class="nd5t-mod-cell ${modHtml.cssClass}">${modHtml.text}</td>`;
            rowsHtml += `<td class="nd5t-num-cell">${d.effective}</td>`;
        } else {
            rowsHtml += `<td class="nd5t-num-cell">${d.raw}</td>`;
        }
        rowsHtml += `</tr>`;
    }

    // Build the table header
    let tableHtml = `<table class="nd5t-damage-table">`;
    tableHtml += `<thead><tr>`;
    tableHtml += `<th>${colType}</th>`;
    if (hasModifiers) {
        tableHtml += `<th class="nd5t-num-cell">${colRaw}</th>`;
        tableHtml += `<th class="nd5t-mod-cell">${colMod}</th>`;
        tableHtml += `<th class="nd5t-num-cell">${colEff}</th>`;
    } else {
        const colDamage = game.i18n.localize("ND5T.DamagePrompt.Structured.ColDamage");
        tableHtml += `<th class="nd5t-num-cell">${colDamage}</th>`;
    }
    tableHtml += `</tr></thead>`;
    tableHtml += `<tbody>${rowsHtml}</tbody>`;

    // Total row (only if multiple types)
    if (details.length > 1) {
        const totalRaw = details.reduce((sum, d) => sum + d.raw, 0);
        tableHtml += `<tfoot><tr class="nd5t-damage-total-row">`;
        tableHtml += `<td>${totalLabel}</td>`;
        if (hasModifiers) {
            tableHtml += `<td class="nd5t-num-cell" colspan="2">${totalRaw}</td>`;
            tableHtml += `<td class="nd5t-num-cell">${effectiveDamage}</td>`;
        } else {
            tableHtml += `<td class="nd5t-num-cell">${totalRaw}</td>`;
        }
        tableHtml += `</tr></tfoot>`;
    }

    tableHtml += `</table>`;

    return headerHtml + tableHtml;
}

/**
 * Build a generic (non-attack, non-save) description for the classic layout.
 * @returns {string} HTML string.
 */
function _buildGenericDescription(damageDisplay, sourceItem, isPureHealing) {
    if (sourceItem && sourceItem.parent) {
        if (isPureHealing) {
            return game.i18n.format("ND5T.DamagePrompt.RecoversHP", {
                damage: damageDisplay,
                sourceName: sourceItem.parent.name,
                itemName: sourceItem.name
            });
        }
        return game.i18n.format("ND5T.DamagePrompt.ReceivesDamage", {
            damage: damageDisplay,
            sourceName: sourceItem.parent.name,
            itemName: sourceItem.name
        });
    }
    if (isPureHealing) {
        return game.i18n.format("ND5T.DamagePrompt.RecoversHPGeneric", {
            damage: damageDisplay
        });
    }
    return game.i18n.format("ND5T.DamagePrompt.ReceivesDamageGeneric", {
        damage: damageDisplay
    });
}

/**
 * Get the display text and CSS class for a modifier cell in the structured table.
 * @param {string} modifier  The modifier annotation (e.g. "immune", "resist", "vuln", "+3", "-3, resist").
 * @returns {{text: string, cssClass: string}}
 */
function _getModifierCellHtml(modifier) {
    if (!modifier) return { text: "—", cssClass: "" };
    if (modifier === "immune") {
        return { text: game.i18n.localize("ND5T.DamagePrompt.Structured.Immune"), cssClass: "nd5t-mod-immune" };
    }
    if (modifier === "resist") {
        return { text: game.i18n.localize("ND5T.DamagePrompt.Structured.Resist"), cssClass: "nd5t-mod-resist" };
    }
    if (modifier === "vuln") {
        return { text: game.i18n.localize("ND5T.DamagePrompt.Structured.Vulnerable"), cssClass: "nd5t-mod-vulnerable" };
    }
    // Combined modifiers (e.g. "-3, resist")
    if (modifier.includes("resist")) {
        return { text: modifier, cssClass: "nd5t-mod-resist" };
    }
    if (modifier.includes("vuln")) {
        return { text: modifier, cssClass: "nd5t-mod-vulnerable" };
    }
    // Flat modifier only
    return { text: modifier, cssClass: "nd5t-mod-flat" };
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

    const stale = [];
    const maxMessagesToScan = 1000;
    const contents = game.messages.contents;
    const startIndex = Math.max(0, contents.length - maxMessagesToScan);

    // Iterate backwards from newest to oldest, up to the max messages cap
    for (let i = contents.length - 1; i >= startIndex; i--) {
        const m = contents[i];
        if (m.id === newMessage.id) continue;
        
        // Direct property access is much faster than getFlag for large collections
        if (m.flags?.[MODULE_ID]?.damagePrompt && (m.timestamp * 1000 < cutoff)) {
            stale.push(m);
        }
    }

    if (!stale.length) return;

    debug(`Player Damage Prompt | Cleaning up ${stale.length} stale damage prompt(s) (>10 min old)`);

    const ids = stale.map(m => m.id);
    ChatMessage.deleteDocuments(ids).catch(err => {
        console.error("Nik's DnD5e Tweaks | Failed to delete stale damage prompts:", err);
    });
}

// ── Button handling ──────────────────────────────────────────────────

/**
 * Handle updateChatMessage to sync the "Damage Applied" button state
 * across all clients when the damageApplied flag is set.  Foundry does
 * not re-fire renderChatMessage on flag changes, so we must manually
 * update the DOM.
 * @param {ChatMessage} message    The updated message document.
 * @param {object}      updateData The differential update data.
 */
function _onUpdateDamageApplied(message, updateData) {
    const updateFlags = updateData?.flags?.[MODULE_ID];
    if (!updateFlags) return;

    // Check if the flag was unset (undo)
    if (updateFlags.hasOwnProperty("-=damageApplied") || updateFlags.damageApplied === null) {
        debug("Player Damage Prompt | updateChatMessage: damageApplied flag unset for message", message.id);
        const li = _getChatMessageElement(message.id);
        if (li) {
            const prompt = li.querySelector(".nd5t-damage-prompt");
            if (prompt) _setPromptStateUnapplied(prompt);
        }
        return;
    }

    // Check if the flag was set (applied)
    const flagValue = updateFlags.damageApplied;
    if (flagValue) {
        debug("Player Damage Prompt | updateChatMessage: damageApplied flag set for message", message.id);
        const li = _getChatMessageElement(message.id);
        if (li) {
            const prompt = li.querySelector(".nd5t-damage-prompt");
            if (prompt) _setPromptStateApplied(message, prompt, flagValue);
        }
    }
}

/**
 * Helper to safely find a chat message element in the DOM.
 */
function _getChatMessageElement(id) {
    return document.querySelector(`.message[data-message-id="${id}"]`)
        ?? document.querySelector(`li[data-message-id="${id}"]`);
}

/**
 * Transition the buttons into the "Applied" state, adding an Undo button.
 */
function _setPromptStateApplied(message, prompt, flagData) {
    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-damage"]');
    if (!buttons.length) return;

    // If already in applied state (has undo button), return
    if (prompt.querySelector('.nd5t-undo-btn')) return;

    const appliedText = game.i18n.localize("ND5T.DamagePrompt.Applied");
    const canUndo = flagData && typeof flagData.hp === "number";

    buttons.forEach(button => {
        if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;

        if (button.dataset.multiplier === "1" || buttons.length === 1) {
            button.innerHTML = `<i class="fas fa-check"></i> ${appliedText}`;

            if (canUndo) {
                // Ensure the parent is a horizontal flex container
                button.parentElement.style.display = "flex";
                button.parentElement.style.flexDirection = "row";
                button.parentElement.style.gap = "4px";

                const undoBtn = document.createElement("button");
                undoBtn.className = "nd5t-undo-btn";
                undoBtn.innerHTML = `<i class="fas fa-undo"></i> ${game.i18n.localize("ND5T.DamagePrompt.Undo")}`;
                undoBtn.title = game.i18n.localize("ND5T.DamagePrompt.UndoHint");
                undoBtn.style.flex = "0 0 auto";
                undoBtn.style.width = "auto";
                undoBtn.style.padding = "0 12px";

                undoBtn.addEventListener("click", async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();

                    const actor = await fromUuid(flagData.actorUuid);
                    if (actor) {
                        const newHp = Math.max(0, Math.min(actor.system.attributes.hp.max, actor.system.attributes.hp.value + flagData.hp));
                        const newTemp = Math.max(0, actor.system.attributes.hp.temp + flagData.temp);
                        await actor.update({
                            "system.attributes.hp.value": newHp,
                            "system.attributes.hp.temp": newTemp
                        });
                        debug(`Player Damage Prompt | Undo applied | Restored ${flagData.hp} HP and ${flagData.temp} Temp HP`);
                    }

                    _requestUnmarkApplied(message.id);
                });

                button.parentElement.appendChild(undoBtn);
                button.style.flex = "1";
            }
        } else {
            button.style.display = "none";
        }
    });
}

/**
 * Restore the buttons back to their unapplied state.
 */
function _setPromptStateUnapplied(prompt) {
    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-damage"]');
    
    buttons.forEach(button => {
        button.disabled = false;
        button.style.display = "";
        button.style.flex = "";
        button.parentElement.style.flexDirection = "";
        if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
        }
    });
    
    const undoBtn = prompt.querySelector('.nd5t-undo-btn');
    if (undoBtn) undoBtn.remove();
}

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

    // Prevent double binding if both V13 and V14 render hooks fire on the same element
    if (prompt.dataset.bound) return;
    prompt.dataset.bound = "true";

    // Allow individual players to suppress damage prompts
    if (!game.user.isGM && game.settings.get(MODULE_ID, "suppressDamagePrompt")) {
        prompt.style.display = "none";
        return;
    }

    const buttons = prompt.querySelectorAll('button[data-action="nd5t-apply-damage"]');
    if (!buttons.length) return;

    // If damage was already applied (flag set by _markMessageApplied),
    // visually transition the buttons to the disabled + undo state.
    const flagData = message.getFlag(MODULE_ID, "damageApplied");
    if (flagData) {
        _setPromptStateApplied(message, prompt, flagData);
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
                const hpBefore = actor.system.attributes.hp.value;
                const tempBefore = actor.system.attributes.hp.temp || 0;

                await actor.applyDamage(damages);

                const hpAfter = actor.system.attributes.hp.value;
                const tempAfter = actor.system.attributes.hp.temp || 0;

                debug(`Player Damage Prompt | ✓ Damage applied to ${actor.name}`,
                    `| HP after: ${hpAfter}/${actor.system.attributes.hp.max}`,
                    `| Temp HP: ${tempAfter}`);

                const deltas = {
                    hp: hpBefore - hpAfter,
                    temp: tempBefore - tempAfter,
                    actorUuid: actorUuid
                };

                // Immediately update DOM
                _setPromptStateApplied(message, prompt, deltas);

                // Ask the GM to persist the disabled state in the message content
                _requestMarkApplied(message.id, deltas);
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
 * @param {object} deltas
 */
function _requestMarkApplied(messageId, deltas) {
    const msg = game.messages.get(messageId);
    if (!msg) return;
    const authorId = msg.author?.id ?? msg.user?.id;

    if (game.user.id === authorId || game.user.isGM) {
        _markMessageApplied(messageId, deltas);
    } else {
        debug("Player Damage Prompt | Emitting socket to mark message applied:", messageId);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "damagePromptApplied",
            messageId,
            deltas
        });
    }
}

/**
 * Handle a request to unset the "damageApplied" flag on a chat message.
 */
function _requestUnmarkApplied(messageId) {
    const msg = game.messages.get(messageId);
    if (!msg) return;
    const authorId = msg.author?.id ?? msg.user?.id;

    if (game.user.id === authorId || game.user.isGM) {
        _unmarkMessageApplied(messageId);
    } else {
        debug("Player Damage Prompt | Emitting socket to unmark message applied:", messageId);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "damagePromptUnapplied",
            messageId
        });
    }
}

/**
 * Handle incoming socket messages for this module.
 * @param {object} data  The socket payload.
 */
function _onSocketMessage(data) {
    if (data?.type === "damagePromptApplied") {
        const msg = game.messages.get(data.messageId);
        if (!msg) return;
        const authorId = msg.author?.id ?? msg.user?.id;
        if (game.user.id !== authorId && !game.user.isGM) return;

        debug("Player Damage Prompt | Socket received: damagePromptApplied for message", data.messageId);
        _markMessageApplied(data.messageId, data.deltas);
        return;
    }

    if (data?.type === "damagePromptUnapplied") {
        const msg = game.messages.get(data.messageId);
        if (!msg) return;
        const authorId = msg.author?.id ?? msg.user?.id;
        if (game.user.id !== authorId && !game.user.isGM) return;

        debug("Player Damage Prompt | Socket received: damagePromptUnapplied for message", data.messageId);
        _unmarkMessageApplied(data.messageId);
        return;
    }
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
 * @param {object} deltas - The HP/TempHP deltas and actor UUID for undo.
 */
async function _markMessageApplied(messageId, deltas) {
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

    const flagData = deltas || true;
    await message.setFlag(MODULE_ID, "damageApplied", flagData);
    debug("Player Damage Prompt | ✓ Message flagged as damage applied:", messageId);
}

/**
 * Server/GM-side handler to unset the "damageApplied" flag on a message.
 * @param {string} messageId 
 */
async function _unmarkMessageApplied(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    if (!message.getFlag(MODULE_ID, "damageApplied")) return;

    await message.unsetFlag(MODULE_ID, "damageApplied");
    debug("Player Damage Prompt | ✓ Message flagged as damage unapplied:", messageId);
}
