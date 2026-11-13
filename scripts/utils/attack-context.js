/**
 * Utility: Attack Context
 * Description: The attacker's token and the targets of an attack roll (dnd5e or midi-qol), and a helper that adds
 *              Advantage / Disadvantage to a roll process configuration. Shared by Prone Rules and
 *              Condition Advantage & Disadvantage.
 *
 * @introduced v14.80.0
 */

/**
 * The attacker's token on the viewed scene.
 * @param {Actor5e} actor
 * @param {object|null} workflow  midi-qol workflow, if any.
 * @returns {Token|null}
 */
export function attackerToken(actor, workflow) {
    const fromWorkflow = workflow?.token?.object ?? workflow?.token;
    if (fromWorkflow?.document) return fromWorkflow;
    if (actor.isToken) return actor.token?.object ?? null;
    const tokens = actor.getActiveTokens();
    return tokens.find(t => t.controlled) ?? tokens[0] ?? null;
}

/**
 * The attack's targets as Token placeables.
 * @param {object|null} workflow  midi-qol workflow, if any.
 * @returns {Token[]}
 */
export function attackTargets(workflow) {
    const source = workflow?.targets?.size ? workflow.targets : game.user.targets;
    return Array.from(source ?? [], t => t?.object ?? t).filter(t => t?.document);
}

/**
 * The single target of an attack, or null when there is none or several (one roll can't carry a different mode
 * for each of them).
 * @param {object|null} workflow  midi-qol workflow, if any.
 * @returns {Token|null}
 */
export function singleAttackTarget(workflow) {
    if (!canvas?.ready) return null;
    const targets = attackTargets(workflow);
    return targets.length === 1 ? targets[0] : null;
}

/**
 * Add Advantage and / or Disadvantage to a roll process configuration and its rolls. dnd5e cancels the two out
 * when both apply, and keeps a mode another source already set.
 * @param {object} config  Roll process configuration (from a dnd5e.preRoll… hook).
 * @param {{advantage?: boolean, disadvantage?: boolean}} modes
 */
export function addRollModes(config, { advantage = false, disadvantage = false } = {}) {
    if (!advantage && !disadvantage) return;
    if (advantage) config.advantage = true;
    if (disadvantage) config.disadvantage = true;
    for (const roll of config.rolls ?? []) {
        roll.options ??= {};
        if (advantage) roll.options.advantage = true;
        if (disadvantage) roll.options.disadvantage = true;
    }
}
