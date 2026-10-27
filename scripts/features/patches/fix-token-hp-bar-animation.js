/**
 * Feature: Token HP Bar Animation Patch
 * Description: Restores Foundry V14's animated token resource bars for D&D 5e HP bars.
 *
 * @introduced v14.52.0
 */
import { log } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Fix: HP Bars Jump Instead of Animating
 * ---------------------------------------------------------------------------
 * Foundry V14 animates token bars: `TokenDocument#_onRelatedUpdate` calls
 * `Token#animate({bar1, bar2})`, which tweens `document.bar1/bar2.value/max`
 * from the previous to the new values and sets `refreshBars` every frame, so
 * `Token#_drawBar(index, bar, data)` receives the in-between values in `data`.
 *
 * D&D 5e's `Token5e#_drawHPBar` ignores `data` and reads value, temp and
 * temp max straight from `actor.system.attributes.hp`, so every frame draws the
 * final state and the HP bar jumps. Other bars use core `_drawBar` and animate.
 *
 * The animated `data.value` is HP + temp HP and `data.max` the effective
 * maximum (see `TokenDocument5e#getBarAttribute`). This patch derives the
 * animation progress from them and interpolates every HP field between the last
 * drawn state and the actor's current state, then draws with D&D 5e's layout.
 * When the bar is at rest, D&D 5e's own `_drawHPBar` runs unchanged.
 */

/** @type {WeakMap<Token, {from: object, target: object, displayed: object}>} */
const _barStates = new WeakMap();

const HP_FIELDS = ["value", "max", "effectiveMax", "temp", "tempmax"];

/**
 * Read the HP fields the D&D 5e HP bar is drawn from.
 * @param {Actor} actor
 * @returns {object|null}
 */
function _readHP(actor) {
    const hp = actor?.system?.attributes?.hp;
    if (!hp) return null;
    return {
        value: Number(hp.value) || 0,
        max: Number(hp.max) || 0,
        effectiveMax: Math.max(0, Number(hp.effectiveMax) || 0),
        temp: Number(hp.temp || 0),
        tempmax: Number(hp.tempmax || 0)
    };
}

/**
 * Determine the animation progress (0-1) from the tweened bar data.
 * Core interpolates value and max with the same factor, so either one works.
 * @param {object} from
 * @param {object} target
 * @param {object} data   The animated bar data passed to `_drawBar`
 * @returns {number}
 */
function _getProgress(from, target, data) {
    const fromTotal = from.value + from.temp;
    const targetTotal = target.value + target.temp;
    let t = 1;
    if (fromTotal !== targetTotal) t = (Number(data.value) - fromTotal) / (targetTotal - fromTotal);
    else if (from.effectiveMax !== target.effectiveMax) {
        t = (Number(data.max) - from.effectiveMax) / (target.effectiveMax - from.effectiveMax);
    }
    return Number.isFinite(t) ? Math.clamp(t, 0, 1) : 1;
}

/**
 * Draw the HP bar like `Token5e#_drawHPBar`, but from the provided HP values.
 * @param {Token} token
 * @param {number} number      The Bar number
 * @param {PIXI.Graphics} bar  The Bar container
 * @param {object} hp          Interpolated HP values
 */
function _drawInterpolatedHPBar(token, number, bar, hp) {
    const { value, max, effectiveMax, temp, tempmax } = hp;
    const displayMax = max + (tempmax > 0 ? tempmax : 0);

    // Allocate percentages of the total
    const tempPct = Math.clamp(temp, 0, displayMax) / displayMax;
    const colorPct = Math.clamp(value, 0, effectiveMax) / displayMax;
    const hpColor = dnd5e.documents.Actor5e.getHPColor(value, effectiveMax);

    const blk = 0x000000;
    const c = CONFIG.DND5E.tokenHPColors;

    const s = canvas.dimensions.uiScale;
    const bw = token.w;
    const bh = 8 * (token.document.height >= 2 ? 1.5 : 1) * s;
    const bs1 = s + s;

    bar.clear();
    bar.beginFill(blk, 0.5).lineStyle(s, blk, 1.0).drawRoundedRect(0, 0, bw, bh, 3 * s);

    // Temporary maximum HP / maximum HP penalty
    if (tempmax > 0) {
        const pct = max / effectiveMax;
        bar.beginFill(c.tempmax, 1.0).lineStyle(1, blk, 1.0).drawRoundedRect(pct * bw, 0, (1 - pct) * bw, bh, 2 * s);
    } else if (tempmax < 0) {
        const pct = (max + tempmax) / max;
        bar.beginFill(c.negmax, 1.0).lineStyle(1, blk, 1.0).drawRoundedRect(pct * bw, 0, (1 - pct) * bw, bh, 2 * s);
    }

    // Health bar
    bar.beginFill(hpColor, 1.0).lineStyle(s, blk, 1.0).drawRoundedRect(0, 0, colorPct * bw, bh, 2 * s);

    // Temporary hit points
    if (temp > 0) {
        bar.beginFill(c.temp, 1.0).lineStyle(0).drawRoundedRect(bs1, bs1, (tempPct * bw) - (2 * bs1), bh - (2 * bs1), s);
    }

    bar.position.set(0, (number === 0) ? (token.h - bh) : 0);
}

function patchedDrawHPBar(wrapped, number, bar, data, ...args) {
    const target = _readHP(this.document?.actor);
    if (!target) return wrapped(number, bar, data, ...args);

    let state = _barStates.get(this);
    if (!state) {
        state = { from: target, target, displayed: target };
        _barStates.set(this, state);
    } else if (HP_FIELDS.some(k => state.target[k] !== target[k])) {
        // HP changed: animate from whatever is currently on screen
        state.from = state.displayed;
        state.target = target;
    }

    const t = _getProgress(state.from, target, data);
    if (t >= 1) {
        state.from = state.displayed = target;
        return wrapped(number, bar, data, ...args);
    }

    const displayed = {};
    for (const k of HP_FIELDS) displayed[k] = state.from[k] + ((target[k] - state.from[k]) * t);
    state.displayed = displayed;
    _drawInterpolatedHPBar(this, number, bar, displayed);
}

export function initFixTokenHPBarAnimation() {
    const tokenClass = CONFIG.Token.objectClass;
    if (typeof tokenClass?.prototype?._drawHPBar !== "function") {
        log("Skipped token HP bar animation patch (Token._drawHPBar not found)");
        return;
    }

    patchMethod("CONFIG.Token.objectClass.prototype._drawHPBar", patchedDrawHPBar, "MIXED");
    log("Patched Token._drawHPBar to animate HP bar changes");
}
