/**
 * Utility for registering method patches cooperatively via libWrapper when available,
 * with graceful fallback to manual prototype wrapping when libWrapper is not installed.
 *
 * Supports WRAPPER, MIXED, and OVERRIDE modes, as well as chaining multiple handlers
 * registered by different features of this module onto the same target without libWrapper errors.
 *
 * @introduced v14.47.0
 */
import { MODULE_ID, debug } from "../main.js";

/** Map of target string -> Array<Function> of wrapper callbacks registered by our module. */
const _wrapperChains = new Map();

/** Map of target string -> effective registration type ("WRAPPER" | "MIXED" | "OVERRIDE"). */
const _registeredTypes = new Map();

/** Map of target string -> original unpatched descriptor/function for manual unpatching. */
const _originalMethods = new Map();

/**
 * Execute an array of wrappers in sequence, with each wrapper receiving a `wrapped` continuation
 * that advances to the next wrapper in line, and finally calls the original method.
 *
 * Uses immutable index-based recursion for full re-entrancy safety.
 *
 * @param {Function[]} wrappers
 * @param {Function} origFn
 * @param {object} context
 * @param {any[]} args
 * @returns {any}
 */
function _executeChain(wrappers, origFn, context, args) {
    function dispatch(i, currentArgs) {
        if (i < wrappers.length) {
            const currentWrapper = wrappers[i];
            return currentWrapper.call(context, (...nextArgs) => dispatch(i + 1, nextArgs.length ? nextArgs : currentArgs), ...currentArgs);
        }
        return origFn.apply(context, currentArgs);
    }
    return dispatch(0, args);
}

/**
 * Resolves a dot/bracket notation target path (e.g. "Combat.prototype.nextTurn")
 * on globalThis into { obj, prop, isGetter }.
 *
 * @param {string} target
 * @returns {{ obj: object, prop: string, isGetter: boolean } | null}
 */
export function resolveTarget(target) {
    if (!target || typeof target !== "string") return null;
    const isGetter = target.endsWith("#get");
    const cleanTarget = isGetter ? target.slice(0, -4) : target;

    const parts = cleanTarget.match(/[^.\[\]'"]+|"([^"]*)"|'([^']*)'/g);
    if (!parts || parts.length < 2) return null;

    let obj = globalThis;
    for (let i = 0; i < parts.length - 1; i++) {
        const cleanKey = parts[i].replace(/^['"]|['"]$/g, "");
        obj = obj?.[cleanKey];
        if (!obj) return null;
    }

    const prop = parts[parts.length - 1].replace(/^['"]|['"]$/g, "");
    return { obj, prop, isGetter };
}

/**
 * Check whether libWrapper is active in the current Foundry environment.
 * @returns {boolean}
 */
export function isLibWrapperActive() {
    return Boolean(globalThis.libWrapper?.register);
}

/**
 * Register a method patch using libWrapper if available, or manual prototype wrapping if not.
 *
 * For WRAPPER and MIXED types, the passed `fn` should have the signature:
 *   `async function (wrapped, ...args)` or `function (wrapped, ...args)`
 * Calling `wrapped(...args)` continues the execution chain.
 *
 * For OVERRIDE types, `fn` has the signature:
 *   `async function (...args)` or `function (...args)`
 *
 * If multiple handlers in this module register against the same target, they are automatically
 * chained through an internal pipeline so libWrapper is only registered once per target.
 *
 * @param {string} target - Target method path (e.g. "Combat.prototype.nextTurn" or "CONFIG.Actor.documentClass.prototype.rollHitDie")
 * @param {Function} fn - The wrapper or override function
 * @param {"WRAPPER"|"MIXED"|"OVERRIDE"} [type="MIXED"] - libWrapper type (defaults to MIXED for safe branching)
 * @param {object} [options={}] - Additional libWrapper options (e.g. perf_mode)
 * @returns {boolean} True if successfully patched, false otherwise
 */
export function patchMethod(target, fn, type = "MIXED", options = {}) {
    // If target is already registered by our module, append to its chain
    let chain = _wrapperChains.get(target);
    if (chain) {
        if (!chain.includes(fn)) {
            chain.push(fn);
            debug(`patchMethod | Appended additional handler to existing chain for "${target}".`);
        }
        // If a new handler needs MIXED but the target was registered as WRAPPER, upgrade libWrapper registration
        if (type === "MIXED" && _registeredTypes.get(target) === "WRAPPER" && isLibWrapperActive()) {
            try {
                const libWrapperTarget = target.endsWith("#get") ? target.slice(0, -4) : target;
                globalThis.libWrapper.unregister(MODULE_ID, libWrapperTarget);
                const dispatcher = function (...dispatcherArgs) {
                    const [wrapped, ...args] = dispatcherArgs;
                    return _executeChain(chain, wrapped, this, args);
                };
                globalThis.libWrapper.register(MODULE_ID, libWrapperTarget, dispatcher, "MIXED", options);
                _registeredTypes.set(target, "MIXED");
                debug(`patchMethod | Upgraded "${target}" registration to MIXED via libWrapper.`);
            } catch (err) {
                console.warn(`${MODULE_ID} | libWrapper upgrade to MIXED failed for "${target}":`, err);
            }
        }
        return true;
    }

    chain = [fn];
    _wrapperChains.set(target, chain);
    _registeredTypes.set(target, type);

    if (isLibWrapperActive()) {
        try {
            const dispatcher = function (...dispatcherArgs) {
                if (type === "OVERRIDE") {
                    const latestHandler = chain[chain.length - 1];
                    return latestHandler.apply(this, dispatcherArgs);
                }
                const [wrapped, ...args] = dispatcherArgs;
                return _executeChain(chain, wrapped, this, args);
            };

            const libWrapperTarget = target.endsWith("#get") ? target.slice(0, -4) : target;
            globalThis.libWrapper.register(MODULE_ID, libWrapperTarget, dispatcher, type, options);
            debug(`patchMethod | Registered "${target}" via libWrapper (${type}).`);
            return true;
        } catch (err) {
            console.warn(`${MODULE_ID} | libWrapper.register failed for "${target}", falling back to manual prototype patch:`, err);
        }
    }

    // Fallback: manual prototype patching
    const resolved = resolveTarget(target);
    if (!resolved) {
        debug(`patchMethod | Target "${target}" could not be resolved for manual patching.`);
        return false;
    }

    const { obj, prop, isGetter } = resolved;

    if (isGetter) {
        let descriptor = null;
        let proto = obj;
        while (!descriptor && proto) {
            descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (!descriptor) proto = Object.getPrototypeOf(proto);
        }
        if (!descriptor?.get) {
            debug(`patchMethod | Getter descriptor for "${target}" not found.`);
            return false;
        }

        const originalGet = descriptor.get;
        const wrappedGet = function () {
            return _executeChain(chain, (...innerArgs) => originalGet.apply(this, innerArgs), this, []);
        };
        wrappedGet._niksWrapped = true;
        wrappedGet._niksOriginal = originalGet;
        _originalMethods.set(target, { obj, prop, original: descriptor, isGetter: true, isOwn: obj === proto });

        Object.defineProperty(obj, prop, {
            get: wrappedGet,
            set: descriptor.set,
            configurable: true,
            enumerable: descriptor.enumerable
        });
        debug(`patchMethod | Patched getter "${target}" manually.`);
        return true;
    }

    if (typeof obj[prop] !== "function") {
        debug(`patchMethod | Target "${target}" is not a function for manual patching.`);
        return false;
    }

    const original = obj[prop];
    let wrappedFn;
    if (type === "OVERRIDE") {
        wrappedFn = function patchedMethod(...args) {
            const latestHandler = chain[chain.length - 1];
            return latestHandler.apply(this, args);
        };
    } else {
        wrappedFn = function patchedMethod(...args) {
            return _executeChain(chain, (...innerArgs) => original.apply(this, innerArgs), this, args);
        };
    }

    wrappedFn._niksWrapped = true;
    wrappedFn._niksOriginal = original;
    _originalMethods.set(target, { obj, prop, original, isGetter: false, isOwn: Object.prototype.hasOwnProperty.call(obj, prop) });

    obj[prop] = wrappedFn;
    debug(`patchMethod | Patched "${target}" manually (${type}).`);
    return true;
}

/**
 * Unregister a previously patched method.
 * @param {string} target
 * @param {Function} [fn] - Specific handler to remove from chain. If omitted, unregisters entire target.
 * @returns {boolean}
 */
export function unpatchMethod(target, fn = null) {
    const chain = _wrapperChains.get(target);
    if (!chain) return false;

    if (fn) {
        const index = chain.indexOf(fn);
        if (index !== -1) chain.splice(index, 1);
        if (chain.length > 0) return true;
    }

    _wrapperChains.delete(target);
    _registeredTypes.delete(target);

    if (isLibWrapperActive()) {
        try {
            const libWrapperTarget = target.endsWith("#get") ? target.slice(0, -4) : target;
            globalThis.libWrapper.unregister(MODULE_ID, libWrapperTarget);
            debug(`patchMethod | Unregistered "${target}" via libWrapper.`);
            return true;
        } catch (err) {
            console.warn(`${MODULE_ID} | libWrapper.unregister failed for "${target}":`, err);
        }
    }

    const saved = _originalMethods.get(target);
    if (saved) {
        if (saved.isGetter) {
            if (saved.isOwn) {
                Object.defineProperty(saved.obj, saved.prop, saved.original);
            } else {
                delete saved.obj[saved.prop];
            }
        } else if (saved.obj?.[saved.prop]?._niksWrapped) {
            if (saved.isOwn) {
                saved.obj[saved.prop] = saved.original;
            } else {
                delete saved.obj[saved.prop];
            }
        }
        _originalMethods.delete(target);
        debug(`patchMethod | Restored original method for "${target}".`);
        return true;
    }

    return false;
}
