# Nik's DnD5e Tweaks

A consolidated collection of small quality-of-life tweaks for Foundry VTT and the DnD5e system. This module combines several smaller tweaks and scripts into a single, unified package with a comprehensive set of configurable options.

## Dependencies
- **[socketlib](https://foundryvtt.com/packages/socketlib)**: Required for the item dropping automation features to allow non-GM players to delete items from world containers or other actors.

---

## Features

All features can be toggled on or off individually within the Foundry VTT Module Settings menu. 

### Group 1: User Interface & Visuals

* **Auto-Open Right Sidebar**: Automatically expands the right sidebar when a client connects to the game.
* **Sync Browser Tab Title**: Keeps the browser tab name dynamically in sync with the scene the client is currently viewing.
* **Show Cursor Keyboard Hints**: Displays visual floating icons near the mouse cursor when DnD5e configured macro keys (Skip, Advantage, Disadvantage) are pressed.
* **Colorize Item Rarity**: Colors item names in the character sheet's inventory list according to their rarity (e.g. Uncommon, Rare, Legendary) for easier quick-glance identification.
* **Actor Directory Disposition Dots**: Adds a colored dot next to the actor name in the Actors directory sidebar based on their default token disposition (Friendly, Hostile, Secret, Neutral).

### Group 2: Canvas & Tokens

* **Auto-Rotate Prone Tokens**: Automatically rotates tokens 90 degrees when they are given the Prone status effect.
* **Token Resizer Tool**: Adds a new control icon to the Token tools menu (visible to GMs only) to quickly resize selected tokens to standard 5e dimensions (Tiny, Small, Large, Huge, etc.).
* **Auto-Clear Movement History**: Automatically clears token movement history at the start of each combat turn. Includes sub-settings to determine when exactly to clear the history (e.g. at the start of a turn, on combat start).

### Group 3: Restrictions & Rules

* **Force Compendium Browser**: Forces players (non-GMs) to open the DnD5e Compendium Browser when clicking the Compendium tab instead of the default pack list.
* **Prevent Chat Deletion**: Removes the delete button from chat messages and prevents non-GM users from deleting their own chat messages.
