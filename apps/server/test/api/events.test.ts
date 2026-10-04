import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoTrace } from '../helpers/state';
import { captureLogger, createTestApp, type TestApp } from '../helpers/testApp';

const BE = '04-backend-engineer';
const FE = '05-frontend-engineer';
const EXAMPLE = {
  type: 'agent.activity',
  agentId: BE,
  project: 'Sellway',
  taskId: 'SW-123',
  status: 'working',
  action: 'run_command',
  message: 'Running backend tests',
  metadata: { command: 'npm test' },
};

let t: TestApp;
let logs: ReturnType<typeof captureLogger>;

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  await t.close();
});

const post = (body: unknown) =>
  request(t.baseUrl)
    .post('/api/events')
    .send(body as object);

describe('POST /api/events — §12 example (REQ-022, ES §11)', () => {
  it('201 with the stored event, updated agent and task; one broadcast equal to data', async () => {
    const before = t.database.repos.agents.getById(BE);
    const res = await post(EXAMPLE);
    expect(res.status).toBe(201);
    const { event, agent, task } = res.body.data;
    expect(event).toMatchObject({
      type: 'agent.activity',
      source: 'api',
      agentId: BE,
      project: 'sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'run_command',
      message: 'Running backend tests',
      severity: 'info',
      progress: null,
      metadata: { command: 'npm test' },
      occurredAt: null,
      forced: false,
    });
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(event.seq).toBe(t.database.repos.events.maxSeq());
    expect(agent).toMatchObject({
      status: 'working',
      currentAction: 'run_command',
      lastMessage: 'Running backend tests',
      taskId: 'SW-123',
      currentTask: 'Lost Goods API',
      currentProject: 'sellway',
      startedAt: event.createdAt,
      lastActivityAt: event.createdAt,
      version: (before?.version ?? 0) + 1,
    });
    expect(task).toMatchObject({
      id: 'SW-123',
      status: 'in_progress',
      startedAt: event.createdAt,
      version: 2,
    });
    expect(t.recorder.messages).toEqual([{ name: 'office:event', payload: res.body.data }]);

    const listed = await request(t.baseUrl).get('/api/events?limit=1');
    expect(listed.body.data[0]).toEqual(event);
  });

  it('REQ-191 API steps: idle → working, back to idle, POST again', async () => {
    expect((await post(EXAMPLE)).status).toBe(201);
    const idle = await request(t.baseUrl)
      .patch(`/api/agents/${BE}/status`)
      .send({ status: 'idle' });
    expect(idle.body.data.agent).toMatchObject({
      status: 'idle',
      taskId: null,
      currentAction: null,
      progress: 0,
    });
    const again = await post(EXAMPLE);
    expect(again.status).toBe(201);
    expect(again.body.data.agent.status).toBe('working');
  });
});

describe('POST /api/events — every rejection leaves no trace (REQ-029)', () => {
  it.each([
    [{ ...EXAMPLE, foo: 1 }, 400, 'VALIDATION_ERROR', 'Validation failed: foo: Unrecognized key'],
    [
      { type: 'task.created', message: 'x' },
      400,
      'VALIDATION_ERROR',
      'Validation failed: type: Event type task.created is server-only',
    ],
    [
      { type: 'agent.dance', agentId: BE },
      400,
      'VALIDATION_ERROR',
      'Validation failed: type: Unknown event type: agent.dance',
    ],
    [
      { ...EXAMPLE, source: 'demo' },
      400,
      'VALIDATION_ERROR',
      'Validation failed: source: Source "demo" is reserved',
    ],
    [
      { type: 'agent.connected', agentId: BE, status: 'idle' },
      400,
      'VALIDATION_ERROR',
      'Validation failed: status: Unrecognized key',
    ],
    [{ ...EXAMPLE, progress: 101 }, 400, 'VALIDATION_ERROR', undefined],
    [{ ...EXAMPLE, metadata: [] }, 400, 'VALIDATION_ERROR', undefined],
    [
      { type: 'agent.activity', agentId: '99-ghost', action: 'x' },
      422,
      'UNKNOWN_AGENT',
      'Unknown agent: 99-ghost',
    ],
    [
      { type: 'system.info', agentId: '99-ghost', message: 'x' },
      422,
      'UNKNOWN_AGENT',
      'Unknown agent: 99-ghost',
    ],
    [
      { ...EXAMPLE, project: 'All Projects' },
      422,
      'UNKNOWN_PROJECT',
      'Unknown project: All Projects',
    ],
    [
      { type: 'agent.task.started', agentId: BE, taskId: 'SW-999' },
      422,
      'UNKNOWN_TASK',
      'Unknown task: SW-999',
    ],
    [
      { type: 'agent.task.assigned', agentId: BE, taskId: 'SW-999' },
      422,
      'UNKNOWN_TASK',
      'Task SW-999 does not exist; include project to create it',
    ],
    [
      { ...EXAMPLE, project: 'erp' },
      422,
      'PROJECT_MISMATCH',
      'Task SW-123 belongs to project sellway, not erp',
    ],
    [
      { type: 'agent.status.changed', agentId: BE, status: 'completed' },
      409,
      'ILLEGAL_TRANSITION',
      'Illegal transition: idle → completed',
    ],
    [
      { type: 'agent.status.changed', agentId: '07-devops-engineer', status: 'working' },
      409,
      'ILLEGAL_TRANSITION',
      'Illegal transition: offline → working',
    ],
    [
      { type: 'agent.task.progress', agentId: '10-ui-ux-designer', taskId: 'IK-201', progress: 50 },
      409,
      'ILLEGAL_TRANSITION',
      'Task IK-201 is completed; progress cannot change',
    ],
    [
      { type: 'agent.task.completed', agentId: FE, taskId: 'SW-125' },
      409,
      'ILLEGAL_TRANSITION',
      'Illegal task transition: todo → completed (task SW-125)',
    ],
  ] as const)('%j → %i %s', async (body, status, code, message) => {
    await expectNoTrace(t.database, t.recorder, async () => {
      const res = await post(body);
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      if (message !== undefined) expect(res.body.error.message).toBe(message);
    });
  });

  it('several validation issues are all reported', async () => {
    const res = await post({ type: 'agent.activity', agentId: BE, action: '', foo: 1, bar: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'foo', message: 'Unrecognized key' },
        { path: 'bar', message: 'Unrecognized key' },
      ]),
    );
    expect(res.body.error.message).toMatch(/\(\+\d+ more\)$/);
  });

  it('event_rejected is logged at warn with code/type/agentId/source and never the payload', async () => {
    await post({
      type: 'agent.status.changed',
      agentId: BE,
      status: 'completed',
      message: 'SECRET-PAYLOAD',
      metadata: { token: 'SECRET-PAYLOAD' },
    });
    const rejected = logs.records.filter((r) => r.msg === 'event_rejected');
    expect(rejected).toEqual([
      {
        time: expect.any(String) as string,
        level: 'warn',
        msg: 'event_rejected',
        code: 'ILLEGAL_TRANSITION',
        type: 'agent.status.changed',
        agentId: BE,
        source: 'api',
      },
    ]);
    expect(JSON.stringify(logs.records)).not.toContain('SECRET-PAYLOAD');
  });

  it('accepted events are not logged at info (REQ-151)', async () => {
    await post(EXAMPLE);
    expect(logs.records.filter((r) => r.level === 'info' || r.level === 'warn')).toEqual([]);
  });
});

describe('POST /api/events — other types', () => {
  it('system.* without agent → agent null, task null; severity default', async () => {
    const res = await post({ type: 'system.warning', message: 'Queue lag' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      agent: null,
      task: null,
      event: { severity: 'warning', project: null },
    });
  });

  it('agent.task.assigned creates an unknown task with the project', async () => {
    const res = await post({
      type: 'agent.task.assigned',
      agentId: BE,
      taskId: 'SW-500',
      project: 'sellway',
      metadata: { title: 'New API' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.task).toMatchObject({
      id: 'SW-500',
      title: 'New API',
      status: 'assigned',
      assignedAgentId: BE,
      version: 1,
    });
    expect(res.body.data.agent).toMatchObject({ status: 'idle', taskId: null }); // assignment alone does not bind
  });

  it('agent.task.progress updates task and agent progress', async () => {
    const res = await post({
      type: 'agent.task.progress',
      agentId: FE,
      taskId: 'SW-124',
      progress: 75,
    });
    expect(res.body.data.task.progress).toBe(75);
    expect(res.body.data.agent.progress).toBe(75);
  });

  it('a non-assignee event leaves the task alone (task: null)', async () => {
    const res = await post({
      type: 'agent.status.changed',
      agentId: '14-reviewer',
      status: 'reviewing',
      taskId: 'SW-123',
    });
    expect(res.body.data.task).toBeNull();
    expect(res.body.data.agent).toMatchObject({ taskId: 'SW-123', status: 'reviewing' });
  });
});

describe('GET /api/events', () => {
  it('newest first, default limit 50, nextBefore paging with the before cursor', async () => {
    const all = await request(t.baseUrl).get('/api/events?limit=500');
    const seqs = (all.body.data as { seq: number }[]).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
    expect(all.body.page).toEqual({ limit: 500, nextBefore: null });

    const first = await request(t.baseUrl).get('/api/events?limit=10');
    expect(first.body.data).toHaveLength(10);
    expect(first.body.page).toEqual({ limit: 10, nextBefore: first.body.data[9].seq });
    const second = await request(t.baseUrl).get(
      `/api/events?limit=10&before=${String(first.body.page.nextBefore)}`,
    );
    expect(second.body.data[0].seq).toBe(seqs[10]);

    const def = await request(t.baseUrl).get('/api/events');
    expect(def.body.page.limit).toBe(50);
  });

  it('project filter = feed predicate (project events + project-less warning/error)', async () => {
    await post({ type: 'system.warning', message: 'global warning' });
    await post({ type: 'system.info', message: 'global info' });
    const res = await request(t.baseUrl).get('/api/events?project=Sellway&limit=500');
    for (const e of res.body.data as { project: string | null; type: string }[]) {
      expect(
        e.project === 'sellway' ||
          (e.project === null && ['system.warning', 'system.error'].includes(e.type)),
      ).toBe(true);
    }
    const messages = (res.body.data as { message: string }[]).map((e) => e.message);
    expect(messages).toContain('global warning');
    expect(messages).not.toContain('global info');
  });

  it('agentId, taskId, type and source filters are AND-combined', async () => {
    await post({ ...EXAMPLE, source: 'simulator' });
    const res = await request(t.baseUrl).get(
      `/api/events?agentId=${BE}&taskId=SW-123&type=agent.activity&source=simulator`,
    );
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      agentId: BE,
      taskId: 'SW-123',
      type: 'agent.activity',
      source: 'simulator',
    });
  });

  it.each([
    ['?limit=0', 400, 'VALIDATION_ERROR'],
    ['?limit=501', 400, 'VALIDATION_ERROR'],
    ['?limit=1.5', 400, 'VALIDATION_ERROR'],
    ['?before=-1', 400, 'VALIDATION_ERROR'],
    ['?type=agent.dance', 400, 'VALIDATION_ERROR'],
    ['?foo=1', 400, 'VALIDATION_ERROR'],
    ['?project=nowhere', 422, 'UNKNOWN_PROJECT'],
    ['?agentId=99-ghost', 422, 'UNKNOWN_AGENT'],
  ] as const)('%s → %i %s', async (query, status, code) => {
    const res = await request(t.baseUrl).get(`/api/events${query}`);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });

  it('taskId existence is not checked; reserved sources are allowed as filters', async () => {
    expect((await request(t.baseUrl).get('/api/events?taskId=NOPE-1')).body.data).toEqual([]);
    expect((await request(t.baseUrl).get('/api/events?source=demo')).status).toBe(200);
  });
});
