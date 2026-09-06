import { MODULE_ID, log, debug } from "../main.js";

/**
 * Sheet Pop-out Button
 *
 * Adds a dedicated pop-out button (↗) directly in the header of Actor and Item
 * document sheets, providing one-click access to V14's native window detach
 * functionality without having to open the three-dot context menu first.
 *
 * Implementation notes:
 *   - Uses `renderApplicationV2` to inject a DOM button after each render,
 *     rather than the `getHeaderControls` hook. In Foundry V14, the controls
 *     hook receives a non-plain-array argument (an async generator/iterator)
 *     which breaks every module that tries to call .push()/.unshift() on it.
 *     DOM injection sidesteps this entirely and is simpler and more reliable.
 *   - The button is styled with the native `header-control` class so it blends
 *     in with Foundry's own header buttons.
 *   - Guarded: only injected into Actor / Item document sheets, not every
 *     ApplicationV2. Skipped automatically when already detached.
 */

let _hookId = null;

export function initSheetPopoutButton() {
    if (!game.settings.get(MODULE_ID, "enableSheetPopoutButton")) return;

    _hookId = Hooks.on("renderApplicationV2", (app, _element) => {
        _injectPopoutButton(app);
    });

    // Sweep any sheets that are already in the DOM when this feature initialises.
    // This is critical for the popup-window case: Foundry moves the existing
    // DOM element into the popup without firing a fresh renderApplicationV2,
    // so the hook above never fires there. By sweeping on setup we catch those
    // sheets and re-inject with the correct icon for the popup's window context.
    for (const app of foundry.applications.instances.values()) {
        if (app.rendered) _injectPopoutButton(app);
    }

    log("Sheet Pop-out Button enabled");
}

export function disableSheetPopoutButton() {
    if (_hookId !== null) {
        Hooks.off("renderApplicationV2", _hookId);
        _hookId = null;
    }
    // Clean up any already-injected buttons
    document.querySelectorAll(".nd5t-popout-btn").forEach(btn => btn.remove());
}

/**
 * Whether the given app is an Actor or Item document sheet.
 * @param {ApplicationV2} app
 * @returns {boolean}
 */
function _isDocumentSheet(app) {
    const docName = app.document?.documentName;
    return docName === "Actor" || docName === "Item";
}

/**
 * Inject the pop-out / attach button into the rendered window header.
 * Removes any existing button first so the state is always fresh.
 *
 * Shows a pop-out button (↗) when the sheet is in the main workspace, and
 * flips to an attach-back button (↙) when the sheet is already detached in
 * its own browser window. Clicking either performs the inverse action.
 *
 * @param {ApplicationV2} app
 */
function _injectPopoutButton(app) {
    // Only Actor / Item sheets
    if (!_isDocumentSheet(app)) return;

    // Both APIs must be present — they are V14-only, but guard defensively.
    if (typeof app.detachWindow !== "function" || typeof app.attachWindow !== "function") return;

    const element = app.element;
    if (!element) return;

    const header = element.querySelector("header.window-header");
    if (!header) return;

    // Always remove any stale button before re-injecting with the current state.
    //
    // We cannot use a simple "skip if already present" guard here because Foundry
    // moves the existing DOM element (including our button) into the popup window
    // when detaching, rather than destroying and re-creating it. If we skipped
    // re-injection, the old button (created while the sheet was in the main
    // window) would survive in the popup with the wrong state captured in its
    // closure.
    element.querySelector(".nd5t-popout-btn")?.remove();

    // Detect whether this code is running inside a detached popup window.
    //
    // Foundry's detachWindow() opens a real browser popup via window.open().
    // That popup runs a full, independent Foundry instance (including this
    // module). The standard browser property window.opener is set to the
    // opening window in any popup opened via window.open(), and is null in
    // the main browser window. This gives us a reliable, Foundry-agnostic
    // signal regardless of how _canDetach() / _canAttach() behave internally.
    const isDetached = window.opener !== null;

    const tooltipKey = isDetached ? "ND5T.AttachButton.Tooltip" : "ND5T.PopoutButton.Tooltip";
    const icon       = isDetached ? "fa-down-left-and-up-right-to-center" : "fa-arrow-up-right-from-square";
    const tooltip    = game.i18n.localize(tooltipKey);

    const btn = element.ownerDocument.createElement("button");
    btn.type = "button";
    btn.className = "header-control nd5t-popout-btn";
    btn.setAttribute("data-tooltip", tooltip);
    btn.setAttribute("aria-label", tooltip);
    btn.innerHTML = `<i class="fa-solid ${icon} fa-fw"></i>`;
    btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        // Determine the window that is actually displaying this button by reading
        // from the button's own document. We cannot use `window` here because
        // this event listener is created in the main Foundry window's JS realm
        // (where window.opener is always null), even when the button is visually
        // inside the detached popup. btn.ownerDocument.defaultView gives us the
        // true browser Window the button currently lives in.
        const btnWindow = btn.ownerDocument?.defaultView;
        const clickIsDetached = btnWindow != null && btnWindow.opener !== null;
        if (clickIsDetached) {
            debug("Sheet Pop-out Button: attaching window", app.id);
            app.attachWindow();
        } else {
            debug("Sheet Pop-out Button: detaching window", app.id);
            app.detachWindow();
        }
    });

    // Place the button immediately before the native close button so it sits
    // at the right end of the header, adjacent to the other window controls.
    const closeBtn = header.querySelector('[data-action="close"]');
    if (closeBtn) {
        header.insertBefore(btn, closeBtn);
    } else {
        header.append(btn);
    }

    debug(`Sheet Pop-out Button: injected (${isDetached ? "attach" : "detach"} mode) into`, app.id);
}

