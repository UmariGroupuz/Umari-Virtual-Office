import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectNoTrace } from '../helpers/state';
import { captureLogger, createTestApp, type TestApp } from '../helpers/testApp';

let t: TestApp;
const logs = captureLogger();

beforeAll(async () => {
  t = await createTestApp({ logger: logs.logger });
});
afterAll(async () => {
  await t.close();
});

describe('conventions (API_CONTRACTS §0)', () => {
  it('every /api response has JSON, no-store and nosniff headers', async () => {
    const res = await request(t.baseUrl).get('/api/agents');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    [
      'Host-guard 403',
      () => request(t.baseUrl).get('/api/agents').set('Host', 'evil.example'),
      403,
    ],
    [
      'Host-guard 403 on a write',
      () => request(t.baseUrl).post('/api/events').set('Host', 'evil.example').send({}),
      403,
    ],
    [
      'Origin-rule 403',
      () =>
        request(t.baseUrl)
          .post('/api/events')
          .set('Origin', 'http://localhost:5174')
          .send({ type: 'system.info', message: 'x' }),
      403,
    ],
    [
      'Origin-rule 403 on PATCH',
      () =>
        request(t.baseUrl)
          .patch('/api/tasks/SW-123')
          .set('Origin', 'http://evil.example')
          .send({ title: 'x' }),
      403,
    ],
    [
      'content-type 400',
      () => request(t.baseUrl).post('/api/events').set('Content-Type', 'text/plain').send('x'),
      400,
    ],
    ['validation 400', () => request(t.baseUrl).post('/api/events').send({}), 400],
    ['route 404', () => request(t.baseUrl).get('/api/nope'), 404],
    [
      'body 413',
      () =>
        request(t.baseUrl)
          .post('/api/events')
          .set('Content-Type', 'application/json')
          .send(JSON.stringify({ pad: 'x'.repeat(103_000) })),
      413,
    ],
  ] as const)('%s also carries JSON, no-store and nosniff (CR-19)', async (_name, send, status) => {
    const res = await send();
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('a Host-guard refusal outside /api is still a no-store/nosniff JSON envelope', async () => {
    const res = await request(t.baseUrl).get('/').set('Host', 'evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each(['get', 'post', 'patch', 'delete', 'put'] as const)(
    'unknown /api route with %s → 404 NOT_FOUND JSON (no 405)',
    async (method) => {
      const res = await request(t.baseUrl)[method]('/api/nope/deeper?x=1');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${method.toUpperCase()} /api/nope/deeper`,
        },
      });
    },
  );

  it('a write to an unknown route is 404 even without a JSON content type', async () => {
    const res = await request(t.baseUrl)
      .post('/api/agents')
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(res.status).toBe(404);
  });

  it('POST without Content-Type: application/json → 400 INVALID_JSON (nothing stored)', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .post('/api/events')
        .set('Content-Type', 'text/plain')
        .send('{"type":"system.info","message":"x"}');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'INVALID_JSON', message: 'Content-Type must be application/json' },
      });
    });
  });

  it('a charset parameter is allowed', async () => {
    const res = await request(t.baseUrl)
      .post('/api/events')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ type: 'system.info', message: 'charset ok' }));
    expect(res.status).toBe(201);
  });

  it('unparseable JSON → 400 INVALID_JSON', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .post('/api/events')
        .set('Content-Type', 'application/json')
        .send('{"type": "system.info",');
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      });
    });
  });

  it('body over 100 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .post('/api/events')
        .set('Content-Type', 'application/json')
        .send(
          JSON.stringify({
            type: 'system.info',
            message: 'x',
            metadata: { pad: 'x'.repeat(103_000) },
          }),
        );
      expect(res.status).toBe(413);
      expect(res.body.error).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds 100 KB',
      });
    });
  });

  it('an empty JSON body is treated as {}', async () => {
    const res = await request(t.baseUrl)
      .post('/api/events')
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ path: 'type', message: 'Event type is required' }]);
  });

  it('endpoints without query parameters ignore the query string', async () => {
    const res = await request(t.baseUrl).get('/api/projects?foo=bar');
    expect(res.status).toBe(200);
  });
});

describe('host guard (ADR-027)', () => {
  it.each(['localhost', 'localhost:5173', '127.0.0.1:4000', '[::1]:4000'])(
    'Host %s is allowed',
    async (host) => {
      const res = await request(t.baseUrl).get('/api/health').set('Host', host);
      expect(res.status).toBe(200);
    },
  );

  it.each(['evil.example', 'evil.example:4000', '192.168.1.5:4000'])(
    'Host %s → 403 HOST_NOT_ALLOWED',
    async (host) => {
      const res = await request(t.baseUrl).get('/api/agents').set('Host', host);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: { code: 'HOST_NOT_ALLOWED', message: `Host not allowed: ${host}` },
      });
    },
  );

  it('also guards writes before anything else', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .post('/api/events')
        .set('Host', 'evil.example')
        .send({ type: 'agent.activity', agentId: '04-backend-engineer', action: 'x' });
      expect(res.status).toBe(403);
    });
  });
});

describe('CORS allowlist', () => {
  it('allowed origin is reflected; preflight allows Content-Type and PATCH', async () => {
    const res = await request(t.baseUrl)
      .get('/api/projects')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const pre = await request(t.baseUrl)
      .options('/api/tasks/SW-123')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'Content-Type');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toContain('PATCH');
    expect(pre.headers['access-control-allow-headers']).toContain('Content-Type');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('other origins get no CORS header', async () => {
    const res = await request(t.baseUrl).get('/api/projects').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /api/health and GET /api/projects', () => {
  it('health 200', async () => {
    const res = await request(t.baseUrl).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: 'ok',
      db: 'ok',
      uptimeSec: expect.any(Number) as number,
      version: '0.1.0',
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
    });
  });

  it('projects in order, ids only (no sortOrder)', async () => {
    const res = await request(t.baseUrl).get('/api/projects');
    expect(res.body.data).toEqual([
      { id: 'sellway', name: 'Sellway', taskPrefix: 'SW' },
      { id: 'ishkun24', name: 'Ishkun24', taskPrefix: 'IK' },
      { id: 'erp', name: 'ERP', taskPrefix: 'ERP' },
      { id: 'ana-market', name: 'Ana Market', taskPrefix: 'AM' },
    ]);
  });

  it('request_failed logs carry status/code/method/route and no body', () => {
    const failures = logs.records.filter((r) => r.msg === 'request_failed');
    expect(failures.length).toBeGreaterThan(0);
    for (const record of failures) {
      expect(Object.keys(record).sort()).toEqual([
        'code',
        'level',
        'method',
        'msg',
        'route',
        'status',
        'time',
      ]);
      expect(record.level).toBe('warn');
    }
  });
});

describe('health 503 when the database is unavailable', () => {
  it('returns SERVICE_UNAVAILABLE with details and logs db_error', async () => {
    const own = captureLogger();
    const app = await createTestApp({ logger: own.logger });
    app.database.close();
    const res = await request(app.baseUrl).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Database is not available',
      details: {
        status: 'error',
        db: 'error',
        uptimeSec: expect.any(Number) as number,
        version: '0.1.0',
        time: expect.any(String) as string,
      },
    });
    expect(own.records.some((r) => r.msg === 'db_error' && r.level === 'error')).toBe(true);
    await app.close();
  });

  it('a DB failure on a write → 500 INTERNAL_ERROR, nothing broadcast, db_error logged', async () => {
    const own = captureLogger();
    const app = await createTestApp({ logger: own.logger });
    app.database.close();
    app.recorder.clear();
    const res = await request(app.baseUrl)
      .post('/api/events')
      .send({ type: 'system.info', message: 'x' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/stack|sqlite|SQL/i);
    expect(app.recorder.messages).toEqual([]);
    expect(own.records.some((r) => r.msg === 'db_error')).toBe(true);
    expect(
      own.records.some(
        (r) => r.msg === 'request_failed' && r.level === 'error' && r.status === 500,
      ),
    ).toBe(true);
    await app.close();
  });
});
