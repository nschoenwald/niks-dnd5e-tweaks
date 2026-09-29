/**
 * Feature: Item Sheet Attunement Tag
 * Description: Adds a prominent, theme-adaptive Attunement Required or No Attunement Required badge and quick-toggle state to magic item sheets and rich item tooltips.
 *
 * @introduced v14.33.0
 */
import { MODULE_ID, log, debug, isFeatureActive } from "../../main.js";

/**
 * Item Sheet Attunement Tag
 *
 * Adds a clear "Attunement Required" / "No Attunement Required" tag to item sheets
 * and rich item tooltips for magic items in D&D 5e 6.x / Foundry V14.
 *
 * Features:
 *   - Supports Header Badge, Subtitle text chip, and Description Tab property pills.
 *   - Supports rich item tooltips across actor sheets, compendiums, chat links, and containers.
 *   - Configurable placement: "both" (default), "header", "description", or "subtitle".
 *   - Dark mode & light mode adaptive styling.
 *   - Interactive toggle: If the item is on an actor and editable by the current user,
 *     clicking an Attunement Required or Attuned badge toggles the attuned state directly.
 *   - Respects D&D 5e identification: unrevealed for unidentified items if user is not GM.
 */

const INVENTORY_ITEM_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "container", "loot"]);

let _hookId = null;
let _origItemRichTooltip = null;
let _origItemDataModelRichTooltip = null;
let _tooltipObserver = null;

export function initItemSheetAttunementTag() {
    if (!isFeatureActive("enableItemSheetAttunementTag", "clientEnableItemSheetAttunementTag")) {
        disableItemSheetAttunementTag();
        return;
    }

    if (_hookId === null) {
        _hookId = Hooks.on("renderApplicationV2", (app, element) => {
            _onRenderApplication(app, element);
        });
    }

    // Wrap item tooltips
    _wrapTooltips();

    // Refresh any currently rendered item sheets
    _refreshOpenItemSheets();

    log("Item Sheet Attunement Tag enabled");
}

export function disableItemSheetAttunementTag() {
    if (_hookId !== null) {
        Hooks.off("renderApplicationV2", _hookId);
        _hookId = null;
    }

    // Unwrap item tooltips
    _unwrapTooltips();

    // Clean up all injected elements across open sheets
    _cleanupAllInjectedElements();
}

/**
 * Check if tooltip tagging is active.
 * @returns {boolean}
 */
function _isTooltipTaggingActive() {
    if (!isFeatureActive("enableItemSheetAttunementTag", "clientEnableItemSheetAttunementTag")) return false;
    return isFeatureActive("itemSheetAttunementTag_tooltip", "clientItemSheetAttunementTag_tooltip");
}

/**
 * Wrap item richTooltip methods.
 */
function _wrapTooltips() {
    // 1. Wrap CONFIG.Item.documentClass.prototype.richTooltip
    const ItemClass = CONFIG.Item?.documentClass;
    if (ItemClass?.prototype?.richTooltip && !_origItemRichTooltip) {
        _origItemRichTooltip = ItemClass.prototype.richTooltip;
        ItemClass.prototype.richTooltip = async function (enrichmentOptions = {}) {
            const result = await _origItemRichTooltip.call(this, enrichmentOptions);
            if (!_isTooltipTaggingActive()) return result;
            return _enhanceTooltipResult(this, result);
        };
        ItemClass.prototype.richTooltip._niksWrapped = true;
    }

    // 2. Wrap ItemDataModel.prototype.richTooltip
    const sampleModel = CONFIG.Item?.dataModels?.weapon || Object.values(CONFIG.Item?.dataModels || {})[0];
    const BaseItemDataModel = sampleModel ? Object.getPrototypeOf(sampleModel.constructor)?.prototype : null;
    if (BaseItemDataModel?.richTooltip && !_origItemDataModelRichTooltip) {
        _origItemDataModelRichTooltip = BaseItemDataModel.richTooltip;
        BaseItemDataModel.richTooltip = async function (enrichmentOptions = {}) {
            const result = await _origItemDataModelRichTooltip.call(this, enrichmentOptions);
            if (!_isTooltipTaggingActive()) return result;
            const item = this.parent ?? this;
            return _enhanceTooltipResult(item, result);
        };
        BaseItemDataModel.richTooltip._niksWrapped = true;
    }

    // 3. Fallback DOM observer for #tooltip
    _initTooltipDOMObserver();
}

/**
 * Unwrap item richTooltip methods and disconnect observer.
 */
function _unwrapTooltips() {
    const ItemClass = CONFIG.Item?.documentClass;
    if (_origItemRichTooltip && ItemClass?.prototype) {
        ItemClass.prototype.richTooltip = _origItemRichTooltip;
        _origItemRichTooltip = null;
    }

    const sampleModel = CONFIG.Item?.dataModels?.weapon || Object.values(CONFIG.Item?.dataModels || {})[0];
    const BaseItemDataModel = sampleModel ? Object.getPrototypeOf(sampleModel.constructor)?.prototype : null;
    if (_origItemDataModelRichTooltip && BaseItemDataModel) {
        BaseItemDataModel.richTooltip = _origItemDataModelRichTooltip;
        _origItemDataModelRichTooltip = null;
    }

    if (_tooltipObserver) {
        _tooltipObserver.disconnect();
        _tooltipObserver = null;
    }
}

/**
 * Initialize fallback MutationObserver on #tooltip.
 */
function _initTooltipDOMObserver() {
    if (_tooltipObserver) return;
    const tooltipEl = document.getElementById("tooltip");
    if (!tooltipEl) return;

    _tooltipObserver = new MutationObserver(() => {
        if (!_isTooltipTaggingActive()) return;
        if (!tooltipEl.classList.contains("item-tooltip") && !tooltipEl.classList.contains("dnd5e-tooltip")) return;

        const pills = tooltipEl.querySelector("ul.pills");
        if (!pills) return;
        if (pills.querySelector(".nd5t-attunement-pill")) return;

        const target = game.tooltip?.element;
        if (!target) return;
        const uuid = target.dataset.uuid || target.closest("[data-uuid]")?.dataset.uuid;
        if (!uuid) return;

        let doc;
        try {
            doc = fromUuidSync(uuid);
        } catch {
            return;
        }
        if (!doc || doc.documentName !== "Item") return;
        if (!_isMagicItem(doc) || _isConcealed(doc)) return;

        const attuneData = _getAttunementData(doc);
        _enhanceTooltipDOM(pills, attuneData);
    });

    _tooltipObserver.observe(tooltipEl, { childList: true, subtree: true });
}

/**
 * Enhance the richTooltip result HTML with an attunement pill.
 * @param {Item5e} item
 * @param {object} result
 * @returns {object}
 */
function _enhanceTooltipResult(item, result) {
    if (!result?.content) return result;
    if (!_isMagicItem(item)) return result;
    if (_isConcealed(item)) return result;

    const attuneData = _getAttunementData(item);
    const parser = new DOMParser();
    const doc = parser.parseFromString(result.content, "text/html");
    let pillsList = doc.querySelector("ul.pills");

    const existingPills = pillsList ? Array.from(pillsList.querySelectorAll("li.pill")) : [];
    let existingAttunementPill = null;

    const matchLabels = new Set([
        game.i18n.localize("DND5E.AttunementRequired")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementAttuned")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementOptional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Required")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Attuned")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Optional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.NoAttunement")?.toLowerCase(),
        "attunement required",
        "attuned",
        "optional attunement",
        "attunement not required",
        "no attunement required"
    ]);

    for (const pill of existingPills) {
        const text = pill.querySelector(".label")?.textContent.trim().toLowerCase() || pill.textContent.trim().toLowerCase();
        if (matchLabels.has(text)) {
            existingAttunementPill = pill;
            break;
        }
    }

    if (existingAttunementPill) {
        existingAttunementPill.className = `pill transparent nd5t-attunement-pill nd5t-${attuneData.state}`;
        existingAttunementPill.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
    } else {
        if (!pillsList) {
            pillsList = doc.createElement("ul");
            pillsList.className = "pills";
            doc.querySelector(".content")?.appendChild(pillsList);
        }
        if (pillsList) {
            const li = doc.createElement("li");
            li.className = `pill transparent nd5t-attunement-pill nd5t-${attuneData.state}`;
            li.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
            pillsList.appendChild(li);
        }
    }

    result.content = doc.body.innerHTML;
    return result;
}

/**
 * Enhance an existing pills list in the DOM with attunement data.
 * @param {HTMLElement} pillsList
 * @param {object} attuneData
 */
function _enhanceTooltipDOM(pillsList, attuneData) {
    if (!pillsList) return;
    const existingPills = Array.from(pillsList.querySelectorAll("li.pill"));
    let existingAttunementPill = null;

    const matchLabels = new Set([
        game.i18n.localize("DND5E.AttunementRequired")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementAttuned")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementOptional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Required")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Attuned")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Optional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.NoAttunement")?.toLowerCase(),
        "attunement required",
        "attuned",
        "optional attunement",
        "attunement not required",
        "no attunement required"
    ]);

    for (const pill of existingPills) {
        const text = pill.querySelector(".label")?.textContent.trim().toLowerCase() || pill.textContent.trim().toLowerCase();
        if (matchLabels.has(text)) {
            existingAttunementPill = pill;
            break;
        }
    }

    if (existingAttunementPill) {
        existingAttunementPill.className = `pill transparent nd5t-attunement-pill nd5t-${attuneData.state}`;
        existingAttunementPill.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
    } else {
        const li = document.createElement("li");
        li.className = `pill transparent nd5t-attunement-pill nd5t-${attuneData.state}`;
        li.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
        pillsList.appendChild(li);
    }
}

/**
 * Clean up all injected elements in all open sheets.
 */
function _cleanupAllInjectedElements() {
    document.querySelectorAll(".nd5t-attunement-badge-item, .nd5t-attunement-subtitle-item, .nd5t-injected-pill").forEach(el => el.remove());
    document.querySelectorAll(".nd5t-attunement-pill").forEach(pill => {
        pill.classList.remove("nd5t-attunement-pill", "nd5t-required", "nd5t-attuned", "nd5t-optional", "nd5t-none", "nd5t-attunement-toggleable");
        pill.querySelector("i")?.remove();
    });
}

/**
 * Refresh all open item sheets.
 */
function _refreshOpenItemSheets() {
    for (const app of foundry.applications.instances.values()) {
        if (app.rendered && _isItemSheet(app)) {
            _injectAttunementTag(app, app.element);
        }
    }
}

/**
 * Check if the application is an Item sheet.
 * @param {ApplicationV2} app
 * @returns {boolean}
 */
function _isItemSheet(app) {
    return app.document?.documentName === "Item";
}

/**
 * Handler for ApplicationV2 render hook.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function _onRenderApplication(app, element) {
    if (!_isItemSheet(app)) return;
    if (!isFeatureActive("enableItemSheetAttunementTag", "clientEnableItemSheetAttunementTag")) return;
    _injectAttunementTag(app, element);
}

/**
 * Determine if the item is a magic item.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isMagicItem(item) {
    if (!item?.system) return false;
    if (!INVENTORY_ITEM_TYPES.has(item.type)) return false;

    const sys = item.system;
    // Direct "mgc" property check
    if (sys.properties?.has?.("mgc") || sys._source?.properties?.includes?.("mgc")) return true;
    // Explicit attunement requirement (items with attunement in 5e are magical)
    if (sys.attunement === "required" || sys.attunement === "optional") return true;

    return false;
}

/**
 * Check if the item's magical details should be concealed.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isConcealed(item) {
    if (game.user.isGM) return false;
    if ("identified" in item.system && item.system.identified === false) return true;
    return false;
}

/**
 * Resolve the effective placement setting.
 * @returns {"both"|"header"|"description"|"subtitle"}
 */
function _getPlacement() {
    try {
        const clientVal = game.settings.get(MODULE_ID, "clientItemSheetAttunementTag_placement");
        if (clientVal && clientVal !== "default") return clientVal;
        return game.settings.get(MODULE_ID, "itemSheetAttunementTag_placement") || "both";
    } catch {
        return "both";
    }
}

/**
 * Get attunement display metadata.
 * @param {Item5e} item
 * @returns {object}
 */
function _getAttunementData(item) {
    const sys = item.system;
    const attunement = sys.attunement;
    const isAttuned = Boolean(sys.attuned);
    const canAttune = Boolean(item.actor && item.isOwner && (attunement === "required" || attunement === "optional"));

    if (attunement === "required") {
        if (isAttuned) {
            return {
                state: "attuned",
                label: game.i18n.localize("ND5T.ItemSheetAttunementTag.Attuned"),
                icon: "fa-solid fa-sun",
                tooltip: canAttune
                    ? game.i18n.localize("ND5T.ItemSheetAttunementTag.ClickToUnattune")
                    : game.i18n.localize("DND5E.AttunementAttuned"),
                canToggle: canAttune
            };
        }
        return {
            state: "required",
            label: game.i18n.localize("ND5T.ItemSheetAttunementTag.Required"),
            icon: "fa-solid fa-sun",
            tooltip: canAttune
                ? game.i18n.localize("ND5T.ItemSheetAttunementTag.ClickToAttune")
                : game.i18n.localize("DND5E.AttunementRequired"),
            canToggle: canAttune
        };
    }

    if (attunement === "optional") {
        if (isAttuned) {
            return {
                state: "attuned",
                label: game.i18n.localize("ND5T.ItemSheetAttunementTag.Attuned"),
                icon: "fa-solid fa-sun",
                tooltip: canAttune
                    ? game.i18n.localize("ND5T.ItemSheetAttunementTag.ClickToUnattune")
                    : game.i18n.localize("DND5E.AttunementAttuned"),
                canToggle: canAttune
            };
        }
        return {
            state: "optional",
            label: game.i18n.localize("ND5T.ItemSheetAttunementTag.Optional"),
            icon: "fa-solid fa-sun",
            tooltip: canAttune
                ? game.i18n.localize("ND5T.ItemSheetAttunementTag.ClickToAttune")
                : game.i18n.localize("DND5E.AttunementOptional"),
            canToggle: canAttune
        };
    }

    // No attunement required
    return {
        state: "none",
        label: game.i18n.localize("ND5T.ItemSheetAttunementTag.NoAttunement"),
        icon: "fa-solid fa-circle-check",
        tooltip: game.i18n.localize("ND5T.ItemSheetAttunementTag.NoAttunement"),
        canToggle: false
    };
}

/**
 * Main injection logic for item sheets.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function _injectAttunementTag(app, element) {
    const item = app.document;
    if (!item) return;

    // Clean up any previously injected elements in this sheet
    element.querySelectorAll(".nd5t-attunement-badge-item, .nd5t-attunement-subtitle-item, .nd5t-injected-pill").forEach(el => el.remove());

    // Only apply to magic items
    if (!_isMagicItem(item)) return;

    // Conceal if unidentified and user is not GM
    if (_isConcealed(item)) return;

    const placement = _getPlacement();
    const attuneData = _getAttunementData(item);

    // 1. Inject Header Tag (Badge or Subtitle)
    if (placement === "both" || placement === "header" || placement === "subtitle") {
        _injectHeaderTag(app, element, item, attuneData, placement);
    }

    // 2. Inject / Enhance Description Tab Pill
    if (placement === "both" || placement === "description") {
        _injectDescriptionPill(app, element, item, attuneData);
    }
}

/**
 * Inject the tag into the header identity info.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 * @param {Item5e} item
 * @param {object} attuneData
 * @param {string} placement
 */
function _injectHeaderTag(app, element, item, attuneData, placement) {
    const subtitles = element.querySelector(".identity-info .subtitles");
    if (!subtitles) return;

    if (placement === "subtitle") {
        const li = element.ownerDocument.createElement("li");
        li.className = `nd5t-attunement-subtitle-item nd5t-${attuneData.state}`;
        const span = element.ownerDocument.createElement("span");
        span.className = "nd5t-attunement-text";
        span.textContent = attuneData.label;
        span.dataset.tooltip = attuneData.tooltip;
        li.appendChild(span);
        subtitles.appendChild(li);
        return;
    }

    // Default: Badge Chip
    const li = element.ownerDocument.createElement("li");
    li.className = "nd5t-attunement-badge-item";

    let tagEl;
    if (attuneData.canToggle) {
        tagEl = element.ownerDocument.createElement("button");
        tagEl.type = "button";
        tagEl.className = `nd5t-attunement-badge nd5t-${attuneData.state} nd5t-attunement-toggleable`;
        tagEl.setAttribute("aria-label", attuneData.label);
        tagEl.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                await item.update({ "system.attuned": !item.system.attuned });
            } catch (err) {
                console.error("Failed to toggle attunement:", err);
            }
        });
    } else {
        tagEl = element.ownerDocument.createElement("span");
        tagEl.className = `nd5t-attunement-badge nd5t-${attuneData.state}`;
    }

    tagEl.dataset.tooltip = attuneData.tooltip;
    tagEl.innerHTML = `<i class="${attuneData.icon}" inert></i><span>${attuneData.label}</span>`;

    li.appendChild(tagEl);
    subtitles.appendChild(li);
}

/**
 * Inject or enhance the property pill on the Description tab.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 * @param {Item5e} item
 * @param {object} attuneData
 */
function _injectDescriptionPill(app, element, item, attuneData) {
    const descriptionTab = element.querySelector('.tab[data-tab="description"], .tab.description');
    if (!descriptionTab) return;

    let pillsList = descriptionTab.querySelector("ul.pills");

    // Look for an existing attunement pill rendered by dnd5e
    const existingPills = pillsList ? Array.from(pillsList.querySelectorAll("li.pill")) : [];
    let existingAttunementPill = null;

    const matchLabels = new Set([
        game.i18n.localize("DND5E.AttunementRequired")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementAttuned")?.toLowerCase(),
        game.i18n.localize("DND5E.AttunementOptional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Required")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Attuned")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.Optional")?.toLowerCase(),
        game.i18n.localize("ND5T.ItemSheetAttunementTag.NoAttunement")?.toLowerCase(),
        "attunement required",
        "attuned",
        "optional attunement",
        "attunement not required",
        "no attunement required"
    ]);

    for (const pill of existingPills) {
        const text = pill.querySelector(".label")?.textContent.trim().toLowerCase() || pill.textContent.trim().toLowerCase();
        if (matchLabels.has(text)) {
            existingAttunementPill = pill;
            break;
        }
    }

    if (existingAttunementPill) {
        // Upgrade existing pill with styling & icon
        existingAttunementPill.classList.add("nd5t-attunement-pill", `nd5t-${attuneData.state}`);
        if (attuneData.canToggle) {
            existingAttunementPill.classList.add("nd5t-attunement-toggleable");
            existingAttunementPill.style.cursor = "pointer";
            existingAttunementPill.dataset.tooltip = attuneData.tooltip;
            existingAttunementPill.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await item.update({ "system.attuned": !item.system.attuned });
                } catch (err) {
                    console.error("Failed to toggle attunement:", err);
                }
            };
        }
        existingAttunementPill.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
    } else {
        // No attunement pill exists (e.g. "No Attunement Required") -> inject one
        if (!pillsList) {
            pillsList = element.ownerDocument.createElement("ul");
            pillsList.className = "pills";
            descriptionTab.appendChild(pillsList);
        }

        const li = element.ownerDocument.createElement("li");
        li.className = `pill transparent nd5t-attunement-pill nd5t-${attuneData.state} nd5t-injected-pill`;
        li.dataset.tooltip = attuneData.tooltip;
        if (attuneData.canToggle) {
            li.classList.add("nd5t-attunement-toggleable");
            li.style.cursor = "pointer";
            li.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await item.update({ "system.attuned": !item.system.attuned });
                } catch (err) {
                    console.error("Failed to toggle attunement:", err);
                }
            };
        }
        li.innerHTML = `<i class="${attuneData.icon}" inert></i><span class="label">${attuneData.label}</span>`;
        pillsList.appendChild(li);
    }
}
