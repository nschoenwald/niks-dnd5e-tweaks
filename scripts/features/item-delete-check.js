import { MODULE_ID, log } from "../main.js";

let knownSheets = {
  BetterNPCActor5eSheet: ".item .rollable",
  ActorSheet5eCharacter: ".item .item-image",
  DynamicActorSheet5e: ".item .item-image",
  ActorSheet5eNPC: ".item .item-image",
  Sky5eSheet: ".item .item-image",
};

let enableSheetQOL = (app, html, data) => {
  //Add a check for item deletion
  $(html).find(".item-delete").off("click");
  $(html).find(".item-delete").click({ app: app, data: data }, itemDeleteHandler);
};

let itemDeleteHandler = (ev) => {
  let actor = game.actors.get(ev.data.data.actor?._id ?? ev.data.data._id);
  let d = new Dialog({
    // localize this text
    title: game.i18n.localize("item-delete-check.reallyDelete"),
    content: `<p>${game.i18n.localize("item-delete-check.sure")}</p>`,
    buttons: {
      one: {
        icon: '<i class="fas fa-check"></i>',
        label: "Delete",
        callback: () => {
          let li = $(ev.currentTarget).parents(".item"),
            itemId = li.attr("data-item-id");
          ev.data.app.object.deleteEmbeddedDocuments("Item", [itemId]);
        },
      },
      two: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel",
        callback: () => { },
      },
    },
    default: "two",
  });
  d.render(true);
};

export function initItemDeleteCheck() {
  log("Initializing item-delete-check");
  for (let sheetName of Object.keys(knownSheets)) {
    Hooks.on("render" + sheetName, enableSheetQOL);
  }
  Object.keys(CONFIG.Actor.sheetClasses.character).forEach((name) => {
    let sheetName = name.split(".")[1];
    Hooks.on("render" + sheetName, enableSheetQOL);
  });
}
