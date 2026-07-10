# Changelog

All notable changes to this project will be documented in this file.

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