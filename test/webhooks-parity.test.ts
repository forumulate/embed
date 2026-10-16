import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const sdk = here('../../sdk/src/webhooks.ts');

describe('webhook verifier parity', () => {
  // The SDK source exists only in the monorepo, not in the public mirror.
  it.skipIf(!existsSync(sdk))('is byte-for-byte the SDK verifier after the copy note', () => {
    const ours = readFileSync(here('../src/content/webhooks.ts'), 'utf8');
    const body = ours.slice(ours.indexOf('*/\n') + 3);
    expect(body).toBe(readFileSync(sdk, 'utf8'));
  });
});
