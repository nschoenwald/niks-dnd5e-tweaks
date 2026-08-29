import { MODULE_ID, debug, log } from "../main.js";

/**
 * Auto-Unpause on Login
 *
 * When the GM logs in, optionally unpauses the game depending on the user's
 * per-account setting:
 *   - "always"    — unpause unconditionally
 *   - "noPlayers" — unpause only when no non-GM players are connected
 *   - "never"     — do nothing (default)
 */

export function initAutoUnpauseOnLogin() {
    Hooks.once("ready", _handleAutoUnpause);
}

/**
 * Called once when the world is fully ready.
 */
async function _handleAutoUnpause() {
    if (!game.user.isGM) return;

    const mode = game.settings.get(MODULE_ID, "autoUnpauseOnLogin");
    if (mode === "never" || !mode) return;
    if (!game.paused) return;

    // Count active non-GM users (connected players).
    const connectedPlayers = game.users.filter(u => u.active && !u.isGM);

    if (mode === "noPlayers") {
        if (connectedPlayers.length > 0) {
            debug(`Auto-Unpause: ${connectedPlayers.length} player(s) already connected — skipping unpause.`);
            return;
        }
        log("Auto-Unpause: GM logged in with no players connected — unpausing the game.");
    } else if (mode === "always") {
        log(`Auto-Unpause: GM logged in (mode: always) — unpausing the game. ${connectedPlayers.length} player(s) connected.`);
    } else {
        return;
    }

    await game.togglePause(false, { broadcast: true });
}
