import { MODULE_ID, debug } from "../main.js";

/**
 * Build a color map from Foundry's disposition colors.
 * Pads hex values to 6 characters to avoid invalid CSS colors.
 */
function getDispositionColors() {
  return {
    "-2": '#' + CONFIG.Canvas.dispositionColors.SECRET.toString(16).padStart(6, '0'),
    "-1": '#' + CONFIG.Canvas.dispositionColors.HOSTILE.toString(16).padStart(6, '0'),
    "0": '#' + CONFIG.Canvas.dispositionColors.NEUTRAL.toString(16).padStart(6, '0'),
    "1": '#' + CONFIG.Canvas.dispositionColors.FRIENDLY.toString(16).padStart(6, '0')
  };
}

function applyDispositionDot(item, color) {
  let dot = item.querySelector('.nd5t-disposition-dot');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'nd5t-disposition-dot';

    const firstChild = item.children[0];
    if (firstChild) item.insertBefore(dot, firstChild);
    else item.appendChild(dot);
  }
  dot.style.backgroundColor = color;
}

function colorActorDispositionRender(app, html, options) {
  if (!game.settings.get(MODULE_ID, "enableActorDispositionColors")) return;
  const colors = getDispositionColors();

  const directoryHTML = html[0] || html;
  directoryHTML.querySelectorAll("li.directory-item.entry.actor").forEach(item => {
    let actorId = item.dataset.entryId || item.dataset.documentId;
    let actor = game.actors.get(actorId);

    if (actor && actor.prototypeToken.disposition.toString() in colors) {
      debug(`Applying disposition color to actor ${actor.name} (${actor.id})`);
      applyDispositionDot(item, colors[actor.prototypeToken.disposition.toString()]);
    }
  });
}

function colorActorDisposition(actor, updates, options, userId) {
  if (!game.settings.get(MODULE_ID, "enableActorDispositionColors")) return;
  const colors = getDispositionColors();

  if (actor && actor.prototypeToken.disposition.toString() in colors) {
      let item = document.querySelector(`li.directory-item[data-document-id="${actor.id}"]`) ||
                 document.querySelector(`li.directory-item[data-entry-id="${actor.id}"]`);
      if (item) {
        applyDispositionDot(item, colors[actor.prototypeToken.disposition.toString()]);
      }
  }
}

let initialized = false;
export function initActorDispositionColors() {
  if (initialized) return;
  initialized = true;
  Hooks.on("renderActorDirectory", colorActorDispositionRender);
  // Also support AppV2 sidebar rendering (V14+)
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app instanceof CONFIG.ui?.actors?.constructor || app.constructor?.name === "ActorDirectory") {
      colorActorDispositionRender(app, html);
    }
  });
  Hooks.on("updateActor", (actor, updates, options, userId) => {
   if (updates.prototypeToken?.disposition !== undefined)
    colorActorDisposition(actor, updates, options, userId);
  });
}
