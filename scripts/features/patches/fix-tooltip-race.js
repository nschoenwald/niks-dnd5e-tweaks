/**
 * Feature: Rich Tooltip Race Patch
 * Description: Item, spell and other rich tooltips show the item under the cursor when the cursor sweeps quickly
 *              across many rows, instead of flipping through the items that finished loading late.
 *
 * @introduced v14.83.1
 */
import { log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Rich Tooltips Lag Behind and Flip Through Stale Content
 * ---------------------------------------------------------------------------
 * Foundry's TooltipManager moves an active tooltip to the next hovered element at once, writing that element's
 * placeholder (dnd5e: `<section class="loading" data-uuid>` spinner) into the shared `#tooltip`. dnd5e's
 * `Tooltips5e` watches the tooltip's `class` attribute and, on each activation, runs `_onTooltipActivate`:
 * `await fromUuid(uuid)` (a server round trip for compendium documents) and then `await doc.richTooltip()`
 * (template render and enrichment), and finally writes `this.tooltip.innerHTML`. Nothing checks whether
 * `game.tooltip.element` is still the element that started the request. Sweeping across ten rows starts ten
 * requests; they finish in random order and each overwrites the tooltip, so it keeps changing while the cursor
 * rests on one row and can end on the wrong item. A request whose document can't be found also calls
 * `game.tooltip.deactivate()`, closing whatever tooltip is showing by then.
 *
 * Same code in dnd5e 6.0.6 and 6.1.0, not fixed upstream, so not version-gated.
 *
 * libWrapper binds `this` for the wrapped call, so the stale writes inside the original can't be redirected. This
 * patch is therefore MIXED: the two document branches (content links and sheet tooltips with a `data-uuid`
 * placeholder) are run here with the same steps as dnd5e's `_onTooltipActivate`, `_onHoverActor` and
 * `_onHoverContentLink`, checking after every await that this activation is still the latest one for the same
 * element. Passive check / language tooltips (no server round trip) go to the original unchanged. If dnd5e
 * changes these methods, compare them with this copy.
 */

/** Incremented on every tooltip activation; a request is stale once a newer activation has started. */
let activationCount = 0;

export function initFixTooltipRace() {
    const patched = patchMethod(
        "game.dnd5e.tooltips._onTooltipActivate",
        async function patchedOnTooltipActivate(wrapped, ...args) {
            const token = ++activationCount;
            const element = game.tooltip.element;
            if (!element) return wrapped(...args);

            const isContentLink = element.classList.contains("content-link");
            const loading = this.tooltip.querySelector(".loading");
            const isSheetTooltip = loading?.dataset.uuid !== undefined;
            if (!isContentLink && !isSheetTooltip) return wrapped(...args);

            const isCurrent = () => (token === activationCount) && (game.tooltip.element === element);

            // Theme, as in dnd5e's _onTooltipActivate.
            const nearestThemed = element.closest(".themed") ?? element.ownerDocument.body;
            const [, theme] = nearestThemed.className.match(/(?:^|\s)(theme-\w+)/) ?? [];
            this.tooltip.classList.remove("theme-dark");
            this.tooltip.classList.add(theme ? theme : "theme-light");

            const uuid = isContentLink ? element.dataset.uuid : loading.dataset.uuid;
            const doc = await fromUuid(uuid);
            if (!isCurrent()) return;

            // Sheet attribution tooltips (dnd5e's _onHoverActor).
            if (isSheetTooltip && (doc instanceof dnd5e.documents.Actor5e)) {
                const { attribution, attributionCaption } = element.dataset;
                if (!attribution) return;
                const html = await doc.getAttributionData(attribution, { title: attributionCaption });
                if (isCurrent()) this.tooltip.innerHTML = html;
                return;
            }

            // Rich document tooltips (dnd5e's _onHoverContentLink).
            if (!doc) return game.tooltip.deactivate();
            let extras = element.dataset.tooltipExtras;
            if (extras) extras = foundry.utils.cleanHTML(extras);
            const { content, classes } = await (
                doc.richTooltip?.({ extras }) ?? doc.system?.richTooltip?.({ extras }) ?? {}
            );
            if (!content || !isCurrent()) return;
            this.tooltip.innerHTML = content;
            if (classes?.length) this.tooltip.classList.add(...classes);
            const { tooltipDirection } = element.dataset;
            requestAnimationFrame(() => {
                if (isCurrent()) this._positionItemTooltip(tooltipDirection);
            });
        },
        "MIXED"
    );

    if (patched) log("Fix: Rich Tooltip Race | Patched Tooltips5e#_onTooltipActivate.");
}
