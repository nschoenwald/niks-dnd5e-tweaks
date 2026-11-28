// UI & Visuals
import { enableCursorHints } from "./features/ui-visuals/cursor-hints.js";
import { initBloodDropIcon } from "./features/ui-visuals/blood-drop-icon.js";
import { initItemSheetAttunementTag } from "./features/ui-visuals/item-sheet-attunement-tag.js";
import { initSheetPlusCompendium } from "./features/ui-visuals/sheet-plus-compendium.js";
import { initSpellSlotsLeftToRight } from "./features/ui-visuals/spell-slots-left-to-right.js";
import { initNpcHpScaler } from "./features/ui-visuals/npc-hp-scaler.js";
import { initNpcSpellcastingBuilder } from "./features/utilities/npc-spellcasting-builder.js";
import { initForceCompendiumBrowser } from "./features/ui-visuals/force-compendium-browser.js";
import { initCompendiumBrowserColumns } from "./features/ui-visuals/compendium-browser-columns.js";
import { initRollModeHighlight } from "./features/ui-visuals/roll-mode-highlight.js";
import { initChatCardStyling, enableChatCardStyling } from "./features/ui-visuals/chat-card-styling.js";
import { initRollBreakdownDetails } from "./features/ui-visuals/roll-breakdown-details.js";
import { initRetroactiveAdvantage } from "./features/ui-visuals/retroactive-advantage.js";
import { initAutoCollapseDamageTrays } from "./features/ui-visuals/auto-collapse-damage-trays.js";

// Canvas & Tokens
import { enableProneRotation } from "./features/canvas-tokens/prone-rotation.js";
import { initFastestMovementAction } from "./features/canvas-tokens/fastest-movement-action.js";
import { initConditionHud } from "./features/canvas-tokens/condition-hud.js";
import { initTemplateGridSnap } from "./features/canvas-tokens/template-grid-snap.js";
import { initGridConeRules } from "./features/canvas-tokens/grid-cone-rules.js";
import { initGridBasedTemplates } from "./features/canvas-tokens/grid-based-templates.js";
import { initTemplateTargeting } from "./features/canvas-tokens/template-targeting.js";
import { initTemplatePlacementHUD } from "./features/canvas-tokens/template-placement-hud.js";
import { initSummonPlacementHUD } from "./features/canvas-tokens/summon-placement-hud.js";
import { initSummonPermissionNotice } from "./features/canvas-tokens/summon-permission-notice.js";
import { initTeleportTargeting } from "./features/canvas-tokens/teleport-targeting.js";

// Combat & Automation
import { initAutoRollInitiative } from "./features/combat-automation/auto-roll-initiative.js";
import { initLegendaryActionPlaceholders } from "./features/combat-automation/legendary-action-placeholders.js";
import { initAutoRollSaveDamage } from "./features/combat-automation/auto-roll-save-damage.js";
import { initAutoRollAttackDamage } from "./features/combat-automation/auto-roll-attack-damage.js";
import { initPlayerDamagePrompt } from "./features/combat-automation/player-damage-prompt.js";
import { initHealingContextMenu } from "./features/combat-automation/healing-context-menu.js";
import { initSaveGatedEffects } from "./features/combat-automation/save-gated-effects.js";
import { initPlayersRollOwnSaves } from "./features/combat-automation/players-roll-own-saves.js";
import { initSelfEffectApplication } from "./features/combat-automation/self-effect-application.js";
import { initSelfTargetCorrection } from "./features/combat-automation/self-target-correction.js";
import { initRemoveInstantaneousTemplates } from "./features/combat-automation/remove-instantaneous-templates.js";
import { initAutoRollConcentration } from "./features/combat-automation/auto-roll-concentration.js";
import { initMageSlayerConcentration } from "./features/combat-automation/mage-slayer-concentration.js";
import { initMagicResistance } from "./features/combat-automation/magic-resistance.js";
import { initCircleOfPower, registerCircleOfPowerTypes } from "./features/combat-automation/circle-of-power.js";
import { initHolyAura } from "./features/combat-automation/holy-aura.js";
import { initEvasion } from "./features/combat-automation/evasion.js";
import { initDeathWard } from "./features/combat-automation/death-ward.js";
import { initCompanionLevelSync } from "./features/combat-automation/companion-level-sync.js";
import { initSummonInitiative } from "./features/combat-automation/summon-initiative.js";
import { initLevelChangeResources } from "./features/utilities/level-change-resources.js";
import { initUndeadFortitude } from "./features/combat-automation/undead-fortitude.js";
import { initProneRules } from "./features/combat-automation/prone-rules.js";
import { initConditionRollModes } from "./features/combat-automation/condition-roll-modes.js";
import { initRangedCloseCombat } from "./features/combat-automation/ranged-close-combat.js";
import { initRecklessAttack } from "./features/combat-automation/reckless-attack.js";
import { initBrutalStrike } from "./features/combat-automation/brutal-strike.js";
import { initNoTargetWarning } from "./features/combat-automation/no-target-warning.js";
import { initIndomitableMight } from "./features/combat-automation/indomitable-might.js";
import { initBladesongBladework, refreshBladesongActors } from "./features/combat-automation/bladesong-bladework.js";
import { initAutoEndConcentration } from "./features/combat-automation/auto-end-concentration.js";
import { initAutoEndClassFeatures } from "./features/combat-automation/auto-end-class-features.js";
import { initDisableActiveEffectExpiry } from "./features/combat-automation/disable-active-effect-expiry.js";
import { initAutoStatusZeroHP } from "./features/combat-automation/auto-status-zero-hp.js";
import { initDeathSavePrompt } from "./features/combat-automation/death-save-prompt.js";
import { initSuppressBloodiedDead } from "./features/combat-automation/suppress-bloodied-dead.js";
import { initCombatExpTracker } from "./features/combat-automation/combat-exp-tracker.js";
import { initPreventGroupActorRolls } from "./features/combat-automation/prevent-group-actor-rolls.js";
import { initAggregateShortRestRolls } from "./features/combat-automation/aggregate-short-rest-rolls.js";
import { initWeaponMasteries } from "./features/combat-automation/weapon-masteries.js";
import { initConditionalDamage } from "./features/combat-automation/conditional-damage/index.js";
import { initGreatWeaponFighting } from "./features/combat-automation/great-weapon-fighting.js";
import { initElementalAdept } from "./features/combat-automation/elemental-adept.js";
import { initAutomaticDamageRules } from "./features/combat-automation/automatic-damage-rules.js";
import { registerAreaSpellTypes, initAreaSpells } from "./features/combat-automation/area-spells/index.js";

// Utilities
import { initActorItemDragBehavior } from "./features/utilities/actor-item-drag-behavior.js";
import { initLanguageFilter } from "./features/utilities/language-filter.js";

// Patches
import { initFixSkillTooltipOverlap } from "./features/patches/fix-skill-tooltip-overlap.js";
import { initFixPactSpellScaling } from "./features/patches/fix-pact-spell-scaling.js";
import { initFixDamageTrayGroupingKey } from "./features/patches/fix-damage-tray-grouping-key.js";
import { initFixTokenHPBarAnimation } from "./features/patches/fix-token-hp-bar-animation.js";
import { initFixFreeCastSpellScaling } from "./features/patches/fix-free-cast-spell-scaling.js";
import { initFixUntypedHealing } from "./features/patches/fix-untyped-healing.js";
import { initFixRegionEffectDeletedToken } from "./features/patches/fix-region-effect-deleted-token.js";
import { initFixRollDialogOffscreen } from "./features/patches/fix-roll-dialog-offscreen.js";
import { initFixHofBladeworkBatch } from "./features/patches/fix-hof-bladework-batch.js";

// Nik's Foundry Tweaks: dashboard registration and extensions
import { coreApi, registerWithCore, warnIfCoreMissing } from "./core-integration.js";

// Module context
import { MODULE_ID, log, debug, getSetting, isFeatureActive, clearSettingsCache } from "./context.js";
import { registerSettings } from "./settings-registration.js";
import { initSocketRouter } from "./utils/socket-router.js";
import { isFeatureOnForUser, migratePersonalOptOuts } from "./utils/personal-override.js";

// Re-exported for backwards compatibility. Feature files import these from context.js.
export { MODULE_ID, log, debug, getSetting, isFeatureActive, clearSettingsCache };

// Register with Nik's Foundry Tweaks. Must run at the top level: core calls the hook during its own init.
registerWithCore();

/**
 * Personal opt-outs (Boolean) replaced by personal overrides ("world" / "on" / "off") in 14.71.4.
 * Old key → new key. See `utils/personal-override.js`.
 */
const PERSONAL_OVERRIDE_MIGRATIONS = Object.freeze({
    clientEnableSheetPlusCompendium: "clientSheetPlusCompendium",
    clientEnableCursorHints: "clientCursorHints",
    clientEnableRollModeHighlight: "clientRollModeHighlight",
    clientEnableChatCardStyling: "clientChatCardStyling",
    clientEnableItemSheetAttunementTag: "clientItemSheetAttunementTag",
    clientItemSheetAttunementTag_tooltip: "clientItemSheetAttunementTagTooltip",
    clientEnableTemplateControlsHUD: "clientTemplateControlsHUD",
    clientEnableSummonControlsHUD: "clientSummonControlsHUD",
    clientEnableConditionHud: "clientConditionHud"
});

Hooks.once("init", () => {

    // Public API, kept for macros: opens the shared dashboard of Nik's Foundry Tweaks at a setting.
    const moduleData = game.modules.get(MODULE_ID);
    if (moduleData) {
        moduleData.api = {
            openSettings: (key) => coreApi()?.openSettings(key)
        };
    }

    // Settings: registered from the dashboard schema (settings-registration.js)
    registerSettings();

    // Personal opt-outs that became Use World Setting / On / Off in 14.71.4, before any feature reads them
    migratePersonalOptOuts(PERSONAL_OVERRIDE_MIGRATIONS);

    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initBloodDropIcon();
    initRollBreakdownDetails();
    initFixPactSpellScaling();

    // Region / activity behavior types must be registered before data models are prepared
    registerAreaSpellTypes();
    registerCircleOfPowerTypes();
});

Hooks.once("setup", () => {
    // Initialize features that need to catch early hooks (like controls or sidebar renders)
    initForceCompendiumBrowser();

    // Register settings for features that manage their own state
    initAutoRollInitiative();
    initSummonInitiative();
    initDeathSavePrompt();
    initAutoStatusZeroHP();
    initLegendaryActionPlaceholders();
    initTemplateGridSnap();
    initGridConeRules();
    // Before Template Targeting and the Template HUD, so their placeRegion wrappers see the grid-based shapes
    initGridBasedTemplates();
    initHealingContextMenu();
    initAutoRollSaveDamage();
    initAutoRollAttackDamage();
    initPlayerDamagePrompt();
    initAutoEndConcentration();
    initAutoEndClassFeatures();
    initDisableActiveEffectExpiry();
    initAutoRollConcentration();
    initMageSlayerConcentration();
    initMagicResistance();
    initCircleOfPower();
    initHolyAura();
    initEvasion();
    // Before Undead Fortitude: a creature with both keeps 1 HP from the ward without rolling
    initDeathWard();
    initCompanionLevelSync();
    initLevelChangeResources();
    initUndeadFortitude();
    initSelfEffectApplication();
    initSaveGatedEffects();
    initPlayersRollOwnSaves();
    initSelfTargetCorrection();
    initRemoveInstantaneousTemplates();
    initSheetPlusCompendium();
    initSpellSlotsLeftToRight();
    initCompendiumBrowserColumns();
    initNpcHpScaler();
    initNpcSpellcastingBuilder();
    initItemSheetAttunementTag();
    initTemplateTargeting();

    initCombatExpTracker();
    initAggregateShortRestRolls();

    // Bug fixes
    initFixSkillTooltipOverlap();
    initFixDamageTrayGroupingKey();
    initFixTokenHPBarAnimation();
    initFixFreeCastSpellScaling();
    initFixUntypedHealing();
    initFixRegionEffectDeletedToken();
    initFixRollDialogOffscreen();
    initFixHofBladeworkBatch();

    // Utilities
    initActorItemDragBehavior();
    initLanguageFilter();

    // UI helpers
    initRollModeHighlight();
    initChatCardStyling();
    initRetroactiveAdvantage();
    initAutoCollapseDamageTrays();
    initSuppressBloodiedDead();
    initTemplatePlacementHUD();
    initSummonPlacementHUD();
    initSummonPermissionNotice();
    initTeleportTargeting();
    initPreventGroupActorRolls();
    initWeaponMasteries();
    initProneRules();
    initFastestMovementAction();
    initConditionRollModes();
    initRangedCloseCombat();
    initRecklessAttack();
    // After Reckless Attack: its hooks must run first, and Brutal Strike plugs into its dialog and prompt
    initBrutalStrike();
    initNoTargetWarning();
    initIndomitableMight();
    initBladesongBladework();
    // Actors were prepared before this patch existed
    refreshBladesongActors();
    initConditionHud();
    // Before Conditional Damage: Savage Attacker builds its dice pool from the dice Great Weapon Fighting modified
    initGreatWeaponFighting();
    initElementalAdept();
    initAutomaticDamageRules();
    initConditionalDamage();
    initAreaSpells();
});

Hooks.once("ready", async () => {
    warnIfCoreMissing();

    // One-time migrations (active GM only, so two connected GMs never run them at once)
    if (game.user.isActiveGM) await runMigrations();

    // Features that can run at ready or need the game to be fully loaded
    if (isFeatureOnForUser("enableCursorHints", "clientCursorHints", { refresh: true })) enableCursorHints();
    if (game.settings.get(MODULE_ID, "enableProneRotation")) enableProneRotation();
    if (isFeatureOnForUser("enableChatCardStyling", "clientChatCardStyling", { refresh: true })) enableChatCardStyling();

    // Socket router: features register the messages they handle themselves (scripts/utils/socket-router.js)
    initSocketRouter();

});

/**
 * Run one-time data migrations, gated by a stored version number.
 */
async function runMigrations() {
    const currentVersion = game.settings.get(MODULE_ID, "migrationVersion");

    // Migration 1: Remove stale "originalRotation" flags from token documents
    if (currentVersion < 1) {
        log("Running migration 1: clearing stale originalRotation flags...");
        for (const scene of game.scenes) {
            const updates = [];
            for (const token of scene.tokens) {
                if (token.getFlag(MODULE_ID, "originalRotation") !== undefined) {
                    updates.push({ _id: token.id, [`flags.${MODULE_ID}.originalRotation`]: _del });
                }
            }
            if (updates.length) {
                await scene.updateEmbeddedDocuments("Token", updates);
                log(`  Cleared flags from ${updates.length} token(s) in scene "${scene.name}"`);
            }
        }
        await game.settings.set(MODULE_ID, "migrationVersion", 1);
        log("Migration 1 complete.");
    }

    // Migration 2: Migrate legacy boolean enableAutoRollInitiative & autoRollInitiativeFastForward
    if (currentVersion < 2) {
        log("Running migration 2: migrating initiative settings...");
        // Only worlds that stored a legacy value need migrating. On a fresh world the legacy settings
        // return their defaults, which would overwrite the new settings' own defaults.
        const worldStorage = game.settings.storage.get("world");
        const hasLegacy = ["enableAutoRollInitiative", "autoRollInitiativeFastForward"]
            .some(key => worldStorage.getSetting(`${MODULE_ID}.${key}`));
        if (!hasLegacy) log("  No legacy initiative settings stored, keeping defaults.");
        else {
            try {
                const oldEnable = game.settings.get(MODULE_ID, "enableAutoRollInitiative");
                const oldFastForward = game.settings.get(MODULE_ID, "autoRollInitiativeFastForward");

                let newPrompt = "all";
                let newAutoRoll = "none";

                if (oldEnable === false) {
                    newPrompt = "none";
                } else if (oldFastForward === "all") {
                    newAutoRoll = "all";
                    newPrompt = "none";
                } else if (oldFastForward === "npcsOnly" || oldFastForward === "npcs") {
                    newAutoRoll = "npcs";
                    newPrompt = "players";
                } else if (oldFastForward === "playersOnly" || oldFastForward === "players") {
                    newAutoRoll = "players";
                    newPrompt = "npcs";
                }

                await game.settings.set(MODULE_ID, "promptForInitiative", newPrompt);
                await game.settings.set(MODULE_ID, "autoRollInitiative", newAutoRoll);
                log(`  Migrated initiative settings: promptForInitiative="${newPrompt}", autoRollInitiative="${newAutoRoll}"`);
            } catch (err) {
                log("  Could not read legacy initiative settings, using defaults.", err);
            }
        }
        await game.settings.set(MODULE_ID, "migrationVersion", 2);
        log("Migration 2 complete.");
    }

    // Migration 3: Add Moonbeam, Cloudkill and Doomtide to a stored Area Spells list
    if (currentVersion < 3) {
        log("Running migration 3: adding new spells to the Area Spells list...");
        // Worlds that never saved the list use the new default already
        const worldStorage = game.settings.storage.get("world");
        if (worldStorage.getSetting(`${MODULE_ID}.damageEmanationSpells`)) {
            const current = String(game.settings.get(MODULE_ID, "damageEmanationSpells") ?? "")
                .split(",").map(s => s.trim()).filter(Boolean);
            const known = new Set(current.map(s => s.slugify({ strict: true })));
            const added = ["cloudkill", "doomtide", "moonbeam"].filter(id => !known.has(id));
            if (added.length) {
                const merged = [...current, ...added].sort((a, b) => a.localeCompare(b)).join(", ");
                await game.settings.set(MODULE_ID, "damageEmanationSpells", merged);
                log(`  Added ${added.join(", ")} to the Area Spells list.`);
            }
        }
        await game.settings.set(MODULE_ID, "migrationVersion", 3);
        log("Migration 3 complete.");
    }
}
