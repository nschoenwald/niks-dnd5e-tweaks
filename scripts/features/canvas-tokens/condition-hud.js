/**
 * Feature: Token HUD Condition Palette
 * Description: Turns the Token HUD's grid of status icons into a labelled list: every condition shows its name,
 *              conditions and other effects are grouped, active ones are highlighted (with their level for
 *              leveled conditions such as Exhaustion, and a mark for overlays), and the palette button shows how
 *              many are active. Each group is sorted A–Z by name. Statuses the GM hides in the settings are left out of the palette unless the
 *              token currently has them.
 *
 * @introduced v14.63.0
 * @updated v14.63.2 (fixed equal-width columns; cut-off names show as tooltip)
 * @updated v14.64.0 (gear in the hint line opens the Hidden Statuses setting)
 * @updated v14.71.3 (suppresses Monk's Little Details' Token HUD status changes while active; groups sorted A–Z)
 * @updated v14.71.4 (Personal setting: Use World Setting / On / Off, can turn it on when the GM left it off)
 */
import { MODULE_ID, getSetting, debug } from "../../context.js";
import { isFeatureOnForUser } from "../../utils/personal-override.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { parseListValue } from "../../utils/list-value.js";
import { coreApi } from "../../core-integration.js";

/**
 * How it works
 *
 * Core renders the palette as `<img class="effect-control" data-action="effect" data-status-id>` elements inside
 * `.palette.status-effects` (`templates/hud/token-hud.hbs`). dnd5e's `TokenHUD5e` marks statuses active through
 * `actor.statuses` and, in `_onRender`, gives leveled conditions their level icon as the img's background.
 *
 * - `TokenHUD5e#_getStatusEffectChoices` is wrapped to drop hidden statuses (kept while active, so they can still
 *   be removed). Wrapping the dnd5e override means its own active marking has already run.
 * - The renderTokenHUD hook runs after `_onRender`, so the level icons are in place. It wraps every img in an
 *   entry row that takes over `data-action="effect"` and `data-status-id`; the HUD's action handler finds the
 *   closest `[data-action]`, so clicks and right-clicks on the icon or the label both reach dnd5e's handler.
 *   The img keeps `data-status-id` for anything that looks it up.
 *
 * Monk's Little Details ("Alter Token HUD Status", setting `alter-hud`) also rebuilds this palette: it wraps each
 * img in `.effect-container` with an `.effect-name`, appends a `.clear-all` row, sets inline grid styles on the
 * palette and adds `monks-little-details` / `highlight-image` to `#token-hud`, which all of its CSS is scoped to.
 * It registers its renderTokenHUD hook in `init` and its handler runs synchronously, so it has always finished
 * before ours (registered in `setup`). `_suppressMonksHud` undoes it; its containers and Clear All row go away when
 * the palette's children are replaced. Its sorting wrapper on `_getStatusEffectChoices` (by status ID, since the
 * choices have no `name` / `label`) has no effect: each group is sorted by the shown name here.
 */

const BODY_CLASS = "nd5t-condition-hud";

/** Statuses hidden by default: the long-term survival conditions rarely used in combat. */
export const DEFAULT_HIDDEN_STATUSES = "dehydration, malnutrition, suffocation";

function _isActive() {
    return isFeatureOnForUser("enableConditionHud", "clientConditionHud");
}

/**
 * Status IDs the GM hid from the palette.
 * @returns {Set<string>}
 */
export function getHiddenStatuses() {
    try {
        return new Set(parseListValue(getSetting("hudHiddenStatuses")));
    } catch {
        return new Set();
    }
}

/**
 * Whether a status is one of dnd5e's real conditions (as opposed to pseudo conditions and other statuses).
 * @param {string} id
 * @returns {boolean}
 */
export function isSystemCondition(id) {
    const config = CONFIG.DND5E?.conditionTypes?.[id];
    return Boolean(config) && !config.pseudo;
}

/**
 * Wrapper for `TokenHUD#_getStatusEffectChoices`: leave out hidden statuses unless they are active.
 * @this {TokenHUD}
 */
function _wrapGetStatusEffectChoices(wrapped, ...args) {
    const choices = wrapped(...args);
    if (!_isActive()) return choices;
    const hidden = getHiddenStatuses();
    if (!hidden.size) return choices;
    for (const [id, choice] of Object.entries(choices)) {
        if (hidden.has(id) && !choice.isActive) delete choices[id];
    }
    return choices;
}

/**
 * Levels of the actor's leveled conditions, keyed by status ID (e.g. exhaustion → 2).
 * @param {Actor5e} actor
 * @returns {Map<string, number>}
 */
function _conditionLevels(actor) {
    const levels = new Map();
    for (const effect of actor?.effects?.documentsByType?.condition ?? []) {
        if (effect.system?.hasLevels && effect.system.level) levels.set(effect.system.type, effect.system.level);
    }
    return levels;
}

/**
 * Build one labelled entry around a status icon.
 * @param {HTMLImageElement} img
 * @param {object} choice   The status choice from the HUD context.
 * @param {number} [level]  Level of a leveled condition.
 * @returns {HTMLElement}
 */
function _buildEntry(img, choice, level) {
    const doc = img.ownerDocument;
    const entry = doc.createElement("div");
    entry.className = "nd5t-status-entry";
    if (choice?.isActive) entry.classList.add("active");
    if (choice?.isOverlay) entry.classList.add("overlay");
    entry.dataset.action = "effect";
    entry.dataset.statusId = img.dataset.statusId;

    const title = choice?.title || img.dataset.tooltipText || img.dataset.statusId;
    entry.setAttribute("role", "button");
    entry.setAttribute("aria-pressed", choice?.isActive ? "true" : "false");
    entry.setAttribute("aria-label", level ? `${title} ${level}` : title);

    // The label replaces the tooltip; keep the icon free of the action so the entry is the single target.
    img.removeAttribute("data-action");
    delete img.dataset.tooltipText;
    img.removeAttribute("data-tooltip");
    img.alt = "";

    const label = doc.createElement("span");
    label.className = "nd5t-status-label";
    label.textContent = title;
    entry.append(img, label);

    if (level) {
        const badge = doc.createElement("span");
        badge.className = "nd5t-status-level";
        badge.textContent = level;
        entry.append(badge);
    }
    if (choice?.isOverlay) {
        const overlay = doc.createElement("i");
        overlay.className = "fa-solid fa-expand nd5t-status-overlay";
        overlay.setAttribute("inert", "");
        overlay.dataset.tooltipText = "Shown as overlay";
        entry.append(overlay);
    }
    return entry;
}

/**
 * Build a titled group of entries.
 * @param {Document} doc
 * @param {string} title
 * @param {HTMLElement[]} entries
 * @returns {HTMLElement}
 */
function _buildGroup(doc, title, entries) {
    const group = doc.createElement("section");
    group.className = "nd5t-status-group";
    const heading = doc.createElement("h4");
    heading.className = "nd5t-status-heading";
    heading.textContent = title;
    const grid = doc.createElement("div");
    grid.className = "nd5t-status-grid";
    grid.append(...entries);
    group.append(heading, grid);
    return group;
}

/**
 * Give an entry the full status name as tooltip while its label is cut off. Measured on hover because the palette
 * is hidden until opened. `pointerover` fires before `pointerenter`, which core's TooltipManager listens for.
 * @param {PointerEvent} event
 */
function _onPointerOverEntry(event) {
    const entry = event.target.closest?.(".nd5t-status-entry");
    const label = entry?.querySelector(".nd5t-status-label");
    if (!label) return;
    if (label.scrollWidth > label.clientWidth) entry.dataset.tooltipText = label.textContent;
    else delete entry.dataset.tooltipText;
}

/**
 * Undo Monk's Little Details' Token HUD changes that clash with the palette (see "How it works").
 * @param {HTMLElement} element  The Token HUD element (`#token-hud`).
 * @param {HTMLElement} palette  The status palette.
 */
function _suppressMonksHud(element, palette) {
    element.classList.remove("monks-little-details", "highlight-image");
    palette.style.removeProperty("grid-template-rows");
    palette.style.removeProperty("grid-auto-flow");
    palette.style.removeProperty("--effect-padding");
}

/**
 * renderTokenHUD: rebuild the status palette as a labelled, grouped list.
 * @param {TokenHUD} app
 * @param {HTMLElement} element
 * @param {object} context
 */
function _onRenderTokenHUD(app, element, context) {
    try {
        if (!_isActive()) return;
        const palette = element?.querySelector?.(".palette.status-effects");
        if (!palette || palette.classList.contains("nd5t-status-palette")) return;
        if (game.modules.get("monks-little-details")?.active) _suppressMonksHud(element, palette);

        const choices = context?.statusEffects ?? {};
        const levels = _conditionLevels(app.actor);
        const conditions = [];
        const others = [];
        let activeCount = 0;
        for (const img of palette.querySelectorAll("img.effect-control[data-status-id]")) {
            const id = img.dataset.statusId;
            const choice = choices[id];
            if (choice?.isActive) activeCount++;
            const entry = _buildEntry(img, choice, choice?.isActive ? levels.get(id) : undefined);
            (isSystemCondition(id) ? conditions : others).push(entry);
        }

        // Each group strictly A–Z by the shown name. Core sorts by `order` first (dnd5e pins Dead and Cover; statuses
        // other modules add without an order come first), and Monk's Little Details re-sorts by status ID.
        const byName = (a, b) => a.querySelector(".nd5t-status-label").textContent
            .localeCompare(b.querySelector(".nd5t-status-label").textContent, game.i18n.lang);
        conditions.sort(byName);
        others.sort(byName);

        const doc = element.ownerDocument;
        const groups = [];
        if (conditions.length) groups.push(_buildGroup(doc, game.i18n.localize("DND5E.Conditions"), conditions));
        if (others.length) groups.push(_buildGroup(doc, conditions.length ? "Other Effects" : "Effects", others));

        const hint = doc.createElement("p");
        hint.className = "nd5t-status-hint";
        hint.innerHTML = '<i class="fa-solid fa-computer-mouse" inert></i> Right-click: show as overlay, or lower the level';
        if (game.user.can("SETTINGS_MODIFY")) {
            // Shortcut to the Hidden Statuses setting in the dashboard.
            const config = doc.createElement("a");
            config.className = "nd5t-status-config";
            config.dataset.tooltipText = "Choose which statuses are hidden";
            config.setAttribute("role", "button");
            config.setAttribute("aria-label", "Choose which statuses are hidden");
            config.innerHTML = '<i class="fa-solid fa-gear" inert></i>';
            config.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                coreApi()?.openSettings(`${MODULE_ID}.hudHiddenStatuses`);
            });
            hint.append(config);
        }

        palette.replaceChildren(...groups, hint);
        palette.classList.add("nd5t-status-palette");
        palette.addEventListener("pointerover", _onPointerOverEntry);

        // Number of active statuses on the palette button.
        const button = element.querySelector('[data-action="togglePalette"][data-palette="effects"]');
        if (button && activeCount) {
            const badge = doc.createElement("span");
            badge.className = "nd5t-status-count";
            badge.textContent = activeCount;
            badge.setAttribute("aria-hidden", "true");
            button.append(badge);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Token HUD Condition Palette failed`, err);
    }
}

/**
 * Re-render an open Token HUD so a changed setting shows right away.
 */
export function refreshConditionHud() {
    document.body.classList.toggle(BODY_CLASS, _isActive());
    const hud = canvas?.hud?.token;
    if (hud?.rendered) hud.render();
}

/**
 * Initialize the Token HUD Condition Palette. Called once during the "setup" phase from main.js.
 */
export function initConditionHud() {
    const hudClass = CONFIG.Token.hudClass ?? foundry.applications.hud.TokenHUD;
    const target = hudClass === foundry.applications.hud.TokenHUD
        ? "foundry.applications.hud.TokenHUD.prototype._getStatusEffectChoices"
        : "CONFIG.Token.hudClass.prototype._getStatusEffectChoices";
    patchMethod(target, _wrapGetStatusEffectChoices, "WRAPPER");
    Hooks.on("renderTokenHUD", _onRenderTokenHUD);
    Hooks.once("ready", () => document.body.classList.toggle(BODY_CLASS, _isActive()));
    debug("Token HUD Condition Palette | Initialized");
}
