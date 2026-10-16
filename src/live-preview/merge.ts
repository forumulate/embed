import type { LiveMessage } from './protocol.js';

/**
 * Client merge (spec 5 L2): the page's data with the studio's live entry laid
 * in wherever that entry appears.
 *
 * The entry being edited is usually the page itself, but it can also be a
 * referenced entry the page shows (an author card, a global's menu), or both
 * at once. So the merge walks the whole value and replaces EVERY delivery
 * entry whose `id` (and, when the message names one, `locale`) matches —
 * keeping its own `_links` and anything else the site's read added — and
 * leaves every other branch the identical object, so React re-renders only
 * what changed.
 *
 * Population depth is the studio's: the live entry arrives already resolved,
 * references populated as the preview read would populate them.
 */
export function applyLive<T>(value: T, message: Pick<LiveMessage, 'entryId' | 'locale' | 'entry'>): T {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return node;
    if (seen.has(node)) return node;
    seen.add(node);
    if (Array.isArray(node)) {
      let changed = false;
      const out = node.map((item) => {
        const next = visit(item);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : node;
    }
    const obj = node as Record<string, unknown>;
    if (isTarget(obj, message)) return { ...obj, ...message.entry };
    let out: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(obj)) {
      const next = visit(v);
      if (next !== v) (out ??= { ...obj })[k] = next;
    }
    return out ?? node;
  };
  return visit(value) as T;
}

/** A delivery entry (it has `id` and `fields`) that the message is about. */
function isTarget(obj: Record<string, unknown>, m: Pick<LiveMessage, 'entryId' | 'locale'>): boolean {
  if (obj.id !== m.entryId || typeof obj.fields !== 'object' || obj.fields === null) return false;
  return !m.locale || typeof obj.locale !== 'string' || obj.locale === m.locale;
}
