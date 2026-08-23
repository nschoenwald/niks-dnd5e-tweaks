import { MODULE_ID, log, debug } from "../main.js";

/**
 * NPC Hit Point Scaler
 *
 * Injects easy plus (+) and minus (-) buttons into the NPC Hit Points configuration
 * dialog (HitPointsConfig), allowing GMs to scale the number of hit dice up and down.
 *
 * Automatically recalculates:
 *   - Health formula: XdY + (X * CON mod)
 *   - Average Max HP: Math.floor(X * (Y + 1) / 2 + X * CON mod)
 *
 * Hit die denomination (dY) is determined by creature size per 5e rules:
 *   Tiny (d4), Small (d6), Medium (d8), Large (d10), Huge (d12), Gargantuan (d20),
 *   or preserved from the existing formula if a custom die is used.
 *
 * Supports Shift-clicking to scale by 5 hit dice at a time.
 */

let _hookIdAppV2 = null;
let _hookIdHpConfig = null;

export function initNpcHpScaler() {
    if (!game.settings.get(MODULE_ID, "enableNpcHpScaling")) return;

    if (_hookIdHpConfig === null) {
        _hookIdHpConfig = Hooks.on("renderHitPointsConfig", (app, element) => {
            _injectScalingButtons(app, element);
        });
    }

    if (_hookIdAppV2 === null) {
        _hookIdAppV2 = Hooks.on("renderApplicationV2", (app, element) => {
            if (_isHitPointsConfig(app)) {
                _injectScalingButtons(app, element);
            }
        });
    }

    // Sweep any already-rendered HitPointsConfig instances
    if (foundry.applications?.instances) {
        for (const app of foundry.applications.instances.values()) {
            if (app.rendered && _isHitPointsConfig(app)) {
                _injectScalingButtons(app, app.element);
            }
        }
    }

    log("NPC Hit Point Scaler enabled");
}

export function disableNpcHpScaler() {
    if (_hookIdHpConfig !== null) {
        Hooks.off("renderHitPointsConfig", _hookIdHpConfig);
        _hookIdHpConfig = null;
    }
    if (_hookIdAppV2 !== null) {
        Hooks.off("renderApplicationV2", _hookIdAppV2);
        _hookIdAppV2 = null;
    }
    document.querySelectorAll(".nd5t-hp-scaler-btn").forEach(el => el.remove());
}

/**
 * Check if the application instance is a HitPointsConfig dialog.
 * @param {ApplicationV2} app
 * @returns {boolean}
 */
function _isHitPointsConfig(app) {
    if (!app) return false;
    return app.constructor?.name === "HitPointsConfig"
        || app.options?.classes?.includes("hit-points")
        || (globalThis.dnd5e?.applications?.actor?.HitPointsConfig && app instanceof globalThis.dnd5e.applications.actor.HitPointsConfig);
}

/**
 * Injects plus and minus buttons into the HitPointsConfig form fields.
 * @param {ApplicationV2} app
 * @param {HTMLElement|jQuery} element
 */
function _injectScalingButtons(app, element) {
    if (!game.settings.get(MODULE_ID, "enableNpcHpScaling")) return;

    const html = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
    if (!html) return;

    // Prevent duplicate injection
    if (html.querySelector(".nd5t-hp-scaler-btn")) return;

    const actor = app.document;
    if (!actor) return;

    // Find the roll button or formula input container in the form
    const rollBtn = html.querySelector('button[data-action="roll"]');
    const formulaInput = html.querySelector('[name="system.attributes.hp.formula"]')
        || html.querySelector('input[name="system.attributes.hp.formula"]')
        || html.querySelector('dnd5e-formula-field');

    const container = rollBtn?.parentElement || formulaInput?.parentElement;
    if (!container) return;

    const { diceCount } = _getHitDiceInfo(actor, html);

    const scaleDownTooltip = game.i18n.localize("ND5T.NpcHpScaler.ScaleDown");
    const scaleUpTooltip = game.i18n.localize("ND5T.NpcHpScaler.ScaleUp");

    // Minus (Scale Down) button
    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "unbutton nd5t-hp-scaler-btn nd5t-hp-scale-down";
    minusBtn.dataset.action = "nd5t-scale-hp-down";
    minusBtn.dataset.tooltip = scaleDownTooltip;
    minusBtn.setAttribute("aria-label", scaleDownTooltip);
    minusBtn.innerHTML = '<i class="fa-solid fa-minus" inert></i>';
    if (diceCount <= 1) {
        minusBtn.disabled = true;
    }

    minusBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await _scaleNpcHitPoints(app, html, -1, event.shiftKey ? 5 : 1);
    });

    // Plus (Scale Up) button
    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "unbutton nd5t-hp-scaler-btn nd5t-hp-scale-up";
    plusBtn.dataset.action = "nd5t-scale-hp-up";
    plusBtn.dataset.tooltip = scaleUpTooltip;
    plusBtn.setAttribute("aria-label", scaleUpTooltip);
    plusBtn.innerHTML = '<i class="fa-solid fa-plus" inert></i>';

    plusBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await _scaleNpcHitPoints(app, html, 1, event.shiftKey ? 5 : 1);
    });

    // Insert before rollBtn if found, otherwise append to container
    if (rollBtn) {
        container.insertBefore(minusBtn, rollBtn);
        container.insertBefore(plusBtn, rollBtn);
    } else {
        container.appendChild(minusBtn);
        container.appendChild(plusBtn);
    }
}

/**
 * Extract hit dice count, denomination, and Constitution modifier for an actor.
 * @param {Actor5e} actor
 * @param {HTMLElement} [html]
 * @returns {{ diceCount: number, dieSize: number, conMod: number, formulaValue: string }}
 */
function _getHitDiceInfo(actor, html) {
    const formulaInput = html?.querySelector?.('[name="system.attributes.hp.formula"]')
        || html?.querySelector?.('input[name="system.attributes.hp.formula"]')
        || html?.querySelector?.('dnd5e-formula-field input')
        || html?.querySelector?.('dnd5e-formula-field');

    const formulaValue = (formulaInput?.value ?? actor?.system?.attributes?.hp?.formula ?? "").trim();
    const size = actor?.system?.traits?.size || "med";
    const sizeHitDie = CONFIG.DND5E?.actorSizes?.[size]?.hitDie ?? 8;
    const conMod = actor?.system?.abilities?.con?.mod ?? 0;

    let diceCount = 1;
    let dieSize = sizeHitDie;

    const match = formulaValue.match(/^(\d+)\s*d\s*(\d+)/i);
    if (match) {
        diceCount = parseInt(match[1], 10) || 1;
        dieSize = parseInt(match[2], 10) || sizeHitDie;
    } else {
        const currentMax = Number(actor?.system?.attributes?.hp?.max) || 0;
        const avgPerDie = (dieSize + 1) / 2 + conMod;
        if (currentMax > 0 && avgPerDie > 0) {
            diceCount = Math.max(1, Math.round(currentMax / avgPerDie));
        }
    }

    return { diceCount, dieSize, conMod, formulaValue };
}

/**
 * Scale the NPC's hit dice and recalculate formula and max HP.
 * @param {ApplicationV2} app
 * @param {HTMLElement} html
 * @param {number} direction - 1 for scale up, -1 for scale down
 * @param {number} step - number of hit dice to add/subtract
 */
async function _scaleNpcHitPoints(app, html, direction, step = 1) {
    const actor = app.document;
    if (!actor) return;

    const { diceCount, dieSize, conMod } = _getHitDiceInfo(actor, html);
    const delta = direction * step;
    const newDiceCount = Math.max(1, diceCount + delta);

    if (newDiceCount === diceCount) return;

    // Calculate Constitution modifier contribution
    const conBonus = newDiceCount * conMod;
    let newFormula = `${newDiceCount}d${dieSize}`;
    if (conBonus > 0) {
        newFormula += ` + ${conBonus}`;
    } else if (conBonus < 0) {
        newFormula += ` - ${Math.abs(conBonus)}`;
    }

    // Average roll calculation: Math.floor(X * (die + 1) / 2 + (X * conMod))
    const avgRoll = newDiceCount * ((dieSize + 1) / 2);
    const newMax = Math.max(1, Math.floor(avgRoll + conBonus));

    debug(`Scaling NPC HP for ${actor.name}: ${diceCount}d${dieSize} -> ${newDiceCount}d${dieSize}, new max: ${newMax}, new formula: "${newFormula}"`);

    // Submit the changes through ApplicationV2 form submission
    if (typeof app.submit === "function") {
        await app.submit({
            updateData: {
                "system.attributes.hp.max": newMax,
                "system.attributes.hp.formula": newFormula
            }
        });
    } else {
        const currentMax = actor.system.attributes?.hp?.max ?? 0;
        const currentValue = actor.system.attributes?.hp?.value ?? 0;
        const maxDelta = newMax - currentMax;
        await actor.update({
            "system.attributes.hp.max": newMax,
            "system.attributes.hp.formula": newFormula,
            "system.attributes.hp.value": Math.max(0, currentValue + maxDelta)
        });
    }
}
