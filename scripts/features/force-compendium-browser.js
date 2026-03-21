import { debug } from "../main.js";

export function initForceCompendiumBrowser() {
    // Optimization: Don't attach a hook at all if the current user is a GM.
    if (game.user.isGM) return;

    Hooks.on("renderSidebar", (app, html, data) => {
        if (!game.settings.get("niks-dnd5e-tweaks", "enableForceCompendiumBrowser")) return;
        const sidebar = html[0] || html;
        const compendiumButton = sidebar.querySelector('#sidebar-tabs [data-tab="compendium"]');

        if (compendiumButton) {
            compendiumButton.addEventListener("click", (event) => {
                debug("Intercepting Compendium tab click to force browser");
                event.stopPropagation();
                event.preventDefault();

                if (globalThis.dnd5e?.applications?.CompendiumBrowser) {
                    new globalThis.dnd5e.applications.CompendiumBrowser().render(true);
                } else if (game.dnd5e?.applications?.CompendiumBrowser) {
                    new game.dnd5e.applications.CompendiumBrowser().render(true);
                } else {
                    ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
                }
            }, { capture: true }); 
        }
    });
}

