import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('@forumulate/embed/content size', () => {
  it('stays within 6 KB gzipped, minified', async () => {
    const out = await build({
      entryPoints: [fileURLToPath(new URL('../src/content/index.ts', import.meta.url))],
      bundle: true,
      minify: true,
      format: 'esm',
      target: 'es2020',
      write: false,
    });
    const bytes = gzipSync(out.outputFiles[0]!.contents).length;
    expect(bytes).toBeLessThanOrEqual(6 * 1024);
  });
});
