/**
 * Helper to dynamically center floating HUD banners (teleport, template, summon)
 * on the visible canvas area rather than the total window width.
 *
 * Accounts for the left scene controls toolbar (#controls) and the right sidebar (#sidebar),
 * and dynamically adjusts when the sidebar collapses/expands or the window resizes.
 */

/**
 * Calculates the horizontal center (in viewport pixels) of the visible canvas space.
 * @returns {number}
 */
export function getVisibleCanvasCenter() {
    const sidebar = document.getElementById("sidebar");
    const controls = document.getElementById("controls");

    const left = controls ? Math.max(0, controls.getBoundingClientRect().right) : 0;
    const right = sidebar ? Math.min(window.innerWidth, sidebar.getBoundingClientRect().left) : window.innerWidth;

    if (right <= left) return Math.round(window.innerWidth / 2);

    return Math.round((left + right) / 2);
}

/**
 * Attaches dynamic positioning to a HUD element so it stays centered on the visible canvas.
 * Sets the `--nd5t-hud-left` CSS variable in pixels on the element.
 * @param {HTMLElement} hudElement
 * @returns {() => void} Cleanup function to detach event listeners
 */
export function attachHudPositioning(hudElement) {
    if (!hudElement) return () => {};

    const update = () => {
        if (!hudElement.isConnected) return;
        const center = getVisibleCanvasCenter();
        hudElement.style.setProperty("--nd5t-hud-left", `${center}px`);
    };

    // Calculate position immediately
    update();

    const onResize = () => update();
    window.addEventListener("resize", onResize, { passive: true });

    // Handle Foundry sidebar collapse / expand transitions
    const sidebarHookId = Hooks.on("collapseSidebar", () => {
        update();
        setTimeout(update, 50);
        setTimeout(update, 260); // Foundry's sidebar transition is 250ms
    });

    return () => {
        window.removeEventListener("resize", onResize);
        if (sidebarHookId !== undefined) {
            Hooks.off("collapseSidebar", sidebarHookId);
        }
    };
}
