/**
 * A headless client for Forumulate's PUBLIC read API: what a website needs to
 * render a space's docs, blog, forum and changelog with its own components.
 *
 * Works anywhere `fetch` does — Node ≥ 18 at build time (SSG, Astro/Eleventy
 * data files, Gatsby sourcing), edge runtimes, and the browser (every
 * `/public/*` route is CORS-open, credential-less). No token: it can only read
 * what an anonymous visitor can. Private spaces answer 404.
 *
 * Content comes back as the block model (`BlockDoc`) and, for anything a site
 * wants as text, as Markdown straight from the API (`getPageMarkdown`, ...) —
 * the API renders it, so no converter is duplicated here.
 */
import type {
  Article,
  ArticleSummary,
  ChangelogWidget,
  Page,
  PageNode,
  PageSummary,
  Paged,
  SearchResult,
  SpaceOverview,
} from './content-types.js';
import { errorFrom } from './errors.js';
import { normalizeApiBase } from './options.js';

export { ForumulateError } from './errors.js';

export * from './content-types.js';

/**
 * Extra `fetch` init merged into every request. Open on purpose: Next.js reads
 * `{ next: { revalidate, tags } }`, Cloudflare reads `{ cf }`, and so on.
 */
export type FetchInit = RequestInit & Record<string, unknown>;

export interface ClientOptions {
  /** Organization id or slug. */
  org: string;
  /** Space id or slug. */
  space: string;
  /** API origin including `/api`. Defaults to `https://forumulate.com/api`. */
  apiBase?: string;
  /** Content language for docs pages (`?locale=`). */
  locale?: string;
  /** A private-space share token (`?share=`), for previews. */
  share?: string;
  /** Your `fetch` (a polyfill, a mock, or a framework's server fetch). */
  fetch?: typeof fetch;
  /** Default init for every request (headers, framework caching hints). */
  init?: FetchInit;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
  tag?: string;
  sort?: string;
  init?: FetchInit;
}

export interface TopicListOptions extends ListOptions {
  /** Category id or slug. */
  category?: string;
}

export interface PageOptions {
  locale?: string;
  /** Docs version slug; `default` when omitted. */
  version?: string;
  init?: FetchInit;
}

export interface CallOptions {
  init?: FetchInit;
}

/** The list routes answer an enveloped `page` to callers that state this version. */
const API_VERSION = '2026-09-01';

type Query = Record<string, string | number | undefined>;

export interface ForumulateClient {
  readonly org: string;
  readonly space: string;
  readonly apiBase: string;
  /** The space's front door: name, type, docs navigation, locales, versions. */
  getSpace(o?: PageOptions): Promise<SpaceOverview>;
  /** Every docs page in navigation order, flattened (`depth` keeps the tree). */
  listPages(o?: PageOptions): Promise<PageSummary[]>;
  /** A docs page by slug or id, with its block content. */
  getPage(slugOrId: string, o?: PageOptions): Promise<Page>;
  /** A docs page rendered to Markdown by the API. */
  getPageMarkdown(slugOrId: string, o?: PageOptions): Promise<string>;
  listPosts(o?: ListOptions): Promise<Paged<ArticleSummary>>;
  getPost(slug: string, o?: CallOptions): Promise<Article>;
  getPostMarkdown(slug: string, o?: CallOptions): Promise<string>;
  listTopics(o?: TopicListOptions): Promise<Paged<ArticleSummary>>;
  getTopic(slug: string, o?: CallOptions): Promise<Article>;
  getTopicMarkdown(slug: string, o?: CallOptions): Promise<string>;
  listReleases(o?: ListOptions): Promise<Paged<Article>>;
  getRelease(slug: string, o?: CallOptions): Promise<Article>;
  getReleaseMarkdown(slug: string, o?: CallOptions): Promise<string>;
  /**
   * The releases as the in-app widget draws them, each with its own page URL
   * on the changelog's public address. `segments` narrows to a visitor
   * (`{ plans: 'Pro' }`).
   */
  getChangelogWidget(o?: {
    limit?: number;
    segments?: Record<string, string | readonly string[]>;
    init?: FetchInit;
  }): Promise<ChangelogWidget>;
  /** Full-text search over a docs space. */
  search(q: string, o?: { limit?: number; init?: FetchInit }): Promise<SearchResult>;
  /** Escape hatch: GET any path under the space's public root. */
  get<T = unknown>(path: string, query?: Query, init?: FetchInit): Promise<T>;
}

function flatten(nodes: PageNode[], col: PageSummary['collection'], depth: number, out: PageSummary[]) {
  for (const n of nodes) {
    out.push({
      id: n.id,
      slug: n.slug,
      title: n.title,
      parentId: n.parentId ?? null,
      depth,
      collection: col,
      updatedAt: n.updatedAt,
      externalUrl: n.externalUrl ?? null,
      hideFromNav: n.hideFromNav ?? false,
    });
    if (n.children?.length) flatten(n.children, col, depth + 1, out);
  }
}

interface ListEnvelope {
  page?: { hasMore?: boolean; nextCursor?: string | null; total?: number };
}

function paged<T>(body: ListEnvelope, items: T[] | undefined, limit?: number): Paged<T> {
  const list = items ?? [];
  // The pre-envelope shape (an API older than the version header) has no
  // `page`; a full page is the only hint that there may be more.
  if (!body.page) return { items: list, hasMore: limit != null && list.length >= limit, nextCursor: null };
  return {
    items: list,
    hasMore: Boolean(body.page.hasMore),
    nextCursor: body.page.nextCursor ?? null,
    ...(body.page.total != null ? { total: body.page.total } : {}),
  };
}

export function createClient(options: ClientOptions): ForumulateClient {
  if (!options?.org || !options?.space) {
    throw new Error('[forumulate] createClient needs both `org` and `space`');
  }
  const apiBase = normalizeApiBase(options.apiBase);
  const root = `${apiBase}/public/orgs/${encodeURIComponent(options.org)}/spaces/${encodeURIComponent(options.space)}`;
  const doFetch = (...a: Parameters<typeof fetch>) => (options.fetch ?? globalThis.fetch)(...a);

  async function request(path: string, query: Query, init: FetchInit | undefined, as: 'json' | 'text') {
    const qs = new URLSearchParams();
    if (options.share) qs.set('share', options.share);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const q = qs.toString();
    const url = `${root}${path}${q ? `?${q}` : ''}`;
    const merged: FetchInit = { ...options.init, ...init };
    const headers = new Headers(options.init?.headers);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    if (as === 'json') {
      headers.set('accept', 'application/json');
      headers.set('forumulate-version', API_VERSION);
    } else headers.set('accept', 'text/markdown, text/plain');
    const res = await doFetch(url, { ...merged, method: 'GET', headers });
    if (!res.ok) throw await errorFrom(res, url);
    return as === 'json' ? res.json() : res.text();
  }
  const json = <T>(path: string, query: Query = {}, init?: FetchInit) =>
    request(path, query, init, 'json') as Promise<T>;
  const text = (path: string, query: Query = {}, init?: FetchInit) =>
    request(path, query, init, 'text') as Promise<string>;
  const seg = (s: string) => encodeURIComponent(s);
  const pageQuery = (o?: PageOptions): Query => ({
    locale: o?.locale ?? options.locale,
    version: o?.version,
  });

  const client: ForumulateClient = {
    org: options.org,
    space: options.space,
    apiBase,
    getSpace: (o) => json<SpaceOverview>('', pageQuery(o), o?.init),
    async listPages(o) {
      const overview = await client.getSpace(o);
      const out: PageSummary[] = [];
      for (const c of overview.collections ?? []) {
        flatten(c.pages ?? [], { id: c.id, slug: c.slug, name: c.name }, 0, out);
      }
      return out;
    },
    getPage: (s, o) => json<Page>(`/pages/${seg(s)}`, pageQuery(o), o?.init),
    getPageMarkdown: (s, o) => text(`/pages/${seg(s)}.md`, pageQuery(o), o?.init),
    async listPosts(o = {}) {
      const body = await json<ListEnvelope & { articles?: ArticleSummary[] }>(
        '/blog',
        { limit: o.limit, cursor: o.cursor, tag: o.tag, sort: o.sort },
        o.init,
      );
      return paged(body, body.articles, o.limit);
    },
    getPost: async (s, o) =>
      (await json<{ article: Article }>(`/blog/t/${seg(s)}`, {}, o?.init)).article,
    getPostMarkdown: (s, o) => text(`/blog/t/${seg(s)}.md`, {}, o?.init),
    async listTopics(o = {}) {
      const body = await json<ListEnvelope & { topics?: ArticleSummary[] }>(
        '/forum',
        { limit: o.limit, cursor: o.cursor, tag: o.tag, sort: o.sort, category: o.category },
        o.init,
      );
      return paged(body, body.topics, o.limit);
    },
    getTopic: async (s, o) => (await json<{ topic: Article }>(`/forum/t/${seg(s)}`, {}, o?.init)).topic,
    getTopicMarkdown: (s, o) => text(`/forum/t/${seg(s)}.md`, {}, o?.init),
    async listReleases(o = {}) {
      const body = await json<ListEnvelope & { releases?: Article[] }>(
        '/changelog',
        { limit: o.limit, cursor: o.cursor },
        o.init,
      );
      return paged(body, body.releases, o.limit);
    },
    getRelease: async (s, o) =>
      (await json<{ release: Article }>(`/changelog/t/${seg(s)}`, {}, o?.init)).release,
    getReleaseMarkdown: (s, o) => text(`/changelog/t/${seg(s)}.md`, {}, o?.init),
    getChangelogWidget: (o = {}) => {
      const q: Query = { limit: o.limit };
      for (const [k, v] of Object.entries(o.segments ?? {}))
        q[`seg_${k}`] = Array.isArray(v) ? v.join(',') : String(v);
      return json<ChangelogWidget>('/changelog/widget', q, o.init);
    },
    search: (q, o) => json<SearchResult>('/search', { q, limit: o?.limit }, o?.init),
    get: (path, query, init) => json(path.startsWith('/') || !path ? path : `/${path}`, query, init),
  };
  return client;
}
