import { MODULE_ID, log } from "../main.js";

/**
 * Blood Drop Bloodied Icon
 * Replaces the default DnD5e bloodied condition icon with a red blood drop SVG.
 *
 * Called during the module's "init" hook, which fires after the DnD5e system's
 * init has already assigned CONFIG.DND5E from the static config object in
 * dnd5e/module/config.mjs. This means CONFIG.DND5E.bloodied is available.
 *
 * IMPORTANT — Property naming pitfall:
 * The DnD5e bloodied config uses `.img`, NOT `.icon`:
 *
 *   CONFIG.DND5E.bloodied = {
 *     name: "EFFECT.DND5E.StatusBloodied",
 *     img: "systems/dnd5e/icons/svg/statuses/bloodied.svg",   // <-- .img
 *     threshold: .5
 *   };
 *
 * This differs from some other status effect configs that use `.icon`.
 * Setting `.icon` instead of `.img` will silently fail — the system ignores it.
 *
 * @see https://github.com/foundryvtt/dnd5e/blob/master/module/config.mjs
 */
export function initBloodDropIcon() {
    if (!game.settings.get(MODULE_ID, "enableBloodDropIcon")) return;

    // Override the bloodied status icon — must use .img (not .icon)
    CONFIG.DND5E.bloodied.img = `modules/${MODULE_ID}/assets/bloodDrop.svg`;
}

