/**
 * The shapes the Delivery API (`/delivery/v1/…`, spec §4.2) answers with, and
 * the typed `where` grammar it accepts.
 *
 * Hand-written, like ../content-types.ts, so this entry has no dependency on
 * the generated SDK. Entries are generic over their `fields`: the per-library
 * types `forumulate content types` generates slot in as `T`, and without them
 * a site still gets `Record<string, unknown>` rather than `any`.
 */

/**
 * The paging half of every list answer — the API's real `PageInfo`
 * (`apps/api/src/common/pagination/page.dto.ts`). Cursor only: there is no
 * page number to ask for, and `hasMore` is what you walk on.
 */
export interface PageInfo {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** Present only with `count: true`, and only where the API can count cheaply. */
  total?: number;
}

/** `{ data, page }`: one window of a list. */
export interface EntryList<T = Record<string, unknown>> {
  data: Entry<T>[];
  page: PageInfo;
}

export type EntryStatus = 'draft' | 'published' | 'scheduled' | 'changed' | (string & {});

/** One entry of a collection (or a global — same shape, `type` is the global's key). */
export interface Entry<T = Record<string, unknown>> {
  id: string;
  type: string;
  slug?: string | null;
  /** The entry's title (the published one, on a published read). */
  title?: string;
  locale?: string;
  status?: EntryStatus;
  publishedAt?: string | null;
  updatedAt?: string;
  modelVersion?: number;
  fields: T;
  /** The entry's routed path, when it has one. */
  route?: string | null;
  /** Every locale the entry exists in. */
  locales?: string[];
  _links?: Record<string, string>;
  [key: string]: unknown;
}

/** What `GET /routes/resolve?path=` answers: an entry to render or a redirect to follow. */
export type RouteResolution<T = Record<string, unknown>> =
  | { kind: 'entry'; path: string; entry: Entry<T>; [key: string]: unknown }
  | { kind: 'redirect'; path: string; to: string; status: number; [key: string]: unknown };

/** The delivery media shape (spec §3.9): drop it into `next/image` or a `<picture>`. */
export interface Media {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  caption?: string | null;
  /** Focal point, 0–1 on each axis; `fit: 'cover'` crops around it. */
  focal?: { x: number; y: number } | null;
  blurDataURL?: string | null;
  /** Width (as a string key) → URL of that pre-sized variant. */
  variants?: Record<string, string>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- where

type Scalar = string | number | boolean | null;

/** Every operator the API's query grammar knows (Payload's set). */
export interface Operators<V = Scalar> {
  equals?: V;
  not_equals?: V;
  in?: V[];
  not_in?: V[];
  contains?: V extends string ? string : V extends readonly (infer E)[] ? E : Scalar;
  like?: string;
  exists?: boolean;
  gt?: V extends number | string ? V : never;
  gte?: V extends number | string ? V : never;
  lt?: V extends number | string ? V : never;
  lte?: V extends number | string ? V : never;
  /** `[longitude, latitude, maxMeters?, minMeters?]`. */
  near?: [number, number, number?, number?];
}

type ValueOf<F> = F extends readonly (infer E)[] ? E | F : F extends Scalar ? F : Scalar;

/**
 * A `where` tree. Known field names are typed from `T`; dot paths into groups
 * (`hero.heading`), rows (`tiers[].name`) and references (`author.name`) stay
 * open strings, because they are the API's to validate and a string template
 * type for every path would cost more than it catches.
 */
export type Where<T = Record<string, unknown>> = {
  [K in keyof T & string]?: Operators<ValueOf<T[K]>>;
} & {
  and?: Where<T>[];
  or?: Where<T>[];
} & {
  [path: string]: Operators | Where<T>[] | undefined;
};

// ---------------------------------------------------------------- options

/**
 * Extra `fetch` init merged into every request. Open on purpose: Next.js reads
 * `{ next: { revalidate, tags } }`, Cloudflare reads `{ cf }`, and so on.
 */
export type FetchInit = RequestInit & Record<string, unknown>;

/** What a response told us beyond its body — for setting `Cache-Tag` on your own answer. */
export interface ResponseInfo {
  url: string;
  status: number;
  /** The webhook tags the API sent in `Cache-Tag` (spec §4.3), split. */
  tags: string[];
}

export interface ContentClientOptions {
  /** Content library id or slug. Use the id if you revalidate by tag: the API's tags carry ids. */
  library: string;
  /** A delivery (`cfd_`), publishable (`cfp_`) or preview (`cfv_`) key. */
  key: string;
  /** API origin including `/api`. Defaults to `https://forumulate.com/api`. */
  baseUrl?: string;
  /**
   * A publishable key's id. Set it and requests use the `/delivery/v1/k/:keyId`
   * form, which puts the key in the URL and so lets a shared cache hold the
   * answer (spec §4.3). Only for `cfp_` keys — the API refuses the others.
   */
  publishableKeyId?: string;
  /** Default locale (`?locale=`). */
  locale?: string;
  /** Ask for drafts on every call (preview keys and preview credentials only). */
  draft?: boolean;
  /** Your `fetch` (a polyfill, a mock, or a framework's server fetch). */
  fetch?: typeof fetch;
  /** Default init for every request (headers, framework caching hints). */
  init?: FetchInit;
  /** Called after every successful response, with its cache tags. */
  onResponse?: (info: ResponseInfo) => void;
}

/** Options every read takes. */
export interface ReadOptions {
  locale?: string;
  /** Fall back to the default locale for untranslated fields. */
  fallback?: boolean;
  /** Populate references this many levels deep (0–3, plan-capped). */
  depth?: number;
  /** Per populated type, the fields to project: `{ author: ['name', 'avatar'] }`. */
  populate?: Record<string, string[] | string>;
  /** Field projection: `['title', 'hero.heading']`. */
  select?: string[] | string;
  draft?: boolean;
  init?: FetchInit;
}

export interface ListOptions<T = Record<string, unknown>> extends ReadOptions {
  where?: Where<T>;
  /** `'-publishedAt'`, `['-publishedAt', 'title']`. */
  sort?: string | string[];
  /** Max 100. */
  limit?: number;
  cursor?: string | null;
  /** Ask for `page.total` (only where it is cheap). */
  count?: boolean;
}
