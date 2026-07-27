import { MODULE_ID, log, debug } from "../main.js";

/**
 * Item, Spell & Feature Add: Choice Dialog & Compendium Filter
 *
 * Compatible with standard DnD5e Sheets (V1 & V2) and Tidy 5e Sheets (Classic & Quadrone).
 *
 * Intercepts clicks on page-level and sub-category/section add buttons on character sheets:
 *   - Items tab (inventory, equipment, physical items)
 *   - Spells tab (spellbook, cantrips, spell slot levels)
 *   - Features tab (features, feats, class features, racial traits)
 *
 * Choice Dialog Options:
 *   - "Browse Compendium" (placed on the left, set as default choice)
 *   - "Create New Item/Spell/Feature"
 *
 * Holding Shift while clicking bypasses the prompt and performs default creation directly.
 */

export function initSheetPlusCompendium() {
    const attach = (app, html) => {
        _attachPlusButtonInterceptor(app, html);
    };

    // Standard DnD5e hooks
    Hooks.on("renderActorSheet", attach);
    Hooks.on("renderApplicationV2", (app, html) => {
        if (app.document?.documentName === "Actor" || app.actor || (globalThis.dnd5e?.applications?.actor?.BaseActorSheet && app instanceof globalThis.dnd5e.applications.actor.BaseActorSheet)) {
            attach(app, html);
        }
    });

    // Tidy 5e Sheets dedicated hook
    Hooks.on("tidy5e-sheet.renderActorSheet", (app, element) => {
        attach(app, element);
    });

    // Also scan any already-open actor sheets on init/setup
    _scanAndAttachOpenSheets();
}

function _scanAndAttachOpenSheets() {
    try {
        const windows = Object.values(ui.windows || {}).concat(Array.from(foundry.applications?.instances?.values() || []));
        for (const app of windows) {
            if (app.actor || app.document?.documentName === "Actor") {
                _attachPlusButtonInterceptor(app, app.element);
            }
        }
    } catch { /* ignore */ }
}

function _attachPlusButtonInterceptor(app, html) {
    // Robustly resolve the root HTMLElement across V1, V2 App parts, Tidy5e, or app.element
    let rootElement = app.element;
    if (!rootElement && html) {
        if (html instanceof HTMLElement) rootElement = html;
        else if (html[0] instanceof HTMLElement) rootElement = html[0];
        else if (typeof html === "object") {
            rootElement = Object.values(html).find(v => v instanceof HTMLElement);
        }
    }

    if (!rootElement || !(rootElement instanceof HTMLElement)) return;

    // Only target actor sheets where the document is an actor
    const actor = app.actor || app.document;
    if (!actor || (actor.documentName !== "Actor" && actor.constructor?.name !== "Actor5e")) return;

    if (rootElement.dataset.nd5tPlusCompendiumBound) return;
    rootElement.dataset.nd5tPlusCompendiumBound = "true";

    debug(`Attaching plus button interceptor to Actor Sheet: "${actor.name}" (${actor.id})`);

    rootElement.addEventListener("click", async (event) => {
        if (!game.settings.get(MODULE_ID, "enableSheetPlusCompendium")) return;

        // Bypass if event was dispatched internally to execute standard creation
        if (event.nd5tBypass) return;

        // Find the add/create button (page-level or sub-category section header button)
        const button = _findPlusButton(event.target);
        if (!button) return;

        // Determine active tab name
        const tabName = _getActiveTabName(app, rootElement, button);
        debug(`Plus button clicked on sheet. Resolved tab: "${tabName}"`, button);

        const isItemsTab = tabName === "inventory" || tabName === "items" || tabName === "equipment" || tabName === "container";
        const isSpellsTab = tabName === "spells" || tabName === "spellbook" || tabName.startsWith("spell");
        const isFeaturesTab = tabName === "features" || tabName === "feature" || tabName === "feats" || tabName === "actions";

        if (!isItemsTab && !isSpellsTab && !isFeaturesTab) return;

        // Intercept click event
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        // Shift-click bypass -> perform default creation immediately
        if (event.shiftKey) {
            debug("Shift-click detected on plus button: bypassing prompt dialog.");
            _triggerDefaultAddAction(button);
            return;
        }

        if (isItemsTab) {
            await _handleItemsTabClick(actor, button);
        } else if (isSpellsTab) {
            await _handleSpellsTabClick(actor, button);
        } else if (isFeaturesTab) {
            await _handleFeaturesTabClick(actor, button);
        }
    }, { capture: true });
}

/**
 * Finds add/create buttons (both page-level and sub-category section header buttons)
 * across standard DnD5e sheets and Tidy 5e Sheets (Classic & Quadrone).
 */
function _findPlusButton(target) {
    if (!target) return null;

    // 1. Direct class/action match for standard & Tidy 5e buttons
    const directMatch = target.closest(
        'button.create-child, .item-create, [data-action="addDocument"], [data-action="create"], [data-action="create-item"], [data-action="add-item"], [data-action="createItem"], [data-action="createSpell"], [data-action="createFeature"]'
    );
    if (directMatch) return directMatch;

    // 2. Clickable container (a, button, role=button) containing a plus icon or matching creation tooltips
    const clickable = target.closest('a, button, [role="button"]');
    if (!clickable) return null;

    // Check for plus icons (.fa-plus, .fa-plus-circle, .fa-circle-plus, etc.)
    const hasPlusIcon = !!clickable.querySelector('.fa-plus, .fa-plus-circle, .fa-circle-plus')
        || clickable.classList.contains('fa-plus')
        || clickable.classList.contains('fa-plus-circle')
        || clickable.classList.contains('fa-circle-plus');

    if (hasPlusIcon) {
        return clickable;
    }

    // Check tooltip/title/aria-label for creation intent
    const tooltipText = (clickable.getAttribute('data-tooltip') || clickable.getAttribute('title') || clickable.getAttribute('aria-label') || '').toLowerCase();
    if (tooltipText.includes('create') || tooltipText.includes('add') || tooltipText.includes('itemcreate') || tooltipText.includes('featureadd') || tooltipText.includes('spelladd')) {
        return clickable;
    }

    return null;
}

function _getActiveTabName(app, rootElement, button) {
    // 1. Check closest container ancestor for data attributes (Tidy5e & dnd5e)
    const tabContainer = button.closest("[data-tab-contents-for], [data-tab-id], [data-tab]");
    if (tabContainer) {
        const id = tabContainer.getAttribute("data-tab-contents-for")
            || tabContainer.getAttribute("data-tab-id")
            || tabContainer.getAttribute("data-tab");
        if (id) return id;
    }

    // 2. Check active tab element in DOM (Tidy5e data-tab-id / data-tab-contents-for, dnd5e v2, dnd5e v1)
    const activeTabEl = rootElement.querySelector(
        "[data-tab-id].active, [data-tab-contents-for].active, .tab.active[data-tab], [data-tab].active"
    );
    if (activeTabEl) {
        const id = activeTabEl.getAttribute("data-tab-contents-for")
            || activeTabEl.getAttribute("data-tab-id")
            || activeTabEl.getAttribute("data-tab");
        if (id) return id;
    }

    // 3. Check section key or dataset on button/ancestor
    const sectionEl = button.closest("[data-section], [data-section-key]");
    if (sectionEl) {
        const secKey = sectionEl.getAttribute("data-section") || sectionEl.getAttribute("data-section-key");
        if (secKey) return secKey;
    }

    // 4. App tab properties (Tidy5e currentTab, dnd5e tabGroups, etc.)
    const appTab = (typeof app.currentTab === "object" ? app.currentTab?.id : app.currentTab)
        || app.tab
        || app.tabGroups?.primary
        || app._currentTab;
    if (appTab) return appTab;

    return "";
}

function _triggerDefaultAddAction(button) {
    const bypassEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
    });
    bypassEvent.nd5tBypass = true;
    button.dispatchEvent(bypassEvent);
}

async function _handleItemsTabClick(actor, button) {
    const itemLabel = game.i18n.localize("DOCUMENT.Item");
    const title = game.i18n.format("SIDEBAR.Create", { type: itemLabel });

    const choice = await _showChoiceDialog({
        title,
        content: "<p style='margin-bottom: 12px;'>Would you like to create a new item or open the Compendium Browser?</p>",
        createLabel: "Create New Item",
        browseLabel: "Browse Compendium",
        defaultAction: "browse"
    });

    if (choice === "create") {
        _triggerDefaultAddAction(button);
    } else if (choice === "browse") {
        _openCompendiumBrowserForItems();
    }
}

async function _handleSpellsTabClick(actor, button) {
    const level = _getSpellLevelFromElement(button);
    const spellLabel = game.i18n.localize("TYPES.Item.spell");

    let levelSuffix = "";
    if (level !== null && level !== undefined) {
        levelSuffix = level === 0 ? " (Cantrip)" : ` (Level ${level})`;
    }

    const title = game.i18n.format("SIDEBAR.Create", { type: spellLabel }) + levelSuffix;

    const choice = await _showChoiceDialog({
        title,
        content: `<p style='margin-bottom: 12px;'>Would you like to create a new spell${levelSuffix} or open the Compendium Browser?</p>`,
        createLabel: "Create New Spell",
        browseLabel: "Browse Compendium",
        defaultAction: "browse"
    });

    if (choice === "create") {
        _triggerDefaultAddAction(button);
    } else if (choice === "browse") {
        _openCompendiumBrowserForSpells(actor, level);
    }
}

async function _handleFeaturesTabClick(actor, button) {
    const featLabel = game.i18n.has("DND5E.Feature") ? game.i18n.localize("DND5E.Feature") : game.i18n.localize("TYPES.Item.feat");
    const title = game.i18n.format("SIDEBAR.Create", { type: featLabel });

    const choice = await _showChoiceDialog({
        title,
        content: "<p style='margin-bottom: 12px;'>Would you like to create a new feature or open the Compendium Browser?</p>",
        createLabel: "Create New Feature",
        browseLabel: "Browse Compendium",
        defaultAction: "browse"
    });

    if (choice === "create") {
        _triggerDefaultAddAction(button);
    } else if (choice === "browse") {
        _openCompendiumBrowserForFeatures();
    }
}

function _openCompendiumBrowserForItems() {
    const CompendiumBrowser = globalThis.dnd5e?.applications?.CompendiumBrowser
        || game.dnd5e?.applications?.CompendiumBrowser;

    if (!CompendiumBrowser) {
        ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
        return;
    }

    new CompendiumBrowser({
        tab: "physical"
    }).render(true);
}

function _openCompendiumBrowserForFeatures() {
    const CompendiumBrowser = globalThis.dnd5e?.applications?.CompendiumBrowser
        || game.dnd5e?.applications?.CompendiumBrowser;

    if (!CompendiumBrowser) {
        ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
        return;
    }

    new CompendiumBrowser({
        tab: "feats"
    }).render(true);
}

function _openCompendiumBrowserForSpells(actor, level) {
    const CompendiumBrowser = globalThis.dnd5e?.applications?.CompendiumBrowser
        || game.dnd5e?.applications?.CompendiumBrowser;

    if (!CompendiumBrowser) {
        ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
        return;
    }

    const additional = {};

    // 1. Filter by Class spell list(s)
    if (actor?.itemTypes?.class?.length) {
        const spelllist = {};
        for (const classItem of actor.itemTypes.class) {
            const identifier = classItem.system?.identifier || classItem.name?.slugify({ strict: true });
            if (identifier) {
                spelllist[`class:${identifier}`] = 1;
            }
        }
        if (!foundry.utils.isEmpty(spelllist)) {
            additional.spelllist = spelllist;
        }
    }

    // 2. Filter by Spell Level
    if (level !== null && level !== undefined) {
        additional.level = { min: level, max: level };
    } else if (actor) {
        const maxLevel = _getActorMaxSpellLevel(actor);
        if (maxLevel > 0 && maxLevel < 9) {
            additional.level = { min: 0, max: maxLevel };
        }
    }

    debug("Opening Compendium Browser for Spells with filters:", additional);

    new CompendiumBrowser({
        tab: "spells",
        filters: {
            initial: {
                documentClass: "Item",
                types: new Set(["spell"]),
                additional
            }
        }
    }).render(true);
}

function _getSpellLevelFromElement(target) {
    const el = target.closest("[data-level], [data-item-level], [data-spell-level], [data-prop], [data-filter-level], [data-section-key], [data-key]");
    if (!el) return null;

    const val = el.dataset.level ?? el.dataset.itemLevel ?? el.dataset.spellLevel ?? el.dataset.prop ?? el.dataset.filterLevel ?? el.dataset.sectionKey ?? el.dataset.key;
    if (val === undefined || val === null) return null;

    const strVal = String(val).toLowerCase();
    if (strVal === "cantrip" || strVal === "spell0" || strVal === "0") return 0;
    if (strVal.startsWith("spell")) {
        const num = parseInt(strVal.replace("spell", ""), 10);
        if (!isNaN(num)) return num;
    }

    const parsed = parseInt(strVal, 10);
    return isNaN(parsed) ? null : parsed;
}

function _getActorMaxSpellLevel(actor) {
    if (!actor?.system?.spells) return 9;
    let maxLevel = 0;
    const spells = actor.system.spells;
    for (let l = 1; l <= 9; l++) {
        const slot = spells[`spell${l}`];
        if (slot && (slot.max > 0 || slot.override > 0)) {
            maxLevel = l;
        }
    }
    if (spells.pact?.level && (spells.pact?.max > 0 || spells.pact?.override > 0)) {
        maxLevel = Math.max(maxLevel, spells.pact.level);
    }
    return maxLevel;
}

async function _showChoiceDialog({ title, content, createLabel, browseLabel, defaultAction = "browse" }) {
    const DialogV2 = foundry.applications.api?.DialogV2;
    if (DialogV2) {
        return await DialogV2.wait({
            window: {
                title,
                icon: "fas fa-plus-circle",
                width: 400
            },
            content,
            buttons: [
                {
                    action: "browse",
                    label: browseLabel,
                    icon: "fas fa-book-open",
                    className: defaultAction === "browse" ? "default bright" : "bright",
                    callback: () => "browse"
                },
                {
                    action: "create",
                    label: createLabel,
                    icon: "fas fa-plus",
                    className: defaultAction === "create" ? "default bright" : "",
                    callback: () => "create"
                }
            ],
            rejectClose: false,
            close: () => null
        });
    }

    return new Promise((resolve) => {
        new Dialog({
            title,
            content,
            buttons: {
                browse: {
                    icon: '<i class="fas fa-book-open"></i>',
                    label: browseLabel,
                    callback: () => resolve("browse")
                },
                create: {
                    icon: '<i class="fas fa-plus"></i>',
                    label: createLabel,
                    callback: () => resolve("create")
                }
            },
            default: defaultAction,
            close: () => resolve(null)
        }).render(true);
    });
}
