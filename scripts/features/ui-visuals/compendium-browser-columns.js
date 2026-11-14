/**
 * Feature: Compendium Browser Columns
 * Description: Adds type-specific columns to the D&D 5e Compendium Browser results (spell level, item rarity and price,
 * monster CR, background ability scores and feat, …) and makes every column header click-to-sort.
 *
 * @introduced v14.83.0
 * @updated v14.84.0 (Ability Scores column for feats)
 */
import { log } from "../../context.js";
import { patchMethod } from "../../utils/patch-helper.js";
import { isFeatureOnForUser } from "../../utils/personal-override.js";

/**
 * Compendium Browser Columns
 * ---------------------------------------------------------------------------
 * dnd5e's CompendiumBrowser (identical in 6.0.6 and 6.1.0) shows name, source and selection controls, and leaves a
 * "TODO: Display dynamic columns" in `templates/compendium/browser-entry.hbs`.
 *
 * - Data: the results come from the static `CompendiumBrowser.fetch()`, called from `_prepareResultsContext` with
 *   `indexFields: ["system.source"]` and the default `sort: "name"`. `_prepareResultsContext` is wrapped to mark the
 *   browser that is fetching (it calls `fetch` before its first await); the `fetch` wrapper takes that mark, adds the
 *   index fields the current column set needs and swaps in our comparator. `fetch` is also used elsewhere in dnd5e
 *   (advancements etc.), which never carry the mark and stay untouched.
 * - Sorting: the fetched results live in a private field (`#results`) and only the first batch of rows is in the DOM
 *   (more render on scroll), so a re-sort can't happen in place. A header click stores the sort per browser and
 *   column set, then re-renders the results part, which re-fetches and sorts inside `fetch` (the name search does
 *   the same re-fetch on every keystroke).
 * - Cells: `_renderResult` returns the row element; cells are inserted before the source cell. This also covers rows
 *   added while scrolling.
 * - Header: the results part template holds the header, so `_attachPartListeners("results")` re-decorates it after
 *   every results render. Name ("Results") and Source become sortable too.
 *
 * Values are read from the raw source data (index entries are raw; for full Documents `_source` is used), so the
 * comparator and the cells see the same shapes. Field paths verified against the PHB 2024 compendium data.
 */

const BROWSER_PATH = "dnd5e.applications.CompendiumBrowser";
const WORLD_KEY = "enableCompendiumBrowserColumns";
const CLIENT_KEY = "clientCompendiumBrowserColumns";

/** Browser whose `_prepareResultsContext` is currently calling `fetch`. */
let fetchingBrowser = null;

/** @type {WeakMap<ApplicationV2, Map<string, {key: string, dir: 1|-1}>>} Sort per browser and column set. */
const sortStates = new WeakMap();

const isOn = () => isFeatureOnForUser(WORLD_KEY, CLIENT_KEY);
const loc = key => game.i18n.localize(key);
const lang = () => game.i18n.lang;

/* -------------------------------------------- */
/*  Value helpers                               */
/* -------------------------------------------- */

/** Raw system data of an index entry or a full Document. */
function sys(entry) {
    return (entry instanceof foundry.abstract.DataModel ? entry._source?.system : entry.system) ?? {};
}

function abilityAbbr(key) {
    const abbr = CONFIG.DND5E.abilities[key]?.abbreviation;
    return abbr ? loc(abbr).capitalize() : key;
}

function toArray(value) {
    if (!value) return [];
    if (Array.isArray(value) || (value instanceof Set)) return [...value];
    return Object.values(value);
}

function advancements(entry) {
    return toArray(sys(entry).advancement);
}

/** Text cell content. */
const text = (value, tooltip) => ((value === null) || (value === undefined) || (value === ""))
    ? null
    : { text: String(value), tooltip };

/* -------------------------------------------- */
/*  Column definitions                          */
/* -------------------------------------------- */

/**
 * @typedef {object} BrowserColumn
 * @property {string} id
 * @property {string} label           Localization key of the header
 * @property {number} width           Cell width in px
 * @property {string[]} fields        Index fields the column reads
 * @property {(entry: object) => ({text?: string, icons?: object[], tooltip?: string}|null)} display
 * @property {(entry: object) => (number|string|null)} sort   null/"" sorts last in both directions
 */

const SPELL_COLUMNS = [
    {
        id: "spellLevel",
        label: "ND5T.CompendiumColumns.Level",
        width: 52,
        fields: ["system.level"],
        display: e => {
            const level = sys(e).level;
            if (!Number.isFinite(level)) return null;
            return text(level === 0 ? (CONFIG.DND5E.spellLevels?.[0] ?? "0") : level);
        },
        sort: e => (Number.isFinite(sys(e).level) ? sys(e).level : null)
    },
    {
        id: "spellSchool",
        label: "ND5T.CompendiumColumns.School",
        width: 90,
        fields: ["system.school"],
        display: e => {
            const school = sys(e).school;
            return text(school ? loc(CONFIG.DND5E.spellSchools[school]?.label ?? school) : null);
        },
        sort: e => {
            const school = sys(e).school;
            return school ? loc(CONFIG.DND5E.spellSchools[school]?.label ?? school) : null;
        }
    },
    {
        id: "spellTags",
        label: "ND5T.CompendiumColumns.ConcentrationRitual",
        headerIcons: ["concentration", "ritual"],
        width: 48,
        fields: ["system.properties"],
        display: e => {
            const props = new Set(toArray(sys(e).properties));
            const icons = ["concentration", "ritual"].filter(p => props.has(p)).map(p => ({
                src: CONFIG.DND5E.itemProperties[p]?.icon,
                label: loc(CONFIG.DND5E.itemProperties[p]?.label ?? p)
            }));
            return icons.length ? { icons } : null;
        },
        sort: e => {
            const props = new Set(toArray(sys(e).properties));
            const value = (props.has("concentration") ? 2 : 0) + (props.has("ritual") ? 1 : 0);
            return value || null;
        }
    }
];

const RARITY_ORDER = () => Object.keys(CONFIG.DND5E.itemRarity);

/** Price in gp, or null. */
function priceInGp(entry) {
    const price = sys(entry).price;
    const value = Number(price?.value);
    if (!value) return null;
    const conversion = CONFIG.DND5E.currencies[price.denomination]?.conversion || 1;
    return value / conversion;
}

/** Weight as { value, units }, accepting the pre-4.0 plain number. */
function weightOf(entry) {
    const weight = sys(entry).weight;
    if (typeof weight === "number") return { value: weight, units: "lb" };
    return { value: Number(weight?.value) || 0, units: weight?.units || "lb" };
}

const PHYSICAL_COLUMNS = [
    {
        id: "rarity",
        label: "ND5T.CompendiumColumns.Rarity",
        width: 92,
        fields: ["system.rarity", "system.attunement"],
        display: e => {
            const { rarity, attunement } = sys(e);
            const label = rarity ? loc(CONFIG.DND5E.itemRarity[rarity] ?? rarity) : "";
            const attune = (attunement === "required") || (attunement === 1);
            if (!label && !attune) return null;
            const cell = { text: label };
            if (attune) cell.icons = [{ fa: "fa-solid fa-sun", label: loc(CONFIG.DND5E.attunementTypes?.required ?? "DND5E.AttunementRequired") }];
            return cell;
        },
        sort: e => {
            const index = RARITY_ORDER().indexOf(sys(e).rarity);
            return index < 0 ? null : index;
        }
    },
    {
        id: "price",
        label: "ND5T.CompendiumColumns.Price",
        width: 72,
        fields: ["system.price"],
        display: e => {
            const price = sys(e).price;
            if (!Number(price?.value)) return null;
            const abbr = CONFIG.DND5E.currencies[price.denomination]?.abbreviation;
            return text(`${dnd5e.utils.formatNumber(Number(price.value))} ${abbr ? loc(abbr) : price.denomination}`);
        },
        sort: priceInGp
    },
    {
        id: "weight",
        label: "ND5T.CompendiumColumns.Weight",
        width: 60,
        fields: ["system.weight"],
        display: e => {
            const { value, units } = weightOf(e);
            if (!value) return null;
            return text(CONFIG.DND5E.weightUnits[units] ? dnd5e.utils.formatWeight(value, units) : `${value} ${units}`);
        },
        sort: e => {
            const { value, units } = weightOf(e);
            return value ? value * (CONFIG.DND5E.weightUnits[units]?.conversion || 1) : null;
        }
    }
];

function creatureTypeLabel(entry) {
    const type = sys(entry).details?.type;
    if (!type?.value) return null;
    if (type.value === "custom") return type.custom || null;
    return loc(CONFIG.DND5E.creatureTypes[type.value]?.label ?? type.value);
}

const MONSTER_COLUMNS = [
    {
        id: "cr",
        label: "ND5T.CompendiumColumns.CR",
        width: 40,
        fields: ["system.details.cr"],
        display: e => {
            const cr = sys(e).details?.cr;
            return Number.isFinite(cr) ? text(dnd5e.utils.formatCR(cr)) : null;
        },
        sort: e => {
            const cr = sys(e).details?.cr;
            return Number.isFinite(cr) ? cr : null;
        }
    },
    {
        id: "creatureType",
        label: "ND5T.CompendiumColumns.Type",
        width: 96,
        fields: ["system.details.type"],
        display: e => text(creatureTypeLabel(e)),
        sort: creatureTypeLabel
    }
];

/** Vehicle type: `system.details.type` since dnd5e 6.1, `system.vehicleType` before. */
function vehicleTypeLabel(entry) {
    const data = sys(entry);
    const type = (typeof data.details?.type === "string" ? data.details.type : null) || data.vehicleType;
    if (!type) return null;
    return loc(CONFIG.DND5E.vehicleTypes?.[type] ?? type);
}

const VEHICLE_COLUMNS = [
    {
        id: "vehicleType",
        label: "ND5T.CompendiumColumns.VehicleType",
        width: 84,
        fields: ["system.details.type", "system.vehicleType"],
        display: e => text(vehicleTypeLabel(e)),
        sort: vehicleTypeLabel
    }
];

function featCategoryLabel(entry) {
    const { value, subtype } = sys(entry).type ?? {};
    const config = CONFIG.DND5E.featureTypes[value];
    if (!config) return null;
    const label = (subtype && config.subtypes?.[subtype]) || (subtype ? null : config.label);
    return label ? loc(label) : (subtype || null);
}

const FEAT_COLUMNS = [
    {
        id: "featCategory",
        label: "ND5T.CompendiumColumns.Category",
        width: 96,
        fields: ["system.type"],
        display: e => text(featCategoryLabel(e)),
        sort: featCategoryLabel
    },
    {
        id: "featLevel",
        label: "ND5T.CompendiumColumns.FeatLevel",
        width: 52,
        fields: ["system.prerequisites"],
        display: e => {
            const level = sys(e).prerequisites?.level;
            return level ? text(`${level}+`) : null;
        },
        sort: e => sys(e).prerequisites?.level || null
    },
    {
        id: "featAbilities",
        label: "ND5T.CompendiumColumns.AbilityScores",
        width: 96,
        fields: ["system.advancement", "system.identifier"],
        display: e => text(abilityScoresLabel(e)),
        sort: abilityScoresSortKey
    }
];

const PROGRESSION_ORDER = ["full", "pact", "half", "artificer", "third"];

function spellcastingLabel(entry) {
    const progression = sys(entry).spellcasting?.progression;
    if (!progression || (progression === "none")) return null;
    return loc(CONFIG.DND5E.spellProgression?.[progression]?.label ?? progression);
}

function primaryAbilityLabel(entry) {
    const primary = sys(entry).primaryAbility;
    const abilities = toArray(primary?.value);
    if (!abilities.length) return null;
    const type = primary.all === false ? "disjunction" : "conjunction";
    return new Intl.ListFormat(lang(), { style: "short", type }).format(abilities.map(abilityAbbr));
}

const CLASS_COLUMNS = [
    {
        id: "hitDie",
        label: "ND5T.CompendiumColumns.HitDie",
        width: 48,
        fields: ["system.hd"],
        display: e => text(sys(e).hd?.denomination),
        sort: e => Number.parseInt(String(sys(e).hd?.denomination ?? "").replace(/^d/, "")) || null
    },
    {
        id: "spellcasting",
        label: "ND5T.CompendiumColumns.Spellcasting",
        width: 84,
        fields: ["system.spellcasting"],
        display: e => text(spellcastingLabel(e)),
        sort: e => {
            const progression = sys(e).spellcasting?.progression;
            if (!progression || (progression === "none")) return null;
            const index = PROGRESSION_ORDER.indexOf(progression);
            return index < 0 ? PROGRESSION_ORDER.length : index;
        }
    },
    {
        id: "primaryAbility",
        label: "ND5T.CompendiumColumns.PrimaryAbility",
        width: 84,
        fields: ["system.primaryAbility"],
        display: e => text(primaryAbilityLabel(e)),
        sort: primaryAbilityLabel
    }
];

function parentClassLabel(entry) {
    const identifier = sys(entry).classIdentifier;
    if (!identifier) return null;
    return dnd5e.registry?.classes?.get(identifier)?.name ?? identifier.capitalize();
}

const SUBCLASS_COLUMNS = [
    {
        id: "parentClass",
        label: "ND5T.CompendiumColumns.Class",
        width: 96,
        fields: ["system.classIdentifier"],
        display: e => text(parentClassLabel(e)),
        sort: parentClassLabel
    }
];

/**
 * The 2024 Ability Score Improvement feat has no ASI advancement of its own (dnd5e handles it in the class's ASI
 * advancement); it raises any ability.
 */
const ANY_ABILITY_FEATS = new Set(["ability-score-improvement"]);

/**
 * Abilities a background or feat improves. 2024 content uses an Ability Score Improvement advancement with `points`
 * and the non-eligible abilities in `locked` (Acolyte: points 3, locked str/dex/con → Int, Wis, Cha; Actor: points 1,
 * everything but cha locked → Cha); fixed bonuses are shown as "Str +1" (Great Weapon Master: fixed str 1, all locked).
 * All six eligible → "Any". Legacy backgrounds and most legacy feats have no such advancement.
 */
function abilityScoresLabel(entry) {
    if (ANY_ABILITY_FEATS.has(sys(entry).identifier)) return loc("ND5T.CompendiumColumns.AnyAbility");
    const parts = [];
    const allAbilities = Object.keys(CONFIG.DND5E.abilities);
    for (const adv of advancements(entry)) {
        if (adv?.type !== "AbilityScoreImprovement") continue;
        const config = adv.configuration ?? {};
        for (const [key, value] of Object.entries(config.fixed ?? {})) {
            if (value > 0) parts.push(`${abilityAbbr(key)} +${value}`);
        }
        if (config.points > 0) {
            const locked = new Set(toArray(config.locked));
            const eligible = allAbilities.filter(k => !locked.has(k));
            if (eligible.length === allAbilities.length) parts.push(loc("ND5T.CompendiumColumns.AnyAbility"));
            else parts.push(...eligible.map(abilityAbbr));
        }
    }
    return parts.length ? parts.join(", ") : null;
}

/**
 * Sort key in ability order (Str, Dex, Con, Int, Wis, Cha) rather than by the localized abbreviations, so
 * "Str, Dex, Con" comes before "Con, Int, Cha". One letter per ability index.
 */
function abilityScoresSortKey(entry) {
    const allAbilities = Object.keys(CONFIG.DND5E.abilities);
    if (ANY_ABILITY_FEATS.has(sys(entry).identifier)) return allAbilities.map((k, i) => String.fromCharCode(97 + i)).join("");
    const indices = new Set();
    for (const adv of advancements(entry)) {
        if (adv?.type !== "AbilityScoreImprovement") continue;
        const config = adv.configuration ?? {};
        for (const [key, value] of Object.entries(config.fixed ?? {})) {
            if (value > 0) indices.add(allAbilities.indexOf(key));
        }
        if (config.points > 0) {
            const locked = new Set(toArray(config.locked));
            allAbilities.forEach((k, i) => {
                if (!locked.has(k)) indices.add(i);
            });
        }
    }
    if (!indices.size) return null;
    return [...indices].filter(i => i >= 0).sort((a, b) => a - b).map(i => String.fromCharCode(97 + i)).join("");
}

/** Names of the feats a background grants (2024: the origin feat; legacy: the background feature). */
function backgroundFeatLabel(entry) {
    const names = [];
    for (const adv of advancements(entry)) {
        if (adv?.type !== "ItemGrant") continue;
        for (const item of toArray(adv.configuration?.items)) {
            const uuid = typeof item === "string" ? item : item?.uuid;
            if (!uuid) continue;
            let granted = null;
            try {
                granted = fromUuidSync(uuid, { strict: false });
            } catch {
                granted = null;
            }
            if (granted?.type === "feat") names.push(granted.name);
        }
    }
    return names.length ? names.join(", ") : null;
}

const BACKGROUND_COLUMNS = [
    {
        id: "backgroundAbilities",
        label: "ND5T.CompendiumColumns.AbilityScores",
        width: 96,
        fields: ["system.advancement"],
        display: e => text(abilityScoresLabel(e)),
        sort: abilityScoresSortKey
    },
    {
        id: "backgroundFeat",
        label: "ND5T.CompendiumColumns.Feat",
        width: 128,
        fields: ["system.advancement"],
        display: e => text(backgroundFeatLabel(e)),
        sort: backgroundFeatLabel
    }
];

/** Built-in columns of dnd5e that become sortable. */
const NAME_COLUMN = { id: "name", sort: e => e.name ?? "" };
const SOURCE_COLUMN = { id: "source", sort: e => e.system?.source?.value || null };

/* -------------------------------------------- */
/*  Column sets                                 */
/* -------------------------------------------- */

/** Physical item types, as dnd5e's "Items" tab uses them (plus the "physical" group key). */
function physicalTypes() {
    const types = new Set(["physical"]);
    try {
        const children = Item.implementation.compendiumBrowserTypes?.().physical?.children ?? {};
        Object.keys(children).forEach(t => types.add(t));
    } catch {
        // Fall through with the group key only.
    }
    return types;
}

const COLUMN_SETS = [
    { id: "spells", documentName: "Item", types: () => new Set(["spell"]), columns: SPELL_COLUMNS },
    { id: "physical", documentName: "Item", types: physicalTypes, columns: PHYSICAL_COLUMNS },
    { id: "feats", documentName: "Item", types: () => new Set(["feat"]), columns: FEAT_COLUMNS },
    { id: "classes", documentName: "Item", types: () => new Set(["class"]), columns: CLASS_COLUMNS },
    { id: "subclasses", documentName: "Item", types: () => new Set(["subclass"]), columns: SUBCLASS_COLUMNS },
    { id: "backgrounds", documentName: "Item", types: () => new Set(["background"]), columns: BACKGROUND_COLUMNS },
    { id: "monsters", documentName: "Actor", types: () => new Set(["npc"]), columns: MONSTER_COLUMNS },
    { id: "vehicles", documentName: "Actor", types: () => new Set(["vehicle"]), columns: VEHICLE_COLUMNS }
];

/**
 * The column set for the browser's current filters: the one whose types contain every selected type. Mixed or empty
 * type selections (advanced mode with everything) get no extra columns.
 * @param {string} documentName
 * @param {Set<string>|string[]} types
 * @returns {object|null}
 */
function getColumnSet(documentName, types) {
    const selected = toArray(types instanceof Set || Array.isArray(types) ? types : Object.keys(types ?? {}));
    if (!selected.length) return null;
    return COLUMN_SETS.find(set => {
        if (set.documentName !== documentName) return false;
        const allowed = set.types();
        return selected.every(t => allowed.has(t));
    }) ?? null;
}

function documentNameOf(documentClass) {
    if (typeof documentClass === "string") return documentClass;
    return documentClass?.documentName ?? documentClass?.metadata?.name ?? null;
}

function getSortState(app, set) {
    return sortStates.get(app)?.get(set?.id ?? "none") ?? null;
}

function setSortState(app, set, state) {
    let states = sortStates.get(app);
    if (!states) sortStates.set(app, states = new Map());
    states.set(set?.id ?? "none", state);
}

function findColumn(set, key) {
    if (key === "name") return NAME_COLUMN;
    if (key === "source") return SOURCE_COLUMN;
    return set?.columns.find(c => c.id === key) ?? null;
}

/**
 * Comparator for `fetch`'s `sort` option. Empty values sort last in both directions; ties fall back to the name.
 */
function makeComparator(column, dir) {
    const collator = new Intl.Collator(lang(), { numeric: true, sensitivity: "base" });
    const cache = new Map();
    const valueOf = entry => {
        if (!cache.has(entry)) {
            let value = null;
            try {
                value = column.sort(entry);
            } catch {
                value = null;
            }
            cache.set(entry, value);
        }
        return cache.get(entry);
    };
    const byName = (a, b) => collator.compare(String(a.name ?? ""), String(b.name ?? ""));
    return (a, b) => {
        const va = valueOf(a);
        const vb = valueOf(b);
        const emptyA = (va === null) || (va === undefined) || (va === "");
        const emptyB = (vb === null) || (vb === undefined) || (vb === "");
        if (emptyA || emptyB) return (emptyA === emptyB) ? byName(a, b) : (emptyA ? 1 : -1);
        const cmp = ((typeof va === "number") && (typeof vb === "number")) ? (va - vb) : collator.compare(String(va), String(vb));
        return cmp ? cmp * dir : byName(a, b);
    };
}

/* -------------------------------------------- */
/*  DOM                                         */
/* -------------------------------------------- */

function buildIcon(icon) {
    let el;
    if (icon.src) {
        el = document.createElement("dnd5e-icon");
        el.setAttribute("src", icon.src);
    } else {
        el = document.createElement("i");
        el.className = icon.fa;
    }
    el.classList.add("nd5t-cbc-icon");
    if (icon.label) {
        el.dataset.tooltip = icon.label;
        el.setAttribute("aria-label", icon.label);
    }
    return el;
}

function buildCell(column, entry) {
    const cell = document.createElement("div");
    cell.className = "item-detail nd5t-cbc-cell";
    cell.dataset.column = column.id;
    cell.style.setProperty("--nd5t-cbc-width", `${column.width}px`);
    let content = null;
    try {
        content = column.display(entry);
    } catch (err) {
        console.warn(`niks-dnd5e-tweaks | Compendium Browser Columns: ${column.id} failed for ${entry?.uuid}`, err);
    }
    if (!content) {
        cell.classList.add("empty");
        return cell;
    }
    if (content.text) {
        const span = document.createElement("span");
        span.className = "condensed nd5t-cbc-text";
        span.textContent = content.text;
        // Long values get ellipsed by CSS; show the full value on hover
        if (content.tooltip || (content.text.length > 14)) span.dataset.tooltip = content.tooltip ?? content.text;
        cell.append(span);
    }
    for (const icon of content.icons ?? []) cell.append(buildIcon(icon));
    return cell;
}

function insertCells(element, set, entry) {
    const row = element.querySelector(".item-row");
    if (!row || row.querySelector(".nd5t-cbc-cell")) return;
    const anchor = row.querySelector(":scope > .item-source");
    const cells = set.columns.map(column => buildCell(column, entry));
    if (anchor) anchor.before(...cells);
    else row.querySelector(":scope > .item-name")?.after(...cells);
}

function sortIndicator(state, key) {
    const icon = document.createElement("i");
    icon.className = "nd5t-cbc-sort-icon fa-solid";
    if (state?.key === key) icon.classList.add(state.dir === 1 ? "fa-caret-up" : "fa-caret-down");
    else icon.classList.add("fa-sort", "inactive");
    icon.inert = true;
    return icon;
}

function makeSortable(app, set, header, key, label) {
    const state = getSortState(app, set) ?? { key: "name", dir: 1 };
    header.classList.add("nd5t-cbc-sortable");
    header.classList.toggle("nd5t-cbc-sorted", state.key === key);
    header.dataset.nd5tSort = key;
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    header.setAttribute("aria-sort", state.key === key ? (state.dir === 1 ? "ascending" : "descending") : "none");
    if (label) header.dataset.tooltip = game.i18n.format("ND5T.CompendiumColumns.SortBy", { column: label });
    header.append(sortIndicator(state, key));
    const activate = event => {
        event.preventDefault();
        event.stopPropagation();
        const current = getSortState(app, set) ?? { key: "name", dir: 1 };
        const dir = current.key === key ? -current.dir : 1;
        setSortState(app, set, { key, dir });
        app.render({ parts: ["results"] });
    };
    header.addEventListener("click", activate);
    header.addEventListener("keydown", event => {
        if ((event.key === "Enter") || (event.key === " ")) activate(event);
    });
}

function decorateHeader(app, htmlElement) {
    const header = htmlElement.querySelector(".items-header");
    if (!header || header.querySelector(".nd5t-cbc-sortable")) return;
    const { documentClass, types } = app.currentFilters;
    const set = getColumnSet(documentClass, types);

    const nameHeader = header.querySelector(":scope > .item-name");
    const sourceHeader = header.querySelector(":scope > .item-source");

    if (set) {
        const cells = set.columns.map(column => {
            const cell = document.createElement("div");
            cell.className = "item-header nd5t-cbc-header";
            cell.dataset.column = column.id;
            cell.style.setProperty("--nd5t-cbc-width", `${column.width}px`);
            const label = loc(column.label);
            if (column.headerIcons) {
                // Icon-only header for narrow icon columns
                for (const prop of column.headerIcons) {
                    const icon = buildIcon({ src: CONFIG.DND5E.itemProperties[prop]?.icon });
                    icon.inert = true;
                    cell.append(icon);
                }
                cell.setAttribute("aria-label", label);
            } else {
                const span = document.createElement("span");
                span.className = "nd5t-cbc-label";
                span.textContent = label;
                cell.append(span);
            }
            makeSortable(app, set, cell, column.id, label);
            return cell;
        });
        if (sourceHeader) sourceHeader.before(...cells);
        else nameHeader?.after(...cells);
    }

    if (nameHeader) makeSortable(app, set, nameHeader, "name", nameHeader.textContent.trim());
    if (sourceHeader) makeSortable(app, set, sourceHeader, "source", sourceHeader.textContent.trim());
}

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

export function initCompendiumBrowserColumns() {
    if (!foundry.utils.getProperty(globalThis, BROWSER_PATH)) {
        log("Compendium Browser Columns | dnd5e CompendiumBrowser not found, feature inactive.");
        return;
    }

    // Mark the browser that is about to call fetch(). dnd5e calls it before its first await, so the mark is consumed
    // synchronously; clearing it afterwards keeps other fetch() callers unaffected.
    patchMethod(`${BROWSER_PATH}.prototype._prepareResultsContext`, function nd5tPrepareResultsContext(wrapped, ...args) {
        fetchingBrowser = this;
        try {
            return wrapped(...args);
        } finally {
            fetchingBrowser = null;
        }
    }, "WRAPPER");

    patchMethod(`${BROWSER_PATH}.fetch`, function nd5tFetch(wrapped, documentClass, options = {}) {
        const app = fetchingBrowser;
        fetchingBrowser = null;
        if (!app) return wrapped(documentClass, options);
        try {
            if (!isOn()) return wrapped(documentClass, options);
            const set = getColumnSet(documentNameOf(documentClass), options.types);
            const next = { ...options };
            if (set) {
                next.indexFields = new Set([...(options.indexFields ?? []), ...set.columns.flatMap(c => c.fields)]);
            }
            const state = getSortState(app, set);
            const column = state ? findColumn(set, state.key) : null;
            if (column && !((state.key === "name") && (state.dir === 1))) next.sort = makeComparator(column, state.dir);
            return wrapped(documentClass, next);
        } catch (err) {
            console.error("niks-dnd5e-tweaks | Compendium Browser Columns: fetch wrapper failed", err);
            return wrapped(documentClass, options);
        }
    }, "WRAPPER");

    patchMethod(`${BROWSER_PATH}.prototype._renderResult`, async function nd5tRenderResult(wrapped, entry, documentClass, ...rest) {
        const element = await wrapped(entry, documentClass, ...rest);
        try {
            if (element && isOn()) {
                const set = getColumnSet(documentNameOf(documentClass), this.currentFilters.types);
                if (set) insertCells(element, set, entry);
            }
        } catch (err) {
            console.error("niks-dnd5e-tweaks | Compendium Browser Columns: row render failed", err);
        }
        return element;
    }, "WRAPPER");

    patchMethod(`${BROWSER_PATH}.prototype._attachPartListeners`, function nd5tAttachPartListeners(wrapped, partId, htmlElement, options) {
        const result = wrapped(partId, htmlElement, options);
        try {
            if ((partId === "results") && isOn()) decorateHeader(this, htmlElement);
        } catch (err) {
            console.error("niks-dnd5e-tweaks | Compendium Browser Columns: header render failed", err);
        }
        return result;
    }, "WRAPPER");

    log("Compendium Browser Columns | Patched CompendiumBrowser fetch, _prepareResultsContext, _renderResult and _attachPartListeners.");
}

/** Re-renders the results of open Compendium Browsers, e.g. after the setting changed. */
export function refreshCompendiumBrowsers() {
    const Browser = foundry.utils.getProperty(globalThis, BROWSER_PATH);
    if (!Browser) return;
    for (const app of foundry.applications.instances.values()) {
        if ((app instanceof Browser) && app.rendered) app.render({ parts: ["results"] });
    }
}
