import { MODULE_ID, log } from "./main.js";
import { NiksListEditorApp, normalizeListValue, parseListValue } from "./settings-list-editor.js";
import { NiksStatusPickerApp } from "./settings-status-picker.js";
import { DEFAULT_HIDDEN_STATUSES } from "./features/canvas-tokens/condition-hud.js";
import { isAc5eActive, isMidiActive, isWm5eActive } from "./utils/module-compat.js";

/**
 * Modules that take over a feature completely. Settings tagged with `unavailableWith` are greyed out
 * and locked in the dashboard while the module is active (their stored value is kept).
 */
const UNAVAILABLE_WITH = {
    midi: { label: "midi-qol", isActive: isMidiActive },
    wm5e: { label: "Automated Masteries 5e", isActive: isWm5eActive },
    ac5e: { label: "Automated Conditions 5e", isActive: isAc5eActive }
};

/** Base URL of the README; a setting's `docs` value is the heading anchor. */
const DOCS_URL = "https://github.com/nschoenwald/niks-dnd5e-tweaks#";

const OVERVIEW_TAB = "overview";
const PERSONAL_TAB = "personalPreferences";
const DASHBOARD_ID = "niks-dnd5e-tweaks-settings-app";

/** Select values that mean a feature is switched off. */
const OFF_VALUES = new Set(["none", "off", "never"]);

/** Quick filters above the settings list. Counts are filled in live. */
const FILTERS = [
    { id: "changed", label: "Changed", icon: "fa-solid fa-pen", tooltip: "Settings that differ from their default value" },
    { id: "new", label: "New", icon: "fa-solid fa-star", tooltip: "Settings added since you last opened this dashboard" },
    { id: "off", label: "Turned Off", icon: "fa-solid fa-power-off", tooltip: "Features that are switched off" },
    { id: "reload", label: "Needs Reload", icon: "fa-solid fa-rotate", tooltip: "Settings that take effect after reloading" },
    { id: "unavailable", label: "Handled Elsewhere", icon: "fa-solid fa-ban", tooltip: "Settings another active module takes over" }
];

/**
 * Read a setting without throwing for keys that aren't registered.
 * @param {string} key
 * @param {*} fallback
 */
function readSetting(key, fallback) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return fallback;
    }
}

/**
 * Whether a value switches a feature off: an unchecked toggle, or a Select set to none / off / never.
 * @param {object} setting  Schema entry.
 * @param {*} value
 */
function isOffValue(setting, value) {
    if (setting.type === "Boolean") return !value;
    if (setting.type === "Select") return OFF_VALUES.has(value);
    return false;
}

/**
 * Short readable form of a value: On / Off, a choice label, or the value itself.
 * @param {object} setting
 * @param {*} value
 */
function valueLabel(setting, value) {
    if (setting.type === "Boolean") return value ? "On" : "Off";
    if (setting.type === "Select") return setting.choices?.find(c => c.value === value)?.label ?? String(value);
    if (setting.list) return `${parseListValue(String(value ?? "")).length} entries`;
    return String(value ?? "");
}

/**
 * Comparable form of a value, so form values and stored values can be compared with ===.
 * @param {object} setting
 * @param {*} value
 */
function normalizeValue(setting, value) {
    if (setting.type === "Boolean") return Boolean(value);
    if (setting.type === "Number") return Number(value);
    if (setting.list) return normalizeListValue(String(value ?? ""));
    if (setting.type === "Color") return String(value ?? "").toLowerCase();
    return String(value ?? "");
}

/**
 * First sentence of a hint, for the overview cards. Abbreviations like "e.g." don't end a sentence.
 * @param {string} hint
 */
function summarize(hint = "") {
    const protectedText = hint.replace(/\b(e\.g|i\.e|vs|etc)\./gi, m => m.replaceAll(".", "\u0000"));
    const match = protectedText.match(/^(.+?[.!?])(\s|$)/);
    return (match ? match[1] : protectedText).replaceAll("\u0000", ".");
}

/**
 * Escaped HTML of a text with every search token wrapped in <mark>.
 * @param {string} text
 * @param {string[]} tokens  Lower-case search tokens.
 */
function highlightText(text, tokens) {
    const escape = foundry.utils.escapeHTML;
    if (!tokens.length) return escape(text);
    const pattern = tokens
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .sort((a, b) => b.length - a.length)
        .join("|");
    // split() with a capture group puts the matches at the odd indexes.
    return text.split(new RegExp(`(${pattern})`, "gi"))
        .map((part, i) => (i % 2 ? `<mark>${escape(part)}</mark>` : escape(part)))
        .join("");
}

/**
 * Show the number of settings this user hasn't seen yet on the dashboard button in Configure Settings.
 * @param {HTMLElement} [root]  The Configure Settings element; found in the open window when omitted.
 */
export function refreshSettingsMenuBadge(root) {
    root ??= foundry.applications.instances.get("settings-config")?.element;
    const button = root?.querySelector(`[data-action="openSubmenu"][data-key="${MODULE_ID}.settingsDashboard"]`);
    if (!button) return;
    button.querySelector(".nd5t-menu-new")?.remove();
    const count = NiksTweaksSettingsApp.countNewSettings();
    if (!count) return;
    const badge = document.createElement("span");
    badge.className = "nd5t-menu-new";
    badge.textContent = `${count} new`;
    badge.dataset.tooltipText = `${count} new ${count === 1 ? "setting" : "settings"} since you last opened the dashboard`;
    button.append(badge);
}

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
        id: DASHBOARD_ID,
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
            editList: NiksTweaksSettingsApp.#onEditList,
            editStatuses: NiksTweaksSettingsApp.#onEditStatuses,
            toggleFilter: NiksTweaksSettingsApp.#onToggleFilter,
            revealSetting: NiksTweaksSettingsApp.#onRevealSetting,
            resetSetting: NiksTweaksSettingsApp.#onResetSetting,
            toggleHints: NiksTweaksSettingsApp.#onToggleHints,
            close: function(event, target) { return this.close(); }
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
    #activeTab = null;

    /**
     * Open list editor windows, keyed by setting key. Closed together with the dashboard.
     * @type {Map<string, NiksListEditorApp|NiksStatusPickerApp>}
     */
    #listEditors = new Map();

    /** Search text, kept across re-renders. */
    #query = "";

    /** Active quick filters (ids from FILTERS). */
    #filters = new Set();

    /** Stored value of every rendered setting at render time, normalized; the base for "unsaved". */
    #initialValues = new Map();

    /** Schema entries by key, from the last render. @type {Map<string, object>} */
    #settingsByKey = new Map();

    /** "New" boundary while this window is open. */
    #baseline = null;

    #refreshQueued = false;

    /**
     * Settings definition schema categorized for the dashboard.
     *
     * Besides the setting's own data, entries carry dashboard metadata:
     * - `introduced`: module version that added the setting ("New" badges, taken from the git history).
     * - `pairedWith`: on a personal (client) setting, the world setting it belongs to.
     * - `docs`: README heading anchor of the feature.
     * - `keywords`: extra search terms (spell, feature or rule names).
     * - `parentKey`, `unavailableWith`, `requiresModule`, `list`, `statusPicker` as before.
     */
    static get SETTINGS_SCHEMA() {
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
                                key: "clientEnableSheetPlusCompendium",
                                introduced: "14.28.5",
                                pairedWith: "enableSheetPlusCompendium",
                                name: "Item/Spell Add: Choice Dialog",
                                hint: "When clicking '+' on character sheets, prompts to choose between creating an item or opening the Compendium Browser (if enabled by the GM). Turn off to always create items directly.",
                                type: "Boolean",
                                default: true,
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
                                hint: "Offers toggles in damage rolls for Sneak Attack, Great Weapon Master (2024), Brutal Strike, Charger (2024), Savage Attacker (2024), Boon of Irresistible Offense (2024), Cleave weapon mastery malus, and active Hex or Hunter's Mark concentration effects, remembering your choices across rolls (if enabled by the GM).",
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
                                key: "clientEnableCarolingianTheme",
                                introduced: "14.37.0",
                                pairedWith: "enableCarolingianTheme",
                                name: "Carolingian UI Theme Harmony",
                                hint: "Automatically adopts Carolingian UI's active color theme and styling across the dashboard, floating HUD banners, damage prompts, and combat placeholders (only active when Carolingian UI is enabled).",
                                type: "Boolean",
                                default: true,
                                scope: "client",
                                requiresModule: "crlngn-ui"
                            },
                            {
                                key: "clientReadableTextSize",
                                introduced: "14.56.0",
                                pairedWith: "readableTextSize",
                                name: "Readable Text Size",
                                hint: "Overrides the GM's Readable Text Size on your screen: larger body text with more space between lines in item descriptions, biographies, journal pages, expanded items on sheets and item tooltips.",
                                type: "Select",
                                default: "world",
                                choices: [
                                    { value: "world", label: "Use World Setting" },
                                    { value: "off", label: "Off (D&D 5e Default)" },
                                    { value: "comfortable", label: "Comfortable" },
                                    { value: "large", label: "Large" }
                                ],
                                scope: "client"
                            },
                            {
                                key: "clientReadableTextSizeChat",
                                introduced: "14.56.0",
                                pairedWith: "readableTextSizeChat",
                                name: "Readable Text Size in Chat Cards",
                                hint: "Overrides the GM's choice for enlarging item and spell descriptions inside chat cards on your screen.",
                                type: "Select",
                                default: "world",
                                choices: [
                                    { value: "world", label: "Use World Setting" },
                                    { value: "on", label: "On" },
                                    { value: "off", label: "Off" }
                                ],
                                scope: "client"
                            },
                            {
                                key: "clientEnableCursorHints",
                                introduced: "14.28.5",
                                pairedWith: "enableCursorHints",
                                name: "Cursor Keyboard Hints",
                                hint: "Displays floating Alt/Shift/Ctrl modifier badges near your cursor (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableRollModeHighlight",
                                introduced: "14.28.5",
                                pairedWith: "enableRollModeHighlight",
                                name: "Roll Mode Highlight",
                                hint: "Highlights the recommended Advantage/Disadvantage button in d20 roll dialogs (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableChatCardStyling",
                                introduced: "14.28.5",
                                pairedWith: "enableChatCardStyling",
                                name: "Chat Card Styling Improvements",
                                hint: "Applies enhanced action buttons with text labels and ability shorthand (e.g. CON Save), roll badges, multi-die indicators, and color coding to chat cards on your screen (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
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
                                key: "clientEnableSceneNavName",
                                introduced: "14.28.5",
                                pairedWith: "enableSceneNavName",
                                name: "Sync Browser Tab Title",
                                hint: "Syncs your browser tab title with the viewed scene name (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableSheetPopoutButton",
                                introduced: "14.28.5",
                                pairedWith: "enableSheetPopoutButton",
                                name: "Sheet Pop-out Button",
                                hint: "Shows the ↗ pop-out button on character and item sheet headers (if enabled by the GM).",
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
                                key: "clientEnableItemSheetAttunementTag",
                                introduced: "14.33.0",
                                pairedWith: "enableItemSheetAttunementTag",
                                name: "Item Sheet Attunement Tag",
                                hint: "Shows the attunement tag on magic item sheets (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
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
                                parentKey: "clientEnableItemSheetAttunementTag"
                            },
                            {
                                key: "clientItemSheetAttunementTag_tooltip",
                                introduced: "14.33.0",
                                pairedWith: "itemSheetAttunementTag_tooltip",
                                name: "Show in Item Tooltips",
                                hint: "Display the attunement pill in rich item tooltips on your screen (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client",
                                parentKey: "clientEnableItemSheetAttunementTag"
                            },
                            {
                                key: "clientEnableContextMenuStyling",
                                introduced: "14.34.2",
                                pairedWith: "enableContextMenuStyling",
                                name: "Context Menu Styling",
                                hint: "Color-codes destructive (Delete in red), additive (Duplicate in green), and privacy actions (Make Private / Reveal in violet) in right-click context menus (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "enableToolbarLimitation",
                                introduced: "14.15.0",
                                docs: "toolbar-limitation",
                                keywords: ["scene controls", "scroll"],
                                name: "Toolbar Limitation",
                                hint: "When the number of buttons in a scene controls toolbar exceeds the limit, turns the toolbar scrollable.",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "toolbarButtonLimit",
                                introduced: "14.15.0",
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
                                key: "clientEnableAutoanimationsTeleportUI",
                                introduced: "14.32.0",
                                pairedWith: "enableAutoanimationsTeleportUI",
                                name: "Enhanced Teleport Targeting UI",
                                hint: "Shows a floating HUD banner, ghost token preview, and allows pressing ESC to cancel when picking an Automated Animations teleport destination (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableTemplateControlsHUD",
                                introduced: "14.35.0",
                                pairedWith: "enableTemplateControlsHUD",
                                name: "Template Placement Controls HUD & Scroll Rotation",
                                hint: "Shows a floating HUD banner with key controls and inverts wheel scrolling during template placement so scrolling rotates the template and Shift + scroll zooms the canvas (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
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
                                key: "clientEnableSummonControlsHUD",
                                introduced: "14.36.0",
                                pairedWith: "enableSummonControlsHUD",
                                name: "Summoning Placement Controls HUD",
                                hint: "Shows a floating HUD banner with key controls, live distance vs. max range badge, and canvas range ring during summoning placement (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableConditionHud",
                                introduced: "14.63.0",
                                pairedWith: "enableConditionHud",
                                name: "Token HUD Condition Palette",
                                hint: "Shows the Token HUD's status palette as a labelled, grouped list (if enabled by the GM). Turn off for the original icon grid.",
                                type: "Boolean",
                                default: true,
                                scope: "client"
                            },
                            {
                                key: "clientEnableClearTargetsButton",
                                introduced: "14.39.0",
                                pairedWith: "enableClearTargetsButton",
                                name: "Clear Targets Token Control Button",
                                hint: "Shows the Clear Targets button in your Token Controls toolbar (if enabled by the GM).",
                                type: "Boolean",
                                default: true,
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
                                key: "enableSceneNavName",
                                introduced: "14.0.0",
                                docs: "sync-browser-tab-title",
                                keywords: ["browser title"],
                                name: "Sync Browser Tab Title",
                                hint: "Keeps the browser tab title dynamically in sync with the name of the scene the client is currently viewing.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
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
                                key: "enableActorDispositionColors",
                                introduced: "14.0.0",
                                docs: "actor-directory-disposition-dots",
                                keywords: ["friendly", "hostile", "neutral", "sidebar"],
                                name: "Actor Directory Disposition Dots",
                                hint: "Adds a colored dot next to each actor name in the Actors sidebar to indicate their default token disposition (Friendly, Neutral, Hostile, or Secret).",
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
                            },
                            {
                                key: "readableTextSize",
                                introduced: "14.56.0",
                                docs: "readable-text-size",
                                keywords: ["font size", "accessibility", "bigger text", "line height"],
                                name: "Readable Text Size",
                                hint: "Default size for the body text of item descriptions, biographies, journal pages, expanded items on sheets and item tooltips, with more space between lines. The rest of the interface keeps its size. Players can override it under Personal Preferences.",
                                type: "Select",
                                default: "comfortable",
                                choices: [
                                    { value: "off", label: "Off (D&D 5e Default)" },
                                    { value: "comfortable", label: "Comfortable" },
                                    { value: "large", label: "Large" }
                                ],
                                scope: "world"
                            },
                            {
                                key: "readableTextSizeChat",
                                introduced: "14.56.0",
                                docs: "readable-text-size",
                                name: "Readable Text Size in Chat Cards",
                                hint: "Also enlarges item and spell descriptions inside chat cards. Cards become taller. Players can override it under Personal Preferences.",
                                type: "Boolean",
                                default: false,
                                scope: "world"
                            },
                            {
                                key: "enableSidebarNameWrap",
                                introduced: "14.1.0",
                                docs: "sidebar-multi-line-names",
                                keywords: ["long names", "sidebar"],
                                name: "Sidebar Multi-line Names",
                                hint: "Allows long document names in the right sidebar (Actors, Items, Scenes, etc.) to wrap onto multiple lines instead of being cut off.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableContextMenuStyling",
                                introduced: "14.34.2",
                                docs: "context-menu-styling",
                                keywords: ["right-click", "delete"],
                                name: "Context Menu Styling",
                                hint: "Color-codes destructive (Delete in red), additive (Duplicate in green), and privacy actions (Make Private / Reveal in violet) across right-click context menus in sheets, sidebars, and chat cards, with full light and dark mode support.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableCarolingianTheme",
                                introduced: "14.37.0",
                                docs: "carolingian-ui-theme-harmony",
                                name: "Carolingian UI Theme Harmony",
                                hint: "Harmonizes Nik's Tweaks styling with Carolingian UI, automatically adopting its active color theme (Carolingian Teal, Royal Blood, Dark Sorcery, etc.) across the settings dashboard, floating HUD banners, damage prompts, and toggles, while adjusting HUD banner positioning for top scene navigation.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                requiresModule: "crlngn-ui"
                            }
                        ]
                    },
                    {
                        id: "uiSheets",
                        title: "Sheets & Items",
                        icon: "fa-solid fa-file-lines",
                        settings: [
                            {
                                key: "enableCleanSheetTitles",
                                introduced: "14.9.0",
                                docs: "clean-sheet-window-titles",
                                keywords: ["window title"],
                                name: "Clean Sheet Window Titles",
                                hint: "Removes the verbose type prefix (e.g. \"Non Player Character:\") from document sheet window titles, showing just the document name.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                requiresReload: true
                            },
                            {
                                key: "cleanSheetTitles_format",
                                introduced: "14.9.0",
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
                                key: "enableSheetPopoutButton",
                                introduced: "14.18.0",
                                docs: "sheet-pop-out-button",
                                name: "Sheet Pop-out Button",
                                hint: "Adds a one-click pop-out button (↗) to the header of Actor and Item sheets to detach into a separate window without the 3-dot menu.",
                                type: "Boolean",
                                default: true,
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
                                key: "enableChatScrollFix",
                                introduced: "14.26.0",
                                docs: "reliable-chat-log-auto-scroll",
                                keywords: ["scroll", "chat log"],
                                name: "Reliable Chat Log Auto-Scroll",
                                hint: "Fixes the chat log failing to scroll completely to the bottom when new cards appear or expand. Keeps the chat log pinned during CSS transitions, asynchronous target resolution, collapsible tray toggles, and card updates.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "enableHidePrivateGMRolls",
                                introduced: "14.30.0",
                                docs: "hide-private-gm-rolls-from-players",
                                keywords: ["whisper", "blind roll", "secret roll"],
                                name: "Hide Private GM Rolls from Players",
                                hint: "Completely hides whispered, private, and blind rolls made by the GM from players in the chat log, rather than displaying an empty placeholder card with hidden contents.",
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
                                statusPicker: true,
                                hint: "Statuses left out of the Token HUD palette for everyone. A hidden status still shows while a token has it, so it can be removed.",
                                type: "String",
                                default: DEFAULT_HIDDEN_STATUSES,
                                scope: "world",
                                parentKey: "enableConditionHud"
                            },
                            {
                                key: "enableClearTargetsButton",
                                introduced: "14.39.0",
                                docs: "clear-targets-token-control-button",
                                keywords: ["untarget", "deselect"],
                                name: "Clear Targets Token Control Button",
                                hint: "Adds a button to the Token Controls toolbar that removes targets. For players, it removes their own targets; for GMs, it removes targets for both themselves and all connected players.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
                            {
                                key: "disableUndergroundTokenHiding",
                                introduced: "14.10.0",
                                docs: "disable-underground-token-hiding",
                                keywords: ["elevation", "burrow"],
                                name: "Disable Underground Token Hiding",
                                hint: "Prevents tokens with negative elevation from disappearing behind the scene background layer.",
                                type: "Boolean",
                                default: false,
                                scope: "world",
                                requiresReload: true
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
                                default: false,
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
                            },
                            {
                                key: "enableAutoanimationsTeleportUI",
                                introduced: "14.32.0",
                                docs: "enhanced-teleport-targeting-ui-automated-animations",
                                keywords: ["Misty Step", "Dimension Door", "teleport", "Automated Animations"],
                                name: "Enhanced Teleport Targeting UI (Autoanimations)",
                                hint: "When using an Automated Animations teleport preset (e.g. Misty Step, Dimension Door), adds a floating screen banner with live range/distance readout, a ghost token preview under the cursor showing valid/invalid placement, and allows pressing ESC to cancel.",
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
                                key: "enableAutoAddTokensToCombat",
                                introduced: "14.16.1",
                                docs: "auto-add-tokens-to-combat",
                                keywords: ["combat tracker", "encounter", "reinforcements"],
                                name: "Auto-Add Tokens to Combat",
                                hint: "Automatically adds new tokens to the active combat encounter when created or dragged to the canvas during combat.",
                                type: "Boolean",
                                default: true,
                                scope: "world"
                            },
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
                                hint: "Inserts placeholder turns in the combat tracker after each player turn when legendary creatures are present.",
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
                                key: "autoSkipEmptyLegendaryPlaceholders",
                                introduced: "14.46.6",
                                name: "Auto-Skip When No Uses Left",
                                hint: "Automatically skip legendary action placeholder turns in the combat tracker when no creature in the encounter has legendary action uses remaining.",
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
                                key: "enableConditionalDamage",
                                introduced: "14.45.0",
                                docs: "conditional-damage-bonuses-sneak-attack-hex-hunters-mark-great-weapon-master-brutal-strike-charger-savage-attacker-boon-of-irresistible-offense--cleave",
                                keywords: ["Sneak Attack", "Hex", "Hunter's Mark", "GWM", "Great Weapon Master", "Brutal Strike", "Charger", "Savage Attacker", "Cleave", "damage bonus"],
                                name: "Conditional Damage Bonuses",
                                hint: "Offers toggles in damage roll configuration dialogs for Sneak Attack, Great Weapon Master (2024), Brutal Strike, Charger (2024), Savage Attacker (2024), Boon of Irresistible Offense (2024), Cleave weapon mastery malus, and active Hex or Hunter's Mark concentration effects, remembering your choices across rolls.",
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
                                hint: "Automatically applies weapon masteries to targets when hit by player character attacks. Automates Slow (reducing speed by 10 ft), Sap (disadvantage on the creature's next attack roll) and Topple (a Constitution save when the damage is applied, Prone on a failure). Works with midi-qol. Disabled while Automated Masteries 5e is active.",
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
                            }
                        ]
                    }
                ]
            },
            {
                id: "conditionsEffects",
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
                                unavailableWith: "ac5e",
                                name: "Prone Attack Rolls",
                                hint: "A Prone attacker has Disadvantage. An attack against a Prone creature has Advantage if the attacker is within 5 feet, and Disadvantage otherwise (single target only). Works with midi-qol. Disabled while Automated Conditions 5e is active.",
                                type: "Boolean",
                                default: true,
                                scope: "world",
                                parentKey: "enableProneRules"
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
                                key: "enableDamageEmanation",
                                introduced: "14.54.0",
                                docs: "damage-emanation-automation",
                                keywords: ["Spirit Guardians", "Moonbeam", "Cloudkill", "aura", "zone", "area of effect", "AoE"],
                                name: "Damage Emanation Automation",
                                hint: "Spirit Guardians, Moonbeam, Cloudkill and similar emanations and areas trigger their save and damage when a creature enters, the area moves onto a creature, or a creature ends its turn inside. Once per creature per turn. Creatures inside at casting are left to the cast. The area is removed when concentration ends.",
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
                                hint: "Spell identifiers (or names) that get the automation. Other spells can add \"Damage Emanation\" in an activity's Behaviors tab.",
                                type: "String",
                                default: "cacophonic-shield, cloudkill, conjure-woodland-beings, dirge, doomtide, moonbeam, spirit-guardians, yolandes-regal-presence",
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
                                hint: "Cloudkill and Doomtide move 10 ft away from the caster at the start of each of the caster's turns.",
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
                                default: "Ambusher's Leap, Avenging Angel, Bestial Communication, Bladesong, Cloak of Shadows, Comprehension, Defensive Duelist, Disappearing Step, Disengaged, Disguised, Divine Favor, Draconic Flight, Duplicate A, Duplicate B, Duplicate C, Endless Ammunition, Ethereal, Evasive AC, Glib, Heavenly Wings, Imperceptible Barrier, Innate Sorcery, Large Form, Living Legend: Charismatic, Majestic Presence, Merged with Shadows, Patient Defense (Focus Point), Peerless Athlete, Psi-Powered Leap, Rage, Rage of the Gods, See Invisibility, Stonecunning, Superior Defense, Trance of Order, Unearthly Appearance, Veiled, Winged, Wreathed in Light",
                                scope: "world",
                                parentKey: "enableSelfEffectApplication"
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
            },
            {
                id: "utilities",
                label: "Utilities & Debug",
                icon: "fa-solid fa-wrench",
                description: "GM conveniences and diagnostics.",
                sections: [
                    {
                        id: "gmConvenience",
                        title: "GM Convenience",
                        icon: "fa-solid fa-user-shield",
                        settings: [
                            {
                                key: "autoUnpauseOnLogin",
                                introduced: "14.23.0",
                                docs: "auto-unpause-when-logging-in",
                                keywords: ["pause", "game paused"],
                                name: "Auto-Unpause When Logging In",
                                hint: "When you (the GM) log into a paused world, automatically unpause. \"Always\" unpauses regardless of connected players. \"When no players are connected\" only unpauses if no non-GM players are already in the session.",
                                type: "Select",
                                default: "never",
                                choices: [
                                    { value: "always", label: "Always" },
                                    { value: "noPlayers", label: "When no players are connected" },
                                    { value: "never", label: "Never" }
                                ],
                                scope: "user"
                            }
                        ]
                    },
                    {
                        id: "debugSection",
                        title: "Diagnostics",
                        icon: "fa-solid fa-bug",
                        settings: [
                            {
                                key: "debugMode",
                                introduced: "14.0.0",
                                docs: "debug-mode",
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
    _onFirstRender(context, options) {
        // The form element survives re-renders, so its listeners are added once.
        this.element.addEventListener("change", () => this.#queueRefresh());
        this.element.addEventListener("input", () => this.#queueRefresh());
    }

    /* -------------------------------------------- */
    /*  Opening, deep links and "new" tracking       */
    /* -------------------------------------------- */

    /**
     * Open the dashboard, or bring it to the front, optionally at one setting.
     * Exposed as `game.modules.get("niks-dnd5e-tweaks").api.openSettings(key)`.
     * @param {object} [options]
     * @param {string} [options.key]  Setting to scroll to and highlight.
     * @param {string} [options.tab]  Tab to open when no key is given.
     * @returns {Promise<NiksTweaksSettingsApp>}
     */
    static async open({ key, tab } = {}) {
        let app = foundry.applications.instances.get(DASHBOARD_ID);
        if (!app) app = new NiksTweaksSettingsApp();
        if (tab) app.#activeTab = tab;
        if (app.rendered) app.bringToFront();
        else await app.render({ force: true });
        if (key) app.revealSetting(key);
        return app;
    }

    /**
     * Version boundary for "New" badges: the version this user last opened the dashboard in. Before the first
     * open, settings from the previous minor version on count as new.
     * @returns {{version: string, inclusive: boolean}}
     */
    static #newBaseline() {
        const seen = readSetting("dashboardLastSeenVersion", "");
        if (seen) return { version: seen, inclusive: false };
        const [major = 0, minor = 0] = (game.modules.get(MODULE_ID)?.version ?? "0.0.0").split(".").map(Number);
        return { version: `${major}.${Math.max(0, minor - 1)}.0`, inclusive: true };
    }

    /**
     * @param {string} introduced
     * @param {{version: string, inclusive: boolean}} baseline
     */
    static #isNew(introduced, baseline) {
        if (!introduced) return false;
        if (baseline.inclusive && (introduced === baseline.version)) return true;
        return foundry.utils.isNewerVersion(introduced, baseline.version);
    }

    /**
     * Whether a setting is shown to this user: its module requirement and condition hold, and players only get
     * the Personal Preferences tab.
     * @param {object} setting
     * @param {string} tabId
     * @param {boolean} canModify
     */
    static #isVisible(setting, tabId, canModify) {
        if (setting.requiresModule && !game.modules.get(setting.requiresModule)?.active) return false;
        if ((typeof setting.condition === "function") && !setting.condition()) return false;
        return canModify || (tabId === PERSONAL_TAB);
    }

    /**
     * Number of settings this user hasn't seen yet. Shown on the button in Configure Settings.
     * @returns {number}
     */
    static countNewSettings() {
        const canModify = game.user.can("SETTINGS_MODIFY");
        const baseline = NiksTweaksSettingsApp.#newBaseline();
        let count = 0;
        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (NiksTweaksSettingsApp.#isVisible(s, tab.id, canModify)
                        && NiksTweaksSettingsApp.#isNew(s.introduced, baseline)) count++;
                }
            }
        }
        return count;
    }

    /* -------------------------------------------- */
    /*  Context                                     */
    /* -------------------------------------------- */

    /** @override */
    async _prepareContext(options) {
        const canModify = game.user.can("SETTINGS_MODIFY");
        if (!this.#activeTab) this.#activeTab = canModify ? OVERVIEW_TAB : PERSONAL_TAB;
        this.#baseline ??= NiksTweaksSettingsApp.#newBaseline();
        const baseline = this.#baseline;

        const schema = NiksTweaksSettingsApp.SETTINGS_SCHEMA;
        const all = schema.flatMap(tab => tab.sections.flatMap(sec => sec.settings));
        const byKey = new Map(all.map(s => [s.key, s]));
        const clientFor = new Map(all.filter(s => s.pairedWith).map(s => [s.pairedWith, s.key]));
        this.#settingsByKey = byKey;
        this.#initialValues.clear();

        const docsFor = (s) => {
            if (s.parentKey) return null;
            const docs = s.docs ?? byKey.get(s.pairedWith)?.docs;
            return docs ? DOCS_URL + docs : null;
        };
        const unavailableFor = (s) => {
            const mod = s.unavailableWith ? UNAVAILABLE_WITH[s.unavailableWith] : null;
            return mod?.isActive() ? mod : null;
        };

        const whatsNew = [];

        // Settings tabs
        const settingTabs = [];
        for (const tab of schema) {
            const sections = [];
            let newCount = 0;
            for (const sec of tab.sections) {
                const settings = [];
                for (const s of sec.settings) {
                    if (!NiksTweaksSettingsApp.#isVisible(s, tab.id, canModify)) continue;
                    const value = readSetting(s.key, s.default);
                    this.#initialValues.set(s.key, normalizeValue(s, value));

                    const unavailableModule = unavailableFor(s);
                    const isClient = s.scope === "client";
                    const isUser = s.scope === "user";
                    const isNew = NiksTweaksSettingsApp.#isNew(s.introduced, baseline);
                    // A personal opt-out that came with a new world setting isn't listed twice in "New since".
                    const pairIsNew = isClient && canModify && s.pairedWith
                        && NiksTweaksSettingsApp.#isNew(byKey.get(s.pairedWith)?.introduced, baseline);
                    if (isNew) newCount++;
                    if (isNew && !pairIsNew) {
                        const parent = s.parentKey ? byKey.get(s.parentKey) : null;
                        whatsNew.push({
                            key: s.key,
                            label: parent ? `${parent.name}: ${s.name}` : s.name,
                            where: `${tab.label} › ${sec.title}`,
                            introduced: s.introduced
                        });
                    }
                    const keywords = [...(s.keywords ?? []), ...(byKey.get(s.pairedWith)?.keywords ?? [])];
                    const editable = canModify || isClient || isUser;

                    settings.push({
                        ...s,
                        value,
                        choices: s.type === "Select"
                            ? (s.choices ?? []).map(c => ({ ...c, selected: c.value === value }))
                            : [],
                        unavailable: Boolean(unavailableModule),
                        unavailableLabel: unavailableModule?.label ?? "",
                        unavailableReason: unavailableModule
                            ? `Not available while ${unavailableModule.label} is active. It handles this itself, so this setting has no effect. Your choice is kept for when ${unavailableModule.label} is turned off.`
                            : "",
                        listCount: s.list ? parseListValue(value).length : 0,
                        isChild: Boolean(s.parentKey),
                        isClient,
                        isUser,
                        isNew,
                        locked: !editable,
                        canReset: editable && !unavailableModule,
                        defaultLabel: ["FilePicker", "String"].includes(s.type) && !s.list ? "" : valueLabel(s, s.default),
                        docsUrl: docsFor(s),
                        pairKey: s.pairedWith ?? clientFor.get(s.key) ?? null,
                        searchText: [s.name, s.hint, tab.label, sec.title, s.key, ...keywords].join(" ").toLowerCase()
                    });
                }
                if (settings.length) sections.push({ ...sec, settings });
            }
            if (sections.length) settingTabs.push({ ...tab, sections, newCount });
        }

        // Overview: one card per feature (top-level world settings)
        const groups = [];
        for (const tab of schema) {
            if (tab.id === PERSONAL_TAB) continue;
            const features = [];
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (s.parentKey) continue;
                    if (!((s.scope === "world") || (canModify && (s.scope === "user")))) continue;
                    if (!NiksTweaksSettingsApp.#isVisible(s, tab.id, true)) continue;
                    const value = readSetting(s.key, s.default);
                    const unavailableModule = unavailableFor(s);
                    const on = !isOffValue(s, value);
                    const clientKey = clientFor.get(s.key);
                    features.push({
                        key: s.key,
                        name: s.name,
                        summary: summarize(s.hint),
                        on,
                        valueLabel: valueLabel(s, value),
                        isNew: NiksTweaksSettingsApp.#isNew(s.introduced, baseline),
                        unavailable: Boolean(unavailableModule),
                        unavailableLabel: unavailableModule?.label ?? "",
                        canToggle: canModify && (s.type === "Boolean") && !unavailableModule,
                        canReveal: canModify,
                        clientKey: clientKey && byKey.has(clientKey) ? clientKey : null,
                        docsUrl: docsFor(s)
                    });
                }
            }
            // Players see what is active in this world; the rest is only counted.
            const shown = canModify ? features : features.filter(f => f.on && !f.unavailable);
            if (!features.length) continue;
            groups.push({
                id: tab.id,
                label: tab.label,
                icon: tab.icon,
                features: shown,
                onCount: features.filter(f => f.on && !f.unavailable).length,
                total: features.length,
                hiddenCount: features.length - shown.length
            });
        }

        const overviewTab = {
            id: OVERVIEW_TAB,
            label: canModify ? "Overview" : "Active in This World",
            icon: "fa-solid fa-table-cells-large",
            newCount: 0
        };
        const personal = settingTabs.find(t => t.id === PERSONAL_TAB);
        const others = settingTabs.filter(t => t.id !== PERSONAL_TAB);
        const navTabs = (canModify ? [overviewTab, ...others, personal] : [personal, overviewTab])
            .filter(Boolean)
            .map(t => ({ id: t.id, label: t.label, icon: t.icon, newCount: t.newCount, active: t.id === this.#activeTab }));

        return {
            canModify,
            fullHints: Boolean(readSetting("dashboardFullHints", false)),
            filters: FILTERS,
            navTabs,
            // Same order as the navigation, so search results read top to bottom like the tabs.
            tabs: (canModify ? [...others, personal] : [personal])
                .filter(Boolean)
                .map(t => ({ ...t, active: t.id === this.#activeTab })),
            overview: {
                active: this.#activeTab === OVERVIEW_TAB,
                label: overviewTab.label,
                description: canModify
                    ? "Every feature at a glance. Switch features on or off here, click a name to see all its options, or search above."
                    : "Features your GM has turned on in this world. Click \"Your choice\" to turn one off for yourself.",
                groups
            },
            whatsNew: whatsNew.slice(0, 12),
            whatsNewMore: Math.max(0, whatsNew.length - 12)
        };
    }

    /* -------------------------------------------- */
    /*  Rendering and listeners                     */
    /* -------------------------------------------- */

    /** @override */
    _onRender(context, options) {
        const html = this.element;

        // Tabs: switch normally; while searching or filtering, jump to that tab's results instead.
        for (const tabBtn of html.querySelectorAll(".nd5t-nav-tab")) {
            tabBtn.addEventListener("click", () => {
                const tabId = tabBtn.dataset.tab;
                if (this.#isFiltering) {
                    html.querySelector(`.nd5t-tab-panel.active[data-tab="${tabId}"]`)
                        ?.scrollIntoView({ block: "start", behavior: "smooth" });
                    return;
                }
                this.#activateTab(tabId);
            });
        }

        // Search
        const searchInput = html.querySelector(".nd5t-search-input");
        if (searchInput) {
            searchInput.value = this.#query;
            searchInput.addEventListener("input", () => {
                this.#query = searchInput.value;
                this.#applyFilters();
            });
            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    const first = html.querySelector(".nd5t-tab-panel.active .nd5t-setting-row:not(.nd5t-row-hidden)");
                    if (first) this.revealSetting(first.dataset.key);
                } else if ((event.key === "Escape") && (this.#query || this.#filters.size)) {
                    event.preventDefault();
                    event.stopPropagation();
                    this.#clearFilters();
                }
            });
        }
        for (const btn of html.querySelectorAll(".nd5t-search-clear, .nd5t-btn-clear-search")) {
            btn.addEventListener("click", () => {
                this.#clearFilters();
                searchInput?.focus();
            });
        }

        // Parent-child toggles
        for (const ctrl of html.querySelectorAll(".nd5t-setting-row:not(.nd5t-child-setting) :is(input[type='checkbox'], select)")) {
            ctrl.addEventListener("change", () => this.#updateChildSettingStates());
        }
        this.#updateChildSettingStates();

        // Hints: click to expand a shortened description
        for (const hint of html.querySelectorAll(".nd5t-setting-hint")) {
            hint.addEventListener("click", () => hint.closest(".nd5t-setting-row")?.classList.toggle("nd5t-hint-open"));
        }

        // Overview switches mirror the setting's own checkbox
        for (const proxy of html.querySelectorAll(".nd5t-feature-proxy")) {
            proxy.addEventListener("change", () => {
                const real = html.querySelector(`.nd5t-setting-row[data-key="${proxy.dataset.proxyFor}"] input[type="checkbox"]`);
                if (!real || real.disabled) return;
                real.checked = proxy.checked;
                real.dispatchEvent(new Event("change", { bubbles: true }));
            });
        }

        // FilePicker buttons
        for (const btn of html.querySelectorAll(".nd5t-file-picker-btn")) {
            btn.addEventListener("click", () => {
                const targetInput = html.querySelector(`#${btn.dataset.target}`);
                if (!targetInput) return;
                const fp = new foundry.applications.apps.FilePicker.implementation({
                    type: btn.dataset.type || "image",
                    current: targetInput.value,
                    callback: (path) => {
                        targetInput.value = path;
                        targetInput.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                });
                fp.browse();
            });
        }

        // Color picker <-> hex text input
        for (const group of html.querySelectorAll(".nd5t-color-group")) {
            const colorInput = group.querySelector(".nd5t-color-input");
            const textInput = group.querySelector(".nd5t-color-text");
            if (!colorInput || !textInput) continue;
            colorInput.addEventListener("input", () => { textInput.value = colorInput.value; });
            textInput.addEventListener("input", () => {
                const v = textInput.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) colorInput.value = v;
            });
        }

        // JSON import
        html.querySelector(".nd5t-file-import-input")?.addEventListener("change", (e) => this.#onFileSelected(e));

        this.#refreshRowStates();
        this.#applyFilters();
    }

    /** @override */
    async close(options = {}) {
        const pending = this.rendered && !options.submitted && !options.force ? this.#countPending() : 0;
        if (pending) {
            const discard = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Unsaved Changes" },
                content: `<p>You have <strong>${pending}</strong> unsaved ${pending === 1 ? "change" : "changes"}. Close without saving?</p>`,
                yes: { label: "Discard Changes", icon: "fa-solid fa-trash" },
                no: { label: "Keep Editing", icon: "fa-solid fa-pen" },
                modal: true
            });
            if (!discard) return this;
        }
        return super.close(options);
    }

    /** @override */
    _onClose(options) {
        super._onClose(options);
        for (const editor of this.#listEditors.values()) editor.close();
        this.#listEditors.clear();

        // Everything shown in this window counts as seen.
        const version = game.modules.get(MODULE_ID)?.version;
        this.#baseline = null;
        if (version && (readSetting("dashboardLastSeenVersion", "") !== version)) {
            game.settings.set(MODULE_ID, "dashboardLastSeenVersion", version)
                .then(() => refreshSettingsMenuBadge());
        }
    }

    /* -------------------------------------------- */
    /*  Tabs, reveal                                */
    /* -------------------------------------------- */

    /**
     * Show one tab (outside search and filter mode).
     * @param {string} tabId
     */
    #activateTab(tabId) {
        this.#activeTab = tabId;
        const html = this.element;
        for (const btn of html.querySelectorAll(".nd5t-nav-tab")) btn.classList.toggle("active", btn.dataset.tab === tabId);
        for (const panel of html.querySelectorAll(".nd5t-tab-panel")) panel.classList.toggle("active", panel.dataset.tab === tabId);
        html.querySelector(".nd5t-settings-content")?.scrollTo({ top: 0 });
    }

    /**
     * Clear search and filters, open the tab of a setting, scroll to it and highlight it.
     * @param {string} key
     * @returns {boolean}  Whether the setting is in this window.
     */
    revealSetting(key) {
        const html = this.element;
        const row = html?.querySelector(`.nd5t-setting-row[data-key="${key}"]`);
        if (!row) {
            ui.notifications.warn("That setting isn't available to you here.");
            return false;
        }
        this.#clearFilters();
        this.#activateTab(row.closest(".nd5t-tab-panel")?.dataset.tab);
        row.scrollIntoView({ block: "center" });
        row.classList.remove("nd5t-flash");
        void row.offsetWidth; // restart the animation
        row.classList.add("nd5t-flash");
        row.querySelector(".nd5t-setting-control :is(input:not([type='hidden']), select, button):not(:disabled)")
            ?.focus({ preventScroll: true });
        return true;
    }

    /* -------------------------------------------- */
    /*  Values, change markers, pending changes      */
    /* -------------------------------------------- */

    /**
     * Current form value of a setting row, or the stored value when the row isn't rendered.
     * @param {string} key
     */
    #currentValue(key) {
        const setting = this.#settingsByKey.get(key);
        const control = this.element?.querySelector(`.nd5t-setting-row[data-key="${key}"] [name="${key}"]`);
        if (!setting || !control) return readSetting(key, setting?.default);
        if (setting.type === "Boolean") return control.checked;
        if (setting.type === "Number") return Number(control.value);
        return control.value;
    }

    /**
     * Put a value into a setting row's control and announce the change.
     * @param {HTMLElement} row
     * @param {object} setting
     * @param {*} value
     */
    #writeControl(row, setting, value) {
        const control = row.querySelector(`[name="${setting.key}"]`);
        if (!control) return;
        if (setting.type === "Boolean") control.checked = Boolean(value);
        else control.value = value;
        if (setting.type === "Color") {
            const text = row.querySelector(".nd5t-color-text");
            if (text) text.value = value;
        }
        if (setting.list) {
            const label = row.querySelector(".nd5t-list-count");
            if (label) label.textContent = parseListValue(String(value)).length;
        }
        control.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** Number of settings whose form value differs from the stored value. */
    #countPending() {
        let count = 0;
        for (const [key, initial] of this.#initialValues) {
            const setting = this.#settingsByKey.get(key);
            if (setting && (normalizeValue(setting, this.#currentValue(key)) !== initial)) count++;
        }
        return count;
    }

    #queueRefresh() {
        if (this.#refreshQueued) return;
        this.#refreshQueued = true;
        requestAnimationFrame(() => {
            this.#refreshQueued = false;
            if (this.rendered) this.#refreshRowStates();
        });
    }

    /**
     * Update everything that depends on the current form values: changed / unsaved markers, linked
     * world and personal settings, overview cards, filter counts and the Save button.
     */
    #refreshRowStates() {
        const html = this.element;
        if (!html) return;
        let pending = 0;

        for (const row of html.querySelectorAll(".nd5t-setting-row[data-key]")) {
            const setting = this.#settingsByKey.get(row.dataset.key);
            if (!setting) continue;
            const current = normalizeValue(setting, this.#currentValue(setting.key));
            const modified = current !== normalizeValue(setting, setting.default);
            const dirty = current !== this.#initialValues.get(setting.key);
            if (dirty) pending++;
            row.classList.toggle("nd5t-modified", modified);
            row.classList.toggle("nd5t-dirty", dirty);
            row.dataset.off = String(!setting.parentKey && isOffValue(setting, current));
        }

        // Linked world / personal settings
        for (const chip of html.querySelectorAll(".nd5t-pair-chip[data-pair]")) {
            const pair = this.#settingsByKey.get(chip.dataset.pair);
            if (!pair) continue;
            const value = this.#currentValue(pair.key);
            const off = isOffValue(pair, value);
            const label = chip.querySelector(".nd5t-pair-value");
            if (label) label.textContent = valueLabel(pair, value);
            chip.classList.toggle("off", off);
            const row = chip.closest(".nd5t-setting-row");
            if (row && (pair.scope === "world")) row.classList.toggle("nd5t-world-off", off);
        }

        // Overview cards
        for (const card of html.querySelectorAll(".nd5t-feature-card[data-key]")) {
            const setting = this.#settingsByKey.get(card.dataset.key);
            if (!setting) continue;
            const value = this.#currentValue(setting.key);
            const off = isOffValue(setting, value);
            card.classList.toggle("off", off);
            const proxy = card.querySelector(".nd5t-feature-proxy");
            if (proxy) proxy.checked = !off;
            const valueEl = card.querySelector(".nd5t-feature-value");
            if (valueEl) valueEl.textContent = valueLabel(setting, value);
            const dirty = this.#initialValues.has(setting.key)
                && (normalizeValue(setting, value) !== this.#initialValues.get(setting.key));
            card.classList.toggle("nd5t-dirty", dirty);
        }
        for (const group of html.querySelectorAll(".nd5t-overview-group")) {
            const count = group.querySelector(".nd5t-group-on");
            if (count) count.textContent = group.querySelectorAll(".nd5t-feature-card:not(.off):not(.unavailable)").length;
        }

        // Filter counts
        for (const chip of html.querySelectorAll(".nd5t-filter-chip")) {
            const id = chip.dataset.filter;
            let count = 0;
            for (const row of html.querySelectorAll(".nd5t-setting-row[data-key]")) {
                if (this.#rowMatchesFilter(row, id)) count++;
            }
            chip.querySelector(".nd5t-filter-count").textContent = count;
            chip.hidden = !count && !this.#filters.has(id);
        }

        // Save button and footer
        const save = html.querySelector(".nd5t-save-count");
        if (save) {
            save.textContent = pending;
            save.hidden = !pending;
        }
        const note = html.querySelector(".nd5t-pending-note");
        if (note) {
            note.textContent = pending ? `${pending} unsaved ${pending === 1 ? "change" : "changes"}` : "";
            note.hidden = !pending;
        }
    }

    /* -------------------------------------------- */
    /*  Search and filters                          */
    /* -------------------------------------------- */

    get #isFiltering() {
        return Boolean(this.#query.trim()) || (this.#filters.size > 0);
    }

    /**
     * @param {HTMLElement} row
     * @param {string} filter
     */
    #rowMatchesFilter(row, filter) {
        switch (filter) {
            case "changed": return row.classList.contains("nd5t-modified");
            case "new": return row.dataset.new === "true";
            case "off": return row.dataset.off === "true";
            case "reload": return row.dataset.reload === "true";
            case "unavailable": return row.classList.contains("nd5t-unavailable");
            default: return true;
        }
    }

    #clearFilters() {
        this.#query = "";
        this.#filters.clear();
        const input = this.element?.querySelector(".nd5t-search-input");
        if (input) input.value = "";
        this.#applyFilters();
    }

    /**
     * Show the settings that match every search word (in any order, also in keywords) and every active filter,
     * across all tabs, with the matches highlighted.
     */
    #applyFilters() {
        const html = this.element;
        if (!html) return;
        const tokens = this.#query.toLowerCase().split(/\s+/).filter(Boolean);
        const filtering = this.#isFiltering;
        html.querySelector(".nd5t-dashboard-wrapper")?.classList.toggle("nd5t-filtering", filtering);

        const matchesByTab = {};
        let total = 0;
        for (const row of html.querySelectorAll(".nd5t-setting-row[data-key]")) {
            const text = row.dataset.searchText ?? "";
            const visible = !filtering || (tokens.every(t => text.includes(t))
                && [...this.#filters].every(f => this.#rowMatchesFilter(row, f)));
            row.classList.toggle("nd5t-row-hidden", !visible);
            if (filtering && visible) {
                total++;
                const tabId = row.closest(".nd5t-tab-panel")?.dataset.tab;
                if (tabId) matchesByTab[tabId] = (matchesByTab[tabId] ?? 0) + 1;
            }

            // Highlight the words in the name and description; open descriptions that contain a match.
            let hintMatch = false;
            for (const el of row.querySelectorAll(".nd5t-setting-name, .nd5t-setting-hint")) {
                el.dataset.plain ??= el.textContent;
                const shownTokens = visible ? tokens : [];
                if (shownTokens.length) {
                    el.innerHTML = highlightText(el.dataset.plain, shownTokens);
                    if (el.classList.contains("nd5t-setting-hint")) {
                        const plain = el.dataset.plain.toLowerCase();
                        hintMatch = shownTokens.some(t => plain.includes(t));
                    }
                } else if (el.querySelector("mark")) {
                    el.textContent = el.dataset.plain;
                }
            }
            row.classList.toggle("nd5t-hint-match", hintMatch);
        }

        for (const sec of html.querySelectorAll(".nd5t-section")) {
            sec.classList.toggle("nd5t-row-hidden", !sec.querySelector(".nd5t-setting-row:not(.nd5t-row-hidden)"));
        }
        for (const panel of html.querySelectorAll(".nd5t-tab-panel")) {
            const id = panel.dataset.tab;
            panel.classList.toggle("active", filtering ? Boolean(matchesByTab[id]) : (id === this.#activeTab));
        }
        for (const btn of html.querySelectorAll(".nd5t-nav-tab")) {
            const count = matchesByTab[btn.dataset.tab] ?? 0;
            const badge = btn.querySelector(".tab-badge");
            if (badge) {
                badge.textContent = count;
                badge.hidden = !(filtering && count);
            }
            btn.classList.toggle("active", !filtering && (btn.dataset.tab === this.#activeTab));
            btn.classList.toggle("nd5t-no-matches", filtering && !count);
        }
        for (const chip of html.querySelectorAll(".nd5t-filter-chip")) {
            const on = this.#filters.has(chip.dataset.filter);
            chip.classList.toggle("active", on);
            chip.setAttribute("aria-pressed", String(on));
        }

        const clear = html.querySelector(".nd5t-search-clear");
        if (clear) clear.hidden = !filtering;
        const status = html.querySelector(".nd5t-search-status");
        if (status) status.hidden = !filtering;
        const countEl = html.querySelector(".nd5t-match-count");
        if (countEl) countEl.textContent = total;
        const noResults = html.querySelector(".nd5t-no-results");
        if (noResults) noResults.hidden = !(filtering && !total);
    }

    /* -------------------------------------------- */
    /*  Actions                                     */
    /* -------------------------------------------- */

    /**
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onToggleFilter(event, target) {
        const id = target.dataset.filter;
        if (this.#filters.has(id)) this.#filters.delete(id);
        else this.#filters.add(id);
        this.#applyFilters();
    }

    /**
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onRevealSetting(event, target) {
        event.preventDefault();
        this.revealSetting(target.dataset.key);
    }

    /**
     * Put one setting back to its default value (stored on Save Changes).
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onResetSetting(event, target) {
        const setting = this.#settingsByKey.get(target.dataset.key);
        const row = target.closest(".nd5t-setting-row");
        if (!setting || !row) return;
        this.#writeControl(row, setting, setting.default);
        if (setting.list) row.querySelector(".nd5t-list-edit-btn")?.classList.add("nd5t-list-modified");
        this.#updateChildSettingStates();
    }

    /**
     * Switch between one-line and full descriptions. A personal view preference, stored right away.
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onToggleHints(event, target) {
        const full = !this.element.querySelector(".nd5t-dashboard-wrapper")?.classList.contains("nd5t-full-hints");
        this.element.querySelector(".nd5t-dashboard-wrapper")?.classList.toggle("nd5t-full-hints", full);
        target.setAttribute("aria-pressed", String(full));
        const icon = target.querySelector("i");
        if (icon) icon.className = `fa-solid ${full ? "fa-align-left" : "fa-grip-lines"}`;
        const label = target.querySelector("span");
        if (label) label.textContent = full ? "Full descriptions" : "Short descriptions";
        await game.settings.set(MODULE_ID, "dashboardFullHints", full);
    }

    /**
     * Open the pop-out list editor for a list setting. Apply writes the value into the
     * dashboard's hidden input; it is stored when the dashboard is saved.
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onEditList(event, target) {
        const key = target.dataset.key;
        const setting = NiksTweaksSettingsApp.SETTINGS_SCHEMA
            .flatMap(tab => tab.sections.flatMap(sec => sec.settings))
            .find(s => s.key === key);
        const input = this.element.querySelector(`input[name="${key}"]`);
        if (!setting || !input) return;

        const open = this.#listEditors.get(key);
        if (open?.rendered) {
            open.bringToFront();
            return;
        }

        const editor = new NiksListEditorApp({
            settingKey: key,
            settingName: setting.name,
            hint: setting.hint,
            value: input.value,
            defaultValue: setting.default,
            onApply: (value) => {
                input.value = value;
                const count = parseListValue(value).length;
                const label = target.querySelector(".nd5t-list-count");
                if (label) label.textContent = count;
                target.classList.add("nd5t-list-modified");
                target.title = "Edited. Use Save Changes to store this list.";
                this.#queueRefresh();
            }
        });
        editor.addEventListener("close", () => this.#listEditors.delete(key), { once: true });
        this.#listEditors.set(key, editor);
        editor.render({ force: true });
    }

    /**
     * Open the status picker for a status list setting. Apply writes the hidden IDs into the dashboard's
     * hidden input; they are stored when the dashboard is saved.
     * @this {NiksTweaksSettingsApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onEditStatuses(event, target) {
        const key = target.dataset.key;
        const setting = NiksTweaksSettingsApp.SETTINGS_SCHEMA
            .flatMap(tab => tab.sections.flatMap(sec => sec.settings))
            .find(s => s.key === key);
        const input = this.element.querySelector(`input[name="${key}"]`);
        if (!setting || !input) return;

        const open = this.#listEditors.get(key);
        if (open?.rendered) {
            open.bringToFront();
            return;
        }

        const picker = new NiksStatusPickerApp({
            settingKey: key,
            settingName: setting.name,
            hint: setting.hint,
            value: input.value,
            defaultValue: setting.default,
            onApply: (value) => {
                input.value = value;
                const label = target.querySelector(".nd5t-list-count");
                if (label) label.textContent = parseListValue(value).length;
                target.classList.add("nd5t-list-modified");
                target.title = "Edited. Use Save Changes to store this choice.";
                this.#queueRefresh();
            }
        });
        picker.addEventListener("close", () => this.#listEditors.delete(key), { once: true });
        this.#listEditors.set(key, picker);
        picker.render({ force: true });
    }

    /**
     * Updates disabled states for child settings based on parent control status
     */
    #updateChildSettingStates() {
        const html = this.element;
        const childRows = html.querySelectorAll(".nd5t-setting-row[data-parent]");

        childRows.forEach(row => {
            const parentKey = row.dataset.parent;
            const parentRow = html.querySelector(`.nd5t-setting-row[data-key="${parentKey}"]`);
            const parentCheckbox = parentRow?.querySelector("input[type='checkbox']");
            const parentSelect = parentRow?.querySelector("select");

            let isParentActive = true;
            if (parentCheckbox) {
                isParentActive = parentCheckbox.checked;
            } else if (parentSelect) {
                isParentActive = parentSelect.value !== "none" && parentSelect.value !== "";
            }

            const controls = row.querySelectorAll("input, select, button");
            if (!isParentActive) {
                row.classList.add("nd5t-parent-disabled");
                controls.forEach(ctrl => ctrl.setAttribute("disabled", "disabled"));
            } else {
                row.classList.remove("nd5t-parent-disabled");
                // Check overall user permissions before re-enabling
                const isClient = row.dataset.scope === "client" || row.querySelector(".nd5t-badge.client") !== null;
                const isUser = row.dataset.scope === "user" || row.querySelector(".nd5t-badge.user") !== null;
                if (game.user.can("SETTINGS_MODIFY") || isClient || isUser) {
                    controls.forEach(ctrl => ctrl.removeAttribute("disabled"));
                }
            }
        });

        // Settings taken over by another module stay locked, whatever their parent says
        html.querySelectorAll(".nd5t-setting-row.nd5t-unavailable").forEach(row => {
            row.querySelectorAll(".nd5t-setting-control :is(input, select, button)")
                .forEach(ctrl => ctrl.setAttribute("disabled", "disabled"));
        });
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
                    // Enforce permission: non-authorized users can only save client/user-scoped settings
                    if (s.scope !== "client" && s.scope !== "user" && !canModify) continue;
                    if (s.requiresModule && !game.modules.get(s.requiresModule)?.active) continue;
                    if (typeof s.condition === "function" && !s.condition()) continue;

                    const rawVal = formData.object[s.key];

                    // If the raw value is absent (undefined), the input was disabled
                    // (e.g. a child setting whose parent is off) and was not submitted
                    // by the browser. Skip it entirely to preserve the stored value.
                    if (rawVal === undefined) continue;

                    let formVal = rawVal;
                    if (s.type === "Boolean") {
                        formVal = Boolean(formVal);
                    } else if (s.type === "Number") {
                        formVal = Number(formVal);
                    } else if (s.list) {
                        formVal = normalizeListValue(formVal);
                    }

                    const currentVal = game.settings.get(MODULE_ID, s.key);
                    if (formVal !== currentVal) {
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
                foundry.applications.settings.SettingsConfig.reloadConfirm();
            }
        }
    }

    /**
     * Resets all settings to their default values (world + client for GMs, client-only for non-GMs)
     */
    static async #onResetDefaults(event, target) {
        const canModify = game.user.can("SETTINGS_MODIFY");

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: "Reset Settings to Default" },
            content: canModify
                ? "<p>Are you sure you want to reset all <strong>Nik's D&D 5e Tweaks</strong> settings to their default values?</p>"
                : "<p>Are you sure you want to reset your personal <strong>Nik's D&D 5e Tweaks</strong> preferences to their default values?</p>",
            modal: true
        });

        if (!confirmed) return;

        let requiresReload = false;
        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (!canModify && s.scope !== "client" && s.scope !== "user") continue;
                    if (s.requiresModule && !game.modules.get(s.requiresModule)?.active) continue;
                    if (typeof s.condition === "function" && !s.condition()) continue;
                    const currentVal = game.settings.get(MODULE_ID, s.key);
                    if (currentVal !== s.default) {
                        await game.settings.set(MODULE_ID, s.key, s.default);
                        if (s.requiresReload) requiresReload = true;
                    }
                }
            }
        }

        ui.notifications.info(canModify
            ? "Nik's D&D 5e Tweaks settings have been reset to default values."
            : "Your personal preferences have been reset to default values.");
        if (requiresReload) {
            foundry.applications.settings.SettingsConfig.reloadConfirm();
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
                    } catch {
                        settingsData[s.key] = s.default;
                    }
                }
            }
        }

        const exportPayload = {
            module: MODULE_ID,
            title: "Nik's D&D 5e Tweaks Settings Export",
            version: game.modules.get(MODULE_ID)?.version || "14.24.2",
            exportedAt: new Date().toISOString(),
            exportedBy: game.user.name,
            settings: settingsData
        };

        const filename = `niks-dnd5e-tweaks-settings-${new Date().toISOString().slice(0, 10)}.json`;
        foundry.utils.saveDataToFile(JSON.stringify(exportPayload, null, 2), "application/json", filename);
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
        if (!game.user.can("SETTINGS_MODIFY")) {
            ui.notifications.error("You do not have permission to modify world settings.");
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const rawContent = await foundry.utils.readTextFromFile(file);
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

            const listKeys = new Set(NiksTweaksSettingsApp.SETTINGS_SCHEMA
                .flatMap(tab => tab.sections.flatMap(sec => sec.settings))
                .filter(s => s.list)
                .map(s => s.key));

            for (const [key, rawValue] of Object.entries(data.settings)) {
                // Verify setting exists in registry
                const settingConfig = game.settings.settings.get(`${MODULE_ID}.${key}`);
                if (settingConfig) {
                    const value = listKeys.has(key) ? normalizeListValue(rawValue) : rawValue;
                    const current = game.settings.get(MODULE_ID, key);
                    if (current !== value) {
                        await game.settings.set(MODULE_ID, key, value);
                        appliedCount++;
                        if (settingConfig.requiresReload) requiresReload = true;
                    }
                }
            }

            ui.notifications.info(`Successfully imported ${appliedCount} settings from ${file.name}.`);
            if (requiresReload) {
                foundry.applications.settings.SettingsConfig.reloadConfirm();
            }
            this.render();
        } catch (err) {
            log("Failed to import settings file", err);
            ui.notifications.error("Failed to parse settings JSON file: " + err.message);
        }
    }
}
