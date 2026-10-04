import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '@vo/shared';
import { createOfficeStore } from '../store/store';
import { DEMO_OFF, makeAgent, makeEvent, makeSnapshot, makeTask } from '../testing/fixtures';
import { createSyncController } from './sync';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sync orchestration (ADR-010, API-C §4)', () => {
  it('buffers office:event payloads during the snapshot fetch and replays them after hydrate', async () => {
    const store = createOfficeStore();
    const pending = deferred<Snapshot>();
    const sync = createSyncController({ store, getSnapshot: () => pending.promise });

    const resync = sync.resync();
    expect(sync.isSyncing()).toBe(true);
    expect(store.getState().connection.syncing).toBe(true);

    // Arrives while the snapshot is in flight: newer agent version + a new event.
    sync.handleOfficeEvent({
      event: makeEvent({ seq: 60, id: 'live-60' }),
      agent: makeAgent('04-backend-engineer', { status: 'working', version: 2 }),
      task: null,
    });
    expect(sync.bufferSize()).toBe(1);
    expect(store.getState().loaded).toBe(false);

    pending.resolve(makeSnapshot({ events: [makeEvent({ seq: 50, id: 'snap-50' })] }));
    await resync;

    const state = store.getState();
    expect(state.loaded).toBe(true);
    expect(state.agents['04-backend-engineer']?.status).toBe('working'); // replayed after hydrate
    expect(state.feed.map((e) => e.id)).toEqual(['live-60', 'snap-50']);
    expect(sync.bufferSize()).toBe(0);
    expect(sync.isSyncing()).toBe(false);
    expect(state.syncGeneration).toBe(1);
    expect(state.connection.syncing).toBe(false);
  });

  it('a replayed payload already contained in the snapshot does not duplicate or downgrade', async () => {
    const store = createOfficeStore();
    const pending = deferred<Snapshot>();
    const sync = createSyncController({ store, getSnapshot: () => pending.promise });
    const resync = sync.resync();
    const event = makeEvent({ seq: 70, id: 'both' });
    sync.handleOfficeEvent({
      event,
      agent: makeAgent('04-backend-engineer', { version: 3 }),
      task: null,
    });
    pending.resolve(
      makeSnapshot({
        events: [event],
        agents: [makeAgent('04-backend-engineer', { status: 'reviewing', version: 4 })],
      }),
    );
    await resync;
    const state = store.getState();
    expect(state.feed.filter((e) => e.id === 'both')).toHaveLength(1);
    expect(state.agents['04-backend-engineer']?.status).toBe('reviewing');
  });

  it('applies payloads directly when not syncing', () => {
    const store = createOfficeStore();
    const sync = createSyncController({
      store,
      getSnapshot: () => Promise.resolve(makeSnapshot()),
    });
    sync.handleOfficeEvent({ event: makeEvent({ id: 'direct' }), agent: null, task: null });
    expect(store.getState().feed.map((e) => e.id)).toEqual(['direct']);
  });

  it('overlapping resyncs: the newest snapshot wins and the buffer is replayed once', async () => {
    const store = createOfficeStore();
    const first = deferred<Snapshot>();
    const second = deferred<Snapshot>();
    const calls = [first, second];
    const sync = createSyncController({
      store,
      getSnapshot: () => (calls.shift() ?? second).promise,
    });
    const r1 = sync.resync();
    sync.handleOfficeEvent({ event: makeEvent({ seq: 80, id: 'b1' }), agent: null, task: null });
    const r2 = sync.resync();
    sync.handleOfficeEvent({ event: makeEvent({ seq: 81, id: 'b2' }), agent: null, task: null });
    second.resolve(makeSnapshot({ events: [makeEvent({ seq: 79, id: 'snap2' })] }));
    await r2;
    first.resolve(makeSnapshot({ events: [makeEvent({ seq: 1, id: 'snap1' })] }));
    await r1;
    const state = store.getState();
    expect(state.feed.map((e) => e.id)).toEqual(['b2', 'b1', 'snap2']);
    expect(state.syncGeneration).toBe(1);
  });

  it('on failure keeps data, records the error, keeps buffering and retries with backoff', async () => {
    vi.useFakeTimers();
    const store = createOfficeStore();
    const getSnapshot = vi
      .fn<(project: string | null, signal: AbortSignal) => Promise<Snapshot>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeSnapshot());
    const sync = createSyncController({ store, getSnapshot, retryDelaysMs: [1_000] });
    await sync.resync();
    expect(store.getState().connection.syncError).toBe('Network error');
    expect(store.getState().loaded).toBe(false);
    sync.handleOfficeEvent({ event: makeEvent({ id: 'kept' }), agent: null, task: null });
    expect(sync.bufferSize()).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(store.getState().loaded).toBe(true);
    expect(store.getState().connection.syncError).toBeNull();
    expect(store.getState().feed.map((e) => e.id)).toEqual(['kept']);
    sync.dispose();
  });

  it('requests the snapshot for the current project filter', async () => {
    const store = createOfficeStore({ ui: { projectFilter: 'erp' } });
    const getSnapshot = vi.fn(() => Promise.resolve(makeSnapshot()));
    const sync = createSyncController({ store, getSnapshot });
    await sync.resync();
    expect(getSnapshot).toHaveBeenCalledWith('erp', expect.any(AbortSignal));
  });

  it('CR-4: drops buffered payloads with event.seq <= snapshot.lastSeq (no ghost rows)', async () => {
    const store = createOfficeStore();
    const pending = deferred<Snapshot>();
    const sync = createSyncController({ store, getSnapshot: () => pending.promise });
    const resync = sync.resync();
    // A demo tick buffered before a snapshot that was read after the demo restore deleted the task.
    sync.handleOfficeEvent({
      event: makeEvent({ seq: 90, id: 'demo-tick', source: 'demo', taskId: 'SW-D57-1a' }),
      agent: makeAgent('04-backend-engineer', { status: 'working', version: 7 }),
      task: makeTask('SW-D57-1a', { title: 'Demo task' }),
    });
    // Newer than the snapshot: must be replayed.
    sync.handleOfficeEvent({ event: makeEvent({ seq: 96, id: 'after' }), agent: null, task: null });
    // No-op write result (no seq): kept, version-gated as usual.
    sync.handleOfficeEvent({
      event: null,
      agent: makeAgent('02-product-analyst', { status: 'planning', version: 3 }),
      task: null,
    });
    pending.resolve(
      makeSnapshot({ events: [makeEvent({ seq: 95, id: 'restore-summary' })], lastSeq: 95 }),
    );
    await resync;
    const state = store.getState();
    expect(state.tasks['SW-D57-1a']).toBeUndefined();
    expect(state.agents['04-backend-engineer']?.status).toBe('idle');
    expect(state.feed.map((e) => e.id)).toEqual(['after', 'restore-summary']);
    expect(state.agents['02-product-analyst']?.status).toBe('planning');
  });

  it('CR-3: a demo:state received during the snapshot fetch wins over the snapshot demo field', async () => {
    const store = createOfficeStore();
    const pending = deferred<Snapshot>();
    const sync = createSyncController({ store, getSnapshot: () => pending.promise });
    const resync = sync.resync();
    const running = { active: true, intervalMs: 3000, startedAt: '2026-10-03T22:41:00.000Z' };
    sync.handleDemoState(running);
    expect(store.getState().demo).toEqual(running); // applied immediately as well
    pending.resolve(makeSnapshot({ demo: DEMO_OFF })); // read before the start committed
    await resync;
    expect(store.getState().demo).toEqual(running);

    // Outside a resync the snapshot is authoritative again (nothing pending).
    await sync.resync();
    expect(store.getState().demo).toEqual(DEMO_OFF);
  });
});
