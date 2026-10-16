import { describe, expect, it } from 'vitest';
import { imageSrcSet, imageUrl, snapWidth } from '../src/content/index.js';

const media = {
  url: 'https://cdn.test/assets/a1',
  width: 1700,
  height: 900,
  variants: { '1280': 'https://cdn.test/assets/a1?w=1280' },
};

describe('image helpers', () => {
  it('snaps to the allow-list', () => {
    expect(snapWidth(1)).toBe(32);
    expect(snapWidth(1100)).toBe(1280);
    expect(snapWidth(9999)).toBe(2560);
  });

  it('prefers a listed variant and adds aspect and fit', () => {
    expect(imageUrl(media, { w: 1200 })).toBe('https://cdn.test/assets/a1?w=1280');
    expect(imageUrl(media, { w: 1200, ar: '16:9', fit: 'cover' })).toBe('https://cdn.test/assets/a1?w=1280&ar=16%3A9&fit=cover');
    expect(imageUrl(media, { w: 500 })).toBe('https://cdn.test/assets/a1?w=512');
  });

  it('drops parameters outside the closed set', () => {
    expect(imageUrl(media, { ar: '7:5' as '1:1', fit: 'fill' as 'cover' })).toBe('https://cdn.test/assets/a1');
  });

  it('takes a bare URL and tolerates nothing', () => {
    expect(imageUrl('/assets/x#frag', { w: 64 })).toBe('/assets/x?w=64#frag');
    expect(imageUrl(null)).toBe('');
  });

  it('builds a srcset up to the source width', () => {
    const set = imageSrcSet(media);
    expect(set.split(', ').at(-1)).toBe('https://cdn.test/assets/a1?w=1600 1600w');
    expect(set).toContain('https://cdn.test/assets/a1?w=1280 1280w');
    expect(set).not.toContain('1920w');
  });
});
