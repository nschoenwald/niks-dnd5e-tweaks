import { initForceCompendiumBrowser } from "./features/force-compendium-browser.js";
import { initAutoClearMovementHistory, disableAutoClearMovementHistory, enableAutoClearMovementHistory } from "./features/auto-clear-movement-history.js";
import { initSceneNavName } from "./features/scene-nav-name.js";
import { enableCursorHints, disableCursorHints } from "./features/cursor-hints.js";
import { enableProneRotation, disableProneRotation } from "./features/prone-rotation.js";
import { initTokenResizer } from "./features/token-resizer.js";
import { initDisableUndergroundTokenHiding } from "./features/disable-underground-token-hiding.js";
import { initActorDispositionColors } from "./features/actor-disposition-colors.js";
import { initTemplateGridSnap } from "./features/template-grid-snap.js";
import { enableSidebarNameWrap, disableSidebarNameWrap } from "./features/sidebar-name-wrap.js";
import { initBloodDropIcon } from "./features/blood-drop-icon.js";
import { initCleanSheetTitles } from "./features/clean-sheet-titles.js";
import { initToolbarLimitation, applyToolbarLimitation, resetToolbars } from "./features/toolbar-limitation.js";

import { initDeathSavePrompt } from "./features/death-save-prompt.js";
import { initAutoStatusZeroHP } from "./features/auto-status-zero-hp.js";
import { initLegendaryActionPlaceholders } from "./features/legendary-action-placeholders.js";
import { initHealingContextMenu } from "./features/healing-context-menu.js";
import { initAutoRollSaveDamage } from "./features/auto-roll-save-damage.js";
import { initPlayerDamagePrompt } from "./features/player-damage-prompt.js";
import { initCombatExpTracker } from "./features/combat-exp-tracker.js";
import { initAutoEndConcentration } from "./features/auto-end-concentration.js";
import { initAutoEndClassFeatures } from "./features/auto-end-class-features.js";
import { initAutoRollConcentration } from "./features/auto-roll-concentration.js";
import { initMageSlayerConcentration } from "./features/mage-slayer-concentration.js";
import { initSelfEffectApplication, onSocketMessage as selfEffectSocketMessage } from "./features/self-effect-application.js";
import { initSheetPlusCompendium } from "./features/sheet-plus-compendium.js";
import { initSheetPopoutButton, disableSheetPopoutButton } from "./features/sheet-popout-button.js";
import { initAutoAddTokensToCombat } from "./features/auto-add-tokens-to-combat.js";
import { initAutoRollInitiative } from "./features/auto-roll-initiative.js";
import { onSocketMessage as damagePromptSocketMessage } from "./features/player-damage-prompt.js";
import { initFixCastActivityDeletion } from "./features/fix-cast-activity-deletion.js";



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

    // V14+ only: the pop-out/attach button relies on ApplicationV2 and detachWindow(),
    // neither of which exist in V13. Hide the setting entirely on V13 so it doesn't
    // appear as a dead/confusing option in the module config UI.
    if (game.release.generation >= 14) {
        game.settings.register(MODULE_ID, "enableSheetPopoutButton", {
            name: "Sheet Pop-out Button",
            hint: "Adds a one-click pop-out button (\u2197) to the header of Actor and Item sheets, allowing you to detach the window into a separate browser window using Foundry V14's native pop-out functionality \u2014 without going through the three-dot menu. When the sheet is already detached, the button flips to an attach-back icon (\u2199) to return it to the main workspace.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true,
            restricted: true,
            onChange: (value) => {
                if (value) initSheetPopoutButton();
                else disableSheetPopoutButton();
            }
        });
    }

    game.settings.register(MODULE_ID, "enableSheetPlusCompendium", {
        name: "Item/Spell/Feature Add: Choice Dialog",
        hint: "When clicking the '+' button on character sheets in the Items, Spells, or Features tab, allows you to choose between creating a new document or directly opening the Compendium Browser. Defaults to opening the Compendium Browser (pre-filtered by class and level for spells, feats for features, and physical items for items).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableToolbarLimitation", {
        name: "Toolbar Limitation",
        hint: "When the number of buttons in a given scene controls toolbar exceeds a configured limit, turns the toolbar scrollable and limits the visible height to display only that number of buttons at a time (does not apply to the macro hotbar).",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: (value) => {
            if (value) applyToolbarLimitation();
            else resetToolbars();
            ui.controls?.render();
        }
    });

    game.settings.register(MODULE_ID, "toolbarButtonLimit", {
        name: "↳ Max Displayed Toolbar Buttons",
        hint: "The maximum number of buttons to display in a toolbar before it becomes scrollable.",
        scope: "client",
        config: true,
        type: Number,
        default: 20,
        onChange: () => {
            applyToolbarLimitation();
            ui.controls?.render();
        }
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

    game.settings.register(MODULE_ID, "enableAutoClearMovementHistory", {
        name: "Auto-Clear Movement History",
        hint: "Automatically clears token movement history trails for all combatants at the start of each combat turn and when combat starts (GM client only).",
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

    game.settings.register(MODULE_ID, "disableUndergroundTokenHiding", {
        name: "Disable Underground Token Hiding",
        hint: "Prevents tokens with negative elevation from disappearing behind the scene background. By default, Foundry renders tokens below elevation 0 behind the background layer, making them invisible. This tweak keeps them visible while preserving the actual elevation value. Requires a reload to take effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true,
        requiresReload: true
    });

    // ==========================================
    // GROUP 3: Automation & QOL Tasks
    // ==========================================

    // ── Phase 1: Combat Setup & Initiative ─────────────────────────────

    game.settings.register(MODULE_ID, "enableAutoAddTokensToCombat", {
        name: "Auto-Add Tokens to Combat",
        hint: "Automatically adds new tokens to the active combat encounter when created or dragged to the canvas during combat.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "promptForInitiative", {
        name: "Prompt for Initiative",
        hint: "Prompts connected players (or the GM for NPCs) with the initiative configuration dialog when a token or combatant is added to an active combat encounter.",
        scope: "world",
        config: true,
        type: String,
        default: "players",
        choices: {
            all: "For All",
            players: "For Players",
            npcs: "For NPCs",
            none: "For None"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoRollInitiative", {
        name: "Auto-Roll Initiative",
        hint: "Automatically rolls initiative immediately without showing a configuration dialog when a token or combatant is added to an active combat encounter.",
        scope: "world",
        config: true,
        type: String,
        default: "none",
        choices: {
            all: "For All",
            players: "For Players",
            npcs: "For NPCs",
            none: "For None"
        },
        restricted: true
    });

    // Hidden legacy settings for migration reading
    game.settings.register(MODULE_ID, "enableAutoRollInitiative", {
        scope: "world",
        config: false,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoRollInitiativeFastForward", {
        scope: "world",
        config: false,
        type: String,
        default: "none",
        restricted: true
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

    game.settings.register(MODULE_ID, "legendaryActionPlaceholderIcon", {
        name: "↳ Placeholder Icon",
        hint: "Select an icon to use for legendary action initiative placeholders.",
        scope: "world",
        config: true,
        type: String,
        filePicker: "image",
        default: "icons/svg/combat.svg",
        restricted: true
    });

    // ── Phase 2: Actions, Rolls & Damage Prompts ────────────────────────

    game.settings.register(MODULE_ID, "enableAutoRollSaveDamage", {
        name: "Auto-Open Damage Dialog for Saves",
        hint: "Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used. This mirrors the built-in behaviour of Attack activities, which already auto-open their attack roll dialog. Automatically disabled when midi-qol is active.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enablePlayerDamagePrompt", {
        name: "Player Damage Prompt",
        hint: "When the GM rolls attack damage against a targeted player token that was hit, whispers a chat message to the owning player with the damage breakdown (accounting for resistances, vulnerabilities, and immunities) and a button to apply the damage.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "damagePromptVisibility", {
        name: "↳ Damage Prompt Whisper Visibility",
        hint: "Controls who receives the damage prompt whisper when a player token is hit. 'GM & Player' sends to both the owning player and all GMs. 'Player Only' sends only to the owning player.",
        scope: "world",
        config: true,
        type: String,
        default: "gmAndPlayer",
        choices: {
            gmAndPlayer: "GM & Player",
            playerOnly: "Player Only"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableGmDamagePrompt", {
        name: "↳ GM Damage Prompt for Player Attacks",
        hint: "When a player rolls attack damage against an NPC token that was hit, whispers a damage prompt to the GM with the damage breakdown and an Apply Damage button. Requires the Player Damage Prompt feature to be enabled.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableNonAttackDamagePrompt", {
        name: "↳ Non-Attack Damage Prompts",
        hint: "When enabled, damage prompts are also sent for damage rolls originating from non-attack activities (like saving throws or utility abilities). For save activities, the prompt includes both Full and Half damage buttons.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "damagePromptLayout", {
        name: "↳ Damage Prompt Layout",
        hint: "Controls the visual layout of damage prompt messages. 'Structured' shows a table with per-type damage breakdown including trait modifiers. 'Classic' shows the original text-based layout.",
        scope: "world",
        config: true,
        type: String,
        default: "structured",
        choices: {
            structured: "Structured (Table)",
            classic: "Classic (Text)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "suppressDamagePrompt", {
        name: "↳ Suppress Damage Prompts (Player)",
        hint: "Hide damage prompt whispers in chat. This is a per-user setting — each player can choose independently whether to see damage prompts.",
        scope: "user",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID, "waitForDiceSoNice", {
        name: "↳ Wait for Dice So Nice",
        hint: "When enabled, damage prompt whispers are delayed until Dice So Nice finishes its 3D dice animation for the roll. This prevents the prompt from appearing before the dice have landed. Has no effect if Dice So Nice is not installed.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
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

    game.settings.register(MODULE_ID, "enableSelfEffectApplication", {
        name: "Self Effect Application Prompt",
        hint: "When an actor uses an ability that has Active Effects targeting \"Self\" (e.g. Rage, Divine Favor, Mirror Image), whispers a chat card to the actor's owner and the GM with one-click Apply buttons for each effect.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "selfEffectAlwaysPromptFeatures", {
        name: "↳ Always Prompt Features",
        hint: "A comma-separated list of feature or item names (case-insensitive). When these features are used and have an Active Effect attached, the self-effect application prompt will be posted even if they were not self-targeted.",
        scope: "world",
        config: true,
        type: String,
        default: "Mage Armor",
        restricted: true
    });

    // ── Phase 3: Concentration & Ongoing Effects ────────────────────────

    game.settings.register(MODULE_ID, "enableAutoRollConcentration", {
        name: "Auto-Roll Concentration Saves",
        hint: "Automatically rolls a Constitution saving throw for concentration when a concentrating token takes damage.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoRollConcentrationFastForward", {
        name: "↳ Fast-Forward Concentration Rolls",
        hint: "When to skip the roll configuration dialog and roll immediately. 'NPCs Only' skips for NPC tokens but shows the dialog for player-owned actors. 'All Actors' skips the dialog for everyone. 'Players Only' is the reverse. 'Never' always shows the dialog, pre-configured with the DC.",
        scope: "world",
        config: true,
        type: String,
        default: "npcsOnly",
        choices: {
            npcsOnly: "NPCs Only",
            all: "All Actors",
            playersOnly: "Players Only",
            none: "Never (always show dialog)"
        },
        restricted: true
    });

    game.settings.register(MODULE_ID, "autoEndConcentrationOnFailure", {
        name: "↳ Auto-End Concentration on Save Failure",
        hint: "Automatically ends concentration effects when a concentration saving throw fails. When disabled, concentration is not removed automatically, but an \"End Concentration\" button is provided on the chat card.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableMageSlayerConcentration", {
        name: "Mage Slayer: Concentration Disadvantage",
        hint: "When a creature with the Mage Slayer feat damages a concentrating target, the target rolls its concentration saving throw with Disadvantage. If the target has intrinsic Advantage (e.g. War Caster), the two cancel out to a normal roll.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableAutoEndConcentration", {
        name: "Auto-End Concentration",
        hint: "Automatically ends all concentration effects from a token when it becomes incapacitated, unconscious, dead, paralyzed, petrified, or stunned.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    game.settings.register(MODULE_ID, "enableAutoEndRage", {
        name: "Auto-End Class Features",
        hint: "Automatically ends ongoing class feature effects when a token gains an incapacitating condition. Covers: Barbarian Rage (and Wrath of the Sea for level 15+ Barbarians), and Druid Wild Shape Starry Form. Identifies each feature by item identifier or effect name.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        restricted: true
    });

    // ── Phase 4: Health Thresholds & Incapacitation ─────────────────────

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

    // ── Phase 5: Encounter Conclusion ──────────────────────────────────

    game.settings.register(MODULE_ID, "enableCombatExpTracker", {
        name: "Combat Experience Tracker",
        hint: "At the end of a combat encounter, whispers a summary to the GM tallying the XP of all hostile NPCs involved, with a button to distribute XP evenly to all participating player characters.",
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

    game.settings.register(MODULE_ID, "allowShiftClickCompendiumSidebar", {
        name: "↳ Allow Shift-Click to Bypass",
        hint: "When enabled, players can hold the Shift key while clicking the Compendium tab to access the regular Foundry compendium sidebar instead of the browser.",
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

    // Hidden setting to track migration version (not shown in config UI)
    game.settings.register(MODULE_ID, "migrationVersion", {
        scope: "world",
        config: false,
        type: Number,
        default: 0
    });

    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initBloodDropIcon();
    initTokenResizer();
    initDisableUndergroundTokenHiding();
    initToolbarLimitation();
});

Hooks.once("setup", () => {
    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initForceCompendiumBrowser();
    initSceneNavName();
    initActorDispositionColors();
    initCleanSheetTitles();

    // Register settings for features that manage their own state
    initAutoClearMovementHistory();
    initAutoAddTokensToCombat();
    initAutoRollInitiative();
    initDeathSavePrompt();
    initAutoStatusZeroHP();
    initLegendaryActionPlaceholders();
    initTemplateGridSnap();
    initHealingContextMenu();
    initAutoRollSaveDamage();
    initPlayerDamagePrompt();
    initAutoEndConcentration();
    initAutoEndClassFeatures();
    initAutoRollConcentration();
    initMageSlayerConcentration();
    initSelfEffectApplication();
    initSheetPlusCompendium();
    if (game.release.generation >= 14) initSheetPopoutButton();

    initCombatExpTracker();

    // Bug fixes
    initFixCastActivityDeletion();
});

Hooks.once("ready", async () => {

    // One-time migrations (GM only)
    if (game.user.isGM) await runMigrations();

    // Features that can run at ready or need the game to be fully loaded
    if (game.settings.get(MODULE_ID, "enableCursorHints")) enableCursorHints();
    if (game.settings.get(MODULE_ID, "enableProneRotation")) enableProneRotation();
    if (game.settings.get(MODULE_ID, "enableSidebarNameWrap")) enableSidebarNameWrap();

    // ── Central socket dispatcher ──────────────────────────────────────
    // A single listener routes incoming socket messages to the correct
    // feature handler by payload type.  This avoids the fragile pattern
    // of each feature registering its own game.socket.on() listener,
    // which can't be cleanly de-registered if a feature is hot-toggled.
    game.socket.on(`module.${MODULE_ID}`, (data) => {
        damagePromptSocketMessage(data);
        selfEffectSocketMessage(data);
    });
    log("Central socket dispatcher registered");

});

/**
 * Run one-time data migrations, gated by a stored version number.
 */
async function runMigrations() {
    const currentVersion = game.settings.get(MODULE_ID, "migrationVersion");

    // Migration 1: Remove stale "originalRotation" flags from token documents
    if (currentVersion < 1) {
        log("Running migration 1: clearing stale originalRotation flags...");
        for (const scene of game.scenes) {
            const updates = [];
            for (const token of scene.tokens) {
                if (token.getFlag(MODULE_ID, "originalRotation") !== undefined) {
                    updates.push({ _id: token.id, [`flags.${MODULE_ID}.-=originalRotation`]: null });
                }
            }
            if (updates.length) {
                await scene.updateEmbeddedDocuments("Token", updates);
                log(`  Cleared flags from ${updates.length} token(s) in scene "${scene.name}"`);
            }
        }
        await game.settings.set(MODULE_ID, "migrationVersion", 1);
        log("Migration 1 complete.");
    }

    // Migration 2: Migrate legacy boolean enableAutoRollInitiative & autoRollInitiativeFastForward
    if (currentVersion < 2) {
        log("Running migration 2: migrating initiative settings...");
        try {
            const oldEnable = game.settings.get(MODULE_ID, "enableAutoRollInitiative");
            const oldFastForward = game.settings.get(MODULE_ID, "autoRollInitiativeFastForward");

            let newPrompt = "all";
            let newAutoRoll = "none";

            if (oldEnable === false) {
                newPrompt = "none";
                newAutoRoll = "none";
            } else {
                if (oldFastForward === "all") {
                    newAutoRoll = "all";
                    newPrompt = "none";
                } else if (oldFastForward === "npcsOnly" || oldFastForward === "npcs") {
                    newAutoRoll = "npcs";
                    newPrompt = "players";
                } else if (oldFastForward === "playersOnly" || oldFastForward === "players") {
                    newAutoRoll = "players";
                    newPrompt = "npcs";
                } else {
                    newPrompt = "all";
                    newAutoRoll = "none";
                }
            }

            await game.settings.set(MODULE_ID, "promptForInitiative", newPrompt);
            await game.settings.set(MODULE_ID, "autoRollInitiative", newAutoRoll);
            log(`  Migrated initiative settings: promptForInitiative="${newPrompt}", autoRollInitiative="${newAutoRoll}"`);
        } catch (err) {
            log("  Could not read legacy initiative settings, using defaults.", err);
        }
        await game.settings.set(MODULE_ID, "migrationVersion", 2);
        log("Migration 2 complete.");
    }
}
