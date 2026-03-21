import { debug, log } from "../main.js";

export var socketlibSocket = undefined;

export function setupSocket() {
  const socketlib = globalThis.socketlib;
  if (!socketlib) {
      log("socketlib is not installed or active. Some features (e.g. Container Helpers) will not work.");
      return;
  }
  socketlibSocket = socketlib.registerModule("niks-dnd5e-tweaks");
  if (socketlibSocket) {
      socketlibSocket.register("deleteItem", deleteItem);
      debug("Socket registered successfully via socketlib.");
  } else {
      log("Failed to register socket via socketlib.");
  }
}

export async function deleteItem(itemUuid, options) {
  debug(`Processing remote deleteItem request for ${itemUuid}`);
  const item = fromUuidSync(itemUuid);
  if (!item) return;
  return item.delete(options);
}
