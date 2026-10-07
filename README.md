# Nik's DnD5e Tweaks

[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-V14-orange.svg)](https://foundryvtt.com)
[![DnD5e System](https://img.shields.io/badge/DnD5e-6.0%2B-blue.svg)](https://github.com/foundryvtt/dnd5e)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/nschoenwald/niks-dnd5e-tweaks?color=purple)](https://github.com/nschoenwald/niks-dnd5e-tweaks/releases/latest)

A consolidated, modular collection of quality-of-life enhancements and smart combat automations for **Foundry VTT (v14)** and the **DnD5e system (6.x)**.

From fluid canvas placement HUDs with mouse-wheel rotation to retroactive advantage toggles and smart concentration tracking, **Nik's DnD5e Tweaks** polishes everyday table gameplay without bloat or forced workflows.

---

> [!TIP]
> **Modular by Design**: Every single tweak can be toggled independently. GMs configure global world defaults, while players have their own **Personal Preferences** tab to customize prompts, auto-rolls, and visuals for their own screen.

---

## ⚡ Quick Navigation

- [📊 Feature Matrix (At a Glance)](#-feature-matrix-at-a-glance)
- [🎨 User Interface & Visuals](#-user-interface--visuals)
- [🎯 Canvas & Tokens](#-canvas--tokens)
- [⚔️ Combat & Automation](#-combat--automation)
- [📜 Rules, Restrictions & Utilities](#-rules-restrictions--utilities)
- [🛠️ Silent System Patches](#️-silent-system-patches)
- [⚙️ Settings Dashboard & Personal Preferences](#️-settings-dashboard--personal-preferences)
- [🤝 Module Compatibility](#-module-compatibility)
- [📦 Installation](#-installation)
- [❤️ Other Modules by Nik](#️-other-modules-by-nik)

---

## 📊 Feature Matrix (At a Glance)

| Feature | Category | Default | Player Preference? |
|---|---|:---:|:---:|
| **[Retroactive Advantage / Disadvantage](#retroactive-advantage--disadvantage)** | UI & Visuals | ✅ Enabled | Yes |
| **[Chat Card Styling Improvements](#chat-card-styling-improvements)** | UI & Visuals | ✅ Enabled | Yes |
| **[Item Sheet Attunement Tag](#item-sheet-attunement-tag)** | UI & Visuals | ✅ Enabled | Yes |
| **[Item / Spell Add: Choice Dialog](#item--spell--feature-add-choice-dialog)** | UI & Visuals | ✅ Enabled | Yes |
| **[Roll Mode Highlight](#roll-mode-highlight)** | UI & Visuals | ✅ Enabled | Yes |
| **[Sheet Pop-out Button](#sheet-pop-out-button)** | UI & Visuals | ✅ Enabled | Yes |
| **[Clean Sheet Window Titles](#clean-sheet-window-titles)** | UI & Visuals | ✅ Enabled | No |
| **[Context Menu Styling](#context-menu-styling)** | UI & Visuals | ✅ Enabled | Yes |
| **[Reliable Chat Log Auto-Scroll](#reliable-chat-log-auto-scroll)** | UI & Visuals | ✅ Enabled | No |
| **[Actor Directory Disposition Dots](#actor-directory-disposition-dots)** | UI & Visuals | ✅ Enabled | No |
| **[Cursor Keyboard Hints](#cursor-keyboard-hints)** | UI & Visuals | ✅ Enabled | Yes |
| **[Sync Browser Tab Title](#sync-browser-tab-title)** | UI & Visuals | ✅ Enabled | Yes |
| **[Blood Drop Bloodied Icon](#blood-drop-bloodied-icon)** | UI & Visuals | ✅ Enabled | No |
| **[Sidebar Multi-line Names](#sidebar-multi-line-names)** | UI & Visuals | ✅ Enabled | No |
| **[NPC Hit Point Scaling Buttons](#npc-hit-point-scaling-buttons)** | UI & Visuals | ✅ Enabled | No |
| **[Toolbar Limitation](#toolbar-limitation)** | UI & Visuals | ✅ Enabled | Yes |
| **[Auto-Collapse Hostile Damage Trays (GM)](#auto-collapse-hostile-damage-trays-for-gm)** | UI & Visuals | ✅ Enabled | No |
| **[Auto-Collapse Unowned Damage Trays (Players)](#auto-collapse-unowned-damage-trays-for-players)** | UI & Visuals | ✅ Enabled | No |
| **[Carolingian UI Theme Harmony](#carolingian-ui-theme-harmony)** | UI & Visuals | ✅ Enabled | Yes |
| **[Template Placement Controls HUD](#template-placement-controls-hud--scroll-rotation)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Auto-Target Tokens in Spell Templates](#auto-target-tokens-in-spell-templates)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Enhanced Summoning Placement HUD](#enhanced-summoning-placement-hud--range-preview)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Enhanced Teleport Targeting UI](#enhanced-teleport-targeting-ui-automated-animations)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Auto-Rotate Prone / Unconscious / Dead Tokens](#auto-rotate-prone--unconscious--dead-tokens)** | Canvas & Tokens | ✅ Enabled | No |
| **[Snap Templates to Grid Intersections](#snap-templates-to-grid-intersections)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Clear Targets Token Control Button](#clear-targets-token-control-button)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Auto-Clear Movement History](#auto-clear-movement-history)** | Canvas & Tokens | ✅ Enabled | No |
| **[Disable Underground Token Hiding](#disable-underground-token-hiding)** | Canvas & Tokens | ❌ Disabled | No |
| **[Prompt for Initiative](#prompt-for-initiative)** | Combat & Automation | ✅ Players | Yes |
| **[Auto-Roll Initiative](#auto-roll-initiative)** | Combat & Automation | ❌ Disabled | Yes |
| **[Auto-Add Tokens to Combat](#auto-add-tokens-to-combat)** | Combat & Automation | ✅ Enabled | No |
| **[Prompt for Attack Damage](#prompt-for-attack-damage)** | Combat & Automation | ✅ For All | Yes |
| **[Auto-Roll Attack Damage](#auto-roll-attack-damage)** | Combat & Automation | ❌ Disabled | Yes |
| **[Auto-Open Damage Dialog for Saves](#auto-open-damage-dialog-for-saves)** | Combat & Automation | ✅ Enabled | Yes |
| **[Prevent Rolling as Group Actors](#prevent-rolling-as-group-actors)** | Combat & Automation | ✅ Enabled | No |
| **[Auto-Roll / Prompt Concentration Saves](#auto-roll-concentration-saves)** | Combat & Automation | ✅ NPCs Only | No |
| **[Mage Slayer: Concentration Disadvantage](#mage-slayer-concentration-disadvantage)** | Combat & Automation | ✅ Enabled | No |
| **[Auto-End Concentration](#auto-end-concentration)** | Combat & Automation | ✅ Enabled | No |
| **[Auto-End Class Features (Rage, etc.)](#auto-end-class-features)** | Combat & Automation | ✅ Enabled | No |
| **[Self Effect Application Prompt](#self-effect-application-prompt)** | Combat & Automation | ✅ Enabled | Yes |
| **[Prompt for Death Saves](#prompt-for-death-saves)** | Combat & Automation | ✅ Enabled | Yes |
| **[Legendary Action Placeholders](#legendary-action-placeholders)** | Combat & Automation | ✅ Enabled | No |
| **[Suppress Bloodied Condition on Dead Tokens](#suppress-bloodied-condition-on-dead-tokens)** | Combat & Automation | ✅ Enabled | No |
| **[Player Damage Prompt](#player-damage-prompt)** | Combat & Automation | ❌ Disabled | Yes |
| **[Auto-Apply Status at 0 HP](#auto-apply-status-at-0-hp)** | Combat & Automation | ❌ Disabled | No |
| **[Healing Roll Context Menu](#healing-roll-context-menu)** | Combat & Automation | ✅ Enabled | No |
| **[Disable Active Effect Expiry](#disable-active-effect-expiry)** | Combat & Automation | ❌ Disabled | No |
| **[Combat Experience Tracker](#combat-experience-tracker)** | Combat & Automation | ❌ Disabled | No |
| **[Force Compendium Browser](#force-compendium-browser)** | Rules & Utilities | ✅ Enabled | No |
| **[Auto-Unpause When Logging In](#auto-unpause-when-logging-in)** | Rules & Utilities | ❌ Disabled | Yes (GM) |

---

## 🎨 User Interface & Visuals

### Retroactive Advantage / Disadvantage
Injects a sleek `[ ADV ] [ NORMAL ] [ DISADV ]` segmented button group directly below the dice roll bar on d20 check, save, and attack roll chat cards.
* **Cached Dice Results**: Switching modes reuses originally rolled dice without rolling new random numbers, preventing re-roll exploitation.
* **3D Animation & Rules Support**: Animates newly evaluated dice with Dice So Nice. Supports Elven Accuracy (3d20) and Halfling Lucky. Automatically recalculates attack hit/miss badges, criticals, and fumbles.
* *Sub-settings*: **Show Only on Hover** (reveals cleanly on mouse hover to keep chat compact).

### Chat Card Styling Improvements
Modernizes DnD5e chat cards to make actions and roll results readable at a glance:
* **Color-Coded Action Buttons**: Enlarges card buttons with clear labels and colors: Royal Violet for Attack, Flame Orange for Damage, Cobalt Blue for Saves, Warm Bronze for Checks, Forest Green for Healing, Azure Blue for Temp HP, Jade for Transform, Orchid for Summon, Indigo for Teleport, Cyan for Use, and Ruby for Templates.
* **Multi-Die d20 Indicators**: Displays all individual dice rolled on advantage or disadvantage side-by-side (bold kept die, dimmed discarded die) with collision avoidance.
* **Saving Throw Shorthand**: Replaces generic labels with ability abbreviations (**STR SAVE**, **DEX**, **CON**, **INT**, **WIS**, **CHA**).
* **Themed Message Badges**: Prominent pill badges for Whispers (🔒), Private Rolls (🔒), Blind Rolls (👁), and Emotes (✦).

### Item Sheet Attunement Tag
Adds a prominent **Attunement Required** or **No Attunement Required** badge to magic item sheets and rich item tooltips.
* **Direct Toggle**: Clicking an attunement badge on an owned item directly toggles its attuned state without opening tabs.
* **Concealment Friendly**: Fully respects unidentified item concealment from players.
* *Sub-settings*: **Tag Placement** (Header & Description Pills, Header Badge Only, Description Pills Only, Header Subtitle Only), **Show in Item Tooltips**.

### Item / Spell / Feature Add: Choice Dialog
Clicking the `+` button on character sheets (Items, Spells, or Features) presents a choice between creating an empty item or opening the Compendium Browser.
* **Smart Filtering**: Automatically pre-filters the browser by class/subclass and spell level (including Eldritch Knight, Arcane Trickster, and Mystic Arts), feats for features, and physical items for inventory.
* **Bypass Shortcut**: Hold <kbd>Shift</kbd> while clicking `+` to skip the dialog and create directly.

### Roll Mode Highlight
Persistently highlights the recommended roll mode button (Advantage or Disadvantage) in d20 roll dialogs based on system conditions and features.
* *Sub-settings*: **Highlight Style** (Glow, Border, Badge, Fill), **Highlight Normal Mode Too**, **Highlight Color** (default gold `#c9a227`).

### Sheet Pop-out Button
Adds a dedicated **↗ pop-out button** to Actor and Item sheet window headers to detach them into separate browser windows with one click. Automatically hides when already detached.

### Clean Sheet Window Titles
Removes redundant type prefixes (e.g. *"Non Player Character:"*) from sheet headers, displaying clean titles like *"Goblin Archer"* or *"Potion of Healing"*.
* *Sub-settings*: Title Format (**Name Only**, Type: Name, Name (Type)).

### Context Menu Styling
Color-codes right-click context menu options across sheets, compendiums, directories, and chat:
* **Destructive Actions** (Delete, Remove): Crisp red text.
* **Additive Actions** (Duplicate, Copy): Clear green text.
* **Privacy Actions** (Make Private, Reveal): Luminous violet text.

### Reliable Chat Log Auto-Scroll
Fixes the native DnD5e chat log failing to auto-scroll when new cards appear or trays expand, while preserving scroll position when reading older history.

### Actor Directory Disposition Dots
Displays colored disposition dots (Friendly, Neutral, Hostile, Secret) next to actor names in the sidebar.

### Cursor Keyboard Hints
Displays subtle floating modifier icons near the mouse cursor when holding keys for Skip Dialog, Advantage, or Disadvantage.

### Sync Browser Tab Title
Dynamically updates the browser tab title with the name of the active scene being viewed.

### NPC Hit Point Scaling Buttons
Adds `+` and `-` buttons to the NPC Hit Points configuration dialog to quickly scale hit dice up or down, automatically recalculating average maximum HP and health formulas. Hold <kbd>Shift</kbd> to scale by 5.

### Toolbar Limitation
Turns toolbars scrollable when button count exceeds a configured limit (default: 20), preventing overcrowded canvas controls.

### Auto-Collapse Hostile / Unowned Damage Trays
* **For GM**: Auto-collapses the interactive damage application tray on hostile monster attacks targeting players.
* **For Players**: Auto-collapses damage trays when none of the targeted tokens are owned by the player, removing un-actionable clutter.

### Carolingian UI Theme Harmony
Seamlessly adapts the Settings Dashboard, floating canvas HUDs, and damage cards to **Carolingian UI** color palettes, typography, top scene navigation offsets, and Combat Carousel legendary action placeholders.

---

## 🎯 Canvas & Tokens

### Template Placement Controls HUD & Scroll Rotation
A floating glassmorphic banner appears during spell and item template placement:
* **Mouse-Wheel Rotation**: Cones, rays, and lines rotate directly in 5° steps using mouse wheel scrolling. Shift+scroll zooms the camera.
* **Live Readout**: Dynamic rotation angle readout badge (`0°`, `45°`, `90°`).
* **Emanation Guidance**: Displays target token attachment guidance with visual feedback.
* **Auto-Attach Self Emanations**: Automatically binds self-targeted emanations (*Spirit Guardians*, *Holy Aura*, etc.) directly to the caster token without manual placement.
* **Cancel Shortcut**: Clean cancellation via <kbd>ESC</kbd>, Right-Click, or the interactive HUD Cancel button.

### Auto-Target Tokens in Spell Templates
Automatically selects and targets tokens inside spell templates during placement and updates targets in real time.
* **Directional Caster Exclusion**: Cones and lines exclude the caster token from targeting.
* **Chat Synchronization**: Updates targets directly on spell chat cards for subsequent saving throws and damage application.
* **GM Privacy**: Non-GM players only target tokens visible to them.

### Enhanced Summoning Placement HUD & Range Preview
Appears during creature summoning activities (*Find Familiar*, *Summon Celestial*, etc.):
* **Live Distance Measurement**: Real-time distance readout with emerald `✓ In Range` and crimson `⚠ Out of Range` status badges.
* **Boundary Ring**: Draws an ethereal range boundary circle around the caster token on the canvas.
* **Facing Rotation**: Hold <kbd>Shift</kbd> while scrolling to orient the summoned creature before placement.
* **Step Tracking**: Multi-creature summons display step progress (*Summon 1 of 4*).
* **Token Art Preview**: Evaluates wildcard patterns and actor portraits so canvas previews show actual creature artwork instead of mystery tokens.

### Enhanced Teleport Targeting UI (Automated Animations)
Improves teleport preset destination picking (*Misty Step*, *Dimension Door*):
* Snaps a translucent ghost token preview to the grid featuring the character's authentic dynamic token ring and rune colors.
* Real-time status badges for valid range, out-of-range, and wall collision.
* Uninterrupted right-click canvas panning and clean <kbd>ESC</kbd> / Cancel flow.

### Auto-Rotate Prone / Unconscious / Dead Tokens
Automatically tilts tokens 90° clockwise when given the Prone or Unconscious condition (90° counter-clockwise for Dead), and restores them to 0° on recovery. Fully compatible with locked rotation and unlinked tokens.

### Snap Templates to Grid Intersections
Snaps circle and square spell templates to grid intersections instead of cell centers. Hold <kbd>Shift</kbd> while placing to override snapping.

### Clear Targets Token Control Button
Adds a dedicated crosshair button to the canvas Token Controls toolbar. Players clear their own targets; GMs clear targets across the entire canvas simultaneously.

### Auto-Clear Movement History
Automatically clears token movement history trails at the start of combat and on each turn (GM client).

### Disable Underground Token Hiding
Prevents tokens with negative elevation from disappearing behind the scene background layer.

---

## ⚔️ Combat & Automation

### Auto-Roll / Prompt Concentration Saves
Prompts or rolls concentration saves (DC 10 or half damage) when a concentrating creature takes damage.
* **Player Ownership**: Prompts are delivered directly to the connected player owning the character.
* **Concentration Badges**: Chat cards feature an interactive **"Concentrating on: [Spell]"** badge with sheet shortcuts.
* **One-Click End**: Appends an **End Concentration** button directly to roll cards.
* **Boon of the Iron Mind**: Automatically exempts characters with *Unshakable Focus*.
* *Sub-settings*: **Fast-Forward Rolls** (NPCs Only, All, Players Only, Never), **Auto-End Concentration on Failure**.

### Mage Slayer: Concentration Disadvantage
Deals damage to a concentrating creature from an attacker with the Mage Slayer feat -> concentration save is automatically rolled with Disadvantage (or cancels with Advantage). Fully synchronized across clients and supports unlinked tokens.

### Auto-End Concentration & Class Features
* **Auto-End Concentration**: Ends concentration when gaining Incapacitated, Unconscious, Dead, Paralyzed, Petrified, or Stunned (respecting Boon of the Iron Mind rules).
* **Auto-End Class Features**: Automatically ends Barbarian Rage, Wrath of the Sea, and Starry Form on incapacitating conditions (respecting Lv15+ Persistent Rage).

### Prompt / Auto-Roll Attack Damage
* **Prompt for Attack Damage**: Opens the damage roll dialog when an attack hits target AC.
* **Auto-Roll Attack Damage**: Immediately rolls damage on hit without opening a dialog.
* **Auto-Roll Flat / Static Damage**: Automatically rolls flat bonuses without opening dialogs if formulas have no dice.

### Prompt / Auto-Roll Initiative
* **Prompt for Initiative**: Prompts players with initiative dialogs when added to combat (with whispered cards for offline players).
* **Auto-Roll Initiative**: Automatically rolls initiative immediately on combat join.

### Auto-Open Damage Dialog for Saves
Automatically opens the damage roll dialog when using Save-type activities that deal damage (like *Fireball*). Automatically bypassed when midi-qol is active.

### Prevent Rolling as Group Actors
Prevents players controlling group or exploration party tokens from accidentally rolling as the group actor. Automatically redirects the roll context to their assigned character sheet with accurate ability modifiers and proficiency.

### Self Effect Application Prompt
When using self-buff abilities (*Rage*, *Divine Favor*, *Mirror Image*) or targeting self with spells (*Haste*, *Bless*, *Shield of Faith*), whispers a chat card with one-click **Apply** and **Undo** buttons.
* *Sub-setting*: **Always Prompt Features** (comma-separated names like `Mage Armor`).

### Legendary Action Placeholders
Inserts placeholder turns after player characters in the initiative tracker to help track legendary action phases, featuring automatic tie-breaking.
* *Sub-settings*: **Show to Players**, **Custom Icon**.

### Prompt for Death Saves
Automatically prompts the owning player with the death save dialog at the start of their turn when at 0 HP. Whispers a fallback card to the GM if the player is offline.

### Suppress Bloodied Condition on Dead Tokens
Dynamically removes the Bloodied icon and status when a creature dies or reaches 0 HP, restoring it if revived below 50% HP.

### Auto-Apply Status at 0 HP
Configurable status overlays (Unconscious, Dead, None) and combat tracker actions (Mark Defeated, Remove from Combat) when dropping to 0 HP. Important NPCs fall unconscious and are never removed from combat.

### Player Damage Prompt
Whispers a breakdown of damage resistance, vulnerability, and immunity per 2024 rules with an interactive Apply button. Supports Graze weapon mastery, saving throw half-damage, healing, and temp HP.

### Combat Experience Tracker
Tallies hostile NPC XP at the end of combat with a one-click button for the GM to distribute experience evenly among players.

---

## 📜 Rules, Restrictions & Utilities

### Force Compendium Browser
Forces non-GM players clicking the Compendium sidebar to open the DnD5e Compendium Browser instead of the raw pack directory. Hold <kbd>Shift</kbd> to access the default sidebar.

### Auto-Unpause When Logging In
Per-user GM setting to automatically unpause the world upon login (**Always**, **When no players connected**, or **Never**).

### Debug Mode
Enables comprehensive diagnostic logging in the browser console.

---

## 🛠️ Silent System Patches

Patches are zero-configuration, always-on fixes for confirmed upstream system or core bugs:
* **Skill Tooltip Overlap**: Fixes character sheet skill and tool list reference tooltips appearing directly on top of neighboring rows, ensuring clickable links remain unobstructed.

---

## ⚙️ Settings Dashboard & Personal Preferences

All features are managed in the **Settings Dashboard** accessible via *Configure Settings > Nik's DnD5e Tweaks*:

* **World Settings (GM Only)**: Global defaults and master toggles across UI, Canvas, Combat, Rules, and Utilities.
* **Personal Preferences (All Players & GMs)**: Client-side preference overrides (`scope: "client"`). Players can independently toggle prompts, auto-rolls, and interface tweaks for their own screen without altering other players' setups or GM defaults.
* **Player-First Access**: When non-GM players open the dashboard, it immediately displays their Personal Preferences tab, and the "Reset Defaults" action resets only their personal client settings.

---

## 🤝 Module Compatibility

Nik's DnD5e Tweaks includes built-in compatibility guards to ensure conflict-free operation:

### midi-qol Integration Matrix
When [midi-qol](https://gitlab.com/tposney/midi-qol) is detected, conflicting automations are automatically disabled or bypassed:

| Feature | Behavior with midi-qol |
|---|---|
| **Auto-Open Damage for Saves** | **Automatically disabled** (midi-qol handles save damage workflows). |
| **Prompt / Auto-Roll Attack Damage** | **Automatically bypassed** if midi-qol auto-applies damage. |
| **Auto-Roll Concentration Saves** | **Automatically bypassed** if midi-qol handles concentration checks. Roll card "End Concentration" button remains active. |
| **Self Effect Application** | **Automatically bypassed** if midi-qol auto-applies item effects. |
| **Player Damage Prompt** | **Automatically bypassed** if midi-qol auto-applies damage. |
| **Mage Slayer Concentration** | **Fully compatible** with midi-qol damage workflows. |

### Other Supported Modules
* **Tidy 5e Sheets**: Full support for Classic & Quadrone sheets (including Compendium choice dialogs).
* **Carolingian UI**: Automatic color theme adoption, top nav clearance glide, and Combat Carousel styling.
* **Dice So Nice (DSN)**: Synchronized 3D dice rolling for retroactive advantage and damage prompts.
* **Automated Animations**: Ghost token preview with dynamic token rings for teleport presets.

---

## 📦 Installation

### Via Foundry VTT Package Browser
1. In the Foundry setup menu, navigate to **Add-on Modules** > **Install Module**.
2. Search for **Nik's DnD5e Tweaks**.
3. Click **Install**.

### Via Manifest URL
Paste the following manifest URL into Foundry's **Manifest URL** field:
```
https://github.com/nschoenwald/niks-dnd5e-tweaks/releases/latest/download/module.json
```

### Requirements
* **Foundry VTT**: Version 14
* **DnD5e System**: Version 6.0.0 or higher

---

## ❤️ Other Modules by Nik

### ⚔️ Combat & Token Tools
* **[Nik's Token Tags](https://github.com/nschoenwald/niks-token-tags)** – Automatically numbers duplicate combatant NPCs (A, B, C…) with color-coded letter overlays.
* **[Nik's Shared NPC Initiative](https://github.com/nschoenwald/niks-shared-npc-initiative)** – Groups NPCs of the same type in combat so they share a single initiative roll.
* **[Nik's Movement Control](https://github.com/nschoenwald/niks-movement-control)** – GM controls to toggle player movement and automatically restrict/allow movement on combat start and end.
* **[Nik's Tiny Change Logs](https://github.com/nschoenwald/niks-tiny-changelogs)** – Compact, single-line chat messages logging token HP and Temp HP changes.

### 🎲 Visuals & Display
* **[Nik's Dynamic Roll Area](https://github.com/nschoenwald/niks-dynamic-roll-area)** – Dynamically restricts Dice So Nice 3D dice rolling area to exclude the sidebar / chat log across all screen resolutions.

### ⚙️ Utilities & Navigation
* **[Nik's Settings Locks](https://github.com/nschoenwald/niks-settings-locks)** – Soft-lock and hard-lock client settings and keybindings across all connected players.
* **[Nik's Compendium Search Tweaks](https://github.com/nschoenwald/niks-compendium-search-tweaks)** – Configure which compendium packs are included or excluded from native sidebar search.
* **[Nik's Show & Tell](https://github.com/nschoenwald/niks-show-and-tell)** – Share popout images to chat and paste image files directly into chat messages.
* **[Nik's Zoom / Pan Options](https://github.com/nschoenwald/niks-zoom-pan-options)** – Touchpad and scroll wheel pan/zoom controls and canvas navigation enhancements.
