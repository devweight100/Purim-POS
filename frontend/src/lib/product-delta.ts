/**
 * POS catalogue delta sync (GET /products/sync): the first call (and any call the server cannot answer with a
 * delta) returns every product; later calls return only the products changed since the cursor plus the ids of
 * deleted ones. These helpers merge such a delta into a list kept in memory.
 */

/** Body of GET /products/sync. */
export interface ProductSyncResponse<T> {
  /** pass back as ?since= on the next call */
  cursor: string;
  /** true: `products` is the whole catalogue (replace); false: only the changed products */
  full: boolean;
  products: T[];
  deleted: string[];
}

/**
 * The list after a delta: changed products replace the old ones in place, new products are appended, deleted ones
 * are removed. Returns `current` itself when nothing changed (no re-render for an empty delta).
 */
export function mergeProductDelta<T extends { id: string }>(current: T[], changed: T[], deleted: string[]): T[] {
  if (!changed.length && !deleted.length) return current;
  const gone = new Set(deleted);
  const incoming = new Map(changed.map((p) => [p.id, p]));
  const out: T[] = [];
  for (const p of current) {
    if (gone.has(p.id)) continue;
    const next = incoming.get(p.id);
    if (next) {
      out.push(next);
      incoming.delete(p.id);
    } else {
      out.push(p);
    }
  }
  for (const p of incoming.values()) if (!gone.has(p.id)) out.push(p);
  return out;
}

/** The `since` to send: the stored cursor only when it belongs to the same login and the list was not cleared. */
export function syncSince(state: { cursor: string | null; cursorKey: string | null; count: number; fromOfflineCache: boolean }, key: string | null): string | undefined {
  if (!state.cursor || !key || state.cursorKey !== key || state.count === 0 || state.fromOfflineCache) return undefined;
  return state.cursor;
}
