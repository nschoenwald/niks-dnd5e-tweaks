# Nik's DnD5e Tweaks

A consolidated collection of small quality-of-life tweaks for Foundry VTT and the DnD5e system. This module combines several smaller tweaks and scripts into a single, unified package with a comprehensive set of configurable options.

---

## Compatibility

| | Minimum | Verified |
|---|---|---|
| **Foundry VTT** | V13 | V14 |
| **DnD5e System** | 5.2.0 | 5.3.x |

---

## Features

All features can be toggled on or off individually within the Foundry VTT Module Settings menu. 

### Group 1: User Interface & Visuals
* **Sync Browser Tab Title**: Keeps the browser tab title dynamically in sync with the name of the scene the client is currently viewing.
* **Cursor Keyboard Hints**: Displays small floating icons near the mouse cursor when modifier keys configured in the DnD5e system (such as Skip Dialog, Advantage, or Disadvantage) are held down.
* **Actor Directory Disposition Dots**: Adds a colored dot next to each actor name in the Actors sidebar to indicate their default token disposition (Friendly, Neutral, Hostile, or Secret).
* **Blood Drop Bloodied Icon**: Replaces the default DnD5e "bloodied" condition icon with a red blood drop icon.
* **Sidebar Multi-line Names**: Allows long document names in the right sidebar (Actors, Items, Scenes, etc.) to wrap onto multiple lines instead of being cut off.

### Group 2: Canvas & Tokens

* **Auto-Rotate Prone Tokens**: Automatically rotates tokens 90° clockwise when the Prone condition is applied, and rotates them back when it is removed.
* **Token Resizer Tool**: Adds a control button to the Token tools menu (GM-only) for quickly resizing selected tokens to standard 5e creature sizes (Tiny, Small, Medium, Large, Huge, Gargantuan).
* **Snap Templates to Grid Intersections**: Forces circle and square/cube spell templates to snap to grid intersections instead of cell centers during placement. Cones and rays are not affected. Compatible with both Foundry V13 (MeasuredTemplates) and V14 (Regions).
* **Auto-Clear Movement History**: Automatically clears token movement history trails at the start of each combat turn (GM client only). Includes sub-settings to control exactly when clearing occurs (e.g. at the start of a turn, on combat start).

### Group 3: Automation & QOL Tasks

* **Auto-Apply Status at 0 HP**: Automatically applies a configurable status condition overlay to tokens when they reach 0 HP, and removes it when they are healed. Also supports marking tokens as defeated in the combat tracker or removing them from combat entirely. All actions are configurable separately for player-owned and GM-owned (NPC) tokens.
  * *↳ Player Token Status at 0 HP* — defaults to **Unconscious** (choices: Unconscious, Dead, None).
  * *↳ NPC Token Status at 0 HP* — defaults to **Dead** (choices: Unconscious, Dead, None).
  * *↳ Player Token Combat Action at 0 HP* — defaults to **None** (choices: Mark Defeated, Remove from Combat, None).
  * *↳ NPC Token Combat Action at 0 HP* — defaults to **Mark Defeated** (choices: Mark Defeated, Remove from Combat, None).
* **Prompt for Death Saves**: When a player character starts their combat turn at 0 HP, automatically whispers a chat message with a Death Saving Throw button to the owning player and the GM.
* **Auto-Open Damage Dialog for Saves**: Automatically opens the damage roll dialog when a Save-type activity that includes damage (e.g. Fireball) is used. This mirrors the built-in behaviour of Attack activities, which already auto-open their attack roll dialog. Automatically disabled when midi-qol is active to avoid duplicate rolls.
* **Healing Roll Context Menu**: Adds Apply Damage / Apply Healing / Apply Temp HP right-click options to healing roll chat messages. The DnD5e system only shows these options for damage rolls by default.
* **Legendary Action Placeholders**: When a combat begins that includes a creature with legendary actions, inserts placeholder turns in the initiative tracker after each player character and friendly creature to help track legendary action usage.
  * *↳ Show Placeholders to Players* — by default, placeholder turns are hidden from players. Enable this to make them visible.

### Group 4: Restrictions & Rules

* **Force Compendium Browser**: Forces non-GM users to open the DnD5e Compendium Browser when they click the Compendium sidebar tab, instead of showing the default pack list.

### Utilities

* **Debug Mode**: Enables verbose debug logging in the browser console for all module features. Useful for troubleshooting issues.

---

## Licensing

* The blood drop icon (`assets/bloodDrop.svg`) is sourced from [game-icons.net](https://game-icons.net/) and is licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).