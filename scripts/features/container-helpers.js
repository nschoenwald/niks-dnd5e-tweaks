import { socketlibSocket } from "./gm-action.js";
import { debug } from "../main.js";

export function initContainerHelpers() {
  Hooks.on("dnd5e.dropItemSheetData", processSheetDropData);
  Hooks.on("dropActorSheetData", processSheetDropData);
}

const processSheetDropData = async (actorOrItem, sheet, data) => {
  if (data.type !== "Item") return;
  const actorRemove = game.settings.get("niks-dnd5e-tweaks", "autoRemoveItemsFromActor");
  const containerRemove = game.settings.get("niks-dnd5e-tweaks", "autoRemoveItemsFromContainer");
  
  // Exit early if both are none, allowing hot-toggling
  if (actorRemove === "none" && containerRemove === "none") return;
  
  const sourceItem = fromUuidSync(data.uuid);
  if (!sourceItem) return;
  if (["spell", "feat"].includes(sourceItem.type)) return;
  
  let targetActor = actorOrItem;
  if (actorOrItem instanceof Item) targetActor = actorOrItem.parent;
  
  if (sourceItem?.parent instanceof Actor && targetActor !== sourceItem.parent) { // dropped from an actor
    if (actorRemove === "removeAll"
      || (sourceItem.parent.type === "character" && ["removeCharacter", "removeCharacterGroup", "removeCharacterNPC"].includes(actorRemove))
      || (sourceItem.parent.type === "npc" && ["removeNPC", "removeCharacterNPC", "removeNPCGroup"].includes(actorRemove))
      || (sourceItem.parent.type === "group" && ["removeGroup", "removeCharacterGroup", "removeNPCGroup"].includes(actorRemove))) { // dropped from inventory
      debug(`Auto-removing item ${sourceItem.name} (${sourceItem.uuid}) after drop`);
      if (sourceItem.isOwner) await sourceItem.delete({ deleteContents: true });
      else if (socketlibSocket) await socketlibSocket.executeAsGM("deleteItem", sourceItem.uuid, { deleteContents: true });
    }
  } else if (!sourceItem.parent && sourceItem.container) { // dropped from a world container to an actor
    if (["removeWorld"].includes(containerRemove)) {
      if (sourceItem.isOwner) await sourceItem.delete({ deleteContents: true });
      else if (socketlibSocket) await socketlibSocket.executeAsGM("deleteItem", sourceItem.uuid, { deleteContents: true });
    }
  }
}
