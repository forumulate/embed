/**
 * Custom elements — the framework-agnostic way in, and what every framework
 * wrapper renders:
 *
 *   <forumulate-comments org="acme" space="blog"></forumulate-comments>
 *   <forumulate-widget   org="acme" space="docs" mode="ask"></forumulate-widget>
 *   <forumulate-search   org="acme" space="docs"></forumulate-search>
 *   <forumulate-changelog org="acme" space="changelog"></forumulate-changelog>
 *   <forumulate-feed     org="acme" space="blog" kind="posts" limit="5"></forumulate-feed>
 *
 * Light DOM, not shadow DOM: the hosted scripts render ordinary markup that
 * the site's own CSS can reach, which is the point of embedding into a site.
 *
 * The classes are created INSIDE `defineForumulateElements()` because
 * `HTMLElement` does not exist on the server; importing this module during SSR
 * is safe, and calling the function there is a no-op.
 */
import type { EmbedKind, Theme } from './options.js';
import { mount, unmount } from './mount.js';
import { FEED_CSS, feedHtml, fetchFeed, normalizeFeedKind } from './feed.js';

export const ELEMENT_TAGS = {
  comments: 'forumulate-comments',
  widget: 'forumulate-widget',
  search: 'forumulate-search',
  changelog: 'forumulate-changelog',
  feed: 'forumulate-feed',
} as const;

const COMMON = ['org', 'space', 'api', 'theme', 'locale', 'accent', 'radius', 'width', 'font', 'nonce'];
const EXTRA: Record<keyof typeof ELEMENT_TAGS, string[]> = {
  comments: ['topic', 'article-url'],
  widget: ['mode', 'placeholder'],
  search: ['placeholder'],
  changelog: [],
  feed: ['kind', 'limit', 'tag', 'category', 'href', 'excerpts'],
};

function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v == null || v === '' ? undefined : v;
}

function baseOptions(el: Element) {
  return {
    org: attr(el, 'org') ?? '',
    space: attr(el, 'space') ?? '',
    apiBase: attr(el, 'api'),
    theme: attr(el, 'theme') as Theme | undefined,
    locale: attr(el, 'locale'),
    accent: attr(el, 'accent'),
    radius: attr(el, 'radius'),
    width: attr(el, 'width'),
    font: attr(el, 'font'),
    // Browsers hide a `nonce` attribute once the element is connected (CSP
    // nonce hiding) and keep the value only on the IDL property.
    nonce: (el as HTMLElement).nonce || attr(el, 'nonce'),
  };
}

function emit(el: Element, type: string, detail?: unknown) {
  el.dispatchEvent(new CustomEvent(`forumulate:${type}`, { detail, bubbles: true }));
}

let feedCssInjected = false;
function injectFeedCss() {
  if (feedCssInjected || document.querySelector('style[data-forumulate-feed]')) return;
  feedCssInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-forumulate-feed', '');
  style.textContent = FEED_CSS;
  document.head.appendChild(style);
}

/**
 * Register the elements. Idempotent, SSR-safe; pass a scoped registry if you
 * have one. Returns false when there is no `customElements` (the server).
 */
export function defineForumulateElements(registry?: CustomElementRegistry): boolean {
  const reg = registry ?? (typeof customElements !== 'undefined' ? customElements : undefined);
  if (!reg || typeof HTMLElement === 'undefined') return false;

  abstract class ForumulateElement extends HTMLElement {
    private queued = false;
    private generation = 0;
    connectedCallback() {
      this.schedule();
    }
    disconnectedCallback() {
      this.generation++;
      this.teardown();
    }
    attributeChangedCallback() {
      if (this.isConnected) this.schedule();
    }
    /** Batch: a framework setting six attributes renders once, not six times. */
    private schedule() {
      if (this.queued) return;
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        if (!this.isConnected) return;
        if (!attr(this, 'org') || !attr(this, 'space')) return;
        const gen = ++this.generation;
        void Promise.resolve(this.render(() => gen === this.generation)).catch((e: unknown) =>
          emit(this, 'error', e),
        );
      });
    }
    protected abstract render(current: () => boolean): void | Promise<void>;
    protected teardown() {
      unmount(this);
    }
  }

  const scripted = (
    kind: EmbedKind,
    observed: string[],
    extra: (el: Element) => Record<string, unknown>,
  ) =>
    class extends ForumulateElement {
      static get observedAttributes() {
        return [...COMMON, ...observed];
      }
      protected render() {
        mount(kind, this, {
          ...baseOptions(this),
          ...extra(this),
          onLoad: () => emit(this, 'load'),
          onError: (error: Error) => emit(this, 'error', error),
        } as never);
      }
    };

  const classes: Record<keyof typeof ELEMENT_TAGS, CustomElementConstructor> = {
    comments: scripted('comments', EXTRA.comments, (el) => ({ topic: attr(el, 'topic'), articleUrl: attr(el, 'article-url') })),
    widget: scripted('widget', EXTRA.widget, (el) => ({ mode: attr(el, 'mode'), placeholder: attr(el, 'placeholder') })),
    search: scripted('widget', EXTRA.search, (el) => ({ mode: 'search', placeholder: attr(el, 'placeholder') })),
    changelog: scripted('changelog', EXTRA.changelog, () => ({})),
    feed: class extends ForumulateElement {
      static get observedAttributes() {
        return [...COMMON, ...EXTRA.feed];
      }
      protected async render(current: () => boolean) {
        injectFeedCss();
        const base = baseOptions(this);
        const limit = Number(attr(this, 'limit'));
        const opts = {
          ...base,
          kind: normalizeFeedKind(attr(this, 'kind')),
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
          tag: attr(this, 'tag'),
          category: attr(this, 'category'),
          href: attr(this, 'href'),
          excerpts: attr(this, 'excerpts') !== 'false',
        };
        this.setAttribute('aria-busy', 'true');
        try {
          const items = await fetchFeed(opts);
          if (!current()) return;
          this.innerHTML = feedHtml(items, opts);
          emit(this, 'load', items);
        } finally {
          if (current()) this.removeAttribute('aria-busy');
        }
      }
      protected teardown() {
        // Server-rendered markup (same feedHtml) is left in place until the
        // fresh list replaces it, so a hydrated feed never flashes empty.
      }
    },
  };

  for (const [key, tag] of Object.entries(ELEMENT_TAGS)) {
    if (!reg.get(tag)) reg.define(tag, classes[key as keyof typeof ELEMENT_TAGS]);
  }
  return true;
}
