import { createHmac } from 'node:crypto';
import { vi } from 'vitest';

/** A fetch mock that records calls and answers from `respond`. */
export function mockFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(url, init);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Sign a delivery the way the worker does: `v1,sha256=hex(hmac(secret, "<ts>.<body>"))`. */
export function sign(secret: string, body: string, timestamp: number): string {
  return `v1,sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function webhookRequest(
  secret: string,
  payload: unknown,
  o: { timestamp?: number; signature?: string; url?: string; method?: string } = {},
) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = o.timestamp ?? Math.floor(Date.now() / 1000);
  return new Request(o.url ?? 'https://site.example/api/revalidate', {
    method: o.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forumulate-signature': o.signature ?? sign(secret, body, timestamp),
      'x-forumulate-timestamp': String(timestamp),
    },
    body: (o.method ?? 'POST') === 'POST' ? body : undefined,
  });
}

export const publishPayload = {
  event: 'content.entry.published',
  data: {
    libraryId: 'lib_1',
    contentType: 'post',
    entryId: 'en_1',
    slug: 'hello',
    paths: ['/blog/hello'],
    oldPaths: ['/blog/hi'],
    tags: ['fm:entry:en_1', 'fm:type:lib_1:post'],
    affectedTags: ['fm:entry:en_9', 'fm:type:lib_1:post'],
  },
};
