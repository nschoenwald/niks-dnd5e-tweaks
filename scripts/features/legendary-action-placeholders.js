import { MODULE_ID, debug } from "../main.js";

const DEFAULT_ICON = "icons/svg/combat.svg";

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

            // Find all player characters or friendly creatures
            const playerCombatants = combat.combatants.filter(c => c.actor?.type === "character" || c.token?.disposition === 1);

            if (!playerCombatants.length) return;

            const configuredIcon = game.settings.get(MODULE_ID, "legendaryActionPlaceholderIcon");
            const img = await _resolveIcon(configuredIcon);

            const newCombatants = playerCombatants.map(pc => {
                return {
                    name: game.i18n.localize("ND5T.LegendaryActionPlaceholder") || "Legendary Action Placeholder",
                    hidden: !game.settings.get(MODULE_ID, "showLegendaryActionPlaceholders"),
                    img,
                    initiative: (pc.initiative || 0) - 0.001,

                    flags: {
                        [MODULE_ID]: {
                            isLegendaryPlaceholder: true
                        }
                    }
                };
            });

            debug(`Inserting ${newCombatants.length} legendary action placeholders for combat ${combat.id}.`);
            queueMicrotask(async () => {
                try {
                    await combat.createEmbeddedDocuments("Combatant", newCombatants);
                } catch (err) {
                    console.error(`Nik's DnD5e Tweaks | Failed to create legendary action placeholder combatants:`, err);
                }
            });
        } catch (err) {
            console.error(`Nik's DnD5e Tweaks | Error in combatStart hook for Legendary Action Placeholders:`, err);
        }
    });
}
