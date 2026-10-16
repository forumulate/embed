/**
 * The one error type both clients throw. A leaf module so the content client
 * (`@forumulate/embed/content`) can share it without dragging the public read
 * client into a CMS site's bundle.
 */

/** Thrown for any non-2xx answer; carries the API's `{ error: { code, message } }`. */
export class ForumulateError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly url: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ForumulateError';
  }
}

/** Turn a failed `Response` into a {@link ForumulateError}, keeping the API's code when it sent one. */
export async function errorFrom(res: Response, url: string): Promise<ForumulateError> {
  let code = 'http.' + res.status;
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // not JSON — keep the status line
  }
  const rid = res.headers.get('x-request-id') ?? undefined;
  return new ForumulateError(res.status, code, message, url, rid);
}
