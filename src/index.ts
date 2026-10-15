/**
 * @forumulate/embed — Forumulate on any website.
 *
 * - Custom elements: `defineForumulateElements()` (or import `@forumulate/embed/elements`).
 * - Imperative: `mountComments`, `mountWidget`, `mountChangelog`, `unmount`.
 * - Content: `createClient({ org, space })` over the public read API.
 *
 * Importing this module has no side effects and never touches `window`.
 */
export * from './options.js';
export * from './mount.js';
export * from './client.js';
export * from './feed.js';
export { defineForumulateElements, ELEMENT_TAGS } from './define.js';
export const VERSION = '1.1.0';
