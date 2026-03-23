import { MODULE_ID, debug } from "../main.js";

export function initItemRarityColors() {
  // Support both AppV1 (renderBaseActorSheet) and AppV2 (renderApplication) actor sheets
  const applyRarityColors = (app, html) => {
    const element = html[0] || html;
    if (!game.settings.get(MODULE_ID, "enableItemRarityColors")) {
      element.querySelectorAll(".item.nd5t-rarity-color-common, .item.nd5t-rarity-color-uncommon, .item.nd5t-rarity-color-rare, .item.nd5t-rarity-color-veryrare, .item.nd5t-rarity-color-legendary, .item.nd5t-rarity-color-artifact")
          .forEach(el => el.classList.remove("nd5t-rarity-color-common", "nd5t-rarity-color-uncommon", "nd5t-rarity-color-rare", "nd5t-rarity-color-veryrare", "nd5t-rarity-color-legendary", "nd5t-rarity-color-artifact"));
      return;
    }

    const items = element.querySelectorAll(".items-list .item");
    for (let itemElement of items) {
      const itemId = itemElement.dataset.itemId || itemElement.dataset.documentId;
      if (!itemId) continue;

      const item = app.document.items.get(itemId);
      if (!item) continue;

      let rarity = item.getRollData()?.item?.rarity || item?.system?.rarity || undefined;
      rarity = rarity ? rarity.replaceAll(/\s/g, "").toLowerCase().trim() : undefined;
      
      if (rarity) {
        debug(`Applying rarity color ${rarity} to item ${item.name} (${item.id})`);
        itemElement.classList.remove(
            "nd5t-rarity-color-common", "nd5t-rarity-color-uncommon",
            "nd5t-rarity-color-rare", "nd5t-rarity-color-veryrare",
            "nd5t-rarity-color-legendary", "nd5t-rarity-color-artifact"
        );
        itemElement.classList.add("nd5t-rarity-color-" + rarity);
      }
    }
  };

  Hooks.on("renderBaseActorSheet", applyRarityColors);
  // Also support AppV2 actor sheets (DnD5e 5.2+ / Foundry V14)
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app.document?.documentName === "Actor") {
      applyRarityColors(app, html);
    }
  });
}
