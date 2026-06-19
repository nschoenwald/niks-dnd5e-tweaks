# Changelog

All notable changes to this project will be documented in this file.

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