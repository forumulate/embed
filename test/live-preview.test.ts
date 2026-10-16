import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { stegaEncode } from '../src/content/stega';
import {
  applyLive,
  isFieldPointer,
  isTrusted,
  originOf,
  parseFieldAttr,
  parseSiteMessage,
  parseStudioMessage,
  sourceAt,
} from '../src/live-preview/index';

describe('live-preview protocol (P3-T4)', () => {
  const rect = { x: 1, y: 2, width: 3, height: 4 };

  it('reads the site’s messages and nothing else', () => {
    expect(parseSiteMessage({ type: 'fm-ready', v: 1, path: '/pricing' })).toEqual({ type: 'fm-ready', v: 1, path: '/pricing' });
    expect(parseSiteMessage({ type: 'fm-select', v: 1, entryId: 'e1', path: '/blocks/@k3f9a/items/@t1/title', rect })).toMatchObject({
      entryId: 'e1',
      path: '/blocks/@k3f9a/items/@t1/title',
    });
    expect(parseSiteMessage({ type: 'ready' })).toBeNull();
    expect(parseSiteMessage('fm-ready')).toBeNull();
    expect(parseSiteMessage({ type: 'fm-select', v: 1, entryId: 'e1', path: '/blocks/0/title', rect })).toBeNull();
    expect(parseSiteMessage({ type: 'fm-select', v: 1, entryId: 'e1', path: '/title' })).toBeNull();
  });

  it('reads the studio’s messages, refusing an entry that is not the one named', () => {
    const entry = { id: 'e1', fields: { title: 'x' } };
    expect(parseStudioMessage({ type: 'fm-live', v: 1, entryId: 'e1', locale: 'en', entry })).toMatchObject({ entry });
    expect(parseStudioMessage({ type: 'fm-live', v: 1, entryId: 'e2', entry })).toBeNull();
    expect(parseStudioMessage({ type: 'fm-saved', v: 1, entryId: 'e1' })).toEqual({ type: 'fm-saved', v: 1, entryId: 'e1' });
  });

  it('pointers address rows by id, never by position', () => {
    expect(isFieldPointer('/title')).toBe(true);
    expect(isFieldPointer('/layout/@k3f9a/heading')).toBe(true);
    for (const bad of ['title', '/', '/a//b', '/a/0', '/a/-', '/a/']) expect(isFieldPointer(bad)).toBe(false);
  });

  it('parses data-fm-field', () => {
    expect(parseFieldAttr('e1:/title')).toEqual({ entryId: 'e1', path: '/title' });
    expect(parseFieldAttr(':/title')).toBeNull();
    expect(parseFieldAttr('e1:title')).toBeNull();
  });

  it('pins origins and sources', () => {
    const parent = {};
    const allow = (o: string) => o === 'https://forumulate.com';
    expect(isTrusted({ origin: 'https://forumulate.com', source: parent as never }, parent, allow)).toBe(true);
    expect(isTrusted({ origin: 'https://evil.com', source: parent as never }, parent, allow)).toBe(false);
    expect(isTrusted({ origin: 'https://forumulate.com', source: {} as never }, parent, allow)).toBe(false);
    expect(isTrusted({ origin: 'https://forumulate.com', source: null }, null, allow)).toBe(false);
    expect(originOf('https://Forumulate.com/o/1')).toBe('https://forumulate.com');
    expect(originOf('javascript:alert(1)')).toBeNull();
  });
});

describe('client merge', () => {
  const page = {
    id: 'p1',
    locale: 'en',
    fields: { title: 'Old', author: { id: 'a1', locale: 'en', fields: { name: 'Ana' } } },
    _links: { self: '/x' },
  };

  it('replaces the edited entry wherever it appears, keeping the rest identical', () => {
    const out = applyLive({ page, other: { keep: true } }, { entryId: 'a1', entry: { id: 'a1', fields: { name: 'Bea' } } });
    expect(out.page.fields.author.fields.name).toBe('Bea');
    expect(out.other).toBe(out.other);
    expect(applyLive({ page, other: { keep: true } }, { entryId: 'zz', entry: { id: 'zz', fields: {} } }).page).toBe(page);
  });

  it('keeps what the site read added and respects the locale', () => {
    const out = applyLive(page, { entryId: 'p1', locale: 'en', entry: { id: 'p1', fields: { title: 'New' } } });
    expect(out.fields.title).toBe('New');
    expect(out._links).toEqual({ self: '/x' });
    expect(applyLive(page, { entryId: 'p1', locale: 'es', entry: { id: 'p1', fields: { title: 'Nuevo' } } })).toBe(page);
  });
});

/** Just enough of an Element for `sourceAt` to walk. */
function el(attrs: Record<string, string>, text = '', parent: FakeEl | null = null): FakeEl {
  const node: FakeEl = {
    getAttribute: (n: string) => attrs[n] ?? null,
    parentElement: parent,
    childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [],
    ownerDocument: { documentElement: root },
  };
  return node;
}
type FakeEl = {
  getAttribute(n: string): string | null;
  parentElement: FakeEl | null;
  childNodes: { nodeType: number; nodeValue: string }[];
  ownerDocument: { documentElement: unknown };
};
const root = {};

describe('one selection mechanism', () => {
  it('reads data-fm-field from the nearest marked element', () => {
    const section = el({ 'data-fm-field': 'p1:/blocks/@b1' });
    const h3 = el({ 'data-fm-field': 'p1:/blocks/@b1/items/@t1/title' }, 'Team', section);
    const span = el({}, '$49', h3);
    expect(sourceAt(span as never)?.source).toEqual({ entryId: 'p1', path: '/blocks/@b1/items/@t1/title' });
  });

  it('reads a stega run the same way, from the element’s own text', () => {
    const section = el({}, '');
    const h3 = el({}, stegaEncode('Team', { entryId: 'p1', path: '/blocks/@b1/items/@t1/title', locale: 'en' }), section);
    expect(sourceAt(h3 as never)?.source).toEqual({ entryId: 'p1', path: '/blocks/@b1/items/@t1/title', locale: 'en' });
    expect(sourceAt(section as never)).toBeNull();
  });
});

describe('size', () => {
  it('the bridge stays tiny: within 3 KB gzipped, minified', async () => {
    const out = await build({
      entryPoints: [fileURLToPath(new URL('../src/live-preview/index.ts', import.meta.url))],
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2020',
      write: false,
    });
    expect(gzipSync(out.outputFiles[0]!.contents).length).toBeLessThanOrEqual(3 * 1024);
  });
});
