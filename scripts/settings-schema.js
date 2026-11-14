/**
 * Dashboard schema of Nik's DnD5e Tweaks: tabs → sections → settings.
 *
 * Registered with the shared dashboard of Nik's Foundry Tweaks (`core-integration.js`). Keys here are the module's
 * own setting keys; the registry qualifies them (and `parentKey` / `pairedWith`) with the module id. Tabs and
 * sections with the same id as core's are merged into core's (core's labels win); this module's own tabs set an
 * `order` (core: 0, 10, 20, 30, Utilities & Debug 100).
 *
 * Besides the setting's own data, entries carry dashboard metadata:
 * - `introduced`: module version that added the setting ("New" badges, taken from the git history).
 * - `pairedWith`: on a personal (client) setting, the world setting it belongs to.
 * - `docs`: README heading anchor of the feature.
 * - `keywords`: extra search terms (spell, feature or rule names).
 * - `parentKey`, `unavailableWith`, `requiresModule`, `list`, `statusPicker`.
 *
 * @introduced v14.69.0 (moved out of settings-app.js)
 * @updated v14.70.0 (system-independent entries moved to Nik's Foundry Tweaks; tab order, status picker condition check)
 */
import { DEFAULT_HIDDEN_STATUSES, isSystemCondition } from "./features/canvas-tokens/condition-hud.js";
import { overrideSchemaChoices } from "./utils/personal-override.js";

/**
 * @returns {object[]} The tabs of this module's dashboard schema.
 */
export function getSettingsSchema() {
    return [
        {
            id: "personalPreferences",
            label: "Personal Preferences",
            icon: "fa-solid fa-user-gear",
            description: "Settings for your own screen only. Turn prompts, auto-rolls and visual features on or off for yourself without affecting other players or the GM.",
            sections: [
                {
                    id: "clientWorkflow",
                    title: "Workflow & Action Prompts",
                    icon: "fa-solid fa-bolt",
                    settings: [
                        {
                            key: "clientSheetPlusCompendium",
                            introduced: "14.28.5",
                            pairedWith: "enableSheetPlusCompendium",
                            name: "Item/Spell Add: Choice Dialog",
                            hint: "When clicking '+' on character sheets, prompts to choose between creating an item or opening the Compendium Browser. Turn off to always create items directly. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientSpellSlotsLeftToRight",
                            introduced: "14.72.0",
                            pairedWith: "enableSpellSlotsLeftToRight",
                            name: "Spell Slots Expend Left to Right",
                            hint: "Expended spell slots fill up from the left, and clicking a slot expends it and every slot to its left. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAttackDamagePrompt",
                            introduced: "14.28.5",
                            pairedWith: "promptForAttackDamage",
                            unavailableWith: "midi",
                            name: "Prompt for Attack Damage",
                            hint: "Automatically opens the damage dialog when your player character's attack roll hits target AC (if enabled by the GM). Turn off to roll damage manually from the chat card.",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAutoRollAttackDamage",
                            introduced: "14.28.5",
                            pairedWith: "autoRollAttackDamage",
                            unavailableWith: "midi",
                            name: "Auto-Roll Attack Damage",
                            hint: "Automatically rolls damage immediately when your player character's attack roll hits target AC (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAutoRollSaveDamage",
                            introduced: "14.28.5",
                            pairedWith: "enableAutoRollSaveDamage",
                            unavailableWith: "midi",
                            name: "Auto-Open Damage for Saves",
                            hint: "Automatically opens the damage roll dialog when you use a Save-type activity with damage (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableWeaponMasteries",
                            introduced: "14.42.0",
                            pairedWith: "enableWeaponMasteries",
                            unavailableWith: "wm5e",
                            name: "Weapon Mastery Automation",
                            hint: "Enables automatic weapon mastery effects on your client when making weapon attacks (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableConditionalDamage",
                            introduced: "14.45.0",
                            pairedWith: "enableConditionalDamage",
                            name: "Conditional Damage Bonuses",
                            hint: "Offers toggles in damage roll dialogs for Sneak Attack, Hex, Hunter's Mark, Great Weapon Master (2024), Brutal Strike, Charger (2024), Savage Attacker (2024), Boon of Irresistible Offense (2024), Genie's Wrath and the Cleave weapon mastery malus, plus Player's Handbook class features, species traits and spell bonuses (Colossus Slayer, Divine Strike, Primal Strike, Divine Fury, Frenzy, Dreadful Strikes, Dread Ambusher, Elemental Epitome, Fire's Burn, Frost's Chill, Celestial Revelation, Lunar Form, Psionic Strike, Hand of Harm, Eldritch Smite, Lifedrinker, Empowered Evocation, Radiant Soul). Features that cost uses, Focus Points or a Pact slot spend them when ticked. Great Weapon Fighting and Elemental Adept apply automatically, remembering your choices across rolls (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableRecklessAttack",
                            introduced: "14.80.0",
                            pairedWith: "enableRecklessAttack",
                            name: "Reckless Attack Choice",
                            hint: "Offers the Reckless Attack choice (dialog checkbox or prompt) on your first attack of the turn (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableInitiativePrompt",
                            introduced: "14.28.5",
                            pairedWith: "promptForInitiative",
                            name: "Prompt for Initiative",
                            hint: "Prompts you with the initiative roll dialog when your token is added to combat (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAutoRollInitiative",
                            introduced: "14.28.5",
                            pairedWith: "autoRollInitiative",
                            name: "Auto-Roll Initiative",
                            hint: "Automatically rolls initiative immediately when your token is added to combat (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableSelfEffectApplication",
                            introduced: "14.28.5",
                            pairedWith: "enableSelfEffectApplication",
                            name: "Self Effect Application Prompt",
                            hint: "Whispers an Apply button when you use an ability that grants Active Effects to yourself (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableSelfTargetCorrection",
                            introduced: "14.73.0",
                            pairedWith: "enableSelfTargetCorrection",
                            unavailableWith: "midi",
                            name: "Self-Targeted Activities Target Self",
                            hint: "When you use an ability that only affects yourself, its chat card targets your own token instead of the tokens you still have targeted (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableDeathSavePrompt",
                            introduced: "14.28.5",
                            pairedWith: "enableDeathSavePrompt",
                            name: "Prompt for Death Saves",
                            hint: "Automatically opens the death save roll dialog when you start your combat turn at 0 HP (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "suppressDamagePrompt",
                            introduced: "14.10.0",
                            pairedWith: "enablePlayerDamagePrompt",
                            name: "Suppress Damage Prompts",
                            hint: "Hide incoming player damage prompt whispers in chat for yourself.",
                            type: "Boolean",
                            default: false,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAggregateShortRestRolls",
                            introduced: "14.41.0",
                            pairedWith: "enableAggregateShortRestRolls",
                            name: "Aggregate Short Rest Hit Dice Rolls",
                            hint: "Consolidate your short rest hit dice rolls into a single aggregated chat card and changelog (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        }
                    ]
                },
                {
                    id: "clientVisuals",
                    title: "Interface & Visual Enhancements",
                    icon: "fa-solid fa-wand-magic-sparkles",
                    settings: [
                        {
                            key: "clientCursorHints",
                            introduced: "14.28.5",
                            pairedWith: "enableCursorHints",
                            name: "Cursor Keyboard Hints",
                            hint: "Displays floating Alt/Shift/Ctrl modifier badges near your cursor. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientRollModeHighlight",
                            introduced: "14.28.5",
                            pairedWith: "enableRollModeHighlight",
                            name: "Roll Mode Highlight",
                            hint: "Highlights the recommended Advantage/Disadvantage button in d20 roll dialogs. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientChatCardStyling",
                            introduced: "14.28.5",
                            pairedWith: "enableChatCardStyling",
                            name: "Chat Card Styling Improvements",
                            hint: "Applies enhanced action buttons with text labels and ability shorthand (e.g. CON Save), roll badges, multi-die indicators, and color coding to chat cards on your screen. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableRollBreakdownDetails",
                            introduced: "14.43.0",
                            pairedWith: "enableRollBreakdownDetails",
                            name: "Detailed Roll Breakdown Overlay",
                            hint: "Displays the comprehensive breakdown showing the base die and modifier sources (e.g. +3 STR bonus, +2 PB, +1d4 Bless, -2 Exhaustion 1) when clicking roll totals (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableRetroactiveAdvantage",
                            introduced: "14.29.0",
                            pairedWith: "enableRetroactiveAdvantage",
                            name: "Retroactive Advantage/Disadvantage",
                            hint: "Display retroactive advantage/disadvantage buttons on d20 rolls (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnablePactSpellFormulaScaling",
                            introduced: "14.46.0",
                            pairedWith: "enablePactSpellFormulaScaling",
                            name: "Fix Pact Magic Formula Scaling",
                            hint: "Displays scaled damage and healing formulas for Pact Magic spells in the Formula column and activity rows of character sheets based on your caster's pact slot level (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientCompendiumBrowserColumns",
                            introduced: "14.83.0",
                            pairedWith: "enableCompendiumBrowserColumns",
                            name: "Compendium Browser Columns",
                            hint: "Extra sortable columns in the Compendium Browser results. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientItemSheetAttunementTag",
                            introduced: "14.33.0",
                            pairedWith: "enableItemSheetAttunementTag",
                            name: "Item Sheet Attunement Tag",
                            hint: "Shows the attunement tag on magic item sheets. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientItemSheetAttunementTag_placement",
                            introduced: "14.33.0",
                            pairedWith: "itemSheetAttunementTag_placement",
                            name: "Attunement Tag Placement",
                            hint: "Where to display the attunement tag on your screen.",
                            type: "Select",
                            default: "default",
                            choices: [
                                { value: "default", label: "Follow World Default" },
                                { value: "both", label: "Header & Description Pills" },
                                { value: "header", label: "Header Badge Only" },
                                { value: "description", label: "Description Pills Only" },
                                { value: "subtitle", label: "Header Subtitle Only" }
                            ],
                            scope: "client",
                            parentKey: "clientItemSheetAttunementTag"
                        },
                        {
                            key: "clientItemSheetAttunementTagTooltip",
                            introduced: "14.33.0",
                            pairedWith: "itemSheetAttunementTag_tooltip",
                            name: "Show in Item Tooltips",
                            hint: "Display the attunement pill in rich item tooltips on your screen. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client",
                            parentKey: "clientItemSheetAttunementTag"
                        }
                    ]
                },
                {
                    id: "clientCanvas",
                    title: "Canvas & Templates",
                    icon: "fa-solid fa-shapes",
                    settings: [
                        {
                            key: "clientEnableTemplateTargeting",
                            introduced: "14.28.5",
                            pairedWith: "enableTemplateTargeting",
                            unavailableWith: "midi",
                            name: "Auto-Target Tokens in Spell Templates",
                            hint: "Automatically targets tokens inside spell templates placed by you (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableTemplateGridSnap",
                            introduced: "14.28.5",
                            pairedWith: "enableTemplateGridSnap",
                            unavailableWith: "midi",
                            name: "Snap Templates to Grid Intersections",
                            hint: "Snaps circle and square spell templates to grid intersections when placed by you (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientTemplateControlsHUD",
                            introduced: "14.35.0",
                            pairedWith: "enableTemplateControlsHUD",
                            name: "Template Placement Controls HUD & Scroll Rotation",
                            hint: "Shows a floating HUD banner with key controls and inverts wheel scrolling during template placement so scrolling rotates the template and Shift + scroll zooms the canvas. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientEnableAutoAttachSelfEmanations",
                            introduced: "14.37.0",
                            pairedWith: "enableAutoAttachSelfEmanations",
                            name: "Auto-Attach Self Emanation Templates",
                            hint: "Automatically attaches self-targeted emanation templates (e.g. Spirit Guardians, Paladin auras) directly to your token without requiring manual canvas placement (if enabled by the GM).",
                            type: "Boolean",
                            default: true,
                            scope: "client"
                        },
                        {
                            key: "clientSummonControlsHUD",
                            introduced: "14.36.0",
                            pairedWith: "enableSummonControlsHUD",
                            name: "Summoning Placement Controls HUD",
                            hint: "Shows a floating HUD banner with key controls, live distance vs. max range badge, and canvas range ring during summoning placement. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        },
                        {
                            key: "clientConditionHud",
                            introduced: "14.63.0",
                            pairedWith: "enableConditionHud",
                            name: "Token HUD Condition Palette",
                            hint: "Shows the Token HUD's status palette as a labelled, grouped list. Turn off for the original icon grid. Use World Setting follows the GM.",
                            type: "Select",
                            default: "world",
                            choices: overrideSchemaChoices(),
                            overridesWorld: true,
                            scope: "client"
                        }
                    ]
                }
            ]
        },
        {
            id: "uiVisuals",
            label: "UI & Visuals",
            icon: "fa-solid fa-palette",
            description: "The interface: sidebar, sheets, roll dialogs, chat log and compendiums.",
            sections: [
                {
                    id: "uiGeneral",
                    title: "General Interface",
                    icon: "fa-solid fa-desktop",
                    settings: [
                        {
                            key: "enableCursorHints",
                            introduced: "14.0.0",
                            docs: "cursor-keyboard-hints",
                            keywords: ["modifier keys", "Shift", "Alt", "Ctrl", "fast forward"],
                            name: "Cursor Keyboard Hints",
                            hint: "Displays small floating icons near the mouse cursor when modifier keys configured in the DnD5e system (such as Skip Dialog, Advantage, or Disadvantage) are held down.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableBloodDropIcon",
                            introduced: "14.1.0",
                            docs: "blood-drop-bloodied-icon",
                            keywords: ["bloodied", "icon"],
                            name: "Blood Drop Bloodied Icon",
                            hint: "Replaces the default DnD5e \"bloodied\" condition icon with a red blood drop icon.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            requiresReload: true
                        }
                    ]
                },
                {
                    id: "uiSheets",
                    title: "Sheets & Items",
                    icon: "fa-solid fa-file-lines",
                    settings: [
                        {
                            key: "actorItemDragBehavior",
                            introduced: "14.53.0",
                            docs: "dragging-items-between-actors",
                            keywords: ["drag and drop", "loot", "transfer", "give item", "inventory", "trade"],
                            name: "Dragging Items Between Actors",
                            hint: "What happens when you drag an inventory item from one actor's sheet to another, e.g. from a character to a group. \"Always Move\" removes it from the original actor. \"Move, but Copy from NPCs\" leaves NPCs' gear in place so you can loot without changing their stat blocks. \"Always Copy\" keeps the D&D 5e default. Hold Shift to force a move or Ctrl to force a copy. Items are copied whenever you aren't allowed to remove them from the original actor. Spells, features and classes are always copied.",
                            type: "Select",
                            default: "move",
                            choices: [
                                { value: "move", label: "Always Move" },
                                { value: "moveExceptNPC", label: "Move, but Copy from NPCs" },
                                { value: "copy", label: "Always Copy (D&D 5e Default)" }
                            ],
                            scope: "world"
                        },
                        {
                            key: "enablePactSpellFormulaScaling",
                            introduced: "14.46.0",
                            docs: "pact-magic-formula-scaling-fix",
                            keywords: ["warlock", "pact magic"],
                            name: "Fix Pact Magic Formula Scaling",
                            hint: "Displays scaled damage and healing formulas for Pact Magic spells in the Formula column and activity rows of character sheets based on the caster's pact slot level.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableItemSheetAttunementTag",
                            introduced: "14.33.0",
                            docs: "item-sheet-attunement-tag",
                            keywords: ["magic item", "attuned"],
                            name: "Item Sheet Attunement Tag",
                            hint: "Adds a clear 'Attunement Required' or 'No Attunement Required' tag to magic item sheets. Clicking an attunement badge on an owned item allows quickly toggling the attuned state.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "itemSheetAttunementTag_placement",
                            introduced: "14.33.0",
                            name: "Attunement Tag Placement",
                            hint: "Where to display the attunement tag on item sheets: both header and description pills, header badge only, description pills only, or header subtitle line only.",
                            type: "Select",
                            default: "both",
                            choices: [
                                { value: "both", label: "Header & Description Pills" },
                                { value: "header", label: "Header Badge Only" },
                                { value: "description", label: "Description Pills Only" },
                                { value: "subtitle", label: "Header Subtitle Only" }
                            ],
                            scope: "world",
                            parentKey: "enableItemSheetAttunementTag"
                        },
                        {
                            key: "itemSheetAttunementTag_tooltip",
                            introduced: "14.33.0",
                            name: "Show in Item Tooltips",
                            hint: "Also displays the Attunement Required or No Attunement Required pill in rich item tooltips (e.g. when hovering over items in actor sheets, compendiums, or chat links).",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableItemSheetAttunementTag"
                        },
                        {
                            key: "enableSheetPlusCompendium",
                            introduced: "14.14.0",
                            docs: "item--spell--feature-add-choice-dialog",
                            keywords: ["add item", "plus button", "compendium browser"],
                            name: "Item/Spell/Feature Add: Choice Dialog",
                            hint: "When clicking the '+' button on character sheets, prompts to choose between creating a new document or opening the pre-filtered Compendium Browser.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableSpellSlotsLeftToRight",
                            introduced: "14.72.0",
                            docs: "spell-slots-expend-left-to-right",
                            keywords: ["spell slot", "pips", "expend", "spellbook", "left to right"],
                            name: "Spell Slots Expend Left to Right",
                            hint: "On actor sheets, expended spell slots fill up from the left, and clicking a slot expends it and every slot to its left. Clicking the right-most expended slot restores it. D&D 5e itself expends from the right, so clicking the 1st slot expends all the others. Temporary slots keep the D&D 5e behaviour.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableNpcHpScaling",
                            introduced: "14.21.1",
                            docs: "npc-hit-point-scaling-buttons",
                            keywords: ["hit dice", "monster", "HP formula"],
                            name: "NPC Hit Points Scaling Buttons",
                            hint: "Adds plus and minus buttons to the NPC Hit Points configuration dialog to easily scale hit dice and recalculate average HP and formula.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "rollDialogs",
                    title: "Roll Dialogs",
                    icon: "fa-solid fa-dice-d20",
                    settings: [
                        {
                            key: "enableRollModeHighlight",
                            introduced: "14.25.0",
                            docs: "roll-mode-highlight",
                            keywords: ["advantage", "disadvantage", "recommended"],
                            name: "Roll Mode Highlight",
                            hint: "When the system calculates a recommended advantage mode for a d20 roll (e.g. Advantage for War Caster, Disadvantage from a condition), persistently highlights the matching button so it remains visible after interacting with other fields in the dialog. Follows Automated Conditions 5e's recommendation when active.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "rollModeHighlightStyle",
                            introduced: "14.25.0",
                            name: "Highlight Style",
                            hint: "Glow: pulsing gold/blue box-shadow. Border: coloured inset border. Badge: small \"Recommended\" label above the button. Fill: translucent background fill.",
                            type: "Select",
                            default: "glow",
                            choices: [
                                { value: "glow",   label: "Glow (pulsing shadow)" },
                                { value: "border", label: "Border (inset outline)" },
                                { value: "badge",  label: "Badge (Recommended label)" },
                                { value: "fill",   label: "Fill (background)" },
                                { value: "none",   label: "None" }
                            ],
                            scope: "world",
                            parentKey: "enableRollModeHighlight"
                        },
                        {
                            key: "rollModeHighlightNormal",
                            introduced: "14.25.0",
                            name: "Highlight Normal Mode Too",
                            hint: "When the system's calculated mode is Normal (no advantage or disadvantage), also highlight the Normal button. Off by default since Normal is already the obvious fallback.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableRollModeHighlight"
                        },
                        {
                            key: "rollModeHighlightColor",
                            introduced: "14.25.0",
                            name: "Highlight Color",
                            hint: "Custom color for the calculated roll mode highlight. Overrides the per-mode default colors. Reset to #c9a227 to restore the default gold tone.",
                            type: "Color",
                            default: "#c9a227",
                            scope: "world",
                            parentKey: "enableRollModeHighlight"
                        }
                    ]
                },
                {
                    id: "chatLog",
                    title: "Chat Log",
                    icon: "fa-solid fa-comments",
                    settings: [
                        {
                            key: "enableRetroactiveAdvantage",
                            introduced: "14.29.0",
                            docs: "retroactive-advantage--disadvantage",
                            keywords: ["reroll", "change roll mode", "forgot advantage"],
                            name: "Retroactive Advantage/Disadvantage",
                            hint: "Allows changing a d20 roll between Normal, Advantage, and Disadvantage after it has been rolled, preserving original die results and automatically updating attack targets. Not offered on midi-qol workflow cards.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "retroactiveAdvantageHoverOnly",
                            introduced: "14.29.0",
                            name: "Show Only on Hover",
                            hint: "Only display the retroactive advantage buttons when hovering over the chat card.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableRetroactiveAdvantage"
                        },
                        {
                            key: "enableChatCardStyling",
                            introduced: "14.28.0",
                            docs: "chat-card-styling-improvements",
                            keywords: ["buttons", "colors"],
                            name: "Chat Card Styling Improvements",
                            hint: "Enhances DnD5e chat cards with improved visuals, such as making action buttons (Attack, Damage, Save with ability shorthand like CON Save, Check, Heal) larger, clearer, and color-coded with text labels in both light and dark themes.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableRollBreakdownDetails",
                            introduced: "14.43.0",
                            docs: "detailed-roll-breakdown-overlay",
                            keywords: ["tooltip", "modifiers", "bonus", "roll total"],
                            name: "Detailed Roll Breakdown Overlay",
                            hint: "Replaces the unlabeled numbers in the roll total popover with a comprehensive breakdown showing the base die, dice rolls, and where every bonus/penalty originates (e.g. +3 STR bonus, +2 PB, +1d4 Bless, -2 Exhaustion 1).",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAutoCollapseHostileDamageTrays",
                            introduced: "14.31.0",
                            docs: "auto-collapse-hostile--unowned-damage--healing-trays",
                            keywords: ["damage tray", "apply damage"],
                            name: "Auto-Collapse Hostile Damage Trays for GM",
                            hint: "Automatically collapses damage and healing application trays for the GM when rolls from hostile NPCs target player characters and DnD5e's 'Allow Players to Apply Damage' setting is enabled.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAutoCollapsePlayerDamageTrays",
                            introduced: "14.38.0",
                            docs: "auto-collapse-hostile--unowned-damage--healing-trays",
                            keywords: ["damage tray", "apply damage"],
                            name: "Auto-Collapse Unowned Damage Trays for Players",
                            hint: "Automatically collapses damage application trays for players when no targeted tokens are owned by them (such as damage rolls targeting NPCs). For healing or temporary HP rolls aimed at enemies, the tray remains open and automatically switches to selected tokens.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAggregateShortRestRolls",
                            introduced: "14.41.0",
                            docs: "aggregate-short-rest-hit-dice-rolls",
                            keywords: ["hit dice", "short rest", "changelog"],
                            name: "Aggregate Short Rest Hit Dice Rolls",
                            hint: "Aggregates all hit dice rolls made during a short rest into a single chat card and consolidates changelogs into two summary entries (HP & Hit Dice) when niks-tiny-changelogs is used. Rolls 3D dice per click for the active player without chat spam.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "compendiumSidebar",
                    title: "Compendiums",
                    icon: "fa-solid fa-book-bookmark",
                    settings: [
                        {
                            key: "enableForceCompendiumBrowser",
                            introduced: "14.0.0",
                            docs: "force-compendium-browser",
                            keywords: ["compendium packs"],
                            name: "Force Compendium Browser",
                            hint: "Forces non-GM users to open the DnD5e Compendium Browser when clicking the Compendium sidebar tab.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "allowShiftClickCompendiumSidebar",
                            introduced: "14.11.21",
                            name: "Allow Shift-Click to Bypass",
                            hint: "Players can hold Shift while clicking the Compendium tab to open the standard pack list.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableForceCompendiumBrowser"
                        },
                        {
                            key: "enableCompendiumBrowserColumns",
                            introduced: "14.83.0",
                            docs: "compendium-browser-columns",
                            keywords: ["compendium browser", "sort", "columns", "spell level", "rarity", "price", "challenge rating", "background"],
                            name: "Compendium Browser Columns",
                            hint: "Adds columns that fit the current tab to the Compendium Browser results and makes every column header click-to-sort (click again to reverse). Spells: level, school, concentration/ritual. Items: rarity (with attunement), price, weight. Monsters: CR, type. Feats: category, level. Classes: hit die, spellcasting, primary ability. Subclasses: class. Backgrounds: ability scores, feat. Vehicles: vehicle type.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                }
            ]
        },
        {
            id: "canvasTokens",
            label: "Canvas & Tokens",
            icon: "fa-solid fa-map",
            description: "Tokens, the Token HUD, and placing templates, summons and teleports on the canvas.",
            sections: [
                {
                    id: "tokens",
                    title: "Tokens & Token HUD",
                    icon: "fa-solid fa-chess-knight",
                    settings: [
                        {
                            key: "enableConditionHud",
                            introduced: "14.63.0",
                            docs: "token-hud-condition-palette",
                            keywords: ["status effects", "conditions", "exhaustion", "icons", "labels"],
                            name: "Token HUD Condition Palette",
                            hint: "Shows the Token HUD's status palette as a labelled list: conditions and other effects in separate groups, active ones highlighted with their level (e.g. Exhaustion 2) or an overlay mark, and the number of active statuses on the palette button. Hidden statuses are left out unless the token has them.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "hudHiddenStatuses",
                            introduced: "14.63.0",
                            name: "Hidden Statuses",
                            list: true,
                            statusPicker: { isCondition: isSystemCondition },
                            hint: "Statuses left out of the Token HUD palette for everyone. A hidden status still shows while a token has it, so it can be removed.",
                            type: "String",
                            default: DEFAULT_HIDDEN_STATUSES,
                            scope: "world",
                            parentKey: "enableConditionHud"
                        }
                    ]
                },
                {
                    id: "templates",
                    title: "Templates & Placement",
                    icon: "fa-solid fa-shapes",
                    settings: [
                        {
                            key: "enableTemplateTargeting",
                            introduced: "14.18.0",
                            docs: "auto-target-tokens-in-spell-templates",
                            keywords: ["AoE", "area of effect", "measured template", "targets"],
                            unavailableWith: "midi",
                            name: "Auto-Target Tokens in Spell Templates",
                            hint: "When a spell or ability template is placed on the canvas, automatically targets all tokens within the template area in real time.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableTemplateGridSnap",
                            introduced: "14.4.0",
                            docs: "snap-templates-to-grid-intersections",
                            keywords: ["AoE", "area of effect", "measured template"],
                            unavailableWith: "midi",
                            name: "Snap Templates to Grid Intersections",
                            hint: "Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement. Hold Shift to override. Disabled while midi-qol is active.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableGridConeRules",
                            introduced: "14.67.0",
                            docs: "rules-accurate-cones-on-square-grids",
                            keywords: ["AoE", "area of effect", "measured template", "cone", "grid", "Burning Hands", "Cone of Cold", "breath weapon"],
                            unavailableWith: "midi",
                            name: "Rules-Accurate Cones on Square Grids",
                            hint: "Cone templates on square grids cover whole squares as in the D&D grid rules: exactly 1, 2, 3, 4 … squares at 5, 10, 15, 20 … ft from a grid intersection, in one of 8 wedges between grid directions. Applies to every player. Disabled while midi-qol is active.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableGridBasedTemplates",
                            introduced: "14.68.0",
                            docs: "grid-based-templates",
                            keywords: ["AoE", "area of effect", "measured template", "grid", "region", "sphere", "square", "diagonals", "Fireball"],
                            name: "Grid-Based Templates",
                            hint: "New templates of the chosen types are measured with the scene's grid rules instead of as round shapes: on a 5/5/5 square grid a 20 ft sphere covers a square, on hex grids round shapes follow the hexes. Existing templates keep their shape. Applies to every player.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "gridBasedTemplatesCircle",
                            introduced: "14.68.0",
                            name: "Circles and Spheres",
                            hint: "Circle, sphere and cylinder templates (and ellipses drawn with Foundry's template tools).",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "gridBasedTemplatesCone",
                            introduced: "14.68.0",
                            name: "Cones",
                            hint: "Cone templates. On square grids, Rules-Accurate Cones takes precedence when it is on.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "gridBasedTemplatesRectangle",
                            introduced: "14.68.0",
                            name: "Cubes and Squares",
                            hint: "Cube and square templates.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "gridBasedTemplatesLine",
                            introduced: "14.68.0",
                            name: "Lines",
                            hint: "Line templates: the length is measured along the grid.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "gridBasedTemplatesRing",
                            introduced: "14.68.0",
                            name: "Rings",
                            hint: "Ring templates.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "gridBasedTemplatesEmanation",
                            introduced: "14.68.0",
                            name: "Emanations",
                            hint: "Emanation templates around a creature.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableGridBasedTemplates"
                        },
                        {
                            key: "enableRemoveInstantaneousTemplates",
                            introduced: "14.74.0",
                            docs: "remove-instantaneous-templates-on-turn-change",
                            keywords: ["AoE", "area of effect", "measured template", "delete", "cleanup", "Fireball", "combat", "turn"],
                            name: "Remove Instantaneous Templates on Turn Change",
                            hint: "In combat, deletes the templates of spells and abilities with an instantaneous duration (e.g. Fireball, Burning Hands, breath weapons) when the turn changes, and when the combat ends. Templates of lasting spells and hand-drawn templates stay.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableTemplateControlsHUD",
                            introduced: "14.35.0",
                            docs: "template-placement-controls-hud--scroll-rotation",
                            keywords: ["rotate", "mouse wheel", "AoE"],
                            name: "Template Placement Controls HUD & Scroll Rotation",
                            hint: "Displays a floating HUD banner with key controls whenever placing a spell or item template on the canvas, and inverts wheel scrolling so that scrolling rotates the template and Shift + scroll zooms the canvas.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAutoAttachSelfEmanations",
                            introduced: "14.37.0",
                            docs: "auto-attach-self-emanation-templates",
                            keywords: ["Spirit Guardians", "aura", "AoE"],
                            name: "Auto-Attach Self Emanation Templates",
                            hint: "When an actor uses an ability with an emanation template targeting Self (e.g. Spirit Guardians, Paladin auras), automatically attaches the template directly to the caster's token and skips manual canvas placement.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableSummonControlsHUD",
                            introduced: "14.36.0",
                            docs: "enhanced-summoning-placement-hud--range-preview",
                            keywords: ["summon", "conjure", "range"],
                            name: "Summoning Placement Controls HUD",
                            hint: "Displays a floating HUD banner with key controls, live distance vs. max range badge, and canvas range boundary ring during summoning placement.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                }
            ]
        },
        {
            id: "combatFlow",
            label: "Combat Flow",
            icon: "fa-solid fa-flag-checkered",
            description: "Starting an encounter, initiative and turns, dropping to 0 HP, and wrapping up.",
            sections: [
                {
                    id: "combatSetup",
                    title: "Combat Setup & Initiative",
                    icon: "fa-solid fa-flag-checkered",
                    settings: [
                        {
                            key: "promptForInitiative",
                            introduced: "14.18.0",
                            docs: "prompt--auto-roll-initiative",
                            keywords: ["combat start", "roll initiative"],
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
                            introduced: "14.18.0",
                            docs: "prompt--auto-roll-initiative",
                            keywords: ["combat start", "roll initiative"],
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
                            introduced: "14.3.0",
                            docs: "legendary-action-placeholders",
                            keywords: ["boss", "legendary actions", "combat tracker"],
                            name: "Legendary Action Placeholders",
                            hint: "Inserts placeholder turns in the combat tracker after creatures' turns when legendary creatures are present, so legendary actions can be tracked. Player characters count as legendary too if they have a feature with a Legendary Action activation.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "showLegendaryActionPlaceholders",
                            introduced: "14.4.0",
                            name: "Show Placeholders to Players",
                            hint: "Make legendary action placeholder turns visible in the combat tracker to players.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableLegendaryActionPlaceholders"
                        },
                        {
                            key: "legendaryActionPlaceholderIcon",
                            introduced: "14.11.22",
                            name: "Placeholder Icon",
                            hint: "Select an icon for legendary action initiative placeholders.",
                            type: "FilePicker",
                            filePicker: "image",
                            default: "icons/svg/combat.svg",
                            scope: "world",
                            parentKey: "enableLegendaryActionPlaceholders"
                        },
                        {
                            key: "legendaryActionPlaceholderPlacement",
                            introduced: "14.81.0",
                            name: "Placeholder Placement",
                            hint: "After Every Creature's Turn: a placeholder follows every creature, except the turn of a legendary creature that is the only one in the fight. After Opposing Creatures' Turns: friendly legendary creatures only get placeholders after hostile creatures and hostile ones after friendly creatures (by token disposition); neutral and secret legendary creatures still get them after every creature. Applies to combats started afterwards.",
                            type: "Select",
                            default: "all",
                            choices: [
                                { value: "all", label: "After Every Creature's Turn" },
                                { value: "opposing", label: "After Opposing Creatures' Turns Only" }
                            ],
                            scope: "world",
                            parentKey: "enableLegendaryActionPlaceholders"
                        },
                        {
                            key: "autoSkipEmptyLegendaryPlaceholders",
                            introduced: "14.46.6",
                            name: "Auto-Skip When No Uses Left",
                            hint: "Automatically skip legendary action placeholder turns in the combat tracker when none of the legendary creatures that could act at that point has uses remaining, or the creature before it is defeated.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableLegendaryActionPlaceholders"
                        }
                    ]
                },
                {
                    id: "hitPoints",
                    title: "Hit Points, Death & Dying",
                    icon: "fa-solid fa-heart-crack",
                    settings: [
                        {
                            key: "enableAutoStatusZeroHP",
                            introduced: "14.7.0",
                            docs: "auto-apply-status-at-0-hp",
                            keywords: ["dead", "unconscious", "defeated", "downed", "0 HP"],
                            name: "Auto-Apply Status at 0 HP",
                            hint: "Automatically applies an overlay status condition to tokens when reaching 0 HP. Overrides DnD5e's native Downed Status Automation (autoApplyDowned). Defers to midi-qol's Add Dead/Unconscious when that is on.",
                            type: "Boolean",
                            default: false,
                            scope: "world"
                        },
                        {
                            key: "autoStatusZeroHP_playerStatus",
                            introduced: "14.7.0",
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
                            introduced: "14.7.0",
                            name: "NPC Token Status at 0 HP",
                            hint: "Overlay condition for GM/NPC tokens at 0 HP. Important NPCs fall unconscious instead so they can roll death saves.",
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
                            introduced: "14.7.0",
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
                            introduced: "14.7.0",
                            name: "NPC Token Combat Action at 0 HP",
                            hint: "Action in the combat tracker when NPC drops to 0 HP. Important NPCs are never removed or marked defeated.",
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
                            introduced: "14.0.0",
                            docs: "prompt-for-death-saves",
                            keywords: ["death saving throw", "dying", "0 HP"],
                            name: "Prompt for Death Saves",
                            hint: "Whispers a Death Saving Throw button when a player starts their combat turn at 0 HP.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableUndeadFortitude",
                            introduced: "14.65.0",
                            docs: "undead-fortitude-automation",
                            keywords: ["zombie", "undead", "0 HP", "Constitution save", "radiant", "critical hit"],
                            name: "Undead Fortitude Automation",
                            hint: "When damage would reduce a creature with Undead Fortitude to 0 HP, it rolls a Constitution save (DC 5 + the damage taken) and stays at 1 HP on a success. Radiant damage and critical hits skip the save. Also works with midi-qol damage.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "undeadFortitudeFastForward",
                            introduced: "14.65.0",
                            name: "Roll Without Dialog",
                            hint: "Roll the save straight away. When off, the roll dialog opens so you can add bonuses first.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableUndeadFortitude"
                        },
                        {
                            key: "enableSuppressBloodiedWhileDead",
                            introduced: "14.31.0",
                            docs: "suppress-bloodied-condition-on-dead-tokens",
                            keywords: ["bloodied", "dead"],
                            name: "Suppress Bloodied Condition on Dead Tokens",
                            hint: "Removes and suppresses the Bloodied condition from tokens that have the Dead condition, preventing both the dead and bloodied status icons from displaying at the same time.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "encounterEnd",
                    title: "Encounter End",
                    icon: "fa-solid fa-trophy",
                    settings: [
                        {
                            key: "enableCombatExpTracker",
                            introduced: "14.10.0",
                            docs: "combat-experience-tracker",
                            keywords: ["XP", "experience", "award", "level up"],
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
            id: "rollsDamage",
            order: 40,
            label: "Rolls & Damage",
            icon: "fa-solid fa-burst",
            description: "Attack and damage rolls, applying damage and healing, and weapon masteries.",
            sections: [
                {
                    id: "attackDamage",
                    title: "Attack & Damage Rolls",
                    icon: "fa-solid fa-bullseye",
                    settings: [
                        {
                            key: "promptForAttackDamage",
                            introduced: "14.19.0",
                            docs: "prompt--auto-roll-attack-damage",
                            keywords: ["damage roll", "hit"],
                            unavailableWith: "midi",
                            name: "Prompt for Attack Damage",
                            hint: "Opens the damage roll dialog automatically when an attack roll hits the target's AC. Disabled while midi-qol is active.",
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
                            key: "autoRollStaticDamage",
                            introduced: "14.32.3",
                            name: "Auto-Roll Flat / Static Damage & Healing",
                            hint: "Automatically rolls damage or healing immediately without showing a dialog if the formula contains only static or derived values (no dice).",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "promptForAttackDamage"
                        },
                        {
                            key: "autoRollAttackDamage",
                            introduced: "14.19.0",
                            docs: "prompt--auto-roll-attack-damage",
                            keywords: ["damage roll", "hit", "fast forward"],
                            unavailableWith: "midi",
                            name: "Auto-Roll Attack Damage",
                            hint: "Automatically rolls damage without dialog when an attack roll hits target AC. Takes precedence over Prompt. Disabled while midi-qol is active.",
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
                            key: "enableAutoRollSaveDamage",
                            introduced: "14.7.0",
                            docs: "auto-open-damage-dialog-for-saves",
                            keywords: ["Fireball", "save damage"],
                            unavailableWith: "midi",
                            name: "Auto-Open Damage Dialog for Saves",
                            hint: "Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableRecklessAttack",
                            introduced: "14.80.0",
                            docs: "reckless-attack-automation",
                            keywords: ["Reckless Attack", "Barbarian", "advantage", "reckless"],
                            name: "Reckless Attack Automation",
                            hint: "A creature with Reckless Attack decides on its first attack roll of its turn, without using the feature: a checkbox in the attack roll dialog, or a Yes / No prompt when the dialog is skipped (e.g. midi-qol fast-forward). Attacking recklessly gives Advantage and makes the creature Reckless until the start of its next turn: attacks against it have Advantage, and its Strength attacks keep Advantage (2014 rules: melee weapon attacks, this turn only; 2024 rules: until its next turn). Follows the feature's 2014 / 2024 rules.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableConditionalDamage",
                            introduced: "14.45.0",
                            docs: "conditional-damage-bonuses-sneak-attack-hex-hunters-mark-great-weapon-master-brutal-strike-charger-savage-attacker-boon-of-irresistible-offense--cleave",
                            keywords: ["Sneak Attack", "Hex", "Hunter's Mark", "GWM", "Great Weapon Master", "Brutal Strike", "Charger", "Savage Attacker", "Cleave", "Genie's Wrath", "Genie", "damage bonus", "Colossus Slayer", "Hunter's Prey", "Divine Strike", "Primal Strike", "Divine Fury", "Frenzy", "Dreadful Strikes", "Dread Ambusher", "Elemental Epitome", "Fire's Burn", "Frost's Chill", "Celestial Revelation", "Lunar Form", "Psionic Strike", "Hand of Harm", "Eldritch Smite", "Lifedrinker", "Empowered Evocation", "Radiant Soul", "Elemental Adept", "Foe Slayer", "Assassinate"],
                            name: "Conditional Damage Bonuses",
                            hint: "Offers toggles in damage roll dialogs for Sneak Attack, Hex, Hunter's Mark, Great Weapon Master (2024), Brutal Strike, Charger (2024), Savage Attacker (2024), Boon of Irresistible Offense (2024), Genie's Wrath and the Cleave weapon mastery malus, plus Player's Handbook class features, species traits and spell bonuses (Colossus Slayer, Divine Strike, Primal Strike, Divine Fury, Frenzy, Dreadful Strikes, Dread Ambusher, Elemental Epitome, Fire's Burn, Frost's Chill, Celestial Revelation, Lunar Form, Psionic Strike, Hand of Harm, Eldritch Smite, Lifedrinker, Empowered Evocation, Radiant Soul). Features that cost uses, Focus Points or a Pact slot spend them when ticked. Great Weapon Fighting and Elemental Adept apply automatically.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enablePreventGroupActorRolls",
                            introduced: "14.40.0",
                            docs: "prevent-rolling-as-group-actors",
                            keywords: ["party", "group sheet"],
                            name: "Prevent Rolling as Group Actors",
                            hint: "Prevents players from making rolls as group actors (such as when controlling a party exploration token or interacting with a party sheet). The roll automatically falls back to their assigned player character actor instead.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "applyDamage",
                    title: "Applying Damage & Healing",
                    icon: "fa-solid fa-heart-pulse",
                    settings: [
                        {
                            key: "enablePlayerDamagePrompt",
                            introduced: "14.10.0",
                            docs: "player-damage-prompt",
                            keywords: ["apply damage", "resistance", "immunity", "whisper"],
                            name: "Player Damage Prompt",
                            hint: "Whispers a chat card with breakdown (resistances, immunities) and one-click Apply button when damage is rolled against a player.",
                            type: "Boolean",
                            default: false,
                            scope: "world"
                        },
                        {
                            key: "damagePromptVisibility",
                            introduced: "14.10.0",
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
                            introduced: "14.10.0",
                            name: "GM Damage Prompt for Player Attacks",
                            hint: "Whispers a damage prompt with breakdown to the GM when players roll attack damage against NPCs.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enablePlayerDamagePrompt"
                        },
                        {
                            key: "enableNonAttackDamagePrompt",
                            introduced: "14.11.11",
                            name: "Non-Attack Damage Prompts",
                            hint: "Sends damage prompts for non-attack activities (saving throws with Full/Half buttons, utility abilities).",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enablePlayerDamagePrompt"
                        },
                        {
                            key: "damagePromptLayout",
                            introduced: "14.11.19",
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
                            key: "waitForDiceSoNice",
                            introduced: "14.11.17",
                            name: "Wait for Dice So Nice",
                            hint: "Delays damage prompt whispers until Dice So Nice 3D dice finish rolling.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enablePlayerDamagePrompt"
                        },
                        {
                            key: "enableGrazeDamagePrompt",
                            introduced: "14.26.2",
                            name: "Graze Damage Prompts (Always On)",
                            hint: "When enabled, Graze weapon mastery damage prompts are sent even if the Player Damage Prompt feature is disabled. This lets you use Graze prompts independently of all other player damage prompts. Skipped while Automated Masteries 5e is active.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enablePlayerDamagePrompt"
                        },
                        {
                            key: "enableHealingContextMenu",
                            introduced: "14.7.0",
                            docs: "healing-roll-context-menu",
                            keywords: ["temp HP", "temporary hit points", "right-click"],
                            name: "Healing Roll Context Menu",
                            hint: "Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat cards.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            requiresReload: true
                        }
                    ]
                },
                {
                    id: "weaponMastery",
                    title: "Weapon Mastery",
                    icon: "fa-solid fa-khanda",
                    settings: [
                        {
                            key: "enableWeaponMasteries",
                            introduced: "14.42.0",
                            docs: "weapon-mastery-automation",
                            keywords: ["Slow", "Sap", "Topple", "Graze", "Cleave", "Vex", "Push", "Nick"],
                            unavailableWith: "wm5e",
                            name: "Weapon Mastery Automation",
                            hint: "Automatically applies weapon masteries to targets when hit by player character attacks. Automates Slow (reducing speed by 10 ft), Sap (disadvantage on the creature's next attack roll), Topple (a Constitution save when the damage is applied, Prone on a failure) and Vex (Advantage on your next attack roll against the creature). Works with midi-qol. Disabled while Automated Masteries 5e is active.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "masteryToppleSaveMode",
                            introduced: "14.60.0",
                            unavailableWith: "wm5e",
                            name: "Topple Saving Throw",
                            hint: "How the Constitution saving throw against Topple is made when the damage is applied: a prompt card whispered to the creature's owners that also opens the roll dialog for its player (or the GM if no owner is online, as with concentration saves), the prompt card only, or rolled automatically.",
                            type: "Select",
                            default: "promptDialog",
                            choices: [
                                { value: "promptDialog", label: "Prompt and Open the Roll Dialog" },
                                { value: "prompt", label: "Prompt Card Only" },
                                { value: "auto", label: "Roll Automatically" }
                            ],
                            scope: "world",
                            parentKey: "enableWeaponMasteries"
                        },
                        {
                            key: "masterySapIcon",
                            introduced: "14.42.0",
                            unavailableWith: "wm5e",
                            name: "Sap Effect Icon",
                            hint: "Select an icon for the Sap weapon mastery active effect.",
                            type: "FilePicker",
                            filePicker: "image",
                            default: "icons/skills/melee/sword-damaged-broken-glow-red.webp",
                            scope: "world",
                            parentKey: "enableWeaponMasteries"
                        },
                        {
                            key: "masterySlowIcon",
                            introduced: "14.42.0",
                            unavailableWith: "wm5e",
                            name: "Slow Effect Icon",
                            hint: "Select an icon for the Slow weapon mastery active effect.",
                            type: "FilePicker",
                            filePicker: "image",
                            default: "icons/creatures/invertebrates/snail-movement-green.webp",
                            scope: "world",
                            parentKey: "enableWeaponMasteries"
                        },
                        {
                            key: "masteryVexIcon",
                            introduced: "14.86.0",
                            unavailableWith: "wm5e",
                            name: "Vex Effect Icon",
                            hint: "Select an icon for the Vex weapon mastery active effect on the attacker.",
                            type: "FilePicker",
                            filePicker: "image",
                            default: "icons/magic/control/fear-fright-mask-yellow.webp",
                            scope: "world",
                            parentKey: "enableWeaponMasteries"
                        }
                    ]
                }
            ]
        },
        {
            id: "conditionsEffects",
            order: 50,
            label: "Conditions & Effects",
            icon: "fa-solid fa-person-falling-burst",
            description: "Conditions, concentration, spell areas and Active Effects.",
            sections: [
                {
                    id: "conditions",
                    title: "Conditions",
                    icon: "fa-solid fa-person-falling",
                    settings: [
                        {
                            key: "enableProneRules",
                            introduced: "14.63.0",
                            docs: "prone-rules",
                            keywords: ["crawl", "stand up", "standing up", "knocked down", "advantage", "disadvantage", "movement"],
                            name: "Prone Rules",
                            hint: "Automates the movement and attack rules of the Prone condition that the system leaves to the table. Choose the rules below.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "proneCrawlMovement",
                            introduced: "14.63.0",
                            name: "Crawl While Prone",
                            hint: "Prone tokens switch to the Crawl movement action (and back when they stand up), and walking while Prone costs 1 extra foot per foot, like crawling. Follows the system's Movement Automation setting.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableProneRules"
                        },
                        {
                            key: "proneStandUpCost",
                            introduced: "14.63.0",
                            name: "Standing Up Costs Half Speed",
                            hint: "Ending Prone on the creature's own turn in combat costs half its Speed. The cost is added to its first step after standing up, so it shows in the ruler and counts toward its movement this turn. Players can't stand up without enough movement left; the GM gets a warning instead.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableProneRules"
                        },
                        {
                            key: "proneAttackRolls",
                            introduced: "14.63.0",
                            unavailableWith: "conditionRolls",
                            name: "Prone Attack Rolls",
                            hint: "A Prone attacker has Disadvantage. An attack against a Prone creature has Advantage if the attacker is within 5 feet, and Disadvantage otherwise (single target only). Works with midi-qol. Disabled while Automated Conditions 5e or midi-qol's optional Condition Rules are active.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableProneRules"
                        },
                        {
                            key: "enableConditionRollModes",
                            introduced: "14.80.0",
                            docs: "condition-advantage--disadvantage",
                            keywords: ["blinded", "invisible", "restrained", "paralyzed", "petrified", "stunned", "unconscious", "poisoned", "frightened", "grappled", "dodging", "dodge", "advantage", "disadvantage", "attack rolls", "conditions", "critical hit", "crit", "auto-fail", "saving throws"],
                            unavailableWith: "conditionRolls",
                            name: "Condition Advantage & Disadvantage",
                            hint: "Applies the Advantage and Disadvantage that conditions give to attack rolls (and Frightened to ability checks), plus critical hits against Paralyzed or Unconscious creatures and failed Strength / Dexterity saves, which the system leaves to the table. Rules that depend on the target need a single target. Choose the conditions below; Prone is under Prone Rules. Works with midi-qol. Disabled while Automated Conditions 5e or midi-qol's optional Condition Rules are active.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "condRollsBlindedInvisible",
                            introduced: "14.80.0",
                            unavailableWith: "conditionVision",
                            name: "Blinded & Invisible",
                            hint: "A creature that can't see its target attacks with Disadvantage, and attacks against a creature that can't see the attacker have Advantage. Blindsight, Truesight and See Invisibility let a creature see through Blinded or Invisible within their range. Walls and light aren't checked. Disabled while midi-qol's Invisible Advantage rule is on, which handles this.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsRestrained",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Restrained",
                            hint: "A Restrained creature attacks with Disadvantage, and attacks against it have Advantage.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsHelpless",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Paralyzed, Petrified, Stunned & Unconscious",
                            hint: "Attacks against a Paralyzed, Petrified, Stunned or Unconscious creature have Advantage.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsPoisoned",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Poisoned, Exhaustion & Encumbrance",
                            hint: "A Poisoned creature attacks with Disadvantage. The system lists this (with 2014 exhaustion level 3, and Heavily Encumbered for Strength, Dexterity and Constitution attacks) but only applies it to ability checks.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsFrightened",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Frightened",
                            hint: "A Frightened creature has Disadvantage on attack rolls and ability checks, including skills, tools and initiative. Applies whether or not the source of its fear is in sight.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsGrappled",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Grappled (2024)",
                            hint: "With the 2024 rules, a Grappled creature has Disadvantage on attacks against anyone but its grappler. The grappler is the creature whose item or effect applied Grappled; a Grappled status set by hand is skipped.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsDodging",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Dodging",
                            hint: "Attacks against a Dodging creature have Disadvantage if it can see the attacker. Dodging ends while it is Incapacitated or can't move, as in the system.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsAutoCrit",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Critical Hits Within 5 Feet",
                            hint: "A hit against a Paralyzed or Unconscious creature is a critical hit if the attacker is within 5 feet of it. A miss stays a miss. Single target only. With midi-qol, the workflow's hit check decides.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "condRollsAutoFailSaves",
                            introduced: "14.80.0",
                            unavailableWith: "conditionRolls",
                            name: "Failed Strength & Dexterity Saves",
                            hint: "Paralyzed, Petrified, Stunned and Unconscious creatures fail Strength and Dexterity saving throws automatically: the dice are still rolled, but the total counts as 0 and the chat card says why.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableConditionRollModes"
                        },
                        {
                            key: "enableProneRotation",
                            introduced: "14.0.0",
                            docs: "auto-rotate-prone--unconscious--dead-tokens",
                            keywords: ["rotate", "tilt", "unconscious", "dead"],
                            name: "Auto-Rotate Prone Tokens",
                            hint: "Automatically rotates tokens 90° clockwise when the Prone condition is applied, and rotates them back when removed.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "concentration",
                    title: "Concentration & Incapacitation",
                    icon: "fa-solid fa-brain",
                    settings: [
                        {
                            key: "enableAutoRollConcentration",
                            introduced: "14.12.0",
                            docs: "auto-roll--prompt-concentration-saves",
                            keywords: ["concentration check", "CON save", "Constitution"],
                            name: "Auto-Roll Concentration Saves",
                            hint: "Automatically rolls a Constitution save for concentration when taking damage. Skipped while midi-qol rolls concentration saves itself.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "autoRollConcentrationFastForward",
                            introduced: "14.12.0",
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
                            introduced: "14.12.0",
                            name: "Auto-End Concentration on Save Failure",
                            hint: "Automatically terminates concentration effects on failed save.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableAutoRollConcentration"
                        },
                        {
                            key: "enableMageSlayerConcentration",
                            introduced: "14.12.1",
                            docs: "mage-slayer-concentration-disadvantage",
                            keywords: ["feat", "concentration"],
                            name: "Mage Slayer: Disadvantage on Concentration",
                            hint: "Targets damaged by a Mage Slayer make concentration saves with Disadvantage.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAutoEndConcentration",
                            introduced: "14.11.0",
                            docs: "auto-end-concentration--class-features",
                            keywords: ["incapacitated", "stunned", "unconscious"],
                            name: "Auto-End Concentration on Incapacitation",
                            hint: "Automatically terminates concentration when incapacitated, unconscious, dead, paralyzed, petrified, or stunned.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableAutoEndRage",
                            introduced: "14.11.4",
                            docs: "auto-end-concentration--class-features",
                            keywords: ["Rage", "Wrath of the Sea", "Starry Form", "incapacitated"],
                            name: "Auto-End Class Features",
                            hint: "Automatically terminates Rage, Wrath of the Sea, and Starry Form on incapacitation.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        }
                    ]
                },
                {
                    id: "spellsMagic",
                    title: "Spells & Magic",
                    icon: "fa-solid fa-hat-wizard",
                    settings: [
                        {
                            key: "enableMagicResistance",
                            introduced: "14.50.0",
                            docs: "magic-resistance-automation",
                            keywords: ["advantage", "saving throw", "Gnome Cunning", "Mantle of Spell Resistance"],
                            name: "Magic Resistance Automation",
                            hint: "Creatures with Magic Resistance, Spell Resistance, Gnome Cunning (2014) or an equipped Mantle of Spell Resistance roll saves against spells and magical effects with Advantage. Also works with midi-qol save requests.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "magicResistanceScope",
                            introduced: "14.50.0",
                            name: "What Counts as Magical",
                            hint: "Spells always count. Magic items: items with the Magical property, potions, scrolls, wands and rods. Magical features: features with the Magical property.",
                            type: "Select",
                            default: "all",
                            choices: [
                                { value: "spells", label: "Spells Only" },
                                { value: "items", label: "Spells & Magic Items" },
                                { value: "all", label: "Spells, Magic Items & Magical Features" }
                            ],
                            scope: "world",
                            parentKey: "enableMagicResistance"
                        },
                        {
                            key: "enableDeathWard",
                            introduced: "14.66.0",
                            docs: "death-ward-automation",
                            keywords: ["0 HP", "1 HP", "Protection from Death", "spell"],
                            name: "Death Ward Automation",
                            hint: "The first time a creature under Death Ward would drop to 0 HP, it drops to 1 HP instead and the spell's effect is removed. Also works with midi-qol damage.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableCompanionLevelSync",
                            introduced: "14.87.0",
                            docs: "companion-level-sync",
                            keywords: ["summon", "Primal Companion", "Beast Master", "level up", "hit points"],
                            name: "Companion Level Sync",
                            hint: "When a character levels up or changes an ability score, their companions summoned by class features (Primal Companion, …) update their AC, hit points, Hit Dice, proficiency and attack and damage bonuses. Damage already taken stays. Works for companions that keep one actor between summons; spell summons aren't changed.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableSummonFullHp",
                            introduced: "14.87.0",
                            docs: "summon-at-full-hp",
                            keywords: ["summon", "Primal Companion", "Find Steed", "hit points", "heal"],
                            name: "Summon at Full HP",
                            hint: "Companions that keep one actor between summons (Primal Companion, Find Steed, …) arrive at full hit points, including the HP their summon adds, and lose Dead and Unconscious. Without it they keep their current HP: a Primal Companion's first summon shows 5 / 20 HP, and a re-summoned one keeps its old damage.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "enableDamageEmanation",
                            introduced: "14.54.0",
                            docs: "damage-emanation-automation",
                            keywords: ["Spirit Guardians", "Moonbeam", "Cloudkill", "Web", "Wall of Fire", "Forbiddance", "aura", "zone", "area of effect", "AoE"],
                            name: "Damage Emanation Automation",
                            hint: "Spirit Guardians, Moonbeam, Web, Wall of Fire and similar emanations and areas trigger their save and/or damage when a creature enters, the area moves onto a creature, or a creature starts or ends its turn inside, as the spell says. Once per creature per turn. Creatures inside at casting are left to the cast. The area is removed when concentration ends.",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "damageEmanationMode",
                            introduced: "14.54.0",
                            name: "Trigger Mode",
                            hint: "Prompt the caster (and GM), prompt only the GM, or trigger the save automatically.",
                            type: "Select",
                            default: "promptCaster",
                            choices: [
                                { value: "promptCaster", label: "Prompt Caster" },
                                { value: "promptGM", label: "Prompt GM Only" },
                                { value: "automatic", label: "Automatic" }
                            ],
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationSpells",
                            introduced: "14.54.0",
                            name: "Emanation Spells",
                            list: true,
                            hint: "Spell identifiers (or names) that get the automation. Other spells can add \"Damage Emanation\" in an activity's Behaviors tab or to a region by hand.",
                            type: "String",
                            default: "black-tentacles, blade-barrier, cacophonic-shield, cloud-of-daggers, cloudkill, conjure-woodland-beings, control-water, dirge, doomtide, forbiddance, grease, gust-of-wind, incendiary-cloud, insect-plague, moonbeam, sleet-storm, spirit-guardians, stinking-cloud, storm-of-radiance, wall-of-fire, wall-of-thorns, web, yolandes-regal-presence",
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationCombatOnly",
                            introduced: "14.54.0",
                            name: "Only During Combat",
                            hint: "Only trigger emanations while a combat encounter is running on the scene.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationExcludeAllies",
                            introduced: "14.54.0",
                            name: "Exclude Allies",
                            hint: "Creatures with the caster's token disposition are never affected by emanations centered on the caster or spells that let the caster choose. Placed areas (Moonbeam, Cloudkill) affect everyone inside.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationRequireSight",
                            introduced: "14.54.0",
                            name: "Respect \"Creature You Can See\"",
                            hint: "Conjure Woodland Beings and Yolande's Regal Presence skip hidden and invisible creatures.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationDrift",
                            introduced: "14.58.0",
                            name: "Move Drifting Areas",
                            hint: "Cloudkill, Doomtide and Incendiary Cloud move 10 ft away from the caster at the start of each of the caster's turns.",
                            type: "Boolean",
                            default: false,
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        },
                        {
                            key: "damageEmanationRememberDamageType",
                            introduced: "14.54.0",
                            name: "Remember Damage Type",
                            hint: "Spirit Guardians keeps the damage type (Radiant or Necrotic) chosen for its first roll.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableDamageEmanation"
                        }
                    ]
                },
                {
                    id: "activeEffects",
                    title: "Active Effects",
                    icon: "fa-solid fa-wand-magic-sparkles",
                    settings: [
                        {
                            key: "enableSelfEffectApplication",
                            introduced: "14.13.0",
                            docs: "self-effect-application-prompt",
                            keywords: ["Rage", "Mirror Image", "buff", "apply effect"],
                            name: "Self Effect Application Prompt",
                            hint: "Whispers a one-click Apply button when using abilities that grant Active Effects to Self (e.g. Rage, Mirror Image).",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "selfEffectAlwaysPromptFeatures",
                            introduced: "14.14.11",
                            name: "Always Prompt Features",
                            list: true,
                            hint: "Item or feature names that always get the self-effect message, even when not self-targeted (e.g. Mage Armor).",
                            type: "String",
                            default: "Mage Armor",
                            scope: "world",
                            parentKey: "enableSelfEffectApplication"
                        },
                        {
                            key: "selfEffectAutoApplyEffects",
                            introduced: "14.49.1",
                            name: "Auto-Apply Effects",
                            list: true,
                            hint: "Effect names that are applied directly to the source token (e.g. Bladesong, Rage). The self-effect message still shows them as applied, with an Undo button.",
                            type: "String",
                            default: "Ambusher's Leap, Avenging Angel, Bestial Communication, Bladesong, Cloak of Shadows, Comprehension, Dashing, Defensive Duelist, Disappearing Step, Disengaged, Disguised, Divine Favor, Dodging, Draconic Flight, Duplicate A, Duplicate B, Duplicate C, Endless Ammunition, Ethereal, Evasive AC, Glib, Heavenly Wings, Imperceptible Barrier, Innate Sorcery, Large Form, Living Legend: Charismatic, Majestic Presence, Merged with Shadows, Patient Defense (Focus Point), Peerless Athlete, Psi-Powered Leap, Rage, Rage of the Gods, See Invisibility, Stonecunning, Superior Defense, Trance of Order, Unearthly Appearance, Veiled, Winged, Wreathed in Light",
                            scope: "world",
                            parentKey: "enableSelfEffectApplication"
                        },
                        {
                            key: "enableSelfTargetCorrection",
                            introduced: "14.73.0",
                            docs: "self-targeted-activities-target-self",
                            keywords: ["Second Wind", "target", "self", "wrong target"],
                            unavailableWith: "midi",
                            name: "Self-Targeted Activities Target Self",
                            hint: "Abilities that only affect their user (e.g. Second Wind, Rage) target the user's own token on their chat cards, even if an enemy is still targeted. The user's own targets stay as they are. Disabled while midi-qol is active (midi-qol already does this).",
                            type: "Boolean",
                            default: true,
                            scope: "world"
                        },
                        {
                            key: "selfTargetCorrectionNotify",
                            introduced: "14.73.0",
                            name: "Show Notification",
                            hint: "Tells the user when their targets were replaced with their own token.",
                            type: "Boolean",
                            default: true,
                            scope: "world",
                            parentKey: "enableSelfTargetCorrection"
                        },
                        {
                            key: "disableActiveEffectExpiry",
                            introduced: "14.27.0",
                            docs: "disable-active-effect-expiry",
                            keywords: ["duration", "expire", "expiration"],
                            name: "Disable Active Effect Expiry",
                            hint: "Completely disables and suppresses the automatic expiration and deletion of Active Effects introduced by DnD5e (out of combat, at combat end, on rest, and turn-based special expiries). Effects remain active until manually toggled or removed.",
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
