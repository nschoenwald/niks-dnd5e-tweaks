/**
 * Feature: Area Spell Automation (until 14.120.0: Damage Emanation Automation)
 * Description: Triggers the saving throw and/or damage of emanation and area spells such as Spirit Guardians,
 * Conjure Woodland Beings, Cacophonic Shield, Dirge, Moonbeam, Cloudkill, Doomtide, Web and Wall of Fire
 * whenever a creature enters the area, the area moves into a creature's space, or a creature starts or ends
 * its turn inside it (which of these apply depends on the spell).
 *
 * @introduced v14.54.0
 * @updated v14.58.0 (Placed areas: Moonbeam, Cloudkill, Doomtide; Cloudkill / Doomtide drift each caster turn)
 * @updated v14.59.0 (Length conversion uses the D&D 5e 6.1 signature where available)
 * @updated v14.82.0 (Per-spell triggers incl. turn start, damage-only and save-only activities, creature type
 *   filter, Spell field for hand-drawn regions; more PHB 2024 spells in the default list)
 * @updated v14.87.1 (Players' templates: the active GM attaches the behavior, players can't create regions with behaviors)
 * @updated v14.89.0 (Lightning Ring, Grave Ground, Spellfire Storm, Hunger of Hadar (two behaviors), Cordon of Arrows
 *   (ammunition count); enemy-only spells skip the caster's side)
 * @updated v14.92.0 (Notices for listed spells without a usable activity and incomplete behaviors; a lost activity
 *   is found again on the caster; the caster's player rolls the damage when the GM triggers the saves; save cards
 *   are always public)
 * @updated v14.97.0 (Hunger of Hadar: the caster chooses whether the cold or the acid damage gets the upcast dice)
 * @updated v14.104.0 (World of Warcraft: Consecration, Hand of Gul'dan, Rain of Fire, Starfall)
 * @updated v14.115.3 (Exclude Allies also covers dnd5e's own effect and difficult terrain behaviors, e.g. the
 *   speed reduction of Spirit Guardians)
 * @updated v14.116.0 (Revealing a hidden caster doesn't trigger their attached emanation on the creatures already in it,
 *   Foundry 14.371)
 * @updated v14.118.1 (the caster's player gets the delegated damage roll again; socket requests are checked
 *   against the sender)
 * @updated v14.120.0 (Renamed to Area Spell Automation; split into modules; skipped turns don't trigger turn-end
 *   saves; delegated damage requests only from the card's author; damage type memory on every scene; combat lookup
 *   prefers the scene's own combat; drifting areas also move when another combatant takes the current turn)
 */
import { log } from "../../../context.js";
import { patchActivityBehaviorDispositions } from "./allies.js";
import {
    onCreateMeasuredTemplate, onCreateRegion, onCreateRegionBehavior, onCreateToken, onDeleteRegion,
    onDeleteRegionBehavior, onPreUseActivity, onRenderUsageDialog, onUpdateRegion, onUpdateRegionBehavior, onUpdateToken
} from "./placement.js";
import { onRenderChatMessage, onUpdateChatMessage } from "./prompt.js";
import { onCombatTurnChange, onDeleteActiveEffect, onPreRollDamage, onRollDamage } from "./upkeep.js";

export { registerAreaSpellTypes } from "./types.js";

/*
 * Overview
 *
 * dnd5e 6 places spell templates as Regions (attached to the caster's token for emanations). This feature adds a
 * custom Region Behavior to those regions, either through the spell list setting (matched by item identifier),
 * through the entry in an activity's Behaviors tab, or by hand with the behavior's Spell field. The behavior type id
 * (`niks-dnd5e-tweaks.damageEmanation`), the setting keys and the flags keep the feature's old name: they are stored
 * in worlds and placed areas.
 *
 * Foundry V14 fires the region events that match the 2024 rules wording:
 *  - TOKEN_ENTER with movement data: a creature enters the area.
 *  - TOKEN_ENTER without movement data: the area (attached to the caster) moves into a creature's space. The same
 *    event fires for creatures already inside when the region is created; those are ignored, because the casting
 *    activity already handles them.
 *  - TOKEN_TURN_START / TOKEN_TURN_END: a creature starts or ends its turn inside the area (only on the designated
 *    GM's client, so these need a GM online). Turns passed over by jumping ahead in the tracker don't count.
 *
 * Exactly one client handles an event (the active GM, otherwise the caster's first active owner). Triggers arriving
 * close together are batched into one activity use with several targets. Each creature is affected only once per
 * combat turn per area.
 *
 * The save or damage activity is re-used without consumption, concentration or template placement, so the native
 * save card, damage roll, damage application and effect application all work as usual.
 *
 * Modules:
 *  - config.js     constants and the per-spell rules
 *  - state.js      client-side state shared by the modules
 *  - types.js      the Region Behavior and Activity Behavior types (init)
 *  - activity.js   which activity an area uses, spell list, triggers, concentration
 *  - placement.js  adding the behavior when an area is placed, upcast choice, creatures already inside
 *  - triggers.js   region events, who is affected, once-per-turn tracking, batching
 *  - execute.js    the activity use and the delegated damage roll
 *  - prompt.js     the prompt card and its socket requests
 *  - upkeep.js     drifting areas, concentration cleanup, remembered damage type
 *  - allies.js     Exclude Allies for dnd5e's own activity behaviors
 */

/**
 * Register the hooks of Area Spell Automation.
 * Called once during the "setup" phase from main.js.
 */
export function initAreaSpells() {
    Hooks.on("dnd5e.preUseActivity", onPreUseActivity);
    Hooks.on("renderActivityUsageDialog", onRenderUsageDialog);
    Hooks.on("dnd5e.createMeasuredTemplate", onCreateMeasuredTemplate);
    Hooks.on("createRegion", onCreateRegion);
    Hooks.on("updateRegion", onUpdateRegion);
    Hooks.on("updateToken", onUpdateToken);
    Hooks.on("deleteRegion", onDeleteRegion);
    Hooks.on("createRegionBehavior", onCreateRegionBehavior);
    Hooks.on("updateRegionBehavior", onUpdateRegionBehavior);
    Hooks.on("deleteRegionBehavior", onDeleteRegionBehavior);
    Hooks.on("createToken", onCreateToken);
    Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
    Hooks.on("dnd5e.preRollDamage", onPreRollDamage);
    Hooks.on("dnd5e.rollDamage", onRollDamage);
    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
    Hooks.on("updateChatMessage", onUpdateChatMessage);
    Hooks.on("combatTurnChange", onCombatTurnChange);
    patchActivityBehaviorDispositions();
    log("Area Spells | Initialized");
}
