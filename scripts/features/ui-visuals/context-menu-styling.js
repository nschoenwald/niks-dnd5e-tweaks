/**
 * Feature: Context Menu Styling
 * Description: Color-codes destructive (Delete in red) and additive (Duplicate in green) actions in right-click context menus with full light and dark mode support.
 *
 * @introduced v14.34.0
 */
import { MODULE_ID, debug, isFeatureActive } from "../../main.js";

/**
 * Initialize Context Menu Styling patch.
 *
 * Wraps `foundry.applications.ux.ContextMenu.prototype._onRenderEntries`,
 * `_setFixedPosition`, and `_onRender` to detect actions and dynamically
 * adapt styling to the menu's actual rendered background luminance.
 */
export function initContextMenuStyling() {
    const ContextMenuClass = foundry.applications.ux.ContextMenu;
    if (!ContextMenuClass?.prototype) {
        console.warn("Nik's DnD5e Tweaks | ContextMenu class not found — skipping context menu styling.");
        return;
    }

    const originalOnRenderEntries = ContextMenuClass.prototype._onRenderEntries;
    const originalSetFixedPosition = ContextMenuClass.prototype._setFixedPosition;
    const originalOnRender = ContextMenuClass.prototype._onRender;

    // 1. Tag menu items as they are rendered into the menu DOM
    ContextMenuClass.prototype._onRenderEntries = async function(menu, options = {}) {
        await originalOnRenderEntries?.call(this, menu, options);

        try {
            if (!isFeatureActive("enableContextMenuStyling", "clientEnableContextMenuStyling")) return;
            _applyContextMenuStyling(this, menu);
            _updateMenuTheme(this.element ?? menu.closest("#context-menu"));
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Error applying context menu styling:", err);
        }
    };

    // 2. Once placed in the DOM via setFixedPosition, measure background luminance
    ContextMenuClass.prototype._setFixedPosition = function(menu, target, options = {}) {
        const result = originalSetFixedPosition.call(this, menu, target, options);
        try {
            if (isFeatureActive("enableContextMenuStyling", "clientEnableContextMenuStyling")) {
                _updateMenuTheme(menu);
            }
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Error updating context menu theme after positioning:", err);
        }
        return result;
    };

    // 3. Final verification after animation / full render
    ContextMenuClass.prototype._onRender = async function(options = {}) {
        await originalOnRender?.call(this, options);
        try {
            if (isFeatureActive("enableContextMenuStyling", "clientEnableContextMenuStyling")) {
                _updateMenuTheme(this.element);
            }
        } catch (err) {
            console.error("Nik's DnD5e Tweaks | Error verifying context menu theme in onRender:", err);
        }
    };

    debug("Context Menu Styling | Initialized");
}

/**
 * Scan and tag Delete and Duplicate actions in the rendered context menu.
 *
 * @param {foundry.applications.ux.ContextMenu} contextMenu
 * @param {HTMLMenuElement} menu
 */
function _applyContextMenuStyling(contextMenu, menu) {
    if (!menu) return;

    // Localized comparison terms (normalized lowercase)
    const deleteTerms = new Set([
        "delete",
        "remove",
        (game.i18n.localize("SIDEBAR.Delete") || "").toLowerCase(),
        (game.i18n.localize("DOCUMENT.Delete") || "").toLowerCase(),
        (game.i18n.localize("DND5E.ContextMenuActionDelete") || "").toLowerCase()
    ].filter(Boolean));

    const duplicateTerms = new Set([
        "duplicate",
        "copy",
        "clone",
        (game.i18n.localize("SIDEBAR.Duplicate") || "").toLowerCase(),
        (game.i18n.localize("DOCUMENT.Duplicate") || "").toLowerCase(),
        (game.i18n.localize("DND5E.ContextMenuActionDuplicate") || "").toLowerCase(),
        (game.i18n.localize("COMPENDIUM.Duplicate.Option") || "").toLowerCase()
    ].filter(Boolean));

    const violetTerms = new Set([
        "make private",
        "reveal to everyone",
        "reveal message",
        "conceal message",
        "conceal",
        "private",
        (game.i18n.localize("CHAT.RevealMessage") || "").toLowerCase(),
        (game.i18n.localize("CHAT.ConcealMessage") || "").toLowerCase()
    ].filter(Boolean));

    // 1. Tag based on menuItems metadata if available
    if (Array.isArray(contextMenu.menuItems)) {
        for (const item of contextMenu.menuItems) {
            const el = item.element;
            if (!el) continue;

            const labelKey = (item.label ?? item.name ?? "").toLowerCase();
            const iconClass = (typeof item.icon === "string" ? item.icon : "").toLowerCase();
            const text = (el.querySelector("span")?.textContent ?? "").trim().toLowerCase();

            if (_isDeleteAction(labelKey, iconClass, text, deleteTerms)) {
                el.classList.add("nd5t-context-delete");
                el.dataset.nd5tAction = "delete";
            } else if (_isDuplicateAction(labelKey, iconClass, text, duplicateTerms)) {
                el.classList.add("nd5t-context-duplicate");
                el.dataset.nd5tAction = "duplicate";
            } else if (_isVioletAction(labelKey, iconClass, text, violetTerms)) {
                el.classList.add("nd5t-context-violet");
                el.dataset.nd5tAction = "violet";
            }
        }
    }

    // 2. Fallback scan on any rendered .context-item in the DOM not yet tagged
    for (const el of menu.querySelectorAll(".context-item:not([data-nd5t-action])")) {
        const iconEl = el.querySelector("i, [class*='fa-']");
        const iconClass = (iconEl?.className ?? "").toLowerCase();
        const text = (el.querySelector("span")?.textContent ?? el.textContent ?? "").trim().toLowerCase();

        if (_isDeleteAction("", iconClass, text, deleteTerms)) {
            el.classList.add("nd5t-context-delete");
            el.dataset.nd5tAction = "delete";
        } else if (_isDuplicateAction("", iconClass, text, duplicateTerms)) {
            el.classList.add("nd5t-context-duplicate");
            el.dataset.nd5tAction = "duplicate";
        } else if (_isVioletAction("", iconClass, text, violetTerms)) {
            el.classList.add("nd5t-context-violet");
            el.dataset.nd5tAction = "violet";
        }
    }
}

/**
 * Dynamically detects the actual background luminance of the rendered context menu
 * and applies `.nd5t-theme-dark` or `.nd5t-theme-light` to ensure action text colors
 * always have high contrast against the actual background.
 *
 * @param {HTMLElement} menuEl - The `<nav id="context-menu">` element.
 */
function _updateMenuTheme(menuEl) {
    if (!menuEl || !menuEl.isConnected) return;

    const isDark = _isMenuBackgroundDark(menuEl);

    menuEl.classList.toggle("nd5t-theme-dark", isDark);
    menuEl.classList.toggle("nd5t-theme-light", !isDark);
}

/**
 * Determines whether the rendered context menu element has a dark background.
 *
 * @param {HTMLElement} menuEl
 * @returns {boolean}
 */
function _isMenuBackgroundDark(menuEl) {
    const computed = window.getComputedStyle(menuEl);
    let bg = computed.backgroundColor;

    // If transparent, inspect CSS variables assigned to the element
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
        const bgVar = computed.getPropertyValue("--background-color").trim()
            || computed.getPropertyValue("--dnd5e-background-card").trim();
        if (bgVar) {
            const probe = document.createElement("div");
            probe.style.color = bgVar;
            document.body.appendChild(probe);
            bg = window.getComputedStyle(probe).color;
            probe.remove();
        }
    }

    // Parse RGBA values
    const rgbMatch = bg?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbMatch) {
        const r = Number(rgbMatch[1]);
        const g = Number(rgbMatch[2]);
        const b = Number(rgbMatch[3]);
        const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;

        if (a > 0.1) {
            // Standard relative luminance (ITU-R BT.709)
            const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            return luminance < 0.5;
        }
    }

    // Fallback: check if body is theme-dark or if theme-dark is active
    return !document.body.classList.contains("theme-light");
}

/**
 * Check if an item represents a Delete/Remove action.
 *
 * @param {string} labelKey
 * @param {string} iconClass
 * @param {string} text
 * @param {Set<string>} deleteTerms
 * @returns {boolean}
 */
function _isDeleteAction(labelKey, iconClass, text, deleteTerms) {
    if (labelKey.includes("delete") || labelKey.includes("remove")) return true;
    if (iconClass.includes("fa-trash") || iconClass.includes("fa-trash-can") || iconClass.includes("fa-trash-alt")) return true;
    if (deleteTerms.has(text)) return true;
    for (const term of deleteTerms) {
        if (text.startsWith(term) || text.endsWith(term)) return true;
    }
    return false;
}

/**
 * Check if an item represents a Duplicate/Copy/Clone action.
 *
 * @param {string} labelKey
 * @param {string} iconClass
 * @param {string} text
 * @param {Set<string>} duplicateTerms
 * @returns {boolean}
 */
function _isDuplicateAction(labelKey, iconClass, text, duplicateTerms) {
    if (labelKey.includes("duplicate") || labelKey.includes("clone") || labelKey.includes("copy")) return true;
    if (iconClass.includes("fa-copy") || iconClass.includes("fa-clone")) return true;
    if (duplicateTerms.has(text)) return true;
    for (const term of duplicateTerms) {
        if (text.startsWith(term) || text.endsWith(term)) return true;
    }
    return false;
}

/**
 * Check if an item represents a Make Private / Reveal action.
 *
 * @param {string} labelKey
 * @param {string} iconClass
 * @param {string} text
 * @param {Set<string>} violetTerms
 * @returns {boolean}
 */
function _isVioletAction(labelKey, iconClass, text, violetTerms) {
    if (labelKey.includes("revealmessage") || labelKey.includes("concealmessage")) return true;
    if (labelKey === "chat.revealmessage" || labelKey === "chat.concealmessage") return true;
    if (labelKey.includes("reveal") && !labelKey.includes("table")) return true;
    if (labelKey.includes("conceal") || labelKey.includes("private")) return true;
    if (violetTerms.has(text) || violetTerms.has(labelKey)) return true;
    for (const term of violetTerms) {
        if (text === term || text.startsWith(term) || text.endsWith(term) || text.includes(term)) return true;
        if (labelKey === term || labelKey.startsWith(term) || labelKey.endsWith(term)) return true;
    }
    return false;
}

