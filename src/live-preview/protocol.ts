/**
 * The live-preview message protocol (headless CMS spec 5, L2/L3): what the
 * studio and the customer's site, framed inside it, say to each other.
 *
 *   site → studio   `fm-ready`   the bridge is running at `path` (the handshake)
 *   studio → site   `fm-live`    the entry as the editor's unsaved draft serves
 *   studio → site   `fm-saved`   the draft was saved (refresh-on-save sites re-read)
 *   site → studio   `fm-select`  an editor double-clicked a field on the page
 *
 * Every type is `fm-` prefixed: a site's own iframes, analytics and chat
 * widgets post messages too, and a bare `ready` is somebody else's as often as
 * ours. Every message carries `v` so a newer studio can tell an older bridge.
 *
 * Pure: parsing and origin checks only, no DOM, so both sides (the bridge in
 * the site, the studio in the console) share one reading of the wire.
 */

export const PROTOCOL_VERSION = 1;

/** Where an element's value lives: the entry, the field as a pointer (`/blocks/@k3f9a/heading`), the locale. */
export interface FieldSource {
  entryId: string;
  path: string;
  locale?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReadyMessage {
  type: 'fm-ready';
  v: number;
  /** The page's path, so the studio can tell a navigation inside the frame. */
  path: string;
}

export interface SelectMessage extends FieldSource {
  type: 'fm-select';
  v: number;
  /** The element's box in the frame's viewport, for the studio to point at. */
  rect: Rect;
}

export interface LiveMessage {
  type: 'fm-live';
  v: number;
  entryId: string;
  locale?: string;
  /** The entry exactly as a preview read serves it, with the unsaved draft resolved (`…/entries/:id/resolve`). */
  entry: Record<string, unknown>;
}

export interface SavedMessage {
  type: 'fm-saved';
  v: number;
  entryId: string;
}

export type SiteMessage = ReadyMessage | SelectMessage;
export type StudioMessage = LiveMessage | SavedMessage;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A field pointer as the wire carries it: `/key`, nested keys, rows as `@<id>` — never a position. */
export function isFieldPointer(path: unknown): path is string {
  return isStr(path) && path.startsWith('/') && !/\/(\d+|-)?(\/|$)/.test(path);
}

function rectOf(v: unknown): Rect | null {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.width) || !isNum(v.height)) return null;
  return { x: v.x, y: v.y, width: v.width, height: v.height };
}

/** A message the site sent, or null for anything else that arrived on `message`. */
export function parseSiteMessage(data: unknown): SiteMessage | null {
  if (!isObj(data) || !isNum(data.v)) return null;
  if (data.type === 'fm-ready') return isStr(data.path) ? { type: 'fm-ready', v: data.v, path: data.path } : null;
  if (data.type === 'fm-select') {
    const rect = rectOf(data.rect);
    if (!isStr(data.entryId, 64) || !isFieldPointer(data.path) || !rect) return null;
    if (data.locale !== undefined && !isStr(data.locale, 35)) return null;
    return {
      type: 'fm-select',
      v: data.v,
      entryId: data.entryId,
      path: data.path,
      ...(typeof data.locale === 'string' ? { locale: data.locale } : {}),
      rect,
    };
  }
  return null;
}

/** A message the studio sent, or null for anything else. */
export function parseStudioMessage(data: unknown): StudioMessage | null {
  if (!isObj(data) || !isNum(data.v) || !isStr(data.entryId, 64)) return null;
  if (data.type === 'fm-saved') return { type: 'fm-saved', v: data.v, entryId: data.entryId };
  if (data.type === 'fm-live') {
    if (!isObj(data.entry) || data.entry.id !== data.entryId) return null;
    if (data.locale !== undefined && !isStr(data.locale, 35)) return null;
    return {
      type: 'fm-live',
      v: data.v,
      entryId: data.entryId,
      ...(typeof data.locale === 'string' ? { locale: data.locale } : {}),
      entry: data.entry,
    };
  }
  return null;
}

/**
 * The canonical origin of `raw` (scheme, host, port), or null. The bridge is
 * configured with the studio's origin, and a stray path or trailing slash
 * would otherwise never equal `event.origin` — failing closed, but silently.
 */
export function originOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Origin pinning: a message counts only when it came from the window we talk
 * to (`source`) AND from an origin we trust. Either check alone is not enough
 * — a frame can be navigated to another origin under the same window, and any
 * page can post from a trusted origin's window it opened.
 */
export function isTrusted(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  expectedSource: unknown,
  allowed: (origin: string) => boolean,
): boolean {
  return expectedSource != null && event.source === expectedSource && allowed(event.origin);
}

/** The `data-fm-field` value (`<entryId>:<pointer>`) as a source, or null. */
export function parseFieldAttr(value: string | null | undefined): FieldSource | null {
  if (!value) return null;
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const entryId = value.slice(0, at);
  const path = value.slice(at + 1);
  return isStr(entryId, 64) && isFieldPointer(path) ? { entryId, path } : null;
}
