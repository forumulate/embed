/**
 * A client for the Delivery API: a content library's entries, globals and
 * routes, read with a delivery, publishable or preview key (spec §4).
 *
 *   import { createContentClient } from '@forumulate/embed/content';
 *   const cms = createContentClient({ library: 'lib_…', key: process.env.FORUMULATE_KEY! });
 *   const { data } = await cms.getEntries<Post>('post', {
 *     where: { category: { equals: 'news' } }, sort: '-publishedAt', limit: 10,
 *   });
 *
 * Works wherever `fetch` does. A secret key (`cfd_`, `cfv_`) belongs on a
 * server; only a publishable key (`cfp_`) may ship to a browser, and only from
 * the origins it lists.
 */
import { errorFrom } from '../errors.js';
import { normalizeApiBase } from '../options.js';
import type {
  ContentClientOptions,
  Entry,
  EntryList,
  FetchInit,
  ListOptions,
  ReadOptions,
  RouteResolution,
} from './types.js';

/**
 * Past this many characters of query string a GET switches to the POST query
 * route. Proxies and CDNs start refusing URLs somewhere past 2 KB (some at
 * 4 KB, some at 8 KB), and a long `where` is the one input that gets there.
 */
const MAX_QUERY_LENGTH = 1800;

type Params = Record<string, string | undefined>;

export interface ContentClient {
  readonly library: string;
  /** The delivery root every path below hangs off. */
  readonly root: string;
  /** One window of a collection. Walk `page.nextCursor`, or use {@link ContentClient.paginate}. */
  getEntries<T = Record<string, unknown>>(type: string, o?: ListOptions<T>): Promise<EntryList<T>>;
  /** One entry by id or slug. */
  getEntry<T = Record<string, unknown>>(type: string, idOrSlug: string, o?: ReadOptions): Promise<Entry<T>>;
  /** A singleton (`site`, `header`, `footer`, …). */
  getGlobal<T = Record<string, unknown>>(key: string, o?: ReadOptions): Promise<Entry<T>>;
  /** A list with the query in a POST body — for a `where` too long for a URL. */
  query<T = Record<string, unknown>>(type: string, o?: ListOptions<T>): Promise<EntryList<T>>;
  /** What lives at a path: an entry, a redirect, or `null` for a 404. */
  resolveRoute<T = Record<string, unknown>>(path: string, o?: ReadOptions): Promise<RouteResolution<T> | null>;
  /** Every window of a list, one after another, following the cursor. */
  paginate<T = Record<string, unknown>>(type: string, o?: ListOptions<T>): AsyncGenerator<EntryList<T>>;
  /** Every entry of a list, following the cursor. Bounded by `max` (default 10 000). */
  all<T = Record<string, unknown>>(type: string, o?: ListOptions<T> & { max?: number }): Promise<Entry<T>[]>;
  /** Escape hatch: GET any path under the delivery root. */
  get<R = unknown>(path: string, params?: Params, init?: FetchInit): Promise<R>;
}

const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v.join(',') : v);

/** Read options → query parameters, in the API's spelling. Exported for the framework wrappers' tests. */
export function readParams(o: ReadOptions = {}, defaults: { locale?: string; draft?: boolean } = {}): Params {
  const p: Params = {
    locale: o.locale ?? defaults.locale,
    fallback: o.fallback === undefined ? undefined : String(o.fallback),
    depth: o.depth === undefined ? undefined : String(o.depth),
    select: list(o.select),
    draft: (o.draft ?? defaults.draft) ? 'true' : undefined,
  };
  for (const [type, fields] of Object.entries(o.populate ?? {})) p[`populate[${type}]`] = list(fields);
  return p;
}

/** List options → query parameters. `where` travels JSON-encoded, which the API accepts beside qs. */
export function listParams<T>(o: ListOptions<T> = {}, defaults: { locale?: string; draft?: boolean } = {}): Params {
  return {
    ...readParams(o, defaults),
    where: o.where && Object.keys(o.where).length ? JSON.stringify(o.where) : undefined,
    sort: list(o.sort),
    limit: o.limit === undefined ? undefined : String(o.limit),
    cursor: o.cursor ?? undefined,
    count: o.count ? 'true' : undefined,
  };
}

function search(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function createContentClient(options: ContentClientOptions): ContentClient {
  if (!options?.library || !options?.key) {
    throw new Error('[forumulate] createContentClient needs both `library` and `key`');
  }
  const seg = encodeURIComponent;
  const base = `${normalizeApiBase(options.baseUrl)}/delivery/v1`;
  const root = options.publishableKeyId
    ? `${base}/k/${seg(options.publishableKeyId)}`
    : `${base}/libraries/${seg(options.library)}`;
  const defaults = { locale: options.locale, draft: options.draft };

  async function request<R>(path: string, params: Params, init?: FetchInit, body?: unknown): Promise<R> {
    const url = `${root}${path}${search(params)}`;
    const headers = new Headers(options.init?.headers);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    headers.set('accept', 'application/json');
    headers.set('authorization', `Bearer ${options.key}`);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const res = await (options.fetch ?? globalThis.fetch)(url, {
      ...options.init,
      ...init,
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await errorFrom(res, url);
    const tags = (res.headers.get('cache-tag') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    options.onResponse?.({ url, status: res.status, tags });
    return (await res.json()) as R;
  }

  const one = async <T>(path: string, o?: ReadOptions): Promise<Entry<T>> => {
    const body = await request<Entry<T> | { data: Entry<T> }>(path, readParams(o, defaults), o?.init);
    // The one-entry answer is the entry itself (spec §4.2); a `{ data }` wrapper
    // is unwrapped too, so the client survives the API settling on either.
    return 'fields' in body ? body : body.data;
  };

  const client: ContentClient = {
    library: options.library,
    root,
    getEntries(type, o = {}) {
      const params = listParams(o, defaults);
      if (search(params).length > MAX_QUERY_LENGTH) return client.query(type, o);
      return request(`/types/${seg(type)}/entries`, params, o.init);
    },
    getEntry: (type, idOrSlug, o) => one(`/types/${seg(type)}/entries/${seg(idOrSlug)}`, o),
    getGlobal: (key, o) => one(`/globals/${seg(key)}`, o),
    query(type, o = {}) {
      // Everything but the read options moves into the body, so the URL stays
      // short however large the query grows.
      const { where, sort, limit, cursor, count, init, ...read } = o;
      return request(`/types/${seg(type)}/entries/query`, readParams(read, defaults), init, {
        where,
        sort: Array.isArray(sort) ? sort.join(',') : sort,
        limit,
        cursor: cursor ?? undefined,
        count,
      });
    },
    async resolveRoute(path, o) {
      try {
        return await request(`/routes/resolve`, { ...readParams(o, defaults), path }, o?.init);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async *paginate(type, o = {}) {
      let cursor = o.cursor ?? null;
      for (;;) {
        const window = await client.getEntries(type, { ...o, cursor });
        yield window;
        // A cursor that does not move would loop forever; stop rather than
        // trust a misbehaving answer.
        if (!window.page.hasMore || !window.page.nextCursor || window.page.nextCursor === cursor) return;
        cursor = window.page.nextCursor;
      }
    },
    async all<T>(type: string, o: ListOptions<T> & { max?: number } = {}) {
      const { max = 10_000, ...rest } = o;
      const out: Entry<T>[] = [];
      for await (const window of client.paginate<T>(type, { limit: 100, ...rest })) {
        out.push(...window.data);
        if (out.length >= max) return out.slice(0, max);
      }
      return out;
    },
    get: (path, params = {}, init) => request(path.startsWith('/') || !path ? path : `/${path}`, params, init),
  };
  return client;
}
