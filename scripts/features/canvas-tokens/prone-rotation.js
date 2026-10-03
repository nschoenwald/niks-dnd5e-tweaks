/**
 * Feature: Auto-Rotate Prone Tokens
 * Description: Automatically rotates tokens 90° clockwise when Prone, Unconscious, or Dead conditions are applied, and restores their rotation when all rotation conditions are removed.
 *
 * @introduced v13.0.1
 */
import { MODULE_ID, debug } from "../../main.js";

export class ProneRotation {
    constructor() {
        this._onCreateActiveEffect = this._onCreateActiveEffect.bind(this);
        this._onUpdateActiveEffect = this._onUpdateActiveEffect.bind(this);
        this._onDeleteActiveEffect = this._onDeleteActiveEffect.bind(this);
        this._onCreateToken = this._onCreateToken.bind(this);
        this._onCanvasReady = () => this.syncScene();
        this._addListeners();
        // Retroactively reconcile the currently viewed scene (e.g. when the setting is toggled on)
        if (canvas?.ready) this.syncScene();
    }

    _addListeners() {
        Hooks.on("createActiveEffect", this._onCreateActiveEffect);
        Hooks.on("updateActiveEffect", this._onUpdateActiveEffect);
        Hooks.on("deleteActiveEffect", this._onDeleteActiveEffect);
        Hooks.on("createToken", this._onCreateToken);
        Hooks.on("canvasReady", this._onCanvasReady);
    }

    /**
     * Newly created tokens (dragged from the sidebar, duplicated, pasted, or placed on another scene)
     * of an actor that is already Prone/Unconscious/Dead should start rotated.
     */
    async _onCreateToken(tokenDoc, options, userId) {
        try {
            if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
            const actor = tokenDoc.actor;
            if (!actor) return;
            const hasRotation = actor.effects?.some(e => this._isRotationEffect(e) && e.active);
            if (hasRotation) await this._handleRotation(actor, true, userId, tokenDoc);
        } catch (err) {
            console.error(`${MODULE_ID} | ProneRotation createToken failed`, err);
        }
    }

    /**
     * Reconcile token rotation with actor state for every token on the viewed scene.
     * Catches changes made while the module/setting was off, no GM was online, or the scene
     * was not viewed. Idempotent: only acts when effect state and module-managed rotation
     * disagree, so manual rotations and legacy untouched tokens are left alone.
     * Runs on the primary GM only.
     */
    async syncScene() {
        try {
            if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
            if (!canvas?.ready || !canvas.scene) return;
            if (!(game.users.activeGM?.isSelf ?? game.user.isGM)) return;

            for (const doc of canvas.scene.tokens) {
                const actor = doc.actor;
                if (!actor) continue;
                const shouldRotate = actor.effects?.some(e => this._isRotationEffect(e) && e.active) ?? false;
                if (shouldRotate) {
                    if (doc.rotation !== 90 || doc.lockRotation) {
                        await this._handleRotation(actor, true, game.user.id, doc);
                    }
                } else {
                    const managed = Number.isFinite(doc.getFlag(MODULE_ID, "proneOriginalRotation"))
                        || doc.getFlag(MODULE_ID, "proneLockRotation");
                    if (managed) await this._handleRotation(actor, false, game.user.id, doc);
                }
            }
        } catch (err) {
            console.error(`${MODULE_ID} | ProneRotation syncScene failed`, err);
        }
    }

    destroy() {
        Hooks.off("canvasReady", this._onCanvasReady);
        Hooks.off("createToken", this._onCreateToken);
        Hooks.off("createActiveEffect", this._onCreateActiveEffect);
        Hooks.off("updateActiveEffect", this._onUpdateActiveEffect);
        Hooks.off("deleteActiveEffect", this._onDeleteActiveEffect);
    }

    async _onCreateActiveEffect(effect, options, userId) {
        try {
            if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
            // In dnd5e 6.0, conditions are never toggled via `disabled`. Instead, condition effects
            // can be suppressed (active=false, disabled=false) when the actor has condition immunity.
            // Checking `effect.active` correctly skips both disabled and suppressed effects.
            if (!this._isRotationEffect(effect) || !effect.active) return;
            const actor = this._resolveActor(effect);
            const tokenDoc = this._resolveTokenDoc(effect);
            if (actor || tokenDoc) await this._handleRotation(actor, true, userId, tokenDoc);
        } catch (err) {
            console.error(`${MODULE_ID} | ProneRotation createActiveEffect failed`, err);
        }
    }

    async _onUpdateActiveEffect(effect, changes, options, userId) {
        try {
            if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;

            // Re-evaluate when statuses/condition type changed (including a change AWAY from a
            // rotation status, so the token stands back up) or when the effect was enabled/disabled.
            const identityChanged = changes.statuses !== undefined || changes.system?.type !== undefined;
            const toggled = changes.disabled !== undefined;
            if (!identityChanged && !toggled) return;

            const isRotationEffect = this._isRotationEffect(effect);
            // A pure enable/disable toggle on an unrelated effect is irrelevant.
            if (!isRotationEffect && !identityChanged) return;

            const actor = this._resolveActor(effect);
            const tokenDoc = this._resolveTokenDoc(effect);
            if (!actor && !tokenDoc) return;

            const isRotationNow = isRotationEffect && effect.active;
            await this._handleRotation(actor, isRotationNow, userId, tokenDoc);
        } catch (err) {
            console.error(`${MODULE_ID} | ProneRotation updateActiveEffect failed`, err);
        }
    }

    async _onDeleteActiveEffect(effect, options, userId) {
        try {
            if (!game.settings.get(MODULE_ID, "enableProneRotation")) return;
            if (!this._isRotationEffect(effect)) return;
            // Only un-rotate if the effect was actually active. Suppressed condition effects
            // (e.g. immune actor has a condition applied externally) should not control rotation,
            // since they never caused a rotation in the first place.
            if (!effect.active) return;
            const actor = this._resolveActor(effect);
            const tokenDoc = this._resolveTokenDoc(effect);
            if (actor || tokenDoc) await this._handleRotation(actor, false, userId, tokenDoc, effect.id);
        } catch (err) {
            console.error(`${MODULE_ID} | ProneRotation deleteActiveEffect failed`, err);
        }
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
        } else if (actor) {
            // Base-actor effects also apply to unlinked tokens (ActorDelta inherits them from the
            // base actor), so every dependent token on every scene is a candidate.
            tokenDocs = actor.getDependentTokens({ scenes: game.scenes.contents, concreteOnly: true });
        }

        if (!tokenDocs.length) return;
        debug(`_handleRotation: actor=${actor?.name ?? tokenDocs[0]?.name}, isProne=${isProne}, tokens found=${tokenDocs.length}`);

        const isPrimaryGM = game.users.activeGM?.isSelf ?? game.user.isGM;
        const isTriggeringUser = (userId === game.user.id);
        const triggeringUser = userId ? game.users.get(userId) : null;

        // Group updates by scene
        const sceneUpdates = new Map();

        for (const doc of tokenDocs) {
            if (!doc) continue;

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

            const originalRotation = doc.getFlag(MODULE_ID, "proneOriginalRotation");
            const hasOriginal = Number.isFinite(originalRotation);
            const hadProneLock = !isProne && Boolean(doc.getFlag(MODULE_ID, "proneLockRotation"));

            // Prone: rotate to 90°. Standing: restore the remembered facing; for legacy/unflagged
            // tokens only reset a 90° tilt to 0° (never clobber a manually chosen facing).
            let targetRotation;
            if (isProne) targetRotation = 90;
            else if (hasOriginal) targetRotation = originalRotation;
            else targetRotation = doc.rotation === 90 ? 0 : doc.rotation;

            const needsRotation = doc.rotation !== targetRotation;
            const needsUnlock = isProne && doc.lockRotation;
            const needsRelock = hadProneLock && !doc.lockRotation;
            const needsClearOriginal = !isProne && hasOriginal;

            // Only skip if nothing needs updating
            if (!needsRotation && !needsUnlock && !needsRelock && !needsClearOriginal) continue;

            if (!isProne) {
                // Don't un-rotate if the actor still has another rotation-triggering active effect.
                // Note: during deleteActiveEffect, actor.statuses might not have been re-prepared yet,
                // so we check remaining effects excluding the one being deleted.
                const checkActor = doc.actor ?? actor;
                const hasOtherActiveRotationEffect = checkActor?.effects?.some(
                    e => e.id !== deletedEffectId && this._isRotationEffect(e) && e.active
                );
                if (hasOtherActiveRotationEffect) continue;
            }

            debug(`  ${doc.name} (${doc.id}): ${doc.rotation}° → ${targetRotation}° (lockRotation: ${doc.lockRotation})`);
            const update = { _id: doc.id, rotation: targetRotation };
            if (isProne && !hasOriginal && doc.rotation !== 90) {
                // Remember the pre-prone facing (only once, so stacked rotation effects don't overwrite it)
                update[`flags.${MODULE_ID}.proneOriginalRotation`] = doc.rotation;
            } else if (!isProne && hasOriginal) {
                update[`flags.${MODULE_ID}.proneOriginalRotation`] = null;
            }
            if (isProne && doc.lockRotation) {
                update.lockRotation = false;
                update[`flags.${MODULE_ID}.proneLockRotation`] = true;
            } else if (!isProne && hadProneLock) {
                update.lockRotation = true;
                update[`flags.${MODULE_ID}.proneLockRotation`] = null;
            }

            if (!sceneUpdates.has(scene)) sceneUpdates.set(scene, []);
            sceneUpdates.get(scene).push(update);
        }

        for (const [scene, updates] of sceneUpdates) {
            if (updates.length) {
                debug(`  Batch updating ${updates.length} token(s) on scene "${scene.name}"`);
                try {
                    await scene.updateEmbeddedDocuments("Token", updates);
                } catch (err) {
                    console.error(`${MODULE_ID} | ProneRotation batch update failed`, err);
                }
            }
        }
    }

    /**
     * Check whether the effect is one that should trigger rotation.
     * Matches prone, unconscious, and dead statuses.
     *
     * In dnd5e 6.0+, condition ActiveEffects store their canonical status ID in
     * `effect.system.type` (via ConditionData). We check that first, then fall
     * back to the core Foundry `effect.statuses` Set for any non-condition effects
     * that may carry one of these status IDs.
     */
    _isRotationEffect(effect) {
        if (!effect) return false;
        const type = effect.system?.type;
        if (type === "prone" || type === "unconscious" || type === "dead") return true;
        const statuses = effect.statuses;
        return !!statuses && (statuses.has("prone") || statuses.has("unconscious") || statuses.has("dead"));
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
