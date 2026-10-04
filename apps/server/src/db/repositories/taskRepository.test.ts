import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTask, openTestDatabase, T0, T1, T2 } from '../testing';
import type { DatabaseHandle } from '../types';

const BE = '04-backend-engineer';
const FE = '05-frontend-engineer';

function updatedAt(handle: DatabaseHandle, id: string): unknown {
  return handle.db.prepare('SELECT updated_at FROM tasks WHERE id = ?').get(id)?.['updated_at'];
}

describe('TaskRepository', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase();
  });
  afterEach(() => {
    handle.close();
  });

  it('insert returns the stored task with version 1 and updatedAt = now; round-trips every field', () => {
    const input = makeTask('SW-123', {
      title: 'Lost Goods API',
      description: 'Line 1\n"quoted" <tag>',
      assignedAgentId: BE,
      status: 'completed',
      priority: 'critical',
      progress: 100,
      startedAt: T0,
      completedAt: T1,
      blockedBy: ['SW-1', 'SW-2'],
      metadata: { demo: true, nested: { n: 1.5 } },
    });

    const stored = handle.repos.tasks.insert(input, T2);

    expect(stored).toEqual({ ...input, version: 1, updatedAt: T2 });
    expect(handle.repos.tasks.getById('SW-123')).toEqual(stored);
    const raw = handle.db.prepare('SELECT project_id, blocked_by, metadata FROM tasks').get();
    expect(raw).toEqual({
      project_id: 'sellway',
      blocked_by: '["SW-1","SW-2"]',
      metadata: '{"demo":true,"nested":{"n":1.5}}',
    });
  });

  it('maps null description / assignee / dates and empty JSON defaults', () => {
    const stored = handle.repos.tasks.insert(makeTask('SW-1'), T0);
    expect(stored.description).toBeNull();
    expect(stored.assignedAgentId).toBeNull();
    expect(stored.startedAt).toBeNull();
    expect(stored.completedAt).toBeNull();
    expect(stored.blockedBy).toEqual([]);
    expect(stored.metadata).toEqual({});
  });

  it('getById returns null for an unknown id; count counts rows', () => {
    expect(handle.repos.tasks.getById('SW-404')).toBeNull();
    expect(handle.repos.tasks.count()).toBe(0);
    handle.repos.tasks.insert(makeTask('SW-1'), T0);
    expect(handle.repos.tasks.count()).toBe(1);
  });

  it('insert enforces foreign keys and checks', () => {
    expect(() =>
      handle.repos.tasks.insert(makeTask('SW-1', { assignedAgentId: '99-ghost' }), T0),
    ).toThrow(/FOREIGN KEY/);
    expect(() => handle.repos.tasks.insert(makeTask('SW-1', { progress: -1 }), T0)).toThrow(
      /CHECK/,
    );
    expect(() =>
      handle.repos.tasks.insert(makeTask('SW-1', { status: 'done' as never }), T0),
    ).toThrow(/CHECK/);
    expect(() =>
      handle.repos.tasks.insert(makeTask('SW-1', { priority: 'urgent' as never }), T0),
    ).toThrow(/CHECK/);
  });

  describe('list', () => {
    beforeEach(() => {
      handle.repos.tasks.insert(
        makeTask('SW-2', { createdAt: T1, assignedAgentId: BE, status: 'assigned' }),
        T1,
      );
      handle.repos.tasks.insert(
        makeTask('SW-1', { createdAt: T1, assignedAgentId: FE, status: 'in_progress' }),
        T1,
      );
      handle.repos.tasks.insert(
        makeTask('ERP-9', {
          createdAt: T0,
          project: 'erp',
          assignedAgentId: BE,
          status: 'in_progress',
        }),
        T0,
      );
      handle.repos.tasks.insert(makeTask('AM-1', { createdAt: T2, project: 'ana-market' }), T2);
    });

    it('orders by createdAt then id', () => {
      expect(handle.repos.tasks.list().map((t) => t.id)).toEqual(['ERP-9', 'SW-1', 'SW-2', 'AM-1']);
    });

    it('applies project, agent and status filters AND-combined', () => {
      expect(handle.repos.tasks.list({ projectId: 'sellway' }).map((t) => t.id)).toEqual([
        'SW-1',
        'SW-2',
      ]);
      expect(handle.repos.tasks.list({ agentId: BE }).map((t) => t.id)).toEqual(['ERP-9', 'SW-2']);
      expect(handle.repos.tasks.list({ status: 'in_progress' }).map((t) => t.id)).toEqual([
        'ERP-9',
        'SW-1',
      ]);
      expect(
        handle.repos.tasks.list({ agentId: BE, status: 'in_progress' }).map((t) => t.id),
      ).toEqual(['ERP-9']);
      expect(
        handle.repos.tasks.list({ projectId: 'sellway', agentId: BE, status: 'in_progress' }),
      ).toEqual([]);
    });

    it('limits the result (default 500)', () => {
      expect(handle.repos.tasks.list({ limit: 2 }).map((t) => t.id)).toEqual(['ERP-9', 'SW-1']);
      for (let i = 10; i < 520; i += 1)
        handle.repos.tasks.insert(makeTask(`IK-${i}`, { createdAt: T2 }), T2);
      expect(handle.repos.tasks.list()).toHaveLength(500);
      expect(() => handle.repos.tasks.list({ limit: 0 })).toThrow(RangeError);
    });
  });

  it('existingIds returns the subset that exists', () => {
    handle.repos.tasks.insert(makeTask('SW-1'), T0);
    handle.repos.tasks.insert(makeTask('SW-2'), T0);
    expect(handle.repos.tasks.existingIds([])).toEqual(new Set());
    expect(handle.repos.tasks.existingIds(['SW-2', 'SW-404', 'SW-1', 'SW-1'])).toEqual(
      new Set(['SW-1', 'SW-2']),
    );
    expect(handle.repos.tasks.existingIds(["SW-1' OR '1'='1"])).toEqual(new Set());
  });

  it('maxNumericSuffix ignores demo ids, other prefixes and case variants', () => {
    expect(handle.repos.tasks.maxNumericSuffix('SW')).toBeNull();
    for (const id of [
      'SW-123',
      'SW-125',
      'SW-D57-1a',
      'SW-D999-9d',
      'sw-900',
      'SWX-500',
      'SW-12a',
      'IK-777',
    ]) {
      handle.repos.tasks.insert(makeTask(id), T0);
    }
    expect(handle.repos.tasks.maxNumericSuffix('SW')).toBe(125);
    expect(handle.repos.tasks.maxNumericSuffix('IK')).toBe(777);
    expect(handle.repos.tasks.maxNumericSuffix('AM')).toBeNull();

    handle.repos.tasks.insert(makeTask('SW-D1000-1a'), T0);
    expect(handle.repos.tasks.maxNumericSuffix('SW')).toBe(125);
    handle.repos.tasks.insert(makeTask('SW-0126'), T0);
    expect(handle.repos.tasks.maxNumericSuffix('SW')).toBe(126);
  });

  it('maxNumericSuffix treats regex/LIKE metacharacters in the prefix literally', () => {
    handle.repos.tasks.insert(makeTask('A.B-5'), T0);
    handle.repos.tasks.insert(makeTask('AXB-9'), T0);
    handle.repos.tasks.insert(makeTask('A_C-7'), T0);
    expect(handle.repos.tasks.maxNumericSuffix('A.B')).toBe(5);
    expect(handle.repos.tasks.maxNumericSuffix('A_B')).toBeNull();
  });

  it('update applies the patch, increments version and sets updatedAt', () => {
    const created = handle.repos.tasks.insert(makeTask('SW-1', { description: 'd' }), T0);
    const updated = handle.repos.tasks.update(
      'SW-1',
      {
        status: 'assigned',
        assignedAgentId: BE,
        description: null,
        blockedBy: ['SW-9'],
        metadata: { x: [1] },
      },
      T1,
    );
    expect(updated).toEqual({
      ...created,
      status: 'assigned',
      assignedAgentId: BE,
      description: null,
      blockedBy: ['SW-9'],
      metadata: { x: [1] },
      version: 2,
      updatedAt: T1,
    });
    expect(handle.repos.tasks.update('SW-1', { progress: 5 }, T2)).toMatchObject({
      version: 3,
      updatedAt: T2,
    });
    expect(updatedAt(handle, 'SW-1')).toBe(T2);
  });

  it('update throws for an unknown id', () => {
    expect(() => handle.repos.tasks.update('SW-404', { title: 'x' }, T1)).toThrow(
      'Task not found: SW-404',
    );
  });

  it('replace writes all mutable fields, keeps project/createdAt, version = current + 1', () => {
    const original = handle.repos.tasks.insert(makeTask('SW-1', { title: 'Original' }), T0);
    handle.repos.tasks.update(
      'SW-1',
      { title: 'Changed', status: 'in_progress', progress: 60, startedAt: T1 },
      T1,
    );

    const restored = handle.repos.tasks.replace(
      { ...original, project: 'erp', createdAt: T2, version: 1 },
      T2,
    );

    expect(restored).toEqual({ ...original, version: 3, updatedAt: T2 });
  });

  it('replace throws for an unknown id', () => {
    const task = handle.repos.tasks.insert(makeTask('SW-1'), T0);
    expect(() => handle.repos.tasks.replace({ ...task, id: 'SW-404' }, T1)).toThrow(
      'Task not found: SW-404',
    );
  });

  it('delete removes the row and reports whether it existed', () => {
    handle.repos.tasks.insert(makeTask('SW-D5-1a'), T0);
    expect(handle.repos.tasks.delete('SW-D5-1a')).toBe(true);
    expect(handle.repos.tasks.getById('SW-D5-1a')).toBeNull();
    expect(handle.repos.tasks.delete('SW-D5-1a')).toBe(false);
  });
});
