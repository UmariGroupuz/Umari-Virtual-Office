// CR-4 (`lastSeq` resync watermark) and CR-6 (snapshot task selection), ADR-035 §3–§4.
import type { Task } from '@vo/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

describe('snapshot lastSeq (CR-4)', () => {
  it('is the global max event seq, unaffected by the project filter, and follows new writes', async () => {
    t = await createTestApp();
    const max = t.database.repos.events.maxSeq();
    expect((await request(t.baseUrl).get('/api/snapshot')).body.data.lastSeq).toBe(max);
    await request(t.baseUrl)
      .post('/api/events')
      .send({ type: 'system.info', message: 'global, no project' });
    const filtered = (await request(t.baseUrl).get('/api/snapshot?project=erp&eventsLimit=1')).body
      .data;
    expect(filtered.lastSeq).toBe(max + 1);
    expect(filtered.events[0].seq).toBeLessThan(filtered.lastSeq); // the newest event is not an ERP one
  });

  it('is 0 on an empty database', async () => {
    t = await createTestApp({ seed: false });
    expect((await request(t.baseUrl).get('/api/snapshot')).body.data.lastSeq).toBe(0);
  });

  it('every broadcast committed before the read has seq <= lastSeq; later ones have seq > lastSeq', async () => {
    t = await createTestApp();
    await request(t.baseUrl).post('/api/events').send({ type: 'system.info', message: 'before' });
    const snap = (await request(t.baseUrl).get('/api/snapshot')).body.data;
    const after = (
      await request(t.baseUrl).post('/api/events').send({ type: 'system.info', message: 'after' })
    ).body.data;
    const seqs = t.recorder.messages
      .filter((m) => m.name === 'office:event')
      .map((m) => (m.payload as { event: { seq: number } }).event.seq);
    expect(seqs.filter((seq) => seq <= snap.lastSeq)).toHaveLength(seqs.length - 1);
    expect(after.event.seq).toBe(snap.lastSeq + 1);
  });
});

describe('snapshot task cap (CR-6)', () => {
  it('returns the newest 500 tasks plus every task an agent is bound to, in API order', async () => {
    t = await createTestApp();
    const repos = t.database.repos;
    const base = Date.now() + 60_000; // newer than every seed task
    t.database.transaction((tx) => {
      for (let i = 0; i < 510; i += 1) {
        tx.tasks.insert(
          {
            id: `ERP-${1000 + i}`,
            title: `Bulk ${i}`,
            description: null,
            project: 'erp',
            assignedAgentId: null,
            status: 'todo',
            priority: 'normal',
            progress: 0,
            createdAt: new Date(base + i * 1000).toISOString(),
            startedAt: null,
            completedAt: null,
            blockedBy: [],
            metadata: {},
          },
          new Date().toISOString(),
        );
      }
    });
    const bound = new Set(
      repos.agents.list().flatMap((a) => (a.taskId === null ? [] : [a.taskId])),
    );
    expect(bound.size).toBe(7); // the seeded busy agents

    const tasks = (await request(t.baseUrl).get('/api/snapshot')).body.data.tasks as Task[];
    const ids = tasks.map((x) => x.id);
    expect(tasks).toHaveLength(500 + bound.size);
    for (let i = 10; i < 510; i += 1) expect(ids).toContain(`ERP-${1000 + i}`); // newest 500
    for (let i = 0; i < 10; i += 1) expect(ids).not.toContain(`ERP-${1000 + i}`); // oldest bulk dropped
    for (const id of bound) expect(ids).toContain(id); // bound tasks always present
    expect(ids).not.toContain('SW-125'); // old and unbound → dropped
    const keys = tasks.map((x) => `${x.createdAt}|${x.id}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('below the cap the snapshot equals GET /api/tasks', async () => {
    t = await createTestApp();
    const snap = (await request(t.baseUrl).get('/api/snapshot')).body.data.tasks;
    expect(snap).toEqual((await request(t.baseUrl).get('/api/tasks')).body.data);
  });
});
