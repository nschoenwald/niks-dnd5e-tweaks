/**
 * Feature: Token HUD Condition Palette
 * Description: Turns the Token HUD's grid of status icons into a labelled list: every condition shows its name,
 *              conditions and other effects are grouped, active ones are highlighted (with their level for
 *              leveled conditions such as Exhaustion, and a mark for overlays), and the palette button shows how
 *              many are active. Statuses the GM hides in the settings are left out of the palette unless the
 *              token currently has them.
 *
 * @introduced v14.63.0
 */
import { MODULE_ID, getSetting, isFeatureActive, debug } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { parseListValue } from "../../settings-list-editor.js";

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
 */

const BODY_CLASS = "nd5t-condition-hud";

/** Statuses hidden by default: the long-term survival conditions rarely used in combat. */
export const DEFAULT_HIDDEN_STATUSES = "dehydration, malnutrition, suffocation";

function _isActive() {
    return isFeatureActive("enableConditionHud", "clientEnableConditionHud");
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

        const doc = element.ownerDocument;
        const groups = [];
        if (conditions.length) groups.push(_buildGroup(doc, game.i18n.localize("DND5E.Conditions"), conditions));
        if (others.length) groups.push(_buildGroup(doc, conditions.length ? "Other Effects" : "Effects", others));

        const hint = doc.createElement("p");
        hint.className = "nd5t-status-hint";
        hint.innerHTML = '<i class="fa-solid fa-computer-mouse" inert></i> Right-click: show as overlay, or lower the level';

        palette.replaceChildren(...groups, hint);
        palette.classList.add("nd5t-status-palette");

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
