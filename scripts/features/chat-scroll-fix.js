import { MODULE_ID, log, debug } from "../main.js";

/**
 * Reliable Chat Log Auto-Scroll
 *
 * In DnD5e 6.0+, chat messages undergo asynchronous layout shifts after their initial creation:
 *   1. `<recorded-targets>` populates targets asynchronously via IntersectionObserver.
 *   2. Collapsible trays and card descriptions expand with a 250ms CSS Grid transition
 *      (grid-template-rows 250ms ease), outlasting Foundry's initial scroll calculation.
 *   3. `ChatLog5e.#onTrayToggle` terminates pinning prematurely because child element
 *      transitions (.fa-caret-down) bubble transitionend before the tray finishes expanding.
 *   4. Child messages invoke `#refreshOrigin` which re-renders earlier messages with notify: false,
 *      shifting height above the bottom without triggering a re-scroll.
 *   5. Asynchronously loading images (item icons, target avatars) expand after layout.
 *
 * This feature watches the chat log container (.chat-scroll and .chat-log) using a ResizeObserver
 * paired with smart user-scroll detection:
 *   - When the user is at or near the bottom (<= 35px), any layout shift automatically keeps
 *     the chat pinned to the bottom using batched requestAnimationFrame scrolling.
 *   - If the user has intentionally scrolled up to read past history, auto-scrolling is suppressed
 *     to preserve their reading position.
 *   - If the current user sends a message, it always snaps to the bottom so they see their action.
 */

/** @type {Map<object, ChatScrollWatcher>} Active watchers keyed by application instance */
const _activeWatchers = new Map();

/**
 * Encapsulates scroll observation and pinning for a single chat log view (sidebar or popout).
 */
class ChatScrollWatcher {
    /**
     * @param {Application|ApplicationV2} app
     * @param {HTMLElement} rootElement
     */
    constructor(app, rootElement) {
        this.app = app;
        this.root = rootElement;
        this.scroll = rootElement.querySelector(".chat-scroll")
            ?? rootElement.querySelector("#chat-log")?.parentElement
            ?? rootElement;
        this.log = rootElement.querySelector(".chat-log")
            ?? rootElement.querySelector("#chat-log");

        if (!this.scroll || !this.log) {
            debug("Chat Scroll Fix: could not locate .chat-scroll or .chat-log container.");
            return;
        }

        /** @type {number} Distance threshold in pixels to consider user 'at bottom' */
        this.threshold = 35;

        /** @type {boolean} Whether the view was at or near the bottom */
        this.wasAtBottom = true;

        /** @type {boolean} Whether a scroll update is already queued via requestAnimationFrame */
        this.scrollScheduled = false;

        this._setupListeners();
        this._setupObserver();

        // Initial check and pin
        this._checkPosition();
        if (this.wasAtBottom) this.scrollToBottom();
    }

    /**
     * Determine whether the scroll container is currently near the bottom.
     */
    _checkPosition() {
        if (!this.scroll) return;
        const dist = this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight;
        this.wasAtBottom = dist <= this.threshold;
    }

    /**
     * Attach scroll and DOM event listeners.
     * @private
     */
    _setupListeners() {
        this._onScroll = () => this._checkPosition();
        this.scroll.addEventListener("scroll", this._onScroll, { passive: true });
    }

    /**
     * Attach ResizeObserver to detect any height change inside the chat log.
     * @private
     */
    _setupObserver() {
        this.resizeObserver = new ResizeObserver(() => {
            if (this.wasAtBottom) {
                this.scrollToBottom();
            }
        });
        this.resizeObserver.observe(this.log);
    }

    /**
     * Scroll the container to the bottom.
     * Uses requestAnimationFrame to batch multiple layout shifts (e.g. during 250ms CSS transitions)
     * into a single scroll assignment per frame.
     *
     * @param {boolean} [force=false] Force scroll to bottom regardless of previous position.
     */
    scrollToBottom(force = false) {
        if (!this.scroll || !this.scroll.isConnected) return;
        if (force) this.wasAtBottom = true;
        if (!this.wasAtBottom) return;

        if (this.scrollScheduled) return;
        this.scrollScheduled = true;

        requestAnimationFrame(() => {
            this.scrollScheduled = false;
            if (!this.scroll || !this.scroll.isConnected) return;
            if (this.wasAtBottom || force) {
                this.scroll.scrollTop = this.scroll.scrollHeight;
            }
        });
    }

    /**
     * Clean up all observers and event listeners.
     */
    destroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.scroll && this._onScroll) {
            this.scroll.removeEventListener("scroll", this._onScroll);
        }
    }
}

/**
 * Watch or update a chat log application instance.
 * @param {Application|ApplicationV2} app
 * @param {HTMLElement} element
 */
function _watchChatLog(app, element) {
    if (!element) return;
    const existing = _activeWatchers.get(app);
    if (existing) existing.destroy();

    const watcher = new ChatScrollWatcher(app, element);
    _activeWatchers.set(app, watcher);
}

/**
 * Initialize Reliable Chat Log Auto-Scroll.
 */
export function initChatScrollFix() {
    if (!game.settings.get(MODULE_ID, "enableChatScrollFix")) return;

    Hooks.on("renderChatLog", (app, element) => {
        if (!game.settings.get(MODULE_ID, "enableChatScrollFix")) return;
        const el = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
        _watchChatLog(app, el);
    });

    Hooks.on("renderChatPopout", (app, element) => {
        if (!game.settings.get(MODULE_ID, "enableChatScrollFix")) return;
        const el = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
        _watchChatLog(app, el);
    });

    Hooks.on("closeChatPopout", (app) => {
        _activeWatchers.get(app)?.destroy();
        _activeWatchers.delete(app);
    });

    // When the current user sends a message, snap to bottom
    Hooks.on("createChatMessage", (message) => {
        if (!game.settings.get(MODULE_ID, "enableChatScrollFix")) return;
        if (message.author?.id === game.user?.id) {
            for (const watcher of _activeWatchers.values()) {
                watcher.scrollToBottom(true);
            }
        }
    });

    // When switching to the chat sidebar tab, ensure it is pinned to bottom if it was at bottom
    Hooks.on("changeSidebarTab", (tab) => {
        if (!game.settings.get(MODULE_ID, "enableChatScrollFix")) return;
        const tabName = tab?.tabName;
        if (tabName === "chat") {
            const watcher = _activeWatchers.get(ui.chat);
            if (watcher?.wasAtBottom) {
                watcher.scrollToBottom(true);
            }
        }
    });

    // If chat log is already rendered when init/setup runs, attach immediately
    if (ui.chat?.element) {
        _watchChatLog(ui.chat, ui.chat.element);
    }

    log("Reliable Chat Log Auto-Scroll enabled");
}

/**
 * Dynamically enable the feature (e.g. from settings onChange).
 */
export function enableChatScrollFix() {
    if (ui.chat?.element) {
        _watchChatLog(ui.chat, ui.chat.element);
    }
    for (const popout of foundry.applications?.instances?.values?.() ?? []) {
        if (popout.element?.classList?.contains("chat-popout") || popout.constructor?.name === "ChatPopout") {
            _watchChatLog(popout, popout.element);
        }
    }
    log("Reliable Chat Log Auto-Scroll enabled dynamically");
}

/**
 * Dynamically disable the feature.
 */
export function disableChatScrollFix() {
    for (const watcher of _activeWatchers.values()) {
        watcher.destroy();
    }
    _activeWatchers.clear();
    log("Reliable Chat Log Auto-Scroll disabled");
}
