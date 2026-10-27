/**
 * Feature: Magic Resistance Automation
 * Description: Grants Advantage on saving throws against spells and magical effects to creatures with
 * Magic Resistance (and similar features such as Spell Resistance or the Mantle of Spell Resistance).
 *
 * @introduced v14.50.0
 */
import { MODULE_ID, getSetting, debug } from "../../main.js";

/**
 * Magic Resistance
 *
 * dnd5e ships Magic Resistance as a description-only feat, and its Active Effect roll rules
 * cannot express "against spells" because their conditions only see the roller's own roll data.
 *
 * Implementation uses a single hook:
 *
 *  dnd5e.preRollSavingThrow — fires inside D20Roll.buildConfigure() before the roll dialog opens.
 *  Saves rolled from an activity card carry the source in the message data
 *  (`message.data.system.item` / `activity` / `origin`, see SaveActivity#rollSave). If the source is
 *  a spell or magical effect and the defender has a matching resistance feature, advantage is injected
 *  into the roll config. The system's own advantage/disadvantage resolver handles cancellation.
 */

/**
 * @typedef {object} MagicResistanceProfile
 * @property {"spell"|"magic"} scope     "spell" only covers spells, "magic" also covers magical effects.
 * @property {Set<string>|null} abilities Abilities the feature applies to, or null for all.
 * @property {string} name               Display name for debug output.
 */

/**
 * Known resistance features keyed by item identifier.
 * @type {Record<string, Omit<MagicResistanceProfile, "name">>}
 */
const KNOWN_IDENTIFIERS = {
    // Monsters (2014 & 2024 SRD), Yuan-ti Pureblood, Satyr
    "magic-resistance": { scope: "magic", abilities: null },
    // Wondrous item (2014 & 2024)
    "mantle-of-spell-resistance": { scope: "spell", abilities: null },
    // School of Abjuration, level 14 (2014 & 2024)
    "spell-resistance": { scope: "spell", abilities: null },
    // Gnome (2014) — the 2024 Gnomish Cunning has no magic condition
    "gnome-cunning": { scope: "magic", abilities: new Set(["int", "wis", "cha"]) }
};

/**
 * Name fallbacks for feats without an identifier (homebrew / imported statblocks).
 * @type {Array<[string, Omit<MagicResistanceProfile, "name">]>}
 */
const NAME_FALLBACKS = [
    ["magic resistance", KNOWN_IDENTIFIERS["magic-resistance"]],
    ["magieresistenz", KNOWN_IDENTIFIERS["magic-resistance"]],
    ["spell resistance", KNOWN_IDENTIFIERS["spell-resistance"]],
    ["zauberresistenz", KNOWN_IDENTIFIERS["spell-resistance"]]
];

/** Consumable subtypes that are always magical. */
const MAGICAL_CONSUMABLE_TYPES = new Set(["potion", "scroll", "wand", "rod"]);

// ── Defender detection ────────────────────────────────────────────────

/**
 * Whether a physical item currently grants its benefits (equipped and, if required, attuned).
 * Non-physical items (feats) are always active.
 * @param {Item5e} item
 * @returns {boolean}
 */
function _isItemActive(item) {
    const system = item.system ?? {};
    if (("equipped" in system) && !system.equipped) return false;
    if ((system.attunement === "required") && !system.attuned) return false;
    return true;
}

/**
 * Collect the magic resistance profiles of an actor.
 * Matches:
 *   - actor flag niks-dnd5e-tweaks.magicResistance (true / "magic" → spells & magical effects, "spell" → spells only)
 *   - item identifier from KNOWN_IDENTIFIERS (equipped & attuned for physical items)
 *   - feat name from NAME_FALLBACKS (case-insensitive)
 *
 * @param {Actor5e} actor
 * @returns {MagicResistanceProfile[]}
 */
function _getResistanceProfiles(actor) {
    const profiles = [];

    const flag = actor.getFlag?.(MODULE_ID, "magicResistance");
    if (flag) {
        profiles.push({ scope: flag === "spell" ? "spell" : "magic", abilities: null, name: "Magic Resistance (flag)" });
    }

    for (const item of actor.items ?? []) {
        const identifier = item.identifier ?? item.system?.identifier ?? "";
        let profile = KNOWN_IDENTIFIERS[identifier];
        if (!profile && (item.type === "feat")) {
            const name = (item.name ?? "").toLowerCase();
            profile = NAME_FALLBACKS.find(([fragment]) => name.includes(fragment))?.[1];
        }
        if (profile && _isItemActive(item)) profiles.push({ ...profile, name: item.name });
    }

    return profiles;
}

// ── Source detection ──────────────────────────────────────────────────

/**
 * Resolve the item and activity that caused the save from the roll's message configuration.
 * Falls back to the chat card containing the clicked button (inline [[/save]] enrichers).
 *
 * @param {object} config   Roll process configuration.
 * @param {object} message  Roll message configuration.
 * @returns {{ item: Item5e|null, itemType: string|null }}
 */
function _resolveSource(config, message) {
    const system = message?.data?.system ?? {};
    const safeFromUuid = uuid => {
        if (!uuid) return null;
        try {
            return fromUuidSync(uuid);
        } catch {
            return null;
        }
    };

    let item = safeFromUuid(system.item?.uuid);
    if (!item) item = safeFromUuid(system.activity?.uuid)?.item ?? null;

    if (!item && system.origin) {
        const origin = game.messages?.get(system.origin);
        item = origin?.getAssociatedItem?.() ?? null;
    }

    if (!item) {
        const cardId = config.event?.target?.closest?.("[data-message-id]")?.dataset.messageId;
        const card = cardId ? game.messages?.get(cardId) : null;
        item = card?.getAssociatedItem?.() ?? null;
    }

    // Spells cast through a Cast activity may not be resolvable, but the message sources keep their type
    return { item, itemType: item?.type ?? system.item?.type ?? null };
}

/**
 * Classify the source of a save.
 * @param {Item5e|null} item
 * @param {string|null} itemType
 * @returns {"spell"|"magicItem"|"magicFeature"|null}
 */
function _classifySource(item, itemType) {
    if (itemType === "spell") return "spell";
    if (!item) return null;

    const system = item.system ?? {};
    if ((item.type === "consumable") && MAGICAL_CONSUMABLE_TYPES.has(system.type?.value)) return "magicItem";
    if (system.properties?.has?.("mgc")) return item.type === "feat" ? "magicFeature" : "magicItem";
    return null;
}

/**
 * Whether a source category counts as magical under the configured scope setting.
 * @param {"spell"|"magicItem"|"magicFeature"} category
 * @returns {boolean}
 */
function _isCategoryEnabled(category) {
    const scope = getSetting("magicResistanceScope");
    if (category === "spell") return true;
    if (category === "magicItem") return scope !== "spells";
    return scope === "all";
}

// ── Saving throw hook ─────────────────────────────────────────────────

/**
 * dnd5e.preRollSavingThrow — fires before the roll dialog opens for any saving throw.
 *
 * @param {AbilityRollProcessConfiguration} config
 * @param {BasicRollDialogConfiguration}   _dialog
 * @param {BasicRollMessageConfiguration}  message
 */
function _onPreRollSavingThrow(config, _dialog, message) {
    try {
        if (!getSetting("enableMagicResistance")) return;
        if (game.modules.get("midi-qol")?.active) return;

        // Concentration saves are made against damage, not against the spell
        if (config.isConcentration || config.hookNames?.includes("concentration")) return;

        const actor = config.subject;
        if (!actor) return;

        const profiles = _getResistanceProfiles(actor)
            .filter(p => !p.abilities || p.abilities.has(config.ability));
        if (!profiles.length) return;

        const { item, itemType } = _resolveSource(config, message);
        const category = _classifySource(item, itemType);
        if (!category || !_isCategoryEnabled(category)) return;

        const profile = profiles.find(p => (p.scope === "magic") || (category === "spell"));
        if (!profile) return;

        debug(`Magic Resistance | ${actor.name} has ${profile.name} — granting advantage against ${item?.name ?? itemType} (${category})`);
        config.advantage = true;
        for (const roll of config.rolls ?? []) {
            roll.options ??= {};
            roll.options.advantage = true;
        }
    } catch (err) {
        console.error("Nik's DnD5e Tweaks | Error in _onPreRollSavingThrow for Magic Resistance:", err);
    }
}

// ── Init ──────────────────────────────────────────────────────────────

/**
 * Initialize the Magic Resistance feature.
 * Called once during the "setup" phase from main.js.
 */
export function initMagicResistance() {
    Hooks.on("dnd5e.preRollSavingThrow", _onPreRollSavingThrow);
    debug("Magic Resistance | Initialized");
}
