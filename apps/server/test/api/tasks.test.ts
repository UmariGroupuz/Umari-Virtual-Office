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

const create = (body: unknown) =>
  request(t.baseUrl)
    .post('/api/tasks')
    .send(body as object);
const patch = (id: string, body: unknown) =>
  request(t.baseUrl)
    .patch(`/api/tasks/${id}`)
    .send(body as object);

describe('GET /api/tasks', () => {
  it('lists all 11 seed tasks ordered by createdAt, id', async () => {
    const res = await request(t.baseUrl).get('/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(11);
    const keys = (res.body.data as { createdAt: string; id: string }[]).map(
      (x) => `${x.createdAt}|${x.id}`,
    );
    expect(keys).toEqual([...keys].sort());
  });

  it('filters by project (name), agent and status; limit', async () => {
    const res = await request(t.baseUrl).get(
      `/api/tasks?project=Sellway&agentId=${BE}&status=assigned`,
    );
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual(['SW-123']);
    expect((await request(t.baseUrl).get('/api/tasks?limit=2')).body.data).toHaveLength(2);
  });

  it.each([
    ['?status=done', 400],
    ['?limit=0', 400],
    ['?foo=1', 400],
    ['?project=x', 422],
    ['?agentId=99-ghost', 422],
  ] as const)('%s → %i', async (query, status) => {
    expect((await request(t.baseUrl).get(`/api/tasks${query}`)).status).toBe(status);
  });
});

describe('POST /api/tasks (ADR-024)', () => {
  it('generates the next id (SW-126 on a fresh seed), writes task.created and broadcasts', async () => {
    const res = await create({
      title: 'Refund flow',
      project: 'sellway',
      assignedAgentId: BE,
      blockedBy: ['SW-123', 'SW-123'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.agent).toBeNull();
    expect(res.body.data.task).toMatchObject({
      id: 'SW-126',
      status: 'assigned',
      priority: 'normal',
      progress: 0,
      version: 1,
      blockedBy: ['SW-123'],
      assignedAgentId: BE,
    });
    expect(res.body.data.event).toMatchObject({
      type: 'task.created',
      source: 'api',
      agentId: BE,
      project: 'sellway',
      taskId: 'SW-126',
      status: 'assigned',
      message: 'Task created: Refund flow',
      severity: 'info',
      metadata: {},
    });
    expect(t.recorder.messages).toEqual([{ name: 'office:event', payload: res.body.data }]);
    expect((await create({ title: 'Next', project: 'sellway' })).body.data.task).toMatchObject({
      id: 'SW-127',
      status: 'todo',
    });
  });

  it('accepts an explicit id; a duplicate → 409 TASK_EXISTS', async () => {
    expect((await create({ id: 'ERP-900', title: 'x', project: 'erp' })).status).toBe(201);
    await expectNoTrace(t.database, t.recorder, async () => {
      const dup = await create({ id: 'ERP-900', title: 'y', project: 'erp' });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toEqual({
        code: 'TASK_EXISTS',
        message: 'Task already exists: ERP-900',
        details: { id: 'ERP-900' },
      });
    });
  });

  it.each([
    [{ title: 'x' }, 400, 'VALIDATION_ERROR'],
    [{ title: 'x', project: 'erp', status: 'assigned' }, 400, 'VALIDATION_ERROR'],
    [{ title: 'x', project: 'erp', status: 'todo', assignedAgentId: BE }, 400, 'VALIDATION_ERROR'],
    [{ title: 'x', project: 'erp', status: 'in_progress' }, 400, 'VALIDATION_ERROR'],
    [
      { id: 'ERP-901', title: 'x', project: 'erp', blockedBy: ['ERP-901'] },
      400,
      'VALIDATION_ERROR',
    ],
    [{ title: 'x', project: 'nowhere' }, 422, 'UNKNOWN_PROJECT'],
    [{ title: 'x', project: 'erp', assignedAgentId: '99-ghost' }, 422, 'UNKNOWN_AGENT'],
    [{ title: 'x', project: 'erp', blockedBy: ['ERP-301', 'NOPE-1'] }, 422, 'UNKNOWN_TASK'],
    [{ id: 'SW-123', title: 'x', project: 'nowhere' }, 422, 'UNKNOWN_PROJECT'],
  ] as const)('%j → %i %s', async (body, status, code) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await create(body);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
    });
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates fields and writes task.updated (no agent change, REQ-041)', async () => {
    const agentBefore = t.database.repos.agents.getById(BE);
    const res = await patch('SW-123', { status: 'in_progress', priority: 'critical' });
    expect(res.status).toBe(200);
    expect(res.body.data.agent).toBeNull();
    expect(res.body.data.task).toMatchObject({
      status: 'in_progress',
      priority: 'critical',
      version: 2,
    });
    expect(res.body.data.event).toMatchObject({
      type: 'task.updated',
      agentId: BE,
      status: 'in_progress',
      progress: null,
      message: 'Task updated: Lost Goods API',
      metadata: { changes: ['priority', 'startedAt', 'status'] },
      forced: false,
    });
    expect(t.database.repos.agents.getById(BE)).toEqual(agentBefore);
  });

  it('auto-status: assignee on a todo task → assigned', async () => {
    const res = await patch('SW-125', { assignedAgentId: BE });
    expect(res.body.data.task).toMatchObject({ assignedAgentId: BE, status: 'assigned' });
  });

  it('no-op → 200 event null, nothing stored or broadcast', async () => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await patch('SW-123', { title: 'Lost Goods API', status: 'assigned' });
      expect(res.status).toBe(200);
      expect(res.body.data.event).toBeNull();
      expect(res.body.data.task).toMatchObject({ id: 'SW-123', version: 1 });
    });
  });

  it.each([
    [
      'SW-123',
      {},
      400,
      'VALIDATION_ERROR',
      'Validation failed: body: At least one field is required',
    ],
    ['SW-123', { force: true }, 400, 'VALIDATION_ERROR', undefined],
    [
      'SW-123',
      { blockedBy: ['SW-123'] },
      400,
      'VALIDATION_ERROR',
      'Validation failed: blockedBy: A task cannot block itself',
    ],
    // The self-block 400 comes before the 422 for an unknown blockedBy id and before the 404.
    ['SW-123', { blockedBy: ['SW-123', 'NOPE-1'] }, 400, 'VALIDATION_ERROR', undefined],
    ['NOPE-9', { blockedBy: ['NOPE-9'] }, 400, 'VALIDATION_ERROR', undefined],
    ['NOPE-9', { title: 'x' }, 404, 'TASK_NOT_FOUND', 'Task not found: NOPE-9'],
    ['SW-123', { assignedAgentId: '99-ghost' }, 422, 'UNKNOWN_AGENT', undefined],
    ['SW-123', { blockedBy: ['NOPE-1'] }, 422, 'UNKNOWN_TASK', 'Unknown task: NOPE-1'],
    [
      'SW-123',
      { status: 'completed' },
      409,
      'ILLEGAL_TRANSITION',
      'Illegal task transition: assigned → completed (task SW-123)',
    ],
    [
      'IK-201',
      { progress: 50 },
      409,
      'ILLEGAL_TRANSITION',
      'Task IK-201 is completed; progress cannot change',
    ],
    ['IK-201', { status: 'in_progress' }, 409, 'ILLEGAL_TRANSITION', undefined],
  ] as const)('%s %j → %i %s', async (id, body, status, code, message) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await patch(id, body);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      if (message !== undefined) expect(res.body.error.message).toBe(message);
    });
  });

  it('force reopens a completed task and logs forced_transition', async () => {
    const res = await patch('IK-201', { status: 'in_progress', force: true });
    expect(res.status).toBe(200);
    expect(res.body.data.task).toMatchObject({ status: 'in_progress', completedAt: null });
    expect(res.body.data.event.forced).toBe(true);
    expect(logs.records.filter((r) => r.msg === 'forced_transition')).toEqual([
      expect.objectContaining({
        level: 'warn',
        entity: 'task',
        id: 'IK-201',
        from: 'completed',
        to: 'in_progress',
      }),
    ]);
  });

  it('entering completed sets completedAt and progress 100', async () => {
    await patch('SW-124', { status: 'review' });
    const res = await patch('SW-124', { status: 'completed', progress: 3 });
    expect(res.body.data.task).toMatchObject({ status: 'completed', progress: 100 });
    expect(res.body.data.task.completedAt).toBe(res.body.data.event.createdAt);
  });
});
