# Nik's DnD5e Tweaks

[![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-V14-orange.svg)](https://foundryvtt.com)
[![DnD5e System](https://img.shields.io/badge/DnD5e-6.0%2B-blue.svg)](https://github.com/foundryvtt/dnd5e)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/nschoenwald/niks-dnd5e-tweaks?color=purple)](https://github.com/nschoenwald/niks-dnd5e-tweaks/releases/latest)

A consolidated, modular collection of quality-of-life enhancements and smart combat automations for **Foundry VTT (v14)** and the **DnD5e system (6.x)**.

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
| **[Detailed Roll Breakdown Overlay](#detailed-roll-breakdown-overlay)** | UI & Visuals | ✅ Enabled | Yes |
| **[Chat Card Styling Improvements](#chat-card-styling-improvements)** | UI & Visuals | ✅ Enabled | Yes |
| **[Item Sheet Attunement Tag](#item-sheet-attunement-tag)** | UI & Visuals | ✅ Enabled | Yes |
| **[Item / Spell Add: Choice Dialog](#item--spell--feature-add-choice-dialog)** | UI & Visuals | ✅ Enabled | Yes |
| **[Roll Mode Highlight](#roll-mode-highlight)** | UI & Visuals | ✅ Enabled | Yes |
| **[Sheet Pop-out Button](#sheet-pop-out-button)** | UI & Visuals | ✅ Enabled | Yes |
| **[Pact Magic Formula Scaling Fix](#pact-magic-formula-scaling-fix)** | UI & Visuals | ✅ Enabled | Yes |
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
| **[Aggregate Short Rest Hit Dice Rolls](#aggregate-short-rest-hit-dice-rolls)** | UI & Visuals | ✅ Enabled | Yes |
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
| **[Conditional Damage Bonuses (Hex, Hunter's Mark, Sneak Attack, GWM, Charger, Savage Attacker, Boon of Irresistible Offense & Cleave)](#conditional-damage-bonuses-sneak-attack-hex--hunters-mark)** | Combat & Automation | ✅ Enabled | Yes |
| **[Weapon Mastery Automation (Slow & Sap)](#weapon-mastery-automation)** | Combat & Automation | ✅ Enabled | Yes |
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

<img width="297" height="202" alt="image" src="https://github.com/user-attachments/assets/a04c6f5b-859a-41f4-bada-ea7e9750a83c" />

### Chat Card Styling Improvements
Modernizes DnD5e chat cards to make actions and roll results readable at a glance:
* **Color-Coded Action Buttons**: Enlarges card buttons with clear labels and colors: Royal Violet for Attack, Flame Orange for Damage, Cobalt Blue for Saves, Warm Bronze for Checks, Forest Green for Healing, Azure Blue for Temp HP, Jade for Transform, Orchid for Summon, Indigo for Teleport, Cyan for Use, and Ruby for Templates.
* **Enlarged Targeted / Selected Button**: Expands the target mode toggle button in usage cards and damage/effects trays into an easy-to-click, full-height button displaying both icon and dynamic label (**Targeted** / **Selected**), paired with clean, vertically stacked target pills.
* **Multi-Die d20 Indicators**: Displays all individual dice rolled on advantage or disadvantage side-by-side (bold kept die, dimmed discarded die) with collision avoidance.
* **Saving Throw Shorthand**: Automatically labels saving throw action buttons and roll cards with their ability shorthand (e.g. **CON Save** or **STR Save**) instead of generic Save labels whenever Chat Card Styling Improvements is active.
* **Themed Message Badges**: Prominent pill badges for Whispers (🔒), Private Rolls (🔒), Blind Rolls (👁), and Emotes (✦).

<img width="295" height="581" alt="image" src="https://github.com/user-attachments/assets/9dc57592-74e8-428f-b6aa-cc4d6cfde6ac" />

### Detailed Roll Breakdown Overlay
Transforms the native DnD5e roll breakdown popover (opened by clicking on the roll total button on chat cards) into a comprehensive, readable breakdown showing the base die and the origin of every bonus or penalty:
* **All Roll Types**: Fully supports attacks, checks, saves, damage cards, and regular dice rolls (which collapse into the chat card's roll accordion until clicked).
* **Theme Aware**: Text and borders follow the light/dark theme of the chat card automatically, for any combination of Interface, App and Chat theme settings.
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
* **Condition Reductions**: Color-codes penalties such as Exhaustion or *Bane*.
* **Two-Tier Architecture**: Proactively annotates roll formulas at roll creation and retroactively deduces sources for rolls already in chat history.
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

### Sheet Pop-out Button
Adds a dedicated **↗ pop-out button** to Actor and Item sheet window headers to detach them into separate browser windows with one click. Automatically hides when already detached.

### Pact Magic Formula Scaling Fix
Fixes an upstream DnD5e 6.x issue where Pact Magic spells on character and NPC sheets display unscaled base damage/healing formulas (e.g. 2d10 instead of 4d10 for a 1st-level *Hellish Rebuke* on a 5th-level Warlock) in the Formula column and activity rows. Formulas now dynamically scale to the caster's derived pact slot level.

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

<img width="774" height="677" alt="image" src="https://github.com/user-attachments/assets/aeb11a42-ec74-424a-84e1-6521cb3fd092" />

### Auto-Target Tokens in Spell Templates
Automatically selects and targets tokens inside spell templates during placement and updates targets in real time.
* **Origin / Source Token Exclusion**: Cones and lines/rays exclude the caster from targeting, and emanations exclude the token that is both the source and the attached token for the region in accordance with D&D 5e / 2024 rules.
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
Adds a dedicated crosshair button to the canvas Token Controls toolbar, positioned directly below the core Select Targets button. Players clear their own targets; GMs clear targets across the entire canvas simultaneously.

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

### Weapon Mastery Automation
Automatically creates and manages Active Effects when attacks hit with mastery weapons used by player characters:
* **Player Character Only**: Triggers strictly on attacks made by player characters possessing the required mastery trait, leaving NPC mechanics unaffected.
* **Sapped (Weapon Mastery)**: Target creature gains Disadvantage on its next attack roll before the start of the attacker's next turn. Automatically expires once the sapped creature rolls an attack, or at the start of the attacker's next turn.
* **Slowed (Weapon Mastery)**: Reduces target creature's Speed by 10 ft across all movement modes (via native movement bonus). Automatically expires at the start of the attacker's next turn.
* **Duplicate Prevention**: Creatures cannot have duplicate Sap or Slow effects applied simultaneously; hitting a target multiple times with Slow weapons caps the reduction at 10 ft.
* **Combat Lifecycle Management**: Lingering mastery effects are automatically cleaned up when combat ends.
* *Sub-settings*: Configurable active effect icons for Sap and Slow.

### Conditional Damage Bonuses (Sneak Attack, Hex, Hunter's Mark, Great Weapon Master, Brutal Strike, Charger, Savage Attacker, Boon of Irresistible Offense & Cleave)

<img width="394" height="595" alt="image" src="https://github.com/user-attachments/assets/5a754d05-167a-472c-943e-440fb347fd5f" />

Offers seamless toggles in damage roll configuration dialogs for conditional damage bonuses:
* **Sneak Attack**: Available for Rogues and monsters/NPCs with Sneak Attack features (e.g. Assassin, Spy) when attacking with a finesse or ranged weapon. Automatically resolves the native scale value formula (e.g. `1d6`, `2d6`, etc.) and inherits the weapon's damage type and magical properties. In combat it is enabled by default only until used once per turn, then defaults to off for later attacks that turn; outside combat it remembers your last choice.
* **Great Weapon Master (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `great-weapon-master` feat gain an optional toggle when attacking with Heavy weapons to deal extra damage equal to their Proficiency Bonus (+PB), flavored with `GWM` and matching the weapon's damage type. When an active combat encounter is underway, this bonus is offered strictly on the attacker's own turn (and withheld on opportunity attacks, reaction strikes, or attacks on other turns, since Heavy Weapon Mastery only applies to attacks from the Attack action on your turn). Outside of combat, it remains available for out-of-combat attacks.
* **Brutal Strike (2024 Rules)**: Under 2024 (modern) rules, characters possessing the Brutal Strike feature (`brutal-strike` identifier) gain an optional toggle on their turn to deal extra damage via `@scale.barbarian.brutal-strike` (e.g. `1d10`, or `2d10` at 17th level) matching the weapon or unarmed strike's damage type. Not offered on finesse weapons when your Dexterity modifier exceeds Strength. In combat, it is offered strictly on your turn and only once per turn. Defaults to disabled on every roll.
* **Charger (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `charger` feat gain an optional toggle for melee attacks (melee weapons and unarmed strikes) to deal an extra `1d8` damage matching the weapon or unarmed strike's damage type. Strictly excludes ranged weapons, thrown attacks, and spell attacks. Always offered for melee attacks outside of combat. During combat, it validates that it is the attacker's turn, that the attacker has moved at least 10 feet on their current turn, and that it has not already been used that turn. Defaults to disabled and automatically resets to disabled after use.
* **Savage Attacker (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `savage-attacker` feat gain an optional toggle on weapon attacks to roll the weapon's damage dice twice and use the higher roll (evaluated seamlessly via native `{dice, dice}kh` dice pools). Enabled by default on the first eligible weapon attack of each turn, and automatically defaults to disabled for any subsequent attacks on that same turn once used.
* **Boon of Irresistible Offense (2024 Rules)**: Under 2024 (modern) rules, characters possessing the `boon-of-irresistible-offense` feat gain an optional toggle when rolling a 20 on the d20 for an attack roll. Adds flat extra damage equal to the ability score increased by the feat (determined from advancement data, or defaulting to the higher of Strength and Dexterity). Matches the attack's damage type. Strictly offered only when the attack roll's d20 rolled a natural 20, and always enabled by default whenever offered.
* **Cleave Weapon Mastery (Damage Malus)**: When a player character attacks with a weapon whose Cleave mastery they have unlocked under 2024 rules (never offered for NPCs), provides a toggle for the secondary attack that removes the ability score modifier from the damage formula (unless negative). Disabled by default and strictly one-off (never remembered for subsequent rolls).
* **Hex (+1d6 Necrotic)**: Adds `1d6 necrotic` damage when hitting your hexed target while concentrating on Hex.
* **Hunter's Mark (+1d6 Force)**: Adds `1d6 force` damage when hitting your quarry while concentrating on Hunter's Mark.
* **Persistent Choice Memory**: Remembers whether each bonus was toggled ON or OFF across attacks and fast-forward rolls (Cleave, Brutal Strike, and Charger are exempted and always reset to disabled by default, while Savage Attacker and Boon of Irresistible Offense always default to enabled on eligible rolls), so players can keep bonuses enabled while attacking their quarry and quickly toggle them off when striking other creatures or after expending their once-per-turn benefits.
* **Live Reactive Preview & Zero-Layout-Shift**: Toggling bonuses or changing weapon damage types in the dialog updates the formula line, dice preview, and Sneak Attack/GWM/Brutal Strike/Charger/Boon of Irresistible Offense damage types in real time. If the weapon's base damage has no damage type, generic bonuses remain untyped (matching the weapon) rather than falling back to piercing damage, and untyped damage parts are cleanly labeled as **Pure** with their corresponding damage icon instead of generic "Formula". Inactive bonus formula rows are stably preserved and cleanly greyed out with disabled inputs, eliminating window jumping and layout shifts.
* **Critical Hit Doubling**: Automatically doubles bonus dice on critical hits according to 5e rules, while properly preventing weapon-specific extra critical dice (e.g. Savage Attacks or Brutal Critical) from duplicating onto conditional damage pools. Flat bonuses like GWM and Boon of Irresistible Offense do not duplicate.
* **Detailed Breakdown Integration**: Labels each bonus distinctly (`Sneak Attack`, `Hex`, `Hunter's Mark`, `GWM`, `Brutal Strike`, `Charger`, `Savage Attacker`, `Boon of Irresistible Offense`) with proper damage type icons in the Detailed Roll Breakdown Overlay, and explicitly labels damage type headers as subtotals (e.g. `PIERCING TOTAL 8`, `FORCE TOTAL 5`) across multi-damage cards.

### Prevent Rolling as Group Actors
Prevents players controlling group or exploration party tokens from accidentally rolling as the group actor. Automatically redirects the roll context to their assigned character sheet with accurate ability modifiers and proficiency.

### Self Effect Application Prompt
When using self-buff abilities (*Rage*, *Divine Favor*, *Mirror Image*) or targeting self with spells (*Haste*, *Bless*, *Shield of Faith*, *Blur*), whispers a chat card with one-click **Apply** and **Undo** buttons.
* Full concentration linking: automatically attaches concentration dependency (`flags.dnd5e.dependentOn`), properly preserving separate concentration tracking and terminating when concentration breaks.
* Seamless compatibility with **Automated Conditions 5e (AC5e)** dynamic condition flags.
* *Sub-setting*: **Always Prompt Features** (comma-separated names like `Mage Armor`).

### Legendary Action Placeholders
Inserts placeholder turns after player characters in the initiative tracker to help track legendary action phases, featuring automatic tie-breaking, dynamic display of native Foundry core combat turn markers on active legendary creatures with remaining uses during placeholder turns, and intelligent auto-skipping when no creature in the encounter has legendary action uses remaining.
* *Sub-settings*: **Auto-Skip When No Uses Left**, **Show to Players**, **Custom Icon**.

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
* **Pact Magic Formula Scaling**: Dynamically corrects damage and healing formulas for Pact Magic spells to reflect the caster's pact slot level in sheet inventory rows and activity tables.
* **Damage Application Tray Grouping**: Prevents an upstream D&D 5e system TypeError (`token.getGroupingKey is not a function`) when rendering damage application trays for targets resolved via actor UUID or unplaced tokens.

---

## ⚙️ Settings Dashboard & Personal Preferences

All features are managed in the **Settings Dashboard** accessible via *Configure Settings > Nik's DnD5e Tweaks*:

* **World Settings (GMs & Authorized Users)**: Global defaults and master toggles across UI, Canvas, Combat, Rules, and Utilities. Fully supports Foundry's native **"Modify Configuration Settings" (`SETTINGS_MODIFY`)** permission, allowing Assistant GMs or trusted players with settings rights to configure and save world settings just like a GM.
* **Personal Preferences (All Players & GMs)**: Client-side preference overrides (`scope: "client"`). Players can independently toggle prompts, auto-rolls, and interface tweaks for their own screen without altering other players' setups or GM defaults. For GMs and authorized users with `SETTINGS_MODIFY`, this section is positioned at the bottom of the navigation tabs so world-level configuration is immediately accessible.
* **Player-First Access**: When non-authorized players open the dashboard, it immediately displays their Personal Preferences tab at the top of the menu, world settings are shown read-only (disabled), and the "Reset Defaults" action resets only their personal client settings.

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
* **libWrapper**: All method and property overrides across combat automation, canvas layers, sheet hooks, and UI components automatically register cooperatively via `libWrapper` when installed (preventing conflict warnings with modules like Monk's Combat Details), while maintaining zero-dependency standalone fallback wrapping.
* **Monk's Combat Details**: Seamless combat turn progression and target resolution compatibility.
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
* **Foundry VTT**: Version 14 (maximum 14)
* **DnD5e System**: Version 6.0.0 or higher

---

## ❤️ Other Modules by Nik

### ⚔️ Combat & Token Tools
* **[Nik's Action HUD](https://github.com/nschoenwald/niks-action-hud)** – Sleek, modern canvas-docked Action HUD for quick access to attacks, spells, inventory, and utility rolls.
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
