import { MODULE_ID, debug, log } from "../main.js";

const BREAK_CONCENTRATION_STATUSES = new Set([
    "incapacitated",
    "unconscious",
    "dead",
    "paralyzed",
    "petrified",
    "stunned"
]);

/**
 * Auto-End Concentration
 * Automatically ends all concentration effects from a token when it
 * receives conditions that break concentration.
 */
export function initAutoEndConcentration() {
    Hooks.on("createActiveEffect", _onActiveEffectChanged);
    Hooks.on("updateActiveEffect", _onActiveEffectChanged);
    debug("Auto-End Concentration | Initialized");
}

async function _onActiveEffectChanged(...args) {
    const effect = args[0];
    const userId = args[args.length - 1];

    if (game.user.id !== userId) return;
    if (!game.settings.get(MODULE_ID, "enableAutoEndConcentration")) return;
    
    debug(`Auto-End Concentration | _onActiveEffectChanged triggered for effect: ${effect.name}`);

    const actor = effect.parent;
    if (!actor || !(actor instanceof Actor)) return;

    // Defer slightly to ensure actor statuses are fully updated
    setTimeout(async () => {
        let breaksConcentration = false;
        for (const status of BREAK_CONCENTRATION_STATUSES) {
            if (actor.statuses.has(status)) {
                breaksConcentration = true;
                break;
            }
        }

        debug(`Auto-End Concentration | Breaks Concentration: ${breaksConcentration} | Actor Statuses: ${Array.from(actor.statuses).join(", ")}`);

        if (breaksConcentration) {
            // Check if the actor has any concentration effect
            const hasConc = actor.effects.some(e => e.statuses.has("concentrating") || e.getFlag("dnd5e", "type") === "concentration");
            
            debug(`Auto-End Concentration | Has Concentration: ${hasConc}`);
            if (!hasConc) {
                // Log all effects to see what we're missing
                debug(`Auto-End Concentration | Actor Effects: ${JSON.stringify(actor.effects.map(e => ({ name: e.name, statuses: Array.from(e.statuses), flags: e.flags })))}`);
            }
            
            if (hasConc) {
                let success = false;
                if (typeof actor.endConcentration === "function") {
                    try {
                        debug(`Auto-End Concentration | ${actor.name} gained a status that breaks concentration. Ending concentration.`);
                        await actor.endConcentration();
                        success = true;
                    } catch (e) {
                        console.error(`Nik's DnD5e Tweaks | Failed to end concentration for ${actor.name}:`, e);
                    }
                } else {
                    // Fallback for older versions: manually delete concentration effects
                    const concEffects = actor.effects.filter(e => e.statuses.has("concentrating") || e.getFlag("dnd5e", "type") === "concentration");
                    if (concEffects.length > 0) {
                        debug(`Auto-End Concentration | ${actor.name} gained a status that breaks concentration. Deleting concentration effects.`);
                        await actor.deleteEmbeddedDocuments("ActiveEffect", concEffects.map(e => e.id));
                        success = true;
                    }
                }

                if (success) {
                    ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor: actor }),
                        content: `<p><strong>${actor.name}</strong> lost concentration due to <strong>${effect.name}</strong>.</p>`
                    });
                }
            }
        }
    }, 100);
}
