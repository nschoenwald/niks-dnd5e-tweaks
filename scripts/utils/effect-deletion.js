/**
 * Utility: Safe Effect Deletion
 * Description: Deletes Active Effects without failing when some of them were removed meanwhile, e.g. by dnd5e's
 *              expiry handling, another client, or an earlier call that is still in flight.
 *
 * @introduced v14.114.1
 */

/** Effects this client is deleting right now, as `<parent uuid>.<effect id>`. */
const _inFlight = new Set();

/**
 * Was this error caused by an effect that no longer exists? Core throws it in English on every language.
 * @param {Error} err
 * @returns {boolean}
 */
function _isMissing(err) {
    return /does not exist/i.test(err?.message ?? String(err ?? ""));
}

/**
 * Delete Active Effects of an actor or item, skipping ids that are gone or already being deleted by this client.
 * If one of them disappears while the request runs, the rest are deleted in a second attempt.
 * @param {Actor|Item} parent
 * @param {string[]} ids
 * @returns {Promise<ActiveEffect[]>}  The deleted effects.
 */
export async function deleteEffects(parent, ids) {
    const collection = parent?.effects;
    if (!collection || !ids?.length) return [];
    const key = id => `${parent.uuid}.${id}`;
    const targets = [...new Set(ids)].filter(id => collection.has(id) && !_inFlight.has(key(id)));
    if (!targets.length) return [];
    for (const id of targets) _inFlight.add(key(id));
    try {
        return await parent.deleteEmbeddedDocuments("ActiveEffect", targets);
    } catch (err) {
        if (!_isMissing(err)) throw err;
        const left = targets.filter(id => collection.has(id));
        if (!left.length) return [];
        try {
            return await parent.deleteEmbeddedDocuments("ActiveEffect", left);
        } catch (retryErr) {
            if (!_isMissing(retryErr)) throw retryErr;
            return [];
        }
    } finally {
        for (const id of targets) _inFlight.delete(key(id));
    }
}

/**
 * Delete one Active Effect, tolerating that it was removed meanwhile.
 * @param {ActiveEffect} effect
 * @returns {Promise<boolean>}  Whether this call deleted it.
 */
export async function deleteEffect(effect) {
    if (!effect?.parent || !effect.id) return false;
    return (await deleteEffects(effect.parent, [effect.id])).length > 0;
}
