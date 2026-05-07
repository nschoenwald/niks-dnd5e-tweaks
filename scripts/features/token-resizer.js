import { MODULE_ID, debug } from "../main.js";

/**
 * Size data mapping for standard 5e creature sizes.
 * - tokenSize: grid footprint in cells (width & height)
 * - dynamicTokenScale: The visual scale factor that dnd5e applies to tokens with dynamic
 *   token rings. We mirror this here so that for tokens WITHOUT dynamic rings, we can
 *   apply the same visual scaling ourselves via texture.scaleX/Y.
 *   Ref: CONFIG.DND5E.actorSizes[size].dynamicTokenScale in the dnd5e system.
 */
let sizeData = {
  "tiny": { label: "Tiny", tokenSize: 0.5, dynamicTokenScale: 1 },
  "sm": { label: "Small", tokenSize: 1, dynamicTokenScale: 0.8 },
  "med": { label: "Medium", tokenSize: 1, dynamicTokenScale: 1 },
  "lg": { label: "Large", tokenSize: 2, dynamicTokenScale: 1 },
  "huge": { label: "Huge", tokenSize: 3, dynamicTokenScale: 1 },
  "grg": { label: "Gargantuan", tokenSize: 4, dynamicTokenScale: 1 }
};

export function initTokenResizer() {
  foundry.utils.setProperty(globalThis, "nd5t.api.tokenResizeData", sizeData);
  foundry.utils.setProperty(globalThis, "nd5t.api.queryResizeTokens", queryResizeTokens);
  foundry.utils.setProperty(globalThis, "nd5t.api.doResizeTokens", doResizeTokens);

  Hooks.on("getSceneControlButtons", (buttons) => {
    if (!game.settings.get(MODULE_ID, "enableTokenResizer")) return;

    let tokenButtons = buttons["tokens"] || buttons.find?.(b => b.name === "token");

    if (tokenButtons) {
      const tool = {
        name: "tokenResizer",
        title: "Resize Token (Nik's DnD5e Tweaks)",
        icon: "fas fa-expand-alt",
        button: true,
        toggle: false,
        active: true,
        visible: game.user.isGM,
        onChange: async (event, active) => {
          if (game.canvas.tokens.controlled.length < 1) {
            ui.notifications.warn("No tokens selected to resize.");
            return;
          }
          queryResizeTokens(game.canvas.tokens.controlled);
        },
      };

      if (!tokenButtons.tools) {
        tokenButtons.tools = [tool];
      } else if (Array.isArray(tokenButtons.tools)) {
        if (!tokenButtons.tools.find(t => t.name === "tokenResizer")) tokenButtons.tools.push(tool);
      } else {
        tokenButtons.tools["tokenResizer"] = tool;
      }
    }
  });
}

export async function doResizeTokens(tokens, size, sizeDataToUse = globalThis.nd5t.api.tokenResizeData) {
  if (!size) return;
  const sizeEntry = sizeDataToUse[size];
  if (!sizeEntry) return;

  for (let token of tokens) {
    const newDndSize = sizeEntry.dndSize ?? size;
    const targetWidth = sizeEntry.width ?? sizeEntry.tokenSize;
    const targetHeight = sizeEntry.height ?? sizeEntry.tokenSize;

    // ── Dynamic Token Ring vs. Non-Ring Scaling ──────────────────────
    //
    // The dnd5e system's TokenDocument5e.prepareData() applies a visual scale
    // factor (dynamicTokenScale) to small tokens. Critically, it does this by
    // multiplying _source.texture.scaleX/Y by the factor. But it ONLY does
    // this when the token has dynamic token rings enabled:
    //
    //   if ( !this.hasDynamicRing ) return;
    //   const dts = CONFIG.DND5E.actorSizes[size].dynamicTokenScale ?? 1;
    //   this.texture.scaleX = this._source.texture.scaleX * dts;
    //
    // This means:
    // - WITH dynamic rings: dnd5e handles scaling. We must NOT touch scale,
    //   or the 0.8 factor will be applied twice (once by us, once by dnd5e).
    // - WITHOUT dynamic rings: dnd5e does nothing. We should apply the scale
    //   ourselves if we want small tokens to look visually smaller.
    //
    const hasDynamicRing = token.document.ring?.enabled;
    // Use our local sizeData value, but fall back to the live dnd5e config
    const scaleMultiplier = sizeEntry.dynamicTokenScale
      ?? CONFIG.DND5E?.actorSizes?.[newDndSize]?.dynamicTokenScale
      ?? 1;

    debug(`Token Resizer | Resizing "${token.name}" to ${sizeEntry.label}`, {
      hasDynamicRing,
      scaleMultiplier,
      targetWidth,
      targetHeight,
      currentScaleX: token.document.texture?.scaleX,
      sourceScaleX: token.document._source?.texture?.scaleX
    });

    // ── Step 1: Capture the original base scale before any resizing ──
    // On the very first resize, save the token's original texture scale so
    // we can restore it later when resizing back to a non-scaled size.
    // We only do this for tokens WITHOUT dynamic rings, since dnd5e handles
    // ring tokens entirely on its own.
    if (!hasDynamicRing && token.document.getFlag(MODULE_ID, "preResizeScaleX") === undefined) {
      const sourceScaleX = token.document._source?.texture?.scaleX ?? 1;
      const sourceScaleY = token.document._source?.texture?.scaleY ?? 1;
      await token.document.setFlag(MODULE_ID, "preResizeScaleX", sourceScaleX);
      await token.document.setFlag(MODULE_ID, "preResizeScaleY", sourceScaleY);
    }

    // ── Step 2: Update the Actor's size trait ────────────────────────
    // This must happen before the token document update. The dnd5e system
    // reacts to actor size changes and may adjust token properties
    // (especially for linked tokens with dynamic rings).
    if (token.actor) {
      await token.actor.update({ "system.traits.size": newDndSize });
    }

    // ── Step 3: Build and apply the token document update ────────────
    const update = {
      height: targetHeight,
      width: targetWidth
    };

    // For non-ring tokens, handle texture scaling ourselves
    if (!hasDynamicRing) {
      const baseScaleX = token.document.getFlag(MODULE_ID, "preResizeScaleX") ?? 1;
      const baseScaleY = token.document.getFlag(MODULE_ID, "preResizeScaleY") ?? 1;

      if (scaleMultiplier !== 1) {
        // Applying a scale factor (e.g. Small = 0.8)
        update["texture.scaleX"] = baseScaleX * scaleMultiplier;
        update["texture.scaleY"] = baseScaleY * scaleMultiplier;
      } else {
        // Restoring to a non-scaled size — use the saved base scale
        update["texture.scaleX"] = baseScaleX;
        update["texture.scaleY"] = baseScaleY;
      }
    }

    await token.document.update(update);

    // ── Step 4: Clean up saved scale when restoring to neutral ────────
    // When going back to a size with no scale modifier, remove the saved
    // base scale flags so the next resize cycle starts fresh.
    if (scaleMultiplier === 1 && token.document.getFlag(MODULE_ID, "preResizeScaleX") !== undefined) {
      await token.document.unsetFlag(MODULE_ID, "preResizeScaleX");
      await token.document.unsetFlag(MODULE_ID, "preResizeScaleY");
    }

    // ── Step 5: Force a full visual refresh ──────────────────────────
    // The dnd5e system modifies derived texture.scaleX/Y in prepareData()
    // based on the actor's size trait and dynamicTokenScale. However, since
    // the texture scale change is derived (not part of our explicit update),
    // the canvas may not automatically refresh the mesh. We need to:
    // 1. Reset the document to re-run prepareData() with the new actor data
    // 2. Trigger render flags to force the canvas token to refresh its mesh
    token.document.reset();
    if (token.renderFlags) {
      token.renderFlags.set({
        refreshMesh: true,
        refreshSize: true,
        refreshPosition: true,
        refreshShape: true
      });
    }
  }
}

export async function queryResizeTokens(tokens, sizeDataToUse = globalThis.nd5t.api.tokenResizeData) {
  let size;
  const buttonData = Object.keys(sizeDataToUse).map((key) => {
    return {
      action: key,
      label: sizeDataToUse[key].label,
      callback: () => { size = key },
      disabled: false,
      className: `nd5t-dialog-button ${key}`
    }
  });

  await foundry.applications.api.DialogV2.wait({
    window: {
      title: "Change Size?",
      width: "auto",
      resizable: true,
    },
    buttons: buttonData,
    rejectClose: false,
    close: () => { return null }
  });

  if (size) return await doResizeTokens(tokens, size, sizeDataToUse);
}