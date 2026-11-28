/**
 * Area Spell Automation: The Region Behavior and dnd5e Activity Behavior types, registered during init.
 * Part of the feature in `./index.js` (history and overview there).
 */
import { getSetting, log } from "../../../context.js";
import { isTriggerActivity, resolveDamageActivity } from "./activity.js";
import { ACTIVITY_BEHAVIOR_TYPE, DAMAGE_EMANATION_BEHAVIOR_TYPE, TRIGGER_TYPES } from "./config.js";
import { onTokenEnter, onTokenTurnEnd, onTokenTurnStart } from "./triggers.js";

/**
 * Register the Region Behavior type and the dnd5e Activity Behavior type.
 * Must run during "init", before Foundry prepares data models and dnd5e localizes them.
 */
export function registerAreaSpellTypes() {
    const RegionBehaviorClass = _createRegionBehaviorType();
    CONFIG.RegionBehavior.dataModels[DAMAGE_EMANATION_BEHAVIOR_TYPE] = RegionBehaviorClass;
    CONFIG.RegionBehavior.typeIcons[DAMAGE_EMANATION_BEHAVIOR_TYPE] = "fa-solid fa-burst";

    const BaseActivityBehavior = globalThis.dnd5e?.dataModels?.regionBehavior?.BaseActivityBehavior;
    if (BaseActivityBehavior && CONFIG.DND5E?.activityBehaviorTypes) {
        CONFIG.DND5E.activityBehaviorTypes[ACTIVITY_BEHAVIOR_TYPE] = {
            label: `TYPES.RegionBehavior.${DAMAGE_EMANATION_BEHAVIOR_TYPE}`,
            icon: "icons/svg/explosion.svg",
            model: _createActivityBehaviorType(BaseActivityBehavior)
        };
    } else {
        log("Area Spells | dnd5e Activity Behaviors not available, Behaviors tab entry not registered");
    }
}

/**
 * Build the Region Behavior data model class.
 * @returns {typeof foundry.data.regionBehaviors.RegionBehaviorType}
 */
function _createRegionBehaviorType() {
    const { DocumentUUIDField, NumberField, ObjectField, SetField, StringField } = foundry.data.fields;

    return class DamageEmanationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {

        /** @override */
        static LOCALIZATION_PREFIXES = ["ND5T.DamageEmanation.Behavior"];

        /** @override */
        static defineSchema() {
            return {
                activity: new StringField({ required: true, blank: true, initial: "" }),
                spell: new DocumentUUIDField({ type: "Item", required: false, nullable: true, initial: null }),
                triggers: _createTriggersField(),
                creatureTypes: new SetField(new StringField({ blank: false, choices: _getCreatureTypeChoices })),
                scaling: new NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
                damageType: new StringField({ required: false, blank: true, initial: "" }),
                drift: new NumberField({ required: false, nullable: false, min: 0, initial: 0 }),
                charges: new NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
                triggered: new ObjectField()
            };
        }

        /** @override */
        static events = {
            [CONST.REGION_EVENTS.TOKEN_ENTER]: onTokenEnter,
            [CONST.REGION_EVENTS.TOKEN_TURN_START]: onTokenTurnStart,
            [CONST.REGION_EVENTS.TOKEN_TURN_END]: onTokenTurnEnd
        };
    };
}

/**
 * The "Triggers" field: which events trigger the emanation. Empty uses the spell's defaults.
 * @returns {foundry.data.fields.SetField}
 */
function _createTriggersField() {
    const { SetField, StringField } = foundry.data.fields;
    const choices = () => Object.fromEntries(TRIGGER_TYPES.map(type =>
        [type, game.i18n.localize(`ND5T.DamageEmanation.Triggers.${type}`)]));
    return new SetField(new StringField({ blank: false, choices }));
}

/**
 * Creature type choices for the creature type filter.
 * @returns {Record<string, string>}
 */
function _getCreatureTypeChoices() {
    return Object.fromEntries(Object.entries(CONFIG.DND5E?.creatureTypes ?? {}).map(([key, config]) =>
        [key, game.i18n.localize((typeof config === "string") ? config : (config?.label ?? key))]));
}

/**
 * Build the dnd5e Activity Behavior data model class, shown in an activity's Behaviors tab.
 * @param {typeof foundry.abstract.DataModel} BaseActivityBehavior
 * @returns {typeof foundry.abstract.DataModel}
 */
function _createActivityBehaviorType(BaseActivityBehavior) {
    const { NumberField, StringField } = foundry.data.fields;

    return class DamageEmanationActivityBehavior extends BaseActivityBehavior {

        /** @override */
        static LOCALIZATION_PREFIXES = ["ND5T.DamageEmanation.ActivityBehavior"];

        /** @override */
        static defineSchema() {
            return {
                damageActivity: new StringField({ required: true, blank: true, initial: "" }),
                triggers: _createTriggersField(),
                drift: new NumberField({ required: false, nullable: false, min: 0, initial: 0 })
            };
        }

        /** @override */
        createBehaviorData(activity) {
            if (!getSetting("enableDamageEmanation")) return false;
            const damageActivity = (this.damageActivity && activity.item?.system.activities?.get(this.damageActivity))
                ?? resolveDamageActivity(activity.item, activity);
            if (!damageActivity) return false;
            return {
                type: DAMAGE_EMANATION_BEHAVIOR_TYPE,
                system: {
                    activity: damageActivity.uuid,
                    scaling: null,
                    drift: this.drift ?? 0,
                    triggers: Array.from(this.triggers ?? [])
                }
            };
        }

        /** @override */
        customizeField(field, data) {
            if (field.name !== "damageActivity") return;
            const item = _findParentItem(this);
            const choices = Array.from(item?.system.activities ?? [])
                .filter(isTriggerActivity)
                .map(a => ({ value: a.id, label: a.name }));
            data.options = [
                { value: "", label: game.i18n.localize("ND5T.DamageEmanation.ActivityBehavior.Automatic") },
                ...choices
            ];
        }
    };
}

/**
 * Walk up the data model parents to the owning item.
 * @param {foundry.abstract.DataModel} model
 * @returns {Item5e|null}
 */
function _findParentItem(model) {
    let current = model?.parent;
    for (let depth = 0; current && depth < 6; depth++) {
        if (current.documentName === "Item") return current;
        if (current.item?.documentName === "Item") return current.item;
        current = current.parent;
    }
    return null;
}
