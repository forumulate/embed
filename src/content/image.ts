/**
 * URLs for the delivery media shape (spec §3.9).
 *
 * The API's transforms are a CLOSED set — widths from an allow-list, height
 * only through an allow-listed aspect, `fit` cover|contain, format from
 * `Accept` — because an open resize parameter is a CPU amplification vector
 * (`apps/api/src/assets/image-variant.ts`). So these helpers snap to that set
 * instead of passing a number through: a free `w=1100` would be refused or
 * rounded on the server anyway, and snapping here keeps every URL a site emits
 * one the CDN has already seen.
 */
import type { Media } from './types.js';

/** The widths the API will produce (`ASSET_VARIANT_WIDTHS` plus the hero sizes). */
export const IMAGE_WIDTHS = [32, 64, 128, 256, 512, 1024, 1280, 1600, 1920, 2560] as const;
export const IMAGE_ASPECTS = ['1:1', '4:3', '3:2', '16:9', '21:9'] as const;

export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

export interface ImageOptions {
  /** Wanted width in CSS pixels × density; snapped UP to the next allowed width. */
  w?: number;
  /** Crop to an aspect ratio. */
  ar?: ImageAspect;
  /** `cover` crops around the focal point; `contain` letterboxes. */
  fit?: 'cover' | 'contain';
}

/** The smallest allowed width at or above `w` (the largest if `w` is beyond them all). */
export function snapWidth(w: number): number {
  return IMAGE_WIDTHS.find((x) => x >= w) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

function withParams(url: string, params: [string, string][]): string {
  if (!params.length) return url;
  const [path, hash = ''] = url.split('#', 2) as [string, string?];
  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${path}${path.includes('?') ? '&' : '?'}${qs}${hash ? `#${hash}` : ''}`;
}

/**
 * A URL for `media` at a size: the pre-sized variant when the API listed one,
 * otherwise the original with the allowed parameters. Unknown aspects and fits
 * are dropped rather than sent, so a typo can't turn into a 4xx on a live page.
 */
export function imageUrl(media: Media | string | null | undefined, o: ImageOptions = {}): string {
  if (!media) return '';
  const m: Media = typeof media === 'string' ? { url: media } : media;
  const params: [string, string][] = [];
  let url = m.url;
  if (o.w && o.w > 0) {
    const w = snapWidth(o.w);
    const variant = m.variants?.[String(w)];
    if (variant) url = variant;
    else params.push(['w', String(w)]);
  }
  if (o.ar && (IMAGE_ASPECTS as readonly string[]).includes(o.ar)) params.push(['ar', o.ar]);
  if (o.fit === 'cover' || o.fit === 'contain') params.push(['fit', o.fit]);
  return withParams(url, params);
}

/**
 * A `srcset` over the allowed widths up to the image's own width (a variant
 * wider than its source is the source again, at a second URL).
 */
export function imageSrcSet(media: Media | null | undefined, o: Omit<ImageOptions, 'w'> = {}): string {
  if (!media) return '';
  const max = media.width ?? Infinity;
  const widths = IMAGE_WIDTHS.filter((w) => w <= max);
  if (!widths.length) widths.push(IMAGE_WIDTHS[0]);
  return widths.map((w) => `${imageUrl(media, { ...o, w })} ${w}w`).join(', ');
}
