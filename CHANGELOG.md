# Changelog

All notable changes to this project will be documented in this file.

## [14.59.0] - 2026-10-31
### Changed
- **D&D 5e 6.1 support**: The module now accepts D&D 5e 6.1 and keeps working on 6.0.

### Fixed
- **Player Damage Prompt**:
  - On D&D 5e 6.1, effects that let an attack ignore resistance, immunity or vulnerability, or turn immunity into resistance, are now respected when you click Apply, just like on the system's own damage card.
  - The damage breakdown now matches what is actually applied, for example when a magical weapon bypasses a resistance.
- **Dragging Items Between Actors**: On D&D 5e 6.1, moving a stack onto a group or encounter sheet asks how many to move again, instead of moving the whole stack.
- **Detailed Roll Breakdown Overlay**: On D&D 5e 6.1, right-clicking a damage card target whose actor no longer exists no longer causes an error.
- **Conditional Damage Bonuses** (*Charger*) and **Damage Emanation Automation** (drifting areas) no longer log deprecation warnings on D&D 5e 6.1 when converting distances.

## [14.58.1] - 2026-10-30
### Fixed
- **Auto-Open Damage Dialog for Saves**: When an area spell such as *Acid Splash* was cast while creatures from an earlier cast were still targeted, the damage card listed those old creatures instead of the ones caught in the new area. It now uses the creatures inside the new area.

## [14.58.0] - 2026-10-30
### Added
- **Damage Emanation Automation**:
  - *Moonbeam*, *Cloudkill* and *Doomtide* are now automated too. A creature makes the save when it enters the area, when the area moves into its space, or when it ends its turn inside, once per turn.
  - These placed areas affect every creature inside, including the caster and their allies, as written. **Exclude Allies** now only applies to emanations centered on the caster and to spells that let the caster choose who is affected.
  - *Cloudkill* and *Doomtide* move 10 feet away from the caster at the start of each of the caster's turns. Turn on the new **Move Drifting Areas** setting for this (off by default); otherwise move the area by hand.
  - To move *Moonbeam*, drag its area on the Regions layer. Creatures it lands on make their save.
  - Worlds with a customised **Emanation Spells** list get the three new spells added to it.

## [14.57.0] - 2026-10-30
### Changed
- **Auto-Clear Movement History** has been removed. Foundry V14 already clears every combatant's movement history at the start of each turn, so the feature only repeated that work. Movement trails behave the same as before.

### Fixed
- **Player Damage Prompt**: When a player's damage roll carried no targets, the prompt could be sent for whatever tokens the GM had targeted. It now only falls back to canvas targets for the GM's own rolls.
- **Sheet Pop-out Button**: Turning the button off now removes it reliably, even after the setting was switched on and off during the session.
- **Reliable Chat Log Auto-Scroll**: Turning the feature on mid-session now keeps working after the chat log redraws, and snaps to your own new messages, without needing a reload.
- **Template, Summon and Teleport placement banners** are now centred on the visible canvas between the scene controls and the sidebar, as intended.
- New worlds now start with **Prompt for Initiative** set to its intended default (**Players**) instead of **All**.
- Slightly less work on every render for **Actor Directory Disposition Dots**, **Force Compendium Browser**, **NPC Hit Point Scaling**, **Toolbar Limitation** and the **Item / Spell Add choice dialog**. Toolbar Limitation no longer watches the scene controls while it is turned off.

## [14.56.4] - 2026-10-30
### Fixed
- **Player Damage Prompt**: The damage prompt for an attack could fail to appear when the damage roll wasn't linked to the attack's usage card. It now shows up as expected.

## [14.56.3] - 2026-10-30
### Fixed
- The **Cast at Level** choice is back on activities like *Moonbeam*'s damage, where you need it to pick the level the spell was cast at. 14.55.2 had hidden it there by mistake. It stays hidden only on spells that are never cast with a spell slot, such as *Mystic Arcanum*.
- The misleading "You have no available spell slots" warning is no longer shown when the spell isn't using a slot. This fix turns itself off from D&D 5e 6.1.0, which fixes the warning itself.

## [14.56.2] - 2026-10-29
### Fixed
- **Detailed Roll Breakdown Overlay**: Damage bonuses that use a hyphenated scale value with a label, such as `+@scale.barbarian.rage-damage[Rage]`, no longer cause an error that stops the damage from being rolled.

## [14.56.1] - 2026-10-29
### Fixed
- **Readable Text Size**: Now also applies while you edit an item description, and to item types that show a single description. Journal and biography editors keep the larger text as well.
- **Dragging Items Between Actors**: Dropping an item from another actor into an open container window (e.g. the party's backpack) now moves it too, and asks how many to move for stacks. Before, it always left a copy behind.

## [14.56.0] - 2026-10-29
### Added
- **Readable Text Size**: Descriptions are now easier to read. Journal pages, item descriptions, biographies (including Ideals, Bonds, Flaws, Personality Traits, Appearance and the Alignment / Eyes / Height fields on character sheets), items expanded on your sheet and item tooltips use larger text with more space between lines, while the rest of the interface stays the same size. The GM chooses **Comfortable** (default), **Large** or **Off** for the world, and each player can override it under Personal Preferences (default: **Use World Setting**). A separate option also enlarges descriptions in chat cards.

### Fixed
- Removed the deprecation warnings Foundry showed in the browser console for the settings dashboard (import, export, file picker), template Shift-snapping, template and summon placement, Retroactive Advantage and the Item / Spell Add choice dialog. These features keep working the same and are ready for Foundry V15, which removes the old names.

## [14.55.3] - 2026-10-29
### Fixed
- **Chat Card Styling Improvements**: Target names and damage numbers in damage trays no longer break onto two lines when Foundry's **Font Size** is set above the default or the chat is in a narrow popout. The **Targeted** / **Selected** button gets narrower when space is tight, and names that still don't fit end in "…" (click the target to see the full name).

## [14.55.2] - 2026-10-29
### Fixed
- Spells you cast without a spell slot no longer show the **Cast at Level** choice or the "You have no available spell slots" warning when you use them. This covers spells cast with the item's or activity's own uses, such as *Mystic Arcanum*, feat spells and innate spells. They are cast at their own level, as intended. Spells that do use a slot, or whose activity allows its own scaling, are unchanged.

## [14.55.1] - 2026-10-28
### Changed
- **Detailed Roll Breakdown Overlay** with midi-qol: Clicking the attack or damage total on midi-qol's combined card now shows the detailed breakdown too, with every die and bonus and where it came from. Before, midi-qol showed its own plain list of dice there. midi-qol's notes on where advantage or a bonus came from are kept at the top. Rolls that midi-qol hides from players stay hidden.

### Fixed
- **Detailed Roll Breakdown Overlay**: A save or check shown inside midi-qol's combined card could show the card's damage breakdown when you clicked its total. It now shows its own roll.

## [14.55.0] - 2026-10-28
### Changed
- **Chat Card Styling Improvements** with midi-qol:
  - midi-qol's Attack, Damage and Apply Effects buttons are now color-coded like the other card buttons (violet, orange and gold).
  - When midi-qol's **Colored Border Messages** is on, the left edge of every card keeps the player's color. Roll and whisper colors still show in the card's background tint.

### Fixed
- **Chat Card Styling Improvements**: The number on the d20 next to a roll result is now centered in its hexagon, and a single die is the same size as the dice shown for advantage and disadvantage.
- **Chat Card Styling Improvements**: The d20 number is now always easy to read. It turns white on dark dice (dark themes and fumbles) and stays black on light ones (light themes and critical hits).
- **Chat Card Styling Improvements**: With midi-qol, save results shown inside its card could show the dice of the card's attack roll. They now show no dice, as in D&D 5e.
- **Chat Card Styling Improvements**: Rolls that midi-qol hides from players as "??" no longer reveal the d20 result through the advantage / disadvantage dice display.

## [14.54.0] - 2026-10-28
### Added
- **Damage Emanation Automation**:
  - *Spirit Guardians*, *Conjure Woodland Beings*, *Cacophonic Shield*, *Dirge* and *Yolande's Regal Presence* now trigger their saving throw and damage on their own when a creature enters the emanation, the emanation moves into a creature's space as the caster moves, or a creature ends its turn inside it.
  - Each creature saves only once per turn. Creatures already inside when the spell is cast are left to the cast itself. Turning the emanation off and on, revealing it, or placing or summoning a token inside it doesn't count as entering. Creatures triggered at the same moment share one save card, and creatures triggered later in the same turn are added to that turn's card until someone rolls or skips it. This also covers a group of monsters with the same initiative ending their turns in the emanation one after another.
  - The usual save card is used at the level the spell was cast, without spending a spell slot, so Deafened, Prone and other effects are applied as normal. They end when the caster stops concentrating.
  - By default, the caster's player and the GM get a card listing the triggered creatures, with **Roll Saves** and **Skip** buttons. If the player and the GM both click, only the first click counts. The new **Trigger Mode** setting can send it to the GM only, or roll automatically.
  - The emanation is removed from the scene when the caster stops concentrating.
  - Casting one of these spells always offers to place its emanation, even when the spell's casting activity has template placement turned off (*Yolande's Regal Presence*). Pushing a creature away with *Yolande's Regal Presence* is still done by hand.
  - New settings: **Emanation Spells** (add more spells by identifier), **Only During Combat**, **Exclude Allies**, **Respect "Creature You Can See"** (*Conjure Woodland Beings*, *Yolande's Regal Presence*) and **Remember Damage Type** (*Spirit Guardians*' Radiant or Necrotic choice).
  - Spell authors can also add **Damage Emanation** in an activity's **Behaviors** tab.

### Changed
- **Chat Card Styling Improvements**: The **Apply** buttons in damage and effects trays are now taller, bolder and color-coded (crimson for damage and healing, gold for effects), so they are easier to spot. They also say what they do: **Apply Damage**, **Apply Healing**, **Apply Temp HP** or **Apply Effect**. When every target would get exactly the same amount, the button shows it, e.g. **Apply 17 Damage** or **Apply 6 Temp HP**. It updates as you change targets, multipliers or resistance toggles. Cards only grow by a few pixels, because the empty space at the bottom of the tray is used for it.
- **Settings Dashboard**: Settings that have no effect because midi-qol or Automated Masteries 5e handles the job are now greyed out and locked, with a badge naming that module. This covers template auto-targeting, template grid snapping, attack damage prompts and auto-rolls, auto-open damage for saves (midi-qol) and Weapon Mastery Automation (Automated Masteries 5e). Your previous choice is kept for when that module is turned off.

## [14.53.0] - 2026-10-27
### Added
- **Dragging Items Between Actors**: Dragging an inventory item from one actor to another, such as from a character to the party group, now moves it instead of copying it. A new setting lets you choose **Always Move** (default), **Move, but Copy from NPCs** or **Always Copy** (the D&D 5e default). Shift still forces a move and Ctrl a copy. When you aren't allowed to remove the item from the original actor, it is copied instead. Spells, features and classes are always copied.
- **Move Part of a Stack**: Moving a stack of more than one item to another actor now asks how many to move, so you can hand over 5 of your 20 arrows in one drag. The rest stays where it was. Containers always move whole.

## [14.52.0] - 2026-10-27
### Fixed
- **Animated HP Bars**: Token HP bars now animate smoothly when a creature takes damage or is healed, like Foundry V14's other token bars. Before, the D&D 5e HP bar jumped straight to its new value. Temporary HP, temporary max HP and the bar colour animate too.

## [14.51.0] - 2026-10-27
### Changed
- **midi-qol Compatibility**:
  - **Weapon Mastery Automation**: Sap and Slow now work with midi-qol. Before, they never triggered while midi-qol was active.
  - **Magic Resistance Automation**: No longer turns off with midi-qol. Saves requested by midi-qol now get Advantage too, including from Spell Resistance, Gnome Cunning and the Mantle of Spell Resistance, which midi-qol doesn't recognise.
  - **Auto-Roll Concentration Saves**: Only steps aside when midi-qol actually rolls concentration saves itself (*Chat Message + Auto Roll* or *Roll Concentration Item*). With *Chat Message Only*, saves are auto-rolled again. midi-qol's own concentration request is no longer replaced by this module's player prompt, and concentration is no longer ended twice on a failed save.
  - **Auto-Apply Status at 0 HP**: When midi-qol's *Add Dead/Unconscious* is on, midi-qol decides the 0 HP status and the defeated mark, so the two modules no longer swap a token between Dead and Unconscious. Dead after three failed death saves, clean-up on healing and removing tokens from combat still work.
  - **Snap Templates to Grid Intersections**: Turns off while midi-qol is active. It could move a template after midi-qol had already chosen its targets. Use midi-qol's *Template Grid Snapping* instead.
  - **Prompt / Auto-Roll Attack Damage**: Turns off while midi-qol is active, whatever its damage settings. Use midi-qol's *Auto Roll Damage* instead.
  - **Player Damage Prompt**: No longer prompts for damage rolled inside a midi-qol workflow.
  - **Retroactive Advantage**: No longer offered on midi-qol cards, because midi-qol wouldn't update its hit and save results.
- **Automated Conditions 5e Compatibility**:
  - **Roll Mode Highlight** now highlights the button Automated Conditions 5e recommends, so both modules agree.
- **Automated Masteries 5e Compatibility**:
  - **Weapon Mastery Automation** turns off while Automated Masteries 5e is active, so creatures aren't sapped or slowed twice.
  - The **Graze** damage prompt is skipped, since Automated Masteries 5e rolls Graze damage itself.
  - The **Cleave** toggle no longer appears in damage dialogs, since Automated Masteries 5e already rolls the Cleave attack without your ability modifier.

## [14.50.0] - 2026-10-26
### Added
- **Magic Resistance Automation**:
  - Creatures with Magic Resistance now automatically make saving throws against spells and magical effects with Advantage. The roll dialog opens with Advantage already selected, and Disadvantage still cancels it out.
  - Also covers Gnome Cunning (2014, Intelligence, Wisdom and Charisma saves only), Spell Resistance (School of Abjuration) and an equipped, attuned Mantle of Spell Resistance. As written, Spell Resistance and the Mantle only work against spells, not other magical effects.
  - Magic items, potions, scrolls, wands and rods count as magical. Monster features count when they have the **Magical** property ticked. You can change this with the new **What Counts as Magical** setting.
  - Concentration saves are not affected. The feature turns itself off while midi-qol is active.

## [14.49.1] - 2026-10-23
### Added
- **Self Effect Application: Auto-Apply Effects**:
  - New setting: a comma-separated list of effect names. By default it covers self-only features and spells from the Player's Handbook, such as Rage, Bladesong, Innate Sorcery, Patient Defense, Divine Favor and *Shield*'s Imperceptible Barrier. When one of these effects would normally need the self-effect message's Apply button, it is applied to your token straight away. The message is still posted, showing the effect as applied with an **Undo** button.
  - The **Apply Effects** tray on the activity's chat card is collapsed when this happens, and also when the effect is already active and you use the feature again (no new self-effect message is posted in that case).
  - Effects not on the list still get the usual Apply button in the same message.

### Changed
- **Settings Dashboard: List Editor**:
  - Name lists (**Always Prompt Features** and **Auto-Apply Effects**) now have an **Edit List** button instead of a long text field. It opens a small window where you can search the list, add entries (press Enter, or paste several separated by commas), remove them one by one, or reset to the defaults. Press **Apply**, then **Save Changes** in the dashboard.
  - Lists are always sorted alphabetically, and duplicates or empty entries are removed. This also applies to imported settings backups.

## [14.49.0] - 2026-10-23
### Changed
- **Performance Improvements**:
  - The module now remembers its settings instead of looking them up again every time. This noticeably reduces the module's overhead when the world loads and whenever actors or their effects update, especially in worlds with many modules or effects.
  - Bloodied suppression, Disable Active Effect Expiry and Fix Pact Magic Formula Scaling do much less work on effects and spells they don't affect.
  - **Roll Breakdown Details**: Scrolling back through old chat messages no longer builds every breakdown up front. Older breakdowns are built when you hover or open them.
  - **Retroactive Advantage**: Buttons only update when the chat theme actually changes, not on every chat card change.
  - **Chat Card Styling**: Resizing the sidebar re-positions advantage/disadvantage roll results more efficiently.
- **Code Cleanup**:
  - Removed unused code, styles and translation strings left over from earlier versions. Nothing changes in how the module looks or behaves.

### Fixed
- **Toolbar Limitation**: Fixed a hidden or re-rendered scene controls toolbar continuously re-checking its layout in the background. Resizing the window also no longer recalculates toolbars on every frame.

## [14.48.4] - 2026-10-23
### Changed
- **Auto-Target Tokens in Spell Templates: Healing Targets Allies Only**:
  - Templates placed for healing now only target the caster's allies. Player characters target other PCs and friendly tokens, and hostile NPCs only target other hostile tokens.
- **Auto-Target Tokens in Spell Templates: Choose Targets Hits Opponents Only**:
  - Damaging spells and features with **Choose Targets** enabled now only target the caster's opponents. Player characters and friendly NPCs target hostile tokens, and hostile NPCs target PCs and friendly tokens.
- **Snap Templates to Grid Intersections: Rings & Hex Grids**:
  - Ring templates now snap to grid intersections just like circles.
  - On hex grids, circle and ring templates now snap to the center of a hex instead of a hex corner, and square templates are no longer forced onto hex corners.

### Fixed
- **Roll Breakdown Details: Wrong Feature Labels on Healing**:
  - Fixed healing spell modifiers (e.g. your Wisdom modifier on *Cure Wounds*) being labeled with an unrelated damage feature such as *Potent Spellcasting*. Bonus rules are now only credited on rolls they actually apply to.

## [14.48.3] - 2026-10-23
### Changed
- **Weapon Mastery Automation: Sap & Slow Applied on Damage Roll**:
  - Sap and Slow are now applied to your targets when you roll weapon damage, instead of when the attack roll hits.

## [14.48.2] - 2026-10-22
### Changed
- **Auto-End Class Features: Effects Disabled Instead of Deleted**:
  - When Rage, Wrath of the Sea, or Starry Form ends due to an incapacitating condition, its active effect is now disabled rather than deleted, so it stays on the actor and can be re-enabled.

## [14.48.1] - 2026-10-22
### Fixed
- **Token Resource Bars: First HP Change Not Shown**:
  - Fixed token HP bars not updating visually after the first HP change of an unlinked token in a session (e.g. when editing HP through the Token HUD), an upstream Foundry VTT V14 core issue.
- **Roll Breakdown Details: Scale Values as Dice Count**:
  - Fixed rolls erroring when a hyphenated scale value was used as a dice count (e.g. `(@scale.barbarian.rage-damage)d6`), caused by the flavor tag being inserted mid-key.

## [14.48.0] - 2026-10-20
### Added
- **Legendary Action Placeholders: Turn Marker Highlight**:
  - Native combat turn markers now highlight creatures with remaining legendary actions during placeholder turns, updating dynamically as actions are spent or conditions change.

### Fixed
- **Damage Application Trays: Grouping & Render Stability**:
  - Resolved an upstream D&D 5e error when grouping targets in damage trays and ensured unlinked placeable tokens group correctly.
- **Player Damage Prompts: Delivery & Reliability**:
  - Fixed prompts not whispering to players who own unlinked tokens or assigned characters without explicit actor sheet ownership.
  - Hardened chat message rendering and tray collapse to ensure prompt cards always display reliably.
- **Legendary Action Placeholders: Hidden & Multi-Scene Encounters**:
  - Hidden creatures no longer reveal turn markers to players, and markers immediately update when defeating or reviving creatures across scenes.

## [14.47.0] - 2026-10-20
### Fixed
- **Detailed Roll Breakdown: Typed Bonus Damage**:
  - Typed damage bonuses from active effects (e.g. Paladin *Radiant Strikes*, *Divine Favor*) are now recognized and displayed with their own damage type and icon instead of being grouped under the weapon's base damage type.
  - Chat card breakdown overlays and configuration dialogs accurately display separate subtotals, icons, and effect labels for each damage type, including multi-tag formulas (e.g. `1d8[mgc][radiant]`).
- **Compatibility: Universal libWrapper Integration**:
  - Resolved conflict warnings and notifications when used alongside other modules that wrap Foundry VTT or D&D 5e methods (such as Monk's Combat Details).
  - Upgraded internal method patching to cooperatively integrate with `libWrapper` across combat automation, rolls, template placement, and UI enhancements.

### Changed
- **Manifest Compatibility**:
  - Added maximum compatibility version limit (`14`) for Foundry VTT.

## [14.46.7] - 2026-10-19
### Fixed
- **Detailed Roll Breakdown: AC5e Bonus Damage & Cross-Roll Attribution**:
  - Fixed an issue where bonus damage rolls added by Automated Conditions 5e (AC5e) or active effects (e.g. *Divine Favor*, radiant riders) could be mislabeled with existing weapon bonuses (such as *Dueling*) instead of their actual effect name.
  - Accurately respects AC5e opt-in selections so unchecked bonuses are not attributed to other modifiers.
  - Prevents weapon attack damage bonuses from duplicating across secondary rolls in both the roll configuration dialog and chat breakdown popovers.
  - Resolved a breakdown rendering issue when evaluating modifier chunks.

## [14.46.6] - 2026-10-18
### Added
- **Legendary Action Placeholders: Auto-Skip When No Uses Left**:
  - Automatically skips legendary action placeholder turns in the combat tracker when all legendary creatures in the encounter have spent their legendary actions or have no uses remaining (including defeated or dead creatures).
  - Added a new sub-setting ("↳ Auto-Skip When No Uses Left", enabled by default) allowing GMs to toggle this automatic skipping behavior.
  - Highly performance-optimized with cached legendary creature detection, short-circuit lookups, and zero overhead on regular turn transitions.

### Changed
- **Template Auto-Targeting: Source Token Exclusion for Emanations**:
  - In accordance with D&D 5e / 2024 rules (where an emanation's origin is not included in its area of effect unless its creator decides otherwise), auto-targeting excludes a token for an emanation template if and only if that token is both the source (caster/creator) and the attached token for the region. Emanations attached to other creatures or unattached ground areas do not exclude the attached target or the caster.
- **Conditional Damage: Untyped Base Weapon Handling**:
  - Generic conditional damage bonuses (Sneak Attack, Great Weapon Master, Brutal Strike, Charger, and Boon of Irresistible Offense) now remain untyped when rolled with an attack or weapon whose base damage does not specify a damage type, rather than falling back to piercing damage.
- **Damage Roll Dialog & Breakdown: "Pure" Label & Icon for Untyped Damage**:
  - Untyped damage roll parts in the damage roll configuration dialog are now cleanly labeled as **Pure** alongside the damage icon instead of the generic system label "Formula".
  - Detailed Roll Breakdown popovers and chat card breakdown headers display **Pure** with its corresponding damage icon for untyped damage rolls.
- **Manifest Compatibility**:
  - Added a maximum compatibility version limit (`6.0.99`) for the DnD5e system.

### Fixed
- **Detailed Roll Breakdown: Non-Damage Roll Tooltips**:
  - Fixed an issue where d20 attack rolls, skill checks, saving throws, and initiative rolls erroneously displayed a "Pure" damage header in their breakdown tooltips.

## [14.46.5] - 2026-10-17
### Fixed
- **Roll Breakdown Formula Parsing for Exploding & Irregular Dice Modifiers**:
  - Fixed a syntax error (`SyntaxError: Expected [*/], [+-], or end of input but "=" found`) that occurred when opening the damage roll dialog for spells or attacks using dice formulas with internal modifiers or attributes, such as *Sorcerous Burst* (`1d8x@mod=8`).
  - Proactive formula tagging now strictly checks that attribute references (`@mod`, `@prof`, `@abilities.<abl>.mod`, `@scale.<key>`) are standalone terms or arithmetic operands before applying flavor labels, ensuring attributes that define dice mechanics (such as explosion limits, keep/drop amounts, or reroll thresholds) remain intact without syntax corruption.

## [14.46.4] - 2026-10-17
### Added
- **Auto-Collapse Healing & Temporary HP Trays**:
  - Auto-collapse now fully recognizes and supports healing and temporary HP application trays alongside standard damage rolls.
  - **Smart Mistarget Recovery for Players**: When a player rolls healing or temporary HP while still targeting an enemy NPC (an assumed mistarget from earlier combat actions), the application tray stays open instead of auto-collapsing and automatically switches targeting mode to **Selected** tokens. Players can immediately select themselves or an ally on the canvas to apply healing without needing to reopen or reconfigure the tray.
  - GMs continue to have hostile damage and healing abilities targeting player characters collapsed automatically, delegating resolution to players.
  - Hardened tray synchronization and performance across popout chat windows and notification cards.

## [14.46.3] - 2026-10-17
### Added
- **Chat Card Styling: Enlarged Targeted / Selected Button & Stacked Targets**:
  - Replaced the tiny 24px icon button in activity/usage cards and damage/effects application trays with an enlarged, full-height button displaying both the mode icon and a clear, dynamic text label (**Targeted** or **Selected**).
  - The toggle button automatically stretches vertically to match the height of the targets list beside it.
  - Reorganized target pills into clean, vertically stacked full-width rows with token names on the left and status pips or damage/healing calculations neatly right-aligned.
  - Fully compatible with all Foundry V14 and DnD5e theme combinations (light parchment, dark mode, Core Interface, and Core Apps).

## [14.46.2] - 2026-10-16
### Fixed
- **Detailed Roll Breakdown Sidebar Alignment & Viewport Cutoff**:
  - Fixed an issue where the detailed roll breakdown popover did not adapt cleanly to the sidebar width, cutting off dice formulas, modifier badges, and totals at the right screen edge on high-resolution displays (such as 1440p) or when classic scrollbars reduced the available chat log width.
  - Aligned popover anchoring to the trigger button's end edge with inward expansion and automatic inline/block flip fallbacks (`flip-inline`, `flip-block`), guaranteeing the breakdown and its parchment/dark background box always remain 100% visible on screen without spilling over sidebar borders.
  - Fixed a race condition where opening an un-cached historical roll popover replaced its inner DOM mid-open before anchor layout finished.
  - Automatically pre-caches recent historical roll cards on world ready and chat log renders, ensuring instantaneous, flicker-free, and correctly sized popovers on first click.
- **Template Auto-Targeting & Canvas Teardown**:
  - Fixed a `ReferenceError: lastChatActionMessageId is not defined` occurring during `canvasTearDown` when switching or viewing scenes.

## [14.46.1] - 2026-10-16
### Fixed
- **Self Effect Application & Concentration**:
  - Fixed an issue where applying self-effects from concentration spells via the whispered "Apply Effect" prompt card merged with and overwrote the caster's existing "Concentrating: [Spell]" effect.
  - The concentration effect and buff effects are now kept strictly separate, ensuring both are active concurrently as intended.
  - Applied effects now correctly link to concentration (`flags.dnd5e.dependentOn`), properly terminating when concentration is broken or ended.
  - Non-concentration spells and features are guarded against accidental concentration linking.
  - Fixed an edge case on "Undo" where undoing an already-deleted or expired temporary effect could fall back to and disable the source effect template inside the Item document.
- **Automated Conditions 5e (AC5e) Integration**:
  - Fixed an issue where effect changes configured in `system.changes` (including AC5e flags like advantage/disadvantage) were omitted when applying or re-enabling self-effects.
  - Ensured `system.changes` evaluations via `ActiveEffect.implementation.forApplication` are preserved across both fresh creations and re-enabling existing effects without dot-key collision in Foundry V14 data models.

## [14.46.0] - 2026-10-16
### Fixed
- **Pact Magic Formula Scaling**:
  - Fixed an issue where the character sheet Formula column and activity rows displayed unscaled base damage/healing formulas (e.g. 2d10 instead of 4d10) for leveled Pact Magic spells.
  - Formulas now accurately scale to the caster's pact slot level in both the main spell row and expanded activity details, automatically adapting when leveling up or when pact slots are overridden.
  - Added configurable world and personal preference settings in the Settings Dashboard under Sheets & Toolbars.
- **DnD5e 6.0.6 Shims Compatibility**:
  - Guarded against an upstream DnD5e 6.0.6 `TypeError: Cannot redefine property: walk` in `MovementField._shim` and `SensesField._shim` when actor data preparation runs multiple times.

## [14.45.8] - 2026-10-15
### Fixed
- **Detailed Roll Breakdown**:
  - Rolls with multiplication or division (e.g. Expertise `@prof * 2`, half proficiency, multiplied damage dice `1d8 * 2`, or manual arithmetic) now correctly evaluate their totals, display formula badges, and preserve multi-die expressions without breaking into separate additive terms.
  - Active effect bonuses and penalties (such as *Bless*, *Guidance*, and *Bane*) are now accurately matched by polarity and source, preventing duplicate or misattributed tags.
  - Fixed active effect damage bonuses (such as *Hex*) erroneously appearing in the Roll Initiative dialog and formula breakdown.
  - Fixed saving throw bonuses (such as Paladin *Aura of Protection*) being misclassified during initiative checks and omitted from breakdowns.
- **Situational & Extra Bonuses**:
  - Fixed a syntax error when manually entering a situational or extra bonus containing flavor tags (such as `1d6[necrotic]`) on damage rolls, ability checks, or rolls with active conditional damage.
### Improved
- **Compatibility**: Verified compatibility with DnD5e 6.0.6.

## [14.45.7] - 2026-10-15
### Fixed
- **Detailed Roll Breakdown**:
  - Fixed an issue where regular dice rolls (rolls made without an attack, check, or save) had their breakdown displayed immediately inside the chat card instead of remaining collapsed until clicking the roll total.
  - Added proper accordion collapse structure (`.dice-tooltip-collapser` and `.dice-tooltip`) to roll breakdown templates, restoring smooth click-to-expand behavior in standard chat cards while preserving popover overlays on activity cards.
  - Suppressed redundant total row in standard chat card roll breakdowns where the roll total button is already displayed immediately below the breakdown.

## [14.45.6] - 2026-10-15
### Fixed
- **Conditional Damage (Boon of Irresistible Offense)**:
  - Fixed an issue where natural 20 attack checks could fail to inspect the originating attack card when rolled from chat, preventing false positives from prior cached rolls.
  - Fixed an issue where multiple attacks from the same item card (e.g. Extra Attack) could allow a prior natural 20 to leak onto a subsequent non-critical attack roll's damage.
  - Fixed an issue where standalone root attack messages could be skipped during origin inspection due to identical message references.
  - Prevented damage messages with d20 dice from being falsely inspected as attack rolls.
  - Prevented out-of-combat attack rolls from leaking across the encounter boundary into started combat encounters.
  - Made direct attack rolls authoritative so non-critical attacks do not fall through to cached critical hit states.
- **Detailed Roll Breakdown**:
  - Fixed candidate dice rolling maximum or minimum values under Savage Attacker being falsely flagged as critical hits or fumbles, while ensuring duplicated critical hit pool dice receive proper critical hit styling without erroneously forcing max-roll styling on low critical dice.
  - Fixed discarded candidate dice in Savage Attacker pools missing the `.discarded` class in their roll data model.
  - Fixed base weapon damage dice displaying `(Crit)` alongside duplicated critical hit dice under Savage Attacker, ensuring only the critical bonus dice carry the critical hit label.
  - Fixed secondary damage popovers on multi-damage messages failing to populate when opened or hovered.
  - Fixed hover pre-caching to reliably trigger when moving the cursor across chat cards and rows via bubbling pointer events.
### Improved
- **Conditional Damage (Charger & Brutal Strike)**:
  - Both Charger and Brutal Strike now strictly enforce their once-per-turn rules during combat, preventing multiple uses on the same turn when attacking multiple times with Extra Attack.
  - Brutal Strike is now offered exclusively on the Barbarian's own turn in combat, matching 2024 RAW.
- **Conditional Damage (Boon of Irresistible Offense & Memory)**:
  - Natural 20 attack roll detection now links to combat turns and features an extended 3-minute grace period outside combat, ensuring slow-paced scenes or reaction adjudications do not cause missed bonuses.
  - Replaced full Roll instance caching with lightweight primitive flags and added automatic cleanup on attack rolls, turn changes, and combat deletion.
- **Conditional Damage (Reliability & Timing)**:
  - Fixed an issue where toggling Savage Attacker and Cleave together could produce inconsistent formulas depending on toggle order.
  - Fast-forward rolls (holding Shift or configuring rolls to skip prompts) now reliably track once-per-turn bonus usage and attack Nat 20 states.
  - Flat conditional damage bonuses (Great Weapon Master and Boon of Irresistible Offense) now explicitly prevent numeric multiplication when critical hit numeric modifiers are configured.
- **Detailed Roll Breakdown**:
  - Fixed an issue where unflavored base weapon dice could erroneously inherit flavor labels from subsequent modifier terms (e.g. displaying STR next to a base damage die).
  - Unlabeled base weapon dice now clearly display the weapon's name (e.g. Longsword, Dagger, or Unarmed Strike) by correctly querying associated items on chat messages.
  - Single-die pool rolls like Savage Attacker now cleanly display both rolled dice with the discarded die struck through (e.g. `[7] [~~3~~]`), matching standard advantage display.
  - Hovering over roll cards and rendering new chat messages during gameplay now pre-caches breakdown popovers for instantaneous, zero-delay rendering with no popover layout jumps, while deferring historical messages on startup to keep world loading fast.

## [14.45.5] - 2026-10-15
### Fixed
- **Detailed Roll Breakdown**: Fixed the breakdown popover being hard to read in dark mode. Text, borders and dice chips now match the popover background for every combination of Interface, App and Chat light/dark settings.

## [14.45.4] - 2026-10-14
### Added
- **Conditional Damage: Savage Attacker (2024 Rules)**:
  - Characters with the Savage Attacker feat now get an optional toggle on weapon attacks to roll the weapon's damage dice twice and use the higher result.
  - Enabled by default on your first eligible weapon attack each turn, and automatically turns off for subsequent attacks that turn once used.
- **Conditional Damage: Charger (2024 Rules)**:
  - Characters with the Charger feat gain an opt-in toggle for +1d8 bonus damage on melee attacks (weapons and unarmed strikes), matching the attack's damage type.
  - In combat, automatically verifies that you have moved at least 10 feet on your turn before offering the bonus. Always available outside combat.
  - Defaults to off on each roll so you can choose when to apply your once-per-turn charge.
- **Conditional Damage: Boon of Irresistible Offense (2024 Rules)**:
  - Characters with this Epic Boon automatically receive extra damage equal to their boosted ability score whenever rolling a natural 20 on an attack roll.
  - Always enabled by default whenever offered on a natural 20, matching the attack's damage type.
- **Detailed Roll Breakdown: Dice Pool Support**:
  - The detailed roll breakdown popover now cleanly displays dice rolled with Savage Attacker and other dice pools, showing the kept dice and proper labels.
### Improved
- **Conditional Damage**:
  - Sneak Attack is now once per turn in combat: it defaults to on until used, then defaults to off for the rest of that turn.
  - Brutal Strike is no longer offered on finesse weapons when your Dexterity modifier is higher than Strength.
  - Cleave is only offered to player characters for weapons whose Cleave mastery they have actually unlocked (never for NPCs).
  - Hex and Hunter's Mark no longer trigger from similarly named effects (e.g. Hexblade's Curse); Boon of Irresistible Offense only applies to attack rolls.
  - Savage Attacker keeps weapon die modifiers and is hidden for flat-damage weapons.

## [14.45.3] - 2026-10-14
### Improved
- **Conditional Damage: Great Weapon Master (Turn-Based Combat Validation)**:
  - Great Weapon Master now checks whether it is the attacker's turn whenever an active combat encounter is underway.
  - If it is not the attacker's turn in an active combat (such as during an opportunity attack, reaction strike, or Commander's Strike on an ally's turn), the Great Weapon Master damage bonus is not offered. This directly reflects the 2024 rules where Heavy Weapon Mastery only applies to attacks made as part of the Attack action on your turn.
  - Outside of active combat (e.g. exploration mode or before combat starts), the bonus remains available as normal.

## [14.45.2] - 2026-10-14
### Added
- **Conditional Damage: Brutal Strike**:
  - Automatically available for characters possessing the Brutal Strike feature (`brutal-strike`) when attacking with a melee weapon, thrown weapon, or unarmed strike using Strength.
  - Adds an opt-in toggle in the damage configuration dialog to deal extra damage (`1d10`, increasing to `2d10` at 17th level).
  - Matches the damage type and properties (magical, silvered, etc.) of the weapon or unarmed strike.
  - Defaults to disabled on every roll and does not save state across attacks, automatically resetting to disabled for subsequent rolls.

## [14.45.1] - 2026-10-14
### Added
- **Conditional Damage: Great Weapon Master (2024 Rules)**:
  - Automatically available under 2024 (modern) rules for characters possessing the Great Weapon Master feat (`great-weapon-master`) when attacking with a Heavy weapon.
  - Adds a toggle in the damage configuration dialog to add bonus damage equal to your Proficiency Bonus (+PB), flavored as `GWM` and matching the weapon's damage type.
  - Automatically resets back to enabled after being toggled off for a single roll (such as a bonus action, reaction, or Cleave secondary attack), saving players the effort of manually re-enabling it on subsequent turns.
- **Conditional Damage: Cleave Weapon Mastery (Damage Malus)**:
  - Automatically available under 2024 (modern) rules when attacking with a weapon featuring the Cleave mastery (e.g. Greataxe, Halberd).
  - Provides a toggle for the secondary attack that removes your ability score modifier from the damage formula (unless negative).
  - Disabled by default and strictly one-off (never remembered for subsequent rolls), ensuring normal attacks always include your full ability score modifier without accidental carry-over.

### Improved
- **Conditional Damage Dialog: Zero-Layout-Shift Formula Display**:
  - Eliminated dialog height jumping and layout shifts when toggling conditional damage bonuses (Sneak Attack, Great Weapon Master, Cleave, Hex, Hunter's Mark).
  - All eligible conditional bonus formula rows remain stably rendered in the dialog from the start; when a bonus is toggled off, its formula row is cleanly greyed out with a strike-through and disabled inputs rather than being abruptly removed from the DOM.
  - The dice preview at the top dynamically reflects only active rolls, providing an instant, rock-solid, and responsive rolling experience.
- **Conditional Damage Dialog: Smart Label Formatting & Full-Width Wrapping**:
  - Removed unnecessary hardcoded line breaks between bonus names and bonus numbers (e.g. `Hex (+1d6 Necrotic)`, `Cleave (-6)`).
  - Fixed an issue where DnD5e's default standard-form flex ratio (40% label / 60% form-fields) artificially restricted the label width, causing longer names like `Great Weapon Master (+6)` to wrap despite ample available space. Checkbox labels now occupy the full available width of the row.
  - When width is genuinely constrained, labels wrap cleanly between the bonus name and the bonus number rather than breaking mid-phrase or mid-bonus.
- **Roll Breakdown Overlay: Active Effect Damage Bonus Detection (e.g. Rage)**:
  - Fixed an issue where the Barbarian Rage damage bonus (and other damage bonuses originating from active effects) displayed as generic "Modifier" in the Detailed Roll Breakdown Overlay.
  - Active effect damage bonuses now resolve and display the exact name of their originating active effect (e.g. `Rage` or localized equivalent `Kampfrausch`) alongside the bonus value.

## [14.45.0] - 2026-10-13
### Added
- **Conditional Damage Bonuses (Sneak Attack, Hex & Hunter's Mark)**:
  - **Sneak Attack**: Automatically available for characters with Rogue class levels as well as NPCs/monsters with Sneak Attack features (e.g. Assassin, Spy) when attacking with a finesse or ranged weapon. Resolves the Rogue's native scale value formula (e.g. `1d6`, `2d6`, etc.) and seamlessly inherits the weapon's damage type and magical properties.
  - Automatically detects active concentration effects for **Hex** and **Hunter's Mark** on the rolling actor across all system languages.
  - Adds intuitive toggle checkboxes in the damage roll configuration dialog to add **+1d6 Necrotic** (Hex), **+1d6 Force** (Hunter's Mark), or **Sneak Attack** damage.
  - **Remembers Last Choice**: Remembers whether each bonus was enabled or disabled per actor, keeping it on while attacking your designated quarry and easily toggled off when targeting someone else or after expending Sneak Attack.
  - **Live Reactive Preview & Dynamic Sync**: Toggling bonuses or changing weapon damage types in the dialog updates the formula, dice breakdown, and Sneak Attack damage type in real time.
  - **Full Critical Hit Support**: Automatically doubles bonus dice on critical hits according to 5e rules while properly safeguarding weapon-specific bonus dice (like Savage Attacks or Brutal Critical) from leaking into conditional damage.
  - **Roll Breakdown Overlay Labels**: Passes distinct `Sneak Attack`, `Hex`, and `Hunter's Mark` labels and damage type icons directly to the Detailed Roll Breakdown Overlay.
  - Configurable under **Combat Automation** and in **Personal Preferences**.

## [14.44.0] - 2026-10-13
### Changed
- **Performance & Responsiveness Optimizations**:
  - **Template Placement & Auto-Targeting**: Added frame-synced coalescing (`requestAnimationFrame`), origin combatant caching, and spatial bounding-box pre-filtering, drastically reducing CPU usage and eliminating cursor lag when aiming area-of-effect spells on scenes with many tokens.
  - **Roll Breakdown Details**: Chat card breakdowns now render lazily on-demand when opening popovers and parse structured term flavors directly without expensive retroactive chat scans or live actor effect introspection, drastically speeding up popover opening and chat rendering.
  - **Summon Placement HUD**: Coalesced preview updates and cached grid coordinates during summon positioning to eliminate redundant distance path measurements when hovering within the same grid square.
  - **Batch Prone & Dead Token Rotation**: Batch-synchronized token rotation updates during scene load into a single database transaction rather than issuing sequential updates per token.
  - **Auto-Collapse Damage Trays**: Added memoized tray collapse evaluations to prevent redundant actor/token lookups across card rendering hooks.
  - **Rich Item Tooltips & Attunement Tags**: Optimized tooltip enhancement by switching from full document parsing to lightweight HTML templates, caching localized term lookups, and streamlining tooltip observers for silky-smooth inventory hovering.
  - **Context Menu Styling**: Cached CSS color variables and deduplicated luminance calculations down to a single check per right-click, eliminating forced layout reflows.
  - **Chat Card Sizing**: Restricted dice button resize observers strictly to multi-d20 rolls, freeing system resources across large chat logs.

## [14.43.0] - 2026-10-13
### Added
- **Detailed Roll Breakdown Overlay**:
  - Replaces the unlabeled numbers in the roll total popover on chat cards with a comprehensive breakdown showing dice rolls and where every bonus or penalty comes from (e.g. `+3 STR`, `+2 PB`, `+1 MGC`, `+1d4 Bless`, `-2 Exhaustion 1`).
  - **Full d20 & Damage Card Support**: Works across all attack rolls, ability checks, saving throws, and damage cards.
  - **Clean Sorting Order**: All die rolls appear at the top (starting with base weapon damage or d20), followed by ability modifiers (`STR`–`CHA`), and other modifiers sorted alphabetically.
  - **Consolidated Damage Sections**: Combines multiple damage rolls of the same type into a single section with vibrant, colored damage type icons matching Nik's Action HUD.
  - **Right-Oriented Dice Formulas**: Displays dice results to the right with formulas for multi-dice pools (e.g. `2D6` → `1 + 1 = 2`) and preserves custom die flavors (like `2D6 Vicious`).
  - **Configurable**: Toggleable under **UI & Visuals > Chat Log** or per-player in **Personal Preferences**.

## [14.42.0] - 2026-10-11
### Added
- **Weapon Mastery Automation (Slow & Sap)**:
  - Automates Slow and Sap masteries upon successful attack hits by player characters possessing the required mastery trait.
  - **Sapped**: Imposes Disadvantage on the target's next attack roll before the start of the attacker's next turn (expires upon making an attack or at the start of the attacker's next turn).
  - **Slowed**: Reduces the target's movement speed across all modes by 10 ft until the start of the attacker's next turn. Multiple hits maintain the 10 ft reduction without stacking.
  - **Customizable Icons**: Fully configurable active effect icons for Sap and Slow in the Settings Dashboard.
  - Restricted strictly to player character attacks to avoid unwanted automation on monsters.

### Fixed
- **Settings Dashboard Permissions**: Users with core "Modify Configuration Settings" permissions now see the full GM tab layout and configuration controls.
- **Settings JSON Import**: Prompts for a world reload when importing settings that require one.
- **Combat Recovery**: Fixed an upstream DnD5e error when the combat tracker contains placeholder combatants without an actor.

## [14.41.1] - 2026-10-11
### Changed
- **Clear Targets Button Order**: Reordered the **Clear Targets** token control button directly next to core **Select Targets** in the toolbar for faster and more intuitive access during play.

## [14.41.0] - 2026-10-10
### Added
- **Aggregate Short Rest Hit Dice Rolls**:
  - Automatically consolidates multiple hit dice rolls made during a short rest into a single, clean chat card showing total healing and dice spent, eliminating chat log clutter while preserving detailed breakdowns in the dice tooltip.
  - **Local 3D Dice**: 3D dice animate locally per click strictly for the rolling player, keeping tactile feedback without cluttering others' screens.
  - **Changelog Integration**: Posts consolidated HP recovery and hit dice spent messages when used alongside *Nik's Tiny Changelogs*.
  - **Anti-Cheat Protection**: Committed hit dice and HP gains are posted even if the rest dialog is closed without resting, preventing re-roll abuse.
  - Configurable under **UI & Visuals > Chat Log** and in **Personal Preferences**.

## [14.40.2] - 2026-10-09
### Changed
- **Settings Dashboard Navigation Order**: Moved the **Personal Preferences** tab to the bottom of the dashboard sidebar for GMs, keeping world configuration front-and-center while retaining Personal Preferences at the top for players.

## [14.40.1] - 2026-10-08
### Fixed
- **Saving Throw Ability Shorthands**: Fixed saving throw action button labels (e.g. `CON Save`, `DEX Save`) overriding to generic "Save" when using Carolingian UI.

### Changed
- **Streamlined Settings**: Saving throw ability shorthands are now permanently enabled as part of Chat Card Styling Improvements, removing redundant sub-settings.

## [14.40.0] - 2026-10-05
### Added
- **Prevent Rolling as Group Actors**:
  - Prevents non-GM players from making rolls from party exploration tokens or group inventory sheets.
  - Automatically redirects roll speaker and character attributes (`@mod`, `@prof`) to the player's assigned character, fixing formulas evaluating to 0. GMs remain exempt.
  - Configurable under **Combat & Automation > Phase 2: Actions, Rolls & Damage Prompts**.

### Improved
- **Mage Slayer Concentration Automation**:
  - Improved reliability for unlinked tokens on the canvas and extended pending disadvantage duration to 5 minutes so tactical discussions do not expire the penalty.
  - Canceling or closing a roll dialog no longer clears pending disadvantage prematurely.
  - Added support for German localization (`"Magietöter"`).

## [14.39.0] - 2026-10-04
### Added
- **Clear Targets Token Control Button**:
  - Adds a dedicated **Clear Targets** button to the Token Controls toolbar.
  - Players clear their own targets; GMs clear targets across the entire table for all connected players.
  - Configurable under **Canvas & Tokens > Token & Template Behaviors** and in **Personal Preferences**.

### Fixed
- **Touchpad Template Placement Rotation**: Dampened trackpad scroll sensitivity during template placement to prevent wild spinning.
- **Template Auto-Targeting & Chat Sync**:
  - Originating caster token is automatically excluded from cone and line template target selection.
  - Target selections now synchronize with spell and damage chat cards in real time upon template confirmation.

## [14.38.1] - 2026-10-04
### Improved
- **Important NPCs Roll Death Saves at 0 HP**:
  - NPCs marked as "Important" or possessing class levels no longer die automatically at 0 HP; they are marked Unconscious and roll death saving throws until accumulating 3 failures.
  - Important NPCs are protected from automatic removal or defeat markings in the combat tracker when dropping to 0 HP.

## [14.38.0] - 2026-10-03
### Added
- **Auto-Collapse Unowned Damage Trays for Players**: Automatically collapses damage application trays on chat cards for players when they don't own any of the targeted tokens, reducing chat clutter. Trays targeting the player's character remain expanded.

### Fixed
- **Template Placement Controls & Zoom**:
  - Non-directional templates (circles, spheres, cubes) now use standard scrolling and Shift+scrolling for canvas zoom, keeping rotation controls strictly for directional cones and lines.
  - Fixed canvas zoom compatibility when using mouse wheel zoom modules like *Nik's Zoom / Pan Options*.
- **Auto-Rotate Prone Tokens**:
  - Dead tokens now tilt left (270°) while Prone and Unconscious tokens tilt right (90°).
  - Tokens correctly return to upright (0°) upon standing up or reviving.
  - Improved condition handling on unlinked tokens and newly created tokens.

## [14.37.0] - 2026-10-02
### Added
- **Carolingian UI Theme Harmony**:
  - Full aesthetic compatibility and color palette harmonization with Carolingian UI (`crlngn-ui`).
  - Automatically offsets floating canvas HUD banners below Carolingian UI's top scene navigation bar.
  - Preserves Nik's color-coded action buttons and ability shorthands while adopting Carolingian UI styling and typography.
  - Renders legendary action placeholders in Carolingian's horizontal Combat Carousel with custom dashed borders and theme-reactive emblems.
- **Emanation Token Guidance & Auto-Attach**:
  - Adds live token attachment guidance to the Template Placement HUD for emanation spells (*Spirit Guardians*, *Aura of Protection*), displaying target feedback when hovering over a creature.
  - **Auto-Attach Self Emanations**: Automatically binds self-targeted emanations directly to the caster's token without requiring manual canvas placement. Configurable under **Canvas & Templates** and **Personal Preferences**.

## [14.36.0] - 2026-10-02
### Added
- **Summoning Placement HUD & Range Preview**:
  - Floating HUD banner during creature summoning (*Summon Beast*, *Find Familiar*, *Conjure Animals*).
  - Use Shift + Scroll to adjust the summoned token's facing direction before placing.
  - Live distance readout and canvas range boundary circle showing allowed spell reach.
  - Multi-creature progress indicator (e.g. *Summon 1 of 4*).
  - Evaluates wildcard token patterns so preview tokens display authentic creature artwork instead of default mystery man placeholders.
  - Configurable under **Canvas & Tokens** and **Personal Preferences**.

## [14.35.0] - 2026-10-02
### Added
- **Template Placement Controls HUD**:
  - Floating HUD banner for spell and item templates with single-handed scroll wheel rotation in 5° steps and Shift + Scroll canvas zoom.
  - Real-time rotation angle readout and on-screen shortcuts for free snapping and cancellation.
  - Live preview target highlighting for DnD5e 6.x region-based templates.
  - Added global target clearing socket support for GMs.

### Changed
- **Chat Card Action Button Alignment**: Aligned system play icon to the first row of action buttons in compact chat cards.

## [14.34.1] - 2026-10-02
### Fixed
- **Concentration Prompt Pill Display**: Concentration prompt and request cards now display the "Concentrating on: [Item Name]" pill above the DC roll button.
- **Chat Card Cleanliness**: Removed duplicate native "Break" buttons in favor of the full-width "End Concentration" button.

## [14.34.0] - 2026-10-01
### Added
- **Context Menu Styling**: Color-codes right-click options across actor sheets, sidebars, folders, and chat cards (red Delete, green Duplicate, purple Visibility) with dynamic luminance detection for high contrast in hybrid themes.
- **Concentration Item Badge**: Displays an interactive "Concentrating on: [Item Name]" pill on concentration saving throw cards with a click shortcut to open the item's sheet.
- **Saving Throw Ability Shorthands**: Displays specific ability shorthands (e.g. `DEX SAVE`, `CON SAVE`) on action buttons and roll cards.

### Fixed
- **Action Buttons Multi-Line Wrapping**: Allowed compact chat card action buttons to wrap cleanly across multiple lines, preventing clipping on narrow sidebars.

### Removed
- **Token Resizer Tool**: Removed legacy Token Resizer tool.

## [14.33.3] - 2026-09-29
### Changed
- **Feature Code Organization**: Structured all feature modules into category folders matching Settings Dashboard tabs (`ui-visuals/`, `canvas-tokens/`, `combat-automation/`, `utilities/`, `patches/`).

## [14.33.2] - 2026-09-29
### Changed
- **Chat Card Cleanliness**: Removed default system dice icons to the left of roll results in chat cards when Chat Card Styling is active.

## [14.33.1] - 2026-09-29
### Changed
- **Chat Card Cleanliness**: Removed default system horizontal line whiskers flanking roll results in chat cards.

## [14.33.0] - 2026-09-29
### Added
- **Item Sheet Attunement Badges**:
  - Adds clear "Attunement Required" / "No Attunement Required" tags on item sheets and rich item tooltips.
  - Interactive quick-attune toggle directly from item headers.
  - Automatically respects unidentified item concealment for players.
  - Configurable under **Sheets & Toolbars** and in **Personal Preferences**.

## [14.32.7] - 2026-09-29
### Fixed
- **Hybrid Theme Contrast**: Fixed dark theme styling incorrectly applying to light parchment chat cards when global interface is dark. Added live theme switching for retroactive advantage buttons without requiring a reload.

## [14.32.6] - 2026-09-28
### Fixed
- **Dark Mode Styling & Specificity**: Fixed dark theme contrast bugs on chat card buttons and retroactive advantage controls across all Foundry V14 dark mode configurations.

## [14.32.5] - 2026-09-28
### Added
- **Chat Card Action Buttons Styling**: Extended custom color themes and uppercase labels to Transform, Summon, Teleport, Use, Template, and Break Concentration action buttons in both light and dark themes.

## [14.32.4] - 2026-09-28
### Fixed
- **Attack Damage Prompt & Auto-Roll**: Fixed client setting scope evaluation so GM damage prompts for NPCs function properly regardless of player settings. Improved weapon damage and ammunition eligibility checks.

## [14.32.3] - 2026-09-27
### Added
- **Temporary HP Card Styling**: Added dedicated protective azure styling, `TEMP` micro-label, and "Temp HP Roll" subtitle for Temporary HP rolls in chat cards.
- **Auto-Roll Flat / Static Damage**: Automatically skips roll dialogs and rolls immediately for flat or deterministic damage/healing formulas without dice (e.g. Unarmed Strikes, flat bonuses).

## [14.32.2] - 2026-09-26
### Improved
- **D20 Multi-Die Collision Avoidance**: Dynamically adjusts roll result positioning to ensure Advantage, Disadvantage, and Elven Accuracy badges never overlap centered roll totals.

## [14.32.1] - 2026-09-25
### Fixed
- **Suppress Bloodied on Dead Tokens**: Fixed errors when tokens die without having been bloodied first, and resolved recursion issues during status evaluation.

## [14.32.0] - 2026-09-25
### Added
- **Enhanced Teleport Targeting UI (Autoanimations)**:
  - Floating HUD banner and ghost token preview with live distance readout, range indicators, and obstacle warnings for Automated Animations teleport spells (*Misty Step*, *Dimension Door*).
  - Dynamic Token Ring support renders authentic metallic frames and burst artwork during teleport previews.
  - Press Escape or click Cancel to cleanly abort teleportation.
  - Configurable under **Canvas & Tokens** and in **Personal Preferences**.

## [14.31.1] - 2026-09-25
### Fixed
- **Damage Prompt Whisper Visibility**: Fixed whispers strictly respecting "Player Only" visibility and unlinked token ownership permissions.

## [14.31.0] - 2026-09-25
### Added
- **Auto-Collapse Hostile Damage Trays for GM**: Automatically collapses damage application trays on hostile NPC rolls targeting players when players have damage application enabled, reducing GM chat clutter.
- **Suppress Bloodied on Dead Tokens**: Automatically suppresses and clears the bloodied condition when a token dies, and restores it if revived.
- **Multi-Die Roll Order**: Multi-die roll indicators on d20 buttons preserve natural chronological roll order while highlighting kept vs discarded dice.

## [14.30.0] - 2026-09-24
### Added
- **Hide Private GM Rolls from Players**: Completely hides whispered, private, and blind rolls authored by the GM from non-recipient players in the chat log, removing the empty `???` card placeholder.

## [14.29.3] - 2026-09-24
### Added
- **Unified Chat Badges & Styling**:
  - Extended whisper, blind roll, private roll, and emote badges and color borders to all chat messages and rolls.
  - **Private Rolls**: Non-blind rolls whispered to GMs or self display a **"🔒 PRIVATE"** badge with indigo accents.
  - **Whispers**: Text whispers and whispered cards display a **"🔒 WHISPER"** badge with indigo accents.
  - **Blind Rolls**: Blind rolls display an **"👁 BLIND"** badge with magenta accents.
  - **Emotes**: Emotes display a **"✦ EMOTE"** badge with amber accents.
- **Smite Exclusions for Self Effect Prompts**: Automatically excludes Smite spells and features (Divine Smite, Thunderous Smite, etc.) from triggering self-effect application prompt cards.

## [14.29.2] - 2026-09-23
### Fixed
- **Prone Token Rotation — Lock Rotation Edge Case & State Restoration**: Fixed an edge case where tokens with "Lock Rotation" enabled in their token configuration failed to visually rotate when knocked Prone if their document already had `rotation: 90` stored in the database. The rotation check now accounts for `lockRotation` state instead of early-exiting on stored rotation angles alone, ensuring locked tokens are unlocked and visibly tilt to 90° on canvas. Additionally, tokens that originally had "Lock Rotation" enabled now automatically have their rotation re-locked upon standing up from Prone, preserving top-down pog orientation.

## [14.29.1] - 2026-09-23
### Changed
- **Retroactive Advantage — Dice So Nice (DSN) New-Dice Only Trigger**: 3D dice animations now only trigger when newly evaluated dice are rolled (such as transitioning from Normal to Advantage/Disadvantage, or adding a third die for Elven Accuracy). When switching between modes using previously rolled and cached dice (e.g. toggling from Advantage to Disadvantage or returning to Normal), 3D dice animations are skipped entirely to avoid redundant or disruptive rolling animations.

## [14.29.0] - 2026-09-23
### Added
- **Retroactive Advantage / Disadvantage**: Added retroactive roll mode adjustments directly from chat cards with full native support for DnD5e v6 and Foundry V13 & V14.
  - **Segmented Roll Mode Buttons**: Injects `[ ADV ] [ NORMAL ] [ DISADV ]` segmented action buttons with full tooltips directly below the dice roll on d20 check, save, and attack roll chat cards, matching DnD5e's roll dialog button order (Advantage on the left, Normal in the middle, Disadvantage on the right), highlighting and disabling the currently active mode with authentic DnD5e ribbon gradients.
  - **Light & Dark Mode Theme Support**: Full native compatibility with Foundry V13+ and DnD5e v6 light and dark modes. Non-selected buttons feature crisp, high-contrast dark charcoal text and borders in Light Mode (`#191813` on parchment) and subtle silver text and borders in Dark Mode (`#f0f4f8` on denim), while preserving the highlighted crimson ribbon gradient for the active mode across all themes.
  - **Hover-Only Visibility**: The buttons remain completely collapsed and invisible to minimize chat clutter, smoothly expanding into view only when hovering over the chat card or when navigating via keyboard focus without causing layout shift for the roll above. A configurable setting (`Show Only on Hover`, enabled by default) allows users to keep buttons always visible if preferred.
  - **Anti-Exploit Die Value Preservation**: Original rolled die results are cached directly on the roll instance (`nd5tOriginalResults`) so toggling back and forth between Normal, Advantage, and Disadvantage never rolls new random dice for already-rolled slots, completely preventing re-roll abuse. Full support for Elven Accuracy (3 dice) and Halfling Lucky.
  - **Dynamic Attack Target Hit/Miss Recalculation**: Updating the roll dynamically refreshes attack target evaluation (`evaluatedTargets`), automatically recalculating target hit/miss pills, critical hits, and fumble highlights across all connected clients.
  - **Player Authorization & GM Socket Dispatch**: Players can modify their own rolls even if they lack database update permissions for `ChatMessage` documents in core Foundry. If `message.canUserModify` is false, the request is dispatched via socket to the active GM, who verifies author/actor ownership and applies the roll update securely. Unauthorized users cannot modify other players' rolls.
  - **Dice So Nice (DSN) Integration**: Automatically triggers 3D dice rolls via `game.dice3d` when new dice are evaluated.
  - **Personal Preferences Integration**: Added a personal client setting (`clientEnableRetroactiveAdvantage`) under Personal Preferences, allowing individual players to toggle the retroactive advantage buttons on or off for their own screen.

## [14.28.5] - 2026-09-22
### Added
- **Personal Preferences & Client-Side Feature Toggles**: Added a dedicated **Personal Preferences** section in the settings dashboard for players and GMs, allowing individual users to toggle features on or off for their own browser session (`scope: "client"`) without modifying world settings or affecting other players.
  - **Unrestricted Dashboard Access**: The settings dashboard (`NiksTweaksSettingsApp`) is now accessible to all players (`restricted: false`), automatically opening to the Personal Preferences tab when launched by non-GM players while keeping GM-only world settings disabled for security.
  - **Covered Features**:
    - *Workflow & Action Prompts*: Item/Spell Add Choice Dialog, Prompt for Attack Damage, Auto-Roll Attack Damage, Auto-Open Damage for Saves, Prompt for Initiative, Auto-Roll Initiative, Self Effect Application Prompt, Prompt for Death Saves, and Suppress Incoming Damage Prompts.
    - *Interface & Visual Enhancements*: Cursor Keyboard Hints, Roll Mode Highlight, Chat Card Styling Improvements, Sync Browser Tab Title, Sheet Pop-out Button, and Toolbar Limitation & Button Limit.
    - *Canvas & Templates*: Auto-Target Tokens in Spell Templates and Snap Templates to Grid Intersections.
  - **Client-Side Reset Defaults**: Non-GM players can now use the "Reset Defaults" action in the dashboard footer to safely restore their own personal client preferences to defaults without touching any world configuration.

### Changed
- **Sheet Plus Button — Subclass Spell List Filtering (Eldritch Knight, Arcane Trickster, Warrior of the Mystic Arts)**: When opening the Compendium Browser from an actor sheet's Spells tab, the spell list filter now automatically resolves and filters the appropriate class spell lists for casting subclasses whose parent classes do not have native spell lists. Characters with `eldritch-knight` or `arcane-trickster` subclasses are now automatically filtered to the **Wizard** spell list, and `warrior-of-the-mystic-arts` is filtered to the **Sorcerer** spell list. Non-spellcasting parent classes (Fighter, Rogue, Monk) without native spell lists are omitted from the filter query to ensure clean results.

## [14.28.4] - 2026-09-22
### Changed
- **Self Effect Application Prompt**: Prompts now strictly trigger when the used activity actually has Active Effects assigned to it.
- **Auto-Roll Concentration Saves**: Concentration prompts now route exclusively to the actor's connected player owner when online, falling back to the GM only when unattended.
- **Mage Slayer Concentration**: Added cross-client socket synchronization so connected players immediately receive concentration disadvantage when damaged by a Mage Slayer.
- **Template Grid Snap**: Fixed template grid intersection snapping in Foundry V14 and DnD5e 6.x for circle and square templates, with live preview snapping and intersection coordinates preserved on placement.

## [14.28.3] - 2026-09-22
### Fixed
- **Chat Card Styling — Single-Die d20 Badge Alignment**: Fixed an issue on Windows Chrome and high-DPI displays where single-die d20 hexagon badges could become misaligned vertically.

## [14.28.2] - 2026-09-20
### Added
- **Chat Card Styling — Show All d20 Dice for Advantage / Disadvantage / Elven Accuracy**: The d20 indicator badge on roll cards now shows every individual die rolled, not just the final kept result:
  - **Advantage**: Both d20 results are shown side by side — the kept die is bold and full-brightness, the discarded die is dimmed (e.g. **17** 9).
  - **Disadvantage**: Kept die prominently displayed, discarded die de-emphasized.
  - **Elven Accuracy** (3d20): All three dice are displayed, with the single kept die highlighted and discarded dice faded.
- **Chat Card Styling — Distinct Ability Check Palette (Warm Bronze)**: Shifted Ability Check color tokens to Warm Bronze / Ochre, providing clear visual distinction from Cobalt Blue Saving Throws.
- **Chat Card Styling — Saving Throw Label**: Updated prepended label on Saving Throw buttons from **"SAV "** to **"SAVE "** (e.g. **SAVE 14**).

## [14.28.1] - 2026-09-19
### Added
- **Chat Card Styling — Extended Roll Card Styling**: Extended themed styling to Saving Throws (Cobalt Blue, `SAVE`), Ability Checks (Warm Bronze, `CHK`), Healing Rolls (Forest Green, `HEAL`), Hit Dice (Sage Green, `HD`), and Monster Recharge (`RCH`), with dedicated sub-type labels for Death Saves (`DEATH`), Concentration Saves (`CONC`), and Initiative (`INIT`).

### Fixed
- **Chat Card Styling**: Fixed an issue where whisper, blind, and emote borders and tints could incorrectly apply to nested buttons or item elements.
- **Prone Rotation**: Fixed prone rotation on unlinked tokens (monsters and NPCs), improved condition toggle detection, and eliminated race conditions during rapid status changes.

## [14.28.0] - 2026-09-17
### Added
- **DnD5e Chat Card Styling Improvements**:
  - **Action Button Prominence**: Enlarges compact chat card action buttons with bold uppercase text and flexible icon scaling for **Atk**, **Dmg**, **Save**, **Check**, and **Heal**.
  - **Color-Coded Actions**: Distinct theme-tailored backgrounds, borders, and text colors for each action type in both Light and Dark themes.
  - **Distinct Attack & Damage Cards**: Attack cards feature a Royal Violet left border with gradient tint; Damage cards feature a Flame Orange border with warm gradient tint.
  - **Header Subtitle Badges**: Card header subtitles are styled into clean uppercase chip badges matching each card's theme.
  - **Prepended Labels**: Roll result buttons clearly identify what was rolled by prepending bold **"ATK "** (e.g. **ATK 17**) and **"DMG "** (e.g. **DMG 9**).
  - **Unified Whispers, Blind Rolls & Emotes**: Special message types feature distinctive accent borders and prominent chip badges (**🔒 WHISPER**, **👁 BLIND**, **✦ EMOTE**).
  - Configurable under **UI & Visuals > Chat Log**.

## [14.27.0] - 2026-09-17
### Added
- **Disable Active Effect Expiry (DnD5e)**: Added a new setting under *Phase 3: Concentration & Ongoing Effects* that prevents the system from automatically expiring or deleting active effects when their duration ends, on turn changes, or after combat. Effects remain active until manually toggled or removed by the GM or players. Disabled by default.

## [14.26.2] - 2026-09-16
### Fixed
- **Prone Rotation (DnD5e 6.0 Compatibility)**: Updated condition detection and immunity handling for DnD5e 6.0, ensuring creatures immune to Prone are not incorrectly rotated.

## [14.26.1] - 2026-09-16
### Added
- **Player Damage Prompt — Graze Prompts (Always On)**: Added an independent sub-setting allowing Graze damage prompts to be sent even when main player damage prompts are disabled.

### Fixed
- **Settings Dashboard — Child Setting Save**: Fixed disabled child settings inadvertently resetting to false when saving the form.

## [14.26.0] - 2026-09-13
### Added
- **Reliable Chat Log Auto-Scroll**: Ensures the chat log reliably scrolls completely to the bottom when new cards appear, collapsible trays expand, or roll messages update, while preserving your scroll position if you have manually scrolled up to read history.

## [14.25.0] - 2026-09-11
### Added
- **Roll Mode Highlight**: Persistently highlights the system-recommended roll mode button (Advantage or Disadvantage) in the roll configuration dialog:
  - Four selectable visual styles: **Glow**, **Border**, **Badge**, or **Fill**.
  - Fully customizable highlight colors.
  - Configurable under **UI & Visuals > Roll Dialogs**.

## [14.24.4] - 2026-09-11
### Fixed
- **Death Save Prompt (DnD5e 6.0 Compatibility)**: Updated death save roll triggers and GM fallback chat cards to be fully compatible with DnD5e 6.0.

## [14.24.3] - 2026-09-11
### Fixed
- **Auto-End Concentration (DnD5e 6.0 Conflict)**: Suppressed redundant native system prompts when Auto-End Concentration is active, ensuring only the module's chat notification appears.

## [14.24.2] - 2026-09-10
### Changed
- **Token Resizer Default**: Set the *Token Resizer Tool* setting to disabled by default.
- **Foundry V14 Scene Controls**: Updated Token Resizer scene controls registration for Foundry V14.
- **Settings Dashboard Modernization**: Cleaned up obsolete version badges and standardized ApplicationV2 window close handling.

### Fixed
- **DnD5e 6.0.0 Compatibility**: Updated chat cards, activity inspection, target resolution, and concentration handling for DnD5e 6.0.0.

## [14.24.1] - 2026-09-06
### Changed
- **Removed Residual V13 Code**: Cleaned up all remaining Foundry V13 compatibility code now that V14 is the minimum. Removed `renderChatMessage` dual-hook pattern (6 files), V13 `preCreateMeasuredTemplate` branch from template grid snap, V13 `game.release.generation < 14` guard from template targeting, and V13 references from comments and docstrings across 10 files.

## [14.24.0] - 2026-09-04
### Changed
- **Dropped Foundry V13 Support**: Module compatibility is now Foundry V14 minimum (`minimum: "14"`, `verified: "14"`). Removed legacy V13 code paths and guards.
- **Dropped DnD5e 5.x Support**: Updated manifest system compatibility to `minimum: "6.0.0"` and `verified: "6.0.0"`.
- **Removed Cast Activity Deletion Patch**: Removed `fix-cast-activity-deletion.js` as the issue is natively resolved in DnD5e 6.0.0.
- **Auto-Status at 0 HP**: Patched `Actor5e.prototype.updateDowned` so that when the module's *Auto-Apply Status at 0 HP* feature is enabled, it completely overrides the DnD5e 6.0.0 native Downed Status Automation (`autoApplyDowned`). This ensures the module's granular PC vs. NPC status choices and combat tracker actions take precedence without system conflicts. Also cleans up any lingering `dnd5e.autoDowned` effects on HP recovery, automatically escalates status to **Dead** if an actor at 0 HP accumulates 3 failed death saves, and set the feature's default state to disabled (`default: false`).
- **Self Effect Application**: Removed the module's synthetic fallback Active Effect for Mage Armor. Active Effects now only come directly from items or activities; the module itself no longer synthesizes effects.

## [14.23.2] - 2026-09-03
### Added
- **Auto-End Concentration — Boon of the Iron Mind Support**: For characters with the *Boon of the Iron Mind* feat, concentration now only automatically ends on **Unconscious**, **Dead**, or **Petrified** statuses, honoring the rule that *Unshakable Focus* protects concentration against standard incapacitating conditions like Stunned or Paralyzed.
### Fixed
- **Auto-Roll Concentration Saves — Boon of the Iron Mind Reliability**: Fixed an issue where manual roll configurations or button clicks could still trigger concentration saves for characters with the feat. Expanded identifier matching to the case-insensitive pattern `.*boon.*of.*the.*iron.*mind.*` (checking both `item.identifier` and `item.system.identifier`), and patched `Actor5e.prototype.rollConcentration` directly so all concentration roll paths reliably yield `null`.

## [14.23.1] - 2026-09-03
### Added
- **Auto-Roll Concentration Saves — Boon of the Iron Mind Support**: Characters with the *Boon of the Iron Mind* feat (matched by item identifier `boon-of-the-iron-mind` or case-insensitive name fallback `"Boon of the Iron Mind"`) are now exempted from concentration prompts and rolls upon taking damage. The dnd5e system's concentration challenge chat prompt card is suppressed and automated concentration save rolls are cancelled, fully honoring the feat's *Unshakable Focus* benefit.

## [14.23.0] - 2026-08-29
### Added
- **Auto-Unpause When Logging In** (`autoUnpauseOnLogin`, default: `"Never"`): When the GM logs into a paused world, optionally unpauses the game. Choices: **Always** (unpause regardless of how many players are connected), **When no players are connected** (only unpause if no non-GM players are already in the session), **Never** (disabled, default). This is a **per-user setting** (scope: `user`) — each GM account configures it independently.
### Fixed
- **Self Effect Application Prompt**: The prompt is now suppressed for activities that have an area-of-effect template (sphere, cone, cube, cylinder, line, radius, etc.), since those activities are never self-targeted. Previously, AoE spells with Active Effects (e.g. area buff abilities) could incorrectly trigger a self-application prompt.

## [14.22.0] - 2026-08-26
### Fixed
- **Skill Tooltip Overlap**: Fixed a DnD5e UI bug where skill (and tool) reference tooltips appeared directly over the character sheet skill list, covering adjacent rows and blocking click access to the roll link, proficiency-cycle, and config button. The patch wraps `_applyTooltips` on the `BaseActorSheet` prototype so that any `<li data-key>` element inside a `.skills > ul` or `.tools > ul` list receives `data-tooltip-direction="LEFT"` before the tooltip is set, causing the rule tooltip to render to the left of the row rather than overlapping the list. Gated to dnd5e versions below 6.0.0 (where an upstream fix is expected).

## [14.21.1] - 2026-08-23
### Changed
- **System Compatibility**: Updated `dnd5e` system relationship compatibility in the module manifest to verified `5.3.3` and maximum `5.99.99`.

## [14.21.0] - 2026-08-20
### Added
- **NPC Hit Point Scaling Buttons** (`enableNpcHpScaling`, default: `true`): Adds quick plus (`+`) and minus (`-`) scaling buttons directly into the NPC Hit Points configuration dialog (`HitPointsConfig`), allowing GMs to easily scale a creature's hit dice count up or down with one click.
  - **Dynamic Recalculation**: Automatically recalculates both the creature's average Maximum Hit Points and health formula using official 5e math: $\lfloor X \times \frac{Y + 1}{2} + X \times \text{CON mod} \rfloor$ where $Y$ is the hit die size based on creature size (Tiny: d4, Small: d6, Medium: d8, Large: d10, Huge: d12, Gargantuan: d20) or custom formula denomination.
  - **Delta Preservation**: Modifying max HP adjusts current HP by the same delta (keeping full health monsters at full HP), managed natively through ApplicationV2 form submission.
  - **Shift-Click Fast Scaling**: Hold **Shift** while clicking either button to scale by 5 hit dice at a time (e.g. for scaling formidable bosses or minions).
  - **Safe Minimum**: Automatically enforces a safe minimum of 1 hit die / 1 HP, disabling the minus button when at the minimum.
  - **Configurable**: Fully toggleable in the Settings Dashboard under *UI & Visuals -> Sheets & Toolbars*.

## [14.20.4] - 2026-08-20
### Fixed
- Fixed release.

## [14.20.3] - 2026-08-20
### Fixed
- **Auto-Status at 0 HP**: Fixed a bug where tokens with the unconscious (or dead) condition at positive HP (e.g. from spells or effects like *Sleep*) had their condition erroneously removed when taking damage above 0 HP (e.g. dropping from 9 HP to 1 HP). Status removal and combatant un-defeating are now strictly restricted to tokens that were actually at 0 HP before gaining HP (`wasZeroHP === true`), eliminating the incorrect fallback check on existing status flags.
- **Auto-Status at 0 HP**: Improved debounce handling across rapid multi-step HP updates (e.g. 0 HP → 1 HP → 5 HP) by preserving the initial pre-update `wasZeroHP` state across the debounce window.

## [14.20.2] - 2026-08-19
### Added
- **Damage Type Icons in Damage Prompts**: Added themed, color-coded FontAwesome 6 icons next to damage and healing types in both the classic text layout and structured table layout (e.g. 🔥 Fire, ❄️ Cold, ⚡ Lightning, ⚔️ Slashing, 💚 Healing).
- **Damage Prompt AC Handling**: Removed the redundant secondary AC threshold check on damage rolls (since rolling damage implies the attack hit, preventing false negatives from situational bonuses or GM rulings).

## [14.20.1] - 2026-08-19
### Fixed
- **Player Damage Prompt Card Reliability**: Fixed an issue where damage prompt cards were not reliably posted when damage was triggered via *Auto-Roll Attack Damage*, *Prompt for Attack Damage*, or *Auto-Roll Save Damage*. `activity.rollDamage` now passes `originatingMessage` and `targets` flags through `messageConfig`. Enhanced `_findAttackMessage` to fall back to matching recent attack rolls by speaker and activity context, improved target resolution from canvas when message flags are sparse, and fixed a reference error in the Graze weapon mastery handler.

## [14.20.0] - 2026-08-19
### Added
- **ApplicationV2 Settings Dashboard**: Replaced the native flat 40+ item module settings scroll list with a modern, categorized **Settings Dashboard** powered by Foundry's `ApplicationV2` and `HandlebarsApplicationMixin`.
  - **Categorized Tabs**: Organizes all module settings across 4 clean tabs — **UI & Visuals** (including sheet tweaks and Compendium Browser controls), **Canvas & Tokens**, **Combat & Automation** (with sub-headers for the 5 combat lifecycle phases), and **Utilities & Diagnostics**.
  - **Live Search & Filter**: Real-time search bar that filters settings, hints, and category titles as you type, with matching item counts and clear shortcuts.
  - **Reactive Parent–Child Dependencies**: Dependent sub-settings (such as layout options, format pickers, and specific combat prompts) automatically enable, dim, or disable reactively when their parent feature switch is toggled.
  - **JSON Configuration Backup (Export / Import)**: One-click export to download your complete tweaks configuration to a `.json` backup file, and one-click import to restore or migrate settings across worlds.
  - **Reset to Defaults**: Safely reset all module settings to their defaults with a confirmation dialog.
  - **Permission Support (`SETTINGS_MODIFY`)**: Fully compatible with Foundry's "Modify Configuration Settings" permission, allowing both GMs and authorized players with settings modification rights to configure module tweaks.
  - **Visual Feature Badges**: Contextual tags identifying `[World]`, `[Client]`, `[V14+]`, and `[Reload]` settings at a glance.

## [14.19.0] - 2026-08-18
### Added
- **Prompt for Attack Damage** (`promptForAttackDamage`, default: **"For All"**): When an attack roll hits a target's AC, automatically opens the damage roll configuration dialog for the attacker. Supports the standard four-way choice — **For All**, **For Players**, **For NPCs**, **For None**. The attacker's actor type (player character or NPC) determines whether the setting applies. Critical hits are treated as hits. Bypassed automatically when midi-qol is configured to auto-apply damage.
- **Auto-Roll Attack Damage** (`autoRollAttackDamage`, default: **"For None"**): When an attack roll hits a target's AC, automatically rolls damage immediately without showing a configuration dialog. Same four-way choice as above. Takes precedence over *Prompt for Attack Damage* for the same actor type. Bypassed automatically when midi-qol is configured to auto-apply damage.

## [14.18.0] - 2026-08-16
### Added
- **Auto-Target Tokens in Spell Templates** *(V14 only)*: When a spell or ability template is placed on the canvas, all tokens whose position falls inside the template area are automatically targeted by the placing user. Targets update **live while dragging** — token target rings appear and disappear in real time as the template is moved over tokens, before placement is confirmed. On final placement, targets are re-evaluated using Foundry V14's native `TokenDocument#testInsideRegion()` API for accuracy. Large/Huge/Gargantuan multi-square tokens are correctly handled by checking each occupied grid square. Targets are **replaced** (not merged) on every update, matching midi-qol behavior. The feature is automatically and completely disabled when **midi-qol** is installed and active (to prevent conflicts with its own template targeting). Enabled by default. Configurable under *Group 2: Canvas & Tokens* as **Auto-Target Tokens in Spell Templates**.

### Fixed
- **Cast Activity Deletion — Orphaned Cached Spells**: Fixed a Foundry V14 bug where deleting a Cast activity from an item left the actor's corresponding cached spell items permanently orphaned. In Foundry V14, activity deletion uses a `DataFieldOperator` value (`_del`) rather than the legacy `"-="` key prefix. The dnd5e `ActivitiesTemplate#preUpdateActivities` method only recognised the old prefix, so the cleanup step that removes cached spells was silently skipped, leaving the spell items on the actor with a stale `flags.dnd5e.cachedFor` reference. The patch normalises `_del` entries to the `"-="` form before the original handler runs, restoring correct cleanup behaviour. Gated to dnd5e versions below 6.0.0 (where the upstream fix is expected).

## [14.17.1] - 2026-08-13

### Changed
- **Prompt for Initiative**: Changed the default value of the **Prompt for Initiative** setting (`promptForInitiative`) from `"For All"` to `"For Players"`.

## [14.17.0] - 2026-08-13
### Added
- **Sheet Pop-out Button**: Adds a one-click pop-out button to Actor and Item sheet headers to detach the sheet into a separate browser window.
- **Independent Initiative Settings**: Added separate world settings for **Prompt for Initiative** and **Auto-Roll Initiative** with four-way actor selection (For All, For Players, For NPCs, For None).
- **Settings Migration**: Automatically migrates existing initiative preferences to the new settings format.

### Changed
- **Module Settings Reorganization**: Reorganized combat settings to follow the logical 5-phase combat lifecycle.
- **Sheet Choice Dialog Placement**: Moved **Item/Spell/Feature Add: Choice Dialog** into User Interface & Visuals.

### Fixed
- **Auto-Status at 0 HP**: Fixed a condition where multiple monsters taking damage simultaneously (such as from AoE spells) could cause status conditions to be missed, and restricted status processing to the active GM to prevent duplicate updates.
- **Prone Rotation**: Fixed rotation handling when players apply conditions to NPCs, and improved condition detection on unlinked tokens.

## [14.16.1] - 2026-08-06
### Fixed
- **Auto-Add Tokens to Combat**: Tokens created via a summon activity are no longer automatically added to active combat encounters.
- **Mage Slayer Concentration**: Fixed Mage Slayer concentration disadvantage for unlinked tokens, prompts, dialogs, and player damage prompt workflows.

## [14.16.0] - 2026-08-05
### Added
- **Auto-Add Tokens to Combat**: Added a world setting that automatically adds tokens created or dragged onto the canvas during active combat into the tracker and rolls initiative.

### Changed
- **Toolbar Limitation**: Converted toolbar limitation to client preferences so each player can customize max displayed buttons independently.
- **Auto-End Class Features**: Renamed and expanded setting to support Barbarian Rage, Wrath of the Sea, and Starry Form.
- **Socket Dispatcher**: Consolidated module communication into a central dispatcher for improved stability.

### Fixed
- **Self Effect Application**: Improved status effect application reliability when caster tokens are not placed on the active canvas scene.

## [14.15.1] - 2026-08-01
### Fixed
- **Toolbar Limitation**: Ensured toolbar limitation does not apply to the macro hotbar.

## [14.15.0] - 2026-08-01
### Added
- **Toolbar Limitation**: Added a setting to cap the visible number of buttons in toolbars (such as Scene Controls) and make overflowing bars scrollable.

### Fixed
- **Self Effect Application**: Improved name recognition for Mage Armor and configured features when cast without targets.

## [14.14.11] - 2026-07-31
### Added
- **Self Effect Application**: Added an **Always Prompt Features** setting to specify features/items that should always prompt for self-application even if not self-targeted.

### Fixed
- **Player Damage Prompt**: Fixed an issue where damage prompt messages could be broadcast publicly when no GM was online.
- **Canvas Crash Prevention**: Added safety checks to prevent crashes when deleting tokens with active status conditions or negative elevations.

## [14.14.10] - 2026-07-30
### Fixed
- **Player Damage Prompt**: Ensured GM-whispered damage prompt cards display true NPC names even when the `hide-npc-names` module is active.

## [14.14.9] - 2026-07-29
### Fixed
- **Combat Start State Reliability**: Fixed combat start timing race conditions and deferred document updates across combat modules to ensure reliable state tracking.

## [14.14.7] - 2026-07-29
### Removed
- **Player Damage Prompt**: Removed automatic cleanup of chat messages older than 10 minutes.

## [14.14.6] - 2026-07-29
### Changed
- **Auto-Roll Concentration Saves**: Changed the default value of the **Fast-Forward Concentration Rolls** setting (`autoRollConcentrationFastForward`) to **"NPCs Only"** (previously "All Actors").

### Fixed
- **Sheet Plus Compendium**: Fixed an issue where the choice dialog erroneously triggered on item quantity plus buttons (`+`) and other non-creation sheet buttons. Added strict button filtering (`_isExcludedButton` and targeted button matching) to ensure the dialog only triggers on actual item, spell, or feature creation buttons across DnD5e and Tidy 5e sheets.

## [14.14.5] - 2026-07-29
### Fixed
- **Self Effect Application**: Fixed a bug where applying an item effect configured with `transfer: true` (such as Barbarian **Rage**) created a duplicate active effect document directly on the actor while leaving the item's transferred effect inactive on the actor. Transferred item effects are now directly enabled and disabled on the source effect document, preventing duplicate active effect documents and leftover inactive copies on the actor. Also automatically cleans up any stale duplicate non-transfer effects created on actors by earlier module versions.

## [14.14.4] - 2026-07-27
### Improved
- **Item/Spell/Feature Add: Choice Dialog**:
  - **Tidy 5e Sheets Subcategory Add Buttons**: Expanded button resolution to catch all sub-category section header add buttons (`.tidy-table-button`, plus icons in table headers) and empty-state section add buttons across Tidy 5e Sheets (Classic & Quadrone) for Items, Spells, and Features tabs.

## [14.14.3] - 2026-07-27
### Improved
- **Item/Spell/Feature Add: Choice Dialog**:
  - **Tidy 5e Sheets Compatibility**: Added full support for Tidy 5e Sheets (both Classic and Quadrone layouts) via dedicated render hooks (`tidy5e-sheet.renderActorSheet`) and support for Tidy5e tab attributes (`data-tab-contents-for`, `data-tab-id`) and button selectors (`.item-create`).

## [14.14.2] - 2026-07-27
### Added
- **Item/Spell/Feature Add: Choice Dialog**: When clicking the '+' button on character sheets in the Items, Spells, or Features tab, prompts the user to select whether to create a new document directly or open the DnD5e Compendium Browser.
  - **Default Choice**: "Browse Compendium" is placed on the left as the default primary button in the dialog.
  - **Spells Compendium Filtering**: Selecting "Browse Compendium" for spells automatically pre-filters the Compendium Browser for the actor's class(es) (e.g. `class:wizard`, `class:cleric`) and the spell level of the section clicked (or the actor's castable spell level range).
  - **Items Compendium Filtering**: Selecting "Browse Compendium" for items opens the Compendium Browser on the physical items tab.
  - **Features Compendium Filtering**: Selecting "Browse Compendium" for features opens the Compendium Browser on the feats tab.
  - **Shift-Click Bypass**: Holding **Shift** while clicking the '+' button bypasses the prompt dialog and proceeds directly with standard item/spell/feature creation.
  - **Configurable Setting**: Gated by a new world setting (`enableSheetPlusCompendium`), enabled by default.


## [14.13.5] - 2026-07-27
### Improved
- **Self Effect Application**: Extended self-effect application from items that explicitly/naturally target "self" to also include items targeting other creatures (e.g., *Haste*, *Invisibility*, *Fly*, *Cure Wounds*, *Bless*, *Shield of Faith*, *Sanctuary*) when the user manually targets their own token on the canvas or in the activity usage chat card.
- **Self Effect Application**: Fixed a bug where un-applied item template effects (displayed under "Unavailable Effects" on the character sheet, such as *Mage Armor*) were incorrectly treated as already-active effects on the actor, preventing prompt cards from appearing.
- **Auto-Clear Movement History**: Simplified configuration by removing sub-settings. When enabled, token movement history trails are now always automatically cleared for all combatants on every turn change and when combat starts.

## [14.13.4] - 2026-07-26
### Improved
- **midi-qol Compatibility & Optimization**:
  - **Auto-Roll Concentration Saves**: Automatically detects if `midi-qol` is active and configured to process concentration checks (`doConcentrationCheck !== "none"`). When midi-qol handles concentration checks, `niks-dnd5e-tweaks` automatically yields to prevent duplicate concentration save rolls. Expanded chat card processing so the "End Concentration" button works on midi-qol concentration roll cards.
  - **Self Effect Application**: Automatically yields when `midi-qol` is configured to auto-apply item active effects (`autoItemEffects !== "off"`). Also filters out effects that are already active on the target actor to avoid redundant prompt cards.
  - **Player Damage Prompt**: Automatically yields when `midi-qol` is configured to auto-apply damage (`autoApplyDamage` mode is "yes*") to prevent duplicate damage prompt cards or double damage application.
  - **Mage Slayer Concentration**: Enhanced attacker actor resolution in `dnd5e.preApplyDamage` to check midi-qol workflow options (`options.workflow.actor`, `options.item.actor`, `options.midi.workflow.actor`), allowing Mage Slayer concentration disadvantage to function seamlessly when damage is applied via midi-qol.
  - **Documentation**: Updated `README.md` to detail the smart automatic compatibility handling for midi-qol settings.

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