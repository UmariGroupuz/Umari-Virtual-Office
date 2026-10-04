// Single Zustand store (ARCHITECTURE §7). Domain data changes only through the reducer functions
// (`hydrate`, `applyOfficeEvent`, plus `applyDemoState` and the feed list loader); simulator and demo writes
// pass their server responses through `applyOfficeEvent` — never optimistic (REQ-104).
import type { DemoState, Snapshot, WriteResult, OfficeEvent } from '@vo/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HealthStatus } from '../api/health';
import type { SocketStatus } from '../socket/connection';
import * as reducer from './reducer';
import type { DomainState } from './reducer';

export type SeverityFilter = 'all' | 'warnings' | 'errors';
export type Layer = 'panel' | 'simulator';
export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ConnectionState {
  socket: SocketStatus;
  health: HealthStatus;
  /** Client time at which the next automatic health check runs (for the countdown). */
  healthNextCheckAt: number | null;
  /** True while a resync (snapshot fetch + replay) is in flight. */
  syncing: boolean;
  /** Message of the last failed resync, cleared on success. */
  syncError: string | null;
  /** Initial data still missing after 10 s (REQ-140). */
  loadTimedOut: boolean;
  /** "Reconnect" pressed and not yet resolved. */
  reconnectPending: boolean;
  /** Manual "Retry" pressed and not yet resolved. */
  retryPending: boolean;
  /** Client time of the last recovery (connected again after a drop) — drives the success banner. */
  recoveredAt: number | null;
}

export interface UiState {
  projectFilter: string | null;
  selectedAgentId: string | null;
  simulatorOpen: boolean;
  /** Open layers, most recent last (Esc closes the topmost, UX §7.6). */
  layers: readonly Layer[];
  hideDemo: boolean;
  severityFilter: SeverityFilter;
  toasts: readonly Toast[];
}

export interface OfficeStoreState extends DomainState {
  /** Bumped after every completed resync so open panels refetch (ARCHITECTURE §4.2). */
  syncGeneration: number;
  connection: ConnectionState;
  ui: UiState;

  // Domain mutators (reducer-backed).
  hydrate: (snapshot: Snapshot, project: string | null, receivedAt?: number) => void;
  applyOfficeEvent: (payload: WriteResult) => void;
  applyDemoState: (demo: DemoState) => void;
  setFeedProject: (project: string | null) => void;
  hydrateFeed: (events: readonly OfficeEvent[], project: string | null) => void;
  feedFailed: (project: string | null, message: string) => void;
  completeSync: () => void;

  // Connection/UI mutators.
  setConnection: (patch: Partial<ConnectionState>) => void;
  setUi: (patch: Partial<Omit<UiState, 'layers' | 'toasts'>>) => void;
  openLayer: (layer: Layer) => void;
  closeLayer: (layer: Layer) => void;
  pushToast: (kind: ToastKind, message: string) => number;
  dismissToast: (id: number) => void;
}

export type OfficeStore = StoreApi<OfficeStoreState>;

export interface CreateStoreOptions {
  ui?: Partial<UiState>;
  now?: () => number;
}

const MAX_TOASTS = 3;

export function createOfficeStore(options: CreateStoreOptions = {}): OfficeStore {
  const now = options.now ?? (() => Date.now());
  let toastId = 0;
  const ui: UiState = {
    projectFilter: null,
    selectedAgentId: null,
    simulatorOpen: false,
    layers: [],
    hideDemo: false,
    severityFilter: 'all',
    toasts: [],
    ...options.ui,
  };
  const initialLayers: Layer[] = [];
  if (ui.simulatorOpen) initialLayers.push('simulator');
  if (ui.selectedAgentId !== null) initialLayers.push('panel');
  ui.layers = initialLayers;

  return createStore<OfficeStoreState>()((set, get) => {
    const domain = (fn: (state: DomainState) => DomainState) => {
      const current = get();
      const next = fn(current);
      if (next !== current) set(next);
    };
    return {
      ...reducer.createInitialDomainState(ui.projectFilter),
      syncGeneration: 0,
      connection: {
        socket: 'connecting',
        health: 'checking',
        healthNextCheckAt: null,
        syncing: false,
        syncError: null,
        loadTimedOut: false,
        reconnectPending: false,
        retryPending: false,
        recoveredAt: null,
      },
      ui,

      hydrate: (snapshot, project, receivedAt) =>
        domain((s) => reducer.hydrate(s, snapshot, { project, receivedAt: receivedAt ?? now() })),
      applyOfficeEvent: (payload) =>
        domain((s) => reducer.applyOfficeEvent(s, payload, { receivedAt: now() })),
      applyDemoState: (demo) => domain((s) => reducer.applyDemoState(s, demo)),
      setFeedProject: (project) => domain((s) => reducer.setFeedProject(s, project)),
      hydrateFeed: (events, project) => domain((s) => reducer.hydrateFeed(s, events, project)),
      feedFailed: (project, message) => domain((s) => reducer.feedFailed(s, project, message)),
      completeSync: () => set((s) => ({ syncGeneration: s.syncGeneration + 1 })),

      setConnection: (patch) => set((s) => ({ connection: { ...s.connection, ...patch } })),
      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      openLayer: (layer) =>
        set((s) => ({
          ui: { ...s.ui, layers: [...s.ui.layers.filter((l) => l !== layer), layer] },
        })),
      closeLayer: (layer) =>
        set((s) => ({ ui: { ...s.ui, layers: s.ui.layers.filter((l) => l !== layer) } })),
      pushToast: (kind, message) => {
        toastId += 1;
        const id = toastId;
        set((s) => ({
          ui: { ...s.ui, toasts: [...s.ui.toasts, { id, kind, message }].slice(-MAX_TOASTS) },
        }));
        return id;
      },
      dismissToast: (id) =>
        set((s) => ({ ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } })),
    };
  });
}
