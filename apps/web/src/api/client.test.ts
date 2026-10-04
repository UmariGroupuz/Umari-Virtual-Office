import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  apiRequestEnvelope,
  errorDetail,
  isUnreachable,
  toQuery,
} from './client';
import { createOfficeApi } from './endpoints';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('apiRequest (API-C §10.3)', () => {
  it('unwraps { data } and prefixes /api', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { data: { ok: 1 } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiRequest('GET', '/health')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends JSON bodies with Content-Type: application/json', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(201, { data: {} })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiRequest('POST', '/events', { type: 'agent.activity' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"type":"agent.activity"}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('returns the page of paged lists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonResponse(200, { data: [], page: { limit: 50, nextBefore: 812 } })),
      ),
    );
    await expect(apiRequestEnvelope('GET', '/events')).resolves.toEqual({
      data: [],
      page: { limit: 50, nextBefore: 812 },
    });
  });

  it('maps the error envelope to ApiError { status, code, message, details }', async () => {
    const details = { entity: 'agent', id: '04-backend-engineer', from: 'idle', to: 'completed' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(409, {
            error: {
              code: 'ILLEGAL_TRANSITION',
              message: 'Illegal transition: idle → completed',
              details,
            },
          }),
        ),
      ),
    );
    const error = await apiRequest('PATCH', '/agents/x/status', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'ILLEGAL_TRANSITION',
      message: 'Illegal transition: idle → completed',
      details,
    });
    expect(isUnreachable(error)).toBe(false);
  });

  it('network failure → NETWORK_ERROR (status 0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = await apiRequest('GET', '/agents').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(isUnreachable(error)).toBe(true);
    expect(errorDetail(error)).toBe('Network error');
  });

  it('timeout → TIMEOUT after 10 s (health: 5 s)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const slow = apiRequest('GET', '/agents').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    const health = createOfficeApi()
      .getHealth()
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1);
    await expect(slow).resolves.toMatchObject({ status: 0, code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(health).resolves.toMatchObject({ code: 'TIMEOUT' });
  });

  it('a non-envelope 5xx (dev proxy without backend) counts as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 502 }))),
    );
    const error = await apiRequest('GET', '/health').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'BAD_RESPONSE' });
    expect(isUnreachable(error)).toBe(true);
  });

  it('toQuery drops empty values', () => {
    expect(toQuery({ project: 'sellway', agentId: undefined, before: 5, x: null, y: '' })).toBe(
      '?project=sellway&before=5',
    );
    expect(toQuery({})).toBe('');
  });
});

describe('endpoints', () => {
  it('builds the contract paths and bodies', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, { data: [], page: { limit: 50, nextBefore: null } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createOfficeApi();
    await api.getSnapshot('sellway');
    await api.getEvents({ agentId: '04-backend-engineer', before: 12 });
    await api.getTasks({ agentId: '04-backend-engineer' });
    await api.startDemo();
    await api.stopDemo();
    const calls = fetchMock.mock.calls.map(([url, init]) => [init?.method, url, init?.body]);
    expect(calls).toEqual([
      ['GET', '/api/snapshot?project=sellway', undefined],
      ['GET', '/api/events?agentId=04-backend-engineer&before=12&limit=50', undefined],
      ['GET', '/api/tasks?agentId=04-backend-engineer', undefined],
      ['POST', '/api/demo/start', '{}'],
      ['POST', '/api/demo/stop', '{}'],
    ]);
  });
});
