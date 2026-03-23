import { MODULE_ID, debug } from "../main.js";
const SETTING_PREFIX = "nd5t_";

const STATE = {
  enabled: false,
  mode: "active",        // "active" | "all"
  clearOnStart: true,    // also clear when combat starts
  onTurn: null,
  onStart: null
};

export function registerAutoClearMovementSettings() {
    // Mode
    game.settings.register(MODULE_ID, SETTING_PREFIX + "mode", {
      name: "Auto-Clear Movement: Clear Mode",
      hint: "Choose whether to clear only the active combatant’s movement history or all combatants each turn.",
      scope: "world",
      config: true,
      type: String,
      default: "all",
      choices: {
        active: "Active Combatant",
        all: "All Combatants"
      },
      restricted: true,
      onChange: () => AutoClearController.updateFromSettings()
    });
  
    // Also clear at combat start
    game.settings.register(MODULE_ID, SETTING_PREFIX + "clearOnStart", {
      name: "Auto-Clear Movement: Also Clear on Combat Start",
      hint: "If enabled, clears movement history when a combat first starts.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      restricted: true,
      onChange: () => AutoClearController.updateFromSettings()
    });
}

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
  // We check the feature toggle instead of the old enabledSetting
  static get enabledSetting() { return game.settings.get(MODULE_ID, "enableAutoClearMovementHistory"); }
  static get modeSetting() { return game.settings.get(MODULE_ID, SETTING_PREFIX + "mode"); }
  static get clearOnStartSetting() { return game.settings.get(MODULE_ID, SETTING_PREFIX + "clearOnStart"); }

  static updateFromSettings() {
    if (!game.settings.settings.has(MODULE_ID + ".enableAutoClearMovementHistory")) return;
    
    // removed dead safety check

    STATE.mode = this.modeSetting;
    STATE.clearOnStart = this.clearOnStartSetting;

    if (this.enabledSetting) this.enable();
    else this.disable();
  }

  static enable() {
    if (STATE.enabled) {
      // If hooks exist but the "clearOnStart" flag changed, refresh just that hook.
      this.#refreshStartHook();
      return;
    }

    // Register hooks
    STATE.onTurn = this.#onTurn.bind(this);
    Hooks.on("combatTurn", STATE.onTurn);

    if (STATE.clearOnStart) {
      STATE.onStart = this.#onStart.bind(this);
      Hooks.on("combatStart", STATE.onStart);
    }

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

  static #refreshStartHook() {
    // Toggle the combatStart hook according to current setting
    const wantStart = this.clearOnStartSetting;
    const hasStart = !!STATE.onStart;

    if (wantStart && !hasStart) {
      STATE.onStart = this.#onStart.bind(this);
      Hooks.on("combatStart", STATE.onStart);
    } else if (!wantStart && hasStart) {
      Hooks.off("combatStart", STATE.onStart);
      STATE.onStart = null;
    }
  }

  static async #onTurn(combat/*, update, options*/) {
    // Only a GM client actually performs the clear
    if (!game.user.isGM) return;
    debug(`Combat turn change detected, clearing movement histories for combat ${combat.id}`);
    await this.#clearForCombat(combat);
  }

  static async #onStart(combat/*, update*/) {
    if (!game.user.isGM) return;
    await this.#clearForCombat(combat);
  }

  static async #clearForCombat(combat) {
    if (!combat) return;
    const mode = STATE.mode;

    try {
      // Prefer the core helper if present (v13.338+)
      if (mode === "all" && typeof combat.clearMovementHistories === "function") {
        await combat.clearMovementHistories();
        return;
      }

      const c = combat.combatant;
      if (mode === "active" && c?.clearMovementHistory) {
        await c.clearMovementHistory();
        return;
      }

      // Fallback: per-combatant loop if the combat-level method is missing
      if (mode === "all") {
        const ops = combat.combatants.map(cb => cb?.clearMovementHistory?.());
        await Promise.allSettled(ops);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Auto-clear movement history failed:`, err);
    }
  }
}
