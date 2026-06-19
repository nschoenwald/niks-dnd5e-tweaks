import { MODULE_ID, debug } from "../main.js";

/**
 * Combat Experience Tracker
 *
 * When a combat starts, snapshots all hostile NPC combatants and all player
 * character combatants.  Combatants added mid-combat are also tracked.
 *
 * When the combat ends (is deleted), whispers a summary chat message to the
 * GM listing every hostile NPC with its XP value, the total XP, the per-PC
 * share (rounded down), and a one-click "Distribute XP" button.
 *
 * All tracking state is persisted to the Combat document via flags, so the
 * feature survives mid-combat browser reloads.
 *
 * The feature is gated by the `enableCombatExpTracker` setting.
 */

// ── Flag key ─────────────────────────────────────────────────────────

const FLAG_KEY = "xpTracker";

// ── Initialisation ───────────────────────────────────────────────────

/**
 * Register hooks for the Combat Experience Tracker feature.
 * Called once during the "setup" phase from main.js.
 */
export function initCombatExpTracker() {
    Hooks.on("combatStart", _onCombatStart);
    Hooks.on("createCombatant", _onCreateCombatant);
    Hooks.on("deleteCombat", _onDeleteCombat);

    // V13 compat — renderChatMessage passes jQuery or HTMLElement
    Hooks.on("renderChatMessage", (message, html) => {
        const element = html[0] || html;
        _bindDistributeButton(message, element);
    });

    // V14 — renderChatMessageHTML passes a plain HTMLElement
    Hooks.on("renderChatMessageHTML", (message, html) => {
        _bindDistributeButton(message, html);
    });

    debug("Combat Exp Tracker | Initialized");
}

// ── Flag helpers ─────────────────────────────────────────────────────

/**
 * Read the xpTracker flag from a combat document.
 * @param {Combat} combat
 * @returns {{ npcs: Object<string, {name: string, xp: number}>, pcs: Object<string, {name: string}> } | undefined}
 */
function _getFlag(combat) {
    return combat.getFlag(MODULE_ID, FLAG_KEY);
}

/**
 * Write the xpTracker flag to a combat document.
 * @param {Combat} combat
 * @param {Object} data   { npcs: {...}, pcs: {...} }
 */
async function _setFlag(combat, data) {
    await combat.setFlag(MODULE_ID, FLAG_KEY, data);
}

// ── Combat lifecycle hooks ───────────────────────────────────────────

/**
 * Snapshot all combatants at the start of combat.
 * @param {Combat} combat    The combat that just started.
 */
async function _onCombatStart(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "enableCombatExpTracker")) return;

    const npcs = {};
    const pcs = {};

    for (const combatant of combat.combatants) {
        _classifyCombatant(combatant, npcs, pcs);
    }

    await _setFlag(combat, { npcs, pcs });

    debug("Combat Exp Tracker | Combat started — tracked",
        Object.keys(npcs).length, "hostile NPC(s) and",
        Object.keys(pcs).length, "PC(s)");
}

/**
 * Track a combatant added mid-combat.
 * @param {Combatant} combatant   The newly created combatant.
 */
async function _onCreateCombatant(combatant) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "enableCombatExpTracker")) return;

    const combat = combatant.combat;
    if (!combat) return;

    const flag = _getFlag(combat);
    if (!flag) return; // No tracker running on this combat

    const npcs = { ...flag.npcs };
    const pcs = { ...flag.pcs };

    _classifyCombatant(combatant, npcs, pcs);

    await _setFlag(combat, { npcs, pcs });

    debug("Combat Exp Tracker | Combatant added mid-combat:",
        combatant.actor?.name ?? "(unknown)");
}

/**
 * When a combat is deleted (ended), post the XP summary.
 * @param {Combat} combat    The combat that was just deleted.
 */
async function _onDeleteCombat(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "enableCombatExpTracker")) return;

    const flag = _getFlag(combat);
    if (!flag) return; // No tracker was running on this combat

    debug("Combat Exp Tracker | Combat ended — building XP summary");

    const npcCount = Object.keys(flag.npcs).length;
    const pcCount = Object.keys(flag.pcs).length;

    // Only post if there are both NPCs and PCs
    if (npcCount === 0 || pcCount === 0) {
        debug("Combat Exp Tracker | Skipping summary: no hostile NPCs or no PCs tracked");
        return;
    }

    await _sendExpSummary(flag.npcs, flag.pcs);
}

// ── Combatant classification ─────────────────────────────────────────

/**
 * Classify a combatant and add it to the appropriate tracking object.
 * - Hostile NPCs (disposition HOSTILE, actor type "npc") → npcs
 * - Player characters (actor type "character") → pcs
 * @param {Combatant} combatant
 * @param {Object<string, {name: string, xp: number}>} npcs   Mutated in-place
 * @param {Object<string, {name: string}>}              pcs    Mutated in-place
 */
function _classifyCombatant(combatant, npcs, pcs) {
    const actor = combatant.actor;
    if (!actor) return;

    const uuid = actor.uuid;

    if (actor.type === "character") {
        if (!pcs[uuid]) {
            pcs[uuid] = { name: actor.name };
            debug("Combat Exp Tracker |   PC:", actor.name, `(${uuid})`);
        }
    } else if (actor.type === "npc") {
        // Check disposition — only track hostile NPCs
        const disposition = combatant.token?.disposition
            ?? actor.prototypeToken?.disposition
            ?? CONST.TOKEN_DISPOSITIONS.HOSTILE;

        if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) {
            if (!npcs[uuid]) {
                const xp = actor.system.details?.xp?.value ?? 0;
                npcs[uuid] = { name: actor.name, xp };
                debug("Combat Exp Tracker |   Hostile NPC:", actor.name,
                    `| XP: ${xp}`, `(${uuid})`);
            }
        }
    }
}

// ── XP summary message ──────────────────────────────────────────────

/**
 * Build and send the GM-whispered XP summary chat message.
 * @param {Object<string, {name: string, xp: number}>} npcs
 * @param {Object<string, {name: string}>}              pcs
 */
async function _sendExpSummary(npcs, pcs) {
    const npcEntries = Object.values(npcs);
    const pcEntries = Object.entries(pcs);

    const totalXP = npcEntries.reduce((sum, npc) => sum + npc.xp, 0);
    const pcCount = pcEntries.length;
    const perPC = Math.floor(totalXP / pcCount);

    // Build NPC table rows
    const npcRows = npcEntries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(npc => `
            <tr>
                <td>${npc.name}</td>
                <td class="nd5t-exp-xp-cell">${npc.xp.toLocaleString()} XP</td>
            </tr>
        `).join("");

    // Build PC list
    const pcList = pcEntries
        .map(([, pc]) => pc)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(pc => `<li>${pc.name}</li>`)
        .join("");

    // Serialise PC UUIDs for the button
    const pcUuids = JSON.stringify(pcEntries.map(([uuid]) => uuid));

    const content = `
        <div class="dnd5e chat-card nd5t-exp-summary">
            <header class="card-header flexrow">
                <h3>Combat XP Summary</h3>
            </header>
            <div class="card-content">
                <table class="nd5t-exp-table">
                    <thead>
                        <tr>
                            <th>Creature</th>
                            <th class="nd5t-exp-xp-cell">XP</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${npcRows}
                    </tbody>
                    <tfoot>
                        <tr class="nd5t-exp-total-row">
                            <td><strong>Total</strong></td>
                            <td class="nd5t-exp-xp-cell"><strong>${totalXP.toLocaleString()} XP</strong></td>
                        </tr>
                    </tfoot>
                </table>
                <p class="nd5t-exp-share">
                    <strong>${perPC.toLocaleString()} XP</strong> each
                    (${totalXP.toLocaleString()} ÷ ${pcCount} character${pcCount !== 1 ? "s" : ""})
                </p>
                <details class="nd5t-exp-pc-details">
                    <summary>${pcCount} Participating Character${pcCount !== 1 ? "s" : ""}</summary>
                    <ul class="nd5t-exp-pc-list">${pcList}</ul>
                </details>
            </div>
            <div class="card-buttons">
                <button data-action="nd5t-distribute-xp"
                        data-xp-per-pc="${perPC}"
                        data-pc-uuids='${pcUuids.replace(/'/g, "&#39;")}'>
                    <i class="fas fa-gift"></i>
                    Distribute ${perPC.toLocaleString()} XP Each
                </button>
            </div>
        </div>
    `;

    const gmUsers = game.users.filter(u => u.isGM).map(u => u.id);

    await ChatMessage.create({
        content,
        whisper: gmUsers,
        speaker: { alias: "Combat XP Tracker" }
    });

    debug("Combat Exp Tracker | Summary posted:",
        totalXP, "total XP,", perPC, "per PC,", pcCount, "PCs");
}

// ── Button handling ──────────────────────────────────────────────────

/**
 * Bind a click handler to the "Distribute XP" button inside a rendered
 * chat message.  Shared between V13 (renderChatMessage) and V14
 * (renderChatMessageHTML) hooks.
 * @param {ChatMessage} message
 * @param {HTMLElement}  element
 */
function _bindDistributeButton(message, element) {
    const summary = element.querySelector(".nd5t-exp-summary");
    if (!summary) return;

    const button = summary.querySelector('button[data-action="nd5t-distribute-xp"]');
    if (!button || button.disabled) return;

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const xpPerPC = parseInt(button.dataset.xpPerPc, 10);
        const pcUuids = JSON.parse(button.dataset.pcUuids);

        debug("Combat Exp Tracker | Distribute button clicked",
            "| XP per PC:", xpPerPC,
            "| PCs:", pcUuids.length);

        let successCount = 0;
        for (const uuid of pcUuids) {
            const actor = fromUuidSync(uuid);
            if (!actor) {
                debug("Combat Exp Tracker | ✗ Could not resolve actor:", uuid);
                continue;
            }

            const currentXP = actor.system.details?.xp?.value ?? 0;
            const newXP = currentXP + xpPerPC;

            debug(`Combat Exp Tracker |   ${actor.name}: ${currentXP} → ${newXP} XP`);

            try {
                await actor.update({ "system.details.xp.value": newXP });
                successCount++;
            } catch (err) {
                console.error(`Nik's DnD5e Tweaks | Failed to update XP for ${actor.name}:`, err);
            }
        }

        // Disable the button
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-check"></i> XP Distributed';

        // Persist the disabled state in the message content
        _markMessageDistributed(message.id);

        ui.notifications.info(
            `Distributed ${xpPerPC.toLocaleString()} XP to ${successCount} character${successCount !== 1 ? "s" : ""}.`
        );
    });
}

/**
 * Update the chat message content to persist the "distributed" button state.
 * @param {string} messageId
 */
async function _markMessageDistributed(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;

    const updatedContent = message.content.replace(
        /<button\s+data-action="nd5t-distribute-xp"[\s\S]*?<\/button>/,
        '<button data-action="nd5t-distribute-xp" disabled><i class="fas fa-check"></i> XP Distributed</button>'
    );

    if (updatedContent === message.content) return;

    await message.update({ content: updatedContent });
    debug("Combat Exp Tracker | ✓ Message content updated with disabled button:", messageId);
}
