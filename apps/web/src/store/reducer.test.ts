import { describe, expect, it } from 'vitest';
import { LIMITS } from '@vo/shared';
import { DEMO_OFF, NOW, makeAgent, makeEvent, makeSnapshot, makeTask } from '../testing/fixtures';
import {
  applyDemoState,
  applyOfficeEvent,
  createInitialDomainState,
  feedFailed,
  hydrate,
  hydrateFeed,
  mergeEvents,
  setFeedProject,
  type DomainState,
} from './reducer';
import { computeMetrics } from './selectors';

function hydrated(
  project: string | null = null,
  events = [makeEvent({ seq: 10, id: 'e10' })],
): DomainState {
  return hydrate(createInitialDomainState(project), makeSnapshot({ events }), {
    project,
    receivedAt: NOW - 2_000,
  });
}

describe('hydrate (ADR-010 wholesale replace)', () => {
  it('replaces agents, tasks, projects, demo and the feed', () => {
    const before = applyOfficeEvent(hydrated(), {
      event: makeEvent({ seq: 11, id: 'e11' }),
      agent: makeAgent('04-backend-engineer', { status: 'working', version: 5 }),
      task: makeTask('SW-999'),
    });
    expect(before.tasks['SW-999']).toBeDefined();

    const next = hydrate(before, makeSnapshot({ events: [makeEvent({ seq: 20, id: 'e20' })] }), {
      project: null,
      receivedAt: NOW,
    });
    expect(next.loaded).toBe(true);
    expect(Object.keys(next.agents)).toHaveLength(15);
    expect(next.agents['04-backend-engineer']?.status).toBe('idle');
    expect(next.agents['04-backend-engineer']?.version).toBe(1); // wholesale, not version-gated
    expect(next.tasks['SW-999']).toBeUndefined(); // deleted rows disappear (demo restore)
    expect(Object.keys(next.tasks)).toHaveLength(11);
    expect(next.feed.map((e) => e.id)).toEqual(['e20']);
    expect(next.feedStatus).toBe('ready');
    expect(next.demo).toEqual(DEMO_OFF);
    expect(next.projects).toHaveLength(4);
  });

  it('computes the server time offset from serverTime', () => {
    const next = hydrate(createInitialDomainState(), makeSnapshot(), {
      project: null,
      receivedAt: NOW - 1_500,
    });
    expect(next.serverTimeOffsetMs).toBe(1_500);
    expect(next.lastDataAt).toBe(NOW - 1_500);
  });

  it('keeps the feed when the snapshot was fetched for another project (filter changed meanwhile)', () => {
    const state = setFeedProject(hydrated(null), 'sellway');
    const next = hydrate(
      state,
      makeSnapshot({ events: [makeEvent({ id: 'x', project: 'erp' })] }),
      {
        project: null,
        receivedAt: NOW,
      },
    );
    expect(next.feedProject).toBe('sellway');
    expect(next.feed).toEqual([]);
    expect(next.feedStatus).toBe('loading');
  });

  it('sorts snapshot events newest first and caps them', () => {
    const events = Array.from({ length: 250 }, (_, i) =>
      makeEvent({ seq: i + 1, id: `s${i + 1}` }),
    );
    const next = hydrated(null, events);
    expect(next.feed).toHaveLength(LIMITS.FEED_CAP);
    expect(next.feed[0]?.seq).toBe(250);
    expect(next.feed.at(-1)?.seq).toBe(51);
  });
});

describe('applyOfficeEvent — version gating', () => {
  it('replaces an agent only when the incoming version is greater', () => {
    const base = hydrated();
    const newer = applyOfficeEvent(base, {
      event: makeEvent({ seq: 30, id: 'e30' }),
      agent: makeAgent('04-backend-engineer', { status: 'working', version: 2 }),
      task: null,
    });
    expect(newer.agents['04-backend-engineer']?.status).toBe('working');

    const stale = applyOfficeEvent(newer, {
      event: makeEvent({ seq: 29, id: 'e29' }),
      agent: makeAgent('04-backend-engineer', { status: 'idle', version: 2 }),
      task: null,
    });
    expect(stale.agents['04-backend-engineer']?.status).toBe('working');

    const older = applyOfficeEvent(newer, {
      event: null,
      agent: makeAgent('04-backend-engineer', { status: 'planning', version: 1 }),
      task: null,
    });
    expect(older).toBe(newer);
  });

  it('accepts unknown entities and version-gates tasks the same way', () => {
    const base = hydrated();
    const created = applyOfficeEvent(base, {
      event: makeEvent({ seq: 40, id: 'e40', type: 'task.created', taskId: 'SW-126' }),
      agent: null,
      task: makeTask('SW-126', { title: 'New', version: 1 }),
    });
    expect(created.tasks['SW-126']?.title).toBe('New');
    const gated = applyOfficeEvent(created, {
      event: null,
      agent: null,
      task: makeTask('SW-126', { title: 'Old', version: 1 }),
    });
    expect(gated.tasks['SW-126']?.title).toBe('New');
  });
});

describe('applyOfficeEvent — feed', () => {
  it('dedupes by event id', () => {
    const event = makeEvent({ seq: 50, id: 'dup' });
    const once = applyOfficeEvent(hydrated(), { event, agent: null, task: null });
    const twice = applyOfficeEvent(once, { event, agent: null, task: null });
    expect(once.feed.filter((e) => e.id === 'dup')).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it('inserts in seq order, newest first', () => {
    let state = hydrated(null, []);
    for (const seq of [5, 9, 7]) {
      state = applyOfficeEvent(state, {
        event: makeEvent({ seq, id: `s${seq}` }),
        agent: null,
        task: null,
      });
    }
    expect(state.feed.map((e) => e.seq)).toEqual([9, 7, 5]);
  });

  it('caps the feed at 200 newest events', () => {
    let state = hydrated(null, []);
    for (let seq = 1; seq <= LIMITS.FEED_CAP + 5; seq += 1) {
      state = applyOfficeEvent(state, {
        event: makeEvent({ seq, id: `c${seq}` }),
        agent: null,
        task: null,
      });
    }
    expect(state.feed).toHaveLength(LIMITS.FEED_CAP);
    expect(state.feed[0]?.seq).toBe(LIMITS.FEED_CAP + 5);
    expect(state.feed.at(-1)?.seq).toBe(6);
  });

  it('applies the project predicate of the feed (ES §8.3)', () => {
    let state = hydrated('sellway', []);
    state = applyOfficeEvent(state, {
      event: makeEvent({ id: 'erp', project: 'erp' }),
      agent: null,
      task: null,
    });
    state = applyOfficeEvent(state, {
      event: makeEvent({ id: 'warn', project: null, type: 'system.warning', agentId: null }),
      agent: null,
      task: null,
    });
    state = applyOfficeEvent(state, {
      event: makeEvent({ id: 'info', project: null, type: 'system.info', agentId: null }),
      agent: null,
      task: null,
    });
    state = applyOfficeEvent(state, {
      event: makeEvent({ id: 'sw', project: 'sellway' }),
      agent: null,
      task: null,
    });
    expect(state.feed.map((e) => e.id).sort()).toEqual(['sw', 'warn']);
    // Every event is still available to the agent Activity tab (unfiltered).
    expect(state.recentEvents.map((e) => e.id).sort()).toEqual(['erp', 'info', 'sw', 'warn']);
  });

  it('no-op write responses (event: null) never add feed rows', () => {
    const base = hydrated();
    const next = applyOfficeEvent(base, {
      event: null,
      agent: makeAgent('04-backend-engineer'),
      task: null,
    });
    expect(next).toBe(base);
    expect(next.feed).toHaveLength(1);
  });
});

describe('demo state and feed loading', () => {
  it('applyDemoState replaces the demo state; identical state is a no-op', () => {
    const base = hydrated();
    const running = applyDemoState(base, { active: true, intervalMs: 3000, startedAt: 'x' });
    expect(running.demo?.active).toBe(true);
    expect(applyDemoState(running, { active: true, intervalMs: 3000, startedAt: 'x' })).toBe(
      running,
    );
  });

  it('setFeedProject clears the list; hydrateFeed merges the fetched page with live rows', () => {
    let state = setFeedProject(hydrated(), 'sellway');
    expect(state.feed).toEqual([]);
    expect(state.feedStatus).toBe('loading');
    state = applyOfficeEvent(state, {
      event: makeEvent({ seq: 100, id: 'live' }),
      agent: null,
      task: null,
    });
    state = hydrateFeed(
      state,
      [makeEvent({ seq: 90, id: 'old' }), makeEvent({ seq: 100, id: 'live' })],
      'sellway',
    );
    expect(state.feed.map((e) => e.id)).toEqual(['live', 'old']);
    expect(state.feedStatus).toBe('ready');
  });

  it('ignores stale feed results and errors for another project', () => {
    const state = setFeedProject(hydrated(), 'erp');
    expect(hydrateFeed(state, [makeEvent()], 'sellway')).toBe(state);
    expect(feedFailed(state, 'sellway', 'x')).toBe(state);
    expect(feedFailed(state, 'erp', 'Network error').feedError).toBe('Network error');
  });

  it('mergeEvents returns the same list when nothing is new', () => {
    const list = [makeEvent({ id: 'a' })];
    expect(mergeEvents(list, [list[0]!])).toBe(list);
  });
});

describe('producer-supplied ids as record keys (SEC-4)', () => {
  const evil = ['__proto__', 'constructor', 'toString', 'title'];

  it('tasks with ids like __proto__ survive hydrate, are own entries and count in metrics', () => {
    const tasks = [
      ...makeSnapshot().tasks,
      ...evil.map((id) =>
        makeTask(id, { title: `task ${id}`, status: 'assigned', project: 'sellway' }),
      ),
    ];
    const state = hydrate(createInitialDomainState(), makeSnapshot({ tasks }), {
      project: null,
      receivedAt: NOW,
    });
    expect(Object.values(state.tasks)).toHaveLength(11 + evil.length);
    for (const id of evil) {
      expect(Object.prototype.hasOwnProperty.call(state.tasks, id)).toBe(true);
      expect(state.tasks[id]?.title).toBe(`task ${id}`);
    }
    expect(Object.getPrototypeOf(state.tasks)).toBeNull();
    // Unknown ids never resolve to inherited values.
    const inheritedNames: string[] = ['hasOwnProperty', 'valueOf'];
    for (const name of inheritedNames) expect(state.tasks[name]).toBeUndefined();
    expect(state.agents[evil[1]!]).toBeUndefined(); // 'constructor' is not an agent id
    const metrics = computeMetrics(
      Object.values(state.agents),
      Object.values(state.tasks),
      'sellway',
    );
    expect(metrics.activeTasks).toBe(2 + evil.length);
  });

  it('applyOfficeEvent adds and version-gates a __proto__ task without touching prototypes', () => {
    let state = hydrated();
    state = applyOfficeEvent(state, {
      event: makeEvent({ seq: 500, id: 'p1', type: 'task.created', taskId: '__proto__' }),
      agent: null,
      task: makeTask('__proto__', { title: 'Proto v1', version: 1 }),
    });
    state = applyOfficeEvent(state, {
      event: makeEvent({ seq: 501, id: 'p2', type: 'task.updated', taskId: '__proto__' }),
      agent: null,
      task: makeTask('__proto__', { title: 'Proto v2', version: 2 }),
    });
    expect(Object.prototype.hasOwnProperty.call(state.tasks, '__proto__')).toBe(true);
    expect(state.tasks['__proto__']?.title).toBe('Proto v2');
    expect(Object.getPrototypeOf(state.tasks)).toBeNull();
    expect(Object.values(state.tasks)).toHaveLength(12);
    expect(({} as Record<string, unknown>).title).toBeUndefined();
  });
});
