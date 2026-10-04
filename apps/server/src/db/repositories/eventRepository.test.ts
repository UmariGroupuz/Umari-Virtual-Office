import { eventMatchesProject, type OfficeEvent } from '@vo/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEvent, openTestDatabase, T0, T1 } from '../testing';
import type { DatabaseHandle, NewEvent } from '../types';

const BE = '04-backend-engineer';
const FE = '05-frontend-engineer';
const QA = '09-qa-engineer';

describe('EventRepository', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase();
  });
  afterEach(() => {
    handle.close();
  });

  it('insert assigns strictly increasing seq and round-trips every field', () => {
    const input: NewEvent = makeEvent({
      type: 'agent.task.failed',
      source: 'simulator',
      agentId: QA,
      project: 'erp',
      taskId: 'ERP-302',
      status: 'failed',
      action: 'test',
      message: '<img src=x onerror=alert(1)>',
      severity: 'error',
      progress: 55,
      metadata: { failed: 3, list: ['a', null] },
      occurredAt: '2026-10-04T09:59:00.000+05:00',
      createdAt: T1,
      forced: true,
    });

    const first = handle.repos.events.insert(input);
    const second = handle.repos.events.insert(makeEvent());

    expect(first).toEqual({ ...input, seq: 1 });
    expect(second.seq).toBe(2);
    expect(handle.repos.events.count()).toBe(2);
    expect(handle.repos.events.maxSeq()).toBe(2);
  });

  it('maps nullable columns and false/empty defaults', () => {
    const stored = handle.repos.events.insert(
      makeEvent({
        type: 'system.warning',
        agentId: null,
        project: null,
        action: null,
        message: 'disk',
        severity: 'warning',
      }),
    );
    expect(stored).toMatchObject({
      agentId: null,
      project: null,
      taskId: null,
      status: null,
      progress: null,
      occurredAt: null,
      forced: false,
      metadata: {},
    });
  });

  it('maxSeq and count are 0 on an empty table', () => {
    expect(handle.repos.events.maxSeq()).toBe(0);
    expect(handle.repos.events.count()).toBe(0);
  });

  it('rejects duplicate ids, unknown agents/projects and invalid severity/progress', () => {
    const e = makeEvent();
    handle.repos.events.insert(e);
    expect(() => handle.repos.events.insert(e)).toThrow(/UNIQUE/);
    expect(() => handle.repos.events.insert(makeEvent({ agentId: '99-ghost' }))).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => handle.repos.events.insert(makeEvent({ project: 'nope' }))).toThrow(/FOREIGN KEY/);
    expect(() => handle.repos.events.insert(makeEvent({ severity: 'fatal' as never }))).toThrow(
      /CHECK/,
    );
    expect(() => handle.repos.events.insert(makeEvent({ progress: 101 }))).toThrow(/CHECK/);
    // task ids have no FK (tasks may be unknown or deleted)
    expect(() => handle.repos.events.insert(makeEvent({ taskId: 'SW-404' }))).not.toThrow();
  });

  describe('list', () => {
    let all: OfficeEvent[];

    beforeEach(() => {
      const inputs: Partial<NewEvent>[] = [
        {
          type: 'agent.activity',
          agentId: BE,
          project: 'sellway',
          taskId: 'SW-123',
          source: 'api',
        }, // 1
        { type: 'system.warning', agentId: null, project: null, severity: 'warning', message: 'w' }, // 2
        { type: 'system.info', agentId: null, project: null, message: 'i' }, // 3 (hidden by project filter)
        {
          type: 'agent.status.changed',
          agentId: FE,
          project: 'sellway',
          status: 'working',
          source: 'simulator',
        }, // 4
        { type: 'agent.activity', agentId: QA, project: 'erp', taskId: 'ERP-302' }, // 5
        { type: 'system.error', agentId: null, project: null, severity: 'error', message: 'e' }, // 6
        { type: 'system.error', agentId: QA, project: 'erp', severity: 'error', message: 'e2' }, // 7
        {
          type: 'agent.activity',
          agentId: BE,
          project: 'sellway',
          taskId: 'SW-123',
          source: 'demo',
        }, // 8
        {
          type: 'task.updated',
          agentId: BE,
          project: 'sellway',
          taskId: 'SW-123',
          status: 'in_progress',
        }, // 9
      ];
      all = inputs.map((i) => handle.repos.events.insert(makeEvent(i)));
    });

    const seqs = (events: OfficeEvent[]): number[] => events.map((e) => e.seq);

    it('returns newest first with nextBefore null when nothing older matches', () => {
      expect(handle.repos.events.list({ limit: 50 })).toEqual({
        events: [...all].reverse(),
        nextBefore: null,
      });
    });

    it('pages with limit + 1: nextBefore = seq of the oldest returned event when older ones exist', () => {
      const page1 = handle.repos.events.list({ limit: 4 });
      expect(seqs(page1.events)).toEqual([9, 8, 7, 6]);
      expect(page1.nextBefore).toBe(6);

      const page2 = handle.repos.events.list({ limit: 4, before: 6 });
      expect(seqs(page2.events)).toEqual([5, 4, 3, 2]);
      expect(page2.nextBefore).toBe(2);

      const page3 = handle.repos.events.list({ limit: 4, before: 2 });
      expect(seqs(page3.events)).toEqual([1]);
      expect(page3.nextBefore).toBeNull();
    });

    it('exactly limit matching events left → nextBefore null', () => {
      expect(handle.repos.events.list({ limit: 9 }).nextBefore).toBeNull();
      expect(handle.repos.events.list({ limit: 8 }).nextBefore).toBe(2);
      expect(handle.repos.events.list({ limit: 1, before: 2 })).toEqual({
        events: [all[0]],
        nextBefore: null,
      });
    });

    it('applies the feed predicate for projectId (project events + project-less warning/error)', () => {
      expect(seqs(handle.repos.events.list({ limit: 50, projectId: 'sellway' }).events)).toEqual([
        9, 8, 6, 4, 2, 1,
      ]);
      expect(seqs(handle.repos.events.list({ limit: 50, projectId: 'erp' }).events)).toEqual([
        7, 6, 5, 2,
      ]);
      expect(seqs(handle.repos.events.list({ limit: 50, projectId: 'ana-market' }).events)).toEqual(
        [6, 2],
      );
      // same predicate as the shared client-side filter
      for (const projectId of ['sellway', 'erp', 'ishkun24', 'ana-market']) {
        const expected = [...all].reverse().filter((e) => eventMatchesProject(e, projectId));
        expect(handle.repos.events.list({ limit: 50, projectId }).events).toEqual(expected);
      }
    });

    it('filters by agentId, taskId, type and source', () => {
      expect(seqs(handle.repos.events.list({ limit: 50, agentId: BE }).events)).toEqual([9, 8, 1]);
      expect(seqs(handle.repos.events.list({ limit: 50, taskId: 'SW-123' }).events)).toEqual([
        9, 8, 1,
      ]);
      expect(seqs(handle.repos.events.list({ limit: 50, type: 'system.error' }).events)).toEqual([
        7, 6,
      ]);
      expect(seqs(handle.repos.events.list({ limit: 50, source: 'simulator' }).events)).toEqual([
        4,
      ]);
      expect(seqs(handle.repos.events.list({ limit: 50, source: 'demo' }).events)).toEqual([8]);
    });

    it('AND-combines all filters, including the cursor', () => {
      expect(
        seqs(
          handle.repos.events.list({ limit: 50, projectId: 'sellway', agentId: BE, source: 'api' })
            .events,
        ),
      ).toEqual([9, 1]);
      expect(
        seqs(
          handle.repos.events.list({
            limit: 50,
            projectId: 'sellway',
            type: 'agent.activity',
            taskId: 'SW-123',
            before: 8,
          }).events,
        ),
      ).toEqual([1]);
      expect(handle.repos.events.list({ limit: 50, projectId: 'erp', agentId: FE }).events).toEqual(
        [],
      );
      const paged = handle.repos.events.list({ limit: 1, projectId: 'erp', type: 'system.error' });
      expect(seqs(paged.events)).toEqual([7]);
      expect(paged.nextBefore).toBe(7);
    });

    it('treats filter values as data, not SQL', () => {
      expect(handle.repos.events.list({ limit: 50, agentId: "x' OR '1'='1" }).events).toEqual([]);
      expect(
        handle.repos.events
          .list({ limit: 50, projectId: "sellway' OR 1=1 --" })
          .events.map((e) => e.type),
      ).toEqual(['system.error', 'system.warning']);
    });

    it('rejects invalid limits and cursors', () => {
      expect(() => handle.repos.events.list({ limit: 0 })).toThrow(RangeError);
      expect(() => handle.repos.events.list({ limit: 1.5 })).toThrow(RangeError);
      expect(() => handle.repos.events.list({ limit: 5, before: Number.NaN })).toThrow(RangeError);
    });
  });

  describe('touchedSince (ADR-011)', () => {
    it('collects non-demo agent.* agents and non-demo task ids of any type after startSeq', () => {
      const ins = (e: Partial<NewEvent>): number => handle.repos.events.insert(makeEvent(e)).seq;
      ins({ type: 'agent.activity', agentId: QA, taskId: 'ERP-1' }); // before start
      const startSeq = handle.repos.events.maxSeq();
      ins({ type: 'agent.activity', agentId: BE, taskId: 'SW-D1-1a', source: 'demo' }); // demo: ignored
      ins({ type: 'agent.status.changed', agentId: FE, taskId: null, source: 'simulator' }); // FE touched
      ins({ type: 'task.updated', agentId: BE, taskId: 'SW-123', source: 'api' }); // task touched, agent not (task.*)
      ins({ type: 'system.info', agentId: QA, project: null, taskId: 'ERP-2', source: 'system' }); // task touched, agent not
      ins({ type: 'agent.message', agentId: '14-reviewer', taskId: 'SW-124', source: 'api' }); // both

      expect(handle.repos.events.touchedSince(startSeq)).toEqual({
        agentIds: new Set([FE, '14-reviewer']),
        taskIds: new Set(['SW-123', 'ERP-2', 'SW-124']),
      });
      expect(handle.repos.events.touchedSince(handle.repos.events.maxSeq())).toEqual({
        agentIds: new Set(),
        taskIds: new Set(),
      });
      expect(handle.repos.events.touchedSince(0).agentIds).toEqual(
        new Set([QA, FE, '14-reviewer']),
      );
    });
  });

  it('keeps createdAt verbatim (server time is authoritative)', () => {
    expect(handle.repos.events.insert(makeEvent({ createdAt: T0 })).createdAt).toBe(T0);
  });
});
