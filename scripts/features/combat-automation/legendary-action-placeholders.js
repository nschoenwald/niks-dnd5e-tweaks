/**
 * Feature: Legendary Action Placeholders
 * Description: Inserts placeholder turns in the combat tracker after player turns to track legendary action usage when legendary creatures are present.
 *
 * @introduced v14.3.1
 */
import { MODULE_ID, debug } from "../../main.js";

const DEFAULT_ICON = "icons/svg/combat.svg";
const PLACEHOLDER_OFFSET = 0.0001;
const TIE_BREAKER_STEP = 0.0002;

/**
 * Preloads an image path using HTMLImageElement to test whether it can be loaded.
 * @param {string} src
 * @returns {Promise<boolean>}
 */
function _canLoadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = src;
    });
}

/**
 * Validate that an icon path exists and can be rendered by the browser.
 * Falls back to DEFAULT_ICON for any error (404, 403, CORS, network failure, or corrupt/invalid image file).
 * @param {string} path
 * @returns {Promise<string>}
 */
async function _resolveIcon(path) {
    if (!path || typeof path !== "string") return DEFAULT_ICON;
    const trimmed = path.trim();
    if (!trimmed || trimmed === DEFAULT_ICON) return DEFAULT_ICON;

    try {
        const canLoad = await _canLoadImage(trimmed);
        if (canLoad) return trimmed;
    } catch (err) {
        debug(`Legendary Action Placeholders | Custom icon "${trimmed}" failed validation:`, err);
    }

    debug(`Legendary Action Placeholders | Custom icon "${trimmed}" could not be loaded. Falling back to default icon.`);
    return DEFAULT_ICON;
}

export function initLegendaryActionPlaceholders() {
    Hooks.on("combatStart", async (combat) => {
        try {
            // Only run for the primary GM
            const activeGM = game.users.primaryGM ?? game.users.activeGM;
            if (!activeGM?.isSelf) return;

            // Check if the setting is enabled
            if (!game.settings.get(MODULE_ID, "enableLegendaryActionPlaceholders")) return;

            // Check if there is at least one combatant with legendary actions
            const hasLegendary = combat.combatants.some(c => c.actor?.system?.resources?.legact?.max > 0);

            if (!hasLegendary) {
                debug(`No actors with legendary actions found in combat ${combat.id}.`);
                return;
            }

            // If placeholders already exist, do not recreate them
            const alreadyHasPlaceholders = combat.combatants.some(c => c.getFlag(MODULE_ID, "isLegendaryPlaceholder"));
            if (alreadyHasPlaceholders) {
                debug(`Combat ${combat.id} already has legendary action placeholders.`);
                return;
            }

            // Find all player characters or friendly creatures, preserving current turn order from combat.turns
            const playerCombatants = (combat.turns ?? []).filter(c => {
                if (c.getFlag(MODULE_ID, "isLegendaryPlaceholder")) return false;
                const isPC = c.actor?.type === "character";
                const isFriendly = c.token?.disposition === CONST.TOKEN_DISPOSITIONS?.FRIENDLY || c.token?.disposition === 1;
                return isPC || isFriendly;
            });

            if (!playerCombatants.length) return;

            // Detect and prepare minimal tie breaker updates for tied initiatives among player combatants
            const roundKey = val => Number(Number(val).toFixed(4));
            const initiativeCounts = new Map();
            for (const pc of playerCombatants) {
                if (!Number.isNumeric(pc.initiative)) continue;
                const key = roundKey(pc.initiative);
                initiativeCounts.set(key, (initiativeCounts.get(key) ?? 0) + 1);
            }

            const seenCounts = new Map();
            const combatantUpdates = [];
            const pcEffectiveInitiatives = new Map();

            for (const pc of playerCombatants) {
                const baseInit = pc.initiative;
                if (!Number.isNumeric(baseInit)) {
                    pcEffectiveInitiatives.set(pc.id, 0);
                    continue;
                }

                const key = roundKey(baseInit);
                const totalWithInit = initiativeCounts.get(key) ?? 0;
                if (totalWithInit > 1) {
                    const tieIndex = seenCounts.get(key) ?? 0;
                    seenCounts.set(key, tieIndex + 1);

                    if (tieIndex > 0) {
                        // Apply an additional minimal tie breaker to subsequent tied characters
                        // to ensure each has a distinct initiative strictly ordered after previous tied PCs
                        const tieBreaker = Number((tieIndex * TIE_BREAKER_STEP).toFixed(5));
                        const newInitiative = Number((baseInit - tieBreaker).toFixed(5));
                        combatantUpdates.push({
                            _id: pc.id,
                            initiative: newInitiative
                        });
                        pcEffectiveInitiatives.set(pc.id, newInitiative);
                        continue;
                    }
                }

                pcEffectiveInitiatives.set(pc.id, baseInit);
            }

            const configuredIcon = game.settings.get(MODULE_ID, "legendaryActionPlaceholderIcon");
            const img = await _resolveIcon(configuredIcon);

            const newCombatants = playerCombatants.map(pc => {
                const effectiveInit = pcEffectiveInitiatives.get(pc.id) ?? pc.initiative ?? 0;
                return {
                    name: game.i18n.localize("ND5T.LegendaryActionPlaceholder") || "Legendary Action Placeholder",
                    hidden: !game.settings.get(MODULE_ID, "showLegendaryActionPlaceholders"),
                    img,
                    initiative: Number((effectiveInit - PLACEHOLDER_OFFSET).toFixed(5)),
                    flags: {
                        [MODULE_ID]: {
                            isLegendaryPlaceholder: true
                        }
                    }
                };
            });

            queueMicrotask(async () => {
                try {
                    if (!combat || combat.destroyed || !game.combats?.has(combat.id)) return;

                    // First give an additional minimal tie breaker to their initiative if needed
                    if (combatantUpdates.length > 0) {
                        debug(`Legendary Action Placeholders | Applying minimal initiative tie breakers to ${combatantUpdates.length} player combatants in combat ${combat.id}.`);
                        await combat.updateEmbeddedDocuments("Combatant", combatantUpdates);
                    }

                    // Then place the legendary action placeholders
                    debug(`Legendary Action Placeholders | Inserting ${newCombatants.length} placeholders for combat ${combat.id}.`);
                    await combat.createEmbeddedDocuments("Combatant", newCombatants);
                } catch (err) {
                    console.error(`Nik's DnD5e Tweaks | Failed to process legendary action placeholders:`, err);
                }
            });
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Error in combatStart hook for Legendary Action Placeholders:`, err);
        }
    });
}
