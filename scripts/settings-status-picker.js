/**
 * Pop-out picker for the statuses shown in the Token HUD's status palette (Token HUD Condition Palette).
 * Opened from the Settings Dashboard like the list editor: Apply writes the hidden status IDs back into the
 * dashboard's hidden input, and Save Changes there stores them.
 *
 * @introduced v14.63.0
 */
import { parseListValue } from "./settings-list-editor.js";
import { isSystemCondition } from "./features/canvas-tokens/condition-hud.js";

/**
 * ApplicationV2 window that toggles statuses between shown and hidden.
 */
export class NiksStatusPickerApp extends foundry.applications.api.HandlebarsApplicationMixin(
    foundry.applications.api.ApplicationV2
) {
    /**
     * @param {object} options
     * @param {string} options.settingKey            Setting key being edited.
     * @param {string} options.settingName           Display name for the window title.
     * @param {string} [options.hint]                Hint shown above the list.
     * @param {string} options.value                 Current comma-separated hidden status IDs.
     * @param {string} [options.defaultValue]        Default hidden status IDs for "Reset to Default".
     * @param {(value: string) => void} options.onApply  Receives the comma-separated hidden IDs on Apply.
     */
    constructor(options = {}) {
        super({ ...options, id: `nd5t-status-picker-${options.settingKey}` });
        this.#settingName = options.settingName;
        this.#hint = options.hint ?? "";
        this.#hidden = new Set(parseListValue(options.value ?? ""));
        this.#defaultHidden = parseListValue(options.defaultValue ?? "");
        this.#onApply = options.onApply;
    }

    /** @override */
    static DEFAULT_OPTIONS = {
        classes: ["nd5t-settings-app", "nd5t-list-editor", "nd5t-status-picker"],
        tag: "div",
        window: {
            icon: "fa-solid fa-eye-slash",
            resizable: true
        },
        position: {
            width: 460,
            height: 600
        },
        actions: {
            toggleStatus: NiksStatusPickerApp.#onToggleStatus,
            showAll: NiksStatusPickerApp.#onShowAll,
            resetStatuses: NiksStatusPickerApp.#onResetStatuses,
            applyStatuses: NiksStatusPickerApp.#onApplyStatuses,
            close: function() { return this.close(); }
        }
    };

    /** @override */
    static PARTS = {
        picker: {
            template: "modules/niks-dnd5e-tweaks/templates/settings-status-picker.hbs",
            scrollable: [".nd5t-status-picker-groups"]
        }
    };

    /** @type {string} */
    #settingName;

    /** @type {string} */
    #hint;

    /** @type {Set<string>} Hidden status IDs, including ones no longer configured (kept as they were). */
    #hidden;

    /** @type {string[]} */
    #defaultHidden;

    /** @type {(value: string) => void} */
    #onApply;

    /** @override */
    get title() {
        return `Choose Statuses: ${this.#settingName}`;
    }

    /**
     * Statuses that can appear in the Token HUD, in the HUD's own order (order, then name).
     * @returns {{id: string, name: string, img: string, condition: boolean}[]}
     */
    static getStatuses() {
        const statuses = [];
        for (const status of foundry.utils.iterateValues(CONFIG.statusEffects)) {
            if (!status?.id || (status.hud === false)) continue;
            statuses.push({
                id: status.id,
                name: game.i18n.localize(status.name ?? status.id),
                img: status.img,
                order: status.order ?? 0,
                condition: isSystemCondition(status.id)
            });
        }
        return statuses.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, game.i18n.lang));
    }

    /** @override */
    async _prepareContext(options) {
        return { hint: this.#hint };
    }

    /** @override */
    _onRender(context, options) {
        const input = this.element.querySelector(".nd5t-list-editor-input");
        input?.addEventListener("input", () => this.#renderStatuses());
        this.#renderStatuses();
        input?.focus();
    }

    /**
     * Rebuild the status rows, filtered by the search text.
     */
    #renderStatuses() {
        const root = this.element;
        if (!root) return;
        const doc = root.ownerDocument;
        const query = (root.querySelector(".nd5t-list-editor-input")?.value ?? "").trim().toLocaleLowerCase();
        const statuses = NiksStatusPickerApp.getStatuses();
        const visible = query ? statuses.filter(s => s.name.toLocaleLowerCase().includes(query)) : statuses;

        const buildRow = (status) => {
            const hidden = this.#hidden.has(status.id);
            const row = doc.createElement("button");
            row.type = "button";
            row.className = "nd5t-status-pick";
            row.classList.toggle("hidden-status", hidden);
            row.dataset.action = "toggleStatus";
            row.dataset.statusId = status.id;
            row.setAttribute("aria-pressed", hidden ? "false" : "true");
            row.title = hidden ? `Hidden. Click to show ${status.name} in the Token HUD.` : `Shown. Click to hide ${status.name} from the Token HUD.`;

            const img = doc.createElement("img");
            img.src = status.img;
            img.alt = "";
            const name = doc.createElement("span");
            name.className = "nd5t-list-editor-name";
            name.textContent = status.name;
            const eye = doc.createElement("i");
            eye.className = `fa-solid ${hidden ? "fa-eye-slash" : "fa-eye"} nd5t-status-pick-eye`;
            eye.setAttribute("inert", "");
            row.append(img, name, eye);
            return row;
        };

        const buildGroup = (title, list) => {
            const group = doc.createElement("section");
            group.className = "nd5t-status-picker-group";
            const heading = doc.createElement("h4");
            heading.textContent = title;
            const grid = doc.createElement("div");
            grid.className = "nd5t-status-picker-grid";
            grid.append(...list.map(buildRow));
            group.append(heading, grid);
            return group;
        };

        const conditions = visible.filter(s => s.condition);
        const others = visible.filter(s => !s.condition);
        const groups = [];
        if (conditions.length) groups.push(buildGroup(game.i18n.localize("DND5E.Conditions"), conditions));
        if (others.length) groups.push(buildGroup("Other Effects", others));
        root.querySelector(".nd5t-status-picker-groups").replaceChildren(...groups);

        const hiddenCount = statuses.filter(s => this.#hidden.has(s.id)).length;
        root.querySelector(".nd5t-list-editor-count").textContent =
            `${statuses.length - hiddenCount} shown, ${hiddenCount} hidden`;
        const empty = root.querySelector(".nd5t-list-editor-empty");
        empty.hidden = visible.length > 0;
    }

    /**
     * @this {NiksStatusPickerApp}
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static #onToggleStatus(event, target) {
        const id = target.dataset.statusId;
        if (!id) return;
        if (this.#hidden.has(id)) this.#hidden.delete(id);
        else this.#hidden.add(id);
        this.#renderStatuses();
    }

    /** @this {NiksStatusPickerApp} */
    static #onShowAll() {
        this.#hidden.clear();
        this.#renderStatuses();
    }

    /** @this {NiksStatusPickerApp} */
    static #onResetStatuses() {
        this.#hidden = new Set(this.#defaultHidden);
        this.#renderStatuses();
    }

    /** @this {NiksStatusPickerApp} */
    static #onApplyStatuses() {
        this.#onApply?.(parseListValue(Array.from(this.#hidden).join(", ")).join(", "));
        this.close();
    }
}
