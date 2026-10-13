/**
 * The options every embed takes, and the one place they turn into the
 * `data-*` attributes the hosted scripts read.
 *
 * The scripts at `<api>/embed/*.js` are the source of truth for what an embed
 * looks like and does; this package never re-implements them. It only decides
 * WHICH script, with WHICH attributes, mounted WHERE — so a framework wrapper,
 * a custom element and a hand-written <script> tag all end up identical.
 */

/** `auto` follows the visitor's `prefers-color-scheme` and re-renders when it flips. */
export type Theme = 'light' | 'dark' | 'auto';

export type EmbedKind = 'comments' | 'widget' | 'changelog';

/** The public Forumulate API. Override for a custom domain (`https://docs.example.com/api`). */
export const DEFAULT_API_BASE = 'https://forumulate.com/api';

export interface EmbedOptions {
  /** Organization id or slug. */
  org: string;
  /** Space id or slug. */
  space: string;
  /** API origin including the `/api` prefix. Defaults to {@link DEFAULT_API_BASE}. */
  apiBase?: string;
  theme?: Theme;
  /** BCP 47 language for the embed's own labels (`en`, `de`, `fr`, `es`, `pt`, ...). */
  locale?: string;
  /** Accent colour (buttons, focus ring, links). Any CSS colour. */
  accent?: string;
  /** Corner radius. Any CSS length. */
  radius?: string;
  /** Max width. Any CSS length. */
  width?: string;
  /** CSS font-family. Defaults to the system stack. */
  font?: string;
  /** CSP nonce for the injected <script>, when your policy uses nonces. */
  nonce?: string;
  /** Called once the hosted script has loaded and run. */
  onLoad?: () => void;
  /** Called when the hosted script fails to load (network, CSP, ad blocker). */
  onError?: (error: Error) => void;
}

export interface CommentsOptions extends EmbedOptions {
  /**
   * Topic slug to show. Omit it and the thread is resolved (and created on
   * first visit) from the page URL, one topic per article — the usual setup.
   */
  topic?: string;
  /** The canonical URL of the article. Defaults to `location.origin + location.pathname`. */
  articleUrl?: string;
}

export interface WidgetOptions extends EmbedOptions {
  /** `search` (default) lists matching pages; `ask` answers with the space's AI. */
  mode?: 'search' | 'ask';
  placeholder?: string;
}

export type ChangelogOptions = EmbedOptions;

export type OptionsFor<K extends EmbedKind> = K extends 'comments'
  ? CommentsOptions
  : K extends 'widget'
    ? WidgetOptions
    : ChangelogOptions;

/** `https://x.com/api/` → `https://x.com/api`. */
export function normalizeApiBase(apiBase?: string): string {
  return (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
}

/** The reader site that sits in front of an API base (`…/api` → `…`). */
export function siteOrigin(apiBase?: string): string {
  return normalizeApiBase(apiBase).replace(/\/api$/, '');
}

/** The URL of the hosted script for `kind`. */
export function scriptUrl(kind: EmbedKind, apiBase?: string): string {
  return `${normalizeApiBase(apiBase)}/embed/${kind}.js`;
}

/** `auto` → whatever the visitor's OS says right now; SSR resolves to `light`. */
export function resolveTheme(theme: Theme | undefined): 'light' | 'dark' {
  if (theme === 'dark' || theme === 'light') return theme;
  if (theme === 'auto' && typeof matchMedia === 'function') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * The `data-*` attributes for a hosted script. Pure, so it is usable on the
 * server to render a <script> tag (Astro, Eleventy, Docusaurus SSR).
 */
export function scriptAttributes<K extends EmbedKind>(
  kind: K,
  opts: OptionsFor<K>,
): Record<string, string> {
  const o = opts as CommentsOptions & WidgetOptions;
  const attrs: Record<string, string | undefined> = {
    'data-org': o.org,
    'data-space': o.space,
    'data-api': normalizeApiBase(o.apiBase),
    'data-theme': o.theme,
    'data-locale': o.locale,
    'data-accent': o.accent,
    'data-radius': o.radius,
    'data-width': o.width,
    'data-font': o.font,
  };
  if (kind === 'comments') {
    attrs['data-topic'] = o.topic;
    attrs['data-article-url'] = o.articleUrl;
  }
  if (kind === 'widget') {
    attrs['data-mode'] = o.mode;
    attrs['data-placeholder'] = o.placeholder;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== '') out[k] = String(v);
  return out;
}

/** A ready-to-paste `<script>` tag, for server templates and docs. */
export function scriptTag<K extends EmbedKind>(kind: K, opts: OptionsFor<K>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const attrs = Object.entries(scriptAttributes(kind, opts))
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  const nonce = opts.nonce ? ` nonce="${esc(opts.nonce)}"` : '';
  return `<script src="${esc(scriptUrl(kind, opts.apiBase))}"${attrs}${nonce} async></script>`;
}
