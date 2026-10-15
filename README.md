# @forumulate/embed

Add Forumulate to any website: embedded **comments**, a docs **search / ask-AI** box, a
**"What's new" changelog** bell, a **feed** of your latest posts, topics or releases, and a
typed **content client** for the public read API (build time or runtime).

Framework-agnostic and dependency-free. Every framework package below is a thin layer over it.

| Framework | Package | What you get |
| --- | --- | --- |
| Any site, no build | `@forumulate/embed` (this) | `<forumulate-*>` custom elements, `mountComments()` & co, `createClient()` |
| React | [`@forumulate/react`](https://github.com/forumulate/react) | components, provider, content hooks |
| Preact | [`@forumulate/preact`](https://github.com/forumulate/preact) | components, provider, content hooks |
| Next.js | [`@forumulate/next`](https://github.com/forumulate/next) | server fetchers with `revalidate` + cache tags, client components |
| React Router 7 / Remix | [`@forumulate/remix`](https://github.com/forumulate/remix) | loader helpers, components |
| Vue 3 | [`@forumulate/vue`](https://github.com/forumulate/vue) | components, plugin, composables |
| Nuxt | [`@forumulate/nuxt`](https://github.com/forumulate/nuxt) | module: auto-registered components + composables |
| Svelte / SvelteKit | [`@forumulate/svelte`](https://github.com/forumulate/svelte) | components, action, stores, load helpers |
| SolidJS | [`@forumulate/solid`](https://github.com/forumulate/solid) | components, resources |
| Qwik | [`@forumulate/qwik`](https://github.com/forumulate/qwik) | components, loader helpers |
| Angular | [`@forumulate/angular`](https://github.com/forumulate/angular) | standalone components, `ForumulateService` |
| Astro | [`@forumulate/astro`](https://github.com/forumulate/astro) | components, Content Layer loader |
| Gatsby | [`@forumulate/gatsby`](https://github.com/forumulate/gatsby) | source plugin (GraphQL nodes), components |
| Docusaurus | [`@forumulate/docusaurus`](https://github.com/forumulate/docusaurus) | comments under docs pages, changelog page |
| Eleventy | [`@forumulate/eleventy`](https://github.com/forumulate/eleventy) | shortcodes, build-time data |

`org` and `space` are the ids or slugs shown in your space's **Embed on my site** panel.
Comments need a **forum** space; the changelog bell a **changelog** space; search a **docs** space.
On a custom domain, set `api` / `apiBase` to `https://your-domain/api`.

## No build step: custom elements

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@forumulate/embed@1"></script>

<forumulate-comments org="acme" space="community" theme="auto"></forumulate-comments>
<forumulate-search   org="acme" space="docs"></forumulate-search>
<forumulate-widget   org="acme" space="docs" mode="ask"></forumulate-widget>
<forumulate-changelog org="acme" space="changelog"></forumulate-changelog>
<forumulate-feed     org="acme" space="blog" kind="posts" limit="5" href="/blog/{slug}"></forumulate-feed>
```

(`https://unpkg.com/@forumulate/embed@1` works the same; both serve the single-file bundle
`dist/forumulate-elements.js`. Bundlers import `@forumulate/embed/elements` instead.)

Attributes: `org`, `space`, `api`, `theme` (`light` | `dark` | `auto`), `locale`, `accent`,
`radius`, `width`, `font`, `nonce`; comments add `topic` (a topic slug) and `article-url`;
the widget adds `mode` (`search` | `ask`) and `placeholder`; the feed adds `kind`
(`posts` | `topics` | `pages` | `releases`, or the space-type names `blog` | `forum` | `docs` | `changelog`), `limit`, `tag`, `category`, `href` and
`excerpts="false"`. The changelog adds `mode` (`dropdown` | `sidebar-left` | `sidebar-right` |
`modal` | `inline`), `selector` (open from your own button), `counter="false"`, `limit`,
`announce="false"` and `user` (segmentation, JSON: `user='{"plans":"Pro"}'`); unset, each
follows the changelog owner's defaults (`theme.changelog.widget`). Changing an attribute re-renders. Elements fire `forumulate:load` and
`forumulate:error` (bubbling `CustomEvent`s). The feed is styled by `.fm-feed*` classes and
the `--fm-accent`, `--fm-muted`, `--fm-line`, `--fm-font` custom properties.

## With a bundler

```sh
npm install @forumulate/embed
```

```ts
import { mountComments, createClient } from '@forumulate/embed';

const handle = mountComments(document.querySelector('#comments'), {
  org: 'acme',
  space: 'community',
  theme: 'auto',
});
// handle.update({ theme: 'dark' }); handle.unmount();

const forumulate = createClient({ org: 'acme', space: 'docs' });
const page = await forumulate.getPage('getting-started'); // block content
const md = await forumulate.getPageMarkdown('getting-started'); // rendered by the API
const { items } = await (createClient({ org: 'acme', space: 'blog' })).listPosts({ limit: 10 });
```

Client methods: `getSpace`, `listPages`, `getPage`, `getPageMarkdown`, `listPosts`, `getPost`,
`getPostMarkdown`, `listTopics`, `getTopic`, `getTopicMarkdown`, `listReleases`, `getRelease`,
`search`, plus `get(path)` for anything else under the space's public root. Lists return
`{ items, hasMore, nextCursor }`. Errors throw `ForumulateError` (`status`, `code`, `requestId`).
Every call takes `init` (merged into `fetch`), e.g. Next's `{ next: { revalidate: 60 } }`.

Importing the package has no side effects and never touches `window`, so it is safe in SSR,
SSG, edge and Node build scripts. `mount*` calls are no-ops on the server; `defineForumulateElements()`
returns `false` there.

Server templates can print the embeds without JavaScript of their own: `scriptTag('comments', opts)`
returns the `<script>` tag, and `feedHtml(await fetchFeed(opts))` the feed markup.

## Website builders

Each snippet is one container plus the hosted script. Replace `acme` / `community` with your
org and space.

**Plain HTML** — paste where the comments should appear:

```html
<div id="comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#comments" data-theme="auto" async></script>
```

**Webflow** — add an *Embed* element where the comments go (Site settings → Custom code is
not needed):

```html
<div id="forumulate-comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#forumulate-comments" async></script>
```

**Shopify** — Online Store → Themes → Customize → add a *Custom Liquid* section (or edit
`main-article.liquid`). Pinning the article URL keeps one thread per article across domains:

```liquid
<div id="forumulate-comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#forumulate-comments"
  data-article-url="{{ shop.url }}{{ article.url }}" async></script>
```

**Framer** — insert an *Embed* component, choose *HTML*, and paste:

```html
<div id="forumulate-comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#forumulate-comments" async></script>
```

**Squarespace** — add a *Code* block (Business plan or higher runs scripts):

```html
<div id="forumulate-comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#forumulate-comments" async></script>
```

**Wix** — Add → Embed Code → *Embed HTML* (the snippet runs in an iframe, so give it a height):

```html
<div id="forumulate-comments"></div>
<script src="https://forumulate.com/api/embed/comments.js"
  data-org="acme" data-space="community" data-mount="#forumulate-comments"
  data-article-url="https://www.your-site.com/post/your-post" async></script>
```

The same pattern works for the other embeds: `widget.js` (docs search; `data-mode="ask"` for
the AI answer box) and `changelog.js` (the "What's new" widget). Every script also reads `data-api`,
`data-theme`, `data-locale`, `data-accent`, `data-radius`, `data-width` and `data-font`.

`changelog.js` also reads `data-mode`, `data-selector`, `data-counter`, `data-limit`,
`data-announce` and `data-user-<field>` (`data-user-plans="Pro"`: only the releases for that
visitor). Each card links to the release's own page on the changelog's address. From your own
code: `window.Forumulate.changelog.open()`, `.close()`, `.toggle()`, `.count()` and
`.onCount(cb)`; the element (or the script's parent) also receives a bubbling
`forumulate:count` event with the unread count.

If your site sets a Content-Security-Policy, allow `script-src` and `connect-src` for the
Forumulate origin (and add the embedding host to your org's **embeddable hosts** to restrict
which sites may create comment threads).

## License

MIT

---

## About this repository

This repository is a public mirror, refreshed on each Forumulate release
(one commit per release). Pull requests are welcome; accepted changes are
applied upstream and arrive here with the next release.

- API reference: https://forumulate.com/reference
- Guides: https://forumulate.com/guides
- Community and support: https://forumulate.com/community
- Source: https://github.com/forumulate/embed
