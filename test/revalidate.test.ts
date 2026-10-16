import { describe, expect, it, vi } from 'vitest';
import { handleRevalidate, tagsFromPayload } from '../src/content/server.js';
import { publishPayload, sign, webhookRequest } from './helpers.js';

const secret = 'whsec_test';

describe('handleRevalidate', () => {
  it('verifies a good v1 signature and revalidates tags + affectedTags once each', async () => {
    const revalidate = vi.fn();
    const res = await handleRevalidate(webhookRequest(secret, publishPayload), { secret, revalidate });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual(['fm:entry:en_1', 'fm:type:lib_1:post', 'fm:entry:en_9']);
    expect(body.paths).toEqual(['/blog/hello', '/blog/hi']);
    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]![0].event).toBe('content.entry.published');
  });

  it('accepts a header listing several signatures (rotation)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(publishPayload);
    const header = `${sign('old_secret', body, ts)}, ${sign(secret, body, ts)}`;
    const res = await handleRevalidate(webhookRequest(secret, body, { timestamp: ts, signature: header }), { secret, revalidate: vi.fn() });
    expect(res.status).toBe(200);
  });

  it('refuses a bad signature without touching the cache', async () => {
    const revalidate = vi.fn();
    const res = await handleRevalidate(webhookRequest('wrong', publishPayload), { secret, revalidate });
    expect(res.status).toBe(401);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('refuses a delivery outside the tolerance window (replay)', async () => {
    const revalidate = vi.fn();
    const old = Math.floor(Date.now() / 1000) - 3600;
    const res = await handleRevalidate(webhookRequest(secret, publishPayload, { timestamp: old }), { secret, revalidate });
    expect(res.status).toBe(401);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('refuses a tampered body', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const signature = sign(secret, JSON.stringify(publishPayload), ts);
    const tampered = { ...publishPayload, data: { ...publishPayload.data, tags: ['fm:everything'] } };
    const res = await handleRevalidate(webhookRequest(secret, tampered, { timestamp: ts, signature }), { secret, revalidate: vi.fn() });
    expect(res.status).toBe(401);
  });

  it('answers 405 to anything but POST and 400 to a signed non-JSON body', async () => {
    const get = await handleRevalidate(webhookRequest(secret, '', { method: 'GET' }), { secret, revalidate: vi.fn() });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const bad = await handleRevalidate(webhookRequest(secret, 'not json'), { secret, revalidate: vi.fn() });
    expect(bad.status).toBe(400);
  });

  it('verifies a ping and revalidates nothing', async () => {
    const revalidate = vi.fn();
    const res = await handleRevalidate(webhookRequest(secret, { event: 'ping', data: { message: 'hi' } }), { secret, revalidate });
    expect(res.status).toBe(200);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('ignores non-string tags', () => {
    expect(tagsFromPayload({ data: { tags: ['a', 3 as unknown as string, ''], affectedTags: undefined } })).toEqual(['a']);
  });
});
