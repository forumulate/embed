import { describe, expect, it, vi } from 'vitest';
import {
  clearPreviewCookie,
  handleExitPreview,
  handlePreview,
  previewCookie,
  readPreviewCredential,
  safeRelativePath,
} from '../src/content/server.js';
import { jsonResponse, mockFetch } from './helpers.js';

const form = (fields: Record<string, string>, url = 'https://site.example/api/preview') =>
  new Request(url, { method: 'POST', body: new URLSearchParams(fields) });

const exchangeOk = () =>
  mockFetch(() => jsonResponse({ credential: 'pcred_123', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }));

describe('safeRelativePath', () => {
  it.each(['/', '/pricing', '/blog/hello?x=1#top', '/a/../b'])('keeps %s on the origin', (p) => {
    expect(safeRelativePath(p)).toMatch(/^\/(?!\/)/);
  });
  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/..//evil.com',
    'javascript:alert(1)',
    'pricing',
    '',
    ' /pricing',
    `/${'a'.repeat(3000)}`,
  ])('refuses %j', (p) => {
    expect(safeRelativePath(p)).toBeNull();
  });
  it('normalises dot segments', () => {
    expect(safeRelativePath('/a/../b')).toBe('/b');
  });
});

describe('preview cookie', () => {
  it('is httpOnly, Secure, SameSite=None and Partitioned, an hour at most', () => {
    const c = previewCookie('v a', { maxAge: 99_999 });
    expect(c).toBe('fm_preview=v%20a; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=None; Partitioned');
    expect(clearPreviewCookie()).toMatch(/^fm_preview=; Path=\/; Max-Age=0;.*HttpOnly; Secure; SameSite=None; Partitioned$/);
  });
  it('reads back from a Cookie header', () => {
    expect(readPreviewCredential('a=1; fm_preview=v%20a; b=2')).toBe('v a');
    expect(readPreviewCredential('fm_preview_x=1')).toBeUndefined();
    expect(readPreviewCredential(null)).toBeUndefined();
  });
});

describe('handlePreview', () => {
  it('exchanges the token server-side, sets the cookie and redirects to the path', async () => {
    const m = exchangeOk();
    const enable = vi.fn();
    const res = await handlePreview(form({ token: 'tok', path: '/pricing' }), {
      baseUrl: 'https://f.test/api',
      library: 'lib_1',
      fetch: m.fetch,
      enable,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pricing');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^fm_preview=pcred_123; Path=\/; Max-Age=(3599|3600); HttpOnly; Secure; SameSite=None; Partitioned$/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(m.calls[0]!.url).toBe('https://f.test/api/delivery/v1/preview/exchange');
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ token: 'tok', path: '/pricing', library: 'lib_1' });
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ credential: 'pcred_123' }));
  });

  it('accepts JSON too', async () => {
    const req = new Request('https://site.example/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok', path: '/x' }),
    });
    const res = await handlePreview(req, { fetch: exchangeOk().fetch });
    expect(res.headers.get('location')).toBe('/x');
  });

  it.each(['https://evil.com/phish', '//evil.com', '/\\evil.com', '/..//evil.com'])(
    'refuses the open redirect %s before exchanging anything',
    async (path) => {
      const m = exchangeOk();
      const res = await handlePreview(form({ token: 'tok', path }), { fetch: m.fetch });
      expect(res.status).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(m.calls).toHaveLength(0);
    },
  );

  it('refuses GET, so a token never travels in a URL', async () => {
    const res = await handlePreview(new Request('https://site.example/api/preview?token=tok'), { fetch: exchangeOk().fetch });
    expect(res.status).toBe(405);
  });

  it('refuses a missing token and a rejected one, setting no cookie', async () => {
    expect((await handlePreview(form({ path: '/' }), { fetch: exchangeOk().fetch })).status).toBe(400);
    const enable = vi.fn();
    const rejected = mockFetch(() => jsonResponse({ error: { code: 'preview.token_used' } }, 401));
    const res = await handlePreview(form({ token: 'reused', path: '/' }), { fetch: rejected.fetch, enable });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(enable).not.toHaveBeenCalled();
  });

  it('answers 502 when the API is unreachable', async () => {
    const down = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect((await handlePreview(form({ token: 't' }), { fetch: down.fetch })).status).toBe(502);
  });
});

describe('handleExitPreview', () => {
  const exit = (fields: Record<string, string> = {}, url = 'https://site.example/api/exit-preview') =>
    new Request(url, { method: 'POST', body: new URLSearchParams(fields) });

  it('clears the cookie and goes back to a relative path', async () => {
    const disable = vi.fn();
    const res = await handleExitPreview(exit({ path: '/pricing' }), { disable });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pricing');
    expect(res.headers.get('set-cookie')).toBe(clearPreviewCookie());
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=None; Partitioned');
    expect(disable).toHaveBeenCalled();
  });

  it('takes the path from the query string of a POST too', async () => {
    const res = await handleExitPreview(exit({}, 'https://site.example/x?path=/blog'));
    expect(res.headers.get('location')).toBe('/blog');
  });

  it('defaults to / and refuses an absolute or protocol-relative path', async () => {
    expect((await handleExitPreview(exit())).headers.get('location')).toBe('/');
    for (const path of ['https://evil.com', '//evil.com', '/\\evil.com']) {
      const evil = await handleExitPreview(exit({ path }));
      expect(evil.status).toBe(400);
      expect(evil.headers.get('set-cookie')).toBeNull();
    }
  });

  it('refuses GET, so a prefetched link cannot end a preview', async () => {
    const disable = vi.fn();
    const res = await handleExitPreview(new Request('https://site.example/api/exit-preview?path=/'), { disable });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(disable).not.toHaveBeenCalled();
  });
});
