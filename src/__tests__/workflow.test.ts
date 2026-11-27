import { describe, it, expect, vi } from 'vitest';
import { createCentiaClient } from '../http/client';
import { Workflow } from '../workflow/Workflow';

function mockFetch(status: number, body: unknown, headers?: Record<string, string>): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    status,
    text: async () => (body !== null && body !== undefined ? JSON.stringify(body) : ''),
    headers: {
      get: (name: string) => headers?.[name.toLowerCase()] ?? null,
    },
  } as unknown as Response);
}

function create(fetchFn: typeof globalThis.fetch) {
  return new Workflow(createCentiaClient({
    baseUrl: 'https://api.example.com',
    fetch: fetchFn,
    auth: { getAccessToken: async () => 'test-token' },
  }));
}

function lastCall(fetchFn: typeof globalThis.fetch) {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const BASE = 'https://api.example.com/api/v4/schemas/my_schema/tables/roads';

const item = {
  gid: 42, version_gid: 17, status: 1, status_name: 'drafted', operation: 'insert',
  user: 'joe', author: 'joe', reviewer: null, publisher: null, created: '2026-11-27 10:15:00+00',
};

describe('Workflow', () => {
  it('getWorkflowRoles sends GET', async () => {
    const roles = [{ subuser: 'joe', role: 'reviewer' }];
    const fetchFn = mockFetch(200, roles);
    const result = await create(fetchFn).getWorkflowRoles('my_schema', 'roads');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/workflow-roles`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual(roles);
  });

  it('patchWorkflowRoles sends PATCH 303 with one role or a list', async () => {
    const fetchFn = mockFetch(303, null, { location: '/api/v4/schemas/my_schema/tables/roads/workflow-roles' });
    const wf = create(fetchFn);

    const result = await wf.patchWorkflowRoles('my_schema', 'roads', { subuser: 'joe', role: 'reviewer' });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/workflow-roles`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ subuser: 'joe', role: 'reviewer' });
    expect(result.location).toBe('/api/v4/schemas/my_schema/tables/roads/workflow-roles');

    const roles = [{ subuser: 'joe', role: 'none' as const }, { subuser: 'ann', role: 'publisher' as const }];
    await wf.patchWorkflowRoles('my_schema', 'roads', roles);
    expect(JSON.parse(lastCall(fetchFn)[1].body as string)).toEqual(roles);
  });

  it('getWorkflowItem lists the items to act on, or all', async () => {
    const fetchFn = mockFetch(200, [item]);
    const wf = create(fetchFn);

    expect(await wf.getWorkflowItem('my_schema', 'roads')).toEqual([item]);
    expect(lastCall(fetchFn)[0]).toBe(`${BASE}/workflow-items`);

    await wf.getWorkflowItem('my_schema', 'roads', undefined, { all: true });
    expect(lastCall(fetchFn)[0]).toBe(`${BASE}/workflow-items?all=true`);
  });

  it('getWorkflowItem gets one item or a list', async () => {
    const fetchFn = mockFetch(200, item);
    expect(await create(fetchFn).getWorkflowItem('my_schema', 'roads', 42)).toEqual(item);
    expect(lastCall(fetchFn)[0]).toBe(`${BASE}/workflow-items/42`);

    const list = mockFetch(200, [item, item]);
    await create(list).getWorkflowItem('my_schema', 'roads', [42, '43']);
    expect(lastCall(list)[0]).toBe(`${BASE}/workflow-items/42,43`);

    // A one-gid list still answers an array
    expect(await create(mockFetch(200, item)).getWorkflowItem('my_schema', 'roads', [42])).toEqual([item]);

    const none = mockFetch(200, [item]);
    expect(await create(none).getWorkflowItem('my_schema', 'roads', [])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });

  it('patchWorkflowItem approves with PATCH 303 and no body', async () => {
    const fetchFn = mockFetch(303, null, { location: '/api/v4/schemas/my_schema/tables/roads/workflow-items/42,43' });
    const result = await create(fetchFn).patchWorkflowItem('my_schema', 'roads', [42, 43]);
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(`${BASE}/workflow-items/42,43`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(result.location).toBe('/api/v4/schemas/my_schema/tables/roads/workflow-items/42,43');
  });

  it('patchWorkflowItem refuses an empty list without a request', async () => {
    const fetchFn = mockFetch(303, null);
    await expect(create(fetchFn).patchWorkflowItem('my_schema', 'roads', [])).rejects.toThrow('at least one gid');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('getWorkflowLog sends GET without query by default', async () => {
    const entry = { id: 311, schema: 'my_schema', table: 'roads', ...item, roles: { joe: 'author' } };
    const fetchFn = mockFetch(200, [entry]);
    const result = await create(fetchFn).getWorkflowLog();
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('https://api.example.com/api/v4/workflow-log');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual([entry]);
  });

  it('getWorkflowLog sends schema, limit and offset', async () => {
    const fetchFn = mockFetch(200, []);
    const wf = create(fetchFn);

    await wf.getWorkflowLog({ schema: 'my_schema', limit: 50, offset: 100 });
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/workflow-log?schema=my_schema&limit=50&offset=100');

    // offset 0 is a value, not "unset"
    await wf.getWorkflowLog({ offset: 0 });
    expect(lastCall(fetchFn)[0]).toBe('https://api.example.com/api/v4/workflow-log?offset=0');
  });

  it('throws CentiaApiError with the API code', async () => {
    const fetchFn = mockFetch(409, { code: 409, errorCode: 'WORKFLOW_STATUS_CONFLICT', message: 'Already reviewed' });
    await expect(create(fetchFn).patchWorkflowItem('my_schema', 'roads', 42))
      .rejects.toMatchObject({ status: 409, code: 'WORKFLOW_STATUS_CONFLICT' });
  });
});
