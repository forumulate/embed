/**
 * @forumulate/embed/content/server — what a site's SERVER needs beyond the
 * client: the revalidate receiver, the preview routes, and a content client
 * that switches to drafts when the request carries a preview credential and
 * otherwise serves published answers from a tag-invalidated cache.
 *
 * The Astro, Nuxt and SvelteKit packages are thin adapters over this (each
 * only knows how to get a `Request` or a `Cookie` header out of its context);
 * Next uses the pure parts and its own Data Cache.
 */
import { createContentClient, type ContentClient } from './client.js';
import { PREVIEW_COOKIE, readPreviewCredential } from './preview.js';
import { defaultTagCache, type CachedResponse, type TagCache } from './tag-cache.js';
import type { ContentClientOptions } from './types.js';

export * from './preview.js';
export * from './revalidate.js';
export * from './tag-cache.js';
export { verifyWebhookSignature, type VerifyWebhookInput } from './webhooks.js';

export interface ServerContentOptions extends Omit<ContentClientOptions, 'draft'> {
  /**
   * Seconds a published answer is served from the cache. `false` keeps it
   * until a webhook names one of its tags. Default 60.
   */
  revalidate?: number | false;
  /** The cache to use; `false` turns caching off. Defaults to the shared `defaultTagCache`. */
  cache?: TagCache | false;
  /** The preview cookie's name, if you changed it on the preview route. */
  cookieName?: string;
}

export interface ServerContent {
  /** The published client (cached). */
  readonly published: ContentClient;
  /**
   * The client for one request: drafts with the preview credential when its
   * cookie is present, the cached published client otherwise.
   */
  forRequest(source: Request | string | null | undefined): ContentClient;
  /** Whether a request carries a preview credential. */
  isPreview(source: Request | string | null | undefined): boolean;
}

const cookieOf = (source: Request | string | null | undefined) =>
  typeof source === 'string' || source == null ? source : source.headers.get('cookie');

/**
 * A `fetch` that answers repeat reads from `cache`, tagged with the API's
 * `Cache-Tag`. The key includes the method and body so the POST query route
 * caches per query, not per URL.
 */
export function cachingFetch(cache: TagCache, ttlSeconds: number | false, base: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url} ${typeof init?.body === 'string' ? init.body : ''}`;
    let hit = cache.get(key);
    if (!hit) {
      let tags: string[] | null = null;
      hit = base(input, init).then(async (res): Promise<CachedResponse> => {
        const body = await res.text();
        tags = (res.headers.get('cache-tag') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
        const value = { status: res.status, headers: [...res.headers.entries()], body };
        // Only successes are worth keeping; an error is answered once and forgotten.
        if (!res.ok) throw Object.assign(new Error('uncacheable'), { value });
        return value;
      });
      cache.set(key, hit, () => tags, ttlSeconds === false ? null : ttlSeconds * 1000);
    }
    let value: CachedResponse;
    try {
      value = await hit;
    } catch (err) {
      const failed = (err as { value?: CachedResponse }).value;
      if (!failed) throw err;
      value = failed;
    }
    return new Response(value.body, { status: value.status, headers: value.headers });
  };
}

export function createServerContent(o: ServerContentOptions): ServerContent {
  const { revalidate = 60, cache = defaultTagCache, cookieName = PREVIEW_COOKIE, ...clientOpts } = o;
  const published = createContentClient({
    ...clientOpts,
    fetch: cache ? cachingFetch(cache, revalidate, clientOpts.fetch) : clientOpts.fetch,
  });
  const credentialOf = (source: Request | string | null | undefined) => readPreviewCredential(cookieOf(source), cookieName);
  return {
    published,
    isPreview: (source) => Boolean(credentialOf(source)),
    forRequest(source) {
      const credential = credentialOf(source);
      if (!credential) return published;
      // The credential replaces the delivery key, and draft reads bypass the
      // cache entirely: a preview must never be served to the next visitor.
      // The publishable `/k/` form is a shared-cache URL, so drafts never use it.
      return createContentClient({ ...clientOpts, publishableKeyId: undefined, key: credential, draft: true });
    },
  };
}
