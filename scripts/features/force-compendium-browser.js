import { MODULE_ID, debug } from "../main.js";

export function initForceCompendiumBrowser() {
    // Optimization: Don't attach a hook at all if the current user is a GM.
    if (game.user.isGM) return;

    const interceptCompendiumClick = (sidebar) => {
        if (!game.settings.get(MODULE_ID, "enableForceCompendiumBrowser")) return;
        const compendiumButton = sidebar.querySelector('#sidebar-tabs [data-tab="compendium"]');

        if (compendiumButton) {
            if (compendiumButton.dataset.nd5tForced) return;
            compendiumButton.dataset.nd5tForced = "true";

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
    };

    Hooks.on("renderSidebar", (app, html, data) => {
        const sidebar = html[0] || html;
        interceptCompendiumClick(sidebar);
    });
    // Also support AppV2 sidebar rendering (V14+)
    Hooks.on("renderApplicationV2", (app, html) => {
        if (app.id === "sidebar" || app.constructor?.name === "Sidebar") {
            const sidebar = html[0] || html;
            interceptCompendiumClick(sidebar);
        }
    });
}

