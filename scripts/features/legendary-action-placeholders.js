import { MODULE_ID, debug } from "../main.js";

export function initLegendaryActionPlaceholders() {
    Hooks.on("combatStart", async (combat) => {
        // Only run for the primary GM
        const activeGM = game.users.primaryGM ?? game.users.activeGM;
        if (!activeGM?.isSelf) return;

        // Check if the setting is enabled (in case it can be toggled without reload, although we use a direct hook here, 
        // usually we can check a setting directly if we don't hot-toggle the hook itself, or if we unhook it)
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

        const newCombatants = playerCombatants.map(pc => {
            return {
                name: game.i18n.localize("ND5T.LegendaryActionPlaceholder") || "Legendary Action Placeholder",
                hidden: false,
                img: "icons/svg/combat.svg",
                initiative: (pc.initiative || 0) - 0.01,

                flags: {
                    [MODULE_ID]: {
                        isLegendaryPlaceholder: true
                    }
                }
            };
        });

        debug(`Inserting ${newCombatants.length} legendary action placeholders for combat ${combat.id}.`);
        await combat.createEmbeddedDocuments("Combatant", newCombatants);
    });
}
