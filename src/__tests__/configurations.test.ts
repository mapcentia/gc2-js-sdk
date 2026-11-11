import { describe, it, expect, vi } from 'vitest';
import { createCentiaClient } from '../http/client';
import { Configurations } from '../configurations/Configurations';

function mockFetch(status: number, body: unknown, headers?: Record<string, string>): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => (body !== null && body !== undefined ? JSON.stringify(body) : ''),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  } as unknown as Response);
}

function createHttp(fetchFn: typeof globalThis.fetch) {
  return createCentiaClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
    auth: {
      getAccessToken: async () => 'test-token',
      getHeaders: async () => ({ 'X-Extra': '1' }),
    },
  });
}

function lastCall(fetchFn: typeof globalThis.fetch) {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const cfg = {
  key: 'configuration_my_map_673211a0',
  name: 'My map',
  description: '',
  published: true,
  body: '{"brandName": "My map"}',
};

describe('Configurations', () => {
  it('getConfiguration lists all', async () => {
    const fetchFn = mockFetch(200, [cfg]);
    const result = await new Configurations(createHttp(fetchFn)).getConfiguration();
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/configurations');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual([cfg]);
  });

  it('getConfiguration encodes dashboard-made keys', async () => {
    const fetchFn = mockFetch(200, cfg);
    const result = await new Configurations(createHttp(fetchFn)).getConfiguration('configuration_a+b@c-d_1');
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/configurations/configuration_a%2Bb%40c-d_1');
    expect(result).toEqual(cfg);
  });

  it('getConfiguration with a key list joins with literal commas and always returns an array', async () => {
    const fetchFn = mockFetch(200, [cfg, cfg]);
    const c = new Configurations(createHttp(fetchFn));
    await c.getConfiguration(['configuration_a+1', 'configuration_b']);
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/configurations/configuration_a%2B1,configuration_b');

    const single = mockFetch(200, cfg);
    expect(await new Configurations(createHttp(single)).getConfiguration([cfg.key])).toEqual([cfg]);

    const none = mockFetch(200, [cfg]);
    expect(await new Configurations(createHttp(none)).getConfiguration([])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });

  it('postConfiguration sends POST and returns keys from Location', async () => {
    const fetchFn = mockFetch(201, null, { location: '/api/v4/configurations/configuration_a_1,configuration_b_2' });
    const body = [
      { name: 'a', description: '', published: false, body: '{}' },
      { name: 'b', description: 'x', published: true, body: '[]' },
    ];
    const result = await new Configurations(createHttp(fetchFn)).postConfiguration(body);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/configurations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(result).toEqual({
      location: '/api/v4/configurations/configuration_a_1,configuration_b_2',
      keys: ['configuration_a_1', 'configuration_b_2'],
    });
  });

  it('patchConfiguration sends PATCH with a partial body', async () => {
    const fetchFn = mockFetch(303, null, { location: '/api/v4/configurations/configuration_a_1' });
    const result = await new Configurations(createHttp(fetchFn)).patchConfiguration('configuration_a_1', { published: false });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/configurations/configuration_a_1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ published: false });
    expect(result).toEqual({ location: '/api/v4/configurations/configuration_a_1' });
  });

  it('deleteConfiguration sends DELETE for one or several keys', async () => {
    const fetchFn = mockFetch(204, null);
    const c = new Configurations(createHttp(fetchFn));
    await c.deleteConfiguration('configuration_a_1');
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/configurations/configuration_a_1');
    expect(lastCall(fetchFn)[1].method).toBe('DELETE');
    await c.deleteConfiguration(['configuration_a_1', 'configuration_b_2']);
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/configurations/configuration_a_1,configuration_b_2');
  });

  it('getPublicConfiguration reads anonymously', async () => {
    const fetchFn = mockFetch(200, [cfg]);
    const c = new Configurations(createHttp(fetchFn));
    expect(await c.getPublicConfiguration('mydb')).toEqual([cfg]);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/configurations/database/mydb');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-Extra']).toBeUndefined();

    await c.getPublicConfiguration('mydb', 'configuration_a+1');
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/configurations/database/mydb/configuration_a%2B1');
  });

  it('getPublicConfigurationBody fetches the .json form and returns it parsed', async () => {
    const fetchFn = mockFetch(200, { brandName: 'My map' });
    const c = new Configurations(createHttp(fetchFn));
    const result = await c.getPublicConfigurationBody<{ brandName: string }>('mydb', 'configuration_a+1');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/configurations/database/mydb/configuration_a%2B1.json');
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(result.brandName).toBe('My map');
    expect(c.publicConfigurationUrl('mydb', 'configuration_a+1')).toBe(url);
  });

  it('throws CentiaApiError with the API code', async () => {
    const fetchFn = mockFetch(404, { code: 'CONFIGURATION_NOT_FOUND', message: 'No such configuration' });
    await expect(new Configurations(createHttp(fetchFn)).getPublicConfiguration('mydb', 'configuration_x'))
      .rejects.toMatchObject({ status: 404, code: 'CONFIGURATION_NOT_FOUND' });
  });
});
