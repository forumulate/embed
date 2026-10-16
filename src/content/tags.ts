/**
 * The cache tags the Delivery API puts in `Cache-Tag` and the `content.*`
 * webhooks carry in `tags` / `affectedTags` (spec §3.10). One grammar on both
 * sides is what lets a site tag a fetch BEFORE it is made (Next's `next.tags`
 * must be known up front) and still have the publish webhook hit it.
 *
 * `library` is whatever the client was given; the API's tags use the library
 * ID, so a site that revalidates by tag should configure the id, not the slug.
 */
export const contentTags = {
  entry: (entryId: string) => `fm:entry:${entryId}`,
  type: (library: string, type: string) => `fm:type:${library}:${type}`,
  global: (library: string, key: string) => `fm:global:${library}:${key}`,
  route: (library: string, pathHash: string) => `fm:route:${library}:${pathHash}`,
};


/**
 * A path as the route tag sees it: one leading slash, no repeated or trailing
 * slashes, no query or fragment. Case is kept — paths are case-sensitive.
 */
export function normalizeRoutePath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  const joined = `/${bare}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/';
}

/**
 * The `<path-hash>` of a route tag: the first 16 hex characters of the SHA-256
 * of the normalised path. Hashed because a path can hold characters a
 * `Cache-Tag` header cannot, and truncated because 64 bits is plenty to tell
 * one site's routes apart and keeps headers short.
 */
export async function routePathHash(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeRoutePath(path)));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The route tag for a path. */
export const routeTag = async (library: string, path: string) => contentTags.route(library, await routePathHash(path));
