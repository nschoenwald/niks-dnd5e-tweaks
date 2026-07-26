# Changelog

All notable changes to this project will be documented in this file.

## [14.13.3] - 2026-07-26
### Added
- **Auto-End Class Features**: Expanded auto-ending class feature effects (`scripts/features/auto-end-class-features.js`) when an actor gains an incapacitating status:
  - **Barbarian Rage**: Supports Level 15+ Barbarian **Persistent Rage** (Rage only ends early on `unconscious` or `dead` condition for level 15+ Barbarians).
  - **Sea Druid's Wrath of the Sea** (`wrath-of-the-sea`): Automatically ends when the token becomes incapacitated.
  - **Star Druid's Starry Form** (`starry-form`): Automatically ends when the token becomes incapacitated.
- **Refactoring**: Split class feature auto-end logic out of `auto-end-concentration.js` into its own dedicated module (`scripts/features/auto-end-class-features.js`).

## [14.13.2] - 2026-07-26
### Fixed
- **Self Effect Application Prompt**: Fixed self-effect application prompt cards not appearing for self-targeted spells (e.g. *Shield*, *Mirror Image*, *Divine Favor*, *Armor of Agathys*, *Absorb Elements*). In DnD5e v5.2+, spell activities do not duplicate target data on the activity object unless overridden (`activity.target.override = false`), so target criteria now check the parent item (`item.system.target.affects.type`, `item.system.range.units`), and effect retrieval falls back to non-transfer ActiveEffects on the parent item when `activity.applicableEffects` is empty.

## [14.13.1] - 2026-07-26
### Fixed
- **Self Effect Application Prompt**: Fixed a bug where self-targeted activity prompt chat cards failed to pop up for player clients. Removed an erroneous primary GM guard in `_onPostUseActivity` (`dnd5e.postUseActivity` fires on the client executing the activity), and explicitly added `game.user.id` to whisper targets so the triggering player always receives the prompt card.

## [14.13.0] - 2026-07-25
### Added
- **Self Effect Application Prompt**: When an actor uses an activity with Active Effects that target "Self" (e.g. Rage, Divine Favor, Mirror Image), whispers a chat card to the actor's owning player and the GM. The card lists each self-targeted effect with an icon and a one-click **Apply** button. After applying an effect, the button transitions to "Effect Applied ✓" and an **Undo** button appears to delete the effect from the actor. Button state syncs across all clients via flag updates and the module socket, matching the same apply/undo pattern as the Player Damage Prompt. Enabled by default.

### Fixed
- **Auto Status at 0 HP**: Fixed a fatal guard condition in `_processHPChange` (`(!actor.parent && !actor.isToken)`) which evaluated to `true` for all linked world actors (including Player Characters), silently aborting status application and removal before it could execute.
- **Auto Status at 0 HP**: Fixed player character classification in `_ownershipType` to ensure DnD5e character actors (`actor.type === "character"`) and actors with player owners are correctly identified as `"player"`, preventing player characters at 0 HP from being misclassified as NPCs and incorrectly receiving NPC statuses (`dead`) and combat actions (`defeated`).
- **Auto Status at 0 HP**: Fixed a bug where a boolean `false` value in `options.autoStatusWasZeroHP` blocked fallback status checking (`false ?? fallback`), causing status overlay removal and un-defeating to be skipped when HP was restored above 0.
- **Auto Status at 0 HP**: Added automatic removal of opposing 0-HP statuses (e.g. removing `dead` when applying `unconscious`, and vice versa) when 0-HP status conditions are applied.

## [14.12.2] - 2026-07-24
### Changed
- **Settings**: Reordered the Automation & QOL settings panel for better logical grouping. The Healing Roll Context Menu setting now sits directly after the Player Damage Prompt block. The concentration-related settings now form a cohesive sequence: Auto-Roll Concentration Saves → ↳ Fast-Forward → ↳ Auto-End on Failure → Mage Slayer: Concentration Disadvantage → Auto-End Concentration → Auto-End Rage.

## [14.12.1] - 2026-07-24
### Added
- **Mage Slayer: Concentration Breaker**: When an attacker with the Mage Slayer feat deals damage to a concentrating creature, the concentration saving throw is automatically rolled with Disadvantage. If the defender has intrinsic Advantage on concentration saves (e.g. War Caster, Eldritch Mind), the two cancel to a normal roll per 2024 PHB rules. Attacker detection uses a 3-tier check: official `mage-slayer` item identifier, legacy `dnd5e.mageSlayer` actor flag, or item name match for homebrew.

## [14.12.0] - 2026-07-23
### Added
- **Auto-Roll Concentration Saves**: Automatically rolls a concentration saving throw for concentration when a concentrating token takes damage, matching official DnD5e 5.2+ rules (DC 10 or half damage taken, whichever is higher) and accounting for intrinsic concentration advantage/disadvantage traits (e.g. War Caster, Eldritch Mind). The roll card appears in chat after the system's own "click to roll" concentration prompt.
- **Interactive "End Concentration" Chat Card Button**: Appends an "End Concentration" button to concentration roll chat cards. The button appears on all concentration saves — including auto-rolled ones and manually triggered ones (from the system's DC prompt card or the character sheet) — allowing GMs and owning players to break concentration with a single click.
- **Auto-Roll Concentration Settings**: Added module settings for the new feature:
  - **Auto-Roll Concentration Saves** — master toggle (enabled by default).
  - **Fast-Forward Concentration Rolls** — four-way choice controlling which actor types skip the roll dialog: *All Actors* (default), *NPCs Only*, *Players Only*, or *Never* (always show the pre-configured dialog).
  - **Auto-End Concentration on Save Failure** — when enabled, concentration is ended automatically on a failed save. Disabled by default; the "End Concentration" button on the chat card handles manual removal.

### Fixed
- **Auto-Roll Concentration Saves**: Fixed module flags not being persisted on the created ChatMessage. Flags were passed at the top level of the message config (`message.flags`) but `buildPost` only writes `message.data` into the document — flags must be nested under `data.flags`. This caused the "End Concentration" button to never appear.
- **Auto-Roll Concentration Saves**: Fixed the auto-rolled save card appearing *above* the system's "DC X Concentration" prompt in the chat log. `challengeConcentration()` is not awaited in `onUpdateHP`, so both messages raced to the server. Increased the pre-roll defer from 0 ms to 200 ms to reliably ensure the system's message receives a lower server timestamp.

### Changed
- **Prompt for Death Saves**: Instead of posting a whispered chat card for the player to click, the Death Saving Throw roll dialog now opens automatically and directly on the owning player's client when their character's turn starts at 0 HP. The pre-configured dialog pops up immediately without requiring a manual click. The GM fallback whispered chat card (with a clickable button) is still sent when no owner of the actor is connected, so unattended characters are still covered.
- **Auto Status at 0 HP**: Improved resilience of the heal-recovery path. `wasZeroHP` now falls back to checking the actor's current statuses (`dead`/`unconscious`) when `preUpdateActor` was bypassed by another module or system path, preventing statuses from silently persisting after a heal.

## [14.11.23] - 2026-07-23
### Fixed
- **Player Damage Prompt**: Fixed NPC names in damage prompt chat cards being hidden for GMs when the `hide-npc-names` module is active. The prompt now builds chat cards using the target's unhidden token/actor name, allowing GMs to see the real name while `hide-npc-names` dynamically hides it for non-GM players when rendering the card in chat.

### Changed
- **Player Damage Prompt**: Removed redundant target name repetition and attack roll totals from the card body text in both Structured and Classic layouts, producing a cleaner chat card design.

## [14.11.22] - 2026-07-21
### Added
- **Legendary Action Placeholders**: Added a sub-setting ("↳ Placeholder Icon") with a file picker to configure a custom icon for legendary action initiative placeholders (defaults to `icons/svg/combat.svg`). Includes automatic validation via image preloading to fall back to the default icon for any load failure (404, 403, CORS, network errors, or corrupt/invalid image files).

## [14.11.21] - 2026-07-20
### Added
- **Combat Experience Tracker**: Localized all hard-coded English text in the UI to support community translations.
- **Force Compendium Browser**: Added a new setting "Allow Shift-Click to Bypass" (enabled by default) that allows players to hold Shift while clicking the Compendium tab to access the standard Foundry compendium sidebar instead of the forced browser.

### Fixed
- **Combat Experience Tracker**: Fixed a bug where multiple logged-in GMs would process the XP summary simultaneously, resulting in duplicate chat messages and potential flag data corruption.
- **Combat Experience Tracker**: Fixed a data corruption issue when saving Player Characters (caused by UUID dots expanding as nested object paths via Foundry's `setFlag`). PCs are now safely tracked by combatant ID.
- **Combat Experience Tracker**: Fixed race conditions during concurrent combatant additions (e.g. dragging a group of enemies to the tracker) by upgrading flag tracking to use atomic deep-key `combat.update()` payload merges.

## [14.11.20] - 2026-07-20
### Fixed
- **Cursor Hints**: Fixed an issue where cursor hints could get permanently "stuck" on the screen. This happened when releasing a modifier key while simultaneously holding another modifier key (causing the keyup event to be ignored due to strict modifier matching), or when another module intercepted the keyup event. The module now intercepts keyboard events during the capture phase and bypasses strict modifier matching for key releases.

## [14.11.19] - 2026-07-20
### Added
- **Player Damage Prompt**: New "Structured" layout option (now the default) that displays damage as a per-type breakdown table with columns for raw damage, trait modifiers (Resist ½, Immune, Vuln ×2, flat adjustments), and effective damage. The original text-based layout is preserved as "Classic" and selectable via the new "Damage Prompt Layout" setting.
- **Player Damage Prompt**: All user-facing strings are now localized via `lang/en.json`, enabling community translations for non-English groups.
- **Player Damage Prompt**: Added an "Undo" button that appears alongside the "Damage Applied" button after applying damage or healing. Clicking it restores the exact amount of hit points and temporary hit points that were lost or gained, and resets the prompt so it can be applied again.

### Changed
- **Player Damage Prompt**: Moved all inline styles from the HTML template to CSS classes (`.nd5t-prompt-content`, `.nd5t-prompt-buttons`) for better themability and maintainability.
- **Player Damage Prompt**: Refactored CSS — extracted shared properties from `.nd5t-crit-text` and `.nd5t-graze-text` into a common `.nd5t-status-badge` base class, and added hover/active transition states to the Apply Damage buttons.

### Fixed
- **Player Damage Prompt**: Fixed the "Damage Applied" button state not syncing across clients. When a player clicked Apply Damage, the GM's copy of the chat card stayed active (and vice versa).

## [14.11.18] - 2026-07-17
### Changed
- **Player Damage Prompt**: Optimized stale damage prompt cleanup loop by using direct flag property access instead of `getFlag()`, and capping the scan to the most recent 1000 chat messages. This significantly reduces CPU overhead per chat message in worlds with extremely large chat logs.

## [14.11.17] - 2026-07-17
### Added
- **Player Damage Prompt**: Added a new "Wait for Dice So Nice" setting (disabled by default). When enabled alongside the Dice So Nice module, damage prompt whispers are delayed until the 3D dice animation finishes, ensuring the prompt doesn't spoil the outcome before the dice have landed.

## [14.11.16] - 2026-07-17
### Fixed
- **Player Damage Prompt**: Fixed NaN damage displayed in the prompt when the target has active effects that modify damage by type (e.g. Lightning resistance -1 from an active effect). The DnD5e system stores `dm.amount` values as formula strings (not numbers), and the module was performing string concatenation instead of arithmetic. The module now resolves these formulas using the system's `simplifyBonus` utility, matching the system's own `calculateDamage` logic.
- **Player Damage Prompt**: Fixed healing modifications from active effects (e.g. `dm.amount.healing = -2`) being ignored in the damage preview. Healing types were previously skipped entirely during trait calculations, causing the preview to show the unmodified healing amount even though `applyDamage` correctly applied the modification.
- **Player Damage Prompt**: Added support for the "ALL" damage modification that applies to all non-healing damage types, and for positive damage modifications (bonuses), both of which were previously ignored. The preview calculation now correctly mirrors the system's modification order and sign-flip prevention logic.

## [14.11.15] - 2026-07-17
### Fixed
- **Player Damage Prompt**: Fixed damage prompts for unlinked tokens displaying the base actor name (e.g. "Wormcaller") instead of the token's custom name (e.g. "Wormcaller B") in both the message body text and the chat speaker header. The DnD5e system stores target UUIDs pointing to synthetic actors (`Scene.x.Token.y.Actor.z`), which `fromUuidSync` resolves to the Actor rather than the TokenDocument. A new `_resolveTarget` helper now extracts the Token UUID prefix to correctly resolve the TokenDocument and its name.

### Changed
- **Player Damage Prompt**: The "Apply Damage (Full)" button text will now dynamically omit the "(Full)" suffix if there is no accompanying "(Half)" damage button, matching the cleaner aesthetic of regular attack damage prompts.

## [14.11.14] - 2026-07-16
### Fixed
- **Auto Status at 0 HP**: Added per-actor debounce to prevent conflicting status changes when HP changes rapidly (e.g. damage followed by instant healing within the 250ms deferral window). Only the latest HP state is now processed, matching the debounce pattern already used in Auto-End Concentration.
- **Auto Status at 0 HP**: Added a guard against actors that are deleted during the 250ms deferral window. Previously, if a token was removed from the scene between the `updateActor` hook and the deferred callback, the module could throw errors trying to operate on a destroyed document.
- **Auto Status at 0 HP**: Added a guard to skip actors with 0 max HP (vehicles, objects, or constructs with no HP pool). These actors were falsely triggering the 0 HP status condition on every HP update.

### Changed
- **Player Damage Prompt**: Damage prompt chat messages are now always authored by the first active GM if one is connected. If no GM is connected, the module falls back to allowing the player who triggered the roll to author the chat message.
- **Player Damage Prompt**: Non-attack damage prompts (e.g. Saving Throws) are now smarter and will only display the "Apply Half Damage" button if the activity actually specifies that it does half damage on a save.
- **Cursor Keyboard Hints**: Optimized the `mousemove` handler to skip updating the cursor hint element's position when no modifier hints are visible. Since `mousemove` fires at 60+ Hz but modifiers are only held briefly, this eliminates the vast majority of unnecessary style writes.

## [14.11.13] - 2026-07-16
### Fixed
- **Player Damage Prompt**: Fixed resistance/vulnerability/immunity trait text appearing as bright/unreadable text in Foundry V14 dark mode. The inline style used `--color-text-dark-secondary`, which resolves to a light color in dark themes. Reverted to the theme-agnostic `.nd5t-trait-info` CSS class which uses opacity for subdued text that works in both light and dark modes.
- **Player Damage Prompt**: Fixed the chat message speaker and body text sometimes displaying the actor name instead of the token name. The token document's name now takes priority over the target name from DnD5e flags, and the speaker alias is explicitly overridden after `getSpeaker` to always use the token name.

## [14.11.12] - 2026-07-15
### Changed
- **Player Damage Prompt**: The newly added Non-Attack Damage Prompts feature now explicitly supports healing and temporary hit points. Prompts for these rolls will correctly skip resistance calculations and display dynamically updated wording (e.g. "Apply Healing" or "Apply Temp HP") and icons instead of generic damage text.

## [14.11.11] - 2026-07-14
### Added
- **Player Damage Prompt**: Expanded player damage prompts to also trigger for damage rolls from non-attack activities (like saving throws). For damage rolls from save activities, the prompt now includes two buttons: "Apply Full Damage" and "Apply Half Damage". This behavior is enabled by default and controlled by the new "Non-Attack Damage Prompts" setting.

## [14.11.10] - 2026-07-10
### Fixed
- **Player Damage Prompt**: Fixed the chat message text and speaker erroneously using the actor's name instead of the token's name. Unlinked tokens with custom names now correctly display their token name in the damage prompt.
- **Player Damage Prompt**: Fixed the "Apply Damage" button not being marked as inactive on the other client after one side applied the damage. The previous approach persisted the `disabled` HTML attribute in the chat message content, but Foundry's HTML sanitiser strips it during rendering, causing the button to reappear as active on re-render. The button state is now tracked via a chat message flag (`damageApplied`) which survives sanitisation and reliably disables the button on all clients.

### Changed
- **Player Damage Prompt**: Stale damage prompt cleanup now deletes all damage prompts older than 10 minutes, regardless of whisper recipients. Previously it only cleaned prompts that shared at least one recipient with the new prompt.

## [14.11.9] - 2026-07-09
### Fixed
- **Auto Status at 0 HP**: Fixed status conditions not displaying as a big overlay icon on tokens. When the DnD5e system (or another module) applies the status effect first — without the `flags.core.overlay` flag — the module previously saw "already has status" and skipped it. It now detects the missing overlay flag and upgrades the existing ActiveEffect so the big icon correctly appears on the token.

## [14.11.8] - 2026-07-08
### Added
- **Player Damage Prompt**: Stale damage prompt cleanup — whenever a new damage prompt is posted, any damage prompt chat messages older than 10 minutes that were whispered to the same recipient(s) are automatically deleted. This prevents chat clutter from accumulating during long combat sessions.

## [14.11.7] - 2026-07-07
### Fixed
- **Player Damage Prompt**: Fixed Graze weapon mastery prompts still not triggering on missed attacks. Two issues were resolved: (1) the weapon item resolution was looking for the non-existent flag path `flags.dnd5e.use.itemUuid` instead of the correct `flags.dnd5e.item.uuid`, and (2) the mastery eligibility check was manually looking up `actor.system.traits.weaponMastery` — a path that doesn't exist in DnD5e 5.2+. The Graze check now reads `flags.dnd5e.roll.mastery` from the attack roll message, which the DnD5e system already sets authoritatively when the actor has mastered the weapon.

## [14.11.6] - 2026-07-07
### Fixed
- **Player Damage Prompt**: Fixed Graze weapon mastery prompts not triggering on missed attacks. The Graze check was previously nested inside the damage roll handler, but on a miss no damage is rolled, so the handler never fired. Graze is now detected via a separate attack roll handler that triggers independently when an attack misses its target.
- **Combat Experience Tracker**: Fixed XP being undercounted when multiple unlinked tokens of the same NPC actor are in combat. Previously, NPCs were deduplicated by `actor.uuid`, which is shared across all unlinked tokens of the same base actor. NPCs are now keyed by combatant ID so each individual combatant is counted separately (e.g. 4 Goblins now correctly contribute 4× their XP).
- **Combat Experience Tracker**: Fixed potential XSS vulnerability — NPC and PC names in the XP summary chat message are now HTML-escaped via `foundry.utils.escapeHTML`.
- **Combat Experience Tracker**: Added a defensive GM permission check to the "Distribute XP" button click handler.

## [14.11.5] - 2026-06-26
### Changed
- **Player Damage Prompt**: The damage prompt now uses the token name instead of the actor name, so unlinked tokens with custom names display correctly.
- **Player Damage Prompt**: Refined bold formatting in the damage prompt. When no trait modifiers apply, the damage breakdown is bolded (e.g. "hit for **10 Bludgeoning damage**"). When resistances, immunities, or vulnerabilities modify the damage, the breakdown is shown in plain text and only the effective damage after calculation is bolded (e.g. "hit for 10 Bludgeoning damage. … effective damage is **5**").
- **Player Damage Prompt**: Removed bold from the target name and attack roll total in the hit description for a cleaner appearance. GRAZED and CRITICALLY HIT labels retain their colored styling.

## [14.11.4] - 2026-06-25
### Added
- **Auto-End Rage**: Added a new feature that automatically ends a Barbarian's Rage effect when the token becomes incapacitated, unconscious, dead, paralyzed, petrified, or stunned. Identifies rage by the source item's identifier (`system.identifier === "rage"`) or by effect name (case-insensitive match on "Rage" / "Raging"). Posts a chat notification when rage is ended. Enabled by default; can be toggled independently from Auto-End Concentration.

## [14.11.3] - 2026-06-25
### Fixed
- **Auto-End Concentration**: Removed dead code path that called the non-existent `actor.endConcentration()` API method. Concentration effects are now identified and removed using the official `actor.concentration.effects` getter (dnd5e 5.2+).
- **Auto-End Concentration**: Fixed missing `disabled` check — a disabled ActiveEffect no longer incorrectly triggers concentration removal.
- **Auto-End Concentration**: Fixed potential race condition when multiple concentration-breaking statuses are applied simultaneously (e.g. both stunned and incapacitated). The feature now debounces per actor to avoid duplicate processing.
- **Auto-End Concentration**: Fixed potential XSS vector in the chat notification by escaping actor and effect names.
- **Auto-End Concentration**: The `updateActiveEffect` hook now only triggers when an effect transitions from disabled to active, instead of on every update.

### Changed
- **Auto-End Concentration**: Chat notification is now localized via `lang/en.json` instead of using hardcoded English text.
- **Auto-End Concentration**: Increased processing delay from 100ms to 250ms for consistency with other module features and better reliability on slower systems.
- **Auto-End Concentration**: Removed leftover debug logging that serialized all actor effects on every non-concentrating status change.

## [14.11.2] - 2026-06-24
### Added
- **Auto-End Concentration**: The module now posts a chat message informing everyone when an actor's concentration is automatically broken, including the name of the effect that caused it.

## [14.11.1] - 2026-06-24
### Fixed
- **Auto-End Concentration**: Fixed an issue where the feature would fail silently and not end concentration when applying new conditions (like Incapacitated) due to a hook argument mismatch.

## [14.11.0] - 2026-06-23
### Added
- **Auto-End Concentration**: Added a new feature that automatically ends all concentration effects from a token when it receives the incapacitated, unconscious, dead, paralyzed, petrified, or stunned condition.

## [14.10.4] - 2026-06-23
### Changed
- **Player Damage Prompt**: Removed the filter that prevented GM damage prompts from appearing when one NPC hits another NPC. GMs will now receive damage prompts for NPC vs NPC attacks if the GM Damage Prompt setting is enabled.

## [14.10.3] - 2026-06-20
### Added
- **Player Damage Prompt**: Added support for the **Graze** weapon mastery. When an attack misses a target, the module now checks if the weapon has the Graze mastery and if the attacker has mastered that weapon. If both conditions are met, a damage prompt is sent for the Graze damage (ability modifier only, same damage type as the weapon). Resistances, immunities, and vulnerabilities are correctly applied to the Graze damage. Works for both player and NPC attackers, but requires the full mastery check (weapon must have `graze` mastery and the actor must have the weapon in their mastered weapons list).

## [14.10.2] - 2026-06-20
### Fixed
- **Combat Experience Tracker**: Fixed tracking state being lost if the GM reloads their browser tab mid-combat. Combatant data is now persisted to the Combat document via flags, so the XP summary is correctly posted when the combat ends even after a reload.

## [14.10.1] - 2026-06-09
### Fixed
- **Player Damage Prompt**: Fixed attacks with split damage types (e.g. a Flame Tongue sword dealing both slashing and fire damage) being incorrectly attributed to a single damage type. The prompt now correctly splits damage by type using term-level flavor annotations — matching the DnD5e system's own `aggregateDamageRolls` logic — so that resistances, immunities, and vulnerabilities are applied to the correct damage portions.
- **Player Damage Prompt**: Fixed the damage type resolver prioritising the unordered `types` Set over the resolved singular `type`, which could report the wrong damage type for weapons with multiple selectable types.

## [14.10.0] 2026-06-08
### Added
- **Combat Experience Tracker**: At the end of a combat encounter, whispers a summary to the GM tallying the XP of all hostile NPCs that were involved in the combat. Includes a one-click button to distribute XP evenly (rounded down) to all participating player characters. Tracks combatants added mid-combat. Disabled by default.
- **Player Damage Prompt**: When an attack hits a targeted token, whispers a chat message with the damage breakdown (accounting for damage reductions, resistances, vulnerabilities, and immunities per the 2024 rules order), the effective damage total, and a one-click button to apply the damage. Critical hits are shown as "CRITICALLY HIT" (without the attack roll total). The button state syncs across all clients via socket. Disabled by default.
  - Sub-setting: **Damage Prompt Whisper Visibility** — controls whether the whisper is sent to both GM & Player or Player Only.
  - Sub-setting: **GM Damage Prompt for Player Attacks** — when enabled, also whispers a damage prompt to the GM when a player's attack hits an NPC. Disabled by default.
- **Disable Underground Token Hiding**: Prevents tokens with negative elevation from disappearing behind the scene background. By default, Foundry renders tokens below elevation 0 behind the background layer, making them invisible. This tweak keeps them visible while preserving the actual elevation value. Compatible with Foundry V14 native Scene Levels. Disabled by default.

## [14.9.1] - 2026-05-28
### Fixed
- **Auto-Rotate Prone Tokens**: Fixed tokens not visually rotating when prone. The module now disables `lockRotation` when applying prone rotation.

### Changed
- **Auto-Rotate Prone Tokens**: Simplified rotation logic — tokens are now set to an absolute 90° when prone and 0° when un-proned, replacing the previous approach of storing and restoring original rotation values.
- **Auto-Rotate Prone Tokens**: Token rotation updates are now batched via `scene.updateEmbeddedDocuments` instead of sequential per-token updates for improved reliability.
- Added a one-time migration to clean up stale `originalRotation` flags from token documents left by the previous implementation.

## [14.9.0] - 2026-05-23
### Added
- **Clean Sheet Window Titles**: Removes the verbose type prefix (e.g. "Non Player Character:") from document sheet window titles, showing just the document name. Applies to all document sheets (Actors, Items, Journals, etc.). Features a sub-setting to control format (Name Only, Type: Name, Name (Type)). 

## [14.8.4] - 2026-05-08
### Fixed
- Minor updates and fixes to module configuration.

## [14.8.3] - 2026-05-07
### Changed
- **Token Resizer**: Reverted the V14 Active Effect approach and implemented a more robust sizing method that properly handles DnD5e dynamic rings. Added logic to save and restore base texture scales, preventing compounding scale errors when resizing small tokens without dynamic rings, and explicitly forces canvas mesh refreshes to ensure immediate visual updates.

## [14.8.2] - 2026-05-06
### Fixed
- **Cursor Keyboard Hints**: Improved modifier key matching logic to correctly handle keys like Shift, Control, Alt, and Meta when pressed individually or in combinations.

## [14.8.1] - 2026-05-05
### Changed
- **Token Resizer**: Updated for Foundry V14 compatibility. The tool now uses the V14 `tokenOverrides` framework via Active Effects instead of directly updating the token document dimensions.

## [14.7] - 2026-05-04
### Added
- **Auto-Open Damage Dialog for Saves**: Automatically opens the damage roll dialog when a Save-type activity that includes damage is used. (Automatically disabled if midi-qol is active).
- **Auto-Apply Status at 0 HP**: Automatically applies a configurable status condition (Unconscious/Dead) when tokens drop to 0 HP, and supports marking them defeated in the combat tracker.
- **Healing Roll Context Menu**: Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat messages.
### Changed
- **Snap Templates to Grid Intersections**: Added the ability to hold the **Shift** key while dragging or placing a template to temporarily bypass grid snapping and place freely.
- **Legendary Action Placeholders**: Added a sub-setting (`↳ Show Placeholders to Players`) to control whether the placeholder turns are visible to players or only to the GM.

## [14.6] & [14.5] - 2026-04-27
### Added
- Added MIT `LICENSE`.
### Changed
- Various README documentation updates.

## [14.4] - 2026-04-27
### Added
- **Snap Templates to Grid Intersections**: Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement.

## [14.3] & [14.3.1] - 2026-04-12
### Added
- **Legendary Action Placeholders**: Inserts placeholder turns in the initiative tracker after each player character and friendly creature to help track legendary action usage.
- Added `.gitignore`.
### Removed
- Removed the experimental Item Delete Check feature.
- Removed `module.zip` from source tracking.

## [14.2] - 2026-03-23
### Added
- Added `lang/en.json`, `lang/ja.json`, and `lang/pl.json` base translation files.
- Added (experimental) Item Delete Check feature and templates.

## [14.1] & [14.1.1] - 2026-03-23
### Added
- **Blood Drop Bloodied Icon**: Replaces the default DnD5e "bloodied" condition icon with a red blood drop icon.
- **Sidebar Multi-line Names**: Allows long document names in the right sidebar to wrap onto multiple lines.
### Removed
- Removed unused `ja.json` and `pl.json` translation files.
- Removed item rarity colors feature.

## [13.0.x] - 2026-03-21
### Added
- Initial release of Nik's DnD5e Tweaks consolidating multiple quality-of-life tweaks into a single module.
- **Features included**:
  - Sync Browser Tab Title
  - Cursor Keyboard Hints
  - Actor Directory Disposition Dots
  - Auto-Rotate Prone Tokens
  - Token Resizer Tool
  - Auto-Clear Movement History
  - Prompt for Death Saves
  - Force Compendium Browser