import { MODULE_ID, log } from "./context.js";
import { NiksListEditorApp, normalizeListValue, parseListValue } from "./settings-list-editor.js";
import { NiksStatusPickerApp } from "./settings-status-picker.js";
import { getAllSettings, getModule, getModuleIds, getTabs, getUnavailableWith, resolveSettingId } from "./settings-registry.js";

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
 * Read a dashboard entry's stored value without throwing for settings that aren't registered.
 * @param {object} setting  Registry entry (`module`, `settingKey`).
 * @param {*} fallback
 */
function readSetting(setting, fallback) {
    try {
        return game.settings.get(setting.module, setting.settingKey);
    } catch {
        return fallback;
    }
}

/**
 * Read one of the dashboard's own view-state settings.
 * @param {string} key
 * @param {*} fallback
 */
function readOwn(key, fallback) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return fallback;
    }
}

/**
 * Store a dashboard entry's value.
 * @param {object} setting  Registry entry.
 * @param {*} value
 */
function writeSetting(setting, value) {
    return game.settings.set(setting.module, setting.settingKey, value);
}

/**
 * Versions this user last opened the dashboard in, per module. The add-on's entry falls back to the
 * single-module setting used before 14.69.0.
 * @returns {Record<string, string>}
 */
function readLastSeen() {
    const seen = { ...(readOwn("dashboardLastSeen", {}) ?? {}) };
    if (!seen[MODULE_ID]) {
        const legacy = readOwn("dashboardLastSeenVersion", "");
        if (legacy) seen[MODULE_ID] = legacy;
    }
    return seen;
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
     * Dashboard tabs from the settings registry (every registered module's schema, merged).
     * @returns {object[]}
     */
    static get SETTINGS_SCHEMA() {
        return getTabs();
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
     * Version boundaries for "New" badges, per module: the version this user last opened the dashboard in.
     * Before the first open, settings from the module's previous minor version on count as new.
     * @returns {Map<string, {version: string, inclusive: boolean}>}
     */
    static #newBaselines() {
        const seen = readLastSeen();
        const baselines = new Map();
        for (const id of getModuleIds()) {
            if (seen[id]) {
                baselines.set(id, { version: seen[id], inclusive: false });
                continue;
            }
            const [major = 0, minor = 0] = (game.modules.get(id)?.version ?? "0.0.0").split(".").map(Number);
            baselines.set(id, { version: `${major}.${Math.max(0, minor - 1)}.0`, inclusive: true });
        }
        return baselines;
    }

    /**
     * Whether an entry was added after its module's baseline.
     * @param {object} [setting]  Registry entry (`introduced`, `module`).
     * @param {Map<string, {version: string, inclusive: boolean}>} baselines
     */
    static #isNew(setting, baselines) {
        const introduced = setting?.introduced;
        const baseline = baselines.get(setting?.module);
        if (!introduced || !baseline) return false;
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
        const baselines = NiksTweaksSettingsApp.#newBaselines();
        let count = 0;
        for (const tab of NiksTweaksSettingsApp.SETTINGS_SCHEMA) {
            for (const sec of tab.sections) {
                for (const s of sec.settings) {
                    if (NiksTweaksSettingsApp.#isVisible(s, tab.id, canModify)
                        && NiksTweaksSettingsApp.#isNew(s, baselines)) count++;
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
        this.#baseline ??= NiksTweaksSettingsApp.#newBaselines();
        const baselines = this.#baseline;

        const schema = NiksTweaksSettingsApp.SETTINGS_SCHEMA;
        const all = schema.flatMap(tab => tab.sections.flatMap(sec => sec.settings));
        const byKey = new Map(all.map(s => [s.key, s]));
        const clientFor = new Map(all.filter(s => s.pairedWith).map(s => [s.pairedWith, s.key]));
        this.#settingsByKey = byKey;
        this.#initialValues.clear();

        const docsFor = (s) => {
            if (s.parentKey) return null;
            const docs = s.docs ?? byKey.get(s.pairedWith)?.docs;
            const base = getModule(s.module)?.docsUrl;
            return (docs && base) ? base + docs : null;
        };
        const unavailableFor = (s) => {
            const mod = getUnavailableWith(s.unavailableWith);
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
                    const value = readSetting(s, s.default);
                    this.#initialValues.set(s.key, normalizeValue(s, value));

                    const unavailableModule = unavailableFor(s);
                    const isClient = s.scope === "client";
                    const isUser = s.scope === "user";
                    const isNew = NiksTweaksSettingsApp.#isNew(s, baselines);
                    // A personal opt-out that came with a new world setting isn't listed twice in "New since".
                    const pairIsNew = isClient && canModify && s.pairedWith
                        && NiksTweaksSettingsApp.#isNew(byKey.get(s.pairedWith), baselines);
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
                        searchText: [s.name, s.hint, tab.label, sec.title, s.settingKey, ...keywords].join(" ").toLowerCase()
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
                    const value = readSetting(s, s.default);
                    const unavailableModule = unavailableFor(s);
                    const on = !isOffValue(s, value);
                    const clientKey = clientFor.get(s.key);
                    features.push({
                        key: s.key,
                        name: s.name,
                        summary: summarize(s.hint),
                        on,
                        valueLabel: valueLabel(s, value),
                        isNew: NiksTweaksSettingsApp.#isNew(s, baselines),
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
            fullHints: Boolean(readOwn("dashboardFullHints", false)),
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
                const targetInput = html.querySelector(`#${CSS.escape(btn.dataset.target)}`);
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
        this.#baseline = null;
        const stored = readOwn("dashboardLastSeen", {}) ?? {};
        const seen = readLastSeen();
        let changed = false;
        for (const id of getModuleIds()) {
            const version = game.modules.get(id)?.version;
            if (version && (stored[id] !== version)) {
                seen[id] = version;
                changed = true;
            }
        }
        if (changed) {
            game.settings.set(MODULE_ID, "dashboardLastSeen", seen)
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
        key = resolveSettingId(key, MODULE_ID) ?? key;
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
        if (!setting || !control) return setting ? readSetting(setting, setting.default) : undefined;
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
        const setting = getAllSettings().find(s => s.key === key);
        const input = this.element.querySelector(`input[name="${key}"]`);
        if (!setting || !input) return;

        const open = this.#listEditors.get(key);
        if (open?.rendered) {
            open.bringToFront();
            return;
        }

        const editor = new NiksListEditorApp({
            settingKey: key.replaceAll(".", "-"),
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
        const setting = getAllSettings().find(s => s.key === key);
        const input = this.element.querySelector(`input[name="${key}"]`);
        if (!setting || !input) return;

        const open = this.#listEditors.get(key);
        if (open?.rendered) {
            open.bringToFront();
            return;
        }

        const picker = new NiksStatusPickerApp({
            settingKey: key.replaceAll(".", "-"),
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

                    const currentVal = readSetting(s, s.default);
                    if (formVal !== currentVal) {
                        await writeSetting(s, formVal);
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
                    const currentVal = readSetting(s, s.default);
                    if (currentVal !== s.default) {
                        await writeSetting(s, s.default);
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
        const modules = {};
        for (const s of getAllSettings()) {
            modules[s.module] ??= { version: game.modules.get(s.module)?.version ?? "", settings: {} };
            modules[s.module].settings[s.settingKey] = readSetting(s, s.default);
        }

        // Format 2: settings grouped by module. Import also accepts format 1 (`module` + flat `settings`).
        const exportPayload = {
            format: 2,
            title: "Nik's D&D 5e Tweaks Settings Export",
            exportedAt: new Date().toISOString(),
            exportedBy: game.user.name,
            modules
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
     * Settings of an export file, grouped by module id. Format 2 groups them itself; format 1 (before 14.69.0)
     * has this module's settings as one flat object.
     * @param {object} data  Parsed export file.
     * @returns {Record<string, Record<string, any>>|null}  Null when the file isn't a settings export.
     */
    static #readExportModules(data) {
        if (!data || (typeof data !== "object")) return null;
        if ((data.format === 2) && data.modules && (typeof data.modules === "object")) {
            const modules = {};
            for (const [id, entry] of Object.entries(data.modules)) {
                if (entry?.settings && (typeof entry.settings === "object")) modules[id] = entry.settings;
            }
            return Object.keys(modules).length ? modules : null;
        }
        if ((data.module === MODULE_ID) && data.settings && (typeof data.settings === "object")) {
            return { [MODULE_ID]: data.settings };
        }
        return null;
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

            const modules = NiksTweaksSettingsApp.#readExportModules(data);
            if (!modules) {
                ui.notifications.error("Invalid configuration file: not a Nik's D&D 5e Tweaks settings export.");
                return;
            }

            const keyCount = Object.values(modules).reduce((n, settings) => n + Object.keys(settings).length, 0);
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Import Settings" },
                content: `<p>Found <strong>${keyCount}</strong> settings in <em>${file.name}</em>.</p><p>Import and apply these settings to your world now?</p>`,
                modal: true
            });

            if (!confirmed) return;

            let requiresReload = false;
            let appliedCount = 0;

            const listKeys = new Set(getAllSettings().filter(s => s.list).map(s => s.key));

            for (const [moduleId, settings] of Object.entries(modules)) {
                for (const [key, rawValue] of Object.entries(settings)) {
                    // Verify setting exists in registry
                    const settingConfig = game.settings.settings.get(`${moduleId}.${key}`);
                    if (!settingConfig) continue;
                    const value = listKeys.has(`${moduleId}.${key}`) ? normalizeListValue(rawValue) : rawValue;
                    const current = game.settings.get(moduleId, key);
                    if (current !== value) {
                        await game.settings.set(moduleId, key, value);
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
