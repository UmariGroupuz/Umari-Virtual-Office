import { AGENT_IDS } from '@vo/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeAgent, openTestDatabase, T0, T1, T2 } from '../testing';
import type { DatabaseHandle } from '../types';

const BE = '04-backend-engineer';

function updatedAt(handle: DatabaseHandle, id: string): unknown {
  return handle.db.prepare('SELECT updated_at FROM agents WHERE id = ?').get(id)?.['updated_at'];
}

describe('AgentRepository', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase();
  });
  afterEach(() => {
    handle.close();
  });

  it('lists all agents ordered by sort_order (agent number), count = 15', () => {
    expect(handle.repos.agents.list().map((a) => a.id)).toEqual(AGENT_IDS);
    expect(handle.repos.agents.count()).toBe(15);
  });

  it('round-trips every field (null, boolean and JSON mapping) and stores version as given', () => {
    const fresh = openTestDatabase({ withReference: false });
    try {
      fresh.repos.projects.insert(
        { id: 'sellway', name: 'Sellway', taskPrefix: 'SW', sortOrder: 1 },
        T0,
      );
      const agent = makeAgent(BE, {
        status: 'offline',
        online: false,
        currentProject: 'sellway',
        currentTask: 'Lost Goods API',
        taskId: 'SW-123',
        progress: 30,
        startedAt: null,
        lastActivityAt: T1,
        currentAction: null,
        lastMessage: 'Bye <b>now</b>',
        metadata: { nested: { list: [1, 'two', null, true] }, emoji: 'ok ✓' },
        version: 7,
      });
      fresh.repos.agents.insert({ ...agent, sortOrder: 4 }, T2);

      expect(fresh.repos.agents.getById(BE)).toEqual(agent);
      expect(updatedAt(fresh, BE)).toBe(T2);
      const raw = fresh.db.prepare('SELECT online, metadata, sort_order FROM agents').get();
      expect(raw?.['online']).toBe(0);
      expect(raw?.['metadata']).toBe(JSON.stringify(agent.metadata));
      expect(raw?.['sort_order']).toBe(4);
      // sort_order and updated_at are not exposed
      expect(Object.keys(fresh.repos.agents.getById(BE) ?? {})).not.toContain('sortOrder');
    } finally {
      fresh.close();
    }
  });

  it('getById returns null for an unknown id', () => {
    expect(handle.repos.agents.getById('99-ghost')).toBeNull();
  });

  it('filters by currentProject', () => {
    handle.repos.agents.update(BE, { currentProject: 'sellway' }, T1);
    handle.repos.agents.update('14-reviewer', { currentProject: 'sellway' }, T1);
    handle.repos.agents.update('03-architect', { currentProject: 'erp' }, T1);

    expect(handle.repos.agents.list({ projectId: 'sellway' }).map((a) => a.id)).toEqual([
      BE,
      '14-reviewer',
    ]);
    expect(handle.repos.agents.list({ projectId: 'ana-market' })).toEqual([]);
    expect(handle.repos.agents.list({})).toHaveLength(15);
  });

  it('update applies only the given fields, keeps the rest, increments version and sets updated_at', () => {
    const before = handle.repos.agents.getById(BE);
    const after = handle.repos.agents.update(
      BE,
      { status: 'working', startedAt: T1, currentAction: 'run_command', metadata: { a: 1 } },
      T2,
    );

    expect(after).toEqual({
      ...before,
      status: 'working',
      startedAt: T1,
      currentAction: 'run_command',
      metadata: { a: 1 },
      version: 2,
    });
    expect(handle.repos.agents.getById(BE)).toEqual(after);
    expect(updatedAt(handle, BE)).toBe(T2);

    const again = handle.repos.agents.update(BE, { progress: 10 }, T2);
    expect(again.version).toBe(3);
  });

  it('update writes explicit nulls and false, ignores undefined', () => {
    handle.repos.agents.update(BE, { taskId: 'SW-1', currentTask: 'X', lastMessage: 'hi' }, T1);
    const after = handle.repos.agents.update(
      BE,
      { taskId: null, currentTask: null, online: false, lastMessage: undefined },
      T2,
    );
    expect(after.taskId).toBeNull();
    expect(after.currentTask).toBeNull();
    expect(after.online).toBe(false);
    expect(after.lastMessage).toBe('hi');
  });

  it('an empty patch still bumps version (every row write is +1)', () => {
    expect(handle.repos.agents.update(BE, {}, T1).version).toBe(2);
  });

  it('update throws for an unknown id and writes nothing', () => {
    expect(() => handle.repos.agents.update('99-ghost', { status: 'working' }, T1)).toThrow(
      'Agent not found: 99-ghost',
    );
  });

  it('update rejects values that violate the schema checks', () => {
    expect(() => handle.repos.agents.update(BE, { progress: 101 }, T1)).toThrow(/CHECK/);
    expect(() => handle.repos.agents.update(BE, { currentProject: 'nope' }, T1)).toThrow(
      /FOREIGN KEY/,
    );
    expect(handle.repos.agents.getById(BE)?.version).toBe(1);
  });

  it('replace writes all mutable fields, ignores agent.version and identity fields, version = current + 1', () => {
    handle.repos.agents.update(BE, { status: 'working', startedAt: T1, progress: 50 }, T1); // version 2
    const snapshot = makeAgent(BE, {
      status: 'idle',
      lastMessage: 'restored',
      currentProject: 'sellway',
      version: 1, // stale snapshot version must be ignored
      name: 'Renamed', // identity fields are not mutable
    });

    const restored = handle.repos.agents.replace(snapshot, T2);

    expect(restored).toEqual({
      ...makeAgent(BE),
      lastMessage: 'restored',
      currentProject: 'sellway',
      version: 3,
    });
    expect(restored.name).toBe('Backend Engineer');
    expect(updatedAt(handle, BE)).toBe(T2);
  });

  it('replace throws for an unknown id', () => {
    expect(() => handle.repos.agents.replace(makeAgent(BE, { id: '99-ghost' }), T1)).toThrow(
      'Agent not found: 99-ghost',
    );
  });

  it('insert rejects duplicate ids, codes and desks', () => {
    expect(() => handle.repos.agents.insert({ ...makeAgent(BE), sortOrder: 4 }, T0)).toThrow(
      /UNIQUE/,
    );
  });
});
