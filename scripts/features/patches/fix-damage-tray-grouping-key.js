/**
 * Feature: Damage Tray Grouping Key Patch
 * Description: Fixes an upstream TypeError in DnD5e 6.x DamageApplicationElement when grouping keys are computed for targets lacking TokenDocument5e grouping methods.
 *
 * @introduced v14.48.0
 */
import { log } from "../../main.js";

/**
 * Fix: Damage Tray Target Grouping Key — Targets Lacking TokenDocument5e
 * ---------------------------------------------------------------------------
 * In D&D 5e 6.x, `DamageApplicationElement.#getGroupingKey` (damage-application.mjs:232)
 * invokes `token.getGroupingKey()` without optional chaining (`?.`).
 * When target list entries are populated from target descriptors that resolve
 * to an Actor document (e.g. targeted by actor UUID, across scenes, or unplaced tokens)
 * or to a placeable Token / foreign TokenDocument subclass lacking `getGroupingKey`,
 * calling `token.getGroupingKey()` throws:
 *   "TypeError: token.getGroupingKey is not a function"
 *
 * In `<recorded-targets>` (`recorded-targets.mjs:296`), D&D 5e safely writes:
 *   `const key = token.getGroupingKey?.() ?? token.uuid;`
 * When `#getGroupingKey` receives `null` from `token.getGroupingKey()`, line 233
 * immediately executes `if ( !key ) return token.uuid;`, falling back to the UUID.
 *
 * This silent system patch ensures that `getGroupingKey` is defined across
 * TokenDocument, Token, and Actor prototypes so that calls to `token.getGroupingKey()`
 * always return cleanly without throwing unhandled exceptions.
 */
export function initFixDamageTrayGroupingKey() {
    // 1. Actor document class fallback
    const actorClass = CONFIG.Actor?.documentClass ?? globalThis.dnd5e?.documents?.Actor5e;
    if (actorClass && typeof actorClass.prototype.getGroupingKey !== "function") {
        Object.defineProperty(actorClass.prototype, "getGroupingKey", {
            value: function getGroupingKey(prefix) {
                return null;
            },
            writable: true,
            configurable: true
        });
    }

    // 2. TokenDocument document class fallback (if replaced or overridden by another module)
    const tokenDocClass = CONFIG.Token?.documentClass ?? globalThis.dnd5e?.documents?.TokenDocument5e;
    if (tokenDocClass && typeof tokenDocClass.prototype.getGroupingKey !== "function") {
        Object.defineProperty(tokenDocClass.prototype, "getGroupingKey", {
            value: function getGroupingKey(prefix) {
                if (!this.actor || this.actor.isToken) return null;
                const parts = [prefix, this.actor.id, this.disposition].filter(Boolean);
                return parts.join(".");
            },
            writable: true,
            configurable: true
        });
    }

    // 3. Canvas Token placeable fallback
    const tokenObjectClass = CONFIG.Token?.objectClass;
    if (tokenObjectClass && typeof tokenObjectClass.prototype.getGroupingKey !== "function") {
        Object.defineProperty(tokenObjectClass.prototype, "getGroupingKey", {
            value: function getGroupingKey(prefix) {
                return this.document?.getGroupingKey?.(prefix) ?? null;
            },
            writable: true,
            configurable: true
        });
    }

    log("Fix: Damage Tray Grouping Key | Initialized upstream getGroupingKey fallback patch.");
}
