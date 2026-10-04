import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/testApp';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
  await request(t.baseUrl).post('/api/events').send({ type: 'system.error', message: 'Disk full' });
});
afterAll(async () => {
  await t.close();
});

describe('GET /api/snapshot (ADR-010)', () => {
  it('returns the whole consistent state', async () => {
    const res = await request(t.baseUrl).get('/api/snapshot');
    expect(res.status).toBe(200);
    const snap = res.body.data;
    expect(Object.keys(snap).sort()).toEqual([
      'agents',
      'demo',
      'events',
      'eventsPage',
      'lastSeq',
      'projects',
      'serverTime',
      'tasks',
    ]);
    expect(snap.agents).toEqual((await request(t.baseUrl).get('/api/agents')).body.data);
    expect(snap.tasks).toEqual((await request(t.baseUrl).get('/api/tasks')).body.data);
    expect(snap.projects).toHaveLength(4);
    const total = t.database.repos.events.count();
    expect(snap.events).toHaveLength(Math.min(total, 50));
    expect(snap.eventsPage.limit).toBe(50);
    const paged = (await request(t.baseUrl).get('/api/snapshot?eventsLimit=10')).body.data;
    expect(paged.events).toHaveLength(10);
    expect(paged.eventsPage).toEqual({ limit: 10, nextBefore: paged.events[9].seq });
    expect(snap.demo).toEqual({ active: false, intervalMs: 10_000, startedAt: null });
    expect(Date.parse(snap.serverTime)).not.toBeNaN();
  });

  it('project filters only the events (feed predicate)', async () => {
    const res = await request(t.baseUrl).get('/api/snapshot?project=ERP&eventsLimit=500');
    expect(res.body.data.agents).toHaveLength(15);
    expect(res.body.data.tasks).toHaveLength(11);
    for (const e of res.body.data.events as { project: string | null; type: string }[]) {
      expect(
        e.project === 'erp' ||
          (e.project === null && ['system.warning', 'system.error'].includes(e.type)),
      ).toBe(true);
    }
    expect(res.body.data.events.some((e: { message: string }) => e.message === 'Disk full')).toBe(
      true,
    );
    expect(res.body.data.eventsPage).toEqual({ limit: 500, nextBefore: null });
  });

  it.each([
    ['?eventsLimit=0', 400],
    ['?eventsLimit=abc', 400],
    ['?limit=5', 400],
    ['?project=nowhere', 422],
  ] as const)('%s → %i', async (query, status) => {
    expect((await request(t.baseUrl).get(`/api/snapshot${query}`)).status).toBe(status);
  });
});
