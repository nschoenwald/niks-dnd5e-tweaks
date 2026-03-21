import { debug } from "../main.js";

export function initItemRarityColors() {
  Hooks.on("renderBaseActorSheet", (app, html) => {
    if (!game.settings.get("niks-dnd5e-tweaks", "enableItemRarityColors")) {
      // Clean up classes if they exist? (Optional but good for hot-toggling)
      html.querySelectorAll(".item.nd5t-rarity-color-common, .item.nd5t-rarity-color-uncommon, .item.nd5t-rarity-color-rare, .item.nd5t-rarity-color-veryrare, .item.nd5t-rarity-color-legendary, .item.nd5t-rarity-color-artifact")
          .forEach(el => el.classList.remove("nd5t-rarity-color-common", "nd5t-rarity-color-uncommon", "nd5t-rarity-color-rare", "nd5t-rarity-color-veryrare", "nd5t-rarity-color-legendary", "nd5t-rarity-color-artifact"));
      return;
    }

    const items = html.querySelectorAll(".items-list .item");
    for (let itemElement of items) {
      // Use dataset.itemId if available, otherwise fallback to finding the ID
      const itemId = itemElement.dataset.itemId || itemElement.dataset.documentId;
      if (!itemId) continue;

      const item = app.document.items.get(itemId);
      if (!item) continue;

      let rarity = item.getRollData()?.item?.rarity || item?.system?.rarity || undefined;
      rarity = rarity ? rarity.replaceAll(/\s/g, "").toLowerCase().trim() : undefined;
      
      if (rarity) {
        debug(`Applying rarity color ${rarity} to item ${item.name} (${item.id})`);
        itemElement.classList.add("nd5t-rarity-color-" + rarity);
      }
    }
  });
}
