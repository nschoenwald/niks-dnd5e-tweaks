import { debug } from "../main.js";

export class ProneRotation {
    constructor() {
        this._onCreateActiveEffect = this._onCreateActiveEffect.bind(this);
        this._onUpdateActiveEffect = this._onUpdateActiveEffect.bind(this);
        this._onDeleteActiveEffect = this._onDeleteActiveEffect.bind(this);
        this._addListeners();
    }

    _addListeners() {
        Hooks.on("createActiveEffect", this._onCreateActiveEffect);
        Hooks.on("updateActiveEffect", this._onUpdateActiveEffect);
        Hooks.on("deleteActiveEffect", this._onDeleteActiveEffect);
    }

    destroy() {
        Hooks.off("createActiveEffect", this._onCreateActiveEffect);
        Hooks.off("updateActiveEffect", this._onUpdateActiveEffect);
        Hooks.off("deleteActiveEffect", this._onDeleteActiveEffect);
    }

    async _onCreateActiveEffect(effect, options, userId) {
        if (!game.settings.get("niks-dnd5e-tweaks", "enableProneRotation")) return;
        if (userId !== game.user.id) return; 
        if (!this._isProneEffect(effect) || effect.disabled) return;
        this._handleRotation(effect.parent, true);
    }

    async _onUpdateActiveEffect(effect, changes, options, userId) {
        if (!game.settings.get("niks-dnd5e-tweaks", "enableProneRotation")) return;
        if (userId !== game.user.id) return;
        if (!this._isProneEffect(effect)) return;
        if (changes.disabled !== undefined) {
             this._handleRotation(effect.parent, !changes.disabled);
        }
    }

    async _onDeleteActiveEffect(effect, options, userId) {
        if (!game.settings.get("niks-dnd5e-tweaks", "enableProneRotation")) return;
        if (userId !== game.user.id) return;
        if (!this._isProneEffect(effect)) return;
        this._handleRotation(effect.parent, false);
    }

    async _handleRotation(actor, isProne) {
        if (!actor) return;
        const tokens = actor.getActiveTokens();

        for (const token of tokens) {
            if (!token.document.canUserModify(game.user, "update")) continue;

            if (isProne) {
                // Store original rotation
                const currentRotation = token.document.rotation;
                if (typeof token.document.getFlag("niks-dnd5e-tweaks", "originalRotation") === "undefined") {
                    await token.document.setFlag("niks-dnd5e-tweaks", "originalRotation", currentRotation);
                }
                
                // Rotate to 90
                if (token.document.rotation !== 90) {
                    debug(`Rotating token ${token.name} (${token.id}) to 90 degrees (Prone)`);
                    await token.document.update({ rotation: 90 });
                }
            } else {
                const originalRotation = token.document.getFlag("niks-dnd5e-tweaks", "originalRotation");
                if (typeof originalRotation === "undefined") continue;

                await token.document.update({ rotation: originalRotation });
                await token.document.unsetFlag("niks-dnd5e-tweaks", "originalRotation");
            }
        }
    }

    _isProneEffect(effect) {
        return effect.statuses && effect.statuses.has("prone");
    }
}

let proneRotation = null;

export function enableProneRotation() {
    if (!proneRotation && game.settings.get("niks-dnd5e-tweaks", "enableProneRotation")) {
        proneRotation = new ProneRotation();
    }
}

export function disableProneRotation() {
    if (proneRotation) {
        proneRotation.destroy();
        proneRotation = null;
    }
}
