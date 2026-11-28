/**
 * Socket router: one listener on the module's socket channel, handlers registered by the features themselves.
 *
 * Each feature registers the message names it handles next to its handler (`registerSocketHandlers`), so adding a
 * new message can't be forgotten in a central list (the delegated Area Spell damage roll was dropped that way in
 * 14.92.0 – 14.118.0). A message's name is its `action`, or its `type` for the older payloads.
 *
 * The server passes the real sender's id as the listener's second argument; handlers authorize with it, never with
 * ids in the payload.
 *
 * @introduced v14.120.0
 */
import { MODULE_ID, debug } from "../context.js";

/** @type {Map<string, {handler: (data: object, senderId: string) => unknown, owner: string}>} */
const _handlers = new Map();

let _listening = false;

/**
 * Register the handler for one or more socket message names. Safe to call at a feature file's top level.
 * @param {string} owner  Name of the feature, for log messages.
 * @param {string[]} names  Message names (`action` or `type` of the payload).
 * @param {(data: object, senderId: string) => unknown} handler  May return a promise.
 */
export function registerSocketHandlers(owner, names, handler) {
    for (const name of names) {
        const existing = _handlers.get(name);
        if (existing) console.warn(`${MODULE_ID} | Socket message "${name}" of ${owner} replaces the handler of ${existing.owner}`);
        _handlers.set(name, { handler, owner });
    }
}

/**
 * Start listening on the module's socket channel. Called once from main.js in the "ready" hook.
 */
export function initSocketRouter() {
    if (_listening) return;
    _listening = true;
    game.socket.on(`module.${MODULE_ID}`, _dispatch);
    debug(`Socket router | Listening for ${_handlers.size} message types`);
}

/**
 * Hand an incoming message to its feature's handler.
 * @param {object} data
 * @param {string} senderId
 */
function _dispatch(data, senderId) {
    const name = data?.action ?? data?.type;
    const entry = (typeof name === "string") ? _handlers.get(name) : null;
    if (!entry) {
        debug(`Socket router | No handler for message "${name}"`, data);
        return;
    }
    const onError = err => console.error(`${MODULE_ID} | ${entry.owner}: socket message "${name}" failed`, err);
    try {
        const result = entry.handler(data, senderId);
        if (typeof result?.catch === "function") result.catch(onError);
    } catch (err) {
        onError(err);
    }
}
