/**
 * Mount a hosted embed into an element you own.
 *
 * How: a <script> for `<api>/embed/<kind>.js` is appended INSIDE the target
 * element. The hosted scripts render next to themselves (`script.parentNode`),
 * so the embed lands exactly in that element without a global selector — two
 * embeds on one page, or one per route in an SPA, never collide.
 *
 * A browser runs every inserted <script> element, even for a URL it has
 * already run (the bytes come from cache), so re-mounting after a prop change
 * or route change is just "clear, insert again".
 *
 * Nothing here touches `window`/`document` at import time: every function is
 * a no-op returning an inert handle when called during SSR.
 */
import {
  type EmbedKind,
  type OptionsFor,
  type CommentsOptions,
  type WidgetOptions,
  type ChangelogOptions,
  resolveTheme,
  scriptAttributes,
  scriptUrl,
} from './options.js';

export interface EmbedHandle<K extends EmbedKind = EmbedKind> {
  readonly kind: K;
  readonly element: Element | null;
  /** Re-render with new options (merged over the current ones). */
  update(next: Partial<OptionsFor<K>>): void;
  /** Remove the embed and everything it rendered. */
  unmount(): void;
}

interface Mounted {
  kind: EmbedKind;
  opts: OptionsFor<EmbedKind>;
  stopThemeWatch?: () => void;
}

const MARK = 'data-forumulate-embed';
const mounted = new WeakMap<Element, Mounted>();

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function inert<K extends EmbedKind>(kind: K): EmbedHandle<K> {
  return { kind, element: null, update() {}, unmount() {} };
}

function render(el: Element, state: Mounted): void {
  // Clear what the previous script rendered — the box it appended is a sibling
  // of the script, inside `el`, so emptying `el` takes both.
  el.replaceChildren();
  const opts = { ...state.opts, theme: resolveTheme(state.opts.theme) };
  const script = document.createElement('script');
  script.src = scriptUrl(state.kind, opts.apiBase);
  script.async = true;
  for (const [k, v] of Object.entries(scriptAttributes(state.kind, opts))) {
    script.setAttribute(k, v);
  }
  if (opts.nonce) script.nonce = opts.nonce;
  if (opts.onLoad) script.addEventListener('load', () => opts.onLoad?.());
  script.addEventListener('error', () =>
    opts.onError?.(new Error(`[forumulate] could not load ${script.src}`)),
  );
  el.setAttribute(MARK, state.kind);
  el.appendChild(script);
}

function watchTheme(el: Element, state: Mounted): (() => void) | undefined {
  if (state.opts.theme !== 'auto' || typeof matchMedia !== 'function') return undefined;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (mounted.get(el) === state) render(el, state);
  };
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

/** Mount `kind` into `el`, replacing whatever Forumulate embed was there. */
export function mount<K extends EmbedKind>(
  kind: K,
  el: Element | null | undefined,
  opts: OptionsFor<K>,
): EmbedHandle<K> {
  if (!isBrowser() || !el) return inert(kind);
  if (!opts.org || !opts.space) {
    throw new Error(`[forumulate] ${kind} needs both \`org\` and \`space\``);
  }
  unmount(el);
  const state: Mounted = { kind, opts: { ...opts } };
  mounted.set(el, state);
  render(el, state);
  state.stopThemeWatch = watchTheme(el, state);
  return {
    kind,
    element: el,
    update(next) {
      if (mounted.get(el) !== state) return;
      state.stopThemeWatch?.();
      state.opts = { ...state.opts, ...next } as OptionsFor<EmbedKind>;
      render(el, state);
      state.stopThemeWatch = watchTheme(el, state);
    },
    unmount() {
      if (mounted.get(el) === state) unmount(el);
    },
  };
}

/** Remove a Forumulate embed from `el` (no-op when there is none). */
export function unmount(el: Element | null | undefined): void {
  if (!el) return;
  const state = mounted.get(el);
  if (!state) return;
  state.stopThemeWatch?.();
  mounted.delete(el);
  el.replaceChildren();
  el.removeAttribute(MARK);
}

/** Embedded comment thread for the current page (or a given topic). */
export function mountComments(
  el: Element | null | undefined,
  opts: CommentsOptions,
): EmbedHandle<'comments'> {
  return mount('comments', el, opts);
}

/** Search box (or ask-AI box with `mode: 'ask'`) over a docs space. */
export function mountWidget(
  el: Element | null | undefined,
  opts: WidgetOptions,
): EmbedHandle<'widget'> {
  return mount('widget', el, opts);
}

/** "What's new" bell with an unread badge and a popover of releases. */
export function mountChangelog(
  el: Element | null | undefined,
  opts: ChangelogOptions,
): EmbedHandle<'changelog'> {
  return mount('changelog', el, opts);
}
