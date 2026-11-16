/**
 * Feature: NPC Spellcasting Builder
 * Description: A builder window for the 2024 "Spellcasting" monster feature. Pick spells per frequency (At Will,
 * 3/Day Each, 2/Day Each, 1/Day Each), and it writes the feature the way the 2025 Monster Manual does: one Cast
 * activity per spell (with X/Day uses), and the matching description text with live save DC lookups.
 * Opens from the NPC sheet's header menu, or from the sheet of an existing Spellcasting feature to edit it.
 *
 * @introduced v14.98.0
 */
import { MODULE_ID, log, debug, getSetting } from "../../context.js";

const FLAG = "spellcastingBuilder";
const TEMPLATE = `modules/${MODULE_ID}/templates/spellcasting-builder.hbs`;
const DEFAULT_IMG = "icons/magic/symbols/circled-gem-pink.webp";
/** Frequency groups always shown: 0 = At Will, otherwise uses per day. */
const DEFAULT_GROUPS = [0, 3, 2, 1];
const COMPONENTS = ["vocal", "somatic", "material"];
/** Key of the i18n "Requires" phrase for each set of ignored components. */
const COMPONENT_KEYS = { vocal: "v", somatic: "s", material: "m" };
const DRAG_TYPE = "nd5t-spell-row";
const I18N = "ND5T.SpellcastingBuilder";

let _hookId = null;

export function initNpcSpellcastingBuilder() {
    if (!getSetting("enableNpcSpellcastingBuilder")) return;
    if (_hookId === null) _hookId = Hooks.on("getHeaderControlsDocumentSheetV2", _onGetHeaderControls);
    log("NPC Spellcasting Builder enabled");
}

export function disableNpcSpellcastingBuilder() {
    if (_hookId !== null) {
        Hooks.off("getHeaderControlsDocumentSheetV2", _hookId);
        _hookId = null;
    }
    for (const app of foundry.applications.instances.values()) {
        if (app instanceof SpellcastingBuilder) app.close();
    }
}

/**
 * Open the builder for an NPC. Edits the given feature, or the actor's first Spellcasting feature, or creates one.
 * @param {Actor5e} actor
 * @param {Item5e} [item]
 */
export function openSpellcastingBuilder(actor, item) {
    if (!actor || actor.type !== "npc") return;
    item ??= findSpellcastingFeature(actor);
    const id = `nd5t-spellcasting-builder-${actor.id}-${item?.id ?? "new"}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.render({ force: true });
    return new SpellcastingBuilder({ id, actor, item }).render({ force: true });
}

/**
 * The actor's Spellcasting feature: built by this feature, or identifier "spellcasting" with Cast activities.
 * @param {Actor5e} actor
 * @returns {Item5e|undefined}
 */
function findSpellcastingFeature(actor) {
    const feats = actor.items.filter(i => i.type === "feat");
    return feats.find(i => i.getFlag(MODULE_ID, FLAG))
        ?? feats.find(i => (i.system.identifier === "spellcasting") && i.system.activities?.getByType("cast").length);
}

/**
 * Whether a feature looks like a Spellcasting feature the builder can edit.
 * @param {Item5e} item
 * @returns {boolean}
 */
function isSpellcastingFeature(item) {
    if (item?.type !== "feat" || item.actor?.type !== "npc") return false;
    if (item.getFlag(MODULE_ID, FLAG)) return true;
    return (item.system.identifier === "spellcasting") || (item.system.activities?.getByType("cast").length > 0
        && /spellcasting/i.test(item.name));
}

/* -------------------------------------------- */
/*  Header controls                             */
/* -------------------------------------------- */

function _onGetHeaderControls(app, controls) {
    if (!getSetting("enableNpcSpellcastingBuilder")) return;
    const doc = app.document;
    if (!doc || !app.isEditable) return;

    let actor;
    let item;
    if (doc.documentName === "Actor" && doc.type === "npc") actor = doc;
    else if (doc.documentName === "Item" && isSpellcastingFeature(doc)) {
        actor = doc.actor;
        item = doc;
    }
    if (!actor || controls.some(c => c.action === "nd5tSpellcastingBuilder")) return;

    controls.push({
        action: "nd5tSpellcastingBuilder",
        icon: "fa-solid fa-wand-sparkles",
        label: `${I18N}.Title`,
        onClick: () => openSpellcastingBuilder(actor, item)
    });
}

/* -------------------------------------------- */
/*  Description text                            */
/* -------------------------------------------- */

/**
 * The label of a frequency group, e.g. "At Will", "2/Day Each", "1/Day".
 * @param {number} group
 * @param {number} count  Number of spells in the group
 * @returns {string}
 */
function groupLabel(group, count) {
    if (!group) return game.i18n.localize(`${I18N}.Text.AtWill`);
    return game.i18n.format(`${I18N}.Text.${count > 1 ? "PerDayEach" : "PerDay"}`, { n: group });
}

/**
 * Build the feature description in the 2024 Monster Manual format.
 * @param {object} state  Builder state
 * @returns {string}
 */
export function buildDescription(state) {
    const esc = foundry.utils.escapeHTML;
    const ignored = COMPONENTS.filter(c => state.ignored.has(c));
    const requirements = ignored.length
        ? game.i18n.localize(`${I18N}.Text.Requires.${ignored.map(c => COMPONENT_KEYS[c]).join("")}`)
        : "";
    const challenge = [];
    if (state.showSaveDC) challenge.push(game.i18n.format(`${I18N}.Text.SaveDC`,
        { dc: "[[lookup @attributes.spell.dc]]" }));
    if (state.showAttack) challenge.push(game.i18n.format(`${I18N}.Text.Attack`,
        { attack: "+[[lookup @attributes.spell.attack]]" }));
    const intro = game.i18n.format(`${I18N}.Text.Intro`, {
        requirements,
        ability: CONFIG.DND5E.abilities[state.ability]?.label ?? state.ability,
        challenge: challenge.length ? ` (${challenge.join(", ")})` : ""
    });

    const lines = [`<p class="feature">${intro}</p>`];
    for (const group of sortedGroups(state)) {
        const spells = state.spells.filter(s => s.group === group).sort(compareSpells);
        if (!spells.length) continue;
        const entries = spells.map(s => {
            let text = `<em>@UUID[${s.uuid}]{${esc(s.name)}}</em>`;
            if (s.baseLevel > 0 && s.castLevel > s.baseLevel) {
                text += ` (${game.i18n.format(`${I18N}.Text.Upcast`, { level: s.castLevel })})`;
            }
            if (s.note?.trim()) text += ` (${esc(s.note.trim().replace(/^\((.*)\)$/, "$1"))})`;
            return text;
        });
        lines.push(`<p class="feature-trait"><strong>${groupLabel(group, spells.length)}:</strong> ${entries.join(", ")}</p>`);
    }
    return lines.join("");
}

function compareSpells(a, b) {
    return a.name.localeCompare(b.name, game.i18n.lang);
}

/**
 * Groups in display order: At Will first, then most uses per day first.
 * @param {object} state
 * @returns {number[]}
 */
function sortedGroups(state) {
    const groups = new Set([...DEFAULT_GROUPS, ...state.spells.map(s => s.group)]);
    return [...groups].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a));
}

/* -------------------------------------------- */
/*  Reading an existing feature                 */
/* -------------------------------------------- */

/**
 * Read the note written after a spell link in an existing description, e.g. "(included in AC)".
 * The upcast note "(level N version)" is dropped: it comes from the cast level.
 * @param {string} html
 * @param {string} uuid
 * @returns {string}
 */
function parseNote(html, uuid) {
    if (!html || !uuid) return "";
    const pattern = new RegExp(`@UUID\\[${RegExp.escape(uuid)}\\](?:\\{[^}]*\\})?(?:</em>)?((?:\\s*\\([^)]*\\))*)`);
    const match = html.match(pattern);
    if (!match?.[1]) return "";
    return [...match[1].matchAll(/\(([^)]*)\)/g)]
        .map(m => m[1].trim())
        .filter(n => n && !/^level \d+ version$/i.test(n))
        .join(", ");
}

/**
 * Find the spellcasting ability named in an existing description ("using Wisdom as the spellcasting ability").
 * @param {string} html
 * @returns {string|null}
 */
function parseAbility(html) {
    const name = html?.match(/using (\w+) as the spellcasting ability/i)?.[1]?.toLowerCase();
    if (!name) return null;
    return Object.entries(CONFIG.DND5E.abilities)
        .find(([key, cfg]) => (key === name) || (cfg.label?.toLowerCase() === name) || (cfg.fullKey === name))?.[0]
        ?? null;
}

/**
 * Builder state for an existing feature (or a fresh one).
 * @param {Actor5e} actor
 * @param {Item5e} [item]
 * @returns {Promise<object>}
 */
async function loadState(actor, item) {
    const actorAbility = actor.system.attributes?.spellcasting || "";
    const state = {
        name: item?.name ?? game.i18n.localize(`${I18N}.DefaultName`),
        ability: actorAbility || "int",
        ignored: new Set(["material"]),
        showSaveDC: true,
        showAttack: false,
        spells: []
    };
    if (!item) return state;

    const flag = item.getFlag(MODULE_ID, FLAG) ?? {};
    const html = item.system.description?.value ?? "";
    const casts = item.system.activities?.getByType("cast") ?? [];

    state.ability = flag.ability ?? parseAbility(html) ?? state.ability;
    state.showSaveDC = flag.showSaveDC ?? (flag.ability ? true : /spell save DC/i.test(html));
    state.showAttack = flag.showAttack ?? /to hit with spell attacks/i.test(html);
    if (casts.length) state.ignored = new Set([...(casts[0].spell.properties ?? [])].filter(p => COMPONENTS.includes(p)));

    for (const activity of casts) {
        const uuid = activity.spell.uuid;
        const spell = (uuid && await fromUuid(uuid).catch(() => null)) ?? activity.cachedSpell;
        const baseLevel = spell?.system?.level ?? 0;
        const max = parseInt(activity.uses?.max);
        state.spells.push({
            key: foundry.utils.randomID(),
            activityId: activity.id,
            uuid,
            name: spell?.name ?? activity.name,
            img: spell?.img ?? activity.img,
            baseLevel,
            castLevel: Math.max(baseLevel, activity.spell.level ?? baseLevel),
            // Ignored properties other than components (e.g. Concentration on a dragon's Shapechange) stay per spell
            extraProperties: [...(activity.spell.properties ?? [])].filter(p => !COMPONENTS.includes(p)),
            note: flag.notes?.[activity.id] ?? parseNote(html, uuid),
            group: Number.isFinite(max) && max > 0 ? max : 0,
            missing: !spell
        });
    }
    return state;
}

/* -------------------------------------------- */
/*  Builder application                         */
/* -------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class SpellcastingBuilder extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor({ actor, item, ...options } = {}) {
        super(options);
        this.actor = actor;
        this.item = item ?? null;
        this.spellState = null;
    }

    static DEFAULT_OPTIONS = {
        classes: ["nd5t-spellcasting-builder"],
        tag: "form",
        window: {
            icon: "fa-solid fa-wand-sparkles",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: { width: 760, height: 760 },
        form: {
            handler: SpellcastingBuilder.#onSubmit,
            closeOnSubmit: true,
            submitOnChange: false
        },
        actions: {
            browse: SpellcastingBuilder.#onBrowse,
            removeSpell: SpellcastingBuilder.#onRemoveSpell,
            openSpell: SpellcastingBuilder.#onOpenSpell
        }
    };

    static PARTS = {
        // "": the part root (.nd5t-scb-body) is what scrolls
        form: { template: TEMPLATE, scrollable: [""] },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    get title() {
        return `${game.i18n.localize(`${I18N}.Title`)}: ${this.actor.name}`;
    }

    /** @override */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        this.spellState ??= await loadState(this.actor, this.item);
        const state = this.spellState;

        const groups = sortedGroups(state);
        const frequencyChoices = groups.map(g => ({ value: g, label: groupLabel(g, 2) }));
        const levels = CONFIG.DND5E.spellLevels;

        context.name = state.name;
        context.abilities = Object.entries(CONFIG.DND5E.abilities).map(([key, cfg]) => ({
            value: key, label: cfg.label, selected: key === state.ability
        }));
        context.components = COMPONENTS.map(key => ({
            key, label: CONFIG.DND5E.itemProperties[key]?.label ?? key, checked: state.ignored.has(key)
        }));
        context.showSaveDC = state.showSaveDC;
        context.showAttack = state.showAttack;
        context.groups = groups.map(group => ({
            group,
            label: groupLabel(group, 2),
            spells: state.spells.filter(s => s.group === group).sort(compareSpells).map(s => ({
                ...s,
                levelLabel: levels[s.baseLevel] ?? "",
                upcast: s.baseLevel > 0,
                levelOptions: s.baseLevel > 0
                    ? Array.fromRange(10 - s.baseLevel, s.baseLevel).map(l => ({
                        value: l, label: levels[l], selected: l === s.castLevel
                    }))
                    : [],
                frequencyOptions: frequencyChoices.map(c => ({ ...c, selected: c.value === group }))
            }))
        }));
        context.preview = await this.#enrichPreview();
        context.footerHint = game.i18n.localize(`${I18N}.${this.item ? "RebuildHint" : "CreateHint"}`);
        context.buttons = [{
            type: "submit",
            icon: "fa-solid fa-floppy-disk",
            label: `${I18N}.${this.item ? "Update" : "Create"}`
        }];
        return context;
    }

    async #enrichPreview() {
        const html = buildDescription(this.spellState);
        // Show the DC and attack bonus of the ability picked here (saved to the actor only on submit),
        // calculated as in dnd5e's prepareSpellcastingAbility
        const rollData = this.actor.getRollData();
        const ability = this.actor.system.abilities?.[this.spellState.ability];
        if (ability) rollData.attributes = {
            ...rollData.attributes,
            spell: { ...rollData.attributes?.spell, dc: ability.dc, attack: ability.attack?.value ?? ability.mod }
        };
        return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {
            rollData,
            relativeTo: this.actor
        });
    }

    async #refreshPreview() {
        const target = this.element?.querySelector(".nd5t-scb-preview-content");
        if (target) target.innerHTML = await this.#enrichPreview();
    }

    /** @override */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        // The root element stays across renders: bind these once
        this.element.addEventListener("input", this.#onInput.bind(this));
        this.element.addEventListener("change", this.#onChange.bind(this));
    }

    /** @override */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        for (const zone of html.querySelectorAll(".nd5t-scb-group")) {
            zone.addEventListener("dragover", event => {
                event.preventDefault();
                zone.classList.add("drag-over");
            });
            zone.addEventListener("dragleave", event => {
                if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
            });
            zone.addEventListener("drop", event => {
                zone.classList.remove("drag-over");
                this.#onDrop(event, Number(zone.dataset.group));
            });
        }
        for (const row of html.querySelectorAll(".nd5t-scb-spell[draggable]")) {
            row.addEventListener("dragstart", event => {
                event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, key: row.dataset.key }));
            });
        }
    }

    #spellFor(element) {
        const key = element.closest("[data-key]")?.dataset.key;
        return this.spellState.spells.find(s => s.key === key);
    }

    /** Text fields: update the state and the preview without re-rendering (keeps focus). */
    #onInput(event) {
        const el = event.target;
        if (el.name === "name") this.spellState.name = el.value;
        else if (el.dataset.field === "note") {
            const spell = this.#spellFor(el);
            if (spell) spell.note = el.value;
        } else return;
        this.#refreshPreview();
    }

    #onChange(event) {
        const el = event.target;
        const state = this.spellState;
        let rerender = false;
        switch (el.name || el.dataset.field) {
            case "ability": state.ability = el.value; break;
            case "showSaveDC": state.showSaveDC = el.checked; break;
            case "showAttack": state.showAttack = el.checked; break;
            case "ignored":
                if (el.checked) state.ignored.add(el.value);
                else state.ignored.delete(el.value);
                break;
            case "castLevel": {
                const spell = this.#spellFor(el);
                if (spell) spell.castLevel = Number(el.value);
                break;
            }
            case "group": {
                const spell = this.#spellFor(el);
                if (spell) spell.group = Number(el.value);
                rerender = true;
                break;
            }
            default: return;
        }
        if (rerender) this.render();
        else this.#refreshPreview();
    }

    async #onDrop(event, group) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch {
            data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        }
        if (data?.type === DRAG_TYPE) {
            const spell = this.spellState.spells.find(s => s.key === data.key);
            if (spell && spell.group !== group) {
                spell.group = group;
                this.render();
            }
            return;
        }
        if (data?.type === "Folder") {
            const folder = await fromUuid(data.uuid);
            const uuids = (folder?.contents ?? []).filter(d => d.type === "spell").map(d => d.uuid);
            return this.#addSpells(uuids, group);
        }
        if (data?.type !== "Item" || !data.uuid) return;
        return this.#addSpells([data.uuid], group);
    }

    /**
     * Add spells to a group. Spells of the NPC itself are linked to their compendium source when they have one.
     * @param {string[]} uuids
     * @param {number} group
     */
    async #addSpells(uuids, group) {
        let added = 0;
        for (const uuid of uuids) {
            const doc = await fromUuid(uuid);
            if (doc?.type !== "spell") {
                ui.notifications.warn(`${I18N}.NotASpell`, { localize: true });
                continue;
            }
            const source = doc.isEmbedded ? (doc._stats?.compendiumSource ?? doc.uuid) : doc.uuid;
            if (this.spellState.spells.some(s => s.uuid === source)) continue;
            const baseLevel = doc.system.level ?? 0;
            this.spellState.spells.push({
                key: foundry.utils.randomID(),
                activityId: null,
                uuid: source,
                name: doc.name,
                img: doc.img,
                baseLevel,
                castLevel: baseLevel,
                note: "",
                group
            });
            added++;
        }
        if (added) this.render();
    }

    static async #onBrowse(event, target) {
        const group = Number(target.closest("[data-group]")?.dataset.group ?? 0);
        const Browser = dnd5e.applications.CompendiumBrowser;
        const result = await Browser.select({
            filters: { locked: { documentClass: "Item", types: new Set(["spell"]) } },
            selection: { min: 1 }
        });
        if (result?.size) await this.#addSpells([...result], group);
    }

    static #onRemoveSpell(event, target) {
        const spell = this.#spellFor(target);
        if (!spell) return;
        this.spellState.spells.findSplice(s => s === spell);
        this.render();
    }

    static async #onOpenSpell(event, target) {
        const spell = this.#spellFor(target);
        const doc = spell?.uuid && await fromUuid(spell.uuid);
        doc?.sheet?.render(true);
    }

    static async #onSubmit() {
        const state = this.spellState;
        // Thrown errors are shown as a notification and keep the window open
        if (!state.spells.length) throw new Error(game.i18n.localize(`${I18N}.NoSpells`));
        await saveSpellcasting(this.actor, this.item, state);
    }
}

/* -------------------------------------------- */
/*  Saving                                      */
/* -------------------------------------------- */

/**
 * Cast activity data for one spell, as the 2025 Monster Manual builds it.
 * @param {object} spell     Builder spell entry
 * @param {string[]} ignored Ignored components
 * @param {Activity} [existing]
 * @returns {object}
 */
function castActivityData(spell, ignored, existing) {
    const perDay = spell.group > 0;
    const max = perDay ? String(spell.group) : "";
    const data = {
        consumption: {
            scaling: { allowed: false },
            spellSlot: true,
            targets: perDay ? [{ type: "activityUses", value: "1", scaling: {} }] : []
        },
        uses: {
            spent: existing && (existing.uses?.max === max) ? (existing.uses.spent ?? 0) : 0,
            max,
            recovery: perDay ? [{ period: "day", type: "recoverAll" }] : []
        },
        spell: {
            uuid: spell.uuid,
            level: spell.baseLevel > 0 ? spell.castLevel : null,
            properties: [...ignored, ...(spell.extraProperties ?? [])],
            spellbook: true
        }
    };
    if (!existing) Object.assign(data, {
        _id: spell.activityId,
        type: "cast",
        sort: 0,
        activation: { type: "action", value: null, override: false }
    });
    return data;
}

/**
 * Create or update the Spellcasting feature, and set the NPC's spellcasting ability.
 * @param {Actor5e} actor
 * @param {Item5e|null} item
 * @param {object} state
 */
async function saveSpellcasting(actor, item, state) {
    const ignored = COMPONENTS.filter(c => state.ignored.has(c));
    const activities = {};
    const notes = {};
    const kept = new Set();

    for (const spell of state.spells) {
        const existing = spell.activityId ? item?.system.activities.get(spell.activityId) : null;
        if (!existing) spell.activityId = foundry.utils.randomID();
        kept.add(spell.activityId);
        activities[spell.activityId] = castActivityData(spell, ignored, existing);
        // Empty notes are stored too: flags merge on update, so a missing key would keep an old note
        notes[spell.activityId] = spell.note?.trim() ?? "";
    }
    for (const activity of item?.system.activities.getByType("cast") ?? []) {
        if (!kept.has(activity.id)) activities[activity.id] = _del;
    }

    const flag = { ability: state.ability, showSaveDC: state.showSaveDC, showAttack: state.showAttack, notes };
    const name = state.name?.trim() || game.i18n.localize(`${I18N}.DefaultName`);
    const description = buildDescription(state);

    if (item) {
        await item.update({
            name,
            "system.description.value": description,
            "system.activities": activities,
            [`flags.${MODULE_ID}.${FLAG}`]: flag
        });
        ui.notifications.info(game.i18n.format(`${I18N}.Updated`, { name, actor: actor.name }));
    } else {
        await actor.createEmbeddedDocuments("Item", [{
            name,
            type: "feat",
            img: DEFAULT_IMG,
            system: {
                type: { value: "monster", subtype: "" },
                identifier: name.slugify({ strict: true }) || "spellcasting",
                source: { rules: "2024" },
                description: { value: description },
                activities
            },
            flags: { [MODULE_ID]: { [FLAG]: flag } }
        }]);
        ui.notifications.info(game.i18n.format(`${I18N}.Created`, { name, actor: actor.name }));
    }

    if (actor.system.attributes?.spellcasting !== state.ability) {
        await actor.update({ "system.attributes.spellcasting": state.ability });
    }
    debug(`Spellcasting Builder saved "${name}" on ${actor.name}`, { activities, flag });
}
