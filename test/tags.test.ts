import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentTags, normalizeRoutePath, routePathHash, routeTag } from '../src/content/index.js';

describe('content tags', () => {
  it('match the API grammar', () => {
    expect(contentTags.entry('e1')).toBe('fm:entry:e1');
    expect(contentTags.type('sp', 'post')).toBe('fm:type:sp:post');
    expect(contentTags.global('sp', 'site')).toBe('fm:global:sp:site');
  });

  it.each([
    ['', '/'],
    ['/', '/'],
    ['pricing', '/pricing'],
    ['//blog///hello/', '/blog/hello'],
    ['/Pricing?x=1#a', '/Pricing'],
  ])('normalises %j to %j', (input, out) => {
    expect(normalizeRoutePath(input)).toBe(out);
  });

  it('hashes the normalised path with SHA-256, 16 hex chars', async () => {
    const want = createHash('sha256').update('/blog/hello').digest('hex').slice(0, 16);
    expect(await routePathHash('/blog/hello/')).toBe(want);
    expect(await routeTag('sp', 'blog/hello')).toBe(`fm:route:sp:${want}`);
  });
});
