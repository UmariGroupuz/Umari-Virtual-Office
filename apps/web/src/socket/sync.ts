// Client sync algorithm (ADR-010, ADR-035, API-C §4): on connect, every reconnect and `office:resync` — buffer
// `office:event` payloads, fetch the snapshot, replace entities/feed/demo, replay the buffer (dropping payloads
// already contained in the snapshot: `event.seq <= snapshot.lastSeq`), re-apply a `demo:state` received during the
// fetch, bump `syncGeneration`. Overlapping resyncs: the newest snapshot wins, the buffer is replayed after it.
import type { DemoState, Snapshot, WriteResult } from '@vo/shared';
import { errorDetail, isAborted } from '../api/client';
import type { OfficeStore } from '../store/store';

export interface SyncController {
  /** Routes a live payload: buffered while syncing, otherwise applied through the reducer. */
  handleOfficeEvent(payload: WriteResult): void;
  /** `demo:state` broadcast or a demo start/stop response: applied now, and re-applied after a running resync. */
  handleDemoState(state: DemoState): void;
  resync(): Promise<void>;
  /** True once a resync was started (first sync of the page). */
  hasStarted(): boolean;
  isSyncing(): boolean;
  /** Payloads currently buffered (exposed for tests). */
  bufferSize(): number;
  dispose(): void;
}

export interface SyncOptions {
  store: OfficeStore;
  getSnapshot: (project: string | null, signal: AbortSignal) => Promise<Snapshot>;
  /** Called after the feed project changed during a snapshot fetch (the feed must be reloaded). */
  onFeedStale?: () => void;
  /** Retry delays after a failed snapshot fetch; the last value repeats. */
  retryDelaysMs?: readonly number[];
  now?: () => number;
}

const DEFAULT_RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000] as const;
const MAX_BUFFER = 1_000;

export function createSyncController(options: SyncOptions): SyncController {
  const { store } = options;
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  const now = options.now ?? (() => Date.now());
  let buffer: WriteResult[] = [];
  let pendingDemo: DemoState | null = null;
  let started = false;
  let syncing = false;
  let attempt = 0;
  let failures = 0;
  let inflight: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  async function resync(): Promise<void> {
    if (disposed) return;
    started = true;
    clearRetry();
    attempt += 1;
    const myAttempt = attempt;
    syncing = true;
    store.getState().setConnection({ syncing: true });
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    const project = store.getState().ui.projectFilter;

    try {
      const snapshot = await options.getSnapshot(project, controller.signal);
      if (myAttempt !== attempt || disposed) return;
      const state = store.getState();
      state.hydrate(snapshot, project, now());
      // CR-4 watermark: payloads with seq <= lastSeq are already part of the snapshot. Replaying them could
      // resurrect rows the snapshot no longer has (e.g. demo tasks deleted by a restore). No-op write results
      // (`event: null`) carry no seq and stay version-gated.
      const lastSeq = typeof snapshot.lastSeq === 'number' ? snapshot.lastSeq : 0;
      const pending = buffer.filter(
        (payload) => payload.event === null || payload.event.seq > lastSeq,
      );
      buffer = [];
      const demo = pendingDemo;
      pendingDemo = null;
      syncing = false;
      for (const payload of pending) store.getState().applyOfficeEvent(payload);
      // CR-3: a demo state received while the snapshot was in flight is newer than the snapshot's.
      if (demo) store.getState().applyDemoState(demo);
      failures = 0;
      inflight = null;
      store.getState().setConnection({ syncing: false, syncError: null });
      store.getState().completeSync();
      if (store.getState().feedProject !== project) options.onFeedStale?.();
    } catch (error) {
      if (myAttempt !== attempt || disposed) return;
      if (isAborted(error) && controller.signal.aborted) return;
      inflight = null;
      // Keep last data (stale) and keep buffering until a snapshot succeeds; retry with backoff.
      failures += 1;
      store.getState().setConnection({ syncError: errorDetail(error) });
      const delay = delays[Math.min(failures - 1, delays.length - 1)] ?? 10_000;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void resync();
      }, delay);
    }
  }

  return {
    handleOfficeEvent(payload) {
      if (syncing) {
        buffer.push(payload);
        // Bounded while a snapshot keeps failing: the next snapshot contains the dropped changes.
        if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
      } else {
        store.getState().applyOfficeEvent(payload);
      }
    },
    handleDemoState(state) {
      store.getState().applyDemoState(state);
      if (syncing) pendingDemo = state;
    },
    resync,
    hasStarted: () => started,
    isSyncing: () => syncing,
    bufferSize: () => buffer.length,
    dispose() {
      disposed = true;
      clearRetry();
      inflight?.abort();
    },
  };
}
