import { MODULE_ID, debug } from "../main.js";

const STATE = {
  enabled: false,
  onTurn: null,
  onStart: null
};

export function initAutoClearMovementHistory() {
    Hooks.once("ready", () => {
        AutoClearController.updateFromSettings();
    });
}

export function disableAutoClearMovementHistory() {
    AutoClearController.disable();
}

export function enableAutoClearMovementHistory() {
    AutoClearController.updateFromSettings();
}

class AutoClearController {
  static get enabledSetting() { return game.settings.get(MODULE_ID, "enableAutoClearMovementHistory"); }

  static updateFromSettings() {
    if (!game.settings.settings.has(MODULE_ID + ".enableAutoClearMovementHistory")) return;

    if (this.enabledSetting) this.enable();
    else this.disable();
  }

  static enable() {
    if (STATE.enabled) return;

    // Register hooks for both combatTurn and combatStart
    STATE.onTurn = this.#onTurn.bind(this);
    STATE.onStart = this.#onStart.bind(this);
    Hooks.on("combatTurn", STATE.onTurn);
    Hooks.on("combatStart", STATE.onStart);

    STATE.enabled = true;

    if (game.user.isGM) {
      const active = game.combats?.active;
      if (active) this.#clearForCombat(active).catch(err => console.error(`${MODULE_ID} immediate clear failed:`, err));
    }
  }

  static disable() {
    if (!STATE.enabled) return;

    try {
      if (STATE.onTurn) Hooks.off("combatTurn", STATE.onTurn);
      if (STATE.onStart) Hooks.off("combatStart", STATE.onStart);
    } finally {
      STATE.onTurn = null;
      STATE.onStart = null;
      STATE.enabled = false;
    }
  }

  static async #onTurn(combat/*, update, options*/) {
    if (!game.user.isGM) return;
    debug(`Combat turn change detected, clearing movement histories for combat ${combat.id}`);
    await this.#clearForCombat(combat);
  }

  static async #onStart(combat/*, update*/) {
    if (!game.user.isGM) return;
    debug(`Combat start detected, clearing movement histories for combat ${combat.id}`);
    await this.#clearForCombat(combat);
  }

  static async #clearForCombat(combat) {
    if (!combat) return;

    try {
      // Prefer the core helper if present (v13.338+)
      if (typeof combat.clearMovementHistories === "function") {
        await combat.clearMovementHistories();
        return;
      }

      // Fallback: per-combatant loop over all combatants
      const ops = combat.combatants.map(cb => cb?.clearMovementHistory?.());
      await Promise.allSettled(ops);
    } catch (err) {
      console.error(`${MODULE_ID} | Auto-clear movement history failed:`, err);
    }
  }
}
