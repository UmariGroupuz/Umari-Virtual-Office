// CR-9 / ADR-035 §7: demo restore never deletes a demo task that a surviving row still references.
import type { DemoRestoreSummary } from '@vo/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoTaskId } from '../src/services/demoScript';
import { captureLogger, createTestApp, type TestApp } from './helpers/testApp';

const ARC = '03-architect';
let t: TestApp;
let logs: ReturnType<typeof captureLogger>;

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  await t.close();
});

async function startAndRun(beats: number): Promise<number> {
  await request(t.baseUrl).post('/api/demo/start').send({});
  const setting = t.database.repos.settings.get('demo') as unknown as { startSeq: number };
  for (let i = 0; i < beats; i += 1) t.server.services.demo.tick();
  return setting.startSeq;
}

describe('restore keeps referenced demo tasks (CR-9)', () => {
  it('a kept (user-touched) agent bound to a demo task keeps that task', async () => {
    const session = await startAndRun(2); // beat 2: the Architect plans demo task …a
    const taskA = demoTaskId('SW', session, 1, 'a');
    expect(t.database.repos.agents.getById(ARC)?.taskId).toBe(taskA);
    // The user talks to the Architect without a taskId: agent touched, task not touched.
    await request(t.baseUrl)
      .post('/api/events')
      .send({ type: 'agent.message', agentId: ARC, message: 'How is it going?' });

    const stop = await request(t.baseUrl).post('/api/demo/stop').send({});
    const restored = stop.body.data.restored as DemoRestoreSummary;
    expect(t.database.repos.agents.getById(ARC)?.taskId).toBe(taskA);
    expect(t.database.repos.tasks.getById(taskA)).not.toBeNull();
    expect(restored).toMatchObject({ agentsKept: 1, tasksKept: 1, tasksDeleted: 0 });
    expect(logs.records).toContainEqual(
      expect.objectContaining({ msg: 'demo_task_kept', reason: 'referenced', taskIds: [taskA] }),
    );
  });

  it('a user task blocked by a demo task keeps it; unreferenced demo tasks are still deleted', async () => {
    const session = await startAndRun(3); // beat 3: demo tasks …b and …c exist
    const taskB = demoTaskId('SW', session, 1, 'b');
    const taskC = demoTaskId('SW', session, 1, 'c');
    const created = await request(t.baseUrl)
      .post('/api/tasks')
      .send({ title: 'Release notes', project: 'sellway', blockedBy: [taskB] });
    expect(created.status).toBe(201);

    const stop = await request(t.baseUrl).post('/api/demo/stop').send({});
    const restored = stop.body.data.restored as DemoRestoreSummary;
    expect(t.database.repos.tasks.getById(taskB)).not.toBeNull();
    expect(t.database.repos.tasks.getById(taskC)).toBeNull();
    expect(t.database.repos.tasks.getById(created.body.data.task.id)).not.toBeNull();
    expect(restored.tasksKept).toBe(2); // the user task + the referenced demo task
    expect(restored.tasksDeleted).toBe(2); // …a and …c
  });

  it('no reference → every demo task is deleted (unchanged behaviour)', async () => {
    await startAndRun(3);
    const stop = await request(t.baseUrl).post('/api/demo/stop').send({});
    expect(stop.body.data.restored).toMatchObject({ tasksKept: 0, tasksDeleted: 3 });
    expect(logs.records.some((r) => r.msg === 'demo_task_kept')).toBe(false);
  });
});
