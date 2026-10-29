/**
 * Feature: Item Drag Between Actors
 * Description: Makes dragging inventory items from one actor's sheet to another (e.g. character to group) move them
 * by default instead of copying, falling back to copy whenever a move isn't allowed.
 *
 * @introduced v14.53.0
 * @updated v14.56.1 (Open container windows follow the same move rules and quantity prompt)
 */
import { debug, getSetting } from "../../main.js";
import { patchMethod } from "../../utils/patch-helper.js";

/**
 * Background
 * ---------------------------------------------------------------------------
 * D&D 5e decides between move and copy in `DragDropApplicationMixin#_dropBehavior`:
 * the dnd5e "dragMove" (Shift / Cmd) and "dragCopy" (Ctrl / Alt) keybindings force a
 * behavior, otherwise `BaseActorSheet#_defaultDropBehavior` returns "move" only when
 * the item already belongs to the sheet's actor, and "copy" for everything else.
 * On drop, `_onDropCreateItems` creates the item on the target and, for "move",
 * deletes the source item and its contents.
 *
 * This patch turns that default "copy" into "move" for inventory items dragged
 * between two different actors. Keybindings still win. Copy is kept whenever a move
 * would not be allowed or would lose data:
 *  - the item isn't embedded in an actor (sidebar / compendium items), or comes from
 *    a compendium or locked collection;
 *  - the item has no quantity (spells, features, classes): spells dropped on an
 *    inventory tab become scrolls and advancement items open the advancement flow,
 *    and "move" would delete the source in both cases;
 *  - the user can't delete the source item or doesn't own the target actor;
 *  - the sheet doesn't allow "move" (`_allowedDropBehaviors`);
 *  - the source is an NPC and the setting is "moveExceptNPC" (NPC items are converted
 *    to gear on drop, so looting keeps the NPC's stat block intact).
 */

/**
 * Quantity prompt
 * ---------------------------------------------------------------------------
 * dnd5e always transfers the whole stack. When a stack of more than one item is moved
 * to a different actor (by default or with the dragMove keybinding), the user is asked
 * how many to move. The full amount runs dnd5e's normal move. A smaller amount runs
 * dnd5e's copy flow with a clone carrying that quantity (so consumable stacking, NPC
 * gear conversion and container handling still apply) and then lowers the source
 * quantity instead of deleting it. Covered drop paths: `_onDropCreateItems` (sheet
 * body, group member rows) and `_onDropItemContainer` (container icons). Containers
 * are not split, since their contents can't be divided.
 */

/**
 * Container windows
 * ---------------------------------------------------------------------------
 * An open container's own sheet (`ContainerSheet`, an item sheet) decides through
 * `ItemSheet5e#_defaultDropBehavior`, which is "move" within the same actor and "copy"
 * between actors, and handles drops in its own `_onDropItem`. Both are patched with the
 * same rules as the actor sheet, the target being the actor that owns the container.
 * Containers in the sidebar or a compendium keep dnd5e's behavior. dnd5e's
 * `_onDropItem` fetches the item from the drop data itself, so a partial move recreates
 * its "create inside this container" step with the reduced clone.
 */

const SHEET_PATH = "dnd5e.applications.actor.BaseActorSheet.prototype";
const CONTAINER_PATH = "dnd5e.applications.item.ContainerSheet.prototype";

export function initActorItemDragBehavior() {
    const proto = dnd5e?.applications?.actor?.BaseActorSheet?.prototype;
    if (typeof proto?._defaultDropBehavior !== "function") {
        debug("BaseActorSheet._defaultDropBehavior not found, skipping item drag behavior patch.");
        return;
    }
    patchMethod(`${SHEET_PATH}._defaultDropBehavior`, _patchedDefaultDropBehavior, "WRAPPER");
    if (typeof proto._onDropCreateItems === "function") {
        patchMethod(`${SHEET_PATH}._onDropCreateItems`, _patchedOnDropCreateItems, "MIXED");
    }
    if (typeof proto._onDropItemContainer === "function") {
        patchMethod(`${SHEET_PATH}._onDropItemContainer`, _patchedOnDropItemContainer, "MIXED");
    }
    const containerProto = dnd5e.applications.item?.ContainerSheet?.prototype;
    if (typeof containerProto?._defaultDropBehavior === "function") {
        patchMethod(`${CONTAINER_PATH}._defaultDropBehavior`, _patchedContainerDefaultDropBehavior, "WRAPPER");
    }
    if (typeof containerProto?._onDropItem === "function") {
        patchMethod(`${CONTAINER_PATH}._onDropItem`, _patchedContainerOnDropItem, "MIXED");
    }
    debug("Initialized item drag behavior patch.");
}

function _patchedDefaultDropBehavior(wrapped, event, data, ...args) {
    const behavior = wrapped(event, data, ...args);
    if (behavior !== "copy") return behavior;
    try {
        return _shouldMove(this, event, data) ? "move" : behavior;
    } catch (err) {
        debug("Item drag behavior check failed, keeping copy.", err);
        return behavior;
    }
}

/**
 * Whether a default "copy" drop of this data onto the sheet should be a move instead.
 * @param {ActorSheet} sheet
 * @param {DragEvent} event
 * @param {object} data      The drag payload
 * @returns {boolean}
 */
function _shouldMove(sheet, event, data) {
    return _shouldMoveTo(sheet, event, data, _resolveTargetActor(sheet, event));
}

/**
 * Whether a default "copy" drop of this data should move the item to the given actor instead.
 * @param {Application} sheet  The sheet receiving the drop (actor or container sheet)
 * @param {DragEvent} event
 * @param {object} data        The drag payload
 * @param {Actor|null} targetActor
 * @returns {boolean}
 */
function _shouldMoveTo(sheet, event, data, targetActor) {
    const mode = getSetting("actorItemDragBehavior");
    if (mode === "copy") return false;
    if ((data?.type !== "Item") || !data.uuid) return false;

    const item = fromUuidSync(data.uuid);
    const source = item?.parent;
    if (!(item instanceof Item) || !(source instanceof Actor)) return false;
    if (item.pack || item.collection?.locked) return false;
    if (!("quantity" in (item.system ?? {}))) return false;

    if (!(targetActor instanceof Actor) || (targetActor === source) || (targetActor.uuid === source.uuid)) return false;
    if (!targetActor.isOwner) return false;

    if ((mode === "moveExceptNPC") && source.system?.isNPC) return false;
    if (!item.canUserModify(game.user, "delete")) return false;
    if (!sheet._allowedDropBehaviors(event, data).has("move")) return false;
    return true;
}

async function _patchedOnDropCreateItems(wrapped, event, items, behavior, ...args) {
    if ((behavior ?? event?._behavior) !== "move" || (items?.length !== 1)) {
        return wrapped(event, items, behavior, ...args);
    }
    const item = items[0];
    if (!_isSplittableMove(this, item)) return wrapped(event, items, behavior, ...args);

    const quantity = await _promptQuantity(item, this.inventorySource.name);
    if (!quantity) return;
    if (quantity >= item.system.quantity) return wrapped(event, items, behavior, ...args);

    const created = await wrapped(event, [item.clone({ "system.quantity": quantity })], "copy", ...args);
    await _reduceSource(item, quantity);
    return created;
}

async function _patchedOnDropItemContainer(wrapped, event, item, container, ...args) {
    if ((event?._behavior !== "move") || !_isSplittableMove(this, item)) {
        return wrapped(event, item, container, ...args);
    }

    const quantity = await _promptQuantity(item, this.inventorySource.name);
    if (!quantity) return;
    if (quantity >= item.system.quantity) return wrapped(event, item, container, ...args);

    event._behavior = "copy";
    const created = await wrapped(event, item.clone({ "system.quantity": quantity }), container, ...args);
    await _reduceSource(item, quantity);
    return created;
}

function _patchedContainerDefaultDropBehavior(wrapped, event, data, ...args) {
    const behavior = wrapped(event, data, ...args);
    if (behavior !== "copy") return behavior;
    try {
        return _shouldMoveTo(this, event, data, this.item?.actor ?? null) ? "move" : behavior;
    } catch (err) {
        debug("Container drag behavior check failed, keeping copy.", err);
        return behavior;
    }
}

async function _patchedContainerOnDropItem(wrapped, event, data, ...args) {
    const container = this.item;
    const target = container?.actor;
    if (!target || (data?.type !== "Item") || (this._dropBehavior(event, data) !== "move")) {
        return wrapped(event, data, ...args);
    }
    let item = await Item.implementation.fromDropData(data);
    if (!_isSplittableMove(this, item, target)) return wrapped(event, data, ...args);
    if (!container.isOwner || !(await container.system.canDropContents())) return false;

    const quantity = await _promptQuantity(item, `${container.name} (${target.name})`);
    if (!quantity) return false;
    if (quantity >= item.system.quantity) return wrapped(event, data, ...args);

    // Mirrors ContainerSheet#_onDropItem's copy path, with the reduced clone
    const source = item;
    item = item.clone({ "system.quantity": quantity });
    if (item.actor?.system.isNPC && item.system.asGear) item = await item.system.asGear();
    const toCreate = await Item.implementation.createWithContents([item], {
        container,
        transformAll: (itemData, options) => this._onDropSingleItem(itemData, { ...options, event })
    });
    if (container.folder) toCreate.forEach(d => d.folder = container.folder.id);
    const created = await Item.implementation.createDocuments(toCreate, {
        pack: container.pack, parent: target, keepId: true
    });
    await _reduceSource(source, quantity);
    return created;
}

/**
 * Whether a move of this item should ask how many to move.
 * @param {Application} sheet  The receiving sheet (unsupported item types are checked on actor sheets)
 * @param {Item} item
 * @param {Actor} [target]     The receiving actor, defaults to the sheet's inventory source
 * @returns {boolean}
 */
function _isSplittableMove(sheet, item, target = sheet.inventorySource) {
    const source = item?.parent;
    if (!(item instanceof Item) || !(source instanceof Actor) || !target) return false;
    if ((source === target) || (source.uuid === target.uuid)) return false;
    if (item.type === "container") return false;
    if (sheet.constructor.unsupportedItemTypes?.has(item.type)) return false;
    const quantity = Number(item.system?.quantity);
    return Number.isInteger(quantity) && (quantity > 1);
}

/**
 * Ask how many items of a stack to move.
 * @param {Item} item
 * @param {string} targetName  Name of the receiving actor or container
 * @returns {Promise<number|null>}  The quantity to move, or null if cancelled
 */
async function _promptQuantity(item, targetName) {
    const max = item.system.quantity;
    const esc = foundry.utils.escapeHTML;
    const content = `
        <p>Move how many <strong>${esc(item.name)}</strong> from ${esc(item.parent.name)} to ${esc(targetName)}?</p>
        <div class="form-group">
            <label>Quantity</label>
            <div class="form-fields">
                <range-picker name="quantity" value="${max}" min="1" max="${max}" step="1"></range-picker>
            </div>
        </div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Move Items", icon: "fa-solid fa-boxes-stacked" },
        position: { width: 400 },
        content,
        ok: {
            label: "Move",
            icon: "fa-solid fa-arrow-right-arrow-left",
            callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object.quantity
        },
        rejectClose: false
    });
    const quantity = Math.clamp(Math.floor(Number(result)), 0, max);
    return Number.isFinite(quantity) && (quantity > 0) ? quantity : null;
}

/**
 * Remove the moved amount from the source stack.
 * @param {Item} item
 * @param {number} quantity
 */
async function _reduceSource(item, quantity) {
    const source = item.parent?.items.get(item.id);
    if (!source) return;
    const remaining = source.system.quantity - quantity;
    if (remaining > 0) await source.update({ "system.quantity": remaining });
    else await source.delete();
}

/**
 * The actor the item will be created on. Group sheets hand drops onto a member row to that member's sheet.
 * @param {ActorSheet} sheet
 * @param {DragEvent} event
 * @returns {Actor|null}
 */
function _resolveTargetActor(sheet, event) {
    const { uuid } = event?.target?.closest?.("[data-uuid]")?.dataset ?? {};
    if (uuid && (sheet.actor?.type === "group")) {
        const member = fromUuidSync(uuid);
        if (member instanceof Actor) return member;
    }
    return sheet.inventorySource ?? sheet.actor ?? null;
}
