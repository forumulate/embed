import { originOf, parseStudioMessage, PROTOCOL_VERSION, type SiteMessage, type StudioMessage } from './protocol.js';
import { sourceAt } from './source.js';

export interface LivePreviewOptions {
  /**
   * The studio's origin (`https://forumulate.com`, or your console's custom
   * domain). The bridge talks to nothing else: it posts only to this origin,
   * and only hears messages from it, sent by the window that framed the page.
   */
  studioOrigin: string;
  /** Hover outlines and double-click to edit (spec 5 L3). On by default. */
  overlays?: boolean;
}

type Listener = (message: StudioMessage) => void;

interface Bridge {
  origin: string;
  listeners: Set<Listener>;
  stop: () => void;
}

let bridge: Bridge | null = null;

/**
 * Connect the page to the studio that frames it (spec 5 L2/L3) and hear its
 * live edits. Call it from every page that renders previewable content —
 * `useLivePreview` does — and call the returned function to stop listening.
 *
 * One bridge per window however many callers: the first call starts it
 * (message listener, overlays) and the last one to leave stops it. Each call
 * also re-announces `fm-ready` with the current path, so a client-side
 * navigation inside the frame tells the studio where it now is.
 *
 * A no-op outside a frame, on the server, or with an unusable origin: the
 * same component tree runs in production, where none of this may happen.
 */
export function connectLivePreview(options: LivePreviewOptions, listener?: Listener): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => {};
  const origin = originOf(options.studioOrigin);
  if (!origin) {
    console.warn('[forumulate] live preview: studioOrigin is not an http(s) origin:', options.studioOrigin);
    return () => {};
  }
  if (bridge && bridge.origin !== origin) bridge.stop();
  if (!bridge) bridge = start(origin, options.overlays !== false);
  const current = bridge;
  if (listener) current.listeners.add(listener);
  post(origin, { type: 'fm-ready', v: PROTOCOL_VERSION, path: location.pathname + location.search });
  return () => {
    if (listener) current.listeners.delete(listener);
    if (current.listeners.size === 0 && bridge === current) {
      current.stop();
      bridge = null;
    }
  };
}

function post(origin: string, message: SiteMessage): void {
  window.parent.postMessage(message, origin);
}

function start(origin: string, overlays: boolean): Bridge {
  const listeners = new Set<Listener>();
  const onMessage = (event: MessageEvent) => {
    // Pinned both ways: our parent window, at the studio's origin.
    if (event.source !== window.parent || event.origin !== origin) return;
    const message = parseStudioMessage(event.data);
    if (message) for (const l of listeners) l(message);
  };
  window.addEventListener('message', onMessage);
  const stopOverlays = overlays ? startOverlays(origin) : () => {};
  return {
    origin,
    listeners,
    stop: () => {
      window.removeEventListener('message', onMessage);
      stopOverlays();
    },
  };
}

/**
 * The outline under the pointer and double-click to edit. One fixed box that
 * never takes pointer events, so the site's own hover styles, links and
 * layout are untouched; it lives only while the page is framed by the studio.
 */
function startOverlays(origin: string): () => void {
  const box = document.createElement('div');
  box.setAttribute('data-fm-overlay', '');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2563eb;border-radius:3px;' +
    'box-shadow:0 0 0 1px rgba(255,255,255,.8);display:none;transition:all 60ms ease-out';
  document.body.appendChild(box);

  let frame = 0;
  const show = (el: Element | null) => {
    if (!el) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.left - 2}px`;
    box.style.top = `${r.top - 2}px`;
    box.style.width = `${r.width + 4}px`;
    box.style.height = `${r.height + 4}px`;
  };
  const onMove = (e: MouseEvent) => {
    const target = e.target as Element | null;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => show(sourceAt(target)?.el ?? null));
  };
  const onLeave = () => show(null);
  const onDblClick = (e: MouseEvent) => {
    const hit = sourceAt(e.target as Element | null);
    if (!hit) return;
    // The double-click is the studio's: no word selection, no site handler.
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    const r = hit.el.getBoundingClientRect();
    post(origin, {
      type: 'fm-select',
      v: PROTOCOL_VERSION,
      ...hit.source,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    });
  };
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave);
  window.addEventListener('scroll', onLeave, { passive: true });
  document.addEventListener('dblclick', onDblClick, true);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('scroll', onLeave);
    document.removeEventListener('dblclick', onDblClick, true);
    box.remove();
  };
}
