import { initForceCompendiumBrowser } from "./features/force-compendium-browser.js";
import { registerAutoClearMovementSettings, initAutoClearMovementHistory, disableAutoClearMovementHistory, enableAutoClearMovementHistory } from "./features/auto-clear-movement-history.js";
import { initSceneNavName } from "./features/scene-nav-name.js";
import { enableCursorHints, disableCursorHints } from "./features/cursor-hints.js";
import { enableProneRotation, disableProneRotation } from "./features/prone-rotation.js";
import { initTokenResizer } from "./features/token-resizer.js";
import { initActorDispositionColors } from "./features/actor-disposition-colors.js";

import { initItemRarityColors } from "./features/item-rarity-colors.js";
import { initDeathSavePrompt } from "./features/death-save-prompt.js";
import { initBloodDropIcon } from "./features/blood-drop-icon.js";
import { enableSidebarNameWrap, disableSidebarNameWrap } from "./features/sidebar-name-wrap.js";


export const MODULE_ID = "niks-dnd5e-tweaks";

/**
 * Global logging helpers
 */
export function log(message, ...args) {
    console.log(`Nik's DnD5e Tweaks | ${message}`, ...args);
}

export function debug(message, ...args) {
    if (game.settings.get(MODULE_ID, "debugMode")) {
        console.debug(`Nik's DnD5e Tweaks DEBUG | ${message}`, ...args);
    }
}

// Optimization: keep track of whether scene nav was initialized to avoid dual binds if toggled.
// Most of the basic render hooks can safely just be required to reload or left enabled.
// Cursor Hints, Prone Rotation, and Movement History already support hot-toggling.

Hooks.once("init", () => {

    // ==========================================
    // GROUP 1: User Interface & Visuals
    // ==========================================

    game.settings.register(MODULE_ID, "enableSceneNavName", {
        name: "Sync Browser Tab Title",
        hint: "Keeps the browser tab name in sync with the scene the client is currently viewing.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: (value) => {
            // Scene Nav Name keeps its own internal initialized state and handles title reset.
            if (value) Hooks.callAll("nd5t.updateTabTitle");
            else document.title = game.world.title;
        }
    });

    game.settings.register(MODULE_ID, "enableCursorHints", {
        name: "Show Cursor Keyboard Hints",
        hint: "Displays visual floating icons near the mouse cursor when dnd5e configured keys (Skip, Advantage, Disadvantage) are pressed.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: (value) => {
            if (value) enableCursorHints();
            else disableCursorHints();
        }
    });

    game.settings.register(MODULE_ID, "enableActorDispositionColors", {
        name: "Actor Directory Disposition Dots",
        hint: "Adds a colored dot next to the actor name in the Actors directory sidebar based on their default token disposition (Friendly, Hostile, Secret, Neutral).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            ui.actors.render();
        }
    });

    game.settings.register(MODULE_ID, "enableItemRarityColors", {
        name: "Item Rarity Colors",
        hint: "Colors item backgrounds in actor sheets and inventory lists based on their rarity (Common, Uncommon, Rare, etc.).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            // Re-render AppV1 actor sheets
            Object.values(ui.windows).forEach(app => {
                if (app.document?.documentName === "Actor") app.render();
            });
            // Re-render AppV2 actor sheets (V13+)
            if (foundry.applications?.instances) {
                for (const app of foundry.applications.instances.values()) {
                    if (app.document?.documentName === "Actor") app.render();
                }
            }
        }
    });

    game.settings.register(MODULE_ID, "enableBloodDropIcon", {
        name: "Blood Drop Bloodied Icon",
        hint: "Replaces the default DnD5e bloodied condition icon with a red blood drop.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID, "enableSidebarNameWrap", {
        name: "Sidebar Multi-line Names",
        hint: "Enables text wrapping for long document names in the right sidebar (Actors, Items, Scenes, etc.) to prevent them from being cut off.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: (value) => {
            if (value) enableSidebarNameWrap();
            else disableSidebarNameWrap();
        }
    });

    // ==========================================
    // GROUP 2: Canvas & Tokens
    // ==========================================

    game.settings.register(MODULE_ID, "enableProneRotation", {
        name: "Auto-Rotate Prone Tokens",
        hint: "Automatically rotates tokens 90 degrees when they are given the Prone status effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: (value) => {
            if (value) enableProneRotation();
            else disableProneRotation();
        }
    });

    game.settings.register(MODULE_ID, "enableTokenResizer", {
        name: "Token Resizer Tool",
        hint: "Adds a new control icon to the Token tools menu (GMs only) to quickly resize selected tokens to standard 5e dimensions.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            ui.controls.initialize();
        }
    });

    game.settings.register(MODULE_ID, "enableAutoClearMovementHistory", {
        name: "Auto-Clear Movement History",
        hint: "When enabled, the GM client will automatically clear token movement history at the start of each combat turn.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: (value) => {
            if (value) enableAutoClearMovementHistory();
            else disableAutoClearMovementHistory();
        }
    });

    // Register its sub-settings (these belong to movement history logically)
    registerAutoClearMovementSettings();

    // ==========================================
    // GROUP 3: Automation & QOL Tasks
    // ==========================================

    // Container helpers settings — disabled while the feature is disabled
    // game.settings.register(MODULE_ID, "autoRemoveItemsFromContainer", {
    //     name: "Auto-Remove Dropped Items (World Containers)",
    //     hint: "Automatically deletes the original source item when it is dragged from a world container onto an actor.",
    //     scope: "world",
    //     config: true,
    //     type: String,
    //     choices: {
    //         "none": "Do not auto remove",
    //         "removeWorld": "Auto remove from world containers",
    //     },
    //     default: "removeWorld",
    //     restricted: true
    // });

    // game.settings.register(MODULE_ID, "autoRemoveItemsFromActor", {
    //     name: "Auto-Remove Dropped Items (Actors)",
    //     hint: "Automatically deletes the original source item when it is dragged from an actor's inventory onto another sheet.",
    //     scope: "world",
    //     config: true,
    //     type: String,
    //     choices: {
    //         "none": "Do not auto remove",
    //         "removeAll": "Auto remove from any actor",
    //         "removeCharacter": "Auto remove from characters",
    //         "removeNPC": "Auto remove from npcs",
    //         "removeGroup": "Auto remove from group actors",
    //         "removeCharacterGroup": "Auto remove from characters & groups",
    //         "removeNPCGroup": "Auto remove from npcs & groups",
    //         "removeCharacterNPC": "Auto remove from characters & npcs",
    //     },
    //     default: "removeAll",
    //     restricted: true
    // });

    game.settings.register(MODULE_ID, "enableDeathSavePrompt", {
        name: "Prompt for Death Saves",
        hint: "Automatically whispers a chat message with a Death Saving Throw button to the player and GM when their character starts a turn with 0 HP.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    // ==========================================
    // GROUP 4: Restrictions & Rules
    // ==========================================

    game.settings.register(MODULE_ID, "enableForceCompendiumBrowser", {
        name: "Force Compendium Browser",
        hint: "Forces players (non-GMs) to open the DnD5e Compendium Browser when clicking the Compendium tab instead of the default pack list.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "debugMode", {
        name: "Debug Mode",
        hint: "Enables detailed debug logging in the console for troubleshooting.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true,
        onChange: (value) => {
            log(`Debug mode ${value ? "enabled" : "disabled"}`);
        }
    });

    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initBloodDropIcon();
    initTokenResizer();
});

Hooks.once("setup", () => {
    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initForceCompendiumBrowser();
    initSceneNavName();
    initActorDispositionColors();
    initItemRarityColors();

    // Register settings for features that manage their own state
    initAutoClearMovementHistory();
    initDeathSavePrompt();
});

Hooks.once("ready", () => {

    // Features that can run at ready or need the game to be fully loaded
    if (game.settings.get(MODULE_ID, "enableCursorHints")) enableCursorHints();
    if (game.settings.get(MODULE_ID, "enableProneRotation")) enableProneRotation();
    if (game.settings.get(MODULE_ID, "enableSidebarNameWrap")) enableSidebarNameWrap();
});
