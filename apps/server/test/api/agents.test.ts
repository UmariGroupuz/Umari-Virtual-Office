import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoTrace } from '../helpers/state';
import { captureLogger, createTestApp, type TestApp } from '../helpers/testApp';

const BE = '04-backend-engineer';
let t: TestApp;
let logs: ReturnType<typeof captureLogger>;

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  await t.close();
});

describe('GET /api/agents', () => {
  it('returns all 15 agents in agent-number order', async () => {
    const res = await request(t.baseUrl).get('/api/agents');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(15);
    expect(res.body.data.map((a: { id: string }) => a.id.slice(0, 2))).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(2, '0')),
    );
  });

  it('filters by project id or name, case-insensitive', async () => {
    const byId = await request(t.baseUrl).get('/api/agents?project=sellway');
    const byName = await request(t.baseUrl).get('/api/agents?project=SELLWAY');
    expect(byId.body.data.length).toBeGreaterThan(0);
    expect(byName.body.data).toEqual(byId.body.data);
    for (const agent of byId.body.data as { currentProject: string }[]) {
      expect(agent.currentProject).toBe('sellway');
    }
  });

  it.each([
    ['/api/agents?project=unknown', 422, 'UNKNOWN_PROJECT', 'Unknown project: unknown'],
    ['/api/agents?project=All%20Projects', 422, 'UNKNOWN_PROJECT', 'Unknown project: All Projects'],
    ['/api/agents?project=', 400, 'VALIDATION_ERROR', undefined],
    ['/api/agents?foo=1', 400, 'VALIDATION_ERROR', 'Validation failed: foo: Unrecognized key'],
    ['/api/agents?project=a&project=b', 400, 'VALIDATION_ERROR', undefined],
  ] as const)('%s → %i %s', async (url, status, code, message) => {
    const res = await request(t.baseUrl).get(url);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    if (message !== undefined) expect(res.body.error.message).toBe(message);
  });
});

describe('GET /api/agents/:id', () => {
  it('returns one agent', async () => {
    const res = await request(t.baseUrl).get(`/api/agents/${BE}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: BE,
      code: 'BE',
      status: 'idle',
      version: 1,
      online: true,
    });
  });

  it('404 AGENT_NOT_FOUND for any unknown id', async () => {
    const res = await request(t.baseUrl).get('/api/agents/99-nobody');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found: 99-nobody' },
    });
  });
});

describe('PATCH /api/agents/:id/status (REQ-004, ADR-022)', () => {
  it('changes the status through the event pipeline (simulator source)', async () => {
    const res = await request(t.baseUrl).patch(`/api/agents/${BE}/status`).send({
      status: 'working',
      source: 'simulator',
      project: 'Sellway',
      taskId: 'SW-123',
      action: 'edit_file',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.event).toMatchObject({
      type: 'agent.status.changed',
      source: 'simulator',
      agentId: BE,
      project: 'sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'edit_file',
      forced: false,
    });
    expect(res.body.data.agent).toMatchObject({
      status: 'working',
      currentAction: 'edit_file',
      taskId: 'SW-123',
      version: 2,
    });
    expect(res.body.data.task).toMatchObject({ id: 'SW-123', status: 'in_progress' });
    expect(t.recorder.messages).toEqual([{ name: 'office:event', payload: res.body.data }]);
  });

  it('defaults the source to "api"', async () => {
    const res = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'planning' });
    expect(res.body.data.event.source).toBe('api');
    expect(res.body.data.task).toBeNull();
  });

  it('same status → 200 full no-op (event null, nothing stored or broadcast)', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .patch(`/api/agents/${BE}/status`)
        .send({ status: 'idle', source: 'simulator', message: 'ignored' });
      expect(res.status).toBe(200);
      expect(res.body.data.event).toBeNull();
      expect(res.body.data.task).toBeNull();
      expect(res.body.data.agent).toMatchObject({ id: BE, status: 'idle', version: 1 });
    });
  });

  it('illegal transition → 409 with the exact contract body (§3.5 example)', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl)
        .patch(`/api/agents/${BE}/status`)
        .send({ status: 'completed', source: 'simulator' });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toBe(
        '{"error":{"code":"ILLEGAL_TRANSITION","message":"Illegal transition: idle → completed","details":{"entity":"agent","id":"04-backend-engineer","from":"idle","to":"completed"}}}',
      );
    });
    expect(logs.records).toContainEqual(
      expect.objectContaining({
        msg: 'request_failed',
        level: 'warn',
        status: 409,
        code: 'ILLEGAL_TRANSITION',
        method: 'PATCH',
        route: '/api/agents/:id/status',
      }),
    );
    const rejected = logs.records.find((r) => r.msg === 'event_rejected');
    expect(rejected).toEqual({
      time: expect.any(String) as string,
      level: 'warn',
      msg: 'event_rejected',
      code: 'ILLEGAL_TRANSITION',
      type: 'agent.status.changed',
      agentId: BE,
      source: 'simulator',
    });
  });

  it.each([
    [{ status: 'sleeping' }, 400, 'VALIDATION_ERROR'],
    [{}, 400, 'VALIDATION_ERROR'],
    [{ status: 'working', source: 'demo' }, 400, 'VALIDATION_ERROR'],
    [{ status: 'working', foo: 1 }, 400, 'VALIDATION_ERROR'],
    [{ status: 'working', project: 'nowhere' }, 422, 'UNKNOWN_PROJECT'],
    [{ status: 'working', project: 'erp', taskId: 'SW-123' }, 422, 'PROJECT_MISMATCH'],
    [{ status: 'idle', project: 'erp', taskId: 'SW-123' }, 422, 'PROJECT_MISMATCH'],
  ] as const)('%j → %i %s', async (body, status, code) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await request(t.baseUrl).patch(`/api/agents/${BE}/status`).send(body);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });
  });

  it('unknown agent → 404 (after schema validation)', async () => {
    const ok = await request(t.baseUrl)
      .patch('/api/agents/99-ghost/status')
      .send({ status: 'idle' });
    expect(ok.status).toBe(404);
    expect(ok.body.error.code).toBe('AGENT_NOT_FOUND');
    const bad = await request(t.baseUrl)
      .patch('/api/agents/99-ghost/status')
      .send({ status: 'nope' });
    expect(bad.status).toBe(400);
  });

  it('an unknown task id is bound without creating a task', async () => {
    const res = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'working', taskId: 'X-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.agent).toMatchObject({ taskId: 'X-1', currentTask: 'X-1' });
    expect(t.database.repos.tasks.getById('X-1')).toBeNull();
  });

  it('force skips only legality: forced:true, forced_transition logged', async () => {
    const res = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'completed', taskId: 'SW-123', force: true });
    expect(res.status).toBe(200);
    expect(res.body.data.event.forced).toBe(true);
    expect(res.body.data.task).toMatchObject({ status: 'completed', progress: 100 });
    const forced = logs.records.filter((r) => r.msg === 'forced_transition');
    expect(forced.map((r) => [r.entity, r.from, r.to])).toEqual([
      ['agent', 'idle', 'completed'],
      ['task', 'assigned', 'completed'],
    ]);
  });

  it('force on a legal transition is stored with forced:false', async () => {
    const res = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'working', force: true });
    expect(res.body.data.event.forced).toBe(false);
  });

  it('parity with the equivalent POST /api/events', async () => {
    const patched = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'working', project: 'sellway', taskId: 'SW-123', message: 'go' });
    const other = await createTestApp();
    try {
      const posted = await request(other.baseUrl).post('/api/events').send({
        type: 'agent.status.changed',
        agentId: BE,
        status: 'working',
        project: 'sellway',
        taskId: 'SW-123',
        message: 'go',
      });
      const strip = (data: Record<string, Record<string, unknown>>) => ({
        event: { ...data.event, id: 0, seq: 0, createdAt: 0 },
        agent: { ...data.agent, startedAt: 0, lastActivityAt: 0 },
        task: { ...data.task, startedAt: 0, updatedAt: 0, createdAt: 0 },
      });
      expect(strip(posted.body.data)).toEqual(strip(patched.body.data));
    } finally {
      await other.close();
    }
  });
});
