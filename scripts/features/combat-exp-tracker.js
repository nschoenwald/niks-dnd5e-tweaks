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
 * The feature is gated by the `enableCombatExpTracker` setting.
 */

// ── Tracking state ───────────────────────────────────────────────────

/**
 * Map of actor UUID → { name, xp } for hostile NPCs involved in combat.
 * @type {Map<string, {name: string, xp: number}>}
 */
const trackedNPCs = new Map();

/**
 * Map of actor UUID → { name } for player characters involved in combat.
 * @type {Map<string, {name: string}>}
 */
const trackedPCs = new Map();

/**
 * The ID of the combat we are currently tracking, to avoid cross-contamination.
 * @type {string|null}
 */
let trackedCombatId = null;

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

// ── Combat lifecycle hooks ───────────────────────────────────────────

/**
 * Snapshot all combatants at the start of combat.
 * @param {Combat} combat    The combat that just started.
 */
function _onCombatStart(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "enableCombatExpTracker")) return;

    _clearState();
    trackedCombatId = combat.id;

    for (const combatant of combat.combatants) {
        _trackCombatant(combatant);
    }

    debug("Combat Exp Tracker | Combat started — tracked",
        trackedNPCs.size, "hostile NPC(s) and",
        trackedPCs.size, "PC(s)");
}

/**
 * Track a combatant added mid-combat.
 * @param {Combatant} combatant   The newly created combatant.
 */
function _onCreateCombatant(combatant) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "enableCombatExpTracker")) return;
    if (!trackedCombatId || combatant.combat?.id !== trackedCombatId) return;

    _trackCombatant(combatant);
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
    if (combat.id !== trackedCombatId) return;

    debug("Combat Exp Tracker | Combat ended — building XP summary");

    // Only post if there are both NPCs and PCs
    if (trackedNPCs.size === 0 || trackedPCs.size === 0) {
        debug("Combat Exp Tracker | Skipping summary: no hostile NPCs or no PCs tracked");
        _clearState();
        return;
    }

    await _sendExpSummary();
    _clearState();
}

// ── Combatant classification ─────────────────────────────────────────

/**
 * Classify a combatant and add it to the appropriate tracking map.
 * - Hostile NPCs (disposition HOSTILE, actor type "npc") → trackedNPCs
 * - Player characters (actor type "character") → trackedPCs
 * @param {Combatant} combatant
 */
function _trackCombatant(combatant) {
    const actor = combatant.actor;
    if (!actor) return;

    const uuid = actor.uuid;

    if (actor.type === "character") {
        if (!trackedPCs.has(uuid)) {
            trackedPCs.set(uuid, { name: actor.name });
            debug("Combat Exp Tracker |   PC:", actor.name, `(${uuid})`);
        }
    } else if (actor.type === "npc") {
        // Check disposition — only track hostile NPCs
        const disposition = combatant.token?.disposition
            ?? actor.prototypeToken?.disposition
            ?? CONST.TOKEN_DISPOSITIONS.HOSTILE;

        if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) {
            if (!trackedNPCs.has(uuid)) {
                const xp = actor.system.details?.xp?.value ?? 0;
                trackedNPCs.set(uuid, { name: actor.name, xp });
                debug("Combat Exp Tracker |   Hostile NPC:", actor.name,
                    `| XP: ${xp}`, `(${uuid})`);
            }
        }
    }
}

/**
 * Reset all tracking state.
 */
function _clearState() {
    trackedNPCs.clear();
    trackedPCs.clear();
    trackedCombatId = null;
}

// ── XP summary message ──────────────────────────────────────────────

/**
 * Build and send the GM-whispered XP summary chat message.
 */
async function _sendExpSummary() {
    const totalXP = [...trackedNPCs.values()].reduce((sum, npc) => sum + npc.xp, 0);
    const pcCount = trackedPCs.size;
    const perPC = Math.floor(totalXP / pcCount);

    // Build NPC table rows
    const npcRows = [...trackedNPCs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(npc => `
            <tr>
                <td>${npc.name}</td>
                <td class="nd5t-exp-xp-cell">${npc.xp.toLocaleString()} XP</td>
            </tr>
        `).join("");

    // Build PC list
    const pcList = [...trackedPCs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(pc => `<li>${pc.name}</li>`)
        .join("");

    // Serialise PC UUIDs for the button
    const pcUuids = JSON.stringify([...trackedPCs.keys()]);

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
