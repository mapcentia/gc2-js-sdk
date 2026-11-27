import { describe, it, expect, vi } from 'vitest';
import { createCentiaClient } from '../http/client';
import { Symbols } from '../symbols/Symbols';
import { Legends, legendImageUrl } from '../legends/Legends';

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => (body !== null && body !== undefined ? JSON.stringify(body) : ''),
    headers: { get: () => null },
  } as unknown as Response);
}

function createHttp(fetchFn: typeof globalThis.fetch, withToken = true) {
  return createCentiaClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
    auth: withToken ? { getAccessToken: async () => 'test-token' } : undefined,
  });
}

function lastCall(fetchFn: typeof globalThis.fetch) {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const arrow = { name: 'arrow', type: 'vector', filled: true, points: [[0, 0.4], [3, 0.4]], anchorpoint: [0, 0.5] };
const circle = { name: 'circle', type: 'ellipse', filled: true, points: [[1, 1]] };

describe('Symbols', () => {
  it('getSymbol lists all with the token', async () => {
    const fetchFn = mockFetch(200, [circle, arrow]);
    const result = await new Symbols(createHttp(fetchFn)).getSymbol();
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/symbols');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual([circle, arrow]);
  });

  it('getSymbol gets one by name', async () => {
    const fetchFn = mockFetch(200, arrow);
    const result = await new Symbols(createHttp(fetchFn)).getSymbol('dash-dot-dot');
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/symbols/dash-dot-dot');
    expect(result).toEqual(arrow);
  });

  it('getSymbol with a name list joins with commas and always returns an array', async () => {
    const fetchFn = mockFetch(200, [arrow, circle]);
    expect(await new Symbols(createHttp(fetchFn)).getSymbol(['arrow', 'circle'])).toEqual([arrow, circle]);
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/symbols/arrow,circle');

    const single = mockFetch(200, arrow);
    expect(await new Symbols(createHttp(single)).getSymbol(['arrow'])).toEqual([arrow]);

    const none = mockFetch(200, []);
    expect(await new Symbols(createHttp(none)).getSymbol([])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });

  it('throws CentiaApiError for an unknown symbol', async () => {
    const fetchFn = mockFetch(404, { code: 'SYMBOL_NOT_FOUND', message: 'No such symbol' });
    await expect(new Symbols(createHttp(fetchFn)).getSymbol('nope'))
      .rejects.toMatchObject({ status: 404, code: 'SYMBOL_NOT_FOUND' });
  });
});

describe('Legends', () => {
  const legend = {
    id: 'my_schema.roads',
    title: 'Roads',
    classes: [{ name: 'Motorvej', expression: "[type]='motorvej'", img: 'iVBORw0KGgo' }],
  };

  it('getLegend sends the layers as a comma list', async () => {
    const fetchFn = mockFetch(200, [legend]);
    const result = await new Legends(createHttp(fetchFn)).getLegend('my_database', ['my_schema.roads', 'my_schema']);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/legends/database/my_database/my_schema.roads,my_schema');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual([legend]);
  });

  it('getLegend accepts a comma separated string and works without credentials', async () => {
    const fetchFn = mockFetch(200, []);
    const result = await new Legends(createHttp(fetchFn, false)).getLegend('my_database', 'my_schema.roads, my_schema.b');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/legends/database/my_database/my_schema.roads,my_schema.b');
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(result).toEqual([]);
  });

  it('getLegend makes no request for an empty layer list', async () => {
    const fetchFn = mockFetch(200, [legend]);
    expect(await new Legends(createHttp(fetchFn)).getLegend('my_database', [])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws CentiaApiError when the token is for another database', async () => {
    const fetchFn = mockFetch(401, { code: 'TOKEN_DATABASE_MISMATCH', message: 'Wrong database' });
    await expect(new Legends(createHttp(fetchFn)).getLegend('other_db', 'my_schema'))
      .rejects.toMatchObject({ status: 401, code: 'TOKEN_DATABASE_MISMATCH' });
  });

  it('legendImageUrl builds a data URL', () => {
    expect(legendImageUrl('iVBORw0KGgo')).toBe('data:image/png;base64,iVBORw0KGgo');
    expect(legendImageUrl(null)).toBeNull();
  });
});
