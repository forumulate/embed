/**
 * @forumulate/embed/live-preview — the site half of live preview and
 * click-to-edit (headless CMS spec 5, L2/L3). A separate entry so a page that
 * never previews never ships it; framework hooks (`useLivePreview` in
 * `@forumulate/next/live-preview`) are thin wrappers over this.
 */
export { connectLivePreview, type LivePreviewOptions } from './bridge.js';
export { applyLive } from './merge.js';
export { sourceAt } from './source.js';
export {
  PROTOCOL_VERSION,
  isFieldPointer,
  isTrusted,
  originOf,
  parseFieldAttr,
  parseSiteMessage,
  parseStudioMessage,
  type FieldSource,
  type LiveMessage,
  type ReadyMessage,
  type Rect,
  type SavedMessage,
  type SelectMessage,
  type SiteMessage,
  type StudioMessage,
} from './protocol.js';
