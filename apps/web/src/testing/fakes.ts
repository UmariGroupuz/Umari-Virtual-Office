// TEST-ONLY fakes: a Socket.IO-like socket and a mocked OfficeApi. Never imported by application code.
import { vi } from 'vitest';
import type { OfficeApi } from '../api/endpoints';
import type { SocketLike } from '../socket/connection';
import { DEMO_OFF, makeSnapshot } from './fixtures';

type Listener = (...args: never[]) => void;

export class FakeSocket implements SocketLike {
  connected = false;
  connectCalls = 0;
  disconnectCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  connect(): this {
    this.connectCalls += 1;
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    if (this.connected) {
      this.connected = false;
      this.emit('disconnect', 'io client disconnect');
    }
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  /** Simulates a successful (re)connection. */
  serverConnect(): void {
    this.connected = true;
    this.emit('connect');
  }

  /** Simulates a dropped connection. */
  serverDrop(reason = 'transport close'): void {
    this.connected = false;
    this.emit('disconnect', reason);
  }
}

export type FakeApi = { [K in keyof OfficeApi]: ReturnType<typeof vi.fn<OfficeApi[K]>> };

/** All endpoints mocked with sensible defaults (healthy server, baseline snapshot, empty lists). */
export function createFakeApi(overrides: Partial<OfficeApi> = {}): FakeApi & OfficeApi {
  const api = {
    getHealth: vi.fn<OfficeApi['getHealth']>(() =>
      Promise.resolve({ status: 'ok', db: 'ok', uptimeSec: 1, version: '0.1.0', time: '' }),
    ),
    getSnapshot: vi.fn<OfficeApi['getSnapshot']>(() => Promise.resolve(makeSnapshot())),
    getEvents: vi.fn<OfficeApi['getEvents']>(() =>
      Promise.resolve({ events: [], page: { limit: 50, nextBefore: null } }),
    ),
    getTasks: vi.fn<OfficeApi['getTasks']>(() => Promise.resolve([])),
    getAgent: vi.fn<OfficeApi['getAgent']>(() => new Promise(() => undefined)),
    patchAgentStatus: vi.fn<OfficeApi['patchAgentStatus']>(() => new Promise(() => undefined)),
    postEvent: vi.fn<OfficeApi['postEvent']>(() => new Promise(() => undefined)),
    getDemo: vi.fn<OfficeApi['getDemo']>(() => Promise.resolve(DEMO_OFF)),
    startDemo: vi.fn<OfficeApi['startDemo']>(() => Promise.resolve({ ...DEMO_OFF, active: true })),
    stopDemo: vi.fn<OfficeApi['stopDemo']>(() =>
      Promise.resolve({ demo: DEMO_OFF, restored: null }),
    ),
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value)
      (api as Record<string, unknown>)[key] = vi.fn(value as (...args: unknown[]) => unknown);
  }
  return api;
}
