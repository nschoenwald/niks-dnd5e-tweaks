/**
 * Feature: Placeables Sidebar Recovery Patch
 * Description: Fixes an upstream Foundry V14 core bug where one failed render of a Placeables sidebar sub-tab breaks the sidebar until reload.
 *
 * @introduced v14.61.1
 */
import { log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: Placeables Sidebar Stuck After a Failed Sub-Tab Render
 * ---------------------------------------------------------------------------
 * `PlaceableDirectory#_renderTab` renders the active sub-tab app (e.g. the
 * Tokens tab) and swaps its element in for the directory's
 * `[data-application-part=tab]` element. The tab part is only rendered on the
 * first render, so later renders expect the sub-tab's own element to still be
 * in place.
 *
 *  1. When the sub-tab throws in `_renderHTML` (for example a module's token
 *     `name` getter throwing for a token whose actor was deleted),
 *     `ApplicationV2#render` removes its element and sets its state to ERROR.
 *  2. The next render counts as a first render. `_insertElement` finds no
 *     element with the tab's id and appends it to `document.body`, which
 *     pushes the interface to the left.
 *  3. `_renderTab` finds no tab part and throws "Cannot read properties of
 *     null (reading 'replaceWith')" on every render until reload.
 *
 * Before each `_renderTab`, this puts back an empty tab part when it is
 * missing. Core's own `replaceWith` then moves the sub-tab element into the
 * directory, out of `document.body` if it landed there.
 *
 * Not fixed upstream as of Foundry 14.369. Add a FIXED_IN_VERSION gate once it is.
 */
export function initFixPlaceablesSidebarTab() {
    if (!foundry.applications.sidebar?.tabs?.PlaceableDirectory) return;

    patchMethod("foundry.applications.sidebar.tabs.PlaceableDirectory.prototype._renderTab", function patchedRenderTab(wrapped, ...args) {
        restoreTabPart(this);
        return wrapped(...args);
    }, "WRAPPER");

    log("Patched PlaceableDirectory._renderTab to recover from failed sub-tab renders");
}

/**
 * Insert an empty tab part after the directory's tab navigation when the directory has none.
 * @param {foundry.applications.sidebar.tabs.PlaceableDirectory} directory
 */
function restoreTabPart(directory) {
    const element = directory.element;
    if (!element || element.querySelector("[data-application-part=tab]")) return;
    const placeholder = document.createElement("div");
    placeholder.className = "placeable-tab flexcol";
    placeholder.dataset.applicationPart = "tab";
    const nav = element.querySelector("[data-application-part=tabs]");
    if (nav) nav.after(placeholder);
    else (element.querySelector(".window-content") ?? element).append(placeholder);
}
