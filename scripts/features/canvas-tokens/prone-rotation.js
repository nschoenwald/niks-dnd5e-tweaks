/**
 * Feature: Auto-Rotate Prone Tokens
 * Description: Automatically rotates tokens 90° clockwise when Prone or Unconscious (90° counter-clockwise when Dead), and restores their rotation when all rotation conditions are removed.
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
                const wanted = this._getRotationAngle(actor);
                if (wanted !== null) {
                    if (doc.rotation !== wanted || doc.lockRotation) {
                        await this._handleRotation(actor, true, game.user.id, doc);
                    }
                } else {
                    const managed = doc.rotation === 90 || doc.rotation === 270
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

            // Resolve the angle from the token's own remaining effects. Dead tilts left (270°),
            // every other rotation effect tilts right (90°). When standing up was requested but
            // another rotation effect remains (e.g. dead removed, prone left), switch to that angle.
            // During deleteActiveEffect the deleted effect may still be listed, so it is excluded.
            const checkActor = doc.actor ?? actor;
            const wanted = this._getRotationAngle(checkActor, isProne ? null : deletedEffectId);
            const rotated = isProne || wanted !== null;
            const targetRotation = rotated ? (wanted ?? 90) : 0;

            const hadProneLock = !rotated && Boolean(doc.getFlag(MODULE_ID, "proneLockRotation"));
            const needsRotation = doc.rotation !== targetRotation;
            const needsUnlock = rotated && doc.lockRotation;
            const needsRelock = hadProneLock && !doc.lockRotation;

            // Only skip if nothing needs updating
            if (!needsRotation && !needsUnlock && !needsRelock) continue;

            debug(`  ${doc.name} (${doc.id}): ${doc.rotation}° → ${targetRotation}° (lockRotation: ${doc.lockRotation})`);
            const update = { _id: doc.id, rotation: targetRotation };
            if (rotated && doc.lockRotation) {
                update.lockRotation = false;
                update[`flags.${MODULE_ID}.proneLockRotation`] = true;
            } else if (!rotated && hadProneLock) {
                update.lockRotation = true;
                update[`flags.${MODULE_ID}.proneLockRotation`] = null;
            }

            if (!sceneUpdates.has(scene)) sceneUpdates.set(scene, []);
            sceneUpdates.get(scene).push(update);
        }

        const applyUpdates = async (scene, updates) => {
            debug(`  Batch updating ${updates.length} token(s) on scene "${scene.name}"`);
            try {
                await scene.updateEmbeddedDocuments("Token", updates);
            } catch (err) {
                console.error(`${MODULE_ID} | ProneRotation batch update failed`, err);
            }
        };

        // The viewed scene is updated first so the visible tokens react immediately;
        // all other scenes are then updated in parallel rather than one after another.
        const currentUpdates = sceneUpdates.get(canvas?.scene);
        if (currentUpdates?.length) await applyUpdates(canvas.scene, currentUpdates);
        sceneUpdates.delete(canvas?.scene);
        await Promise.all(
            Array.from(sceneUpdates, ([scene, updates]) => updates.length ? applyUpdates(scene, updates) : null)
        );
    }

    /**
     * Determine the rotation angle an actor's active effects call for.
     * Dead tilts left (270°) and takes priority; prone/unconscious tilt right (90°).
     * @param {Actor|null} actor
     * @param {string|null} [excludeEffectId]  An effect id to ignore (the one being deleted).
     * @returns {270|90|null}  null when no rotation effect is active.
     */
    _getRotationAngle(actor, excludeEffectId = null) {
        let angle = null;
        for (const e of actor?.effects ?? []) {
            if (e.id === excludeEffectId || !e.active || !this._isRotationEffect(e)) continue;
            if (this._isDeadEffect(e)) return 270;
            angle = 90;
        }
        return angle;
    }

    _isDeadEffect(effect) {
        return effect?.system?.type === "dead" || !!effect?.statuses?.has("dead");
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
