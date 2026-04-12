# Nik's DnD5e Tweaks

A consolidated collection of small quality-of-life tweaks for Foundry VTT and the DnD5e system. This module combines several smaller tweaks and scripts into a single, unified package with a comprehensive set of configurable options.

---

## Features

All features can be toggled on or off individually within the Foundry VTT Module Settings menu. 

### Group 1: User Interface & Visuals
* **Sync Browser Tab Title**: Keeps the browser tab name dynamically in sync with the scene the client is currently viewing.
* **Show Cursor Keyboard Hints**: Displays visual floating icons near the mouse cursor when DnD5e configured macro keys (Skip, Advantage, Disadvantage) are pressed.
* **Actor Directory Disposition Dots**: Adds a colored dot next to the actor name in the Actors directory sidebar based on their default token disposition (Friendly, Hostile, Secret, Neutral).
* **Blood Drop Bloodied Icon**: Replaces the default DnD5e bloodied condition icon with a red blood drop.

### Group 2: Canvas & Tokens

* **Auto-Rotate Prone Tokens**: Automatically rotates tokens 90 degrees when they are given the Prone status effect.
* **Token Resizer Tool**: Adds a new control icon to the Token tools menu (visible to GMs only) to quickly resize selected tokens to standard 5e dimensions (Tiny, Small, Large, Huge, etc.).
* **Auto-Clear Movement History**: Automatically clears token movement history at the start of each combat turn. Includes sub-settings to determine when exactly to clear the history (e.g. at the start of a turn, on combat start).

### Group 3: Automation & QOL Tasks

* **Prompt for Death Saves**: Automatically whispers a chat message with a Death Saving Throw button to the player and GM when their character starts a turn with 0 HP.
* **Legendary Action Placeholders**: When starting a combat that includes an actor with legendary actions, inserts placeholder combatants directly after each player character's and friendly creature's turn to help track legendary actions.

### Group 4: Restrictions & Rules

* **Force Compendium Browser**: Forces players (non-GMs) to open the DnD5e Compendium Browser when clicking the Compendium tab instead of the default pack list.
* **Debug Mode**: Enables detailed debug logging in the console for troubleshooting.
