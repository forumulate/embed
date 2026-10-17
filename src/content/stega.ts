/**
 * Stega (spec §5 L4): where a preview string came from, hidden inside it.
 *
 * A library that switches `settings.preview.stega` on gets every text field of
 * its PREVIEW responses with an invisible run appended: a marker, then the
 * source `{entryId, path, locale}` as JSON, four zero-width characters per
 * UTF-8 byte. A click-to-edit overlay reads the run off the text a visitor
 * clicked and opens that field, with no `data-fm-field` annotation anywhere in
 * the site. Published responses never carry it (the API encodes on the
 * preview branch only).
 *
 * The run is invisible but not absent, so `title === 'Pricing'` is false in a
 * preview. `stegaClean` takes it off a string, or off every string in an
 * object or array, and leaves anything else alone.
 *
 * The run is recognised only as marker + whole bytes: U+2063 never occurs
 * inside an emoji sequence, so a person's ZWJ emoji or a word joiner in real
 * copy survives cleaning untouched.
 */
export interface StegaSource {
  entryId: string;
  /** The field, as a JSON pointer with row segments `@<rowId>` (spec 3.2). */
  path: string;
  locale?: string;
}

const MARK = '⁣';
const DIGITS = ['​', '‌', '‍', '﻿'];
const RUN = /\u2063(?:[\u200D\u200B\u200C\uFEFF]{4})+/g;

/** `text` with `source` hidden at its end (any run it already carried is replaced). */
export function stegaEncode(text: string, source: StegaSource): string {
  const json = JSON.stringify({ e: source.entryId, p: source.path, ...(source.locale ? { l: source.locale } : {}) });
  let run = MARK;
  for (const byte of new TextEncoder().encode(json)) {
    for (let shift = 6; shift >= 0; shift -= 2) run += DIGITS[(byte >> shift) & 3];
  }
  return stegaClean(text) + run;
}

/** The source hidden in `text`, or null when it carries none (or a run that does not decode). */
export function stegaDecode(text: string): StegaSource | null {
  for (const match of text.match(RUN) ?? []) {
    const chars = match.slice(1);
    const bytes = new Uint8Array(chars.length / 4);
    for (let i = 0; i < bytes.length; i++) {
      let b = 0;
      for (let j = 0; j < 4; j++) b = (b << 2) | DIGITS.indexOf(chars[i * 4 + j]!);
      bytes[i] = b;
    }
    try {
      const v = JSON.parse(new TextDecoder().decode(bytes)) as { e?: unknown; p?: unknown; l?: unknown };
      if (typeof v.e === 'string' && typeof v.p === 'string')
        return { entryId: v.e, path: v.p, ...(typeof v.l === 'string' ? { locale: v.l } : {}) };
    } catch {
      // Not ours: keep looking.
    }
  }
  return null;
}

/** `value` with every stega run removed — a string, or every string inside an array or plain object. */
export function stegaClean<T>(value: T): T {
  if (typeof value === 'string') return value.replace(RUN, '') as T;
  if (Array.isArray(value)) return value.map((v) => stegaClean(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stegaClean(v);
    return out as T;
  }
  return value;
}
