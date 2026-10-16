import { describe, expect, it } from 'vitest';
import { stegaClean, stegaDecode, stegaEncode } from '../src/content/stega.js';

const source = { entryId: '6f1c2b1e-0000-4000-8000-000000000001', path: '/layout/@k3f9a/heading', locale: 'es-MX' };

describe('stega', () => {
  it('round-trips a source through a string that still reads the same', () => {
    const s = stegaEncode('Precios — ¡hola!', source);
    expect(s.startsWith('Precios — ¡hola!')).toBe(true);
    expect(s.length).toBeGreaterThan('Precios — ¡hola!'.length);
    expect(stegaDecode(s)).toEqual(source);
    expect(stegaClean(s)).toBe('Precios — ¡hola!');
  });

  it('replaces a run rather than stacking a second one', () => {
    const twice = stegaEncode(stegaEncode('Hi', source), { entryId: 'b', path: '/title' });
    expect(stegaDecode(twice)).toEqual({ entryId: 'b', path: '/title' });
    expect(stegaClean(twice)).toBe('Hi');
  });

  it('leaves real zero-width characters in copy alone', () => {
    const family = 'we are 👩‍👩‍👧 and⁠joined​';
    expect(stegaClean(family)).toBe(family);
    expect(stegaDecode(family)).toBeNull();
    expect(stegaClean(stegaEncode(family, source))).toBe(family);
  });

  it('cleans every string in an entry and keeps everything else', () => {
    const date = new Date(0);
    const entry = {
      title: stegaEncode('Home', source),
      fields: { rows: [{ id: 'k3f9a', heading: stegaEncode('Hello', source), count: 3, on: true, none: null }] },
      when: date,
    };
    expect(stegaClean(entry)).toEqual({
      title: 'Home',
      fields: { rows: [{ id: 'k3f9a', heading: 'Hello', count: 3, on: true, none: null }] },
      when: date,
    });
  });
});
