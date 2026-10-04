import type { Agent, DemoRestoreSummary, OfficeEvent, Task } from '@vo/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { DEMO_BEATS_PER_CYCLE } from '../src/services/demoScript';
import { stoppedMessage } from '../src/services/demoService';
import { captureState } from './helpers/state';
import { captureLogger, createTestApp, type TestApp } from './helpers/testApp';

const PM = '01-pm-orchestrator';
const BE = '04-backend-engineer';
const SEC = '08-security-engineer';
let t: TestApp;
let logs: ReturnType<typeof captureLogger>;

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  await t.close();
});

const startDemo = (body: object = {}) => request(t.baseUrl).post('/api/demo/start').send(body);
const stopDemo = () => request(t.baseUrl).post('/api/demo/stop').send({});
const ticks = (n: number) => {
  for (let i = 0; i < n; i += 1) t.server.services.demo.tick();
};
const withoutVersion = <T extends { version: number }>(row: T) => ({ ...row, version: 0 });
const eventsSince = (seq: number): OfficeEvent[] =>
  t.database.repos.events.list({ limit: 500 }).events.filter((e) => e.seq > seq);

describe('demo start / state (API_CONTRACTS §3.12–3.13)', () => {
  it('GET /api/demo is inactive by default', async () => {
    expect((await request(t.baseUrl).get('/api/demo')).body.data).toEqual({
      active: false,
      intervalMs: 10_000,
      startedAt: null,
    });
  });

  it('start persists the snapshot, writes a system event and broadcasts office:event then demo:state', async () => {
    const seqBefore = t.database.repos.events.maxSeq();
    const res = await startDemo({ intervalMs: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      active: true,
      intervalMs: 5000,
      startedAt: expect.any(String) as string,
    });
    const setting = t.database.repos.settings.get('demo') as unknown as {
      startSeq: number;
      snapshot: { agents: Agent[]; tasks: Task[] };
      intervalMs: number;
    };
    expect(setting).toMatchObject({
      active: true,
      intervalMs: 5000,
      startSeq: seqBefore,
      startedAt: res.body.data.startedAt,
    });
    expect(setting.snapshot.agents).toHaveLength(15);
    expect(setting.snapshot.tasks).toHaveLength(11);
    expect(t.recorder.messages.map((m) => m.name)).toEqual(['office:event', 'demo:state']);
    expect(t.recorder.messages[0]?.payload).toMatchObject({
      event: {
        type: 'system.info',
        source: 'system',
        message: 'Demo mode started',
        agentId: null,
        project: null,
      },
      agent: null,
      task: null,
    });
    expect(t.recorder.messages[1]?.payload).toEqual(res.body.data);
    expect(logs.records).toContainEqual(
      expect.objectContaining({ msg: 'demo_started', intervalMs: 5000, startSeq: seqBefore }),
    );
    expect((await request(t.baseUrl).get('/api/snapshot')).body.data.demo).toEqual(res.body.data);
  });

  it('start is idempotent: the requested interval is ignored, nothing is written', async () => {
    const first = (await startDemo()).body.data;
    const before = captureState(t.database);
    t.recorder.clear();
    const again = await startDemo({ intervalMs: 2000 });
    expect(again.body.data).toEqual(first);
    expect(captureState(t.database)).toEqual(before);
    expect(t.recorder.messages).toEqual([]);
  });

  it.each([
    [{ intervalMs: 1999 }],
    [{ intervalMs: 10_001 }],
    [{ intervalMs: 'fast' }],
    [{ foo: 1 }],
  ])('start with %j → 400', async (body) => {
    const res = await startDemo(body);
    expect(res.status).toBe(400);
    expect((await request(t.baseUrl).get('/api/demo')).body.data.active).toBe(false);
  });

  it('stop requires a strict {} body', async () => {
    expect((await request(t.baseUrl).post('/api/demo/stop').send({ now: true })).status).toBe(400);
  });
});

describe('demo ticks', () => {
  it('beats go through the event pipeline with source "demo" and are broadcast', async () => {
    await startDemo();
    const startSeq = t.database.repos.events.maxSeq();
    t.recorder.clear();
    ticks(DEMO_BEATS_PER_CYCLE * 2);
    const produced = eventsSince(startSeq);
    expect(produced.length).toBeGreaterThan(40);
    expect(new Set(produced.map((e) => e.source))).toEqual(new Set(['demo']));
    expect(t.recorder.messages.filter((m) => m.name === 'office:event')).toHaveLength(
      produced.length,
    );
    expect(logs.records.filter((r) => r.msg === 'demo_event_rejected')).toEqual([]);
    const tasks = t.database.repos.tasks
      .list({ limit: 500 })
      .filter((x) => x.id.includes(`-D${startSeq - 1}-`));
    expect(tasks.map((x) => x.id).sort()).toEqual(
      ['SW', 'IK']
        .flatMap((p, i) => ['a', 'b', 'c', 'd'].map((l) => `${p}-D${startSeq - 1}-${i + 1}${l}`))
        .sort(),
    );
    expect(tasks.every((x) => x.metadata.demo === true && x.status === 'completed')).toBe(true);
  });

  it('a tick after stop does nothing', async () => {
    await startDemo();
    await stopDemo();
    const before = captureState(t.database);
    ticks(3);
    expect(captureState(t.database)).toEqual(before);
  });

  it('the timer chains beats at the configured interval', async () => {
    await startDemo({ intervalMs: 2000 });
    const startSeq = t.database.repos.events.maxSeq();
    await expect
      .poll(() => eventsSince(startSeq).filter((e) => e.source === 'demo').length, {
        timeout: 6000,
        interval: 200,
      })
      .toBeGreaterThanOrEqual(2);
  }, 10_000);
});

describe('demo stop / restore (ADR-011, REQ-112)', () => {
  it('restores untouched entities, keeps user-touched ones, deletes demo tasks, keeps user tasks', async () => {
    const before = captureState(t.database);
    const agentsBefore = new Map((before.agents as Agent[]).map((a) => [a.id, a]));
    const tasksBefore = new Map((before.tasks as Task[]).map((x) => [x.id, x]));
    await startDemo();
    // The user acts during the demo: Backend works on SW-123, a user task is created.
    expect(
      (
        await request(t.baseUrl).post('/api/events').send({
          type: 'agent.activity',
          agentId: BE,
          taskId: 'SW-123',
          status: 'working',
          action: 'edit_file',
        })
      ).status,
    ).toBe(201);
    const userTask = (
      await request(t.baseUrl).post('/api/tasks').send({ title: 'User task', project: 'erp' })
    ).body.data.task as Task;
    ticks(DEMO_BEATS_PER_CYCLE + 2); // cycle 2 ends at beat 2: PM is planning
    const beAfterTicks = t.database.repos.agents.getById(BE);
    const sw123AfterTicks = t.database.repos.tasks.getById('SW-123');
    const pmVersionBeforeStop = t.database.repos.agents.getById(PM)?.version ?? 0;
    expect(t.database.repos.agents.getById(PM)?.status).not.toBe(agentsBefore.get(PM)?.status);
    t.recorder.clear();

    const res = await stopDemo();
    expect(res.status).toBe(200);
    const restored = res.body.data.restored as DemoRestoreSummary;
    expect(res.body.data.demo).toEqual({ active: false, intervalMs: 10_000, startedAt: null });

    // User wins: Backend and SW-123 are exactly as the user (and nothing else) left them.
    expect(t.database.repos.agents.getById(BE)).toEqual(beAfterTicks);
    expect(t.database.repos.tasks.getById('SW-123')).toEqual(sw123AfterTicks);
    expect(beAfterTicks?.status).toBe('working');
    // The user task is kept; demo tasks are gone.
    expect(t.database.repos.tasks.getById(userTask.id)).toEqual(userTask);
    const remaining = t.database.repos.tasks.list({ limit: 500 });
    expect(remaining.filter((x) => x.id.includes('-D'))).toEqual([]);
    expect(remaining).toHaveLength(12);
    // Untouched agents/tasks are back to their pre-demo values; restored rows get version + 1.
    for (const agent of t.database.repos.agents.list()) {
      if (agent.id === BE) continue;
      expect(withoutVersion(agent)).toEqual(withoutVersion(agentsBefore.get(agent.id) as Agent));
    }
    expect(t.database.repos.agents.getById(PM)?.version).toBe(pmVersionBeforeStop + 1);
    expect(t.database.repos.agents.getById(SEC)?.version).toBe(1); // never changed → not rewritten
    for (const [id, task] of tasksBefore) {
      if (id === 'SW-123') continue;
      expect(withoutVersion(t.database.repos.tasks.getById(id) as Task)).toEqual(
        withoutVersion(task),
      );
    }
    expect(restored.agentsKept).toBe(1);
    expect(restored.tasksKept).toBe(2); // SW-123 (user event) + the user-created task
    expect(restored.tasksDeleted).toBe(4);
    expect(restored.agentsRestored).toBeGreaterThanOrEqual(6);

    // Event, broadcasts, setting, log.
    expect(t.recorder.messages.map((m) => m.name)).toEqual([
      'office:event',
      'demo:state',
      'office:resync',
    ]);
    expect(t.recorder.messages[0]?.payload).toMatchObject({
      event: {
        type: 'system.info',
        source: 'system',
        message: stoppedMessage(restored), // exact strings: test/securityHardening.test.ts
        metadata: { ...restored },
      },
    });
    expect(t.recorder.messages[2]?.payload).toEqual({ reason: 'demo-restored' });
    expect(t.database.repos.settings.get('demo')).toBeNull();
    expect(logs.records).toContainEqual(
      expect.objectContaining({ msg: 'demo_stopped', reason: 'user', ...restored }),
    );
    // Demo events stay in history (A-11).
    expect(
      (await request(t.baseUrl).get('/api/events?source=demo&limit=500')).body.data.length,
    ).toBeGreaterThan(0);
  });

  it('stop is idempotent: not active → restored null, nothing written', async () => {
    const before = captureState(t.database);
    const res = await stopDemo();
    expect(res.body.data).toEqual({
      demo: { active: false, intervalMs: 10_000, startedAt: null },
      restored: null,
    });
    expect(captureState(t.database)).toEqual(before);
    expect(t.recorder.messages).toEqual([]);
  });

  it('the demo never changes pre-existing tasks', async () => {
    const tasksBefore = t.database.repos.tasks.list({ limit: 500 });
    await startDemo();
    ticks(DEMO_BEATS_PER_CYCLE * 4);
    for (const task of tasksBefore) expect(t.database.repos.tasks.getById(task.id)).toEqual(task);
  });
});

describe('restore safety', () => {
  it('a lost demo setting never deletes or rewrites anything on stop', async () => {
    await startDemo();
    ticks(DEMO_BEATS_PER_CYCLE);
    t.database.transaction((repos) => repos.settings.delete('demo'));
    const before = captureState(t.database);
    const res = await stopDemo();
    expect(res.body.data.restored).toEqual({
      agentsRestored: 0,
      agentsKept: 0,
      tasksRestored: 0,
      tasksKept: 0,
      tasksDeleted: 0,
    });
    const after = captureState(t.database);
    expect(after.agents).toEqual(before.agents);
    expect(after.tasks).toEqual(before.tasks);
    expect(logs.records).toContainEqual(
      expect.objectContaining({ msg: 'demo_setting_invalid', level: 'warn' }),
    );
  });

  it('only demo-created tasks (metadata.demo) are deleted', async () => {
    await startDemo();
    ticks(3); // creates demo tasks a, b, c
    // A task that bypassed the event log (no user event) but is not a demo task must survive.
    t.database.transaction((repos) =>
      repos.tasks.insert(
        {
          id: 'ERP-777',
          title: 'Imported',
          description: null,
          project: 'erp',
          assignedAgentId: null,
          status: 'todo',
          priority: 'low',
          progress: 0,
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          blockedBy: [],
          metadata: {},
        },
        new Date().toISOString(),
      ),
    );
    const res = await stopDemo();
    expect(res.body.data.restored.tasksDeleted).toBe(3);
    expect(t.database.repos.tasks.getById('ERP-777')).not.toBeNull();
  });
});

describe('graceful shutdown restores the demo (REQ-113)', () => {
  it('server.close() stops the demo with a restore before closing', async () => {
    const database = openDatabase({ path: ':memory:' });
    const own = await createTestApp({ database, logger: logs.logger });
    try {
      const agentsBefore = database.repos.agents.list();
      await request(own.baseUrl).post('/api/demo/start').send({});
      for (let i = 0; i < 6; i += 1) own.server.services.demo.tick();
      await own.close();
      expect(database.repos.settings.get('demo')).toBeNull();
      expect(database.repos.agents.list().map(withoutVersion)).toEqual(
        agentsBefore.map(withoutVersion),
      );
      expect(logs.records).toContainEqual(
        expect.objectContaining({ msg: 'demo_stopped', reason: 'shutdown' }),
      );
    } finally {
      await own.close();
      database.close();
    }
  });
});
