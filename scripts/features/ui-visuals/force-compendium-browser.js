/**
 * Feature: Force Compendium Browser
 * Description: Automatically redirects non-GM players clicking the Compendium sidebar tab to open the DnD5e Compendium Browser, with optional Shift-click bypass for standard pack lists.
 *
 * @introduced v13.0.1
 * @updated v14.57.0 (Removed a duplicate render hook)
 */
import { getSetting, debug } from "../../main.js";

export function initForceCompendiumBrowser() {
    // Optimization: Don't attach a hook at all if the current user is a GM.
    if (game.user.isGM) return;

    const interceptCompendiumClick = (sidebar) => {
        if (!getSetting("enableForceCompendiumBrowser")) return;
        const compendiumButton = sidebar.querySelector('#sidebar-tabs [data-tab="compendium"]');

        if (compendiumButton) {
            if (compendiumButton.dataset.nd5tForced) return;
            compendiumButton.dataset.nd5tForced = "true";

            compendiumButton.addEventListener("click", (event) => {
                if (event.shiftKey && getSetting("allowShiftClickCompendiumSidebar")) {
                    debug("Shift-click detected: bypassing forced compendium browser.");
                    return; // Allow the default behavior (opening the standard tab)
                }

                debug("Intercepting Compendium tab click to force browser");
                event.stopPropagation();
                event.preventDefault();

                const BrowserClass = globalThis.dnd5e?.applications?.CompendiumBrowser
                    ?? game.dnd5e?.applications?.CompendiumBrowser;
                if (BrowserClass) {
                    new BrowserClass().render({ force: true });
                } else {
                    ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
                }
            }, { capture: true }); 
        }
    };

    Hooks.on("renderSidebar", (app, html) => interceptCompendiumClick(html));
}

