/**
 * A list of a space's latest content — blog posts, forum topics, docs pages or
 * changelog releases — as plain links. The one embed with no hosted script
 * behind it: the API serves the data, and a list of links is the whole UI.
 *
 * `feedHtml` is pure (no DOM), so server templates (Astro, Eleventy,
 * Docusaurus) can print the same markup the `<forumulate-feed>` element draws
 * on the client. Class names are a stable styling contract: `.fm-feed`,
 * `.fm-feed__item`, `__link`, `__title`, `__meta`, `__excerpt`.
 */
import { createClient, type ClientOptions, type FetchInit } from './client.js';
import { siteOrigin } from './options.js';

export type FeedKind = 'posts' | 'topics' | 'pages' | 'releases';
/**
 * The space-type names the server-side integrations (Django, Rails, Hugo,
 * Ghost, ...) print as `kind=`. Same lists, other words — both are accepted.
 */
export type FeedKindAlias = 'blog' | 'forum' | 'docs' | 'changelog';

const ALIASES: Record<FeedKindAlias, FeedKind> = {
  blog: 'posts',
  forum: 'topics',
  docs: 'pages',
  changelog: 'releases',
};

/** `blog` → `posts`, `forum` → `topics`, ...; unknown values fall back to `posts`. */
export function normalizeFeedKind(kind: string | undefined): FeedKind {
  if (kind === 'posts' || kind === 'topics' || kind === 'pages' || kind === 'releases') return kind;
  return ALIASES[kind as FeedKindAlias] ?? 'posts';
}

export interface FeedOptions extends ClientOptions {
  kind: FeedKind | FeedKindAlias;
  /** How many items. Default 5. */
  limit?: number;
  /** Only items with this tag (posts, topics). */
  tag?: string;
  /** Forum category id or slug (topics). */
  category?: string;
  /**
   * Where each item links. `{slug}` and `{id}` are substituted, e.g.
   * `/blog/{slug}` for your own routes. Default: the Forumulate reader page.
   */
  href?: string;
  /** Show the excerpt under each title. Default true. */
  excerpts?: boolean;
  init?: FetchInit;
}

export interface FeedItem {
  id: string;
  slug: string;
  title: string;
  href: string;
  excerpt: string;
  /** ISO timestamp (published, or last updated for pages). */
  date: string | null;
  /** Release version, reply count, ... — a short secondary label. */
  meta: string | null;
}

const READER_PREFIX: Record<FeedKind, string> = {
  posts: 'b',
  topics: 'f',
  pages: 'p',
  releases: 'c',
};

function itemHref(o: FeedOptions & { kind: FeedKind }, id: string, slug: string): string {
  if (o.href) return o.href.replaceAll('{slug}', encodeURIComponent(slug)).replaceAll('{id}', encodeURIComponent(id));
  const base = `${siteOrigin(o.apiBase)}/${READER_PREFIX[o.kind]}/${encodeURIComponent(o.org)}/${encodeURIComponent(o.space)}`;
  // The changelog reader is one page with an anchor per release.
  return o.kind === 'releases' ? `${base}#${encodeURIComponent(slug)}` : `${base}/${encodeURIComponent(slug)}`;
}

/** Fetch the items a feed shows. Runs on the server or in the browser. */
export async function fetchFeed(opts: FeedOptions): Promise<FeedItem[]> {
  const o = { ...opts, kind: normalizeFeedKind(opts.kind) };
  const client = createClient(o);
  const limit = o.limit ?? 5;
  if (o.kind === 'pages') {
    const pages = (await client.listPages({ init: o.init })).filter((p) => !p.hideFromNav && !p.externalUrl);
    return pages.slice(0, limit).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      href: itemHref(o, p.id, p.slug),
      excerpt: '',
      date: p.updatedAt ?? null,
      meta: null,
    }));
  }
  const list =
    o.kind === 'posts'
      ? await client.listPosts({ limit, tag: o.tag, init: o.init })
      : o.kind === 'topics'
        ? await client.listTopics({ limit, tag: o.tag, category: o.category, init: o.init })
        : await client.listReleases({ limit, init: o.init });
  return list.items.slice(0, limit).map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    href: itemHref(o, a.id, a.slug),
    excerpt: a.excerpt ?? '',
    date: a.publishedAt ?? a.updatedAt ?? null,
    meta:
      o.kind === 'releases'
        ? a.releaseVersion
        : o.kind === 'topics'
          ? `${a.replyCount} ${a.replyCount === 1 ? 'reply' : 'replies'}`
          : null,
  }));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(locale || 'en', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** The feed's markup. Pure — safe to call on the server. */
export function feedHtml(items: FeedItem[], o: { locale?: string; excerpts?: boolean } = {}): string {
  if (!items.length) return '<p class="fm-feed fm-feed--empty">Nothing here yet.</p>';
  const rows = items.map((it) => {
    const meta = [it.date ? `<time datetime="${esc(it.date)}">${esc(formatDate(it.date, o.locale))}</time>` : '', it.meta ? `<span>${esc(it.meta)}</span>` : '']
      .filter(Boolean)
      .join(' · ');
    const excerpt = o.excerpts !== false && it.excerpt ? `<p class="fm-feed__excerpt">${esc(it.excerpt)}</p>` : '';
    return (
      `<li class="fm-feed__item"><a class="fm-feed__link" href="${esc(it.href)}">` +
      `<span class="fm-feed__title">${esc(it.title)}</span></a>` +
      (meta ? `<div class="fm-feed__meta">${meta}</div>` : '') +
      excerpt +
      '</li>'
    );
  });
  return `<ul class="fm-feed">${rows.join('')}</ul>`;
}

/**
 * Minimal default look, scoped to `.fm-feed` and driven by custom properties
 * (`--fm-accent`, `--fm-muted`, `--fm-line`, `--fm-font`) so a site restyles it
 * without fighting specificity. Injected once per document by the element.
 */
export const FEED_CSS = `.fm-feed{list-style:none;margin:0;padding:0;font-family:var(--fm-font,inherit)}
.fm-feed__item{padding:.75em 0;border-top:1px solid var(--fm-line,rgba(127,127,127,.25))}
.fm-feed__item:first-child{border-top:0}
.fm-feed__link{color:var(--fm-accent,inherit);text-decoration:none;font-weight:600}
.fm-feed__link:hover{text-decoration:underline}
.fm-feed__meta{color:var(--fm-muted,#6b7280);font-size:.85em;margin-top:.15em}
.fm-feed__excerpt{margin:.3em 0 0;color:inherit;opacity:.85}
.fm-feed--empty{color:var(--fm-muted,#6b7280)}`;
