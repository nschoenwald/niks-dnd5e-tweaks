import { MODULE_ID, log, debug } from "../main.js";

/**
 * Spell Add Button Override
 *
 * Intercepts the "+" (create item) buttons on the Spells tab of actor sheets
 * and optionally opens the DnD5e Compendium Browser (filtered to spells)
 * instead of creating a blank spell.
 *
 * Three modes controlled by the "spellAddButtonMode" setting:
 *   - "default"    → System default: create a new empty spell
 *   - "compendium" → Open the Compendium Browser to the Spells tab
 *   - "dialog"     → Show a small dialog offering both options
 *
 * Applies to both Character and NPC sheets.
 * Compatible with Foundry V13 and V14.
 */

export function initSpellAddButtonOverride() {
    // Hook: legacy AppV1 actor sheets (V13)
    Hooks.on("renderActorSheet", (app, html, data) => {
        _processSheet(app, html[0] || html);
    });

    // Hook: AppV2 actor sheets (V14+)
    Hooks.on("renderDocumentSheetV2", (app, html) => {
        if (app.document instanceof Actor) {
            _processSheet(app, html[0] || html);
        }
    });

    log("Spell Add Button Override initialized");
}

/**
 * Process a rendered actor sheet and override spell-create buttons.
 * @param {Application} app   The sheet application instance
 * @param {HTMLElement}  html  The rendered DOM element
 */
function _processSheet(app, html) {
    const mode = game.settings.get(MODULE_ID, "spellAddButtonMode");
    if (mode === "default") return;

    const actor = app.document ?? app.actor;
    if (!actor || !(actor instanceof Actor)) return;

    // V14 AppV2 sheets: .item-action[data-action="create"]
    // V13 legacy sheets: .item-create with dataset containing type="spell"
    // We search broadly and filter by dataset or parent container.
    const buttons = html.querySelectorAll(
        '.item-action[data-action="create"], .item-action[data-action="itemCreate"], a.item-create, button.item-create'
    );

    for (const button of buttons) {
        // Target spell-creation buttons:
        // Either the button itself has data-type="spell", or its closest header/container has it.
        const isSpellButton = button.dataset.type === "spell" || 
                              button.closest('[data-type="spell"]') !== null ||
                              button.closest('.spellbook-header') !== null ||
                              button.closest('.spellbook') !== null;

        if (!isSpellButton) continue;

        // Avoid attaching duplicate listeners on partial re-renders
        if (button.dataset.nd5tOverride) continue;
        button.dataset.nd5tOverride = "true";

        button.addEventListener("click", (event) => {
            _handleSpellCreate(event, button, actor, mode);
        }, { capture: true });
    }
}

/**
 * Handle an intercepted click on a spell-create button.
 * @param {Event}       event   The click event
 * @param {HTMLElement}  button  The button element
 * @param {Actor}       actor   The owning actor
 * @param {string}      mode    The configured mode ("compendium" | "dialog")
 */
function _handleSpellCreate(event, button, actor, mode) {
    // Re-check mode at click time in case the setting was changed
    const currentMode = game.settings.get(MODULE_ID, "spellAddButtonMode");
    if (currentMode === "default") return; // Let the system handle it

    event.stopPropagation();
    event.preventDefault();

    debug("Spell Add Button Override: intercepted spell create click", { mode: currentMode, actor: actor.name });

    if (currentMode === "compendium") {
        _openCompendiumBrowserSpells();
    } else if (currentMode === "dialog") {
        _showChoiceDialog(button, actor);
    }
}

/**
 * Open the DnD5e Compendium Browser filtered to spells.
 */
function _openCompendiumBrowserSpells() {
    const CB = globalThis.dnd5e?.applications?.CompendiumBrowser
            ?? game.dnd5e?.applications?.CompendiumBrowser;

    if (!CB) {
        ui.notifications.warn("Unable to find the DnD5e Compendium Browser.");
        return;
    }

    try {
        // The CompendiumBrowser constructor accepts options including a tab to open to.
        // Different system versions may handle this differently.
        const browser = new CB({ tab: "spells" });
        browser.render(true);
        debug("Opened Compendium Browser to Spells tab");
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error opening Compendium Browser:", err);
        // Fallback: open without tab pre-selection
        try {
            new CB().render(true);
        } catch {
            ui.notifications.warn("Unable to open the DnD5e Compendium Browser.");
        }
    }
}

/**
 * Show a choice dialog letting the user pick between creating a blank spell
 * or opening the compendium browser.
 * @param {HTMLElement} button  The original button element (for dataset passthrough)
 * @param {Actor}       actor   The owning actor
 */
async function _showChoiceDialog(button, actor) {
    // Use DialogV2 if available (V12+), otherwise fall back to legacy Dialog
    const DialogClass = foundry.applications?.api?.DialogV2 ?? Dialog;

    if (DialogClass === Dialog) {
        // Legacy Dialog (V12 and below — unlikely but safe)
        new Dialog({
            title: "Add Spell",
            content: "<p>How would you like to add a spell?</p>",
            buttons: {
                create: {
                    icon: '<i class="fas fa-plus"></i>',
                    label: "Create Empty Spell",
                    callback: () => _createSpellDefault(button, actor)
                },
                compendium: {
                    icon: '<i class="fas fa-atlas"></i>',
                    label: "Open Compendium Browser",
                    callback: () => _openCompendiumBrowserSpells()
                }
            },
            default: "compendium"
        }).render(true);
    } else {
        // DialogV2 (V13+)
        await DialogClass.wait({
            window: { title: "Add Spell" },
            content: "<p>How would you like to add a spell?</p>",
            buttons: [
                {
                    action: "create",
                    icon: "fas fa-plus",
                    label: "Create Empty Spell",
                    callback: () => _createSpellDefault(button, actor)
                },
                {
                    action: "compendium",
                    icon: "fas fa-atlas",
                    label: "Open Compendium Browser",
                    default: true,
                    callback: () => _openCompendiumBrowserSpells()
                }
            ],
            rejectClose: false
        });
    }
}

/**
 * Create a new spell using the system's default behavior.
 * This reproduces what the system does when the "+" button is clicked.
 * @param {HTMLElement} button  The original button element (carries dataset like level)
 * @param {Actor}       actor   The owning actor
 */
async function _createSpellDefault(button, actor) {
    debug("Creating empty spell via system default", { actor: actor.name });

    // Build item data from the button's dataset
    const itemData = {
        name: game.i18n.format("DOCUMENT.New", { type: game.i18n.localize("TYPES.Item.spell") }),
        type: "spell"
    };

    // Carry over any dataset attributes the system uses (e.g., spell level)
    const level = button.dataset.level ?? button.closest('[data-level]')?.dataset.level;
    if (level !== undefined) {
        itemData["system.level"] = Number(level);
    }

    try {
        // Try using the system's createDialog first (most robust)
        await Item.implementation.createDialog({}, {
            parent: actor,
            pack: "",
            types: ["spell"]
        });
    } catch (err) {
        // Fallback: create the item directly
        debug("createDialog failed, creating directly:", err);
        await actor.createEmbeddedDocuments("Item", [itemData]);
    }
}
