/**
 * The framework-neutral half of a revalidate receiver: verify a `content.*`
 * webhook, then hand its tags to whatever cache the framework has.
 *
 * Every framework package wraps this one function — Next calls `revalidateTag`,
 * the others drop entries from {@link TagCache} — so the signature rules and
 * the payload reading exist once. Web `Request` in, web `Response` out, which
 * is what Next route handlers, Astro endpoints and SvelteKit `+server` files
 * already speak.
 */
import { verifyWebhookSignature } from './webhooks.js';

/** The fields of a `content.*` event the receiver uses (spec §3.10). */
export interface ContentEventData {
  libraryId?: string;
  contentType?: string;
  entryId?: string;
  slug?: string;
  oldSlug?: string;
  locale?: string;
  paths?: string[];
  oldPaths?: string[];
  tags?: string[];
  affectedTags?: string[];
  [key: string]: unknown;
}

/** The delivery envelope: `{ event, data }` (plus id and sequence). */
export interface WebhookEnvelope {
  event?: string;
  data?: ContentEventData;
  [key: string]: unknown;
}

export interface RevalidateResult {
  event: string;
  tags: string[];
  paths: string[];
  payload: WebhookEnvelope;
}

export interface RevalidateOptions {
  /** The endpoint's signing secret (Settings → Delivery → Webhooks). */
  secret: string;
  /** How old a delivery may be, in seconds. Default 300 (see `verifyWebhookSignature`). */
  toleranceSeconds?: number;
  /** Overridable for tests. */
  now?: () => number;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * Every tag a delivery asks to drop: `tags` (the changed entry's own) and
 * `affectedTags` (every entry that references it, shared blocks included), so
 * an author's rename refreshes the posts that show the author too.
 */
export function tagsFromPayload(payload: WebhookEnvelope): string[] {
  const d = payload.data ?? {};
  return unique([...strings(d.tags), ...strings(d.affectedTags)]);
}

/** The paths, old and new — a slug change makes the old path stale as well. */
export function pathsFromPayload(payload: WebhookEnvelope): string[] {
  const d = payload.data ?? {};
  return unique([...strings(d.paths), ...strings(d.oldPaths)]);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * Verify and parse a delivery. Answers the refusal `Response` when the
 * delivery is not one to act on, or the tags and paths when it is.
 */
export async function readRevalidateRequest(
  request: Request,
  opts: RevalidateOptions,
): Promise<RevalidateResult | Response> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (!opts.secret) throw new Error('[forumulate] createRevalidateHandler needs a `secret`');
  // The RAW body: a parsed-and-reserialised body has different bytes and
  // would never verify.
  const body = await request.text();
  const ok = await verifyWebhookSignature({
    secret: opts.secret,
    body,
    signature: request.headers.get('x-forumulate-signature'),
    timestamp: request.headers.get('x-forumulate-timestamp'),
    toleranceSeconds: opts.toleranceSeconds,
    now: opts.now,
  });
  if (!ok) return json(401, { error: 'invalid_signature' });
  let payload: WebhookEnvelope;
  try {
    payload = JSON.parse(body) as WebhookEnvelope;
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  if (!payload || typeof payload !== 'object') return json(400, { error: 'invalid_json' });
  return {
    event: String(payload.event ?? request.headers.get('x-forumulate-event') ?? ''),
    tags: tagsFromPayload(payload),
    paths: pathsFromPayload(payload),
    payload,
  };
}

/**
 * A complete receiver: verify, then `revalidate(result)`, then answer 200 with
 * what was dropped. A `ping` (the "test endpoint" button) verifies and answers
 * with no tags, so the studio's test turns green without touching any cache.
 */
export async function handleRevalidate(
  request: Request,
  opts: RevalidateOptions & { revalidate: (result: RevalidateResult) => void | Promise<void> },
): Promise<Response> {
  const result = await readRevalidateRequest(request, opts);
  if (result instanceof Response) return result;
  if (result.tags.length || result.paths.length) await opts.revalidate(result);
  return json(200, { revalidated: true, event: result.event, tags: result.tags, paths: result.paths });
}
