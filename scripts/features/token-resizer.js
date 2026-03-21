import { debug } from "../main.js";

let sizeData = {
  "tiny": { label: "Tiny", tokenSize: 0.25, minScale: 1 },
  "sm": { label: "Small", tokenSize: 1, scale: 0.5 },
  "med": { label: "Medium", tokenSize: 1, minScale: 1 },
  "lg": { label: "Large", tokenSize: 2, minScale: 1 },
  "huge": { label: "Huge", tokenSize: 3, minScale: 1 },
  "grg": { label: "Gargantuan", tokenSize: 4, minScale: 1 },
  "unit": { label: "Absolute Unit", tokenSize: 8, minScale: 1, dndSize: "grg" },
};

export function initTokenResizer() {
  foundry.utils.setProperty(globalThis, "nd5t.api.tokenResizeData", sizeData);
  foundry.utils.setProperty(globalThis, "nd5t.api.queryResizeTokens", queryResizeTokens);
  foundry.utils.setProperty(globalThis, "nd5t.api.doResizeTokens", doResizeTokens);

  Hooks.on("getSceneControlButtons", (buttons) => {
    if (!game.settings.get("niks-dnd5e-tweaks", "enableTokenResizer")) return;
    
    // Exact logic from scriptlets: buttons["tokens"]
    // We also include fallback for standard array find
    let tokenButtons = buttons["tokens"] || buttons.find?.(b => b.name === "token");
    
    if (tokenButtons) {
      const tool = {
        name: "tokenResizer",
        title: "Resize Token (DnD5e Tweaks)",
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

      // Exact logic from scriptlets: tokenButtons.tools["tokenResizer"] = ...
      if (Array.isArray(tokenButtons.tools)) {
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
    const update = { height: sizeEntry.height ?? sizeEntry.tokenSize, width: sizeEntry.width ?? sizeEntry.tokenSize };
    const scaleX = token.document.texture?.scaleX;
    const scaleY = token.document.texture?.scaleY;
    if (scaleX < (sizeEntry.minScaleX ?? sizeEntry.minScale) || scaleY < (sizeEntry.minScaleY ?? sizeEntry.minScale)) {
      update["texture"] = { scaleX: Math.max(scaleX, sizeEntry.minScaleX ?? sizeEntry.minScale ?? 1), scaleY: Math.max(scaleY, sizeEntry.minScaleY ?? sizeEntry.minScale ?? 1) }
    } else if (sizeEntry.scale) {
      update["texture"] = { scaleX: sizeEntry.scale, scaleY: sizeEntry.scale }
    }
    await token.document.update(update, { method: "teleport" });
    await token.actor.update({ "system.traits.size": sizeEntry.dndSize ?? size })
  }
}

export async function queryResizeTokens(tokens, sizeDataToUse = globalThis.nd5t.api.tokenResizeData) {
  let size;
  const buttonData = Object.keys(sizeData).map((key) => {
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
