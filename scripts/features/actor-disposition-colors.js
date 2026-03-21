import { debug } from "../main.js";

function colorActorDispositionRender(app, html, options) {
  if (!game.settings.get("niks-dnd5e-tweaks", "enableActorDispositionColors")) return;
  const colors = {
    "-2": '#' + CONFIG.Canvas.dispositionColors.SECRET.toString(16), // Secret
    "-1": '#' + CONFIG.Canvas.dispositionColors.HOSTILE.toString(16), // Hostile
    "0": '#' + CONFIG.Canvas.dispositionColors.NEUTRAL.toString(16), // Neutral
    "1": '#' + CONFIG.Canvas.dispositionColors.FRIENDLY.toString(16) // Friendly
  };

  const directoryHTML = html[0] || html;
  directoryHTML.querySelectorAll("li.directory-item.entry.actor").forEach(item => {
    let actorId = item.dataset.entryId || item.dataset.documentId;
    let actor = game.actors.get(actorId);

    if (actor && actor.prototypeToken.disposition.toString() in colors) {
      debug(`Applying disposition color to actor ${actor.name} (${actor.id})`);
      let dot = item.querySelector('.nd5t-disposition-dot');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'nd5t-disposition-dot';
        
        const firstChild = item.children[0];
        if (firstChild) item.insertBefore(dot, firstChild);
        else item.appendChild(dot);
      }
      dot.style.backgroundColor = colors[actor.prototypeToken.disposition.toString()];
    }
  });
}

function colorActorDisposition(actor, updates, options, userId) {
  if (!game.settings.get("niks-dnd5e-tweaks", "enableActorDispositionColors")) return;
  
  const colors = {
    "-2": '#' + CONFIG.Canvas.dispositionColors.SECRET.toString(16), // Secret
    "-1": '#' + CONFIG.Canvas.dispositionColors.HOSTILE.toString(16), // Hostile
    "0": '#' + CONFIG.Canvas.dispositionColors.NEUTRAL.toString(16), // Neutral
    "1": '#' + CONFIG.Canvas.dispositionColors.FRIENDLY.toString(16) // Friendly
  };

  if (actor && actor.prototypeToken.disposition.toString() in colors) {
      let item = document.querySelector(`li.directory-item[data-document-id="${actor.id}"]`) || 
                 document.querySelector(`li.directory-item[data-entry-id="${actor.id}"]`);
      if (item) {
        let dot = item.querySelector('.nd5t-disposition-dot');
        if (!dot) {
           dot = document.createElement('span');
           dot.className = 'nd5t-disposition-dot';
           
           const firstChild = item.children[0];
           if (firstChild) item.insertBefore(dot, firstChild);
           else item.appendChild(dot);
        }
        dot.style.backgroundColor = colors[actor.prototypeToken.disposition.toString()];
      }
  }
}

let initialized = false;
export function initActorDispositionColors() {
  if (initialized) return;
  initialized = true;
  Hooks.on("renderActorDirectory", colorActorDispositionRender);
  Hooks.on("updateActor", (actor, updates, options, userId) => {
   if (updates.prototypeToken?.disposition !== undefined) 
    colorActorDisposition(actor, updates, options, userId);
  });
}
