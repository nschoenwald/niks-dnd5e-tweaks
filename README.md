# Nik's DnD5e Tweaks

[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-V14-orange.svg)](https://foundryvtt.com)
[![DnD5e System](https://img.shields.io/badge/DnD5e-6.0%2B-blue.svg)](https://github.com/foundryvtt/dnd5e)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/nschoenwald/niks-dnd5e-tweaks?color=purple)](https://github.com/nschoenwald/niks-dnd5e-tweaks/releases/latest)

A consolidated, modular collection of quality-of-life enhancements and smart combat automations for **Foundry VTT (v14)** and the **DnD5e system (6.x)**.

---

> [!IMPORTANT]
> **Requires [Nik's Foundry Tweaks](https://github.com/nschoenwald/niks-foundry-tweaks)** (from 14.70.0). The system-independent tweaks (Readable Text Size, Sheet Pop-out Button, Context Menu Styling, Clear Targets, Toolbar Limitation, the teleport UI and more) and the settings dashboard moved there, so they work in any game system. Your settings for them are copied over automatically.

> [!TIP]
> **Modular by Design**: Every single tweak can be toggled independently. GMs configure global world defaults, while players have their own **Personal Preferences** tab to customize prompts, auto-rolls, and visuals for their own screen.

---

## ⚡ Quick Navigation

- [📊 Feature Matrix (At a Glance)](#-feature-matrix-at-a-glance)
- [🎨 UI & Visuals](#-ui--visuals)
- [🎯 Canvas & Tokens](#-canvas--tokens)
- [🏁 Combat Flow](#-combat-flow)
- [💥 Rolls & Damage](#-rolls--damage)
- [🌀 Conditions & Effects](#-conditions--effects)
- [🛠️ Silent System Patches](#️-silent-system-patches)
- [⚙️ Settings Dashboard & Personal Preferences](#️-settings-dashboard--personal-preferences)
- [🤝 Module Compatibility](#-module-compatibility)
- [📦 Installation](#-installation)
- [❤️ Modules by Nik](#️-modules-by-nik)

---

## 📊 Feature Matrix (At a Glance)

| Feature | Category | Default | Player Preference? |
|---|---|:---:|:---:|
| **[Retroactive Advantage / Disadvantage](#retroactive-advantage--disadvantage)** | UI & Visuals | ✅ Enabled | Yes |
| **[Detailed Roll Breakdown Overlay](#detailed-roll-breakdown-overlay)** | UI & Visuals | ✅ Enabled | Yes |
| **[Chat Card Styling Improvements](#chat-card-styling-improvements)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Item Sheet Attunement Tag](#item-sheet-attunement-tag)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Item / Spell Add: Choice Dialog](#item--spell--feature-add-choice-dialog)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Roll Mode Highlight](#roll-mode-highlight)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Dragging Items Between Actors](#dragging-items-between-actors)** | UI & Visuals | ✅ Always Move | No |
| **[Pact Magic Formula Scaling Fix](#pact-magic-formula-scaling-fix)** | UI & Visuals | ✅ Enabled | Yes |
| **[Cursor Keyboard Hints](#cursor-keyboard-hints)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Blood Drop Bloodied Icon](#blood-drop-bloodied-icon)** | UI & Visuals | ✅ Enabled | No |
| **[Spell Slots Expend Left to Right](#spell-slots-expend-left-to-right)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[NPC Hit Point Scaling Buttons](#npc-hit-point-scaling-buttons)** | UI & Visuals | ✅ Enabled | No |
| **[Auto-Collapse Hostile Damage Trays (GM)](#auto-collapse-hostile--unowned-damage--healing-trays)** | UI & Visuals | ✅ Enabled | No |
| **[Auto-Collapse Unowned Damage Trays (Players)](#auto-collapse-hostile--unowned-damage--healing-trays)** | UI & Visuals | ✅ Enabled | No |
| **[Aggregate Short Rest Hit Dice Rolls](#aggregate-short-rest-hit-dice-rolls)** | UI & Visuals | ✅ Enabled | Yes |
| **[Force Compendium Browser](#force-compendium-browser)** | UI & Visuals | ✅ Enabled | No |
| **[Compendium Browser Columns](#compendium-browser-columns)** | UI & Visuals | ✅ Enabled | Yes, on or off¹ |
| **[Template Placement Controls HUD](#template-placement-controls-hud--scroll-rotation)** | Canvas & Tokens | ✅ Enabled | Yes, on or off¹ |
| **[Auto-Target Tokens in Spell Templates](#auto-target-tokens-in-spell-templates)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Enhanced Summoning Placement HUD](#enhanced-summoning-placement-hud--range-preview)** | Canvas & Tokens | ✅ Enabled | Yes, on or off¹ |
| **[Token HUD Condition Palette](#token-hud-condition-palette)** | Canvas & Tokens | ✅ Enabled | Yes, on or off¹ |
| **[Snap Templates to Grid Intersections](#snap-templates-to-grid-intersections)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Rules-Accurate Cones on Square Grids](#rules-accurate-cones-on-square-grids)** | Canvas & Tokens | ✅ Enabled | No |
| **[Grid-Based Templates](#grid-based-templates)** | Canvas & Tokens | ✅ Enabled | No |
| **[Auto-Attach Self Emanation Templates](#auto-attach-self-emanation-templates)** | Canvas & Tokens | ✅ Enabled | Yes |
| **[Remove Instantaneous Templates on Turn Change](#remove-instantaneous-templates-on-turn-change)** | Canvas & Tokens | ✅ Enabled | No |
| **[Prompt for Initiative](#prompt--auto-roll-initiative)** | Combat Flow | ✅ Players | Yes |
| **[Auto-Roll Initiative](#prompt--auto-roll-initiative)** | Combat Flow | ❌ Disabled | Yes |
| **[Prompt for Death Saves](#prompt-for-death-saves)** | Combat Flow | ✅ Enabled | Yes |
| **[Legendary Action Placeholders](#legendary-action-placeholders)** | Combat Flow | ✅ Enabled | No |
| **[Undead Fortitude Automation](#undead-fortitude-automation)** | Combat Flow | ✅ Enabled | No |
| **[Suppress Bloodied Condition on Dead Tokens](#suppress-bloodied-condition-on-dead-tokens)** | Combat Flow | ✅ Enabled | No |
| **[Auto-Apply Status at 0 HP](#auto-apply-status-at-0-hp)** | Combat Flow | ❌ Disabled | No |
| **[Combat Experience Tracker](#combat-experience-tracker)** | Combat Flow | ❌ Disabled | No |
| **[Prompt for Attack Damage](#prompt--auto-roll-attack-damage)** | Rolls & Damage | ✅ For All | Yes |
| **[Auto-Roll Attack Damage](#prompt--auto-roll-attack-damage)** | Rolls & Damage | ❌ Disabled | Yes |
| **[Auto-Open Damage Dialog for Saves](#auto-open-damage-dialog-for-saves)** | Rolls & Damage | ✅ Enabled | Yes |
| **[Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, GWM, Charger, Savage Attacker, Boon of Irresistible Offense, Genie's Wrath, Cleave & Player's Handbook class features)](#conditional-damage-bonuses-sneak-attack-hex-hunters-mark-great-weapon-master-brutal-strike-charger-savage-attacker-boon-of-irresistible-offense--cleave)** | Rolls & Damage | ✅ Enabled | Yes |
| **[Reckless Attack Automation](#reckless-attack-automation)** | Rolls & Damage | ✅ Enabled | Yes |
| **[Weapon Mastery Automation (Slow, Sap, Topple & Vex)](#weapon-mastery-automation)** | Rolls & Damage | ✅ Enabled | Yes |
| **[Prevent Rolling as Group Actors](#prevent-rolling-as-group-actors)** | Rolls & Damage | ✅ Enabled | No |
| **[Player Damage Prompt](#player-damage-prompt)** | Rolls & Damage | ❌ Disabled | Yes |
| **[Healing Roll Context Menu](#healing-roll-context-menu)** | Rolls & Damage | ✅ Enabled | No |
| **[Auto-Rotate Prone / Unconscious / Dead Tokens](#auto-rotate-prone--unconscious--dead-tokens)** | Conditions & Effects | ✅ Enabled | No |
| **[Prone Rules (Crawling, Standing Up & Attacks)](#prone-rules)** | Conditions & Effects | ✅ Enabled | Yes |
| **[Condition Advantage & Disadvantage](#condition-advantage--disadvantage)** | Conditions & Effects | ✅ Enabled | Yes |
| **[Auto-Roll / Prompt Concentration Saves](#auto-roll--prompt-concentration-saves)** | Conditions & Effects | ✅ NPCs Only | No |
| **[Mage Slayer: Concentration Disadvantage](#mage-slayer-concentration-disadvantage)** | Conditions & Effects | ✅ Enabled | No |
| **[Magic Resistance Automation](#magic-resistance-automation)** | Conditions & Effects | ✅ Enabled | No |
| **[Death Ward Automation](#death-ward-automation)** | Conditions & Effects | ✅ Enabled | No |
| **[Companion Level Sync](#companion-level-sync)** | Conditions & Effects | ✅ Enabled | No |
| **[Summon at Full HP](#summon-at-full-hp)** | Conditions & Effects | ✅ Enabled | No |
| **[Auto-End Concentration](#auto-end-concentration--class-features)** | Conditions & Effects | ✅ Enabled | No |
| **[Damage Emanation Automation](#damage-emanation-automation)** | Conditions & Effects | ✅ Prompt Caster | No |
| **[Auto-End Class Features (Rage, etc.)](#auto-end-concentration--class-features)** | Conditions & Effects | ✅ Enabled | No |
| **[Self Effect Application Prompt](#self-effect-application-prompt)** | Conditions & Effects | ✅ Enabled | Yes |
| **[Self-Targeted Activities Target Self](#self-targeted-activities-target-self)** | Conditions & Effects | ✅ Enabled | Yes |
| **[Disable Active Effect Expiry](#disable-active-effect-expiry)** | Conditions & Effects | ❌ Disabled | No |
---

¹ *Yes*: players can turn the feature off for themselves when the GM has it on. *Yes, on or off*: these only change what a player sees or how they work on their own screen, so each player can also turn them on when the GM left them off (**Use World Setting** / **On** / **Off**).

## 🎨 UI & Visuals

### Retroactive Advantage / Disadvantage
Injects a sleek `[ ADV ] [ NORMAL ] [ DISADV ]` segmented button group directly below the dice roll bar on d20 check, save, and attack roll chat cards.
* **Cached Dice Results**: Switching modes reuses originally rolled dice without rolling new random numbers, preventing re-roll exploitation.
* **3D Animation & Rules Support**: Animates newly evaluated dice with Dice So Nice. Supports Elven Accuracy (3d20) and Halfling Lucky. Automatically recalculates attack hit/miss badges, criticals, and fumbles.
* *Sub-settings*: **Show Only on Hover** (reveals cleanly on mouse hover to keep chat compact).

<img width="297" height="202" alt="image" src="https://github.com/user-attachments/assets/a04c6f5b-859a-41f4-bada-ea7e9750a83c" />

### Chat Card Styling Improvements
Modernizes DnD5e chat cards to make actions and roll results readable at a glance:
* **Color-Coded Action Buttons**: Enlarges card buttons with clear labels and colors: Royal Violet for Attack, Flame Orange for Damage, Cobalt Blue for Saves, Warm Bronze for Checks, Forest Green for Healing, Azure Blue for Temp HP, Jade for Transform, Orchid for Summon, Indigo for Teleport, Cyan for Use, and Ruby for Templates. Buttons are labelled with D&D 5e's own words (**Attack**, **Damage**, **Roll**, **Area**, …); on D&D 5e 6.1 those labels come from the system and follow your Foundry language. Save buttons add the ability (see Saving Throw Shorthand).
* **Enlarged Targeted / Selected Button**: Expands the target mode toggle button in usage cards and damage/effects trays into an easy-to-click, full-height button displaying both icon and dynamic label (**Targeted** / **Selected**), paired with clean, vertically stacked target pills. Target names and damage values always stay on one line: with a larger core **Font Size** or a narrow chat popout, the button stacks its icon above the label to make room, and names that still don't fit end in "…".
* **Prominent Apply Buttons**: The **Apply** buttons in damage and effects trays are taller, bolder, color-coded (Crimson for damage, Green for healing, Blue for temp HP, Gold for effects, matching the roll results) and say what they do: **Apply Damage**, **Apply Healing**, **Apply Temp HP** or **Apply Effect**. When every target would get exactly the same amount (no resistances, vulnerabilities or different multipliers), the amount is shown too, e.g. **Apply 17 Damage** or **Apply 6 Temp HP**. The tray's bottom spacing is trimmed, so cards barely grow.
* **Multi-Die d20 Indicators**: Displays all individual dice rolled on advantage or disadvantage side-by-side (bold kept die, dimmed discarded die) with collision avoidance. The number is centered in each die and switches between black and white so it stays readable on light, dark, critical (green) and fumble (red) dice.
* **Roll Result Labels**: Roll totals say what was rolled: **ATTACK 17**, **DAMAGE 9**, **SAVE**, **CHECK**, **HEAL**, **TEMP**, **HD** (Hit Dice), **CHARGE** (monster recharge), **INIT**, **DEATH** and **CONC**.
* **Saving Throw Shorthand**: Automatically labels saving throw action buttons and roll cards with their ability shorthand (e.g. **CON Save** or **STR Save**) instead of generic Save labels whenever Chat Card Styling Improvements is active.
* **Themed Message Badges**: Prominent pill badges for Whispers (🔒), Private Rolls (🔒), Blind Rolls (👁), and Emotes (✦).
* **midi-qol Cards**: midi-qol's merged card gets the same treatment where it uses D&D 5e's markup (save buttons, target buttons, Apply buttons). Its own Attack, Damage and Apply Effects buttons are color-coded to match.

<img width="295" height="581" alt="image" src="https://github.com/user-attachments/assets/9dc57592-74e8-428f-b6aa-cc4d6cfde6ac" />

### Detailed Roll Breakdown Overlay
Transforms the native DnD5e roll breakdown popover (opened by clicking on the roll total button on chat cards) into a comprehensive, readable breakdown showing the base die and the origin of every bonus or penalty:
* **All Roll Types**: Fully supports attacks, checks, saves, damage cards, and regular dice rolls (which collapse into the chat card's roll accordion until clicked).
* **Theme Aware**: Text and borders follow the light/dark theme of the chat card automatically, for any combination of Interface, App and Chat theme settings.
* **midi-qol Cards**: Also shown when you click the attack or damage total on midi-qol's combined card, keeping midi-qol's notes on where advantage or a bonus came from. The roll formula on midi-qol's card uses the same short labels (`3[STR] + 3[PB] + 1[MGC]` instead of `3[Strength] + 3[Proficiency] + 1[Magical Bonus]`). Rolls midi-qol hides from players stay hidden.
* **Damage Cards Breakdown & Consolidation**: Consolidates damage rolls of the same damage type (e.g. base weapon damage, *Vicious* dice, and *Great Weapon Master*) into a single unified section per damage type, displaying damage type badges with icons, subtotals, and grand total. Automatically parses and isolates typed bonus damage from active effects (e.g. Paladin 2024 *Radiant Strikes*, *Divine Favor*, *Improved Divine Smite*) into dedicated damage type sections with their own icons, subtotals, and effect names, rather than lumping them into the weapon's base damage type.
* **Intuitive Sorting Order**:
  * **Dice at the Top**: All rolled dice are placed at the top of the breakdown, starting with base weapon damage (or base d20 on checks/saves/attacks) followed by additional dice (e.g. *Vicious*, *Bless*).
  * **Modifiers Below**: Modifiers appear below the dice, beginning with ability modifiers (`STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`) at the top, followed by all other bonuses and penalties sorted alphabetically by modifier name (e.g. `GWM`, `MGC`, `PB`, `Rage`).
* **Source Identification**: Clearly shows where modifiers originate using clean shorthands instead of empty blank spaces (e.g. `+3 (STR)`, `+2 (PB)`, `+1 (MGC)`, `+1d4 [ 3 ] (Bless)`, `-2 (Exhaustion 1)`).
* **Base Die & Right-Oriented Dice**: Displays the base die (e.g. `d20`, `2d6`) with dice results aligned to the right, critical/fumble color accents, and addition formulas for multi-dice rolls (e.g. `[1] + [1] = 2`).
* **Feature & Die Flavor Labels**: Preserves and displays custom bracketed die flavors (such as `[Vicious]` on `2d6[Vicious]`) directly on the die row alongside its denomination.
* **Bonus Dice**: Formats bonus dice (like *Bless*, *Guidance*, *Bardic Inspiration*) with their formula, rolled result, and originating spell/effect name.
* **Multiplicative Modifiers & Formulas**: Accurately handles rolls containing multiplication or division (e.g. Expertise `@prof * 2`, half proficiency `@prof / 2`, multiplied damage dice `1d8 * 2`, or manual bonuses `2 * 2`), evaluating final totals correctly and displaying calculation formula badges (e.g. `[2 × 2]`) and multiplier steps (e.g. `[ 5 ] × 2 = 10`).
* **Exploding & Irregular Dice Modifiers**: Seamlessly handles rolls with complex dice term modifiers (e.g. *Sorcerous Burst* exploding dice `1d8x@mod=8`, keep/drop dice, rerolls, or target thresholds) without formula corruption or syntax errors during roll dialog configuration.
* **Automated Conditions 5e (AC5e) Integration**: Seamlessly parses and attributes bonus damage generated by AC5e active effects and opt-in damage checkboxes, ensuring multi-part or synthetic damage rolls (such as dynamic elemental damage or rider effects) display their true effect names rather than misattributing fighting styles or weapon bonuses.
* **Rule-Aware Attribution**: D&D 5e bonus rules (Active Effect changes of type *Bonus* with keys `damage` or `healing`) are only credited on matching rolls and when their conditions pass, so e.g. a cantrip-only *Potent Spellcasting* bonus is never shown on a healing spell's Wisdom modifier.
* **Condition Reductions**: Color-codes penalties such as Exhaustion or *Bane*.
* **Two-Tier Architecture**: Proactively annotates roll formulas at roll creation and retroactively deduces sources for rolls already in chat history. Breakdowns for older messages are built on demand when you hover or open them, so scrolling back through chat history stays fast.
* **Theme Harmony**: High contrast text styling across parchment chat logs, Carolingian UI, and dark Foundry themes.
* **Vibrant Damage Type Icons**: Renders damage type icons with dedicated accent colors matching Nik's Action HUD (e.g. Slashing in red, Fire in orange-red, Cold in light blue, Radiant in gold) using CSS masking and subtle drop-shadows, ensuring clear visibility against parchment, white, or dark overlay backgrounds.
* **Sidebar & Viewport Responsive**: Accurately anchors popovers to the roll trigger and expands inward/leftward to respect sidebar boundaries and scrollbars, preventing breakdown content and totals from overflowing or cutting off on high-resolution displays or narrow panels.

### Item Sheet Attunement Tag
Adds a prominent **Attunement Required** or **No Attunement Required** badge to magic item sheets and rich item tooltips.
* **Direct Toggle**: Clicking an attunement badge on an owned item directly toggles its attuned state without opening tabs.
* **Concealment Friendly**: Fully respects unidentified item concealment from players.
* *Sub-settings*: **Tag Placement** (Header & Description Pills, Header Badge Only, Description Pills Only, Header Subtitle Only), **Show in Item Tooltips**.

<img width="494" height="762" alt="image" src="https://github.com/user-attachments/assets/9b0bf9fa-1d2d-4da4-9f7e-bf08eb08d63e" />

### Item / Spell / Feature Add: Choice Dialog
Clicking the `+` button on character sheets (Items, Spells, or Features) presents a choice between creating an empty item or opening the Compendium Browser.
* **Smart Filtering**: Automatically pre-filters the browser by class/subclass and spell level (including Eldritch Knight, Arcane Trickster, and Mystic Arts), feats for features, and physical items for inventory.
* **Bypass Shortcut**: Hold <kbd>Shift</kbd> while clicking `+` to skip the dialog and create directly.

<img width="448" height="156" alt="image" src="https://github.com/user-attachments/assets/0e6ddd89-f26a-4254-a740-aa97595ca6b0" />

### Roll Mode Highlight
Persistently highlights the recommended roll mode button (Advantage or Disadvantage) in d20 roll dialogs based on system conditions and features.
* *Sub-settings*: **Highlight Style** (Glow, Border, Badge, Fill), **Highlight Normal Mode Too**, **Highlight Color** (default gold `#c9a227`).

### Dragging Items Between Actors
Dragging an inventory item from one actor's sheet to another (for example from a player character to the party group, or onto a group member) now **moves** it instead of leaving a copy behind. Choose between:
* **Always Move** (default)
* **Move, but Copy from NPCs**: loot from NPCs without removing it from their stat blocks.
* **Always Copy**: the D&D 5e default.

When you move a stack of more than one item (e.g. 20 arrows), a dialog asks how many to move. The rest stays with the original actor.

This also applies to containers: dropping onto a container on another actor's sheet, or into another actor's open container window (e.g. the party's Bag of Holding), moves the item into it. Moving a container moves everything inside it.

Hold <kbd>Shift</kbd> to force a move or <kbd>Ctrl</kbd> to force a copy (D&D 5e's *Force Move/Copy when Dragging* keybindings). Items are copied whenever a move isn't allowed: when you can't remove items from the original actor, when the item comes from the sidebar or a compendium, or for spells, features and classes.

### Pact Magic Formula Scaling Fix
Fixes an upstream DnD5e 6.x issue where Pact Magic spells on character and NPC sheets display unscaled base damage/healing formulas (e.g. 2d10 instead of 4d10 for a 1st-level *Hellish Rebuke* on a 5th-level Warlock) in the Formula column and activity rows. Formulas now dynamically scale to the caster's derived pact slot level.

### Blood Drop Bloodied Icon
Replaces the D&D 5e **Bloodied** condition icon with a red blood drop, so bloodied tokens are easier to spot. Takes effect after reloading.

### Cursor Keyboard Hints
Displays subtle floating modifier icons near the mouse cursor when holding keys for Skip Dialog, Advantage, or Disadvantage.

### Spell Slots Expend Left to Right
On the D&D 5e character and NPC sheets, expended spell slots fill up from the left, so the slot you click is the slot you spend. Clicking the 1st slot expends just that slot, clicking the 3rd expends slots 1 to 3, and clicking the right-most expended slot gives it back. Tooltips match: available slots read "1st spell slot", "2nd spell slot" … by position, expended ones "Expended Spell Slot". D&D 5e itself expends from the right, so clicking the 1st slot there expends all the others. Temporary slots (above the maximum) stay on the right and work as in D&D 5e. Tidy 5e Sheets draws its own slots and isn't affected. Players can turn it on or off for themselves.

### NPC Hit Point Scaling Buttons
Adds `+` and `-` buttons to the NPC Hit Points configuration dialog to quickly scale hit dice up or down, automatically recalculating average maximum HP and health formulas. Hold <kbd>Shift</kbd> to scale by 5.

### Auto-Collapse Hostile / Unowned Damage & Healing Trays
* **For GM**: Auto-collapses the interactive damage/healing application tray on hostile monster attacks and abilities targeting player characters (delegating application to players).
* **For Players**: Auto-collapses trays when none of the targeted tokens are owned by the active player (such as damage rolls targeting enemy NPCs), removing un-actionable clutter.
* **Healing & Temporary HP Mistarget Recovery**: When a player rolls healing or temporary HP while accidentally still targeting an enemy NPC from previous combat actions, the tray remains open and automatically switches targeting mode to **Selected** tokens, allowing players to immediately select their token or ally and apply healing without manual tray tweaking.

### Aggregate Short Rest Hit Dice Rolls
Fixes chat log spam during short rests when characters roll multiple hit dice:
* **Single Aggregated Chat Card**: Catches all hit dice rolled across the rest session (both manual clicks and "Auto Spend Hit Dice") and summarizes them into a single consolidated roll line (e.g. `HD 81` for `8d8 + 40`). All individual dice rolls, term modifiers, and formulas are preserved inside the collapsible roll breakdown tooltip, eliminating chat log clutter without losing any information.
* **Targeted 3D Dice (Dice So Nice)**: When rolling hit dice in the dialog, 3D dice animate in real-time only on the active player's screen, preserving tactile rolling satisfaction without cluttering other players' views or re-animating all dice at the end.
* **Consolidated Tiny Changelogs**: When `niks-tiny-changelogs` is active, suppresses individual per-roll messages and outputs exactly two consolidated entries: one for total Hit Dice expended and one for total HP gained.
* **Anti-Cheat & Save-Scumming Prevention**: Hit dice and HP changes are committed to the database immediately on every roll. Closing or canceling the short rest dialog after rolling dice immediately posts the aggregated card and changelogs for the dice rolled, preventing roll-fishing or re-rolling bad outcomes.

### Force Compendium Browser
Forces non-GM players clicking the Compendium sidebar to open the DnD5e Compendium Browser instead of the raw pack directory. Hold <kbd>Shift</kbd> to access the default sidebar.

### Compendium Browser Columns
Adds columns that fit the current tab to the D&D 5e Compendium Browser results, and makes every column header sortable. Click a header to sort by it; click it again to reverse the order. Results, Source and the new columns all sort, and entries without a value stay at the bottom either way. Each tab remembers its own sort while the browser is open.

| Tab | Columns |
|---|---|
| Spells | Level, School, Concentration / Ritual (icons) |
| Items | Rarity (with an attunement icon), Price, Weight |
| Monsters | CR, Type |
| Feats | Category, Level requirement, Ability scores (e.g. *Cha* for Actor, *Str +1* for Great Weapon Master, *Any* for Resilient) |
| Classes | Hit die, Spellcasting, Primary ability |
| Subclasses | Class |
| Backgrounds | Ability scores (e.g. *Int, Wis, Cha* for the Acolyte), Feat (the origin feat; older backgrounds show their background feature) |
| Vehicles | Vehicle type |

Species and the advanced mode's mixed lists get no extra columns, but their Results and Source columns still sort. In advanced mode, the columns appear once the type filter is narrowed to one of the tabs above (e.g. only weapons). Price sorts by gold value across coin types, rarity in game order (common → artifact), CR from ⅛ upward. Players can turn the columns on or off for themselves.

---

## 🎯 Canvas & Tokens

### Token HUD Condition Palette
Replaces the Token HUD's grid of small status icons with a labelled list:
* **Names next to icons**: Every status shows its name, so you no longer have to hover icons to find the right one. The three columns have a fixed width; very long names (some modules add these) are shortened and show in full on hover.
* **Grouped and sorted**: The system's conditions (Blinded to Unconscious) come first, other effects (Bleeding, Concentrating, Dead, Flying, …) below them. Both groups are sorted A–Z by name in your language, including statuses added by other modules.
* **Active at a glance**: Active statuses are highlighted. Leveled conditions show their level (e.g. Exhaustion **2**), and statuses shown as a large overlay on the token get a small mark. The palette button shows how many statuses are active.
* **Same controls**: Click a row (icon or name) to toggle the status; right-click to show it as an overlay or lower its level, as before.
* **Hidden Statuses**: The GM chooses statuses to leave out of the palette for everyone in a small picker (Settings Dashboard → Canvas & Tokens → Hidden Statuses → *Choose*, or the gear at the bottom of the palette). Dehydration, Malnutrition and Suffocation are hidden by default. A hidden status still appears while a token has it, so it can always be removed.
* Players can choose the labelled list or the original icon grid for themselves under Personal Preferences (**Use World Setting** / **On** / **Off**); with the icon grid, hidden statuses stay visible for them too.
* **Monk's Little Details**: While the palette is on, Monk's "Alter Token HUD Status" layout (labels, colours, columns, Clear All) and its sorting are switched off so the two don't overlap. With the palette off, Monk's version shows as usual.

### Template Placement Controls HUD & Scroll Rotation
A floating glassmorphic banner appears during spell and item template placement:
* **Mouse-Wheel Rotation**: Cones, rays, and lines rotate directly in 5° steps using mouse wheel scrolling (rules-accurate cones step one 45° wedge at a time). Every notch counts, also with smooth-scrolling mice and any Windows scroll speed; touchpads are dampened so a swipe doesn't spin the template. Shift+scroll zooms the camera.
* **Live Readout**: Dynamic rotation angle readout badge (`0°`, `45°`, `90°`).
* **Emanation Guidance**: Displays target token attachment guidance with visual feedback.
* **Auto-Attach Self Emanations**: Automatically binds self-targeted emanations (*Spirit Guardians*, *Holy Aura*, etc.) directly to the caster token without manual placement.
* **Cancel Shortcut**: Clean cancellation via <kbd>ESC</kbd>, Right-Click, or the interactive HUD Cancel button.

<img width="774" height="677" alt="image" src="https://github.com/user-attachments/assets/aeb11a42-ec74-424a-84e1-6521cb3fd092" />

### Auto-Target Tokens in Spell Templates
Automatically selects and targets tokens inside spell templates during placement and updates targets in real time. Walls, elevation and scene levels are respected, and large creatures count when any square they occupy is inside the area.
* **Follows the Affects Type**: Areas set to affect **Ally** only target the caster's allies, **Enemy** only its opponents, and **Self** only the caster. Areas that affect only creatures leave vehicles out.
* **Origin / Source Token Exclusion**: Cones and lines/rays exclude the caster from targeting, and emanations exclude the token that is both the source and the attached token for the region in accordance with D&D 5e / 2024 rules.
* **Allies-Only Healing**: Templates placed for healing activities only target the caster's allies: player characters target other PCs and friendly tokens, and hostile NPCs target other hostile tokens.
* **Opponents-Only Choose Targets**: Damaging spells and features, and saving throw spells, with **Choose Targets** enabled only target the caster's opponents: PCs and friendly NPCs target hostile tokens, and hostile NPCs target PCs and friendly tokens.
* **Secret Tokens**: Tokens with the Secret disposition count as both ally and opponent, so they are always targeted. A Secret caster's areas are not filtered by side.
* **Skips Non-Targets**: Dead and defeated creatures, party and encounter tokens, tokens without an actor and Item Piles are never targeted. Unconscious creatures are, so healing reaches them.
* **Chat Synchronization**: Updates targets directly on spell chat cards for subsequent saving throws and damage application.
* **GM Privacy**: Non-GM players only target tokens visible to them. Areas placed by the GM skip hidden tokens unless the caster is hidden too.

### Snap Templates to Grid Intersections
Snaps circle, ring and square spell templates to grid intersections instead of cell centers. On hex grids, circles and rings snap to hex centers and squares keep the default Foundry snapping. Cones, lines and emanations are not affected. Hold <kbd>Shift</kbd> while placing to override snapping.

### Rules-Accurate Cones on Square Grids
Cone templates on square grids cover whole squares, following the D&D grid rules, instead of Foundry's round 53° cone.
* **Pattern**: A cone starts at a grid intersection. Counting distance on the grid, it has exactly 1 square at 5 ft, 2 squares at 10 ft, 3 at 15 ft and so on. A 15 ft cone always covers 6 squares, a 30 ft cone 21, a 60 ft cone 66. Numbered by distance, a 15 ft cone looks like this:
  ```
  1 2 3
  . 2 3
  . . 3
  ```
* **8 orientations**: The cone fills the wedge between two neighbouring grid directions (for example between east and south-east). Scrolling or dragging the rotation handle steps to the next wedge, 45° at a time.
* **One set of squares**: The highlighted squares, auto-targeting and Region behaviours all use the same squares. The origin always snaps to an intersection, also with <kbd>Shift</kbd> held. The angle is left out of the measurement label.
* **Scope**: Applies to spell and item templates and to templates drawn with Foundry's template tools. Hex and gridless scenes and ordinary Regions keep the default cone. It applies to everyone in the world (no personal opt-out), so every player sees the same squares. Turned on by default.

### Grid-Based Templates
Templates are measured with the scene's grid rules instead of being drawn as round shapes, using Foundry's grid-based Region shapes. Choose which template types this applies to.
* **What changes**: On a square grid with 5/5/5 diagonals, a 20 ft sphere covers a square of squares; with 5/10/5 diagonals it covers an octagon. On hex grids, round shapes follow the hexes. Line lengths are measured along the grid. Gridless scenes are not affected.
* **Per template type**: Circles and spheres (also ellipses drawn with Foundry's template tools), cones, cubes and squares, lines, rings and emanations each have their own switch. Circles, spheres and rings are off by default; the other types are on.
* **Scope**: Applies to spell and item templates and to templates drawn with Foundry's template tools (Regions layer, template mode). The preview while placing already shows the final shape. Other Regions are not affected.
* **New templates only**: The choice is stored on each template, so templates already on the scene keep their shape when you change the settings.
* **With Rules-Accurate Cones**: On square grids, that feature decides the cone's squares, so the Cones switch only matters on hex grids while it is on.
* Applies to everyone in the world (no personal opt-out). Turned on by default. Works with midi-qol.

### Auto-Attach Self Emanation Templates
When a creature uses something with an emanation area centered on itself (e.g. *Spirit Guardians*, Paladin auras), the template is attached to its token right away, without placing it on the canvas. Players can turn this off for themselves.

### Remove Instantaneous Templates on Turn Change
Templates of spells and abilities with an instantaneous duration (e.g. *Fireball*, *Burning Hands*, breath weapons) are deleted automatically in combat, so they don't pile up on the scene.
* **When**: Whenever the turn changes, and when a combat ends. Templates placed during a turn stay until that turn is over, also ones placed as a reaction on someone else's turn. Starting combat doesn't remove anything, so a template that opened the fight stays for the first turn.
* **What stays**: Templates of spells and abilities with any other duration (e.g. concentration spells), templates drawn by hand, and templates whose item was deleted.
* Uses each activity's own duration, or the item's duration if the activity doesn't set its own.
* Applies to everyone in the world (no personal opt-out). Turned on by default. Works with midi-qol: midi-qol's *Auto remove instantaneous templates* removes them right after the roll instead; this feature catches the rest when the turn changes.

### Enhanced Summoning Placement HUD & Range Preview
Appears during creature summoning activities (*Find Familiar*, *Summon Celestial*, etc.):
* **Live Distance Measurement**: Real-time distance readout with emerald `✓ In Range` and crimson `⚠ Out of Range` status badges.
* **Boundary Ring**: Draws an ethereal range boundary circle around the caster token on the canvas.
* **Facing Rotation**: Hold <kbd>Shift</kbd> while scrolling to orient the summoned creature before placement.
* **Step Tracking**: Multi-creature summons display step progress (*Summon 1 of 4*).
* **Token Art Preview**: Evaluates wildcard patterns and actor portraits so canvas previews show actual creature artwork instead of mystery tokens.

---

## 🏁 Combat Flow

### Prompt / Auto-Roll Initiative
* **Prompt for Initiative**: Prompts players with initiative dialogs when added to combat (with whispered cards for offline players).
* **Auto-Roll Initiative**: Automatically rolls initiative immediately on combat join.

### Legendary Action Placeholders
Inserts placeholder turns in the initiative tracker so legendary actions can be tracked. A legendary creature can take a legendary action after another creature's turn, so when a combat starts with at least one legendary creature, a placeholder follows every creature after whose turn a legendary creature may act: with one legendary creature, every turn except its own; with several, every turn. A creature counts as legendary if it has a Legendary Actions count, or if it has no such count (such as a player character) but has a feature whose activation is set to Legendary Action. For those features, remaining uses are read from their limited uses or what they consume; a feature without limited uses counts as always available. Placeholders after hidden creatures stay hidden from players. Also includes automatic tie-breaking, native Foundry core combat turn markers on the legendary creatures that can act during a placeholder turn and still have uses, and auto-skipping of placeholders where none of them has uses left or the creature before the placeholder is defeated.
* *Sub-settings*: **Placeholder Placement** (*After Every Creature's Turn*, or *After Opposing Creatures' Turns Only*: friendly legendary creatures only after hostile creatures and hostile ones only after friendly creatures, by token disposition; neutral and secret legendary creatures after every creature), **Auto-Skip When No Uses Left**, **Show to Players**, **Custom Icon**.

### Auto-Apply Status at 0 HP
Configurable status overlays (Unconscious, Dead, None) and combat tracker actions (Mark Defeated, Remove from Combat) when dropping to 0 HP. Important NPCs fall unconscious and are never removed from combat. Dead and Unconscious replace each other: when a creature gets one, the other is removed, also when it is set by hand from the token HUD or by another module.

### Prompt for Death Saves
Automatically prompts the owning player with the death save dialog at the start of their turn when at 0 HP. Whispers a fallback card to the GM if the player is offline.

### Undead Fortitude Automation
When damage would reduce a creature with **Undead Fortitude** (Zombies, Ogre Zombies and the like) to 0 HP, it rolls a Constitution saving throw with a DC of 5 + the damage taken. On a success it stays at 1 HP; on a failure it drops to 0 HP. Radiant damage and critical hits skip the save, and the GM gets a whispered note saying why.
* **While the save is rolled** the creature stays at 1 HP, so Dead status, defeated marks and other 0 HP automation only happen once the save has failed. Cancelling the roll dialog counts as a failure.
* **Works with** damage applied from the damage tray, the chat context menu, the token HP bar and midi-qol. Critical hits are recognised from the damage roll (or midi-qol's workflow); typed numbers on the token HP bar carry no damage type or critical hit, so they always allow the save.
* **Recognized Features**: Undead Fortitude from the 2014 and 2024 rules, and homebrew features with that name. Give any other actor the feature with an Active Effect or flag `flags.niks-dnd5e-tweaks.undeadFortitude` = `true`.
* *Sub-setting*: **Roll Without Dialog** (on by default). Turn it off to open the roll dialog and add bonuses first.

### Suppress Bloodied Condition on Dead Tokens
Dynamically removes the Bloodied icon and status when a creature dies or reaches 0 HP, restoring it if revived below 50% HP.

### Combat Experience Tracker
Tallies hostile NPC XP at the end of combat with a one-click button for the GM to distribute experience evenly among players.

---

## 💥 Rolls & Damage

### Prompt / Auto-Roll Attack Damage
* **Prompt for Attack Damage**: Opens the damage roll dialog when an attack hits target AC.
* **Auto-Roll Attack Damage**: Immediately rolls damage on hit without opening a dialog.
* **Auto-Roll Flat / Static Damage**: Automatically rolls flat bonuses without opening dialogs if formulas have no dice.

### Auto-Open Damage Dialog for Saves
Automatically opens the damage roll dialog when using Save-type activities that deal damage (like *Fireball*). For spells that place an area, the damage roll targets the creatures inside the newly placed area, even if other creatures were still targeted when the spell was cast. Automatically bypassed when midi-qol is active.

### Reckless Attack Automation
A creature with the **Reckless Attack** feature decides on its first attack roll of its turn without using the feature from its sheet:
* **In the attack roll dialog**, a **Reckless Attack** checkbox appears. Ticking it selects **Advantage** as the default button. The checkbox is greyed out while the chosen ability or attack mode doesn't qualify (see below).
* **When the dialog is skipped** (fast-forward keys, or midi-qol's fast-forwarded attacks), a short Yes / No prompt asks first.
* The choice is only offered on the creature's own turn and on its first attack roll that turn. If it declines, it isn't asked again until its next turn. Out of combat the checkbox is offered whenever the creature isn't Reckless yet; skipped dialogs don't ask there.

Attacking recklessly makes the creature **Reckless** until the start of its next turn, shown as an effect with the feature's icon:
* **Attacks against it** have Advantage (single target only).
* **Its own attacks**: under the **2014 rules**, melee weapon attacks using Strength have Advantage for the rest of that turn (thrown weapons count as ranged). Under the **2024 rules**, all attack rolls using Strength have Advantage until the start of its next turn, so opportunity attacks count too.
* The rules come from the feature item's own source (2014 or 2024), and from the world's rules setting if it has none. A 2014 Barbarian in a 2024 world follows the 2014 text.
* If the feature applies an effect of its own (for example when you still use it from the sheet), that effect counts as Reckless as well, so nothing is doubled. The effect uses the system's own **until the start of your next turn** duration: it ends at the start of the creature's next turn, when combat ends, or, out of combat, as soon as game time moves on. Under the 2014 rules, out of combat its own attacks keep Advantage while the effect lasts.

Players can turn the choice off for themselves in their personal settings. The Advantage from Reckless creatures stays on.

### Conditional Damage Bonuses (Sneak Attack, Hex, Hunter's Mark, Great Weapon Master, Brutal Strike, Charger, Savage Attacker, Boon of Irresistible Offense & Cleave)

<img width="394" height="595" alt="image" src="https://github.com/user-attachments/assets/5a754d05-167a-472c-943e-440fb347fd5f" />

Offers seamless toggles in damage roll configuration dialogs for conditional damage bonuses:
* **Sneak Attack**: Available for Rogues and monsters/NPCs with Sneak Attack features (e.g. Assassin, Spy) when attacking with a finesse or ranged weapon. Automatically resolves the native scale value formula (e.g. `1d6`, `2d6`, etc.) and inherits the weapon's damage type and magical properties. The toggle starts **on** only when the attack qualifies: the attack roll had Advantage, or an ally who isn't Incapacitated (or at 0 HP) stands within 5 ft of the target and the attack didn't have Disadvantage. Swashbucklers with *Rakish Audacity* also qualify when they're within 5 ft of the target, no other creature is within 5 ft of them, and the attack didn't have Disadvantage. Allies are tokens on the attacker's side (player characters always count as friendly); hidden tokens and dead creatures are ignored. Hovering the toggle shows why it starts on or off. It is always shown, so you can still turn it on yourself (an unseen attacker, a forgotten Advantage, a GM ruling). In combat it also starts off once Sneak Attack was used this turn. If the attack roll or the target can't be found, it falls back to the old behaviour: on until used this turn in combat, your last choice outside combat. **Assassinate**: Assassins add their Rogue level to Sneak Attack during the first round of combat (shown in the toggle, e.g. `+3d6 + 5`).
* **Great Weapon Master (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `great-weapon-master` feat gain an optional toggle when attacking with Heavy weapons to deal extra damage equal to their Proficiency Bonus (+PB), flavored with `GWM` and matching the weapon's damage type. When an active combat encounter is underway, this bonus is offered strictly on the attacker's own turn (and withheld on opportunity attacks, reaction strikes, or attacks on other turns, since Heavy Weapon Mastery only applies to attacks from the Attack action on your turn). Outside of combat, it remains available for out-of-combat attacks.
* **Brutal Strike (2024 Rules)**: Under 2024 (modern) rules, characters possessing the Brutal Strike feature (`brutal-strike` identifier) gain an optional toggle on their turn to deal extra damage from the feature's scale value (`@scale.brutal-strike.damage` in D&D 5e 6.1 content, `@scale.barbarian.brutal-strike` in older content; both are read, e.g. `1d10`, or `2d10` at 17th level) matching the weapon or unarmed strike's damage type. Not offered on finesse weapons when your Dexterity modifier exceeds Strength. In combat, it is offered strictly on your turn and only once per turn. Defaults to disabled on every roll.
* **Charger (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `charger` feat gain an optional toggle for melee attacks (melee weapons and unarmed strikes) to deal an extra `1d8` damage matching the weapon or unarmed strike's damage type. Strictly excludes ranged weapons, thrown attacks, and spell attacks. Always offered for melee attacks outside of combat. During combat, it validates that it is the attacker's turn, that the attacker has moved at least 10 feet on their current turn, and that it has not already been used that turn. Defaults to disabled and automatically resets to disabled after use.
* **Savage Attacker (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `savage-attacker` feat gain an optional toggle on weapon attacks to roll the weapon's damage dice twice and use the higher roll (evaluated seamlessly via native `{dice, dice}kh` dice pools). Enabled by default on the first eligible weapon attack of each turn, and automatically defaults to disabled for any subsequent attacks on that same turn once used.
* **Boon of Irresistible Offense (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `boon-of-irresistible-offense` feat gain an optional toggle when rolling a 20 on the d20 for an attack roll. Adds flat extra damage equal to the ability score increased by the feat (determined from advancement data, or defaulting to the higher of Strength and Dexterity). Matches the attack's damage type. Strictly offered only when the attack roll's d20 rolled a natural 20, and always enabled by default whenever offered.
* **Genie's Wrath**: Genie warlocks (with the *Genie's Wrath* or *Genie's Vessel* feature) get a toggle on attack rolls made on their own turn, weapon or spell (e.g. *Eldritch Blast*). Adds extra damage equal to your proficiency bonus, not doubled on a critical hit. The damage type depends on your patron, so the row has a dropdown with bludgeoning (Dao), thunder (Djinni), fire (Efreeti) and cold (Marid). Pick it once and it's remembered for that character; until then the toggle's tooltip reminds you and the row starts on bludgeoning. Enabled by default on the first attack of each turn, and starts off on later attacks that turn once used. Outside combat it is always offered.
* **Great Weapon Fighting (always on, no toggle)**: Characters with the Great Weapon Fighting fighting style (`great-weapon-fighting`, both the 2014 class feature and the 2024 feat) get it applied automatically when attacking with a melee weapon held in two hands: a Two-Handed weapon, or a Versatile weapon used in its Two-Handed attack mode. It only affects the weapon's own damage dice, not Sneak Attack, Hex, Divine Smite or other added damage. 2024 rules treat every 1 or 2 as a 3 (`2d6min3`); 2014 rules reroll each 1 or 2 once and keep the new roll (`2d6r<3`). The feature's own rules version decides which applies (older items without one follow the world setting). Critical hit dice and Savage Attacker's second roll get it too. When the damage roll doesn't know how a Versatile weapon was held (e.g. damage rolled without an attack), it isn't applied to that weapon.
* **Elemental Adept (always on, no toggle)**: Spell damage of the type you chose with the Elemental Adept feat treats every 1 on a damage die as a 2, critical dice included. The item doesn't store the chosen type, so put it in the feat's name, e.g. **Elemental Adept (Fire)** (one feat per type). The type picked in a spell's damage dialog counts, so *Chromatic Orb* and *Dragon's Breath* work too.
* **Cleave Weapon Mastery (Damage Malus)**: When a player character attacks with a weapon whose Cleave mastery they have unlocked under 2024 rules (never offered for NPCs), provides a toggle for the secondary attack that removes the ability score modifier from the damage formula (unless negative). Disabled by default and strictly one-off (never remembered for subsequent rolls).
* **Hex (+1d6 Necrotic)**: Adds `1d6 necrotic` damage when hitting your hexed target while concentrating on Hex.
* **Hunter's Mark (+1d6 Force)**: Adds `1d6 force` damage when hitting your quarry while concentrating on Hunter's Mark. Rangers with **Foe Slayer** roll `1d10` instead.
* **Player's Handbook Class Features & Species Traits**: Features that add damage when you hit get a toggle too. Each one is offered only when its conditions are met. Once-per-turn features start off once they were used this turn (in combat), and features with a damage type choice have a dropdown in their row.
  * **Colossus Slayer** (Hunter's Prey, `+1d8`, weapon's damage type, once per turn): starts on when the target is missing hit points; hover the toggle to see why. If you switched Hunter's Prey to Horde Breaker, untick it once while it's offered and it stays off until you tick it again.
  * **Divine Strike** (Cleric, `+1d8`, `2d8` from level 14, once on each of your turns with a weapon): starts on Radiant; pick Necrotic in the dropdown.
  * **Primal Strike** (Druid, `+1d8`, `2d8` from level 15, once on each of your turns with a weapon or a Wild Shape form's attack): Cold, Fire, Lightning or Thunder; your last pick is remembered.
  * **Divine Fury** (Zealot, `+1d6` + half your Barbarian level, first hit on each of your turns while raging): Necrotic or Radiant, remembered.
  * **Frenzy** (Berserker, Rage Damage in d6s): the first Strength-based hit on your turn while raging and attacking recklessly (with **Reckless Attack Automation** or the feature's own effect).
  * **Dreadful Strikes** (Fey Wanderer, `+1d4` psychic, `1d6` from level 11, weapon hits): each creature once per turn.
  * **Elemental Epitome** (Warrior of the Elements, one Martial Arts die, Unarmed Strikes, once on each of your turns while Elemental Attunement is active): Acid, Cold, Fire, Lightning or Thunder, remembered.
  * **Lunar Form** (Circle of the Moon, `+2d10` radiant, once on each of your turns): only while you're in Wild Shape.
  * **Celestial Revelation** (Aasimar, `+` Proficiency Bonus, once on each of your turns, attacks and spells): only while transformed. Necrotic with Necrotic Shroud, Radiant otherwise.
  * **Lifedrinker** (`+1d6` Necrotic, Psychic or Radiant, remembered): only with a weapon that carries the **Pact Weapon** enchantment from Pact of the Blade.
* **Features That Cost Uses**: These start **off** and show what's left. Ticking them spends the cost when you roll. They aren't offered when nothing is left or when they were already used this turn.
  * **Dread Ambusher** (Gloom Stalker, `+2d6` psychic, `2d8` from level 11, once per turn): one use of the feature.
  * **Fire's Burn** (`+1d10` fire) and **Frost's Chill** (`+1d6` cold) (Goliath): one use of the trait.
  * **Psionic Strike** (Psi Warrior, Psionic Energy Die + Intelligence modifier force, once on each of your turns with a weapon): one Psionic Energy Die.
  * **Hand of Harm** (Warrior of Mercy, Martial Arts die + Wisdom modifier necrotic, Unarmed Strikes, once per turn): one Focus Point.
  * **Eldritch Smite** (`+(1 + slot level)d8` force, once per turn): one Pact Magic slot; only with the Pact Weapon.
* **Spell Damage Bonuses**: These also appear on spells that call for a saving throw or simply deal damage (e.g. *Fireball*, *Magic Missile*), not only spell attacks.
  * **Empowered Evocation** (Evoker, `+` Intelligence modifier): Wizard spells of the Evocation school. On by default; your last choice is remembered.
  * **Radiant Soul** (Celestial Patron, `+` Charisma modifier, once on each of your turns): spells that deal Radiant or Fire damage.
* **Persistent Choice Memory**: Remembers whether each bonus was toggled ON or OFF across attacks and fast-forward rolls (Cleave, Brutal Strike, and Charger are exempted and always reset to disabled by default, while Savage Attacker and Boon of Irresistible Offense always default to enabled on eligible rolls), so players can keep bonuses enabled while attacking their quarry and quickly toggle them off when striking other creatures or after expending their once-per-turn benefits.
* **Live Reactive Preview & Zero-Layout-Shift**: Toggling bonuses or changing weapon damage types in the dialog updates the formula line, dice preview, and Sneak Attack/GWM/Brutal Strike/Charger/Boon of Irresistible Offense damage types in real time. If the weapon's base damage has no damage type, generic bonuses remain untyped (matching the weapon) rather than falling back to piercing damage, and untyped damage parts are cleanly labeled as **Pure** with their corresponding damage icon instead of generic "Formula". Inactive bonus formula rows are stably preserved and cleanly greyed out with disabled inputs, eliminating window jumping and layout shifts.
* **Critical Hit Doubling**: Automatically doubles bonus dice on critical hits according to 5e rules, while properly preventing weapon-specific extra critical dice (e.g. Savage Attacks or Brutal Critical) from duplicating onto conditional damage pools. Flat bonuses like GWM and Boon of Irresistible Offense do not duplicate.
* **Detailed Breakdown Integration**: Labels each bonus distinctly (`Sneak Attack`, `Assassinate`, `Hex`, `Hunter's Mark`, `GWM`, `Brutal Strike`, `Charger`, `Savage Attacker`, `Boon of Irresistible Offense`, `Divine Strike`, `Colossus Slayer` and the other feature names) with proper damage type icons in the Detailed Roll Breakdown Overlay, and explicitly labels damage type headers as subtotals (e.g. `PIERCING TOTAL 8`, `FORCE TOTAL 5`) across multi-damage cards.

### Prevent Rolling as Group Actors
Prevents players controlling group or exploration party tokens from accidentally rolling as the group actor. Automatically redirects the roll context to their assigned character sheet with accurate ability modifiers and proficiency.

### Player Damage Prompt
Whispers a breakdown of damage resistance, vulnerability, and immunity per 2024 rules with an interactive Apply button. Supports Graze weapon mastery, saving throw half-damage, healing, and temp HP. The breakdown uses the system's own damage calculation, so it matches what is applied, including magical weapons bypassing resistance. On D&D 5e 6.1, effects that let an attack ignore resistance, immunity or vulnerability (or turn immunity into resistance) are respected by both the breakdown and the Apply button.

### Healing Roll Context Menu
Adds **Apply Damage**, **Apply Healing** and **Apply Temp HP** to the right-click menu of healing roll chat cards. Takes effect after reloading.

### Weapon Mastery Automation
Automatically handles weapon masteries when player characters deal damage with mastery weapons:
* **Applied on Damage Roll**: Sap, Slow and Vex are applied when the weapon's damage is rolled against its targets (not on the attack roll), using the mastery chosen for that attack.
* **Topple (Applied with the Damage)**: When the damage of a Topple attack is applied to a creature (from the damage card, the Player Damage Prompt or midi-qol), it makes a Constitution saving throw against DC 8 + the attack's ability modifier + the attacker's Proficiency Bonus. On a failure it has the Prone condition. By default the creature's owners get a prompt card with a save button, and the roll dialog opens right away for the creature's player (or for the GM if no owner is online), just like concentration saves. The card shows the outcome once the save is rolled, and stays clickable if the dialog is closed. The GM can switch to the prompt card only, or to rolling the save automatically. If a creature spends a Legendary Resistance on the failed save (the system's Resist button on the save card), Prone is removed again and the prompt card says so. Creatures that are already Prone aren't asked, and applying the same hit twice doesn't ask again.
* **Player Character Only**: Triggers strictly on attacks made by player characters possessing the required mastery trait, leaving NPC mechanics unaffected.
* **Sapped (Weapon Mastery)**: Target creature gains Disadvantage on its next attack roll before the start of the attacker's next turn. Automatically expires once the sapped creature rolls an attack, or at the start of the attacker's next turn.
* **Slowed (Weapon Mastery)**: Reduces target creature's Speed by 10 ft across all movement modes (via native movement bonus). Automatically expires at the start of the attacker's next turn.
* **Duplicate Prevention**: Creatures cannot have duplicate Sap or Slow effects applied simultaneously; hitting a target multiple times with Slow weapons caps the reduction at 10 ft.
* **Durations**: Sap and Slow use the system's own **until the start of the source's next turn** duration, so the effect shows how long it lasts. Out of combat they end as soon as game time moves on, and lingering effects are cleaned up when combat ends.
* **Vex**: When you hit a creature with a Vex weapon and deal damage, you get a **Vex: <creature>** effect. Your next attack roll against that creature, with any weapon or spell, has Advantage, and the effect is used up by that roll whether it hits or misses. It ends at the end of your next turn (out of combat: when game time moves on). Hitting the same creature again refreshes it; several creatures each get their own effect. Advantage is only added to attacks with a single target.
* *Sub-settings*: Topple saving throw (prompt and open the roll dialog, prompt card only, or roll automatically) and configurable active effect icons for Sap, Slow and Vex.

---

## 🌀 Conditions & Effects

### Prone Rules
The system only stops Prone creatures from flying, climbing or swimming. This feature adds the rest of the Prone rules. Each rule can be turned off on its own:
* **Crawl While Prone**: A Prone token switches to the **Crawl** movement action, and back to what it used before once it stands up. Walking while Prone costs 1 extra foot per foot, just like crawling, so a creature with 30 ft of Speed can crawl 15 ft. Follows the system's *Movement Automation* setting: with automation off, movement costs are left alone.
* **Standing Up Costs Half Speed**: Removing Prone on the creature's own turn in combat costs half its Speed (rounded down). The cost is added to the first step the creature takes after standing up, so the ruler shows it and the system's speed limit counts it. Undoing that move gives the movement back, and the next move pays it again. A player can't remove Prone without enough movement left this turn (or with a Speed of 0) and gets a message instead; the GM gets a warning but can still remove it. Outside combat, or on another creature's turn, standing up is free.
* **Prone Attack Rolls**: A Prone attacker has Disadvantage on attack rolls. An attack roll against a Prone creature has Advantage if the attacker is within 5 feet of it (measured between the closest spaces, including height), and Disadvantage otherwise. Both apply together, so a Prone creature attacking a Prone creature next to it rolls normally. The roll dialog opens with the right mode already selected. Only applied when the attack has a single target. Switched off while Automated Conditions 5e or midi-qol's optional *Condition Rules* are active, which handle this themselves.

### Condition Advantage & Disadvantage
The system applies the movement, check and save parts of conditions, but not what they do to attack rolls, critical hits or Strength and Dexterity saves. This feature adds the Advantage and Disadvantage, so the roll dialog opens with the right mode already selected. When both apply, they cancel out as usual. Rules that depend on the target are only applied when the attack has a single target. Each condition can be turned off on its own:
* **Blinded & Invisible**: A creature that can't see its target attacks with Disadvantage. An attack against a creature that can't see the attacker has Advantage. Blinded creatures can't see anyone, and Invisible creatures can't be seen. *Blindsight* sees through both, and *Truesight* and *See Invisibility* see Invisible creatures, each only within its range. Walls and light aren't checked. Without a single target, a Blinded attacker still has Disadvantage and an Invisible one Advantage.
* **Restrained**: A Restrained creature attacks with Disadvantage, and attacks against it have Advantage.
* **Paralyzed, Petrified, Stunned & Unconscious**: Attacks against these creatures have Advantage. (An Unconscious creature is also Prone, so **Prone Attack Rolls** adds Disadvantage from more than 5 feet away, and the two cancel out, as the rules say.)
* **Poisoned, Exhaustion & Encumbrance**: A Poisoned creature attacks with Disadvantage. The same goes for 2014 exhaustion level 3, and for Heavily Encumbered (variant encumbrance) on Strength, Dexterity and Constitution attacks. The system lists these but only applies the ability check part.
* **Frightened**: A Frightened creature has Disadvantage on attack rolls and ability checks, including skills, tools and initiative. This applies whether or not the source of its fear is in sight.
* **Grappled (2024)**: With the 2024 rules, a Grappled creature attacks anyone but its grappler with Disadvantage. The grappler is the creature whose item or effect applied Grappled. If you set Grappled by hand from the token HUD, the grappler is unknown and nothing is applied.
* **Dodging**: Attacks against a Dodging creature have Disadvantage if it can see the attacker. As in the system, Dodging ends while the creature is Incapacitated or can't move.
* **Critical Hits Within 5 Feet**: A hit against a Paralyzed or Unconscious creature is a critical hit if the attacker is within 5 feet of it. A miss stays a miss, and a natural 1 still misses. The attack card shows the hit as critical and the damage dialog opens with **Critical** selected. Only applied when the attack has a single target. With midi-qol, the workflow's own hit check decides, and its damage is rolled as critical.
* **Failed Strength & Dexterity Saves**: Paralyzed, Petrified, Stunned and Unconscious creatures fail Strength and Dexterity saving throws automatically. The dice are still rolled, but the total counts as 0, a natural 20 isn't critical, and the chat card adds the reason (e.g. *fails automatically: Paralyzed*). Works for saves rolled from chat cards, the sheet and midi-qol.

Prone is under [Prone Rules](#prone-rules). Immunity to a condition is respected. The whole feature is switched off while Automated Conditions 5e or midi-qol's optional *Condition Rules* are active. **Blinded & Invisible** is also switched off while midi-qol's *Invisible Advantage* rule is on, which handles both through token vision.

### Auto-Rotate Prone / Unconscious / Dead Tokens
Automatically tilts tokens 90° clockwise when given the Prone or Unconscious condition (90° counter-clockwise for Dead), and restores them to 0° on recovery. Fully compatible with locked rotation and unlinked tokens.

### Auto-Roll / Prompt Concentration Saves
Prompts or rolls concentration saves (DC 10 or half damage) when a concentrating creature takes damage. It follows the system's own rules for when a save is due, so no save is rolled when the system skips one (for example when a Wild Shape or Polymorph ends, or when only the creature's maximum HP drops).
* **Player Ownership**: Prompts are delivered directly to the connected player owning the character.
* **Concentration Badges**: Chat cards feature an interactive **"Concentrating on: [Spell]"** badge with sheet shortcuts.
* **One-Click End**: Appends an **End Concentration** button directly to roll cards. It switches to "Concentration Ended" for everyone as soon as concentration ends, however it ended.
* **Boon of the Iron Mind**: Automatically exempts characters with *Unshakable Focus*.
* *Sub-settings*: **Fast-Forward Rolls** (NPCs Only, All, Players Only, Never), **Auto-End Concentration on Failure**.

### Mage Slayer: Concentration Disadvantage
Deals damage to a concentrating creature from an attacker with the Mage Slayer feat -> concentration save is automatically rolled with Disadvantage (or cancels with Advantage). Fully synchronized across clients and supports unlinked tokens. The disadvantage applies only to the next concentration save, and it lapses if no save is rolled within 2 minutes of the damage.

### Auto-End Concentration & Class Features
* **Auto-End Concentration**: Ends concentration when gaining Incapacitated, Unconscious, Dead, Paralyzed, Petrified, or Stunned (respecting Boon of the Iron Mind rules). Works for each unlinked token separately, even when several fall at once.
* **Auto-End Class Features**: Automatically ends Barbarian Rage, Wrath of the Sea, and Starry Form on incapacitating conditions (respecting Lv15+ Persistent Rage). Effects are disabled rather than deleted. Starry Form from the Player's Handbook content 3.0 (where you pick the constellation when assuming the form) is ended the same way as dismissing it, so the next use starts the form again. Wrath of the Sea only puts an effect on the druid from level 10 (Stormborn); below that there is nothing on the druid to end. Works for each unlinked token separately, even when several fall at once.

### Magic Resistance Automation
Creatures with **Magic Resistance** automatically roll saving throws against spells and magical effects with Advantage. Works when the save is rolled from a spell's or feature's chat card (including inline save links in chat). The roll dialog opens with Advantage pre-selected, and Disadvantage still cancels it out as usual.
* **Recognized Features**: Magic Resistance (monsters, Yuan-ti, Satyr), Spell Resistance (School of Abjuration, spells only), Gnome Cunning (2014, Intelligence, Wisdom and Charisma saves only) and an equipped, attuned Mantle of Spell Resistance (spells only). Homebrew features named "Magic Resistance" or "Spell Resistance" are recognized too.
* **Homebrew Flag**: Give any actor Magic Resistance with an Active Effect or flag `flags.niks-dnd5e-tweaks.magicResistance` = `true` (spells and magical effects) or `spell` (spells only).
* **Magical Monster Abilities**: Tick the **Magical** property on a monster feature (for example a Banshee's Wail) to make Magic Resistance apply against it. Breath weapons, claws and other mundane abilities are not affected.
* **Not Affected**: Concentration saves, death saves, and saves rolled from the character sheet without a source. Use the Retroactive Advantage buttons for edge cases.
* *Sub-settings*: **What Counts as Magical** (Spells Only, Spells & Magic Items, Spells, Magic Items & Magical Features).

### Death Ward Automation
The first time a creature under **Death Ward** would drop to 0 HP, it drops to 1 HP instead, the spell's effect is removed, and a chat message says so.
* **Recognized Effects**: the effect the spell applies (named "Protection from Death" in the 2024 Player's Handbook, or "Death Ward"), effects that come from a spell with the identifier `death-ward`, and any effect that sets the flag `flags.niks-dnd5e-tweaks.deathWard`.
* **Undead Fortitude**: a creature with both uses Death Ward first and doesn't roll.
* **Not automated**: the second part of the spell, which negates effects that kill instantly without dealing damage. Remove the effect by hand when that happens.

### Companion Level Sync
D&D 5e works out a summoned companion's bonuses (from the summoner's level, ability modifier and proficiency) only when it is summoned. A Beast Master's **Primal Companion** kept its old AC, hit points and attack bonus after the Ranger levelled up, until it was summoned again. This tweak updates the companion straight away.
* **When**: after a level-up (or a class level changed by hand), a class added or removed, or a change to the summoner's ability scores.
* **What updates**: everything the summon activity adds that depends on the summoner: bonus AC, bonus hit points and Hit Dice, matched proficiency bonus, matched attack bonus and save DC, and bonus damage or healing. A notification says which companion was updated.
* **Damage stays**: current hit points move by as much as maximum hit points, so a companion at 12 / 20 HP becomes 17 / 25. A companion at 0 HP stays at 0.
* **Which companions**: those summoned by a feature's D&D 5e Summon activity that keep one actor between summons (linked actors), such as the Player's Handbook Primal Companions. One-off copies (unlinked tokens) aren't changed.
* **Spells aren't changed**: summons from spells such as *Find Steed* scale with the level the spell was cast at, which only the cast knows.
* **Left as they are**: temporary hit points, the size and creature type picked when summoning, bonuses that roll dice, and bonus AC on companions with a flat AC value. Summon the companion again to update those.
* **Permissions**: the update is made by the player or GM whose change triggered it, and only for companions they own.

### Summon at Full HP
Companions that keep one actor between summons (linked actors, such as the Player's Handbook Primal Companions and Otherworldly Steeds) used to arrive with whatever hit points that actor had. A Primal Companion's first summon showed 5 / 20 HP, because D&D 5e raised its maximum but not its current hit points, and a companion summoned again kept the damage from last time. Now every summon arrives at full hit points, including the HP its summon adds.
* **Fresh creature**: Dead and Unconscious are removed too. Temporary hit points from the summon are kept.
* **Every summon counts**: summoning a damaged companion again restores it, since the rules treat each summon (or casting) as a new creature.
* **One-off copies** (unlinked tokens) already arrived at full HP and aren't affected.

### Damage Emanation Automation
Handles the "enters the area or ends its turn there" rule of emanation spells such as *Spirit Guardians*, *Conjure Woodland Beings*, *Cacophonic Shield*, *Dirge* and *Yolande's Regal Presence*, and of placed areas and walls such as *Moonbeam*, *Cloudkill*, *Doomtide*, *Web* and *Wall of Fire*:
* **Spells Covered by Default**: *Blade Barrier*, *Cacophonic Shield*, *Cloud of Daggers*, *Cloudkill*, *Conjure Woodland Beings*, *Control Water* (Whirlpool only), *Dirge*, *Doomtide*, *Evard's Black Tentacles*, *Forbiddance*, *Grease*, *Gust of Wind*, *Incendiary Cloud*, *Insect Plague*, *Jallarzi's Storm of Radiance*, *Moonbeam*, *Sleet Storm*, *Spirit Guardians*, *Stinking Cloud*, *Wall of Fire*, *Wall of Thorns*, *Web* and *Yolande's Regal Presence*.
* **Triggers**: A creature enters the area, the area moves into a creature's space (an emanation moving with its caster, or *Moonbeam* being moved), or a creature ends its turn inside it. Some spells use other triggers, as written: *Web* and *Sleet Storm* trigger when a creature enters or starts its turn inside, *Stinking Cloud* only at the start of a turn, *Gust of Wind* only at the end of a turn.
* **Saves, Damage or Both**: The spell's own activity is used. Spells with a save (*Spirit Guardians*, *Grease*) show the save card. Spells that deal damage without a save (*Cloud of Daggers*, *Wall of Fire*, *Forbiddance*) roll their damage against the triggered creatures.
* **Who Is Affected**: An emanation centered on the caster never affects the caster. Placed areas such as *Moonbeam* and *Cloudkill* affect every creature inside, including the caster and their allies, as written. *Gust of Wind* never affects its caster.
* **Drifting Areas** (optional, off by default): *Cloudkill*, *Doomtide* and *Incendiary Cloud* move 10 ft straight away from the caster at the start of each of the caster's turns. Creatures the area moves onto make their save. If the area is centered exactly on the caster, it stays put so the GM can move it. *Incendiary Cloud* lets the caster choose the direction: move it on the Regions layer instead if they want another one.
* **Walls**: *Wall of Fire*, *Wall of Thorns* and *Blade Barrier* trigger for creatures in the wall's own area. *Wall of Fire*'s damage to creatures ending their turn within 10 ft of its burning side isn't automated. A *Wall of Fire* ring covers its whole inside, as if the inner side burns.
* **Areas Drawn by Hand** (*Forbiddance*, or any spell without a template): Draw a region, add the **Damage Emanation** behavior, and drop the spell from the caster's sheet onto its **Spell** field. Pick the forbidden creature types in **Creature Types**. A creature that speaks the password can be left out on the prompt card.
* **Behavior Settings**: A region's **Damage Emanation** behavior also has **Triggers** (leave empty to follow the spell) and **Creature Types** (leave empty to affect all creatures).
* **Once Per Turn**: Each creature makes the save only once per turn for each emanation.
* **Casting Is Left Alone**: Creatures already inside when the spell is cast are handled by the spell's own cast activity and aren't triggered again by the emanation.
* **Only Real Movement Counts**: Turning the emanation's behavior off and on, revealing a hidden emanation, or placing or summoning a token inside it doesn't count as entering.
* **Batched**: Creatures triggered at the same moment (for example when the caster walks past several enemies) share one save card. In the prompt modes, creatures triggered later in the same turn are added to that turn's card until someone rolls or skips it. Creatures sharing an initiative count (for example a group of identical monsters taking their turns one after another) share a card too.
* **Native Save Card**: Uses the spell's save activity at the level it was cast, without spending a spell slot. Save buttons, half damage, damage application and conditions such as Deafened (*Cacophonic Shield*) or Prone (*Dirge*) work as usual. Conditions applied from it end when the caster stops concentrating.
* **Moving Moonbeam**: Move the *Moonbeam* area on the Regions layer when the caster takes the Magic action to move it. Creatures it moves onto make their save.
* **Emanation Always Placed**: Casting a listed spell always offers to place its emanation, even if the spell's casting activity has template placement turned off (*Yolande's Regal Presence*).
* **Upcasting**: Damage scales with the slot the spell was cast with, including Pact Magic slots.
* **Concentration Cleanup**: The emanation or area is removed from the scene when the caster stops concentrating on the spell. Areas of spells without concentration (*Grease*, *Forbiddance*) stay until the GM removes them.
* **Not Automated**: Being pushed (*Gust of Wind*), losing concentration (*Sleet Storm*) and breaking free (*Web*, *Evard's Black Tentacles*) are left to the table.
* **Trigger Mode**: **Prompt Caster** (default) whispers a card to the caster's owners and the GM, listing the triggered creatures with checkboxes and **Roll Saves** / **Skip** buttons (**Roll Damage** for spells without a save). Only the first click counts, so the saves are never rolled twice. **Prompt GM Only** sends it to the GM only. **Automatic** rolls straight away.
* **Other Spells**: Add spell identifiers to the **Emanation Spells** list, or add the **Damage Emanation** behavior in an activity's **Behaviors** tab and pick its save or damage activity and its triggers.
* *Sub-settings*: **Trigger Mode**, **Emanation Spells** (worlds that changed the list keep their own version: add new spells there by hand), **Only During Combat** (default on), **Exclude Allies** (creatures with the caster's token disposition are never affected by emanations centered on the caster or by spells that let the caster choose, default on), **Move Drifting Areas** (*Cloudkill*, *Doomtide* and *Incendiary Cloud*, default off), **Respect "Creature You Can See"** (*Conjure Woodland Beings* and *Yolande's Regal Presence* skip hidden and invisible creatures, default on), **Remember Damage Type** (*Spirit Guardians* keeps the Radiant or Necrotic choice from its first roll, default on).

### Self Effect Application Prompt
When using self-buff abilities (*Rage*, *Divine Favor*, *Mirror Image*) or targeting self with spells (*Haste*, *Bless*, *Shield of Faith*, *Blur*), whispers a chat card with one-click **Apply** and **Undo** buttons.
* Full concentration linking: automatically attaches concentration dependency (`flags.dnd5e.dependentOn`), properly preserving separate concentration tracking and terminating when concentration breaks.
* Seamless compatibility with **Automated Conditions 5e (AC5e)** dynamic condition flags.
* *Sub-setting*: **Always Prompt Features** (names like `Mage Armor`).
* *Sub-setting*: **Auto-Apply Effects** (effect names; the default covers self-only class and subclass features, feats, species traits and self-only spells from the Player's Handbook, such as `Rage`, `Bladesong`, `Innate Sorcery`, `Dodging` and `Dashing` (Patient Defense, Step of the Wind), `Divine Favor` and `Imperceptible Barrier`): matching effects are applied directly to the source token. The chat card is still posted, showing them as applied with an **Undo** button, and the effect tray of the activity's chat card is collapsed.
* Both name lists are edited in the settings dashboard with an **Edit List** button that opens a pop-out editor: search the list, add entries (Enter, or paste several separated by commas), remove them individually, or reset to the defaults. Lists are kept sorted alphabetically without duplicates.

### Self-Targeted Activities Target Self
Players often still have an enemy targeted from their last attack when they use an ability that only affects themselves (*Second Wind*, *Rage*, *Bladesong*). D&D 5e then lists that enemy on the chat card, and the **Targeted** mode of the damage, healing and effect trays points at it. With this feature on, abilities whose target is **Self** list the user's own token instead, on the usage card and on their damage, healing and formula rolls.
* The user's own targets are not changed, so they can go straight back to attacking the same enemy.
* If the user's token isn't on the viewed scene, the cards list no targets.
* Bypassed while midi-qol is active (midi-qol already targets the user's own token for these abilities).
* *Sub-setting*: **Show Notification** (default on): tells the user when their targets were replaced.
* Players can turn it off for themselves in **Personal Preferences**.

### Disable Active Effect Expiry
Stops D&D 5e from ending and deleting Active Effects on its own (out of combat, at the end of combat, on a rest, and at turn-based expiry). Effects stay until you turn them off or remove them. Off by default.

---

## 🛠️ Silent System Patches
 
Patches are zero-configuration, always-on fixes for confirmed upstream system or core bugs:
* **Skill Tooltip Overlap**: Fixes character sheet skill and tool list reference tooltips appearing directly on top of neighboring rows, ensuring clickable links remain unobstructed.
* **Free Cast Spell Level Picker**: Spells that are never cast with a spell slot (e.g. *Mystic Arcanum*, feat or innate spells cast with item uses) no longer show the **Cast at Level** choice in the usage dialog and are cast at their base level. Follow-up activities of spells cast with a slot (e.g. *Moonbeam*'s damage) keep it, so you can pick the level the spell was cast at. On D&D 5e below 6.1.0, the misleading "no available spell slots" warning is also removed from any spell activity that doesn't use a slot (fixed upstream in 6.1.0).
* **Pact Magic Formula Scaling**: Dynamically corrects damage and healing formulas for Pact Magic spells to reflect the caster's pact slot level in sheet inventory rows and activity tables.
* **Damage Application Tray Grouping**: Prevents an upstream D&D 5e system TypeError (`token.getGroupingKey is not a function`) when rendering damage application trays for targets resolved via actor UUID or unplaced tokens.
* **Animated HP Bars**: Foundry VTT V14 smoothly animates token resource bars when their values change, but the D&D 5e HP bar skipped the animation and jumped straight to the new value. HP bars (including temporary HP and temporary max HP) now slide to their new value and colour like every other bar.
* **Untyped Healing**: A heal activity whose healing part has no type selected (common on imported or hand-made items) was rolled as untyped, and D&D 5e treated it as damage: the tray offered **Apply Damage** and hurt the target. Such healing now rolls as Healing. Healing rolls already in chat are fixed too and apply as healing.
* **Roll Dialogs Off-Screen**: Roll dialogs open where you click. When a dialog grew after opening (for example once its dice images loaded), its buttons could end up below the bottom of the screen until you dragged it up. Dialogs that grow are now moved back up so they stay fully visible. A dialog you dragged somewhere stays where you put it.
* **Rich Tooltip Race**: Item, spell and other rich tooltips load after you hover. When the cursor swept quickly across many rows (Compendium Browser, inventories, spell lists), every row you passed started loading its tooltip, and whichever finished last was shown: the tooltip kept changing after you stopped and could show the wrong item. Tooltips that finish loading after you have moved on are now ignored, so the tooltip always shows the item under the cursor.

---

## ⚙️ Settings Dashboard & Personal Preferences

All features are managed in the shared **Settings Dashboard** of [Nik's Foundry Tweaks](https://github.com/nschoenwald/niks-foundry-tweaks#️-settings-dashboard--personal-preferences), opened from *Configure Settings → Nik's Foundry Tweaks → Configure Module*. Nik's DnD5e Tweaks has no section of its own in Configure Settings any more. The dashboard holds the settings of both modules in one window; settings from this module carry a small **5e** badge. Rolls & Damage and Conditions & Effects are tabs of their own; everything else joins the shared UI & Visuals, Canvas & Tokens, Combat Flow and Personal Preferences tabs.

* **Personal settings that override the GM's**: For Chat Card Styling Improvements, Item Sheet Attunement Tag (and its tooltip option), Item / Spell Add: Choice Dialog, Spell Slots Expend Left to Right, Roll Mode Highlight, Cursor Keyboard Hints, Template Placement Controls HUD, Enhanced Summoning Placement HUD and Token HUD Condition Palette, each player chooses **Use World Setting** (default), **On** or **Off**, so they can also turn these on when the GM left them off. All other personal settings only turn a feature off for that player, because the GM's choice matters for the whole table (rules, automation, shared templates, or what players learn about NPCs).
* **Search, filters, New badges, linked world and personal settings, Export / Import**: see the dashboard description in Nik's Foundry Tweaks. Exports made before 14.70.0 can still be imported; the settings that moved are restored in Nik's Foundry Tweaks.
* **Deep links**: Some features link straight to their settings, e.g. the gear in the Token HUD's status palette. Macros can do the same with `game.modules.get("niks-dnd5e-tweaks").api.openSettings("settingKey")`.
* **Unavailable Settings**: Settings for features that turn themselves off because another module handles the job are greyed out and locked, with a badge naming that module. This covers midi-qol (template auto-targeting, template grid snapping, attack damage prompts / auto-rolls, auto-open damage for saves), Automated Masteries 5e (Weapon Mastery Automation), and Automated Conditions 5e or midi-qol's Condition Rules (Prone Attack Rolls, Condition Advantage & Disadvantage). Your stored choice is kept for when that module is turned off.
* **Debug Mode**: One switch in Nik's Foundry Tweaks (Utilities & Debug) turns on diagnostic logging for both modules.

---

## 🤝 Module Compatibility

Nik's DnD5e Tweaks includes built-in compatibility guards to ensure conflict-free operation:

### midi-qol Integration Matrix
When [midi-qol](https://gitlab.com/tposney/midi-qol) is detected, features that would do the same job as midi-qol step back, and features midi-qol doesn't cover keep working inside its workflows:

| Feature | Behavior with midi-qol |
|---|---|
| **Auto-Open Damage for Saves** | **Disabled** (midi-qol handles save damage workflows). |
| **Prompt / Auto-Roll Attack Damage** | **Disabled** (use midi-qol's *Auto Roll Damage*). Auto-rolling static damage without a dialog still works. |
| **Auto-Roll Concentration Saves** | **Bypassed** when midi-qol's *Force a concentration save* is set to *Chat Message + Auto Roll* or *Roll Concentration Item*. With *Chat Message Only* or *Never*, this feature rolls the save as usual. Prompts are no longer redirected to players while midi-qol handles concentration, and concentration isn't ended twice when midi-qol's *Remove concentration on failed save* is on. Boon of the Iron Mind still skips the save. |
| **Self Effect Application** | **Bypassed** if midi-qol auto-applies item effects. |
| **Self-Targeted Activities Target Self** | **Disabled** (midi-qol already uses the actor's own token for self-targeted activities). |
| **Player Damage Prompt** | **Bypassed** if midi-qol auto-applies damage, and for damage rolled inside a midi-qol workflow. |
| **Auto-Apply Status at 0 HP** | When midi-qol's *Add Dead/Unconscious* is on, midi-qol picks the 0 HP status (and marks defeated if its settings say so). This feature still escalates to Dead after three failed death saves, cleans up on healing and removes tokens from combat. |
| **Snap Templates to Grid Intersections** | **Disabled** (use midi-qol's *Template Grid Snapping*). |
| **Auto-Target Tokens in Spell Templates** | **Disabled** (midi-qol targets templates itself). |
| **Rules-Accurate Cones on Square Grids** | **Disabled** (midi-qol targets cones from its own cone shape, which would not match the squares). |
| **Grid-Based Templates** | **Works**: midi-qol targets the grid-based template shape. |
| **Remove Instantaneous Templates on Turn Change** | **Works**. With midi-qol's *Auto remove instantaneous templates* on, midi-qol already deletes them right after the roll. |
| **Weapon Mastery Automation** | **Works** with midi-qol workflows: Sap, Slow and Vex are applied to the targets midi-qol says were hit, and Topple asks for its save when midi-qol applies the damage. If midi-qol's own Weapon Mastery automation (through CAT) is set up for a character, Sap, Slow, Topple and Vex step aside for that character, since midi-qol applies those masteries itself. |
| **Reckless Attack Automation** | **Works** with midi-qol workflows. When midi-qol skips the attack dialog, the Yes / No prompt asks instead; when it shows the dialog (e.g. for thrown weapons), the checkbox is there. Advantage against a Reckless creature uses the workflow's target. A premade Reckless Attack item with its own effect counts as Reckless too. |
| **Conditional Damage Bonuses** | **Works** with midi-qol workflows. Great Weapon Fighting also applies to midi-qol's damage rolls (midi-qol has no automation of its own for it). Sneak Attack reads Advantage from midi-qol's attack roll (including its optional flanking rule) and checks only the targets midi-qol says were hit. Genie's Wrath works the same way as without midi-qol. midi-qol has no Sneak Attack automation of its own, but a premade Sneak Attack item from another module would add the damage a second time: turn one of them off. The Player's Handbook feature and spell bonuses (Divine Strike, Colossus Slayer, Eldritch Smite, Empowered Evocation, …) and Elemental Adept work the same way; Colossus Slayer checks the targets midi-qol says were hit. Premade automations of those features from other modules would also add their damage twice. |
| **Prone Rules** | **Works** with midi-qol: attack rolls in midi-qol workflows get the same Advantage / Disadvantage, using the workflow's targets. Movement isn't affected by midi-qol. **Prone Attack Rolls** is switched off while midi-qol's optional *Condition Rules* are on. |
| **Condition Advantage & Disadvantage** | **Works** with midi-qol workflows, using the workflow's targets. Critical hits within 5 feet follow midi-qol's hit check and make the workflow critical; failed saves count as 0 in midi-qol's save check. Switched off while midi-qol's optional *Condition Rules* are on, which apply the same rules. **Blinded & Invisible** is also switched off while midi-qol's *Invisible Advantage* rule is on (its default), which checks token vision instead. |
| **Magic Resistance Automation** | **Works** with midi-qol save requests, covering Spell Resistance, Gnome Cunning and the Mantle of Spell Resistance, which midi-qol doesn't recognise. |
| **Undead Fortitude Automation** | **Works** with midi-qol damage application, which has no Undead Fortitude handling of its own. Critical hits come from the midi-qol workflow. midi-qol's damage card may still show 0 HP for the creature while it is held at 1 HP. |
| **Death Ward Automation** | **Works** with midi-qol damage application, which has no Death Ward handling of its own. midi-qol's damage card may still show 0 HP for the creature. |
| **Retroactive Advantage / Disadvantage** | Not offered on midi-qol workflow cards, since midi-qol wouldn't re-check hits and saves. |
| **Mage Slayer Concentration** | **Fully compatible** with midi-qol damage workflows and its concentration checks. |
| **Chat Card Styling Improvements** | **Works** on midi-qol cards, including its merged card. midi-qol's Attack, Damage and Apply Effects buttons are color-coded to match. With midi-qol's *Colored Border Messages* on, the player's color keeps the card's left edge. Results midi-qol hides from players stay hidden. |
| **Detailed Roll Breakdown Overlay** | **Works** on midi-qol's combined card: the attack and damage totals show the detailed breakdown, with midi-qol's advantage and bonus notes kept at the top, and the formula shows the short labels (STR, PB, MGC). Rolls midi-qol hides from players stay hidden. |

### Automated Conditions 5e & Automated Masteries 5e
* **[Automated Conditions 5e](https://github.com/thatlonelybugbear/automated-conditions-5e)**: Advantage from Magic Resistance, Mage Slayer and Sap is picked up by AC5e's own calculation. AC5e handles Advantage and Disadvantage for Prone and the other conditions itself, so **Prone Attack Rolls** and **Condition Advantage & Disadvantage** are switched off; crawling and the cost of standing up keep working. **Roll Mode Highlight** follows the button AC5e recommends, so both modules highlight the same choice.
* **[Automated Masteries 5e](https://github.com/thatlonelybugbear/wm5e)**: wm5e automates all weapon masteries, so **Weapon Mastery Automation** (Sap, Slow, Topple & Vex) and the **Graze** damage prompt are switched off, and the **Cleave** toggle is removed from damage dialogs (wm5e already rolls the Cleave attack without the ability modifier).

### Other Supported Modules
* **libWrapper**: All method and property overrides across combat automation, canvas layers, sheet hooks, and UI components automatically register cooperatively via `libWrapper` when installed (preventing conflict warnings with modules like Monk's Combat Details), while maintaining zero-dependency standalone fallback wrapping.
* **Monk's Combat Details**: Seamless combat turn progression and target resolution compatibility.
* **Monk's Little Details**: Its "Alter Token HUD Status" changes are switched off while the **Token HUD Condition Palette** is on, so they don't clash.
* **Tidy 5e Sheets**: Full support for Classic & Quadrone sheets (including Compendium choice dialogs).
* **Carolingian UI**: With Nik's Foundry Tweaks' Carolingian UI Theme Harmony on, chat cards, the template and summoning HUDs and legendary action placeholders in the Combat Carousel follow the Carolingian theme too.
* **Dice So Nice (DSN)**: Synchronized 3D dice rolling for retroactive advantage and damage prompts.

---

## 🌐 Languages

🇬🇧 English · 🇩🇪 Deutsch · 🇫🇷 Français (thanks Kameleau)

Translations into other languages by native speakers are welcome as an issue or pull request.

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
* **Foundry VTT**: Version 14 (maximum 14)
* **[Nik's Foundry Tweaks](https://github.com/nschoenwald/niks-foundry-tweaks)**: 14.0.0 or later (Foundry offers to install it along with this module)
* **DnD5e System**: Version 6.0.0 to 6.1.x (verified with 6.1.0, 6.0.x still supported)

---

## ❤️ Modules by Nik

### 🧩 Nik's Tweaks
* **[Nik's Foundry Tweaks](https://github.com/nschoenwald/niks-foundry-tweaks)** – System-independent quality-of-life tweaks and the shared settings dashboard of Nik's Tweaks modules.

### 🎲 D&D 5e Specific
* **[Nik's DnD5e Tweaks](https://github.com/nschoenwald/niks-dnd5e-tweaks)** – Consolidated collection of quality-of-life enhancements and combat automation tweaks for DnD5e.
* **[Nik's Give & Take](https://github.com/nschoenwald/niks-give-and-take)** – Players hand items and money to other characters and the party, and take them from the party's stash.

### ⚔️ Combat & Token Tools
* **[Nik's Action HUD](https://github.com/nschoenwald/niks-action-hud)** – Sleek, modern canvas-docked Action HUD for quick access to attacks, spells, inventory, and utility rolls.
* **[Nik's Effects Panel](https://github.com/nschoenwald/niks-effects-panel)** – Floating panel next to the sidebar that shows the selected token's active effects, to check, disable or remove them without opening the character sheet.
* **[Nik's Token Tags](https://github.com/nschoenwald/niks-token-tags)** – Automatically numbers duplicate combatant NPCs (A, B, C…) with color-coded letter overlays.
* **[Nik's Shared NPC Initiative](https://github.com/nschoenwald/niks-shared-npc-initiative)** – Groups NPCs of the same type in combat so they share a single initiative roll.
* **[Nik's Movement Control](https://github.com/nschoenwald/niks-movement-control)** – GM controls to toggle player movement and automatically restrict/allow movement on combat start and end.
* **[Nik's Token Motion](https://github.com/nschoenwald/niks-token-motion)** – Tokens hop square by square like miniatures, lift and set down like chess pieces, or glide smoothly, and long moves no longer crawl across the map.
* **[Nik's Tiny Change Logs](https://github.com/nschoenwald/niks-tiny-changelogs)** – Compact, single-line chat messages logging token HP and Temp HP changes.

### 🎨 Visuals & Display
* **[Nik's Dynamic Roll Area](https://github.com/nschoenwald/niks-dynamic-roll-area)** – Dynamically restricts Dice So Nice 3D dice rolling area to exclude the sidebar / chat log across all screen resolutions and window sizes.

### ⚙️ Utilities & System Management
* **[Nik's Settings Locks](https://github.com/nschoenwald/niks-settings-locks)** – Soft-lock and hard-lock client settings and keybindings across all connected players.
* **[Nik's Compendium Search Tweaks](https://github.com/nschoenwald/niks-compendium-search-tweaks)** – Configure which compendium packs are included or excluded from native sidebar search.
* **[Nik's Copy Environment](https://github.com/nschoenwald/niks-copy-environment)** – Copy the list of systems, modules, and versions, and export/import game and player settings.
* **[Nik's Show & Tell](https://github.com/nschoenwald/niks-show-and-tell)** – Share popout images to chat and paste image files directly into chat messages.
* **[Nik's Zoom / Pan Options](https://github.com/nschoenwald/niks-zoom-pan-options)** – Touchpad and scroll wheel pan/zoom controls and canvas navigation enhancements.
* **[Nik's Scene Transformations](https://github.com/nschoenwald/niks-scene-transformations)** – Rotate scenes or add playable space around them, with tokens, walls, lights, tiles and regions moved along so everything stays in place.
* **[Nik's Wall Height](https://github.com/nschoenwald/niks-wall-height)** – Give walls a bottom and top elevation, so tokens, lights and sounds above or below a wall ignore it.
* **[Nik's Scene Defaults](https://github.com/nschoenwald/niks-scene-defaults)** – Set your own defaults for new scenes (grid, vision, fog, lighting, background and more), so you don't have to change them on every scene.
