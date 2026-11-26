/**
 * Feature: Teleport Targeting (D&D 5e parts of Nik's Foundry Tweaks' Enhanced Teleport Targeting UI)
 * Description: Tells core's teleport HUD the range and spell name of BLFX teleports (from the activity just used),
 * and replaces the drag-to-move planning of D&D 5e's Teleport activity with core's click-to-pick HUD and ghost preview.
 *
 * Switched by core's "Enhanced Teleport Targeting UI" setting (`api.teleportTargeting.isActive()`), no setting here.
 * Needs Nik's Foundry Tweaks 14.9.0 (API_VERSION 3); with an older core nothing here runs.
 *
 * Range of a teleport, in this order:
 * 1. A Teleport activity's distance (`teleport.value` / `teleport.units`), from the used activity or another
 *    activity of the same item.
 * 2. "teleport … up to 30 feet" in the item description (older items with Utility activities, e.g. Misty Step
 *    copies made before the Player's Handbook used the Teleport activity).
 * Converted to the scene's units. Otherwise no limit.
 *
 * Native Teleport activity (`dnd5e.preTeleport`): with exactly one token, dnd5e's planning is skipped (hook returns
 * false), core's picker chooses the destination within `config.maxDistance`, and the token moves with a "blink"
 * waypoint. `dnd5e.teleport` and `dnd5e.postTeleport` still fire; the plan objects carry no movement `id` (no
 * Foundry-planned movement exists). Several tokens (Dimension Door with a companion) keep dnd5e's own flow.
 *
 * @introduced v14.101.0
 * @updated v14.116.0 (Length conversion uses only the D&D 5e 6.1 signature)
 */
import { MODULE_ID, debug } from "../../context.js";
import { coreApi } from "../../core-integration.js";

/** How long a used activity counts as "the one that triggered the teleport" (ms). */
const RECENT_ACTIVITY_MS = 60000;

/** Actor UUID -> { activity, time } of the last activity used. */
const recentActivities = new Map();

/** Set while dnd5e's own planning runs again after our picker couldn't start. */
let bypassPreTeleport = false;

/**
 * Description patterns for "teleport … up to N feet" (English item text only; translated descriptions aren't parsed).
 * Group 1 is the number, group 2 the unit.
 */
const DESCRIPTION_PATTERNS = [
    /teleport[^.]*?\bup to (\d+(?:[.,]\d+)?)\s*(feet|foot|ft\.?|meters?|metres?|m)\b/i,
    /\bup to (\d+(?:[.,]\d+)?)\s*(feet|foot|ft\.?|meters?|metres?|m)\b[^.]*?teleport/i
];

/**
 * The teleport picker of Nik's Foundry Tweaks, or undefined with a core older than 14.9.0.
 * @returns {{isActive: () => boolean, pickDestination: Function}|undefined}
 */
function teleportApi() {
    const api = coreApi();
    if (!api || ((api.API_VERSION ?? 0) < 3)) return undefined;
    return api.teleportTargeting;
}

/**
 * Initialize: remember used activities, register the range extension, take over the Teleport activity's planning.
 * Runs in `setup`, so these `dnd5e.postUseActivity` listeners run before BLFX's (registered in `ready`).
 */
export function initTeleportTargeting() {
    const api = coreApi();
    if (!teleportApi()) {
        debug("Teleport Targeting: Nik's Foundry Tweaks 14.9.0 or newer needed, skipping.");
        return;
    }

    Hooks.on("dnd5e.preUseActivity", rememberActivity);
    Hooks.on("dnd5e.postUseActivity", rememberActivity);
    Hooks.on("dnd5e.preTeleport", onPreTeleport);

    api.extend("teleportTargeting", { getTeleportInfo });

    debug("Teleport Targeting initialized.");
}

/* -------------------------------------------- */
/*  Range for BLFX teleports                    */
/* -------------------------------------------- */

/**
 * Remember the activity an actor used last (BLFX's teleport macros run right after it).
 * @param {Activity} activity
 */
function rememberActivity(activity) {
    const actor = activity?.actor;
    if (!actor?.uuid) return;
    recentActivities.set(actor.uuid, { activity, time: Date.now() });
}

/**
 * Extension for core: range (scene units) and name of the activity the token's actor used just now.
 * @param {{sourceToken: Token}} options
 * @returns {{range: number|null, itemName: string}|null}
 */
function getTeleportInfo({ sourceToken }) {
    const actor = sourceToken?.actor;
    const recent = actor ? recentActivities.get(actor.uuid) : null;
    if (!recent || (Date.now() - recent.time > RECENT_ACTIVITY_MS)) return null;
    const { activity } = recent;
    const range = getTeleportRange(activity);
    debug(`Teleport Targeting: "${activity.item?.name}" → range ${range ?? "none"}`);
    return { range, itemName: activity.item?.name || activity.name || null };
}

/**
 * The teleport distance of an activity in scene units, or null when unknown or unlimited.
 * @param {Activity} activity
 * @returns {number|null}
 */
function getTeleportRange(activity) {
    const item = activity?.item;
    const teleportActivity = (activity?.type === "teleport")
        ? activity
        : item?.system?.activities?.find?.(a => a.type === "teleport");
    if (teleportActivity) {
        const { value, units } = teleportActivity.teleport ?? {};
        if (!Number.isFinite(value)) return null;
        if (value > 0) return toSceneUnits(value, units);
    }

    // Older items: "teleport up to 30 feet" in the description
    const text = (item?.system?.description?.value ?? "").replace(/<[^>]*>/g, " ");
    for (const pattern of DESCRIPTION_PATTERNS) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = Number(match[1].replace(",", "."));
        const unit = /^(m|meter|metern|meters|metres?)$/i.test(match[2]) ? "m" : "ft";
        if (value > 0) return toSceneUnits(value, unit);
    }
    return null;
}

/**
 * Convert a length into the scene's grid units with dnd5e's conversion (signature changed in 6.1).
 * @param {number} value
 * @param {string} units
 * @returns {number}
 */
function toSceneUnits(value, units) {
    const sceneUnits = canvas.grid?.units;
    if (!units || !sceneUnits || (units === sceneUnits)) return value;
    const movementUnits = CONFIG.DND5E?.movementUnits ?? {};
    if (!(units in movementUnits) || !(sceneUnits in movementUnits)) return value;
    const convert = globalThis.dnd5e?.utils?.convertLength;
    if (typeof convert !== "function") return value;
    return convert(value, units, { to: sceneUnits, legacy: false }).value;
}

/* -------------------------------------------- */
/*  Native Teleport activity                    */
/* -------------------------------------------- */

/**
 * Hook: dnd5e.preTeleport. With one token, pick the destination with core's HUD instead of dnd5e's drag planning.
 * @param {TeleportActivity} activity
 * @param {{maxDistance: number, tokens: Token[]}} config
 * @returns {boolean|void} false to skip dnd5e's planning.
 */
function onPreTeleport(activity, config) {
    if (bypassPreTeleport) return;
    const api = teleportApi();
    if (!api?.isActive()) return;
    const tokens = config?.tokens ?? [];
    if (tokens.length !== 1) return;
    const [token] = tokens;
    // Let dnd5e / Foundry show their own warnings for these
    if (!token?.document?.isOwner || token.document.locked || (game.paused && !game.user.isGM)) return;
    if (token.document.hidden && !game.user.isGM) return;

    runTeleport(activity, token, config.maxDistance);
    return false;
}

/**
 * Pick the destination and move the token like dnd5e's planned teleport would.
 * @param {TeleportActivity} activity
 * @param {Token} token
 * @param {number} maxDistance - In scene units, Infinity for no limit.
 */
async function runTeleport(activity, token, maxDistance) {
    const placement = await teleportApi()?.pickDestination({
        sourceToken: token,
        itemName: activity.item?.name || activity.name || "Teleport",
        range: Number.isFinite(maxDistance) ? maxDistance : null,
        checkCollision: false
    });

    // The picker couldn't start: run dnd5e's own planning
    if (placement === undefined) {
        bypassPreTeleport = true;
        try {
            await activity.planTeleport();
        } finally {
            bypassPreTeleport = false;
        }
        return;
    }
    if (!placement) return;

    const doc = token.document;
    const origin = { x: doc.x, y: doc.y, elevation: doc.elevation, width: doc.width, height: doc.height };
    const waypoint = { x: placement.x, y: placement.y, elevation: doc.elevation, action: "blink", snapped: true };
    const plan = { id: null, origin, destination: { ...origin, x: placement.x, y: placement.y }, waypoints: [waypoint] };
    const plans = [{ token, plan }];

    // Same hooks as dnd5e's TeleportActivity#planTeleport
    if (Hooks.call("dnd5e.teleport", activity, plans) === false) return;
    let moved = false;
    try {
        moved = await doc.move([waypoint]);
    } catch (err) {
        console.error(`${MODULE_ID} | Teleport movement failed: ${err?.message || err}`);
    }
    Hooks.callAll("dnd5e.postTeleport", activity, [{ token, plan, moved }]);
}
