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

export function registerItemDeleteCheckSettings() {
  game.settings.register(MODULE_ID, "idc_CheckDelete", {
    name: "item-delete-check.CheckDelete.Name",
    hint: "item-delete-check.CheckDelete.Hint",
    scope: "world",
    default: true,
    type: Boolean,
    config: true,
    requiresReload: true,
  });

  game.settings.register(MODULE_ID, "idc_Notify", {
    name: "item-delete-check.Notify.Name",
    hint: "item-delete-check.Notify.Hint",
    scope: "world",
    default: false,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_JournalEntryName", {
    name: "item-delete-check.JournalEntryName.Name",
    hint: "item-delete-check.JournalEntryName.Hint",
    scope: "world",
    default: "",
    type: String,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_MaxLines", {
    name: "item-delete-check.MaxLines.Name",
    hint: "item-delete-check.MaxLines.Hint",
    scope: "world",
    default: 1000,
    type: Number,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_NotifyLinkedOnly", {
    name: "item-delete-check.NotifyLinkedOnly.Name",
    hint: "item-delete-check.NotifyLinkedOnly.Hint",
    scope: "world",
    default: true,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_HideMessage", {
    name: "item-delete-check.HideMessage.Name",
    hint: "item-delete-check.HideMessage.Hint",
    scope: "world",
    default: true,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_NotifyBlackList", {
    name: "item-delete-check.NotifyBlackList.Name",
    hint: "item-delete-check.NotifyBlackList.Hint",
    scope: "world",
    default: "",
    type: String,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_NotifyPrepared", {
    name: "item-delete-check.NotifyPrepared.Name",
    hint: "item-delete-check.NotifyPrepared.Hint",
    scope: "world",
    default: false,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  if (["dnd5e"].includes(game.system.id)) {
    game.settings.register(MODULE_ID, "idc_NotifyCurrency", {
      name: "item-delete-check.NotifyCurrency.Name",
      hint: "item-delete-check.NotifyCurrency.Hint",
      scope: "world",
      default: false,
      type: Boolean,
      config: true,
      requiresReload: false,
    });
  }

  game.settings.register(MODULE_ID, "idc_NotifySpellSlots", {
    name: "item-delete-check.NotifySpellSlots.Name",
    hint: "item-delete-check.NotifySpellSlots.Hint",
    scope: "world",
    default: false,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_NotifyActivityUse", {
    name: "item-delete-check.NotifyActivityUse.Name",
    hint: "item-delete-check.NotifyActivityUse.Hint",
    scope: "world",
    default: false,
    type: Boolean,
    config: true,
    requiresReload: false,
  });

  game.settings.register(MODULE_ID, "idc_NotifyHitPoints", {
    name: "item-delete-check.NotifyHitPoints.Name",
    hint: "item-delete-check.NotifyHitPoints.Hint",
    scope: "world",
    default: false,
    type: Boolean,
    config: true,
    requiresReload: false,
  });
}

function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function initItemDeleteCheck() {
  const currencySystems = ["dnd5e"];

  const templatePaths = [
    `modules/${MODULE_ID}/templates/item-delete-check/changes.html`,
    `modules/${MODULE_ID}/templates/item-delete-check/journalChanges.html`
  ];

  foundry.applications.handlebars.loadTemplates(templatePaths);

  log("Initializing item-delete-check");
  if (getSetting("idc_CheckDelete")) {
    for (let sheetName of Object.keys(knownSheets)) {
      Hooks.on("render" + sheetName, enableSheetQOL);
    }
    Object.keys(CONFIG.Actor.sheetClasses.character).forEach((name) => {
      let sheetName = name.split(".")[1];
      Hooks.on("render" + sheetName, enableSheetQOL);
    });
  }
  
  let currencyTypes = {};
  switch (game.system.id) {
    case "dnd5e":
      currencyTypes = CONFIG.DND5E.currencies;
      break;
  }
  
  Hooks.on("preUpdateActor", (actor, update, ...args) => {
    if (getSetting("idc_NotifyLinkedOnly") && actor.isToken) return;
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    if (currencySystems.includes(game.system.id) && getSetting("idc_NotifyCurrency")) {
      if (update.system?.currency) {
        let originalCurrency = foundry.utils.duplicate(actor.system.currency);
        let currencyChanges = update.system.currency;
        Hooks.once("updateActor", () => {
          let content = [];
          let deltaCurrency = {};
          Object.keys(currencyChanges).forEach((cid) => {
            deltaCurrency[cid] = currencyChanges[cid] - originalCurrency[cid];
            if (deltaCurrency[cid] === 0) return;
            const deltaString = deltaCurrency[cid] >= 0 ? `+${deltaCurrency[cid]}` : `${deltaCurrency[cid]}`;
            let currencyType = currencyTypes[cid] ?? cid;
            if (typeof currencyType !== "string") currencyType = currencyType.label;
            content.push({ delta: deltaCurrency[cid], deltaString, final: currencyChanges[cid], item: currencyType });
          });
          if (foundry.utils.isEmpty(deltaCurrency)) return true;
          if (content.length === 0) return true;
          const speaker = ChatMessage.getSpeaker({ actor });
          const chatData = { speaker };
          logChange(chatData, { parent: actor, source: "pre update actor 1" }, content);
          return true;
        });
      }
    }
    if (update.system?.spells && getSetting("idc_NotifySpellSlots")) {
      let content = [];
      if (update.system.spells.pact !== undefined) {
        let originalSpells = actor.system.spells.pact?.value || 0;
        let newSpells = update.system.spells.pact.value;
        let consumed = originalSpells - newSpells;
        const deltaString = consumed >= 0 ? `+${consumed}` : `${consumed}`;
        if (consumed !== 0) content.push({ delta: consumed, deltaString, final: newSpells, item: "Pact Magic" });
      }
      const levelName = {
        0: "zeroth",
        1: "first",
        2: "second",
        3: "third",
        4: "fourth",
        5: "fifth",
        6: "sixth",
        7: "seventh",
        8: "eighth",
        9: "ninth"
      }
      for (let level = 0; level < 10; level++) {
        if (update.system.spells[`spell${level}`]?.value !== undefined) {
          let originalSpells = actor.system.spells[`spell${level}`]?.value || 0;
          let newSpells = update.system.spells[`spell${level}`].value;
          let consumed = newSpells - originalSpells;
          if (consumed === 0) continue;
          const deltaString = consumed >= 0 ? `+${consumed}` : `${consumed}`;
          content.push({ delta: consumed, deltaString, final: newSpells, item: `${levelName[level]} level spells` });
        }
      }
      if (content.length > 0) {
        const chatData = {
          speaker: ChatMessage.getSpeaker({ actor }),
          "flags": { [MODULE_ID]: { actorUuid: actor.uuid, originalSpells: actor.system.spells } },
        };
        logChange(chatData, { parent: actor, source: " pre update actor 2" }, content);
      }
    }
    if (update.system?.attributes?.hp?.value !== undefined && getSetting("idc_NotifyHitPoints")) {
      let originalHP = actor.system.attributes.hp.value;
      let newHP = update.system.attributes.hp.value;
      let consumed = newHP - originalHP;
      if (consumed !== 0) {
        const deltaString = consumed >= 0 ? `+${consumed}` : `${consumed}`;
        const content = [{ delta: consumed, deltaString, final: newHP, item: "Hit Points" }];
        const chatData = { speaker: ChatMessage.getSpeaker({ actor }) };
        logChange(chatData, { parent: actor }, content);
      }
    }
    return true;
  });

  Hooks.on("deleteItem", (item, options, userId) => {
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    let parent = item.parent;
    while (!(parent instanceof Actor || !parent instanceof foundry.canvas.placeables.Token) && parent?.parent)
      parent = parent.parent;
    if (parent instanceof foundry.canvas.placeables.Token) parent = parent.actor;
    if (!(parent instanceof Actor)) return;
    if (getSetting("idc_NotifyLinkedOnly") && item.parent.isToken)
      return;
    const user = game.users.get(userId);
    if (user.id !== game.user.id) return;
    if (!parent || options.temporary) return true;
    if (getSetting("idc_NotifyBlackList") !== "") {
      const blackList = getSetting("idc_NotifyBlackList").split(",").map(s => s.trim())
      if (blackList.some(s => item.name.toLowerCase().includes(s.toLowerCase()))) return;
    }
    const speaker = ChatMessage.getSpeaker({ actor: parent });
    let originalQuantity = item.system.quantity || 0;
    if (typeof item.system.quantity === "object") {
      originalQuantity = item.system.quantity.value || 0;
    }
    let changes = [{ delta: originalQuantity, deltaString: `-${originalQuantity}`, final: 0, item: `${item.name}` }];
    if (!(item.parent instanceof Actor))
      changes = [{ delta: originalQuantity, deltaString: `-${originalQuantity}`, final: 0, item: `@UUID[${item.parent?.uuid}]{${item.parent?.name}}.${item.name}` }];
    const chatData = { speaker };
    logChange(chatData, { parent, source: "delete item" }, changes);
    return true;
  });

  Hooks.on("createItem", (item, options, userId) => {
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    const user = game.users.get(userId);
    if (user.id !== game.user.id) return;
    if (!item.parent || !(item.parent instanceof Actor) || options.temporary) return;
    
    if (getSetting("idc_NotifyBlackList") !== "") {
      const blackList = getSetting("idc_NotifyBlackList").split(",").map(s => s.trim())
      if (blackList.some(s => item.name.toLowerCase().includes(s.toLowerCase()))) return;
    }
    if (getSetting("idc_NotifyLinkedOnly") && item.parent?.isToken)
      return;
      
    let originalQuantity = item.system.quantity || 0;
    if (typeof item.system.quantity === "object") {
      originalQuantity = item.system.quantity.value || 0;
    }
    const speaker = ChatMessage.getSpeaker({ actor: item.parent });
    const changes = [{ delta: originalQuantity, deltaString: `+${originalQuantity}`, final: originalQuantity, item: `@UUID[${item.uuid}]{${item.name}}` }];
    const chatData = { speaker };
    logChange(chatData, { parent: item.parent, source: "create item" }, changes);
    return true;
  });

  Hooks.on("createItemData", (item, itemData, options, userId) => {
    let parent = item.parent;
    while (!(parent instanceof Actor || !parent instanceof foundry.canvas.placeables.Token) && parent?.parent)
      parent = parent.parent;
    if (parent instanceof foundry.canvas.placeables.Token) parent = parent.actor;
    if (!(parent instanceof Actor)) return;
    
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    const user = game.users.get(userId);
    if (user.id !== game.user.id) return;
    if (
      getSetting("idc_NotifyLinkedOnly") &&
      !["character"].includes(parent.type)
    )
      return;
    if (["spell", "feat"].includes(itemData.type)) return;
    let originalQuantity = itemData.system.quantity || 0;
    if (typeof itemData.system.quantity === "object") {
      originalQuantity = itemData.system.quantity.value || 0;
    }

    const speaker = ChatMessage.getSpeaker({ actor: parent });
    const changes = [{ delta: originalQuantity, deltaString: `+${originalQuantity}`, final: originalQuantity, item: `@UUID[${item.uuid}]{${item.name}}.${itemData.name}` }];
    const chatData = { speaker };
    logChange(chatData, { parent: parent ?? item, source: "create item data" }, changes);
    return true;
  });

  Hooks.on("preUpdateItem", (item, update, options, userId) => {
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    if (!item.parent) return true;
    
    if (getSetting("idc_NotifyBlackList") !== "") {
      const blackList = getSetting("idc_NotifyBlackList").split(",").map(s => s.trim())
      if (blackList.some(s => item.name.toLowerCase().includes(s.toLowerCase()))) return;
    }
    if (!item.parent || !(item.parent instanceof Actor)) return;
    if (getSetting("idc_NotifyLinkedOnly") && item.parent.isToken) return;
    let changes = [];
    
    const hasUsesSpentChange = update.system?.uses?.spent !== undefined && item.system.uses?.spent !== update.system.uses.spent;
    if ((update.system?.quantity !== undefined && item.system.quantity !== update.system.quantity)
      || hasUsesSpentChange) {
      let quantityConsumed;
      let chargesConsumed;
      if (update.system?.quantity !== undefined) {
        let originalQuantity = item.system.quantity || 0;
        let newQuantity = update.system.quantity;
        quantityConsumed = update.system.quantity - originalQuantity;
        if (typeof item.system.quantity === "object") {
          originalQuantity = item.system.quantity.value || 0;
          newQuantity = update.system.quantity.value;
          quantityConsumed = newQuantity - originalQuantity;
        }
        const deltaString = quantityConsumed >= 0 ? `+${quantityConsumed}` : `${quantityConsumed}`;
        changes.push({ delta: quantityConsumed, deltaString, final: newQuantity, item: `@UUID[${item.uuid}]{${item.name}}` });
      }

      if (hasUsesSpentChange) {
        let originalSpent = item.system.uses?.spent || 0;
        let newSpent = update.system.uses.spent;
        let maxUses = item.system.uses?.max || 0;
        chargesConsumed = originalSpent - newSpent; 
        let newValue = maxUses - newSpent;
        const deltaString = chargesConsumed >= 0 ? `+${chargesConsumed}` : `${chargesConsumed}`;
        changes.push({ delta: chargesConsumed, deltaString, final: newValue, item: `@UUID[${item.uuid}]{${item.name}}` })
      }

      Hooks.once("updateItem", () => {
        const speaker = ChatMessage.getSpeaker({ actor: item.parent });
        const chatData = { speaker };
        foundry.utils.setProperty(chatData, "flags." + MODULE_ID, { itemUuid: item.uuid, actorUuid: item.parent.uuid, quantityConsumed, chargesConsumed })
        logChange(chatData, { parent: item.parent, source: " pre update item" }, changes);
      });
    }
    return true;
  });

  Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
    if (!getSetting("idc_NotifyActivityUse")) return;
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    const actor = activity.actor;
    if (!actor) return;
    if (getSetting("idc_NotifyLinkedOnly") && actor.isToken) return;
    const item = activity.item;
    if (getSetting("idc_NotifyBlackList") !== "") {
      const blackList = getSetting("idc_NotifyBlackList").split(",").map(s => s.trim());
      if (blackList.some(s => item.name.toLowerCase().includes(s.toLowerCase()))) return;
    }
    const activityName = activity.name;
    const speaker = ChatMessage.getSpeaker({ actor });
    const changes = [{ delta: 1, deltaString: "used", final: "", item: `@UUID[${item.uuid}]{${item.name}}:${activityName}` }];
    const chatData = { speaker };
    logChange(chatData, { parent: actor, source: "activity use" }, changes);
  });

  Hooks.on("preUpdateItem", (item, update, options, userId) => {
    if (!getSetting("idc_Notify") && getSetting("idc_JournalEntryName") === "") return;
    if (!getSetting("idc_NotifyPrepared")) return;
    if (!item.parent) return true;
    if (getSetting("idc_NotifyLinkedOnly") && item.parent.type !== "character")
      return;
    let content = "";
    if (update.system?.preparation?.prepared !== undefined && item.system.preparation?.prepared !== update.system.preparation.prepared) {
      content = `<p>${getDateTime(true)} ${update.system.preparation.prepared ? "Prepared" : "Unprepared"} @UUID[${item.uuid}]{${item.name}}`;

      const speaker = ChatMessage.getSpeaker({ actor: item.parent });
      const chatData = { speaker, content };
      logChange(chatData, { parent: item.parent, source: "pre update item" }, []);
    }
    return true;
  });

  Hooks.on("getChatMessageContextOptions", (app, menuItems) => {
    menuItems.push({
      name: game.i18n.localize("item-delete-check.DeleteAll"),
      icon: '<i class="fas fa-trash"></i>',
      condition: li => game.messages.get(li.dataset.messageId).flags?.[MODULE_ID],
      callback: (li) => {
        let messages = game.messages.filter(m => m.flags?.[MODULE_ID]);
        messages.forEach(m => m.delete());
      }
    })
  });
}

async function getJournal() {
  let journal = game.journal.getName(getSetting("idc_JournalEntryName"));
  if (!journal) {
    if (game.user.isGM) {
      await JournalEntry.create({
        name: getSetting("idc_JournalEntryName"),
        content: "",
        folder: null,
        permission: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: {},
      });
      journal = game.journal.getName(getSetting("idc_JournalEntryName"));
    }
  }
  return journal;
}

let socketlibSocket;

async function logChange(chatData, options, itemsToRender) {
  let content = foundry.utils.duplicate(chatData.content ?? "");
  if (itemsToRender?.length > 0) {
    const sheet = `modules/${MODULE_ID}/templates/item-delete-check/changes.html`;
    const html = await foundry.applications.handlebars.renderTemplate(sheet, { changes: itemsToRender });
    chatData.content = content + html;
  }
  chatData.flags = { [MODULE_ID]: true };
  if (getSetting("idc_Notify")) {
    if (getSetting("idc_HideMessage")) {
      ChatMessage.applyRollMode(chatData, CONST.DICE_ROLL_MODES.BLIND);
      if (globalThis.socketlib) {
        socketlibSocket.executeAsGM("sendChatMessage", chatData);
      } else if (game.user.isGM) {
        ChatMessage.create(chatData);
      }
    } else {
        ChatMessage.create(chatData);
    }
  }
  if (getSetting("idc_JournalEntryName") !== "") {
    let journalContent = "";
    const pageToUse = options.parent?.isToken ? "npc" : chatData.speaker.alias;
    let name = "";
    let uuidLink = "";
    if (pageToUse === "npc") {
      name = `@UUID[${options.parent.uuid}]{${options.parent.name}} `;
    } else uuidLink = `<p>@UUID[${options.parent?.uuid}]{${options.parent?.name}}</p>`

    if (itemsToRender?.length > 0) {
      const journalSheet = `modules/${MODULE_ID}/templates/item-delete-check/journalChanges.html`;
      journalContent = await foundry.applications.handlebars.renderTemplate(journalSheet, { name, dateTime: getDateTime(true), changes: itemsToRender });
    }
    
    if (globalThis.socketlib) {
      socketlibSocket.executeAsGM("logToJournal", { pageToUse, content, journalContent, options, uuidLink });
    } else if (game.user.isGM) {
      logToJournal({ pageToUse, content, journalContent, options, uuidLink });
    }
  }
}

Hooks.once("socketlib.ready", () => {
  socketlibSocket = globalThis.socketlib.registerModule(MODULE_ID);
  socketlibSocket.register("logToJournal", logToJournal);
  socketlibSocket.register("sendChatMessage", sendChatMessage);
});

async function sendChatMessage(chatData) {
  return ChatMessage.create(chatData);
}
    
async function logToJournal(data) {
  const journalEntry = await getJournal();
  if (!journalEntry) return;

  let page = journalEntry.pages.getName(data.pageToUse);
  if (!page) {
    return CONFIG.JournalEntryPage.documentClass.create({
      name: data.pageToUse,
      text: { content: data.uuidLink + data.content + data.journalContent },
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: {},
    }, { parent: journalEntry });
  } else {
    const maxLines = getSetting("idc_MaxLines");
    let pageContent = page.text.content;
    if (maxLines > 0) {
      let splitPageContent = pageContent.split("</p>");
      if (splitPageContent.length > maxLines)
        pageContent = splitPageContent.slice(splitPageContent.length - maxLines, splitPageContent.length).join("</p>");
    }
    return page.update({ text: { content: pageContent + data.content + data.journalContent } });
  }
}

function getDateTime(useSC = true) {
  if (globalThis.SimpleCalendar?.api) {
    const scDateTime = SimpleCalendar.api.formatTimestamp(SimpleCalendar.api.timestamp());
    return `${scDateTime.date} ${scDateTime.time}`;
  } else return new Date().toLocaleString();
}
