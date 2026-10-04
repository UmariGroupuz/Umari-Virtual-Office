// App runtime: wires the store, REST client, socket connection, sync controller and health monitor, and
// exposes the user actions the UI calls. One instance per page (created once, never inside effects).
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { DemoState, WriteResult } from '@vo/shared';
import { errorDetail, isAborted, isUnreachable } from '../api/client';
import { createOfficeApi, type OfficeApi } from '../api/endpoints';
import { createHealthMonitor, type HealthMonitor } from '../api/health';
import { COPY } from '../copy';
import { attachConnection, type ConnectionMonitor, type SocketLike } from '../socket/connection';
import { getBrowserSocket } from '../socket/socket';
import { createSyncController, type SyncController } from '../socket/sync';
import {
  createOfficeStore,
  type OfficeStore,
  type OfficeStoreState,
  type SeverityFilter,
  type UiState,
} from '../store/store';
import { readBoolean, STORAGE_KEYS, writeBoolean } from './storage';
import { parseUrlState, writeUrlState } from './url';

export interface RuntimeActions {
  setProjectFilter: (projectId: string | null) => void;
  openAgent: (agentId: string) => void;
  closeAgent: () => void;
  setSimulatorOpen: (open: boolean) => void;
  setHideDemo: (hide: boolean) => void;
  setSeverityFilter: (filter: SeverityFilter) => void;
  /** "Reconnect" in the Disconnected banner. */
  reconnect: () => void;
  /** "Retry" in the Backend unavailable banner / state card and section errors. */
  retryNow: () => void;
  reloadFeed: () => void;
  /** Write responses go through the same path as broadcasts (buffered during a resync). */
  applyWriteResult: (payload: WriteResult) => void;
  /** Demo switch; resolves after the server answered. Errors become toasts (UX §10). */
  setDemoActive: (active: boolean) => Promise<void>;
}

export interface AppRuntime {
  readonly store: OfficeStore;
  readonly api: OfficeApi;
  readonly actions: RuntimeActions;
  start(): void;
  stop(): void;
  /** Exposed for tests. */
  readonly sync: SyncController;
  readonly connection: ConnectionMonitor;
  readonly health: HealthMonitor;
}

export interface RuntimeOptions {
  api: OfficeApi;
  socket: SocketLike;
  ui?: Partial<UiState>;
  /** Mirror `?project=`/`?agent=` into the address bar. */
  urlSync?: boolean;
  /** Persist UI preferences in localStorage. */
  persist?: boolean;
  windowTarget?: Pick<Window, 'addEventListener'> | null;
  loadTimeoutMs?: number;
  /** HTTP snapshot fallback when the socket has not connected yet (CR-10 / ADR-033 item 2). */
  snapshotFallbackMs?: number;
  now?: () => number;
}

const LOAD_TIMEOUT_MS = 10_000;
/**
 * CR-10: the first snapshot is requested by the first socket `connect` (gap-free: the socket is already receiving
 * when the server reads the snapshot). Only if the socket has not connected after this delay is the snapshot
 * fetched over HTTP, so the page still loads without live updates (ADR-033 item 2). A normal page load therefore
 * makes exactly one snapshot request.
 */
const SNAPSHOT_FALLBACK_MS = 1_500;
const RECONNECT_PENDING_MAX_MS = 10_000;
const CONNECT_ERROR_HEALTH_THROTTLE_MS = 3_000;

export function createRuntime(options: RuntimeOptions): AppRuntime {
  const now = options.now ?? (() => Date.now());
  const store = createOfficeStore({ ui: options.ui, now });
  const { api } = options;
  let started = false;
  let stopped = false;
  let loadTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const clearFallback = () => {
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let feedController: AbortController | null = null;
  let lastConnectErrorCheck = 0;

  const syncUrl = () => {
    if (!options.urlSync) return;
    const { projectFilter, selectedAgentId } = store.getState().ui;
    writeUrlState({ projectFilter, selectedAgentId });
  };

  function reloadFeed(): void {
    const project = store.getState().ui.projectFilter;
    feedController?.abort();
    const controller = new AbortController();
    feedController = controller;
    store.getState().setFeedProject(project);
    api
      .getEvents({ project, limit: 50 }, controller.signal)
      .then((page) => {
        if (feedController !== controller) return;
        feedController = null;
        store.getState().hydrateFeed(page.events, project);
      })
      .catch((error: unknown) => {
        if (feedController !== controller) return;
        feedController = null;
        if (isAborted(error) && controller.signal.aborted) return;
        store.getState().feedFailed(project, errorDetail(error));
      });
  }

  const sync = createSyncController({
    store,
    getSnapshot: (project, signal) => api.getSnapshot(project, signal),
    onFeedStale: reloadFeed,
    now,
  });

  const health = createHealthMonitor({
    check: (signal) => api.getHealth(signal),
    now,
    onResult: ({ status, nextCheckAt }) => {
      const previous = store.getState().connection.health;
      store
        .getState()
        .setConnection({ health: status, healthNextCheckAt: nextCheckAt, retryPending: false });
      if (status === 'ok' && previous === 'failing') {
        // Recovery (UX §11.3): refetch data; reconnect the socket if it is still down.
        void sync.resync();
        if (connection.getStatus() !== 'connected') connection.reconnect();
      }
    },
  });

  const connection = attachConnection(
    options.socket,
    {
      onStatus: (status) => {
        store.getState().setConnection({ socket: status });
      },
      onConnect: ({ recovered }) => {
        clearReconnectPending();
        clearFallback();
        void sync.resync().then(() => {
          if (recovered && store.getState().connection.syncError === null) {
            store.getState().setConnection({ recoveredAt: now() });
          }
        });
      },
      onConnectError: () => {
        clearReconnectPending();
        const t = now();
        if (t - lastConnectErrorCheck >= CONNECT_ERROR_HEALTH_THROTTLE_MS) {
          lastConnectErrorCheck = t;
          void health.checkNow();
        }
      },
      onDisconnect: () => {
        void health.checkNow();
      },
      onOfficeEvent: (payload) => sync.handleOfficeEvent(payload),
      onDemoState: (state) => sync.handleDemoState(state),
      onResync: () => {
        void sync.resync();
      },
    },
    { windowTarget: options.windowTarget ?? null },
  );

  function clearReconnectPending() {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (store.getState().connection.reconnectPending) {
      store.getState().setConnection({ reconnectPending: false });
    }
  }

  const actions: RuntimeActions = {
    setProjectFilter(projectId) {
      if (store.getState().ui.projectFilter === projectId) return;
      store.getState().setUi({ projectFilter: projectId });
      syncUrl();
      reloadFeed();
    },
    openAgent(agentId) {
      store.getState().setUi({ selectedAgentId: agentId });
      store.getState().openLayer('panel');
      syncUrl();
    },
    closeAgent() {
      if (store.getState().ui.selectedAgentId === null) return;
      store.getState().setUi({ selectedAgentId: null });
      store.getState().closeLayer('panel');
      syncUrl();
    },
    setSimulatorOpen(open) {
      store.getState().setUi({ simulatorOpen: open });
      if (open) store.getState().openLayer('simulator');
      else store.getState().closeLayer('simulator');
      if (options.persist) writeBoolean(STORAGE_KEYS.simulatorOpen, open);
    },
    setHideDemo(hide) {
      store.getState().setUi({ hideDemo: hide });
      if (options.persist) writeBoolean(STORAGE_KEYS.hideDemo, hide);
    },
    setSeverityFilter(filter) {
      store.getState().setUi({ severityFilter: filter });
    },
    reconnect() {
      store.getState().setConnection({ reconnectPending: true });
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(clearReconnectPending, RECONNECT_PENDING_MAX_MS);
      connection.reconnect();
      void health.checkNow();
    },
    retryNow() {
      store.getState().setConnection({ retryPending: true });
      const wasFailing = store.getState().connection.health === 'failing';
      void health.checkNow();
      if (!wasFailing) {
        store.getState().setConnection({ loadTimedOut: false });
        void sync.resync().finally(() => store.getState().setConnection({ retryPending: false }));
        if (store.getState().feedStatus === 'error') reloadFeed();
      }
    },
    reloadFeed,
    applyWriteResult(payload) {
      sync.handleOfficeEvent(payload);
    },
    async setDemoActive(active) {
      try {
        if (active) {
          const demo: DemoState = await api.startDemo();
          sync.handleDemoState(demo);
        } else {
          const result = await api.stopDemo();
          sync.handleDemoState(result.demo);
          const counts = result.restored
            ? COPY.demo.restoredCounts(
                result.restored.agentsRestored,
                result.restored.tasksRestored,
              )
            : '';
          store.getState().pushToast('success', `${COPY.demo.stopped}${counts}`);
        }
      } catch (error) {
        const message = isUnreachable(error) ? COPY.simulator.unreachable : errorDetail(error);
        store
          .getState()
          .pushToast(
            'error',
            active ? COPY.demo.startFailed(message) : COPY.demo.stopFailed(message),
          );
        if (isUnreachable(error)) void health.checkNow();
      }
    },
  };

  return {
    store,
    api,
    actions,
    sync,
    connection,
    health,
    start() {
      if (started || stopped) return;
      started = true;
      if (options.urlSync) syncUrl();
      connection.start();
      health.start();
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!sync.hasStarted()) void sync.resync();
      }, options.snapshotFallbackMs ?? SNAPSHOT_FALLBACK_MS);
      loadTimer = setTimeout(() => {
        loadTimer = null;
        if (!store.getState().loaded) store.getState().setConnection({ loadTimedOut: true });
      }, options.loadTimeoutMs ?? LOAD_TIMEOUT_MS);
    },
    stop() {
      stopped = true;
      health.stop();
      sync.dispose();
      feedController?.abort();
      if (loadTimer !== null) clearTimeout(loadTimer);
      clearFallback();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    },
  };
}

/**
 * Initial UI state from the URL and localStorage. Below 768 px the remembered "simulator open" preference is
 * ignored on load: the simulator is a full-screen sheet there and would hide the monitoring view (ADR-037 §8).
 * The stored preference itself is left untouched for the next desktop visit.
 */
export function initialUi(env: {
  search: string;
  viewportWidth: number;
  readStored: (key: string, fallback: boolean) => boolean;
}): Partial<UiState> {
  const url = parseUrlState(env.search);
  return {
    projectFilter: url.projectFilter,
    selectedAgentId: url.selectedAgentId,
    hideDemo: env.readStored(STORAGE_KEYS.hideDemo, false),
    simulatorOpen:
      env.viewportWidth >= MOBILE_BREAKPOINT && env.readStored(STORAGE_KEYS.simulatorOpen, false),
  };
}

const MOBILE_BREAKPOINT = 768;

let defaultRuntime: AppRuntime | null = null;

/** The browser runtime: real API, the Socket.IO singleton, URL and localStorage state. */
export function getDefaultRuntime(): AppRuntime {
  if (defaultRuntime) return defaultRuntime;
  defaultRuntime = createRuntime({
    api: createOfficeApi(),
    socket: getBrowserSocket(),
    ui: initialUi({
      search: window.location.search,
      viewportWidth: window.innerWidth,
      readStored: readBoolean,
    }),
    urlSync: true,
    persist: true,
    windowTarget: window,
  });
  return defaultRuntime;
}

export const RuntimeContext = createContext<AppRuntime | null>(null);

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeContext is missing');
  return runtime;
}

/** Selects a slice of the store; selectors must return stable values (primitives or stored objects). */
export function useOffice<T>(selector: (state: OfficeStoreState) => T): T {
  return useStore(useRuntime().store, selector);
}

export function useActions(): RuntimeActions {
  return useRuntime().actions;
}
