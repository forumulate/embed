import { describe, expect, it } from 'vitest';
import { createContentClient, ForumulateError, stegaClean } from '../src/content/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const page = (nextCursor: string | null) => ({ limit: 2, hasMore: nextCursor !== null, nextCursor });
const entry = (id: string) => ({ id, type: 'post', fields: { title: id } });

describe('createContentClient', () => {
  it('requires a library and a key', () => {
    expect(() => createContentClient({ library: '', key: 'k' })).toThrow(/library/);
    expect(() => createContentClient({ library: 's', key: '' })).toThrow(/key/);
  });

  it('lists with the key as a bearer and the query in the API spelling', async () => {
    const m = mockFetch(() => jsonResponse({ data: [entry('a')], page: page(null) }));
    const cms = createContentClient({ library: 'acme site', key: 'cfd_x', baseUrl: 'https://f.test/api/', fetch: m.fetch, locale: 'en' });
    const res = await cms.getEntries<{ title: string; views: number }>('post', {
      where: { title: { like: 'hel' }, or: [{ views: { gt: 10 } }] },
      sort: ['-publishedAt', 'title'],
      limit: 2,
      select: ['title'],
      depth: 1,
      populate: { author: ['name', 'avatar'] },
      count: true,
    });
    expect(res.data[0]!.fields.title).toBe('a');
    const { url, init } = m.calls[0]!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://f.test/api/delivery/v1/libraries/acme%20site/types/post/entries');
    expect(JSON.parse(u.searchParams.get('where')!)).toEqual({ title: { like: 'hel' }, or: [{ views: { gt: 10 } }] });
    expect(u.searchParams.get('sort')).toBe('-publishedAt,title');
    expect(u.searchParams.get('limit')).toBe('2');
    expect(u.searchParams.get('select')).toBe('title');
    expect(u.searchParams.get('depth')).toBe('1');
    expect(u.searchParams.get('populate[author]')).toBe('name,avatar');
    expect(u.searchParams.get('count')).toBe('true');
    expect(u.searchParams.get('locale')).toBe('en');
    expect(u.searchParams.has('draft')).toBe(false);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cfd_x');
  });

  it('reads one entry and a global, unwrapping a { data } answer too', async () => {
    const m = mockFetch((url) =>
      url.includes('/globals/') ? jsonResponse({ data: { id: 'g', type: 'site', fields: { name: 'Acme' } } }) : jsonResponse(entry('p1')),
    );
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    expect((await cms.getEntry('post', 'hello/world')).id).toBe('p1');
    expect(m.calls[0]!.url).toBe('https://forumulate.com/api/delivery/v1/libraries/s/types/post/entries/hello%2Fworld');
    expect((await cms.getGlobal<{ name: string }>('site')).fields.name).toBe('Acme');
  });

  it('moves a where too long for a URL into the POST query route', async () => {
    const m = mockFetch(() => jsonResponse({ data: [], page: page(null) }));
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    const ids = Array.from({ length: 200 }, (_, i) => `entry-id-${i}`);
    await cms.getEntries('post', { where: { id: { in: ids } }, sort: '-publishedAt', locale: 'es' });
    const { url, init } = m.calls[0]!;
    expect(url).toBe('https://forumulate.com/api/delivery/v1/libraries/s/types/post/entries/query?locale=es');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ where: { id: { in: ids } }, sort: '-publishedAt' });
  });

  it('pages through the PageInfo cursor and stops at hasMore: false', async () => {
    const windows: Record<string, unknown> = {
      '': { data: [entry('a'), entry('b')], page: page('c2') },
      c2: { data: [entry('c'), entry('d')], page: page('c3') },
      c3: { data: [entry('e')], page: page(null) },
    };
    const m = mockFetch((url) => jsonResponse(windows[new URL(url).searchParams.get('cursor') ?? '']));
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    const seen: string[] = [];
    for await (const w of cms.paginate('post', { limit: 2 })) seen.push(...w.data.map((e) => e.id));
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((await cms.all('post', { max: 3 })).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops paging when the cursor does not move', async () => {
    const m = mockFetch(() => jsonResponse({ data: [entry('a')], page: page('same') }));
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    const all = await cms.all('post', { cursor: 'same' });
    expect(all).toHaveLength(1);
    expect(m.calls).toHaveLength(1);
  });

  it('resolves routes, with null for a 404', async () => {
    const m = mockFetch((url) =>
      url.includes('missing')
        ? jsonResponse({ error: { code: 'route.not_found', message: 'No route' } }, 404)
        : jsonResponse({ kind: 'redirect', path: '/old', to: '/new', status: 301 }),
    );
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    expect(await cms.resolveRoute('/old')).toMatchObject({ kind: 'redirect', to: '/new' });
    expect(new URL(m.calls[0]!.url).searchParams.get('path')).toBe('/old');
    expect(await cms.resolveRoute('/missing')).toBeNull();
  });

  it('throws ForumulateError with the API code', async () => {
    const m = mockFetch(() => jsonResponse({ error: { code: 'delivery.forbidden', message: 'Not this type' } }, 403, { 'x-request-id': 'r1' }));
    const cms = createContentClient({ library: 's', key: 'k', fetch: m.fetch });
    const err = await cms.getEntries('secret').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForumulateError);
    expect(err).toMatchObject({ status: 403, code: 'delivery.forbidden', requestId: 'r1' });
  });

  it('uses the /k/ form for a publishable key and reports cache tags', async () => {
    const tags: string[][] = [];
    const m = mockFetch(() => jsonResponse({ data: [], page: page(null) }, 200, { 'cache-tag': 'fm:type:s:post, fm:key:kid' }));
    const cms = createContentClient({ library: 's', key: 'cfp_x', publishableKeyId: 'kid', fetch: m.fetch, onResponse: (i) => tags.push(i.tags) });
    await cms.getEntries('post');
    expect(m.calls[0]!.url).toBe('https://forumulate.com/api/delivery/v1/k/kid/types/post/entries');
    expect(tags).toEqual([['fm:type:s:post', 'fm:key:kid']]);
  });

  it('asks for drafts when told to', async () => {
    const m = mockFetch(() => jsonResponse(entry('d')));
    const cms = createContentClient({ library: 's', key: 'cfv_x', fetch: m.fetch, draft: true });
    await cms.getEntry('post', 'x');
    await cms.getEntry('post', 'x', { draft: false });
    expect(new URL(m.calls[0]!.url).searchParams.get('draft')).toBe('true');
    expect(new URL(m.calls[1]!.url).searchParams.has('draft')).toBe(false);
  });

  it('stegaClean leaves stega-free values as they were', () => {
    expect(stegaClean({ a: 'x' })).toEqual({ a: 'x' });
    expect(stegaClean('pricing')).toBe('pricing');
  });
});
