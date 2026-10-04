import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_VIEW_STATE,
  createOfficeBridge,
  planAgentUpdates,
  type KnownAgent,
  type OfficeViewState,
} from './bridge';
import { makeAgent, makeAllAgents } from './testFixtures';

function state(overrides: Partial<OfficeViewState> = {}): OfficeViewState {
  return { ...EMPTY_VIEW_STATE, ...overrides };
}

describe('createOfficeBridge', () => {
  it('notifies subscribers only when a field changes', () => {
    const bridge = createOfficeBridge();
    const listener = vi.fn();
    bridge.subscribe(listener);
    const agents = makeAllAgents();
    const next = state({ agents });
    bridge.setState(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(next, EMPTY_VIEW_STATE);

    bridge.setState({ ...next }); // same field values → no notify
    expect(listener).toHaveBeenCalledTimes(1);

    bridge.setState({ ...next, projectFilter: 'sellway' });
    bridge.setState({ ...next, projectFilter: 'sellway', paused: true });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(bridge.getState().paused).toBe(true);
  });

  it('unsubscribes', () => {
    const bridge = createOfficeBridge();
    const listener = vi.fn();
    const off = bridge.subscribe(listener);
    off();
    bridge.setState(state({ reducedMotion: true }));
    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards select / background / hover to the attached callbacks and drops them when detached', () => {
    const bridge = createOfficeBridge();
    const callbacks = {
      onAgentSelect: vi.fn(),
      onBackgroundClick: vi.fn(),
      onAgentHover: vi.fn(),
    };
    bridge.selectAgent('04-backend-engineer'); // no callbacks yet: dropped, no throw
    bridge.setCallbacks(callbacks);
    bridge.selectAgent('04-backend-engineer');
    bridge.clickBackground();
    const hover = { agentId: '04-backend-engineer', x: 1, y: 2, width: 3, height: 4 };
    bridge.hoverAgent(hover);
    bridge.hoverAgent(null);
    bridge.hoverAgent(null); // collapsed
    expect(callbacks.onAgentSelect).toHaveBeenCalledTimes(1);
    expect(callbacks.onAgentSelect).toHaveBeenCalledWith('04-backend-engineer');
    expect(callbacks.onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(callbacks.onAgentHover.mock.calls).toEqual([[hover], [null]]);

    bridge.setCallbacks(null);
    bridge.selectAgent('x');
    expect(callbacks.onAgentSelect).toHaveBeenCalledTimes(1);
  });

  it('does not emit a leading null hover', () => {
    const bridge = createOfficeBridge();
    const onAgentHover = vi.fn();
    bridge.setCallbacks({ onAgentSelect: vi.fn(), onBackgroundClick: vi.fn(), onAgentHover });
    bridge.hoverAgent(null);
    expect(onAgentHover).not.toHaveBeenCalled();
  });
});

function knownFrom(agents: ReturnType<typeof makeAllAgents>): Map<string, KnownAgent> {
  return new Map(agents.map((a) => [a.id, { version: a.version, status: a.status }]));
}

describe('planAgentUpdates (diff by version, ADR-012)', () => {
  it('first sync updates every agent and treats nothing as a live transition', () => {
    const agents = makeAllAgents().map((a, i) =>
      i === 3 ? { ...a, status: 'completed' as const } : a,
    );
    const plan = planAgentUpdates(new Map(), agents, true);
    expect(plan.updates).toHaveLength(15);
    expect(plan.updates.every((u) => !u.statusChanged && !u.liveCompleted)).toBe(true);
    expect(plan.removedIds).toEqual([]);
  });

  it('same version → no desk update', () => {
    const agents = makeAllAgents();
    const plan = planAgentUpdates(knownFrom(agents), agents, false);
    expect(plan.updates).toEqual([]);
    // Even a different object with the same version is skipped.
    const copy = agents.map((a) => ({ ...a, lastMessage: 'ignored' }));
    expect(planAgentUpdates(knownFrom(agents), copy, false).updates).toEqual([]);
  });

  it('new version → exactly one update for that agent', () => {
    const agents = makeAllAgents();
    const known = knownFrom(agents);
    const next = agents.map((a) =>
      a.id === '04-backend-engineer' ? { ...a, status: 'working' as const, version: 2 } : a,
    );
    const plan = planAgentUpdates(known, next, false);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      previousStatus: 'idle',
      statusChanged: true,
      liveCompleted: false,
    });
    expect(plan.updates[0]?.agent.id).toBe('04-backend-engineer');
  });

  it('a version bump without a status change is an update but not a status change', () => {
    const agents = makeAllAgents();
    const next = agents.map((a, i) => (i === 0 ? { ...a, version: 5, lastMessage: 'hi' } : a));
    const plan = planAgentUpdates(knownFrom(agents), next, false);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.statusChanged).toBe(false);
  });

  it('completed emphasis is triggered only by a live transition, not on first render', () => {
    const before = makeAgent(3, { status: 'working', version: 3 });
    const after = { ...before, status: 'completed' as const, version: 4 };
    const live = planAgentUpdates(
      new Map([[before.id, { version: 3, status: 'working' as const }]]),
      [after],
      false,
    );
    expect(live.updates[0]?.liveCompleted).toBe(true);

    expect(planAgentUpdates(new Map(), [after], true).updates[0]?.liveCompleted).toBe(false);
    // An agent first seen after the initial sync is not a live transition either.
    expect(planAgentUpdates(new Map(), [after], false).updates[0]?.liveCompleted).toBe(false);
    // completed → completed (new version) does not replay the emphasis.
    const again = planAgentUpdates(
      new Map([[after.id, { version: 4, status: 'completed' as const }]]),
      [{ ...after, version: 5 }],
      false,
    );
    expect(again.updates[0]?.liveCompleted).toBe(false);
  });

  it('reports agents that disappeared and ignores duplicate ids', () => {
    const agents = makeAllAgents();
    const known = knownFrom(agents);
    const next = agents.slice(1);
    const plan = planAgentUpdates(known, [...next, { ...next[0]!, version: 99 }], false);
    expect(plan.removedIds).toEqual([agents[0]?.id]);
    expect(plan.updates).toEqual([]); // the duplicate (second occurrence) is ignored
  });
});
