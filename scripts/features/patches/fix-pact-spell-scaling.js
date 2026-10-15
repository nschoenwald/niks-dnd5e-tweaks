/**
 * Feature: Fix Pact Magic Formula Scaling
 * Description: Corrects character sheet formula column and activity rows for Pact Magic spells to reflect slot scaling.
 *
 * @introduced v14.46.0
 */
import { MODULE_ID, isFeatureActive, log } from "../../main.js";

/**
 * Updates an individual spell's activities and top-level labels if it is a single-level
 * or pact spell on an actor whose slot level exceeds the spell's base level.
 *
 * @param {Item5e} spell
 */
export function updateSpellPactScaling(spell) {
    if ( !spell || spell.type !== "spell" ) return;
    const method = spell.system?.method;
    const model = CONFIG.DND5E.spellcasting?.[method];
    if ( !(model?.isSingleLevel || method === "pact") || !(spell.system?.level > 0) ) return;

    for ( const activity of spell.system.activities ?? [] ) {
        if ( typeof activity.prepareDamageLabel === "function" ) {
            try {
                activity.prepareDamageLabel();
            } catch (err) {
                console.warn(`niks-dnd5e-tweaks | Failed to prepare damage label for ${activity.name} on ${spell.name}:`, err);
            }
        }
    }
    try {
        spell._prepareLabels();
    } catch (err) {
        console.warn(`niks-dnd5e-tweaks | Failed to prepare labels for ${spell.name}:`, err);
    }
}

/**
 * Patch SpellData.prototype.scalingIncrease getter to account for Pact Magic slot level.
 */
function patchSpellDataScalingIncrease() {
    const SpellData = CONFIG.Item.dataModels?.spell ?? dnd5e?.dataModels?.item?.SpellData;
    if ( !SpellData?.prototype ) {
        log("Fix: Pact Spell Scaling | SpellData prototype not found — scalingIncrease patch not applied.");
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(SpellData.prototype, "scalingIncrease");
    const originalGetter = descriptor?.get;

    Object.defineProperty(SpellData.prototype, "scalingIncrease", {
        get() {
            // If the feature is inactive, use upstream behavior
            if ( !isFeatureActive("enablePactSpellFormulaScaling", "clientEnablePactSpellFormulaScaling") ) {
                return originalGetter ? originalGetter.call(this) : null;
            }

            // If explicit flag scaling is set (e.g. during activity use), respect it
            const flagScaling = this.parent?.getFlag?.("dnd5e", "scaling");
            if ( flagScaling !== undefined && flagScaling !== null ) return flagScaling;

            // Check original getter (handles cantrips and linkedActivity)
            const base = originalGetter ? originalGetter.call(this) : null;
            if ( base !== null && base !== undefined ) return base;

            // Handle Pact Magic / single-level spellcasting on an actor
            const actor = this.parent?.actor;
            if ( actor && this.level > 0 ) {
                const method = this.method;
                const spellcasting = CONFIG.DND5E.spellcasting?.[method];
                if ( spellcasting?.isSingleLevel || method === "pact" ) {
                    let slotLevel = actor.system?.spells?.[method]?.level
                        ?? (method === "pact" ? actor.system?.spells?.pact?.level : 0);

                    // Fallback if actor spells have not finished preparation yet
                    if ( !slotLevel && spellcasting?.table ) {
                        const cls = Object.values(actor.classes ?? {}).find(c => c.spellcasting?.type === method);
                        if ( cls ) {
                            const slots = spellcasting.calculateSlots(cls.system.levels);
                            const [[sLevel] = []] = Object.entries(slots ?? {});
                            if ( sLevel ) slotLevel = parseInt(sLevel, 10);
                        }
                    }

                    if ( slotLevel && slotLevel > this.level ) {
                        return slotLevel - this.level;
                    }
                }
            }

            return null;
        },
        configurable: true,
        enumerable: false
    });
}

/**
 * Patch Actor5e.prototype._prepareSpellcasting to refresh pact spell damage labels
 * once actor spell slots (including pact slot level) have been derived.
 */
function patchActorPrepareSpellcasting() {
    const Actor5e = CONFIG.Actor.documentClass;
    if ( !Actor5e?.prototype?._prepareSpellcasting ) {
        log("Fix: Pact Spell Scaling | Actor5e._prepareSpellcasting not found — patch not applied.");
        return;
    }

    const originalPrepareSpellcasting = Actor5e.prototype._prepareSpellcasting;
    Actor5e.prototype._prepareSpellcasting = function patchedPrepareSpellcasting(...args) {
        const result = originalPrepareSpellcasting.apply(this, args);

        for ( const spell of this.itemTypes.spell ?? [] ) {
            updateSpellPactScaling(spell);
        }

        return result;
    };
}

/**
 * Patch BaseActorSheet.prototype._prepareItemSpell to guarantee that single-level / pact
 * spells have their scaled formula ready when rendered in sheet rows.
 */
function patchBaseActorSheetPrepareItemSpell() {
    const BaseActorSheet = dnd5e?.applications?.actor?.BaseActorSheet;
    if ( !BaseActorSheet?.prototype ) {
        log("Fix: Pact Spell Scaling | BaseActorSheet prototype not found — sheet patch not applied.");
        return;
    }

    let targetProto = BaseActorSheet.prototype;
    while ( targetProto && targetProto !== Object.prototype ) {
        if ( Object.prototype.hasOwnProperty.call(targetProto, "_prepareItemSpell") ) break;
        targetProto = Object.getPrototypeOf(targetProto);
    }

    if ( !targetProto || targetProto === Object.prototype ) {
        log("Fix: Pact Spell Scaling | _prepareItemSpell not found on prototype chain — sheet patch not applied.");
        return;
    }

    const originalPrepareItemSpell = targetProto._prepareItemSpell;
    targetProto._prepareItemSpell = async function patchedPrepareItemSpell(item, ctx) {
        updateSpellPactScaling(item);
        return originalPrepareItemSpell.call(this, item, ctx);
    };
}

/**
 * Patch DnD5e 6.0.6 MovementField and SensesField shims to prevent
 * "TypeError: Cannot redefine property: walk" if actor.prepareData()
 * is called repeatedly on NPCData.
 */
function patchMovementAndSensesShims() {
    const MovementField = dnd5e?.dataModels?.shared?.MovementField
        ?? CONFIG.Actor?.dataModels?.npc?.schema?.getField("attributes.movement")?.constructor;
    if ( MovementField && typeof MovementField._shim === "function" ) {
        const origMovementShim = MovementField._shim;
        MovementField._shim = function patchedMovementShim(movement) {
            if ( !movement ) return;
            if ( Object.getOwnPropertyDescriptor(movement, "walk") ) return;
            return origMovementShim.call(this, movement);
        };
    }

    const SensesField = dnd5e?.dataModels?.shared?.SensesField
        ?? CONFIG.Actor?.dataModels?.npc?.schema?.getField("attributes.senses")?.constructor;
    if ( SensesField && typeof SensesField._shim === "function" ) {
        const origSensesShim = SensesField._shim;
        SensesField._shim = function patchedSensesShim(senses) {
            if ( !senses ) return;
            if ( Object.getOwnPropertyDescriptor(senses, "darkvision") ) return;
            return origSensesShim.call(this, senses);
        };
    }
}

/**
 * Re-prepares damage labels on pact-casting spells and re-renders open sheets.
 */
export function refreshAllPactSpellScaling() {
    for ( const actor of game.actors ?? [] ) {
        if ( !actor.isOwner ) continue;
        for ( const spell of actor.itemTypes?.spell ?? [] ) {
            updateSpellPactScaling(spell);
        }
        if ( actor.sheet?.rendered ) actor.render(false);
    }

    if ( canvas?.tokens?.placeables ) {
        for ( const token of canvas.tokens.placeables ) {
            const actor = token.actor;
            if ( actor?.isToken && actor.isOwner ) {
                for ( const spell of actor.itemTypes?.spell ?? [] ) {
                    updateSpellPactScaling(spell);
                }
                if ( actor.sheet?.rendered ) actor.render(false);
            }
        }
    }
}

/**
 * Initializes the Pact Magic formula scaling fix.
 */
export function initFixPactSpellScaling() {
    patchMovementAndSensesShims();
    patchSpellDataScalingIncrease();
    patchActorPrepareSpellcasting();
    patchBaseActorSheetPrepareItemSpell();
    log("Fix: Pact Spell Scaling | Initialized pact magic formula scaling patch.");
}
