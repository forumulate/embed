/**
 * A small in-process response cache keyed by URL and invalidated by tag.
 *
 * Next has a Data Cache that `revalidateTag` drops by tag; Astro, Nuxt and
 * SvelteKit have nothing equivalent built in. Without one, "revalidate on
 * publish" means nothing there: every render refetches, or a CDN holds pages
 * for a fixed TTL. So the server helpers cache published answers here, tagged
 * with the API's own `Cache-Tag`, and the revalidate receiver drops exactly
 * the tags a publish names.
 *
 * In-process means per instance: a fleet of servers each holds its own copy,
 * and a webhook reaches only the instance that receives it. The TTL bounds how
 * stale the others can be; pass `onRevalidate` to the receiver to fan a
 * publish out (or put a shared cache behind your own `TagCache`).
 */

export interface CachedResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

export interface TagCache {
  get(key: string): Promise<CachedResponse> | undefined;
  /**
   * Store a pending answer (single-flight: concurrent misses share it).
   * `tags` answers `null` while the answer is still in flight.
   */
  set(key: string, value: Promise<CachedResponse>, tags: () => string[] | null, ttlMs: number | null): void;
  /** Drop every entry carrying any of `tags`. Returns how many went. */
  invalidate(tags: string[]): number;
  clear(): void;
  readonly size: number;
}

interface Slot {
  value: Promise<CachedResponse>;
  tags: () => string[] | null;
  expires: number;
}

export function createTagCache(o: { max?: number; now?: () => number } = {}): TagCache {
  const max = o.max ?? 500;
  const now = o.now ?? Date.now;
  const slots = new Map<string, Slot>();
  return {
    get(key) {
      const slot = slots.get(key);
      if (!slot) return undefined;
      if (slot.expires <= now()) {
        slots.delete(key);
        return undefined;
      }
      // Re-insert: Map order is the LRU order.
      slots.delete(key);
      slots.set(key, slot);
      return slot.value;
    },
    set(key, value, tags, ttlMs) {
      slots.delete(key);
      slots.set(key, { value, tags, expires: ttlMs == null ? Infinity : now() + ttlMs });
      // A failed fetch must not be served from cache for the whole TTL.
      value.catch(() => slots.get(key)?.value === value && slots.delete(key));
      while (slots.size > max) slots.delete(slots.keys().next().value as string);
    },
    invalidate(tags) {
      const drop = new Set(tags);
      let n = 0;
      for (const [key, slot] of slots) {
        // An answer still in flight has no tags yet, and may have been read
        // before the publish that is invalidating now — so it goes too.
        const own = slot.tags();
        if (!own || own.some((t) => drop.has(t))) {
          slots.delete(key);
          n++;
        }
      }
      return n;
    },
    clear: () => slots.clear(),
    get size() {
      return slots.size;
    },
  };
}

/** The cache the server helpers and the receivers share unless given another. */
export const defaultTagCache: TagCache = createTagCache();
