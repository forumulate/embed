import { stegaDecode } from '../content/stega.js';
import { parseFieldAttr, type FieldSource } from './protocol.js';

/**
 * Which field an element on the page shows — the ONE way the bridge answers
 * that, whichever way the site marked it (spec 5 L3/L4):
 *
 *  - `data-fm-field="<entryId>:<pointer>"`, which `<Content>`, `<Field>` and
 *    `fieldAttrs()` emit in preview sessions only; or
 *  - a stega run in the element's own text, when the library has stega on and
 *    the site renders strings with no annotation at all.
 *
 * Both decode to the same `{entryId, path, locale}`, so hover outlines,
 * double-click and the studio's mapping never need to know which it was.
 * Nearest element wins, walking up from where the pointer is; at one element
 * the attribute beats stega, because it is the site's explicit word.
 */
export function sourceAt(start: Element | null): { el: Element; source: FieldSource } | null {
  for (let el = start; el && el !== el.ownerDocument.documentElement; el = el.parentElement) {
    const attr = parseFieldAttr(el.getAttribute('data-fm-field'));
    if (attr) return { el, source: attr };
    const text = ownText(el);
    const stega = text ? stegaDecode(text) : null;
    if (stega && stega.path.startsWith('/')) return { el, source: stega };
  }
  return null;
}

/**
 * The element's own text and the text-bearing attributes a string field ends
 * up in — not its descendants', or a section's stega would be read from the
 * first heading inside it and every click would open that heading.
 */
function ownText(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) if (node.nodeType === 3) out += node.nodeValue ?? '';
  for (const name of ['alt', 'title', 'aria-label', 'placeholder']) out += el.getAttribute(name) ?? '';
  return out;
}
