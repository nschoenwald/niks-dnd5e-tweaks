import { MODULE_ID, log, debug } from "../main.js";

/**
 * Item, Spell & Feature Add: Choice Dialog & Compendium Filter
 *
 * When clicking the '+' button on a character sheet in the Items, Spells, or Features tab:
 *   - Prompts the user to choose between creating a new document or opening the Compendium Browser.
 *   - Defaults to "Browse Compendium".
 *   - Spells tab: Filters by actor's class(es) (e.g. `class:wizard`, `class:cleric`) and spell level.
 *   - Items tab: Opens the Compendium Browser to the Physical Items tab.
 *   - Features tab: Opens the Compendium Browser to the Feats tab.
 *   - Holding Shift while clicking bypasses the prompt and performs default creation.
 */

export function initSheetPlusCompendium() {
    const attach = (app, html) => {
        _attachPlusButtonInterceptor(app, html);
    };

    Hooks.on("renderActorSheet", attach);
    Hooks.on("renderApplicationV2", (app, html) => {
        if (app.document?.documentName === "Actor" || app.actor || (globalThis.dnd5e?.applications?.actor?.BaseActorSheet && app instanceof globalThis.dnd5e.applications.actor.BaseActorSheet)) {
            attach(app, html);
        }
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
    // Robustly resolve the root HTMLElement across V1, V2 App parts, or app.element
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
    if (!actor || actor.documentName !== "Actor") return;

    if (rootElement.dataset.nd5tPlusCompendiumBound) return;
    rootElement.dataset.nd5tPlusCompendiumBound = "true";

    debug(`Attaching plus button interceptor to Actor Sheet: "${actor.name}" (${actor.id})`);

    rootElement.addEventListener("click", async (event) => {
        if (!game.settings.get(MODULE_ID, "enableSheetPlusCompendium")) return;

        // Bypass if event was dispatched internally to execute standard creation
        if (event.nd5tBypass) return;

        // Check if the clicked target or ancestor is a plus/add button
        const button = event.target.closest(
            'button.create-child, [data-action="addDocument"], [data-action="create"], .item-create, [data-action="createItem"], [data-action="createSpell"]'
        );
        if (!button) return;

        // Determine active tab name
        const tabName = _getActiveTabName(app, rootElement, button);
        debug(`Plus button clicked on sheet. Active tab: "${tabName}"`, button);

        const isItemsTab = tabName === "inventory" || tabName === "items";
        const isSpellsTab = tabName === "spells" || tabName === "spellbook";
        const isFeaturesTab = tabName === "features" || tabName === "feature";

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

function _getActiveTabName(app, rootElement, button) {
    // 1. Check if button itself is inside a [data-tab] container
    const tabEl = button.closest("[data-tab]");
    if (tabEl?.dataset?.tab) return tabEl.dataset.tab;

    // 2. Check active tab element in DOM
    const activeTabEl = rootElement.querySelector(".tab.active[data-tab]") || rootElement.querySelector("[data-tab].active");
    if (activeTabEl?.dataset?.tab) return activeTabEl.dataset.tab;

    // 3. App tabGroups / properties
    return app.tabGroups?.primary || app._currentTab || "";
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
    const el = target.closest("[data-level], [data-item-level], [data-spell-level], [data-prop]");
    if (!el) return null;

    const val = el.dataset.level ?? el.dataset.itemLevel ?? el.dataset.spellLevel ?? el.dataset.prop;
    if (val === undefined || val === null) return null;

    const strVal = String(val).toLowerCase();
    if (strVal === "cantrip" || strVal === "spell0") return 0;
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
