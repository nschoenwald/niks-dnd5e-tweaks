/**
 * Feature: Roll Dialog Off-Screen Patch
 * Description: Roll configuration dialogs that grow after they open are moved back up so their buttons stay on
 *              screen.
 *
 * @introduced v14.80.1
 */
import { MODULE_ID, debug } from "../../context.js";

/**
 * Fix: Roll Dialog Buttons Cut Off at the Bottom of the Screen
 * ---------------------------------------------------------------------------
 * dnd5e opens roll dialogs at the click (`top: event.clientY - 80`). Foundry's `ApplicationV2#_updatePosition`
 * keeps a window inside the screen, but only with the height it has when it is positioned, right after the first
 * render. A dialog that grows afterwards keeps its top, so its bottom (the roll buttons) ends up below the screen
 * until it is dragged up. Causes of later growth: the dice images in the formulas part loading after the first
 * layout (uncached images have no height yet, so it happens "sometimes"), partial re-renders when the form
 * changes, and content other modules add after a delay. Seen with D&D 5e 6.0.6 / 6.1.0 on Foundry 14, not fixed
 * upstream, so not version-gated.
 *
 * A ResizeObserver on every RollConfigurationDialog (attack, damage, checks, saves…) calls `setPosition()` when
 * the dialog's bottom edge passes the bottom of the screen. That runs Foundry's own clamping again with the
 * current height. Size changes are the only trigger, so a dialog the user dragged somewhere stays there.
 */

/**
 * Move a dialog back inside the screen if its bottom edge is below it.
 * @param {ApplicationV2} app
 */
function _keepOnScreen(app) {
    const element = app.element;
    if (!element?.isConnected || app.minimized) return;
    if (app.state !== foundry.applications.api.ApplicationV2.RENDER_STATES.RENDERED) return;
    const viewportHeight = element.ownerDocument.documentElement.clientHeight;
    if (element.getBoundingClientRect().bottom <= viewportHeight + 1) return;
    app.setPosition();
    debug(`Roll Dialog Off-Screen Patch | Moved ${app.id} back on screen`);
}

/**
 * renderRollConfigurationDialog: watch the dialog's size from its first render until it closes.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 * @param {object} _context
 * @param {object} options
 */
function _onRenderRollDialog(app, element, _context, options) {
    try {
        if (!options?.isFirstRender || (typeof ResizeObserver !== "function")) return;
        const observer = new ResizeObserver(() => _keepOnScreen(app));
        observer.observe(element);
        app.addEventListener("close", () => observer.disconnect(), { once: true });
    } catch (err) {
        console.error(`${MODULE_ID} | Roll Dialog Off-Screen Patch failed`, err);
    }
}

export function initFixRollDialogOffscreen() {
    Hooks.on("renderRollConfigurationDialog", _onRenderRollDialog);
}
