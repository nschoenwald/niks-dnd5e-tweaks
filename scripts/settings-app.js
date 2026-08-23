import { MODULE_ID, log } from "./main.js";

/**
 * Modern ApplicationV2 Settings Dashboard for Nik's D&D 5e Tweaks.
 * Provides categorized tabs, real-time search filtering, JSON import/export,
 * and permission-aware configuration for GMs and authorized players.
 */
export class NiksTweaksSettingsApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "niks-dnd5e-tweaks-settings-app",
        classes: ["nd5t-settings-app"],
        tag: "form",
        form: {
            handler: NiksTweaksSettingsApp.#onSubmit,
            closeOnSubmit: true
        },
        window: {
            title: "Nik's D&D 5e Tweaks — Settings Dashboard",
            icon: "fa-solid fa-sliders",
            resizable: true
        },
        position: {
            width: 820,
            height: 700
        },
        actions: {
            resetDefaults: NiksTweaksSettingsApp.#onResetDefaults,
            exportSettings: NiksTweaksSettingsApp.#onExportSettings,
            importSettings: NiksTweaksSettingsApp.#onImportSettings,
            close: (event, target) => target.closest(".nd5t-settings-app")?.querySelector(".header-control.close")?.click() || this.close()
        }
    };

    /** @override */
    static PARTS = {
        dashboard: {
            template: "modules/niks-dnd5e-tweaks/templates/settings-dashboard.hbs",
            scrollable: [".nd5t-settings-content"]
        }
    };

    /**
     * Active tab tracking (client-side state during the session)
     */
    #activeTab = "uiVisuals";

    /**
     * Settings definition schema categorized for the dashboard
     */
    static get SETTINGS_SCHEMA() {
        return [
            {
                id: "uiVisuals",
                label: "UI & Visuals",
                icon: "fa-solid fa-palette",
                description: "Tweaks affecting the user interface, sidebar, character sheets, and navigation elements.",
                sections: [
                    {
                        id: "uiGeneral",
                        title: "General Interface",
                        icon: "fa-solid fa-desktop",
                        settings: [
                            {
                                key: "enableSceneNavName",
                                name: "Sync Browser Tab Title",
                                hint: "Keeps the browser tab title dynamically in sync with the name of the scene the client is currently viewing.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableCursorHints",
                                name: "Cursor Keyboard Hints",
                                hint: "Displays small floating icons near the mouse cursor when modifier keys configured in the DnD5e system (such as Skip Dialog, Advantage, or Disadvantage) are held down.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableActorDispositionColors",
                                name: "Actor Directory Disposition Dots",
                                hint: "Adds a colored dot next to each actor name in the Actors sidebar to indicate their default token disposition (Friendly, Neutral, Hostile, or Secret).",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableBloodDropIcon",
                                name: "Blood Drop Bloodied Icon",
                                hint: "Replaces the default DnD5e \"bloodied\" condition icon with a red blood drop icon.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                requiresReload: true
                            },
                            {
                                key: "enableSidebarNameWrap",
                                name: "Sidebar Multi-line Names",
                                hint: "Allows long document names in the right sidebar (Actors, Items, Scenes, etc.) to wrap onto multiple lines instead of being cut off.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            }
                        ]
                    },
                    {
                        id: "uiSheets",
                        title: "Sheets & Toolbars",
                        icon: "fa-solid fa-file-lines",
                        settings: [
                            {
                                key: "enableCleanSheetTitles",
                                name: "Clean Sheet Window Titles",
                                hint: "Removes the verbose type prefix (e.g. \"Non Player Character:\") from document sheet window titles, showing just the document name.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                requiresReload: true
                            },
                            {
                                key: "cleanSheetTitles_format",
                                name: "Sheet Title Format",
                                hint: "How to display document sheet window titles. \"Name Only\" shows just the name (e.g. \"Goblin\"). \"Type: Name\" adds a prefix (e.g. \"Non Player Character: Goblin\"). \"Name (Type)\" adds a suffix (e.g. \"Goblin (Non Player Character)\").",
                                type: "Select",
                                default: "name",
                                choices: [
                                    { value: "name", label: "Name Only" },
                                    { value: "prefix", label: "Type: Name" },
                                    { value: "suffix", label: "Name (Type)" }
                                ],
                                scope: "world",
                                parentKey: "enableCleanSheetTitles"
                            },
                            {
                                key: "enableSheetPopoutButton",
                                name: "Sheet Pop-out Button",
                                hint: "Adds a one-click pop-out button (↗) to the header of Actor and Item sheets to detach into a separate window without the 3-dot menu.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                v14Only: true
                            },
                            {
                                key: "enableSheetPlusCompendium",
                                name: "Item/Spell/Feature Add: Choice Dialog",
                                hint: "When clicking the '+' button on character sheets, prompts to choose between creating a new document or opening the pre-filtered Compendium Browser.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableNpcHpScaling",
                                name: "NPC Hit Points Scaling Buttons",
                                hint: "Adds plus and minus buttons to the NPC Hit Points configuration dialog to easily scale hit dice and recalculate average HP and formula.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableToolbarLimitation",
                                name: "Toolbar Limitation",
                                hint: "When the number of buttons in a scene controls toolbar exceeds the limit, turns the toolbar scrollable and limits its visible height.",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "toolbarButtonLimit",
                                name: "Max Displayed Toolbar Buttons",
                                hint: "The maximum number of buttons to display in a toolbar before scrolling.",
                                type: "Number",
                                default: 20,
                                scope: "client",
                                parentKey: "enableToolbarLimitation"
                            }
                        ]
                    },
                    {
                        id: "compendiumSidebar",
                        title: "Compendium Sidebar",
                        icon: "fa-solid fa-book-bookmark",
                        settings: [
                            {
                                key: "enableForceCompendiumBrowser",
                                name: "Force Compendium Browser",
                                hint: "Forces non-GM users to open the DnD5e Compendium Browser when clicking the Compendium sidebar tab.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "allowShiftClickCompendiumSidebar",
                                name: "Allow Shift-Click to Bypass",
                                hint: "Players can hold Shift while clicking the Compendium tab to open the standard pack list.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                parentKey: "enableForceCompendiumBrowser"
                            }
                        ]
                    }
                ]
            },
            {
                id: "canvasTokens",
                label: "Canvas & Tokens",
                icon: "fa-solid fa-map",
                description: "Tweaks affecting the canvas, grid snapping, token rotation, sizing, and templates.",
                sections: [
                    {
                        id: "tokensCanvas",
                        title: "Token & Template Behaviors",
                        icon: "fa-solid fa-chess-knight",
                        settings: [
                            {
                                key: "enableProneRotation",
                                name: "Auto-Rotate Prone Tokens",
                                hint: "Automatically rotates tokens 90° clockwise when the Prone condition is applied, and rotates them back when removed.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableTokenResizer",
                                name: "Token Resizer Tool",
                                hint: "Adds a control button to the Token tools menu (GM-only) for quickly resizing selected tokens to standard 5e creature sizes.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableTemplateGridSnap",
                                name: "Snap Templates to Grid Intersections",
                                hint: "Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement. Hold Shift to override.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableTemplateTargeting",
                                name: "Auto-Target Tokens in Spell Templates",
                                hint: "When a spell or ability template is placed on the canvas, automatically targets all tokens within the template area in real time.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                v14Only: true
                            },
                            {
                                key: "enableAutoClearMovementHistory",
                                name: "Auto-Clear Movement History",
                                hint: "Automatically clears token movement history trails for all combatants at the start of each turn and when combat begins.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "disableUndergroundTokenHiding",
                                name: "Disable Underground Token Hiding",
                                hint: "Prevents tokens with negative elevation from disappearing behind the scene background layer.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                requiresReload: true
                            }
                        ]
                    }
                ]
            },
            {
                id: "combatAutomation",
                label: "Combat & Automation",
                icon: "fa-solid fa-hand-fist",
                description: "Automations and prompts structured across the 5 combat lifecycle phases.",
                sections: [
                    {
                        id: "phase1",
                        title: "Phase 1: Combat Setup & Initiative",
                        icon: "fa-solid fa-flag-checkered",
                        settings: [
                            {
                                key: "enableAutoAddTokensToCombat",
                                name: "Auto-Add Tokens to Combat",
                                hint: "Automatically adds new tokens to the active combat encounter when created or dragged to the canvas during combat.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "promptForInitiative",
                                name: "Prompt for Initiative",
                                hint: "Prompts connected players (or GM for NPCs) with the initiative dialog when added to active combat.",
                                type: "Select",
                                default: "players",
                                choices: [
                                    { value: "all", label: "For All" },
                                    { value: "players", label: "For Players" },
                                    { value: "npcs", label: "For NPCs" },
                                    { value: "none", label: "For None" }
                                ],
                                scope: "world"
                            },
                            {
                                key: "autoRollInitiative",
                                name: "Auto-Roll Initiative",
                                hint: "Automatically rolls initiative immediately without showing a dialog when added to active combat.",
                                type: "Select",
                                default: "none",
                                choices: [
                                    { value: "all", label: "For All" },
                                    { value: "players", label: "For Players" },
                                    { value: "npcs", label: "For NPCs" },
                                    { value: "none", label: "For None" }
                                ],
                                scope: "world"
                            },
                            {
                                key: "enableLegendaryActionPlaceholders",
                                name: "Legendary Action Placeholders",
                                hint: "Inserts placeholder turns in the combat tracker after each player turn when legendary creatures are present.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "showLegendaryActionPlaceholders",
                                name: "Show Placeholders to Players",
                                hint: "Make legendary action placeholder turns visible in the combat tracker to players.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                parentKey: "enableLegendaryActionPlaceholders"
                            },
                            {
                                key: "legendaryActionPlaceholderIcon",
                                name: "Placeholder Icon",
                                hint: "Select an icon for legendary action initiative placeholders.",
                                type: "FilePicker",
                                filePicker: "image",
                                default: "icons/svg/combat.svg",
                                scope: "world",
                                parentKey: "enableLegendaryActionPlaceholders"
                            }
                        ]
                    },
                    {
                        id: "phase2",
                        title: "Phase 2: Actions, Rolls & Damage Prompts",
                        icon: "fa-solid fa-bullseye",
                        settings: [
                            {
                                key: "enableAutoRollSaveDamage",
                                name: "Auto-Open Damage Dialog for Saves",
                                hint: "Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "promptForAttackDamage",
                                name: "Prompt for Attack Damage",
                                hint: "Opens the damage roll dialog automatically when an attack roll hits the target's AC.",
                                type: "Select",
                                default: "all",
                                choices: [
                                    { value: "all", label: "For All" },
                                    { value: "players", label: "For Players" },
                                    { value: "npcs", label: "For NPCs" },
                                    { value: "none", label: "For None" }
                                ],
                                scope: "world"
                            },
                            {
                                key: "autoRollAttackDamage",
                                name: "Auto-Roll Attack Damage",
                                hint: "Automatically rolls damage without dialog when an attack roll hits target AC. Takes precedence over Prompt.",
                                type: "Select",
                                default: "none",
                                choices: [
                                    { value: "all", label: "For All" },
                                    { value: "players", label: "For Players" },
                                    { value: "npcs", label: "For NPCs" },
                                    { value: "none", label: "For None" }
                                ],
                                scope: "world"
                            },
                            {
                                key: "enablePlayerDamagePrompt",
                                name: "Player Damage Prompt",
                                hint: "Whispers a chat card with breakdown (resistances, immunities) and one-click Apply button when damage is rolled against a player.",
                                type: "Boolean",
                                default: false,
                                scope: "world"
                            },
                            {
                                key: "damagePromptVisibility",
                                name: "Damage Prompt Whisper Visibility",
                                hint: "Controls who receives the damage prompt whisper.",
                                type: "Select",
                                default: "gmAndPlayer",
                                choices: [
                                    { value: "gmAndPlayer", label: "GM & Player" },
                                    { value: "playerOnly", label: "Player Only" }
                                ],
                                scope: "world",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "enableGmDamagePrompt",
                                name: "GM Damage Prompt for Player Attacks",
                                hint: "Whispers a damage prompt with breakdown to the GM when players roll attack damage against NPCs.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "enableNonAttackDamagePrompt",
                                name: "Non-Attack Damage Prompts",
                                hint: "Sends damage prompts for non-attack activities (saving throws with Full/Half buttons, utility abilities).",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "damagePromptLayout",
                                name: "Damage Prompt Layout",
                                hint: "Visual layout style: Structured (detailed breakdown table) or Classic (condensed text).",
                                type: "Select",
                                default: "structured",
                                choices: [
                                    { value: "structured", label: "Structured (Table)" },
                                    { value: "classic", label: "Classic (Text)" }
                                ],
                                scope: "world",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "suppressDamagePrompt",
                                name: "Suppress Damage Prompts (Personal)",
                                hint: "Hide damage prompt whispers in chat for yourself (per-user client setting).",
                                type: "Boolean",
                                default: false,
                                scope: "client",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "waitForDiceSoNice",
                                name: "Wait for Dice So Nice",
                                hint: "Delays damage prompt whispers until Dice So Nice 3D dice finish rolling.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                parentKey: "enablePlayerDamagePrompt"
                            },
                            {
                                key: "enableHealingContextMenu",
                                name: "Healing Roll Context Menu",
                                hint: "Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat cards.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                requiresReload: true
                            },
                            {
                                key: "enableSelfEffectApplication",
                                name: "Self Effect Application Prompt",
                                hint: "Whispers a one-click Apply button when using abilities that grant Active Effects to Self (e.g. Rage, Mirror Image).",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "selfEffectAlwaysPromptFeatures",
                                name: "Always Prompt Features",
                                hint: "Comma-separated list of item/feature names to always prompt with self-effect buttons (e.g. Mage Armor).",
                                type: "String",
                                default: "Mage Armor",
                                scope: "world",
                                parentKey: "enableSelfEffectApplication"
                            }
                        ]
                    },
                    {
                        id: "phase3",
                        title: "Phase 3: Concentration & Ongoing Effects",
                        icon: "fa-solid fa-brain",
                        settings: [
                            {
                                key: "enableAutoRollConcentration",
                                name: "Auto-Roll Concentration Saves",
                                hint: "Automatically rolls a Constitution save for concentration when taking damage.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "autoRollConcentrationFastForward",
                                name: "Fast-Forward Concentration Rolls",
                                hint: "When to skip the roll dialog and roll immediately.",
                                type: "Select",
                                default: "npcsOnly",
                                choices: [
                                    { value: "npcsOnly", label: "NPCs Only" },
                                    { value: "all", label: "All Actors" },
                                    { value: "playersOnly", label: "Players Only" },
                                    { value: "none", label: "Never (always show dialog)" }
                                ],
                                scope: "world",
                                parentKey: "enableAutoRollConcentration"
                            },
                            {
                                key: "autoEndConcentrationOnFailure",
                                name: "Auto-End Concentration on Save Failure",
                                hint: "Automatically terminates concentration effects on failed save.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                parentKey: "enableAutoRollConcentration"
                            },
                            {
                                key: "enableMageSlayerConcentration",
                                name: "Mage Slayer: Disadvantage on Concentration",
                                hint: "Targets damaged by a Mage Slayer make concentration saves with Disadvantage.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableAutoEndConcentration",
                                name: "Auto-End Concentration on Incapacitation",
                                hint: "Automatically terminates concentration when incapacitated, unconscious, dead, paralyzed, petrified, or stunned.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableAutoEndRage",
                                name: "Auto-End Class Features",
                                hint: "Automatically terminates Rage, Wrath of the Sea, and Starry Form on incapacitation.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            }
                        ]
                    },
                    {
                        id: "phase4",
                        title: "Phase 4: Health Thresholds & Incapacitation",
                        icon: "fa-solid fa-heart-crack",
                        settings: [
                            {
                                key: "enableAutoStatusZeroHP",
                                name: "Auto-Apply Status at 0 HP",
                                hint: "Automatically applies an overlay status condition to tokens when reaching 0 HP.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "autoStatusZeroHP_playerStatus",
                                name: "Player Token Status at 0 HP",
                                hint: "Overlay condition for player-owned tokens at 0 HP.",
                                type: "Select",
                                default: "unconscious",
                                choices: [
                                    { value: "unconscious", label: "Unconscious" },
                                    { value: "dead", label: "Dead" },
                                    { value: "none", label: "None (disabled)" }
                                ],
                                scope: "world",
                                parentKey: "enableAutoStatusZeroHP"
                            },
                            {
                                key: "autoStatusZeroHP_npcStatus",
                                name: "NPC Token Status at 0 HP",
                                hint: "Overlay condition for GM/NPC tokens at 0 HP.",
                                type: "Select",
                                default: "dead",
                                choices: [
                                    { value: "unconscious", label: "Unconscious" },
                                    { value: "dead", label: "Dead" },
                                    { value: "none", label: "None (disabled)" }
                                ],
                                scope: "world",
                                parentKey: "enableAutoStatusZeroHP"
                            },
                            {
                                key: "autoStatusZeroHP_playerCombat",
                                name: "Player Token Combat Action at 0 HP",
                                hint: "Action in the combat tracker when player drops to 0 HP.",
                                type: "Select",
                                default: "none",
                                choices: [
                                    { value: "defeated", label: "Mark Defeated" },
                                    { value: "remove", label: "Remove from Combat" },
                                    { value: "none", label: "None (do nothing)" }
                                ],
                                scope: "world",
                                parentKey: "enableAutoStatusZeroHP"
                            },
                            {
                                key: "autoStatusZeroHP_npcCombat",
                                name: "NPC Token Combat Action at 0 HP",
                                hint: "Action in the combat tracker when NPC drops to 0 HP.",
                                type: "Select",
                                default: "defeated",
                                choices: [
                                    { value: "defeated", label: "Mark Defeated" },
                                    { value: "remove", label: "Remove from Combat" },
                                    { value: "none", label: "None (do nothing)" }
                                ],
                                scope: "world",
                                parentKey: "enableAutoStatusZeroHP"
                            },
                            {
                                key: "enableDeathSavePrompt",
                                name: "Prompt for Death Saves",
                                hint: "Whispers a Death Saving Throw button when a player starts their combat turn at 0 HP.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            }
                        ]
                    },
                    {
                        id: "phase5",
                        title: "Phase 5: Encounter Conclusion",
                        icon: "fa-solid fa-trophy",
                        settings: [
                            {
                                key: "enableCombatExpTracker",
                                name: "Combat Experience Tracker",
                                hint: "Whispers an encounter summary to the GM tallying hostile NPC XP with a one-click button to distribute XP evenly to participating PCs.",
                                type: "Boolean",
                                default: false,
                                scope: "world"
                            }
                        ]
                    }
                ]
            },
            {
                id: "utilities",
                label: "Utilities & Debug",
                icon: "fa-solid fa-wrench",
                description: "Developer tools and debugging logs.",
                sections: [
                    {
                        id: "debugSection",
                        title: "Diagnostics",
                        icon: "fa-solid fa-bug",
                        settings: [
                            {
                                key: "debugMode",
                                name: "Debug Mode",
                                hint: "Enables verbose debug logging in the browser console for all module features.",
                                type: "Boolean",
                                default: false,
                                scope: "world"
                            }
                        ]
                    }
                ]
            }
        ];
    }

    /** @override */
    async _prepareContext(options) {
        const canModify = game.user.can("SETTINGS_MODIFY");
        const isV14 = game.release.generation >= 14;

        const tabs = NiksTweaksSettingsApp.SETTINGS_SCHEMA.map(tab => {
            const isActiveTab = tab.id === this.#activeTab;

            const sections = tab.sections.map(sec => {
                const settings = sec.settings
                    .filter(s => !s.v14Only || isV14)
                    .map(s => {
                        let value;
                        try {
                            value = game.settings.get(MODULE_ID, s.key);
                        } catch {
                            value = s.default;
                        }

                        // Prepare choices for select dropdowns
                        let choices = [];
                        if (s.type === "Select" && Array.isArray(s.choices)) {
                            choices = s.choices.map(c => ({
                                ...c,
                                selected: c.value === value
                            }));
                        }

                        // Build combined search index text
                        const searchText = `${s.name} ${s.hint || ""} ${tab.label} ${sec.title || ""}`.toLowerCase();

                        return {
                            ...s,
                            value,
                            choices,
                            isChild: Boolean(s.parentKey),
                            isClient: s.scope === "client",
                            searchText
                        };
                    });

                return {
                    ...sec,
                    settings
                };
            });

            return {
                ...tab,
                active: isActiveTab,
                sections
            };
        });

        return {
            tabs,
            canModify,
            isGM: game.user.isGM,
            activeTab: this.#activeTab
        };
    }

    /** @override */
    _onRender(context, options) {
        const html = this.element;

        // 1. Tab switching handlers
        const navTabs = html.querySelectorAll(".nd5t-nav-tab");
        const panels = html.querySelectorAll(".nd5t-tab-panel");

        navTabs.forEach(tabBtn => {
            tabBtn.addEventListener("click", () => {
                const targetTab = tabBtn.dataset.tab;
                this.#activeTab = targetTab;

                navTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === targetTab));
                panels.forEach(panel => panel.classList.toggle("active", panel.dataset.tab === targetTab));

                // Clear search if switching tabs manually
                const searchInput = html.querySelector(".nd5t-search-input");
                if (searchInput && searchInput.value) {
                    searchInput.value = "";
                    this.#performSearch("");
                }
            });
        });

        // 2. Search & Live Filtering
        const searchInput = html.querySelector(".nd5t-search-input");
        const searchClear = html.querySelector(".nd5t-search-clear");
        const btnClearSearch = html.querySelector(".nd5t-btn-clear-search");

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                this.#performSearch(e.target.value);
            });

            const clearHandler = () => {
                searchInput.value = "";
                searchInput.focus();
                this.#performSearch("");
            };

            if (searchClear) searchClear.addEventListener("click", clearHandler);
            if (btnClearSearch) btnClearSearch.addEventListener("click", clearHandler);
        }

        // 3. Parent-Child Reactive Toggles
        const parentCheckboxes = html.querySelectorAll(".nd5t-setting-row:not(.nd5t-child-setting) input[type='checkbox']");
        parentCheckboxes.forEach(cb => {
            cb.addEventListener("change", () => {
                this.#updateChildSettingStates();
            });
        });
        this.#updateChildSettingStates();

        // 4. FilePicker button handlers
        const filePickerBtns = html.querySelectorAll(".nd5t-file-picker-btn");
        filePickerBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const targetInput = html.querySelector(`#${targetId}`);
                if (!targetInput) return;

                const fp = new FilePicker({
                    type: btn.dataset.type || "image",
                    current: targetInput.value,
                    callback: (path) => {
                        targetInput.value = path;
                    }
                });
                fp.browse();
            });
        });

        // 5. Import File Input Change Handler
        const fileImportInput = html.querySelector(".nd5t-file-import-input");
        if (fileImportInput) {
            fileImportInput.addEventListener("change", (e) => this.#onFileSelected(e));
        }
    }

    /**
     * Updates disabled states for child settings based on parent checkbox status
     */
    #updateChildSettingStates() {
        const html = this.element;
        const childRows = html.querySelectorAll(".nd5t-setting-row[data-parent]");

        childRows.forEach(row => {
            const parentKey = row.dataset.parent;
            const parentRow = html.querySelector(`.nd5t-setting-row[data-key="${parentKey}"]`);
            const parentInput = parentRow?.querySelector("input[type='checkbox']");
            const isParentActive = parentInput ? parentInput.checked : true;

            const controls = row.querySelectorAll("input, select, button");
            if (!isParentActive) {
                row.classList.add("nd5t-parent-disabled");
                controls.forEach(ctrl => ctrl.setAttribute("disabled", "disabled"));
            } else {
                row.classList.remove("nd5t-parent-disabled");
                // Check overall user permissions before re-enabling
                const isClient = row.querySelector(".nd5t-badge.client") !== null;
                if (game.user.can("SETTINGS_MODIFY") || isClient) {
                    controls.forEach(ctrl => ctrl.removeAttribute("disabled"));
                }
            }
        });
    }

    /**
     * Performs instant client-side search across all tabs and settings
     */
    #performSearch(rawQuery) {
        const html = this.element;
        const query = rawQuery.trim().toLowerCase();
        const searchClear = html.querySelector(".nd5t-search-clear");
        const searchStatus = html.querySelector(".nd5t-search-status");
        const matchCountElem = html.querySelector(".nd5t-match-count");
        const noResultsElem = html.querySelector(".nd5t-no-results");
        const panels = html.querySelectorAll(".nd5t-tab-panel");
        const navTabs = html.querySelectorAll(".nd5t-nav-tab");
        const rows = html.querySelectorAll(".nd5t-setting-row");
        const sections = html.querySelectorAll(".nd5t-section");

        if (!query) {
            // Reset to normal tabbed layout
            if (searchClear) searchClear.style.display = "none";
            if (searchStatus) searchStatus.style.display = "none";
            if (noResultsElem) noResultsElem.style.display = "none";

            rows.forEach(r => r.style.display = "");
            sections.forEach(s => s.style.display = "");
            panels.forEach(p => {
                p.classList.toggle("active", p.dataset.tab === this.#activeTab);
            });
            navTabs.forEach(t => {
                t.classList.toggle("active", t.dataset.tab === this.#activeTab);
                const badge = t.querySelector(".tab-badge");
                if (badge) badge.style.display = "none";
            });
            return;
        }

        // Active Search Mode
        if (searchClear) searchClear.style.display = "flex";
        if (searchStatus) searchStatus.style.display = "block";

        let totalMatches = 0;
        const matchesByTab = {};

        // Check rows
        rows.forEach(row => {
            const text = (row.dataset.searchText || "").toLowerCase();
            const matches = text.includes(query);
            row.style.display = matches ? "flex" : "none";

            if (matches) {
                totalMatches++;
                const panel = row.closest(".nd5t-tab-panel");
                const tabId = panel?.dataset.tab;
                if (tabId) matchesByTab[tabId] = (matchesByTab[tabId] || 0) + 1;
            }
        });

        // Hide empty sections
        sections.forEach(sec => {
            const hasVisibleRows = Array.from(sec.querySelectorAll(".nd5t-setting-row")).some(r => r.style.display !== "none");
            sec.style.display = hasVisibleRows ? "block" : "none";
        });

        // In search mode, display all tab panels that have matches
        panels.forEach(panel => {
            const tabId = panel.dataset.tab;
            const count = matchesByTab[tabId] || 0;
            panel.classList.toggle("active", count > 0);
        });

        // Update badges on tab buttons
        navTabs.forEach(t => {
            const tabId = t.dataset.tab;
            const count = matchesByTab[tabId] || 0;
            const badge = t.querySelector(".tab-badge");
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? "inline-block" : "none";
            }
        });

        if (matchCountElem) matchCountElem.textContent = totalMatches;
        if (noResultsElem) noResultsElem.style.display = totalMatches === 0 ? "flex" : "none";
    }

    /**
     * Handles form submit and saving settings
     */
    static async #onSubmit(event, form, formData) {
        const canModify = game.user.can("SETTINGS_MODIFY");
        let hasChanges = false;
        let requiresReload = false;

        // Iterate through all settings in schema
        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (s.v14Only && game.release.generation < 14) continue;

                    // Enforce permission: non-authorized users can only save client-scoped settings
                    if (s.scope !== "client" && !canModify) continue;

                    let formVal = formData.object[s.key];
                    if (s.type === "Boolean") {
                        formVal = Boolean(formVal);
                    } else if (s.type === "Number") {
                        formVal = Number(formVal);
                    }

                    const currentVal = game.settings.get(MODULE_ID, s.key);
                    if (formVal !== undefined && formVal !== currentVal) {
                        await game.settings.set(MODULE_ID, s.key, formVal);
                        hasChanges = true;
                        if (s.requiresReload) requiresReload = true;
                    }
                }
            }
        }

        if (hasChanges) {
            ui.notifications.info("Nik's D&D 5e Tweaks settings saved successfully.");
            if (requiresReload) {
                SettingsConfig.reloadConfirm();
            }
        }
    }

    /**
     * Resets all settings to their default values
     */
    static async #onResetDefaults(event, target) {
        if (!game.user.can("SETTINGS_MODIFY")) {
            ui.notifications.error("You do not have permission to modify world settings.");
            return;
        }

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Reset Settings to Default" },
            content: "<p>Are you sure you want to reset all <strong>Nik's D&D 5e Tweaks</strong> settings to their default values?</p>",
            modal: true
        });

        if (!confirmed) return;

        let requiresReload = false;
        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (s.v14Only && game.release.generation < 14) continue;
                    const currentVal = game.settings.get(MODULE_ID, s.key);
                    if (currentVal !== s.default) {
                        await game.settings.set(MODULE_ID, s.key, s.default);
                        if (s.requiresReload) requiresReload = true;
                    }
                }
            }
        }

        ui.notifications.info("Nik's D&D 5e Tweaks settings have been reset to default values.");
        if (requiresReload) {
            SettingsConfig.reloadConfirm();
        }

        this.render();
    }

    /**
     * Exports all module settings to a JSON file
     */
    static #onExportSettings(event, target) {
        const settingsData = {};

        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    try {
                        settingsData[s.key] = game.settings.get(MODULE_ID, s.key);
                    } catch (err) {
                        settingsData[s.key] = s.default;
                    }
                }
            }
        }

        const exportPayload = {
            module: MODULE_ID,
            title: "Nik's D&D 5e Tweaks Settings Export",
            version: game.modules.get(MODULE_ID)?.version || "14.20.0",
            exportedAt: new Date().toISOString(),
            exportedBy: game.user.name,
            settings: settingsData
        };

        const filename = `niks-dnd5e-tweaks-settings-${new Date().toISOString().slice(0, 10)}.json`;
        saveDataToFile(JSON.stringify(exportPayload, null, 2), "application/json", filename);
        ui.notifications.info(`Settings exported to ${filename}`);
    }

    /**
     * Prompts the user to select a JSON file to import
     */
    static #onImportSettings(event, target) {
        if (!game.user.can("SETTINGS_MODIFY")) {
            ui.notifications.error("You do not have permission to modify world settings.");
            return;
        }

        const fileInput = this.element.querySelector(".nd5t-file-import-input");
        if (fileInput) {
            fileInput.value = "";
            fileInput.click();
        }
    }

    /**
     * Handles file selection for JSON import
     */
    async #onFileSelected(event) {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const rawContent = await readTextFromFile(file);
            const data = JSON.parse(rawContent);

            if (!data || data.module !== MODULE_ID || typeof data.settings !== "object") {
                ui.notifications.error("Invalid configuration file: not a Nik's D&D 5e Tweaks settings export.");
                return;
            }

            const keyCount = Object.keys(data.settings).length;
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Import Settings" },
                content: `<p>Found <strong>${keyCount}</strong> settings in <em>${file.name}</em>.</p><p>Import and apply these settings to your world now?</p>`,
                modal: true
            });

            if (!confirmed) return;

            let requiresReload = false;
            let appliedCount = 0;

            for (const [key, value] of Object.entries(data.settings)) {
                // Verify setting exists in registry
                if (game.settings.settings.has(`${MODULE_ID}.${key}`)) {
                    const current = game.settings.get(MODULE_ID, key);
                    if (current !== value) {
                        await game.settings.set(MODULE_ID, key, value);
                        appliedCount++;
                    }
                }
            }

            ui.notifications.info(`Successfully imported ${appliedCount} settings from ${file.name}.`);
            this.render();
        } catch (err) {
            log("Failed to import settings file", err);
            ui.notifications.error("Failed to parse settings JSON file: " + err.message);
        }
    }
}
