/**
 * Pop-out editor for comma-separated free-text list settings in the Settings Dashboard
 * (e.g. Self Effect Application's Auto-Apply Effects). Entries are added, searched and
 * removed individually instead of editing one long text field.
 *
 * @introduced v14.49.1
 */

/**
 * Split a comma-separated list into trimmed entries, dropping empty entries and
 * case-insensitive duplicates (first spelling wins), sorted alphabetically (case-insensitive).
 *
 * @param {string} value
 * @returns {string[]}
 */
export function parseListValue(value) {
    if (typeof value !== "string") return [];
    const seen = new Set();
    const entries = [];
    for (const raw of value.split(",")) {
        const entry = raw.trim();
        const key = entry.toLocaleLowerCase();
        if (!entry || seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
    }
    return entries.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Normalize a comma-separated free-text list: trims entries, drops empty entries and
 * case-insensitive duplicates, and sorts alphabetically (case-insensitive).
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeListValue(value) {
    if (typeof value !== "string") return value;
    return parseListValue(value).join(", ");
}

/**
 * ApplicationV2 window that edits one list setting and hands the result back to the dashboard.
 */
export class NiksListEditorApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    /**
     * @param {object} options
     * @param {string} options.settingKey            Setting key being edited.
     * @param {string} options.settingName           Display name for the window title.
     * @param {string} [options.hint]                Hint shown above the list.
     * @param {string} options.value                 Current comma-separated value.
     * @param {string} [options.defaultValue]        Default comma-separated value for "Reset to Default".
     * @param {(value: string) => void} options.onApply  Receives the normalized value on Apply.
     */
    constructor(options = {}) {
        super({ ...options, id: `nd5t-list-editor-${options.settingKey}` });
        this.#settingKey = options.settingKey;
        this.#settingName = options.settingName;
        this.#hint = options.hint ?? "";
        this.#entries = parseListValue(options.value ?? "");
        this.#defaultEntries = parseListValue(options.defaultValue ?? "");
        this.#onApply = options.onApply;
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        classes: ["nd5t-settings-app", "nd5t-list-editor"],
        tag: "div",
        window: {
            icon: "fa-solid fa-list",
            resizable: true
        },
        position: {
            width: 420,
            height: 560
        },
        actions: {
            addEntry: NiksListEditorApp.#onAddEntry,
            removeEntry: NiksListEditorApp.#onRemoveEntry,
            resetEntries: NiksListEditorApp.#onResetEntries,
            applyEntries: NiksListEditorApp.#onApplyEntries,
            close: function() { return this.close(); }
        }
    };

    /** @override */
    static PARTS = {
        editor: {
            template: "modules/niks-dnd5e-tweaks/templates/settings-list-editor.hbs",
            scrollable: [".nd5t-list-editor-entries"]
        }
    };

    /** @type {string} */
    #settingKey;

    /** @type {string} */
    #settingName;

    /** @type {string} */
    #hint;

    /** @type {string[]} Current entries, always sorted. */
    #entries;

    /** @type {string[]} */
    #defaultEntries;

    /** @type {(value: string) => void} */
    #onApply;

    /** @type {string} Entry to briefly highlight after it was added or matched. */
    #highlight = "";

    /** @override */
    get title() {
        return `Edit List: ${this.#settingName}`;
    }

    /** @override */
    async _prepareContext(options) {
        return { hint: this.#hint };
    }

    /** @override */
    _onRender(context, options) {
        const input = this.#input;
        input?.addEventListener("input", () => this.#renderEntries());
        input?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.#addFromInput();
        });
        this.#renderEntries();
        input?.focus();
    }

    /** @returns {HTMLInputElement|null} */
    get #input() {
        return this.element?.querySelector(".nd5t-list-editor-input") ?? null;
    }

    /**
     * Rebuild the entry rows, filtered by the current input text.
     */
    #renderEntries() {
        const root = this.element;
        if (!root) return;
        const listEl = root.querySelector(".nd5t-list-editor-entries");
        const countEl = root.querySelector(".nd5t-list-editor-count");
        const emptyEl = root.querySelector(".nd5t-list-editor-empty");
        const query = (this.#input?.value ?? "").trim().toLocaleLowerCase();

        // Several comma-separated entries in the input are an "add" in progress, not a filter.
        const filter = query.includes(",") ? "" : query;
        const visible = filter ? this.#entries.filter(e => e.toLocaleLowerCase().includes(filter)) : this.#entries;

        const doc = root.ownerDocument;
        listEl.replaceChildren(...visible.map(entry => {
            const li = doc.createElement("li");
            li.className = "nd5t-list-editor-entry";
            if (entry === this.#highlight) li.classList.add("highlight");

            const name = doc.createElement("span");
            name.className = "nd5t-list-editor-name";
            name.textContent = entry;

            const remove = doc.createElement("button");
            remove.type = "button";
            remove.className = "nd5t-list-editor-remove";
            remove.dataset.action = "removeEntry";
            remove.dataset.entry = entry;
            remove.title = `Remove ${entry}`;
            remove.setAttribute("aria-label", `Remove ${entry}`);
            remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';

            li.append(name, remove);
            return li;
        }));

        const total = this.#entries.length;
        countEl.textContent = filter
            ? `${visible.length} of ${total} ${total === 1 ? "entry" : "entries"}`
            : `${total} ${total === 1 ? "entry" : "entries"}`;

        emptyEl.hidden = visible.length > 0;
        emptyEl.querySelector("p").textContent = total
            ? "No entries match your search. Press Enter to add it."
            : "The list is empty. Type a name above and press Enter to add it.";

        listEl.querySelector(".highlight")?.scrollIntoView({ block: "nearest" });
    }

    /**
     * Add every comma-separated entry from the input field.
     */
    #addFromInput() {
        const input = this.#input;
        const added = parseListValue(input?.value ?? "");
        if (!added.length) return;

        const existing = new Map(this.#entries.map(e => [e.toLocaleLowerCase(), e]));
        let last = "";
        for (const entry of added) {
            const match = existing.get(entry.toLocaleLowerCase());
            if (match) {
                last = match;
                continue;
            }
            this.#entries.push(entry);
            existing.set(entry.toLocaleLowerCase(), entry);
            last = entry;
        }
        this.#entries = parseListValue(this.#entries.join(","));
        this.#highlight = last;
        input.value = "";
        this.#renderEntries();
        input.focus();
    }

    /**
     * @this {NiksListEditorApp}
     */
    static #onAddEntry() {
        this.#addFromInput();
    }

    /**
     * @this {NiksListEditorApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onRemoveEntry(event, target) {
        const entry = target.dataset.entry;
        this.#entries = this.#entries.filter(e => e !== entry);
        if (this.#highlight === entry) this.#highlight = "";
        this.#renderEntries();
    }

    /**
     * @this {NiksListEditorApp}
     */
    static #onResetEntries() {
        this.#entries = [...this.#defaultEntries];
        this.#highlight = "";
        if (this.#input) this.#input.value = "";
        this.#renderEntries();
    }

    /**
     * @this {NiksListEditorApp}
     */
    static #onApplyEntries() {
        this.#onApply?.(this.#entries.join(", "));
        return this.close();
    }
}
