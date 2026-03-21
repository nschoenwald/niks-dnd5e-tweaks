import { debug } from "../main.js";

let baseTitle = document.title;
let initialized = false;

// Store the hook IDs so we can remove them
const hookIds = {
    canvasReady: null,
    canvasTearDown: null,
    updateUser: null,
    updateScene: null,
    deleteScene: null,
    renderApplicationV2: null
};

export function initSceneNavName() {
    if (initialized) return;
    initialized = true;
    
    // Initial set once the game is ready
    Hooks.once("ready", () => {
        baseTitle = document.title;
        applyTabTitle();
    });

    Hooks.on("nd5t.updateTabTitle", () => applyTabTitle());

    hookIds.canvasReady = Hooks.on("canvasReady", () => applyTabTitle());
    hookIds.canvasTearDown = Hooks.on("canvasTearDown", () => applyTabTitle());
    hookIds.updateUser = Hooks.on("updateUser", (user, changes) => {
        if (user.id !== game.user.id) return;
        if (hasOwn(changes, "viewedScene")) applyTabTitle();
    });
    hookIds.updateScene = Hooks.on("updateScene", (scene, changes) => {
        const candidates = new Set([
            game.user?.viewedScene,
            canvas?.scene?.id,
            game.scenes?.active?.id
        ].filter(Boolean));
        if (!candidates.has(scene.id)) return;

        if (hasOwn(changes, "navName") || hasOwn(changes, "name")) applyTabTitle();
    });
    hookIds.deleteScene = Hooks.on("deleteScene", (scene) => {
        const candidates = new Set([
            game.user?.viewedScene,
            canvas?.scene?.id,
            game.scenes?.active?.id
        ].filter(Boolean));
        if (candidates.has(scene.id)) applyTabTitle();
    });
    hookIds.renderApplicationV2 = Hooks.on("renderApplicationV2", (app) => {
        if (app instanceof foundry.applications.ui.SceneNavigation) applyTabTitle();
    });
}

function navigationLabel(scene) {
  if (!scene) return null;

  const getter = /** @type {any} */ (scene).navigationName;
  if (typeof getter === "string" && getter.trim().length) return getter.trim();

  const nav = (scene.navName ?? "").trim();
  return nav.length ? nav : (scene.name ?? null);
}

function currentClientScene() {
  const viewedId = game.user?.viewedScene;
  if (viewedId && game.scenes) {
    const viewed = game.scenes.get(viewedId);
    if (viewed) return viewed;
  }

  if (canvas?.ready && canvas.scene) return canvas.scene;

  return game.scenes?.active ?? null;
}

const applyTabTitle = (() => {
  let raf = null;
  return function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = null;
      if (!game.settings.get("niks-dnd5e-tweaks", "enableSceneNavName")) {
          if (document.title !== baseTitle) document.title = baseTitle;
          return;
      }
      const scene = currentClientScene();
      const label = navigationLabel(scene);
      const title = label ? `${label}` : baseTitle;
      if (document.title !== title) {
          debug(`Updating document title to: ${title}`);
          document.title = title;
      }
    });
  };
})();

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}
