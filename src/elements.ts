/**
 * Side-effect entry: importing this registers every `<forumulate-*>` element.
 * Made for a no-build site:
 *
 *   <script type="module" src="https://cdn.jsdelivr.net/npm/@forumulate/embed@1"></script>
 *   <forumulate-comments org="acme" space="blog"></forumulate-comments>
 */
import { defineForumulateElements } from './define.js';

export { defineForumulateElements, ELEMENT_TAGS } from './define.js';

defineForumulateElements();
