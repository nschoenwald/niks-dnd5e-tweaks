/**
 * What happens when a setting changes: the `onChange` handlers of the settings registered from the dashboard schema
 * (`settings-registration.js`), by setting key. Settings without an entry need no handler (features read them when
 * they run) or reload the page (`requiresReload` in the schema).
 *
 * @introduced v14.121.0 (moved out of main.js)
 */
import { isFeatureOnForUser } from "./utils/personal-override.js";
import { refreshSpellSlotSheets } from "./features/ui-visuals/spell-slots-left-to-right.js";
import { refreshCompendiumBrowsers } from "./features/ui-visuals/compendium-browser-columns.js";
import { refreshBladesongActors } from "./features/combat-automation/bladesong-bladework.js";
import { refreshPlayersRollOwnSavesMarks } from "./features/combat-automation/players-roll-own-saves.js";
import { enableCursorHints, disableCursorHints } from "./features/ui-visuals/cursor-hints.js";
import { enableChatCardStyling, disableChatCardStyling } from "./features/ui-visuals/chat-card-styling.js";
import { refreshAllPactSpellScaling } from "./features/patches/fix-pact-spell-scaling.js";
import { initItemSheetAttunementTag, disableItemSheetAttunementTag } from "./features/ui-visuals/item-sheet-attunement-tag.js";
import { refreshConditionHud } from "./features/canvas-tokens/condition-hud.js";
import { initNpcHpScaler, disableNpcHpScaler } from "./features/ui-visuals/npc-hp-scaler.js";
import { initNpcSpellcastingBuilder, disableNpcSpellcastingBuilder } from "./features/utilities/npc-spellcasting-builder.js";
import { enableProneRotation, disableProneRotation } from "./features/canvas-tokens/prone-rotation.js";
import { refreshFastestMovementActions } from "./features/canvas-tokens/fastest-movement-action.js";
import { refreshGridCones } from "./features/canvas-tokens/grid-cone-rules.js";
import { onDisableActiveEffectExpiryChanged } from "./features/combat-automation/disable-active-effect-expiry.js";
import { isActorDead, removeBloodiedEffect } from "./features/combat-automation/suppress-bloodied-dead.js";

/** Spell Slots Expend Left to Right: world setting and personal override. */
function onSpellSlotsChange() {
    isFeatureOnForUser("enableSpellSlotsLeftToRight", "clientSpellSlotsLeftToRight", { refresh: true });
    refreshSpellSlotSheets();
}

/** Compendium Browser Columns: world setting and personal override. */
function onCompendiumColumnsChange() {
    isFeatureOnForUser("enableCompendiumBrowserColumns", "clientCompendiumBrowserColumns", { refresh: true });
    refreshCompendiumBrowsers();
}

/** Cursor & Keyboard Hints: world setting and personal override. */
function onCursorHintsChange() {
    if (isFeatureOnForUser("enableCursorHints", "clientCursorHints", { refresh: true })) enableCursorHints();
    else disableCursorHints();
}

/** Chat Card Styling: world setting and personal override. */
function onChatCardStylingChange() {
    if (isFeatureOnForUser("enableChatCardStyling", "clientChatCardStyling", { refresh: true })) enableChatCardStyling();
    else disableChatCardStyling();
}

/** Item Sheet Attunement Tag: world setting and personal override. */
function onAttunementTagChange() {
    if (isFeatureOnForUser("enableItemSheetAttunementTag", "clientItemSheetAttunementTag", { refresh: true })) initItemSheetAttunementTag();
    else disableItemSheetAttunementTag();
}

/** Item Sheet Attunement Tag placement: redraw the tags if the feature is on. */
function onAttunementTagPlacementChange() {
    if (isFeatureOnForUser("enableItemSheetAttunementTag", "clientItemSheetAttunementTag", { refresh: true })) initItemSheetAttunementTag();
}

/**
 * Drop the cached auto-collapse decisions on every message and re-render the chat log,
 * so a changed damage tray collapse setting applies to existing cards.
 */
function resetDamageTrayCollapse() {
    game.messages?.forEach(m => {
        delete m._nd5tShouldCollapseTray;
        delete m._nd5tIsHealingMistarget;
        delete m._nd5tHadHtml;
        if (m._nd5tAutoCollapsed) {
            m._trayStates?.delete("DAMAGE-APPLICATION");
            m._trayStates?.delete("damage-application");
            delete m._nd5tAutoCollapsed;
        }
    });
    ui.chat?.render(true);
    if (ui.chat?.popout?.rendered) ui.chat.popout.render(true);
}

/**
 * Suppress Bloodied While Dead: remove the Bloodied marker from dead creatures on the canvas, or let dnd5e set it
 * again when the setting is turned off. Active GM only.
 * @param {boolean} value
 */
function onSuppressBloodiedWhileDeadChange(value) {
    if (!game.user?.isActiveGM) return;
    for (const token of canvas.tokens?.placeables ?? []) {
        const actor = token.actor;
        if (!actor) continue;
        if (value) {
            if (isActorDead(actor)) removeBloodiedEffect(actor);
        } else {
            if (typeof actor.updateBloodied === "function") actor.updateBloodied();
        }
    }
}

/** @type {Record<string, (value: unknown) => void>} Setting key → onChange handler. */
export const SETTING_HANDLERS = Object.freeze({
    // Personal settings
    clientSpellSlotsLeftToRight: onSpellSlotsChange,
    clientCompendiumBrowserColumns: onCompendiumColumnsChange,
    clientEnableBladesongBladework: () => refreshBladesongActors(),
    clientEnablePlayersRollOwnSaves: () => refreshPlayersRollOwnSavesMarks(),
    clientCursorHints: onCursorHintsChange,
    clientChatCardStyling: onChatCardStylingChange,
    clientEnablePactSpellFormulaScaling: () => refreshAllPactSpellScaling(),
    clientItemSheetAttunementTag: onAttunementTagChange,
    clientItemSheetAttunementTag_placement: onAttunementTagPlacementChange,
    clientConditionHud: () => refreshConditionHud(),

    // World settings
    enableChatCardStyling: onChatCardStylingChange,
    enableAutoCollapseHostileDamageTrays: resetDamageTrayCollapse,
    enableAutoCollapsePlayerDamageTrays: resetDamageTrayCollapse,
    enableCursorHints: onCursorHintsChange,
    enablePactSpellFormulaScaling: () => refreshAllPactSpellScaling(),
    enableItemSheetAttunementTag: onAttunementTagChange,
    itemSheetAttunementTag_placement: onAttunementTagPlacementChange,
    enableSpellSlotsLeftToRight: onSpellSlotsChange,
    enableNpcHpScaling: (value) => {
        if (value) initNpcHpScaler();
        else disableNpcHpScaler();
    },
    enableNpcSpellcastingBuilder: (value) => {
        if (value) initNpcSpellcastingBuilder();
        else disableNpcSpellcastingBuilder();
    },
    enableCompendiumBrowserColumns: onCompendiumColumnsChange,
    enableConditionHud: () => refreshConditionHud(),
    hudHiddenStatuses: () => refreshConditionHud(),
    enableProneRotation: (value) => {
        if (value) enableProneRotation();
        else disableProneRotation();
    },
    enableFastestMovementAction: () => refreshFastestMovementActions(),
    enableGridConeRules: () => refreshGridCones(),
    enablePlayersRollOwnSaves: () => refreshPlayersRollOwnSavesMarks(),
    playersRollOwnSavesOffline: () => refreshPlayersRollOwnSavesMarks(),
    enableBladesongBladework: () => refreshBladesongActors(),
    disableActiveEffectExpiry: (value) => onDisableActiveEffectExpiryChanged(value),
    enableSuppressBloodiedWhileDead: onSuppressBloodiedWhileDeadChange
});
