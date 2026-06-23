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
        await _processTarget(target, attackRoll, attackMessage, message, originatingMessage, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled);
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
            // Skip healing types
            if (CONFIG.DND5E?.healingTypes?.[chunk.type]) continue;
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
            if (CONFIG.DND5E?.healingTypes?.[chunk.type]) continue;
            descriptions.push(chunk);
        }
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
 * @param {boolean} playerPromptEnabled  Whether the player damage prompt setting is on.
 * @param {boolean} gmPromptEnabled      Whether the GM damage prompt setting is on.
 */
async function _processTarget(target, attackRoll, attackMessage, damageMessage, originatingMessage, damageByType, rawDamages, isPlayerAttack, playerPromptEnabled, gmPromptEnabled) {
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
    const isCritical = !!attackRoll.isCritical;
    const attackTotal = attackRoll.total;
    const targetAC = target.ac;

    debug(`Player Damage Prompt |    Hit check: roll ${attackTotal} vs AC ${targetAC}`,
        `| Critical: ${isCritical}`,
        `| Result: ${isCritical ? "CRITICAL HIT" : (attackTotal >= targetAC ? "HIT" : "MISS")}`);

    if (!isCritical && attackTotal < targetAC) {
        // Attack missed — check for Graze weapon mastery
        debug(`Player Damage Prompt |    Attack missed, checking for Graze mastery...`);
        await _handleGrazeMastery(actor, attackRoll, attackMessage, damageMessage, originatingMessage, whisperTargets);
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

    await _sendDamagePrompt(actor, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperTargets, false);
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

// ── Graze weapon mastery ─────────────────────────────────────────────

/**
 * Resolve the weapon Item from a damage or originating message.
 * The DnD5e system stores `use.itemUuid` in the message flags.
 * @param {ChatMessage}      damageMessage       The damage roll message.
 * @param {ChatMessage|null} originatingMessage   The originating usage message.
 * @returns {Item|null}
 */
function _resolveWeaponItem(damageMessage, originatingMessage) {
    // Try the damage message first, then fall back to the originating message
    const itemUuid = damageMessage.getFlag("dnd5e", "use.itemUuid")
        || originatingMessage?.getFlag("dnd5e", "use.itemUuid");
    if (!itemUuid) return null;
    try {
        return fromUuidSync(itemUuid);
    } catch {
        return null;
    }
}

/**
 * Check whether a weapon has the Graze mastery and the attacker actor
 * has mastered that weapon.  The actor's `traits.weaponMastery` Set
 * contains weapon identifiers (e.g. "greatsword"), and the weapon's
 * `system.mastery` is the mastery type key (e.g. "graze").
 * @param {Item}  item           The weapon Item.
 * @param {Actor} attackerActor  The actor who made the attack.
 * @returns {boolean}
 */
function _hasGrazeMastery(item, attackerActor) {
    if (!item || !attackerActor) return false;
    if (item.system?.mastery !== "graze") return false;

    const identifier = item.system?.identifier;
    if (!identifier) return false;

    const masteredWeapons = attackerActor.system?.traits?.weaponMastery;
    if (!masteredWeapons) return false;

    // masteredWeapons may be a Set or an array-like
    const has = masteredWeapons instanceof Set
        ? masteredWeapons.has(identifier)
        : Array.isArray(masteredWeapons)
            ? masteredWeapons.includes(identifier)
            : false;

    debug(`Player Damage Prompt |    Graze mastery check:`,
        `weapon="${item.name}" identifier="${identifier}" mastery="${item.system?.mastery}"`,
        `| actor mastered=[${masteredWeapons instanceof Set ? [...masteredWeapons].join(", ") : masteredWeapons}]`,
        `| result=${has}`);
    return has;
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
 * @param {Roll}            attackRoll          The D20Roll for the attack.
 * @param {ChatMessage}     attackMessage       The attack roll message.
 * @param {ChatMessage}     damageMessage       The damage roll message.
 * @param {ChatMessage|null} originatingMessage The originating usage message.
 * @param {string[]}        whisperTargets      User IDs to whisper to.
 */
async function _handleGrazeMastery(targetActor, attackRoll, attackMessage, damageMessage, originatingMessage, whisperTargets) {
    // Resolve the weapon item from message flags
    const weaponItem = _resolveWeaponItem(damageMessage, originatingMessage);
    if (!weaponItem) {
        debug(`Player Damage Prompt |    ✗ Graze: could not resolve weapon item from message flags`);
        return;
    }
    debug(`Player Damage Prompt |    Resolved weapon: ${weaponItem.name} (mastery: ${weaponItem.system?.mastery || "none"})`);

    // Resolve the attacker actor
    const attackerActor = ChatMessage.getSpeakerActor(attackMessage.speaker);
    if (!attackerActor) {
        debug(`Player Damage Prompt |    ✗ Graze: could not resolve attacker actor`);
        return;
    }

    // Check if the weapon has graze mastery AND the actor has mastered it
    if (!_hasGrazeMastery(weaponItem, attackerActor)) {
        debug(`Player Damage Prompt |    ✗ Graze: mastery check failed, skipping`);
        return;
    }

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
    await _sendDamagePrompt(targetActor, attackRoll.total, false, grazeDamageByType, effectiveDamage, traitText, grazeRawDamages, whisperTargets, true);
    debug(`Player Damage Prompt |    ✓ Graze whisper sent for ${targetActor.name}`);
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
 * @param {boolean}  [grazeMode=false]  If true, format as a Graze damage prompt.
 */
async function _sendDamagePrompt(actor, attackTotal, isCritical, damageByType, effectiveDamage, traitText, rawDamages, whisperUsers, grazeMode = false) {
    // Hit description
    let hitText;
    if (grazeMode) {
        hitText = `<strong>${actor.name}</strong> was <strong class="nd5t-graze-text">GRAZED</strong> (attack missed)`;
    } else if (isCritical) {
        hitText = `<strong>${actor.name}</strong> was <strong class="nd5t-crit-text">CRITICALLY HIT</strong>`;
    } else {
        hitText = `<strong>${actor.name}</strong> was hit with an Attack Roll of <strong>${attackTotal}</strong>`;
    }

    const damageText = _formatDamageBreakdown(damageByType);
    const buttonLabel = grazeMode ? `Apply ${effectiveDamage} Damage (Graze)` : `Apply ${effectiveDamage} Damage`;

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
                    ${buttonLabel}
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

    // Allow individual players to suppress damage prompts
    if (!game.user.isGM && game.settings.get(MODULE_ID, "suppressDamagePrompt")) {
        prompt.style.display = "none";
        return;
    }

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
