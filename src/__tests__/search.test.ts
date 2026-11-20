import { describe, it, expect, vi } from 'vitest';
import { createCentiaClient } from '../http/client';
import { Search } from '../search/Search';
import type { SearchSource } from '../search/Search';

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => (body !== null && body !== undefined ? JSON.stringify(body) : ''),
    headers: { get: () => null },
  } as unknown as Response);
}

function createHttp(fetchFn: typeof globalThis.fetch) {
  return createCentiaClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
    auth: { getAccessToken: async () => 'test-token' },
  });
}

function lastCall(fetchFn: typeof globalThis.fetch) {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const response = {
  took: 3,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: {
    total: { value: 1, relation: 'eq' },
    max_score: 0.2876821,
    hits: [{
      _index: 'mydb_my_schema_my_table', _id: '1', _score: 0.2876821,
      _source: { type: 'Feature', properties: { name: 'Findme' }, geometry: { type: 'Point', coordinates: [12.5, 55.7] } },
    }],
  },
};

const settings = { analysis: { analyzer: { my_analyzer: { type: 'custom', tokenizer: 'standard' } } } };

const BASE = 'https://api.example.com/api/v4/schemas/my_schema/tables/my_table/search';

describe('Search', () => {
  it('search sends GET with the parameters as query string', async () => {
    const fetchFn = mockFetch(200, response);
    const search = new Search(createHttp(fetchFn));

    const result = await search.search('my_schema', 'my_table', {
      q: 'properties.name:Findme', size: 20, from: undefined, _source: false, default_operator: 'AND',
    });

    const [url, init] = lastCall(fetchFn);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(BASE);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: 'properties.name:Findme', size: '20', _source: 'false', default_operator: 'AND',
    });
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual(response);
    expect(result.hits.total.value).toBe(1);
  });

  it('search without parameters sends no query', async () => {
    const fetchFn = mockFetch(200, response);
    const search = new Search(createHttp(fetchFn));

    await search.search('my_schema', 'my_table');

    const [url] = lastCall(fetchFn);
    expect(url).toBe(BASE);
  });

  it('search encodes schema and table in the path', async () => {
    const fetchFn = mockFetch(200, response);
    const search = new Search(createHttp(fetchFn));

    await search.search('my schema', 'a/b');

    const [url] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/schemas/my%20schema/tables/a%2Fb/search');
  });

  it('searchPost sends the query DSL body unaltered', async () => {
    const fetchFn = mockFetch(200, response);
    const search = new Search(createHttp(fetchFn));
    const body = {
      query: { match: { 'properties.name': 'Findme' } },
      size: 5,
      sort: [{ 'properties.name.keyword': 'asc' }],
      _source: ['properties.name'],
    };

    const result = await search.searchPost<SearchSource<{ name: string }>>('my_schema', 'my_table', body);

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(BASE);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(result.hits.hits[0]._source.properties.name).toBe('Findme');
  });

  it('buildSearchIndex sends PUT without a body and returns the build result', async () => {
    const built = { index: 'mydb_my_schema_my_table', message: 'Indexed 42 documents', errors: false, errors_in: [] };
    const fetchFn = mockFetch(200, built);
    const search = new Search(createHttp(fetchFn));

    const result = await search.buildSearchIndex('my_schema', 'my_table');

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(BASE);
    expect(init.method).toBe('PUT');
    expect(init.body).toBeUndefined();
    expect(result).toEqual(built);
    expect(result.errors).toBe(false);
  });

  it('dropSearchIndex sends DELETE and returns the drop result', async () => {
    const fetchFn = mockFetch(200, { index: 'mydb_my_schema_my_table', dropped: true });
    const search = new Search(createHttp(fetchFn));

    const result = await search.dropSearchIndex('my_schema', 'my_table');

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(BASE);
    expect(init.method).toBe('DELETE');
    expect(result.dropped).toBe(true);
  });

  it('getSearchSettings fetches the analysis block', async () => {
    const fetchFn = mockFetch(200, settings);
    const search = new Search(createHttp(fetchFn));

    const result = await search.getSearchSettings();

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/search/settings');
    expect(init.method).toBe('GET');
    expect(result.analysis).toEqual(settings.analysis);
  });

  it('putSearchSettings sends the analysis block with PUT and returns the stored block', async () => {
    const fetchFn = mockFetch(200, settings);
    const search = new Search(createHttp(fetchFn));

    const result = await search.putSearchSettings(settings);

    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/search/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(settings);
    expect(result).toEqual(settings);
  });

  it('throws CentiaApiError with the API error code', async () => {
    const notOwner = new Search(createHttp(mockFetch(403, { message: 'Forbidden', code: 'NOT_OWNER' })));
    await expect(notOwner.buildSearchIndex('my_schema', 'my_table')).rejects.toMatchObject({ status: 403, code: 'NOT_OWNER' });

    const noIndex = new Search(createHttp(mockFetch(404, { message: 'No index', code: 'INDEX_NOT_FOUND' })));
    await expect(noIndex.search('my_schema', 'my_table')).rejects.toMatchObject({ status: 404, code: 'INDEX_NOT_FOUND' });
  });
});
