/**
 * The framework-neutral half of the preview routes (spec §5 L1).
 *
 * The studio's Preview button POSTs a self-submitting form to the customer's
 * preview route with a single-use, ten-minute token the editor's session
 * minted. The route exchanges it SERVER-SIDE for a one-hour preview
 * credential, keeps that in an httpOnly cookie on the site's own origin, and
 * redirects to the page. Three rules, each the reason a hand-rolled version of
 * this tends to be a hole:
 *
 *  1. **POST only**, both ways in and out. A token in a query string leaks
 *     through Referer, access logs and history; a GET preview route invites
 *     exactly that (and a GET exit gets prefetched — see `handleExitPreview`).
 *  2. **Relative paths only.** A route that redirects wherever its input says
 *     is an open redirect wearing the site's domain — phishing's favourite
 *     tool. `safeRelativePath` refuses anything that could leave the origin,
 *     including the spellings browsers quietly normalise into `//evil.com`.
 *  3. **`Partitioned; SameSite=None; Secure`.** Inside the studio's iframe the
 *     site is third-party; without CHIPS, Safari and Chrome drop the cookie and
 *     "preview" silently shows published content.
 */
import { normalizeApiBase } from '../options.js';

/** The cookie that carries the preview credential. */
export const PREVIEW_COOKIE = 'fm_preview';
/** The credential lives an hour (spec §5); the cookie never outlives it. */
const MAX_AGE = 3600;

/**
 * `path` if it can only ever stay on this origin, else `null`.
 *
 * Normalised through `URL` and checked AFTER normalisation: `/..//evil.com`
 * starts with a single slash but resolves to `//evil.com`, which a browser
 * reads as another host.
 */
export function safeRelativePath(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048) return null;
  // Backslashes and control characters: browsers turn `/\evil.com` and
  // `/\t/evil.com` into `//evil.com` before they navigate.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000- \u007f]/.test(path) || path.startsWith('//')) return null;
  const sentinel = 'https://origin.invalid';
  let url: URL;
  try {
    url = new URL(path, sentinel);
  } catch {
    return null;
  }
  if (url.origin !== sentinel) return null;
  const out = `${url.pathname}${url.search}${url.hash}`;
  return out.startsWith('//') ? null : out;
}

export interface CookieOptions {
  name?: string;
  maxAge?: number;
}

/** `Set-Cookie` for the credential: httpOnly, Secure, `SameSite=None`, Partitioned. */
export function previewCookie(value: string, o: CookieOptions = {}): string {
  const maxAge = Math.max(0, Math.min(Math.floor(o.maxAge ?? MAX_AGE), MAX_AGE));
  return `${o.name ?? PREVIEW_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`;
}

/**
 * `Set-Cookie` that removes it. The attributes must match the ones it was set
 * with — a partitioned cookie is only cleared by a partitioned `Set-Cookie`.
 */
export function clearPreviewCookie(name: string = PREVIEW_COOKIE): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=None; Partitioned`;
}

/** The credential from a `Cookie` header, if there is one. */
export function readPreviewCredential(cookieHeader: string | null | undefined, name: string = PREVIEW_COOKIE): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== name) continue;
    const raw = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface PreviewRouteOptions {
  /** API origin including `/api`. Defaults to `https://forumulate.com/api`. */
  baseUrl?: string;
  /** Your content library; sent with the exchange so a token for another library is refused. */
  library?: string;
  /** Where the token is exchanged. Defaults to `<baseUrl>/delivery/v1/preview/exchange`. */
  exchangeUrl?: string;
  cookieName?: string;
  fetch?: typeof fetch;
}

export interface PreviewCredential {
  credential: string;
  /** ISO time the credential stops working. */
  expiresAt?: string;
}

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/**
 * Trade the studio's single-use token for a preview credential. Server-side
 * only: the token never reaches a browser script, and the credential comes
 * back to the server that sets the cookie. `null` when the API refuses it.
 */
export async function exchangePreviewToken(
  token: string,
  path: string,
  o: PreviewRouteOptions = {},
): Promise<PreviewCredential | null> {
  const url = o.exchangeUrl ?? `${normalizeApiBase(o.baseUrl)}/delivery/v1/preview/exchange`;
  const res = await (o.fetch ?? globalThis.fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token, path, ...(o.library ? { library: o.library } : {}) }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as Partial<PreviewCredential> | null;
  return typeof body?.credential === 'string' && body.credential ? (body as PreviewCredential) : null;
}

async function formFields(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }
  if (type.includes('form')) {
    const form = await request.formData().catch(() => null);
    const out: Record<string, string> = {};
    form?.forEach((v, k) => {
      if (typeof v === 'string') out[k] = v;
    });
    return out;
  }
  return {};
}

function secondsUntil(iso: string | undefined): number {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.floor((at - Date.now()) / 1000) : MAX_AGE;
}

const redirect = (path: string, cookie: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location: path,
      'set-cookie': cookie,
      'cache-control': 'no-store',
      // The page we land on must not tell the next site where the editor came from.
      'referrer-policy': 'no-referrer',
    },
  });

/**
 * The preview route: POST `{ token, path }` → cookie + 303 to `path`.
 * `enable` runs after the exchange succeeds, before the redirect — Next uses
 * it to switch on `draftMode()`.
 */
export async function handlePreview(
  request: Request,
  o: PreviewRouteOptions & { enable?: (c: PreviewCredential) => void | Promise<void> } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    const res = json(405, 'method_not_allowed');
    res.headers.set('allow', 'POST');
    return res;
  }
  const fields = await formFields(request);
  if (!fields.token) return json(400, 'missing_token');
  const path = safeRelativePath(fields.path || '/');
  if (!path) return json(400, 'unsafe_path');
  let credential: PreviewCredential | null;
  try {
    credential = await exchangePreviewToken(fields.token, path, o);
  } catch {
    return json(502, 'exchange_failed');
  }
  // Reused, expired, for another path or another library: all the same answer,
  // so the route tells a prober nothing about which.
  if (!credential) return json(401, 'preview_token_rejected');
  await o.enable?.(credential);
  return redirect(path, previewCookie(credential.credential, { name: o.cookieName, maxAge: secondsUntil(credential.expiresAt) }));
}

/**
 * The exit route: clears the cookie and redirects to a posted `path` (or
 * `?path=`), `/` by default. POST only, like the way in. Leaving preview takes
 * privilege away, so a GET would not leak anything — but a GET exit is a URL,
 * and URLs get fetched by things nobody clicked: Next's `<Link>` prefetches
 * every link in the viewport, so an "Exit preview" link in the preview banner
 * would end the preview the moment the banner rendered. A form button is
 * never prefetched.
 */
export async function handleExitPreview(
  request: Request,
  o: { cookieName?: string; disable?: () => void | Promise<void> } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    const res = json(405, 'method_not_allowed');
    res.headers.set('allow', 'POST');
    return res;
  }
  const asked = (await formFields(request)).path ?? new URL(request.url).searchParams.get('path');
  const path = safeRelativePath(asked || '/');
  if (!path) return json(400, 'unsafe_path');
  await o.disable?.();
  return redirect(path, clearPreviewCookie(o.cookieName));
}
