import { initForceCompendiumBrowser } from "./features/force-compendium-browser.js";
import { registerAutoClearMovementSettings, initAutoClearMovementHistory, disableAutoClearMovementHistory, enableAutoClearMovementHistory } from "./features/auto-clear-movement-history.js";
import { initSceneNavName } from "./features/scene-nav-name.js";
import { enableCursorHints, disableCursorHints } from "./features/cursor-hints.js";
import { enableProneRotation, disableProneRotation } from "./features/prone-rotation.js";
import { initTokenResizer } from "./features/token-resizer.js";
import { initActorDispositionColors } from "./features/actor-disposition-colors.js";
import { initTemplateGridSnap } from "./features/template-grid-snap.js";
import { enableSidebarNameWrap, disableSidebarNameWrap } from "./features/sidebar-name-wrap.js";
import { initBloodDropIcon } from "./features/blood-drop-icon.js";
import { initCleanSheetTitles } from "./features/clean-sheet-titles.js";

import { initDeathSavePrompt } from "./features/death-save-prompt.js";
import { initAutoStatusZeroHP } from "./features/auto-status-zero-hp.js";
import { initLegendaryActionPlaceholders } from "./features/legendary-action-placeholders.js";
import { initHealingContextMenu } from "./features/healing-context-menu.js";
import { initAutoRollSaveDamage } from "./features/auto-roll-save-damage.js";
import { initAutoFlyMode } from "./features/auto-fly-mode.js";


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
        hint: "Keeps the browser tab title dynamically in sync with the name of the scene the client is currently viewing.",
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
        name: "Cursor Keyboard Hints",
        hint: "Displays small floating icons near the mouse cursor when modifier keys configured in the DnD5e system (such as Skip Dialog, Advantage, or Disadvantage) are held down.",
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
        hint: "Adds a colored dot next to each actor name in the Actors sidebar to indicate their default token disposition (Friendly, Neutral, Hostile, or Secret).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            ui.actors.render();
        }
    });

    game.settings.register(MODULE_ID, "enableBloodDropIcon", {
        name: "Blood Drop Bloodied Icon",
        hint: "Replaces the default DnD5e \"bloodied\" condition icon with a red blood drop icon. Requires a reload to take effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID, "enableSidebarNameWrap", {
        name: "Sidebar Multi-line Names",
        hint: "Allows long document names in the right sidebar (Actors, Items, Scenes, etc.) to wrap onto multiple lines instead of being cut off.",
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

    game.settings.register(MODULE_ID, "enableCleanSheetTitles", {
        name: "Clean Sheet Window Titles",
        hint: "Removes the verbose type prefix (e.g. \"Non Player Character:\") from document sheet window titles, showing just the document name. Especially useful when detaching windows in V14, where the prefix otherwise consumes all visible space in the taskbar. Requires a reload to take effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID, "cleanSheetTitles_format", {
        name: "↳ Sheet Title Format",
        hint: "How to display document sheet window titles. \"Name Only\" shows just the name (e.g. \"Goblin\"). \"Type: Name\" adds a prefix (e.g. \"Non Player Character: Goblin\"). \"Name (Type)\" adds a suffix (e.g. \"Goblin (Non Player Character)\").",
        scope: "world",
        config: true,
        type: String,
        default: "name",
        choices: {
            name: "Name Only",
            prefix: "Type: Name",
            suffix: "Name (Type)"
        },
        restricted: true
    });

    // ==========================================
    // GROUP 2: Canvas & Tokens
    // ==========================================

    game.settings.register(MODULE_ID, "enableProneRotation", {
        name: "Auto-Rotate Prone Tokens",
        hint: "Automatically rotates tokens 90° clockwise when the Prone condition is applied, and rotates them back when it is removed.",
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
        hint: "Adds a control button to the Token tools menu (GM-only) for quickly resizing selected tokens to standard 5e creature sizes (Tiny, Small, Medium, Large, Huge, Gargantuan).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        onChange: () => {
            ui.controls.render();
        }
    });

    game.settings.register(MODULE_ID, "enableTemplateGridSnap", {
        name: "Snap Templates to Grid Intersections",
        hint: "Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement. Hold Shift to temporarily override and place freely. Cones and rays are not affected. Compatible with both V13 (MeasuredTemplates) and V14 (Regions).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableAutoFlyMode", {
        name: "Auto-Fly NPC Tokens",
        hint: "When dragging an NPC token onto the canvas, automatically sets its movement mode to flying if the actor's fly speed is at least as large as its walk speed.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableAutoClearMovementHistory", {
        name: "Auto-Clear Movement History",
        hint: "Automatically clears token movement history trails at the start of each combat turn (GM client only). Sub-settings below control exactly when clearing occurs.",
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

    game.settings.register(MODULE_ID, "enableAutoStatusZeroHP", {
        name: "Auto-Apply Status at 0 HP",
        hint: "Automatically applies a configurable status condition overlay to tokens when they reach 0 HP, and removes it when they are healed. Includes additional sub-settings for combat tracker actions.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoStatusZeroHP_playerStatus", {
        name: "↳ Player Token Status at 0 HP",
        hint: "Which overlay status condition to apply to player-owned tokens when they drop to 0 HP.",
        scope: "world",
        config: true,
        type: String,
        default: "unconscious",
        choices: {
            unconscious: "Unconscious",
            dead: "Dead",
            none: "None (disabled)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoStatusZeroHP_npcStatus", {
        name: "↳ NPC Token Status at 0 HP",
        hint: "Which overlay status condition to apply to GM-owned (NPC) tokens when they drop to 0 HP.",
        scope: "world",
        config: true,
        type: String,
        default: "dead",
        choices: {
            unconscious: "Unconscious",
            dead: "Dead",
            none: "None (disabled)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoStatusZeroHP_playerCombat", {
        name: "↳ Player Token Combat Action at 0 HP",
        hint: "What to do in the combat tracker when a player-owned token drops to 0 HP.",
        scope: "world",
        config: true,
        type: String,
        default: "none",
        choices: {
            defeated: "Mark Defeated",
            remove: "Remove from Combat",
            none: "None (do nothing)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoStatusZeroHP_npcCombat", {
        name: "↳ NPC Token Combat Action at 0 HP",
        hint: "What to do in the combat tracker when a GM-owned (NPC) token drops to 0 HP.",
        scope: "world",
        config: true,
        type: String,
        default: "defeated",
        choices: {
            defeated: "Mark Defeated",
            remove: "Remove from Combat",
            none: "None (do nothing)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableDeathSavePrompt", {
        name: "Prompt for Death Saves",
        hint: "When a player character starts their combat turn at 0 HP, automatically whispers a chat message with a Death Saving Throw button to the owning player and the GM.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableAutoRollSaveDamage", {
        name: "Auto-Open Damage Dialog for Saves",
        hint: "Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used. This mirrors the built-in behaviour of Attack activities, which already auto-open their attack roll dialog. Automatically disabled when midi-qol is active.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableHealingContextMenu", {
        name: "Healing Roll Context Menu",
        hint: "Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat messages. The DnD5e system only shows these options for damage rolls by default. Requires a reload to take effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID, "enableLegendaryActionPlaceholders", {
        name: "Legendary Action Placeholders",
        hint: "When a combat begins that includes a creature with legendary actions, inserts placeholder turns in the initiative tracker after each player character and friendly creature to help track legendary action usage.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "showLegendaryActionPlaceholders", {
        name: "↳ Show Placeholders to Players",
        hint: "By default, legendary action placeholder turns are hidden from players in the combat tracker. Enable this to make them visible.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    // ==========================================
    // GROUP 4: Restrictions & Rules
    // ==========================================

    game.settings.register(MODULE_ID, "enableForceCompendiumBrowser", {
        name: "Force Compendium Browser",
        hint: "Forces non-GM users to open the DnD5e Compendium Browser when they click the Compendium sidebar tab, instead of showing the default pack list.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    // ==========================================
    // Utilities
    // ==========================================

    game.settings.register(MODULE_ID, "debugMode", {
        name: "Debug Mode",
        hint: "Enables verbose debug logging in the browser console for all module features. Useful for troubleshooting issues.",
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
    initCleanSheetTitles();

    // Register settings for features that manage their own state
    initAutoClearMovementHistory();
    initDeathSavePrompt();
    initAutoStatusZeroHP();
    initLegendaryActionPlaceholders();
    initTemplateGridSnap();
    initHealingContextMenu();
    initAutoRollSaveDamage();
    initAutoFlyMode();
});

Hooks.once("ready", () => {

    // Features that can run at ready or need the game to be fully loaded
    if (game.settings.get(MODULE_ID, "enableCursorHints")) enableCursorHints();
    if (game.settings.get(MODULE_ID, "enableProneRotation")) enableProneRotation();
    if (game.settings.get(MODULE_ID, "enableSidebarNameWrap")) enableSidebarNameWrap();

});
