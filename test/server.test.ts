import { describe, expect, it } from 'vitest';
import { createServerContent, createTagCache } from '../src/content/server.js';
import { jsonResponse, mockFetch } from './helpers.js';

const list = (title: string, tags = 'fm:type:lib_1:post') =>
  jsonResponse({ data: [{ id: 'e1', type: 'post', fields: { title } }], page: { limit: 10, hasMore: false, nextCursor: null } }, 200, {
    'cache-tag': tags,
  });

describe('createServerContent', () => {
  it('switches to drafts with the preview credential when the cookie is present', async () => {
    const m = mockFetch(() => list('draft'));
    const content = createServerContent({ library: 'lib_1', key: 'cfd_secret', publishableKeyId: 'kid', fetch: m.fetch, cache: createTagCache() });
    const req = new Request('https://site.example/', { headers: { cookie: 'fm_preview=pcred_1' } });
    expect(content.isPreview(req)).toBe(true);
    await content.forRequest(req).getEntries('post');
    const { url, init } = m.calls[0]!;
    expect(new URL(url).searchParams.get('draft')).toBe('true');
    expect(url).toContain('/delivery/v1/libraries/lib_1/');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer pcred_1');
  });

  it('reads published content with the delivery key otherwise', async () => {
    const m = mockFetch(() => list('live'));
    const content = createServerContent({ library: 'lib_1', key: 'cfd_secret', fetch: m.fetch, cache: false });
    const client = content.forRequest(new Request('https://site.example/'));
    expect(client).toBe(content.published);
    await client.getEntries('post');
    expect(new URL(m.calls[0]!.url).searchParams.has('draft')).toBe(false);
    expect(new Headers(m.calls[0]!.init.headers).get('authorization')).toBe('Bearer cfd_secret');
  });

  it('caches published reads by the API cache tags and drops them on invalidate', async () => {
    let title = 'v1';
    const m = mockFetch(() => list(title));
    const cache = createTagCache();
    const content = createServerContent({ library: 'lib_1', key: 'k', fetch: m.fetch, cache, revalidate: false });
    const [a, b] = await Promise.all([content.published.getEntries('post'), content.published.getEntries('post')]);
    expect(m.calls).toHaveLength(1); // single-flight
    expect(a.data[0]!.fields.title).toBe('v1');
    expect(b.data[0]!.fields.title).toBe('v1');
    title = 'v2';
    expect(cache.invalidate(['fm:type:lib_1:other'])).toBe(0);
    expect((await content.published.getEntries('post')).data[0]!.fields.title).toBe('v1');
    expect(cache.invalidate(['fm:type:lib_1:post'])).toBe(1);
    expect((await content.published.getEntries('post')).data[0]!.fields.title).toBe('v2');
  });

  it('never serves a draft from the cache, and never caches an error', async () => {
    let status = 500;
    const m = mockFetch(() => (status === 500 ? jsonResponse({ error: { code: 'x' } }, 500) : list('ok')));
    const cache = createTagCache();
    const content = createServerContent({ library: 'lib_1', key: 'k', fetch: m.fetch, cache });
    await expect(content.published.getEntries('post')).rejects.toMatchObject({ status: 500 });
    status = 200;
    expect((await content.published.getEntries('post')).data[0]!.fields.title).toBe('ok');
    const draft = content.forRequest('fm_preview=c');
    await draft.getEntries('post');
    await draft.getEntries('post');
    expect(m.calls).toHaveLength(4);
  });

  it('expires entries after the TTL', async () => {
    let t = 0;
    const cache = createTagCache({ now: () => t });
    const m = mockFetch(() => list('x'));
    const content = createServerContent({ library: 'lib_1', key: 'k', fetch: m.fetch, cache, revalidate: 60 });
    await content.published.getEntries('post');
    t = 59_000;
    await content.published.getEntries('post');
    t = 61_000;
    await content.published.getEntries('post');
    expect(m.calls).toHaveLength(2);
  });

  it('drops an answer still in flight when a publish lands', async () => {
    const cache = createTagCache();
    let resolve!: (r: Response) => void;
    const m = mockFetch(() => new Promise<Response>((r) => (resolve = r)));
    const content = createServerContent({ library: 'lib_1', key: 'k', fetch: m.fetch, cache });
    const pending = content.published.getEntries('post');
    await Promise.resolve();
    expect(cache.invalidate(['anything'])).toBe(1);
    resolve(list('old'));
    await pending;
    expect(cache.size).toBe(0);
  });
});
