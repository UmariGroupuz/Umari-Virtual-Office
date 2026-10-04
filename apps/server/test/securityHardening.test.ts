// ADR-037: SEC-2 (Origin rule on writes), SEC-3 (compressed/corrupt bodies), SEC-4 (reserved task ids, server
// side), SEC-5 (framing headers), QA-3 (demo stop summary text).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toAppError } from '../src/api/middleware/errorHandler';
import { stoppedMessage } from '../src/services/demoService';
import { expectNoTrace } from './helpers/state';
import { captureLogger, createTestApp, type TestApp } from './helpers/testApp';

const BE = '04-backend-engineer';
const EVENT = { type: 'system.info', message: 'hello' };
let t: TestApp;
let logs: ReturnType<typeof captureLogger>;

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  await t.close();
});

describe('SEC-2: Origin rule on state-changing /api requests', () => {
  const ORIGIN_BODY = { error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin not allowed' } };

  it.each([
    ['POST', '/api/events', EVENT],
    ['PATCH', `/api/agents/${BE}/status`, { status: 'working' }],
    ['POST', '/api/tasks', { title: 'x', project: 'erp' }],
    ['PATCH', '/api/tasks/SW-123', { title: 'x' }],
    ['POST', '/api/demo/start', {}],
    ['POST', '/api/demo/stop', {}],
  ] as const)(
    '%s %s with a foreign Origin → 403 ORIGIN_NOT_ALLOWED, no trace',
    async (method, url, body) => {
      await expectNoTrace(t.database, t.recorder, async () => {
        const req =
          method === 'POST' ? request(t.baseUrl).post(url) : request(t.baseUrl).patch(url);
        const res = await req.set('Origin', 'http://evil.example').send(body);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(ORIGIN_BODY);
      });
      expect(logs.records).toContainEqual(
        expect.objectContaining({ msg: 'request_failed', status: 403, code: 'ORIGIN_NOT_ALLOWED' }),
      );
    },
  );

  it.each([
    'null',
    'http://localhost:5174',
    'http://127.0.0.1:9999',
    'file://',
    'chrome-extension://abc',
  ])('Origin %s is refused for writes', async (origin) => {
    const res = await request(t.baseUrl).post('/api/events').set('Origin', origin).send(EVENT);
    expect(res.status).toBe(403);
  });

  it.each([
    ['absent (curl, producers)', undefined],
    ['allowed CORS origin', 'http://localhost:5173'],
    ['the other CORS origin', 'http://127.0.0.1:5173'],
  ])('%s → accepted', async (_name, origin) => {
    const req = request(t.baseUrl).post('/api/events');
    const res = await (origin === undefined ? req : req.set('Origin', origin)).send(EVENT);
    expect(res.status).toBe(201);
  });

  it('same-origin one-port mode (Origin = http://<Host>) → accepted', async () => {
    const res = await request(t.baseUrl)
      .post('/api/events')
      .set('Origin', `http://127.0.0.1:${t.port}`)
      .send(EVENT);
    expect(res.status).toBe(201);
    const viaLocalhost = await request(t.baseUrl)
      .post('/api/events')
      .set('Host', `localhost:${t.port}`)
      .set('Origin', `http://localhost:${t.port}`)
      .send(EVENT);
    expect(viaLocalhost.status).toBe(201);
  });

  it('GETs and CORS preflights are unaffected (CORS keeps reads private)', async () => {
    const get = await request(t.baseUrl).get('/api/agents').set('Origin', 'http://evil.example');
    expect(get.status).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(t.baseUrl)
      .options('/api/events')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('check order: Host guard first, then the Origin rule, then readiness', async () => {
    const bothBad = await request(t.baseUrl)
      .post('/api/events')
      .set('Host', 'evil.example')
      .set('Origin', 'http://evil.example')
      .send(EVENT);
    expect(bothBad.body.error.code).toBe('HOST_NOT_ALLOWED');

    const gated = await createTestApp({ startReady: false });
    try {
      const foreign = await request(gated.baseUrl)
        .post('/api/events')
        .set('Origin', 'http://evil.example')
        .send(EVENT);
      expect(foreign.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      const allowed = await request(gated.baseUrl)
        .post('/api/events')
        .set('Origin', 'http://localhost:5173')
        .send(EVENT);
      expect(allowed.status).toBe(503);
    } finally {
      await gated.close();
    }
  });
});

describe('SEC-3: compressed or corrupt bodies never yield 500', () => {
  const json = JSON.stringify(EVENT);
  it.each([
    ['gzip (valid)', 'gzip', gzipSync(json)],
    ['gzip (corrupt)', 'gzip', Buffer.from(json)],
    ['deflate', 'deflate', deflateSync(json)],
    ['br (valid)', 'br', brotliCompressSync(json)],
    ['br (junk)', 'br', Buffer.from('junkjunkjunk')],
    ['unknown encoding', 'x-custom', Buffer.from(json)],
  ])('%s → 400 INVALID_JSON, nothing stored', async (_name, encoding, body) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .post('/api/events')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', encoding)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'INVALID_JSON', message: 'Content-Encoding is not supported' },
      });
    });
    expect(logs.records.some((r) => r.level === 'error')).toBe(false);
  });

  it('identity encoding is accepted', async () => {
    const res = await request(t.baseUrl)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'identity')
      .send(json);
    expect(res.status).toBe(201);
  });

  it.each([
    [{ code: 'Z_DATA_ERROR', message: 'incorrect header check' }],
    [{ code: 'ERR__ERROR_FORMAT_HUFFMAN_SPACE', message: 'brotli' }],
    [{ status: 400, expose: true, type: 'something.new', message: 'bad body' }],
  ])('decompression and exposable client errors map to 400: %j', (error) => {
    const mapped = toAppError(Object.assign(new Error(error.message), error));
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe('INVALID_JSON');
  });

  it('unknown internal errors are still 500', () => {
    expect(toAppError(new Error('boom')).status).toBe(500);
    expect(toAppError(Object.assign(new Error('x'), { status: 400, expose: false })).status).toBe(
      500,
    );
  });
});

describe('SEC-4: reserved task ids are rejected by the API', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('%s', async (id) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const create = await request(t.baseUrl)
        .post('/api/tasks')
        .send({ id, title: 'x', project: 'sellway' });
      expect(create.status).toBe(400);
      expect(create.body.error.details).toEqual([
        { path: 'id', message: `Task id "${id}" is reserved` },
      ]);
      const assign = await request(t.baseUrl)
        .post('/api/events')
        .send({ type: 'agent.task.assigned', agentId: BE, taskId: id, project: 'sellway' });
      expect(assign.status).toBe(400);
      const blocked = await request(t.baseUrl)
        .patch('/api/tasks/SW-123')
        .send({ blockedBy: [id] });
      expect(blocked.status).toBe(400);
      expect((await request(t.baseUrl).get(`/api/events?taskId=${id}`)).status).toBe(400);
    });
  });
});

describe('SEC-5: framing protection headers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vo-sec5-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function expectFrameHeaders(headers: Record<string, string>): void {
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toBe("frame-ancestors 'none'");
  }

  it('on API responses, errors and host-guard refusals', async () => {
    expectFrameHeaders((await request(t.baseUrl).get('/api/health')).headers);
    expectFrameHeaders((await request(t.baseUrl).get('/api/nope')).headers);
    expectFrameHeaders(
      (await request(t.baseUrl).get('/api/health').set('Host', 'evil.example')).headers,
    );
  });

  it('on the served web build: index, SPA fallback and assets', async () => {
    const dist = path.join(dir, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>AI Virtual Office</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1);');
    const web = await createTestApp({ config: { serveWeb: true, webDistPath: dist } });
    try {
      for (const url of ['/', '/agents/04-backend-engineer', '/assets/app.js']) {
        const res = await request(web.baseUrl).get(url);
        expect(res.status, url).toBe(200);
        expectFrameHeaders(res.headers);
      }
    } finally {
      await web.close();
    }
  });
});

describe('QA-4: unmatched non-/api paths answer our JSON 404 with framing headers', () => {
  function expectOur404(res: request.Response, method: string, path: string): void {
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: `Route not found: ${method} ${path}` },
    });
  }

  it('API-only mode: GET / and GET /favicon.ico', async () => {
    expectOur404(await request(t.baseUrl).get('/'), 'GET', '/');
    expectOur404(await request(t.baseUrl).get('/favicon.ico?x=1'), 'GET', '/favicon.ico');
  });

  it('one-port mode: non-GET requests outside /api (POST /, PUT /assets/app.js)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vo-qa4-'));
    const dist = path.join(dir, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>AI Virtual Office</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1);');
    const web = await createTestApp({ config: { serveWeb: true, webDistPath: dist } });
    try {
      expectOur404(await request(web.baseUrl).post('/').send({}), 'POST', '/');
      expectOur404(
        await request(web.baseUrl).put('/assets/app.js').send('x'),
        'PUT',
        '/assets/app.js',
      );
      expect((await request(web.baseUrl).get('/')).status).toBe(200); // pages still served
    } finally {
      await web.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QA-3: demo stop summary text agrees in number', () => {
  it.each([
    [
      { agentsRestored: 1, tasksRestored: 1, tasksDeleted: 1 },
      'Demo mode stopped: 1 agent and 1 task restored, 1 demo task removed',
    ],
    [
      { agentsRestored: 2, tasksRestored: 0, tasksDeleted: 3 },
      'Demo mode stopped: 2 agents and 0 tasks restored, 3 demo tasks removed',
    ],
    [
      { agentsRestored: 0, tasksRestored: 0, tasksDeleted: 0 },
      'Demo mode stopped: 0 agents and 0 tasks restored, 0 demo tasks removed',
    ],
  ])('%j → %s', (counts, text) => {
    expect(stoppedMessage({ ...counts, agentsKept: 0, tasksKept: 0 })).toBe(text);
  });

  it('the stored system.info event uses it', async () => {
    await request(t.baseUrl).post('/api/demo/start').send({});
    t.server.services.demo.tick(); // beat 1: only the PM changes
    const stop = await request(t.baseUrl).post('/api/demo/stop').send({});
    expect(stop.body.data.restored.agentsRestored).toBe(1);
    const [latest] = (await request(t.baseUrl).get('/api/events?type=system.info&limit=1')).body
      .data as {
      message: string;
    }[];
    expect(latest?.message).toBe(
      'Demo mode stopped: 1 agent and 0 tasks restored, 0 demo tasks removed',
    );
  });
});
