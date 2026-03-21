import { debug } from "../main.js";

export class CursorHints {
    constructor() {
        this.element = this._createCursorElement();
        this.modifiers = {
            hintSkip: { active: false, icon: "fa-solid fa-forward", label: "Skip", color: "#6cadea" },
            hintAdvantage: { active: false, icon: "fa-solid fa-angle-double-up", label: "Advantage", color: "#3da83d" },
            hintDisadvantage: { active: false, icon: "fa-solid fa-angle-double-down", label: "Disadvantage", color: "#d93131" },
        };

        this._addListeners();
    }

    _addListeners() {
        this._onMouseMove = (e) => this._onMouseMoveHandler(e);
        this._onBlur = () => this._clearKeys();

        window.addEventListener("mousemove", this._onMouseMove, { passive: true });
        window.addEventListener("blur", this._onBlur);
    }

    destroy() {
        window.removeEventListener("mousemove", this._onMouseMove);
        window.removeEventListener("blur", this._onBlur);
        if (this.element) this.element.remove();
    }

    setModifierState(action, active) {
        if (this.modifiers[action]) {
            debug(`Setting modifier state for ${action} to ${active}`);
            this.modifiers[action].active = active;
            this._updateVisuals();
        }
    }

    _createCursorElement() {
        const el = document.createElement("div");
        el.id = "nd5t-cursor-hint";
        document.body.appendChild(el);
        return el;
    }

    _clearKeys() {
        for (const key in this.modifiers) {
            this.modifiers[key].active = false;
        }
        this._updateVisuals();
    }

    _onMouseMoveHandler(event) {
        if (!this.element) return;

        // Offset slightly from cursor to not block visibility
        const offsetX = 16;
        const offsetY = 16;

        this.element.style.transform = `translate(${event.clientX + offsetX}px, ${event.clientY + offsetY}px)`;
    }

    _updateVisuals() {
        const activeHints = [];

        // Iterate over object values
        for (const hint of Object.values(this.modifiers)) {
            if (hint.active) activeHints.push(hint);
        }

        // Render
        this.element.innerHTML = "";
        if (activeHints.length === 0) {
            this.element.style.opacity = "0";
            return;
        }

        activeHints.forEach(hint => {
            const icon = document.createElement("i");
            icon.className = hint.icon;
            icon.style.color = hint.color;
            // Optional: Add drop shadow or visual flair
            this.element.appendChild(icon);
        });

        this.element.style.opacity = "1";
    }
}

const DND5E_ACTIONS = {
    SKIP: "skipDialogNormal",          // Was "skipDialog"
    ADVANTAGE: "skipDialogAdvantage",    // Was "advantage"
    DISADVANTAGE: "skipDialogDisadvantage" // Was "disadvantage"
};

let cursorHints = null;
let onKeyDownBound = null;
let onKeyUpBound = null;

export function enableCursorHints() {
    if (!cursorHints && game.settings.get("niks-dnd5e-tweaks", "enableCursorHints")) {
        cursorHints = new CursorHints();
        _addKeyListeners();
    }
}

export function disableCursorHints() {
    if (cursorHints) {
        cursorHints.destroy();
        cursorHints = null;
        _removeKeyListeners();
    }
}

function _addKeyListeners() {
    onKeyDownBound = _handleKeyDown.bind(this);
    onKeyUpBound = _handleKeyUp.bind(this);

    window.addEventListener("keydown", onKeyDownBound);
    window.addEventListener("keyup", onKeyUpBound);
}

function _removeKeyListeners() {
    if (onKeyDownBound) window.removeEventListener("keydown", onKeyDownBound);
    if (onKeyUpBound) window.removeEventListener("keyup", onKeyUpBound);
}

function _handleKeyDown(event) {
    if (!cursorHints || !game.settings.get("niks-dnd5e-tweaks", "enableCursorHints")) return;
    // Don't trigger if user is typing in a text box
    if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable) return;

    if (_matchesAction(DND5E_ACTIONS.SKIP, event)) cursorHints.setModifierState("hintSkip", true);
    if (_matchesAction(DND5E_ACTIONS.ADVANTAGE, event)) cursorHints.setModifierState("hintAdvantage", true);
    if (_matchesAction(DND5E_ACTIONS.DISADVANTAGE, event)) cursorHints.setModifierState("hintDisadvantage", true);
}

function _handleKeyUp(event) {
    if (!cursorHints || !game.settings.get("niks-dnd5e-tweaks", "enableCursorHints")) return;
    
    if (_matchesAction(DND5E_ACTIONS.SKIP, event)) cursorHints.setModifierState("hintSkip", false);
    if (_matchesAction(DND5E_ACTIONS.ADVANTAGE, event)) cursorHints.setModifierState("hintAdvantage", false);
    if (_matchesAction(DND5E_ACTIONS.DISADVANTAGE, event)) cursorHints.setModifierState("hintDisadvantage", false);
}

function _matchesAction(actionId, event) {
    let bindings;

    try {
        bindings = game.keybindings.get("dnd5e", actionId);
    } catch (e) {
        return false;
    }
    
    if (!bindings || bindings.length === 0) return false;

    return bindings.some(binding => {
        if (binding.key !== event.code) return false;
        if (binding.modifiers && binding.modifiers.length > 0) {
            const modifiersMatch = binding.modifiers.every(mod => {
                if (mod === "Control") return event.ctrlKey;
                if (mod === "Shift") return event.shiftKey;
                if (mod === "Alt") return event.altKey;
                if (mod === "Meta") return event.metaKey;
                return false;
            });
            if (!modifiersMatch) return false;
        }

        return true;
    });
}
