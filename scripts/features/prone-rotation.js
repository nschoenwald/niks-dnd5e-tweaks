import { MODULE_ID, debug } from "../main.js";

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
        if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
        if (userId !== game.user.id) return; 
        if (!this._isRotationEffect(effect) || effect.disabled) return;
        this._handleRotation(effect.parent, true);
    }

    async _onUpdateActiveEffect(effect, changes, options, userId) {
        if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
        if (userId !== game.user.id) return;
        if (!this._isRotationEffect(effect)) return;
        if (changes.disabled !== undefined) {
             this._handleRotation(effect.parent, !changes.disabled);
        }
    }

    async _onDeleteActiveEffect(effect, options, userId) {
        if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
        if (userId !== game.user.id) return;
        if (!this._isRotationEffect(effect)) return;
        this._handleRotation(effect.parent, false);
    }

    async _handleRotation(actor, isProne) {
        if (!actor) return;
        const tokens = actor.getActiveTokens();
        debug(`_handleRotation: actor=${actor.name}, isProne=${isProne}, tokens found=${tokens.length}`);

        const updates = [];
        for (const token of tokens) {
            if (!token.document.canUserModify(game.user, "update")) continue;

            const targetRotation = isProne ? 90 : 0;
            if (token.document.rotation === targetRotation) continue;

            if (!isProne) {
                // Don't un-rotate if the actor still has another rotation-triggering status
                if (actor.statuses.has("prone") || actor.statuses.has("unconscious") || actor.statuses.has("dead")) continue;
            }

            debug(`  ${token.name} (${token.id}): ${token.document.rotation}° → ${targetRotation}°`);
            const update = { _id: token.document.id, rotation: targetRotation };
            if (isProne && token.document.lockRotation) {
                update.lockRotation = false;
            }
            updates.push(update);
        }

        if (updates.length) {
            debug(`  Batch updating ${updates.length} token(s)`);
            await canvas.scene.updateEmbeddedDocuments("Token", updates);
        }
    }

    /**
     * Check whether the effect is one that should trigger rotation.
     * Matches prone, unconscious, and dead statuses.
     */
    _isRotationEffect(effect) {
        if (!effect.statuses) return false;
        return effect.statuses.has("prone") || effect.statuses.has("unconscious") || effect.statuses.has("dead");
    }
}

let proneRotation = null;

export function enableProneRotation() {
    if (!proneRotation && game.settings.get(MODULE_ID, "enableProneRotation")) {
        proneRotation = new ProneRotation();
    }
}

export function disableProneRotation() {
    if (proneRotation) {
        proneRotation.destroy();
        proneRotation = null;
    }
}
