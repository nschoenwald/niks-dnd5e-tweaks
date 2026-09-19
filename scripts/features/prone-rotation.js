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
        // In dnd5e 6.0, conditions are never toggled via `disabled`. Instead, condition effects
        // can be suppressed (active=false, disabled=false) when the actor has condition immunity.
        // Checking `effect.active` correctly skips both disabled and suppressed effects.
        if (!this._isRotationEffect(effect) || !effect.active) return;
        const actor = this._resolveActor(effect);
        const tokenDoc = this._resolveTokenDoc(effect);
        if (actor || tokenDoc) this._handleRotation(actor, true, userId, tokenDoc);
    }

    async _onUpdateActiveEffect(effect, changes, options, userId) {
        if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
        if (!this._isRotationEffect(effect)) return;

        const actor = this._resolveActor(effect);
        const tokenDoc = this._resolveTokenDoc(effect);
        if (!actor && !tokenDoc) return;

        // If disabled was modified (e.g. toggled on sheet, via macro, or by automation module)
        if (changes.disabled !== undefined) {
            const shouldRotate = !changes.disabled && effect.active;
            this._handleRotation(actor, shouldRotate, userId, tokenDoc);
            return;
        }

        // If statuses or condition type were modified on an existing effect
        if (changes.statuses !== undefined || changes.system?.type !== undefined) {
            const isRotationNow = this._isRotationEffect(effect) && effect.active;
            this._handleRotation(actor, isRotationNow, userId, tokenDoc);
        }
    }

    async _onDeleteActiveEffect(effect, options, userId) {
        if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
        if (!this._isRotationEffect(effect)) return;
        // Only un-rotate if the effect was actually active. Suppressed condition effects
        // (e.g. immune actor has a condition applied externally) should not control rotation,
        // since they never caused a rotation in the first place.
        if (!effect.active) return;
        const actor = this._resolveActor(effect);
        const tokenDoc = this._resolveTokenDoc(effect);
        if (actor || tokenDoc) this._handleRotation(actor, false, userId, tokenDoc, effect.id);
    }

    /**
     * Resolve the target Actor from an ActiveEffect, supporting effects on Items,
     * base Actors, and unlinked Tokens (ActorDelta).
     * @param {ActiveEffect} effect
     * @returns {Actor|null}
     */
    _resolveActor(effect) {
        if (!effect?.parent) return null;
        if (effect.parent instanceof Actor) return effect.parent;
        if (effect.parent instanceof Item) return effect.parent.actor ?? null;
        // Unlinked tokens store active effects in ActorDelta (token.delta.effects)
        if (effect.parent.documentName === "ActorDelta") {
            return effect.parent.syntheticActor ?? effect.parent.parent?.actor ?? null;
        }
        // Fallback to core effect accessors
        if (effect.target instanceof Actor) return effect.target;
        if (effect.actor instanceof Actor) return effect.actor;
        return null;
    }

    /**
     * Directly resolve the TokenDocument if the effect belongs to an unlinked token's ActorDelta.
     * @param {ActiveEffect} effect
     * @returns {TokenDocument|null}
     */
    _resolveTokenDoc(effect) {
        if (!effect) return null;
        // For unlinked token actor deltas, the delta's parent is the TokenDocument
        if (effect.parent?.documentName === "ActorDelta" && effect.parent.parent) {
            return effect.parent.parent;
        }
        const actor = this._resolveActor(effect);
        if (actor?.isToken && actor.token) return actor.token;
        return null;
    }

    async _handleRotation(actor, isProne, userId, explicitTokenDoc = null, deletedEffectId = null) {
        if (!actor && !explicitTokenDoc) return;

        // Resolve target token documents
        let tokenDocs = [];
        if (explicitTokenDoc) {
            tokenDocs = [explicitTokenDoc];
        } else if (actor?.isToken && actor.token) {
            tokenDocs = [actor.token];
        } else if (actor && typeof actor.getActiveTokens === "function") {
            tokenDocs = actor.getActiveTokens(true, true);
            if (!tokenDocs.length) {
                const tokenPlaceables = actor.getActiveTokens(false, false);
                if (tokenPlaceables.length) {
                    tokenDocs = tokenPlaceables.map(t => t.document).filter(Boolean);
                } else if (canvas?.scene) {
                    tokenDocs = canvas.scene.tokens.filter(t => t.actorId === actor.id && (t.actorLink || t.isLinked));
                }
            }
        }

        if (!tokenDocs.length) return;
        debug(`_handleRotation: actor=${actor?.name ?? tokenDocs[0]?.name}, isProne=${isProne}, tokens found=${tokenDocs.length}`);

        const isPrimaryGM = (game.users.primaryGM ?? game.users.activeGM)?.isSelf ?? game.user.isGM;
        const isTriggeringUser = (userId === game.user.id);
        const triggeringUser = userId ? game.users.get(userId) : null;

        // Group updates by scene
        const sceneUpdates = new Map();

        for (const doc of tokenDocs) {
            if (!doc || doc._destroyed) continue;

            const scene = doc.parent ?? canvas?.scene;
            if (!scene || !scene.tokens.has(doc.id)) continue;

            // Multiplayer permission handling:
            // If the triggering user has update permissions on this token, they execute the update.
            // If the triggering user lacks permissions (e.g. player applying prone to NPC), the primary GM handles it.
            const userCanModify = doc.canUserModify(game.user, "update");
            if (isTriggeringUser) {
                if (!userCanModify) continue;
            } else {
                if (!isPrimaryGM) continue;
                if (triggeringUser && doc.canUserModify(triggeringUser, "update")) continue;
            }

            const targetRotation = isProne ? 90 : 0;
            if (doc.rotation === targetRotation) continue;

            if (!isProne && actor) {
                // Don't un-rotate if the actor still has another rotation-triggering active effect.
                // Note: during deleteActiveEffect, actor.statuses might not have been re-prepared yet,
                // so we check remaining effects excluding the one being deleted.
                const hasOtherActiveRotationEffect = actor.effects?.some(
                    e => e.id !== deletedEffectId && this._isRotationEffect(e) && e.active
                );
                if (hasOtherActiveRotationEffect) continue;
            }

            debug(`  ${doc.name} (${doc.id}): ${doc.rotation}° → ${targetRotation}°`);
            const update = { _id: doc.id, rotation: targetRotation };
            if (isProne && doc.lockRotation) {
                update.lockRotation = false;
            }

            if (!sceneUpdates.has(scene)) sceneUpdates.set(scene, []);
            sceneUpdates.get(scene).push(update);
        }

        for (const [scene, updates] of sceneUpdates) {
            if (updates.length) {
                debug(`  Batch updating ${updates.length} token(s) on scene "${scene.name}"`);
                await scene.updateEmbeddedDocuments("Token", updates);
            }
        }
    }

    /**
     * Check whether the effect is one that should trigger rotation.
     * Matches prone, unconscious, and dead statuses.
     *
     * In dnd5e 6.0+, condition ActiveEffects store their canonical status ID in
     * `effect.system.type` (via ConditionData). We check that first, then fall
     * back to the core Foundry `effect.statuses` Set/Array for any non-condition effects
     * that may carry one of these status IDs.
     */
    _isRotationEffect(effect) {
        if (!effect) return false;
        const type = effect.system?.type;
        if (type === "prone" || type === "unconscious" || type === "dead") return true;
        const statuses = effect.statuses;
        if (statuses instanceof Set) {
            return statuses.has("prone") || statuses.has("unconscious") || statuses.has("dead");
        }
        if (Array.isArray(statuses)) {
            return statuses.includes("prone") || statuses.includes("unconscious") || statuses.includes("dead");
        }
        return false;
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
