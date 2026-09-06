import { MODULE_ID, debug } from "../main.js";

let observer = null;

/**
 * Checks whether an element is or is inside a macro toolbar / hotbar.
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isMacroToolbar(element) {
    if (!element) return false;

    // Check against ui.hotbar element if available
    if (ui.hotbar?.element && (ui.hotbar.element === element || ui.hotbar.element.contains(element))) {
        return true;
    }

    const macroSelector = [
        "#hotbar",
        "#hotbar-directory",
        "#macro-list",
        "#macro-directory",
        "#macro-bar",
        "#action-bar",
        ".hotbar",
        ".macro-list",
        ".macro-bar",
        ".macro-toolbar",
        "[data-appid='hotbar']",
        "[id*='hotbar']",
        "[id*='macro-bar']",
        "[id*='macro-toolbar']",
        "[class*='hotbar']",
        "[class*='macro-bar']",
        "[class*='macro-toolbar']"
    ].join(", ");

    try {
        if (element.matches?.(macroSelector) || element.closest?.(macroSelector)) {
            return true;
        }
    } catch (e) {
        // Safe fallback
    }

    return false;
}

/**
 * Finds all toolbar list containers in scene controls.
 * @returns {HTMLElement[]} List of toolbar container elements
 */
function getToolbarContainers() {
    const selector = [
        "#scene-controls menu",
        "#scene-controls ol",
        "#scene-controls ul",
        "#scene-controls-layers",
        "#scene-controls-tools",
        "#controls ol",
        "#controls ul",
        "#controls menu",
        ".scene-control-layers",
        ".scene-control-tools",
        ".main-controls",
        ".sub-controls",
        ".control-tools"
    ].join(", ");

    const elements = Array.from(document.querySelectorAll(selector)).filter(el => !isMacroToolbar(el));

    // Fallback: search within root controls element if selector returned nothing
    if (elements.length === 0) {
        const root = document.getElementById("scene-controls") || document.getElementById("controls") || ui.controls?.element;
        if (root && !isMacroToolbar(root)) {
            return Array.from(root.children).filter(child => child.children.length > 0 && !isMacroToolbar(child));
        }
    }

    return elements;
}

/**
 * Recalculates and applies toolbar button limitation to all scene control toolbars.
 */
export function applyToolbarLimitation() {
    if (!game.settings?.get(MODULE_ID, "enableToolbarLimitation")) {
        resetToolbars();
        return;
    }

    // Clean up any macro toolbars if they were previously targeted
    const macroElements = document.querySelectorAll(".nd5t-scrollable-toolbar, #hotbar, #macro-list, .hotbar, .macro-bar, .macro-toolbar");
    for (const el of macroElements) {
        if (isMacroToolbar(el)) {
            resetSingleToolbar(el);
        }
    }

    const limit = game.settings.get(MODULE_ID, "toolbarButtonLimit") || 20;
    const toolbars = getToolbarContainers();

    for (const toolbar of toolbars) {
        if (isMacroToolbar(toolbar)) {
            resetSingleToolbar(toolbar);
            continue;
        }

        // Collect visible button items inside this toolbar container (excluding indicator arrows)
        const buttons = Array.from(toolbar.children).filter(child => {
            if (child.classList.contains("nd5t-toolbar-arrow")) return false;
            const style = window.getComputedStyle(child);
            return style.display !== "none" && style.visibility !== "hidden";
        });

        if (buttons.length > limit) {
            updateSingleToolbar(toolbar, buttons, limit);
        } else {
            resetSingleToolbar(toolbar);
        }
    }

    setupObserver();
}

/**
 * Updates a single toolbar container to cap its height to `limit` buttons (with a partial 50% peek on the last item)
 * and enables scrolling with directional arrow indicators.
 */
function updateSingleToolbar(toolbar, buttons, limit) {
    if (isMacroToolbar(toolbar) || !buttons || buttons.length <= limit) {
        resetSingleToolbar(toolbar);
        return;
    }

    const firstBtn = buttons[0];
    const prevBtn = limit >= 2 ? buttons[limit - 2] : buttons[0];
    const peekBtn = buttons[limit - 1]; // The limit-th button (index limit - 1)

    const firstRect = firstBtn.getBoundingClientRect();
    const prevRect = prevBtn.getBoundingClientRect();
    const peekRect = peekBtn.getBoundingClientRect();

    // Defer calculation if elements are not yet positioned in DOM layout
    if (firstRect.height === 0 || peekRect.height === 0) {
        requestAnimationFrame(() => updateSingleToolbar(toolbar, buttons, limit));
        return;
    }

    const computed = window.getComputedStyle(toolbar);
    const isHorizontal = computed.flexDirection === "row" || computed.flexDirection === "row-reverse";

    toolbar.classList.add("nd5t-scrollable-toolbar");

    if (isHorizontal) {
        const fullWidth = limit >= 2 ? Math.abs(prevRect.right - firstRect.left) : 0;
        const peekWidth = peekRect.width * 0.5;
        const paddingLeft = parseFloat(computed.paddingLeft) || 0;
        const paddingRight = parseFloat(computed.paddingRight) || 0;
        const maxW = Math.ceil(fullWidth + peekWidth + paddingLeft + paddingRight);

        toolbar.style.setProperty("max-width", `${maxW}px`, "important");
        toolbar.style.setProperty("overflow-x", "auto", "important");
        toolbar.style.setProperty("overflow-y", "hidden", "important");
        toolbar.style.setProperty("flex-wrap", "nowrap", "important");
        toolbar.style.removeProperty("max-height");
        toolbar.style.removeProperty("flex-direction");
    } else {
        // Calculate height up to previous button + 50% peek of the limit-th button
        const fullHeight = limit >= 2 ? Math.abs(prevRect.bottom - firstRect.top) : 0;
        const peekHeight = peekRect.height * 0.5;
        const paddingTop = parseFloat(computed.paddingTop) || 0;
        const paddingBottom = parseFloat(computed.paddingBottom) || 0;
        const maxH = Math.ceil(fullHeight + peekHeight + paddingTop + paddingBottom);

        toolbar.style.setProperty("max-height", `${maxH}px`, "important");
        toolbar.style.setProperty("overflow-y", "auto", "important");
        toolbar.style.setProperty("overflow-x", "hidden", "important");
        toolbar.style.setProperty("flex-direction", "column", "important");
        toolbar.style.setProperty("flex-wrap", "nowrap", "important");
        toolbar.style.removeProperty("max-width");
    }

    // Attach mini directional arrow indicators (top/bottom chevrons)
    attachArrowIndicators(toolbar);

    // Scroll active control or tool button into view if hidden
    const activeBtn = buttons.find(b => b.classList.contains("active") || b.getAttribute("aria-pressed") === "true" || b.classList.contains("selected"));
    if (activeBtn) {
        activeBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    debug(`Toolbar limited to ${limit} buttons with partial peek and arrows (Total: ${buttons.length})`);
}

/**
 * Attaches or updates sticky directional arrow indicators (up/down chevrons) on a scrollable toolbar.
 */
function attachArrowIndicators(toolbar) {
    let topArrow = toolbar.querySelector(".nd5t-toolbar-arrow-up");
    let bottomArrow = toolbar.querySelector(".nd5t-toolbar-arrow-down");

    if (!topArrow) {
        topArrow = document.createElement("div");
        topArrow.className = "nd5t-toolbar-arrow nd5t-toolbar-arrow-up";
        topArrow.innerHTML = '<i class="fas fa-chevron-up"></i>';
        topArrow.title = "Scroll Up";
        topArrow.addEventListener("click", (e) => {
            e.stopPropagation();
            toolbar.scrollBy({ top: -120, behavior: "smooth" });
        });
        toolbar.prepend(topArrow);
    }

    if (!bottomArrow) {
        bottomArrow = document.createElement("div");
        bottomArrow.className = "nd5t-toolbar-arrow nd5t-toolbar-arrow-down";
        bottomArrow.innerHTML = '<i class="fas fa-chevron-down"></i>';
        bottomArrow.title = "Scroll Down";
        bottomArrow.addEventListener("click", (e) => {
            e.stopPropagation();
            toolbar.scrollBy({ top: 120, behavior: "smooth" });
        });
        toolbar.append(bottomArrow);
    }

    const updateArrows = () => {
        const canScrollUp = toolbar.scrollTop > 4;
        const canScrollDown = toolbar.scrollTop + toolbar.clientHeight < toolbar.scrollHeight - 4;

        topArrow.style.opacity = canScrollUp ? "1" : "0";
        topArrow.style.pointerEvents = canScrollUp ? "auto" : "none";

        bottomArrow.style.opacity = canScrollDown ? "1" : "0";
        bottomArrow.style.pointerEvents = canScrollDown ? "auto" : "none";
    };

    if (!toolbar.dataset.scrollBound) {
        toolbar.dataset.scrollBound = "true";
        toolbar.addEventListener("scroll", updateArrows);
    }

    updateArrows();
}

/**
 * Resets a single toolbar container to default unconstrained size and removes indicator arrows.
 */
function resetSingleToolbar(toolbar) {
    if (!toolbar) return;
    toolbar.style.removeProperty("max-height");
    toolbar.style.removeProperty("max-width");
    toolbar.style.removeProperty("overflow-y");
    toolbar.style.removeProperty("overflow-x");
    toolbar.style.removeProperty("flex-direction");
    toolbar.style.removeProperty("flex-wrap");
    toolbar.classList.remove("nd5t-scrollable-toolbar");

    const topArrow = toolbar.querySelector(".nd5t-toolbar-arrow-up");
    const bottomArrow = toolbar.querySelector(".nd5t-toolbar-arrow-down");
    if (topArrow) topArrow.remove();
    if (bottomArrow) bottomArrow.remove();
}

/**
 * Resets all toolbars in scene controls to default.
 */
export function resetToolbars() {
    const toolbars = getToolbarContainers();
    for (const toolbar of toolbars) {
        resetSingleToolbar(toolbar);
    }
    const macroElements = document.querySelectorAll(".nd5t-scrollable-toolbar, #hotbar, #macro-list, .hotbar, .macro-bar, .macro-toolbar");
    for (const el of macroElements) {
        if (isMacroToolbar(el)) {
            resetSingleToolbar(el);
        }
    }
}

/**
 * Sets up a MutationObserver on the scene controls root container to recalculate
 * whenever sub-tools or active control layers change dynamically.
 */
function setupObserver() {
    if (observer) return;
    const root = document.getElementById("scene-controls") || document.getElementById("controls") || ui.controls?.element;
    if (!root) return;

    observer = new MutationObserver(() => {
        // Disconnect temporarily to avoid triggering on our own style/DOM mutations
        observer.disconnect();
        applyToolbarLimitation();
        // Re-observe
        const activeRoot = document.getElementById("scene-controls") || document.getElementById("controls") || ui.controls?.element;
        if (activeRoot) {
            observer.observe(activeRoot, { childList: true, subtree: true });
        } else {
            observer = null;
        }
    });

    observer.observe(root, { childList: true, subtree: true });
}

let initialized = false;

/**
 * Initializes the Toolbar Limitation feature hooks and listeners.
 */
export function initToolbarLimitation() {
    if (initialized) return;
    initialized = true;

    // Recalculate on Scene Controls render
    Hooks.on("renderSceneControls", () => {
        applyToolbarLimitation();
    });

    // Support ApplicationV2 Scene Controls rendering
    Hooks.on("renderApplicationV2", (app) => {
        if (app.constructor?.name === "SceneControls" || app instanceof (CONFIG.ui?.controls?.constructor ?? Object)) {
            applyToolbarLimitation();
        }
    });

    // Initial check when canvas/UI is ready
    Hooks.on("canvasReady", () => {
        applyToolbarLimitation();
    });

    // Recalculate layout on window resize
    window.addEventListener("resize", () => {
        if (game.settings?.get(MODULE_ID, "enableToolbarLimitation")) {
            applyToolbarLimitation();
        }
    });
}
