# Nik's DnD5e Tweaks

A consolidated collection of small quality-of-life tweaks for Foundry VTT and the DnD5e system. This module combines several smaller tweaks and scripts into a single, unified package with a comprehensive set of configurable options.

---

## Compatibility

| | Minimum | Verified |
|---|---|---|
| **Foundry VTT** | V13 | V14 |
| **DnD5e System** | 5.2.0 | 5.3.x |

See below for compatibility with other modules (especially midi-qol).
---

## Features

All features can be toggled on or off individually within the Foundry VTT Module Settings menu. 

### Group 1: User Interface & Visuals
* **Sync Browser Tab Title**: Keeps the browser tab title dynamically in sync with the name of the scene the client is currently viewing.
* **Cursor Keyboard Hints**: Displays small floating icons near the mouse cursor when modifier keys configured in the DnD5e system (such as Skip Dialog, Advantage, or Disadvantage) are held down.
* **Actor Directory Disposition Dots**: Adds a colored dot next to each actor name in the Actors sidebar to indicate their default token disposition (Friendly, Neutral, Hostile, or Secret).
* **Blood Drop Bloodied Icon**: Replaces the default DnD5e "bloodied" condition icon with a red blood drop icon.
* **Sidebar Multi-line Names**: Allows long document names in the right sidebar (Actors, Items, Scenes, etc.) to wrap onto multiple lines instead of being cut off.
* **Clean Sheet Window Titles**: Removes the verbose type prefix (e.g. "Non Player Character:") from document sheet window titles, showing just the document name. Applies to all document sheets (Actors, Items, Journals, etc.). Especially useful when detaching windows in V14, where the prefix otherwise consumes all visible space in the OS taskbar.
  * *↳ Sheet Title Format* — controls how titles are displayed (choices: **Name Only** (default), Type: Name, Name (Type)).
* **Toolbar Limitation**: When the number of buttons in a given toolbar (such as Scene Controls) exceeds a configurable value, turns the toolbar scrollable and limits the displayed buttons to that number. Does not apply to the macro hotbar.
  * *↳ Max Displayed Toolbar Buttons* — controls the maximum number of buttons displayed before turning scrollable (default: **12**).


### Group 2: Canvas & Tokens

* **Auto-Rotate Prone / Unconscious / Dead Tokens**: Automatically rotates tokens 90° clockwise when the Prone, Unconscious, or Dead condition is applied, and rotates them back when all rotation-triggering conditions are removed.
* **Token Resizer Tool**: Adds a control button to the Token tools menu (GM-only) for quickly resizing selected tokens to standard 5e creature sizes (Tiny, Small, Medium, Large, Huge, Gargantuan). In Foundry V13, this modifies the token dimensions directly. In Foundry V14+, this applies an Active Effect using the new V14 `tokenOverrides` framework, allowing sizes to be dynamically toggled and managed alongside other effects.
* **Snap Templates to Grid Intersections**: Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement. Hold **Shift** while placing to temporarily override and place freely. Cones and rays are not affected. Compatible with both Foundry V13 (MeasuredTemplates) and V14 (Regions).
* **Auto-Clear Movement History**: Automatically clears token movement history trails for all combatants at the start of each combat turn and when combat starts (GM client only).
* **Disable Underground Token Hiding**: Prevents tokens with negative elevation from disappearing behind the scene background. By default, Foundry renders tokens below elevation 0 behind the background layer, making them invisible. This tweak keeps them visible while preserving the actual elevation value. Compatible with Foundry V14 native Scene Levels. Disabled by default.
* **Item/Spell/Feature Add: Choice Dialog**: When clicking any '+' button (page-level or sub-category section header) on character sheets in the Items, Spells, or Features tab, allows you to choose between creating a new document or directly opening the Compendium Browser. Defaults to opening the Compendium Browser (pre-filtered by class and level for spells, feats for features, and physical items for items). Compatible with standard DnD5e sheets (V1 & V2) and Tidy 5e Sheets (Classic & Quadrone). Hold **Shift** while clicking the '+' button to bypass the choice dialog and proceed directly with document creation. Enabled by default.

### Group 3: Automation & QOL Tasks

* **Auto-Add Tokens to Combat**: Automatically adds new tokens to the active combat encounter and rolls their initiative when created or dragged to the canvas during combat. Enabled by default.
* **Auto-Apply Status at 0 HP**: Automatically applies a configurable status condition overlay to tokens when they reach 0 HP, and removes it when they are healed. Also supports marking tokens as defeated in the combat tracker or removing them from combat entirely. All actions are configurable separately for player-owned and GM-owned (NPC) tokens. Works well with Auto-Rotate Prone / Unconscious / Dead Tokens — if both features are enabled, tokens that drop to 0 HP will be rotated automatically via the applied status.
  * *↳ Player Token Status at 0 HP* — defaults to **Unconscious** (choices: Unconscious, Dead, None).
  * *↳ NPC Token Status at 0 HP* — defaults to **Dead** (choices: Unconscious, Dead, None).
  * *↳ Player Token Combat Action at 0 HP* — defaults to **None** (choices: Mark Defeated, Remove from Combat, None).
  * *↳ NPC Token Combat Action at 0 HP* — defaults to **Mark Defeated** (choices: Mark Defeated, Remove from Combat, None).
* **Prompt for Death Saves**: When a player character starts their combat turn at 0 HP, automatically opens the Death Saving Throw roll dialog directly for the owning player. If the player is not connected, the GM receives a fallback whispered chat card with a clickable button to roll on their behalf.
* **Auto-Open Damage Dialog for Saves**: Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used. This mirrors the built-in behaviour of Attack activities, which already auto-open their attack roll dialog. Automatically disabled when midi-qol is active to avoid duplicate rolls.
* **Player Damage Prompt**: When an attack hits a targeted token, whispers a chat message with the damage breakdown (accounting for damage reductions, resistances, vulnerabilities, and immunities per the 2024 rules order), the effective damage total, and a button to apply the damage. The button state syncs across all clients. Critical hits are indicated with "CRITICALLY HIT" in the message. Also supports the **Graze** weapon mastery — when an attack misses but the weapon has the Graze mastery and the attacker has mastered that weapon, a damage prompt is sent for the Graze damage (ability modifier only). Disabled by default.
  * *↳ Damage Prompt Whisper Visibility* — controls who receives the whisper when a player token is hit (choices: **GM & Player** (default), Player Only).
  * *↳ GM Damage Prompt for Player Attacks* — when a player rolls attack damage against an NPC token that was hit, whispers a damage prompt to the GM. Disabled by default.
  * *↳ Non-Attack Damage Prompts* — when enabled, damage prompts are also sent for damage rolls originating from non-attack activities (like saving throws or utility abilities). For save activities, the prompt includes both Full and Half damage buttons. Also fully supports healing and temporary hit point rolls, displaying "Apply Healing" or "Apply Temp HP" with appropriate icons. Enabled by default.
  * *↳ Damage Prompt Layout* — controls the visual layout of damage prompts. **Structured** (default) shows a per-type breakdown table with raw damage, trait modifiers, and effective damage. **Classic** shows the original text-based layout.
  * *↳ Wait for Dice So Nice* — when enabled alongside the Dice So Nice module, damage prompt whispers are delayed until the 3D dice animation finishes. Disabled by default.
  * *↳ Suppress Damage Prompts (Player)* — a per-user setting allowing individual players to hide damage prompt whispers from their chat log.
* **Self Effect Application Prompt**: When an actor uses an ability that has Active Effects targeting "Self" (e.g. Rage, Divine Favor, Mirror Image) or targets themselves manually when using an ability that can target other creatures (e.g. Haste, Invisibility, Fly, Cure Wounds, Bless, Shield of Faith, Sanctuary), whispers a chat card to the actor's owning player and the GM. The card lists each applicable effect with its icon and a one-click **Apply** button. After applying an effect, the button transitions to "Effect Applied ✓" and an **Undo** button appears to disable the effect on the actor if needed. Button state syncs across all clients, matching the same apply/undo pattern as the Player Damage Prompt.
  * *↳ Always Prompt Features* — a text input field for a comma-separated list of feature or item names (case-insensitive, default: `Mage Armor`). When these features are used and have an active effect attached, the self-effect application prompt will be posted even if they were not self-targeted.
* **Healing Roll Context Menu**: Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat messages. The DnD5e system only shows these options for damage rolls by default.
* **Legendary Action Placeholders**: When a combat begins that includes a creature with legendary actions, inserts placeholder turns in the initiative tracker after each player character and friendly creature to help track legendary action usage.
  * *↳ Show Placeholders to Players* — by default, placeholder turns are hidden from players. Enable this to make them visible.
  * *↳ Placeholder Icon* — file picker to choose a custom icon for placeholder turns (defaults to `icons/svg/combat.svg`).
* **Combat Experience Tracker**: At the end of a combat encounter, whispers a summary to the GM tallying the XP of all hostile NPCs that were involved, with a one-click button to distribute XP evenly (rounded down) to all participating player characters. Tracks combatants added mid-combat. Disabled by default.
* **Auto-Roll Concentration Saves**: Automatically rolls a concentration saving throw when a concentrating token takes damage, following official DnD5e rules (DC 10 or half damage taken, whichever is higher). All native system mechanics are respected — including the actor's configured concentration ability, concentration bonuses, and intrinsic advantage/disadvantage (e.g. War Caster, Eldritch Mind). The roll appears in chat after the system's own concentration prompt. An **"End Concentration"** button is appended to every concentration roll card (including manually initiated ones) so GMs and owning players can break concentration with a single click. Also respects the dnd5e system's global "Disable Concentration Tracking" setting.
  * *↳ Fast-Forward Concentration Rolls* — controls which actors skip the roll dialog and roll immediately. Choices: **NPCs Only** (default), All Actors, Players Only, Never (always show dialog).
  * *↳ Auto-End Concentration on Save Failure* — when enabled, concentration is ended automatically when the saving throw fails. When disabled (default), the "End Concentration" button on the chat card must be clicked manually.
* **Mage Slayer: Concentration Disadvantage**: When an attacker with the Mage Slayer feat deals damage to a concentrating creature, the concentration saving throw is automatically rolled with Disadvantage. If the defender has intrinsic Advantage on concentration saves (e.g. War Caster, Eldritch Mind), the two cancel to a normal roll per 2024 PHB rules. Attacker detection uses a 3-tier check: official `mage-slayer` item identifier, legacy `dnd5e.mageSlayer` actor flag, or item name match for homebrew.
* **Auto-End Concentration**: Automatically ends all concentration effects from a token when it gains a condition that prevents maintaining concentration (Incapacitated, Unconscious, Dead, Paralyzed, Petrified, or Stunned). Works alongside the DnD5e system's own concentration tracking.
* **Auto-End Class Features**: Automatically ends class feature active effects — including Barbarian's **Rage**, Sea Druid's **Wrath of the Sea** (`wrath-of-the-sea`), and Star Druid's **Starry Form** (`starry-form`) — when the token gains an incapacitating condition. Respects level 15+ **Persistent Rage**: for Barbarians level 15 or higher, Rage only ends early on the Unconscious condition (not on Incapacitated/Stunned/Paralyzed/Petrified). Features are identified by source item/activity identifiers or effect name fallbacks.

### Group 4: Restrictions & Rules

* **Force Compendium Browser**: Forces non-GM users to open the DnD5e Compendium Browser when they click the Compendium sidebar tab, instead of showing the default pack list.
  * *↳ Allow Shift-Click to Bypass* — when enabled, players can hold **Shift** while clicking the Compendium tab to access the standard Foundry compendium sidebar instead of the forced browser. Enabled by default.



### Utilities

* **Debug Mode**: Enables verbose debug logging in the browser console for all module features. Useful for troubleshooting issues.

---

## Module Compatibility

This module includes automatic compatibility checks for other popular modules. No manual configuration is needed. Conflicting features are detected and disabled at startup.

### midi-qol

[midi-qol](https://gitlab.com/tposney/midi-qol) provides its own comprehensive combat automation workflow, including auto-rolling damage and applying saves. The following features include **smart automatic compatibility checks** with midi-qol settings to avoid duplicate actions or conflicting behaviour:

| Feature | Behavior with midi-qol |
|---|---|
| **Auto-Open Damage Dialog for Saves** | **Automatically disabled** when midi-qol is active, as midi-qol manages activity damage workflows. |
| **Auto-Roll Concentration Saves** | **Automatically bypassed** if midi-qol is configured to handle concentration checks (`doConcentrationCheck !== "none"`). The "End Concentration" button continues to be injected into concentration check roll cards. |
| **Self Effect Application** | **Automatically bypassed** if midi-qol is configured to auto-apply item active effects (`autoItemEffects !== "off"`). Also filters out any effects already active on the target actor. |
| **Player Damage Prompt** | **Automatically bypassed** if midi-qol is configured to auto-apply damage (`autoApplyDamage` mode contains "yes"). |
| **Mage Slayer Concentration** | Fully compatible with midi-qol damage application workflows. |

Other features in this module (Auto-Apply Status at 0 HP, Death Save Prompt, Healing Context Menu, Auto-End Class Features, etc.) coexist safely with midi-qol — using idempotent checks to avoid duplicating effects or providing purely additive UI enhancements that do not interfere with midi-qol.

### Tidy 5e Sheets

[Tidy 5e Sheets](https://github.com/kgar/foundry-vtt-tidy-5e-sheets) is fully supported. Features that interact with character sheets (such as the **Item/Spell/Feature Add: Choice Dialog**) natively integrate with Tidy 5e Sheets (both Classic and Quadrone layouts) alongside standard DnD5e sheets (V1 & V2).

---

## Other Modules by Nik

### ⚔️ Combat & Token Tools
* **[Nik's Token Tags](https://github.com/nschoenwald/niks-token-tags)** – Automatically numbers duplicate combatant NPCs (A, B, C…) with color-coded letter overlays.
* **[Nik's Shared NPC Initiative](https://github.com/nschoenwald/niks-shared-npc-initiative)** – Groups NPCs of the same type in combat so they share a single initiative roll.
* **[Nik's Movement Control](https://github.com/nschoenwald/niks-movement-control)** – GM controls to toggle player movement and automatically restrict/allow movement on combat start and end.
* **[Nik's Tiny Change Logs](https://github.com/nschoenwald/niks-tiny-changelogs)** – Compact, single-line chat messages logging token HP and Temp HP changes.

### 🎲 Visuals & Display
* **[Nik's Dynamic Roll Area](https://github.com/nschoenwald/niks-dynamic-roll-area)** – Dynamically restricts Dice So Nice 3D dice rolling area to exclude the sidebar / chat log across all screen resolutions and window sizes.

### ⚙️ Utilities & System Management
* **[Nik's Settings Locks](https://github.com/nschoenwald/niks-settings-locks)** – Soft-lock and hard-lock client settings and keybindings across all connected players.
* **[Nik's Compendium Search Tweaks](https://github.com/nschoenwald/niks-compendium-search-tweaks)** – Configure which compendium packs are included or excluded from native sidebar search.
* **[Nik's Show & Tell](https://github.com/nschoenwald/niks-show-and-tell)** – Share popout images to chat and paste image files directly into chat messages.
* **[Nik's Zoom / Pan Options](https://github.com/nschoenwald/niks-zoom-pan-options)** – Touchpad and scroll wheel pan/zoom controls and canvas navigation enhancements.
