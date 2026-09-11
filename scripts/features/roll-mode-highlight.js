import { MODULE_ID, debug } from "../main.js";

/**
 * Roll Mode Highlight
 *
 * Applies a persistent visual highlight to the button in the D20 roll
 * configuration dialog that matches the system-calculated advantage mode
 * (e.g. Advantage for War Caster, Disadvantage from a condition).
 *
 * Problem: the system sets `autofocus` on the calculated default button, but
 * browser focus styling disappears the moment the player interacts with
 * anything in the dialog (situational bonus field, roll mode dropdown, etc.).
 *
 * Solution: hook into `renderD20RollConfigurationDialog` — which fires on
 * every render and partial re-render of the ApplicationV2 dialog — and
 * add `data-nd5t-calculated-mode` to the matching button. All visual
 * treatment is handled in CSS via style-class variants on the dialog element.
 *
 * The user-configured color is applied as an inline CSS custom property
 * (--nd5t-rmh-color) on the marked button, overriding the per-mode defaults
 * defined in the stylesheet.
 *
 * ADV_MODE values (CONFIG.Dice.D20Roll.ADV_MODE):
 *   NORMAL:       0
 *   ADVANTAGE:    1
 *   DISADVANTAGE: -1
 */
export function initRollModeHighlight() {
    Hooks.on("renderD20RollConfigurationDialog", _onRenderDialog);
    debug("Roll Mode Highlight | Initialized");
}

/**
 * Determine the calculated (system-recommended) action string from the
 * dialog's roll config, mirroring the logic of _prepareButtonsContext in
 * D20RollConfigurationDialog (d20-configuration-dialog.mjs).
 *
 * Returns null if the modes conflict across rolls (mixed advantage/disadvantage).
 *
 * @param {D20RollConfigurationDialog} app
 * @returns {"advantage"|"normal"|"disadvantage"|null}
 */
function _getCalculatedAction(app) {
    const ADV = CONFIG.Dice.D20Roll.ADV_MODE;
    let hasAdvantage = false;
    let hasDisadvantage = false;

    for (const roll of app.config.rolls ?? []) {
        const mode = roll.options?.advantageMode;
        if (mode === ADV.ADVANTAGE) hasAdvantage = true;
        else if (mode === ADV.DISADVANTAGE) hasDisadvantage = true;
    }

    if (hasAdvantage && !hasDisadvantage) return "advantage";
    if (!hasAdvantage && hasDisadvantage) return "disadvantage";
    if (!hasAdvantage && !hasDisadvantage) return "normal";
    return null; // conflicting modes — no clear recommendation
}

/**
 * Hook handler: fires after every render of D20RollConfigurationDialog
 * (including partial re-renders triggered by form changes).
 *
 * @param {D20RollConfigurationDialog} app
 * @param {HTMLElement} element
 */
function _onRenderDialog(app, element) {
    try {
        const enabled = game.settings.get(MODULE_ID, "enableRollModeHighlight");
        if (!enabled) return;

        const style = game.settings.get(MODULE_ID, "rollModeHighlightStyle");
        if (style === "none") return;

        const highlightNormal = game.settings.get(MODULE_ID, "rollModeHighlightNormal");
        const customColor     = game.settings.get(MODULE_ID, "rollModeHighlightColor");
        const calculatedAction = _getCalculatedAction(app);

        debug(`Roll Mode Highlight | Calculated action: ${calculatedAction}, style: ${style}, highlightNormal: ${highlightNormal}, color: ${customColor}`);

        // Clear any previously applied marks so re-renders start clean
        for (const btn of element.querySelectorAll("[data-nd5t-calculated-mode]")) {
            btn.removeAttribute("data-nd5t-calculated-mode");
            btn.style.removeProperty("--nd5t-rmh-color");
        }
        element.classList.remove(
            "nd5t-highlight-glow",
            "nd5t-highlight-border",
            "nd5t-highlight-badge",
            "nd5t-highlight-fill"
        );

        // No clear recommendation → nothing to highlight
        if (!calculatedAction) return;

        // Normal mode: only highlight if the user has opted in
        if (calculatedAction === "normal" && !highlightNormal) return;

        // Apply style class to the dialog root element
        element.classList.add(`nd5t-highlight-${style}`);

        // Mark the matching button and apply the user-chosen color
        const btn = element.querySelector(
            `.dialog-buttons button[data-action="${calculatedAction}"]`
        );
        if (btn) {
            btn.setAttribute("data-nd5t-calculated-mode", calculatedAction);
            // Inline custom property overrides the per-mode CSS defaults.
            // Falls back to CSS defaults if the setting value is empty.
            if (customColor) btn.style.setProperty("--nd5t-rmh-color", customColor);
            debug(`Roll Mode Highlight | Marked button "${calculatedAction}" with color ${customColor}`);
        }
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in Roll Mode Highlight:", err);
    }
}
