/**
 * The shapes the PUBLIC read API answers with — the fields a website renders.
 *
 * Hand-written subsets of the OpenAPI components (`ReaderPage`, `ArticleSummary`,
 * `ArticleDetail`, `SearchHit`, ...) so this package has no dependency on the
 * generated SDK. Every interface is open (`[key: string]: unknown`): the API
 * returns more than is listed here and adds fields without notice, and a site
 * should be able to read them without a cast to `any`.
 */

/** ProseMirror/TipTap JSON — Forumulate's block model. Render it, or ask for Markdown instead. */
export interface BlockDoc {
  type: 'doc';
  content?: BlockNode[];
  [key: string]: unknown;
}

export interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type SpaceType =
  | 'BLOG'
  | 'CAREERS'
  | 'CHANGELOG'
  | 'CONTACT'
  | 'COURSES'
  | 'CUSTOM'
  | 'DOCS'
  | 'EVENTS'
  | 'FAQ'
  | 'FORUM'
  | 'LEGAL'
  | 'ROADMAP'
  | 'STATUS';

export interface SpaceInfo {
  id: string;
  name: string;
  slug: string;
  type: SpaceType;
  description: string | null;
  [key: string]: unknown;
}

/** One node of a docs space's navigation tree. */
export interface PageNode {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
  sortKey: string;
  updatedAt?: string;
  icon?: string | null;
  externalUrl?: string | null;
  hideFromNav?: boolean;
  children?: PageNode[];
  [key: string]: unknown;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  pages: PageNode[];
  [key: string]: unknown;
}

/** `GET /public/orgs/:org/spaces/:space` — a space's front door. */
export interface SpaceOverview {
  space: SpaceInfo;
  organization: { id: string; name: string; slug?: string; [key: string]: unknown } | null;
  collections: Collection[];
  homePageId: string | null;
  locale: string;
  locales: unknown[];
  version: string;
  versions: unknown[];
  [key: string]: unknown;
}

/** A docs page flattened out of the navigation tree, depth-first in nav order. */
export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
  depth: number;
  collection: { id: string; slug: string; name: string };
  updatedAt?: string;
  externalUrl?: string | null;
  hideFromNav?: boolean;
}

/** `GET …/pages/:pageId` */
export interface Page {
  id: string;
  slug: string;
  title: string;
  content: BlockDoc;
  updatedAt: string;
  locale: string;
  version: string;
  metadata: Record<string, unknown>;
  contributors: unknown[];
  localeLinks: unknown[];
  versionLinks: unknown[];
  [key: string]: unknown;
}

/** A blog post, forum topic or changelog release in a list. */
export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  kind: string;
  state: string;
  authorName: string | null;
  authorUsername?: string;
  coverUrl: string | null;
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  readingMinutes: number;
  replyCount: number;
  viewCount: number;
  voteCount: number;
  pinned: boolean;
  releaseVersion: string | null;
  [key: string]: unknown;
}

export interface Post {
  id: string;
  postNumber: number;
  authorName: string | null;
  authorUsername?: string;
  content: BlockDoc;
  createdAt: string;
  editedAt: string | null;
  isOp: boolean;
  parentPostId: string | null;
  voteCount: number;
  [key: string]: unknown;
}

/** A single blog post / topic / release with its body (`op`) and replies. */
export interface Article extends ArticleSummary {
  op: Post;
  replies: Post[];
  seo: Record<string, unknown>;
  authors: unknown[];
  fields: Record<string, unknown>;
}

export interface SearchHit {
  pageId: string;
  collectionId: string;
  slug: string;
  title: string;
  snippet: string;
  url?: string;
  rank?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Queries shorter than this match nothing by design (the space's setting). */
  minQueryLength: number;
}

/** A page of a list. Follow `nextCursor` while `hasMore`. */
export interface Paged<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  total?: number;
}
