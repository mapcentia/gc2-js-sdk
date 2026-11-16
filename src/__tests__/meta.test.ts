import { describe, it, expect, vi } from 'vitest';
import { CentiaHttpClient } from '../http/client';
import Meta from '../Meta';

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => (body !== null && body !== undefined ? JSON.stringify(body) : ''),
    headers: {
      get: () => null,
    },
  } as unknown as Response);
}

function lastCall(fetchFn: typeof globalThis.fetch) {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

function createMeta(fetchFn: typeof globalThis.fetch) {
  const http = new CentiaHttpClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
  });
  return new Meta(http);
}

describe('Meta', () => {
  it('query sends GET without query string by default', async () => {
    const fetchFn = mockFetch(200, { schemas: [] });
    const meta = createMeta(fetchFn);

    await meta.query('public.items');

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/meta/public.items');
    expect(init.method).toBe('GET');
  });

  it('query sends noRestriction query parameter when set', async () => {
    const fetchFn = mockFetch(200, { schemas: [] });
    const meta = createMeta(fetchFn);

    await meta.query('public.items', { noRestriction: true });

    const [url] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/meta/public.items?noRestriction=true');
  });
});
