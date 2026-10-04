import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_EVENTS } from '@vo/shared';
import { createRuntime } from '../lib/runtime';
import { createFakeApi, FakeSocket } from '../testing/fakes';
import { makeEvent } from '../testing/fixtures';
import { attachConnection, type ConnectionHandlers, type SocketStatus } from './connection';

function handlers() {
  const statuses: SocketStatus[] = [];
  const h = {
    onStatus: vi.fn((s: SocketStatus) => statuses.push(s)),
    onConnect: vi.fn(),
    onConnectError: vi.fn(),
    onDisconnect: vi.fn(),
    onOfficeEvent: vi.fn(),
    onDemoState: vi.fn(),
    onResync: vi.fn(),
  } satisfies ConnectionHandlers;
  return { h, statuses };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('connection status machine (UX §11.2, REQ-052)', () => {
  it('connecting → connected → reconnecting → disconnected after 30 s → connected', () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { h, statuses } = handlers();
    const monitor = attachConnection(socket, h);
    expect(monitor.getStatus()).toBe('connecting');
    monitor.start();
    expect(socket.connectCalls).toBe(1);

    socket.serverConnect();
    expect(monitor.getStatus()).toBe('connected');
    expect(h.onConnect).toHaveBeenLastCalledWith({ recovered: false });

    socket.serverDrop('transport close');
    expect(monitor.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(29_999);
    expect(monitor.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(1);
    expect(monitor.getStatus()).toBe('disconnected');

    socket.serverConnect();
    expect(monitor.getStatus()).toBe('connected');
    expect(h.onConnect).toHaveBeenLastCalledWith({ recovered: true });
    expect(statuses).toEqual(['connected', 'reconnecting', 'disconnected', 'connected']);
  });

  it('a server-side close goes to Disconnected at once and keeps retrying', () => {
    const socket = new FakeSocket();
    const { h } = handlers();
    const monitor = attachConnection(socket, h);
    monitor.start();
    socket.serverConnect();
    socket.serverDrop('io server disconnect');
    expect(monitor.getStatus()).toBe('disconnected');
    expect(socket.connectCalls).toBe(2);
  });

  it('initial connection that never succeeds becomes Disconnected after 30 s', () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const { h } = handlers();
    const monitor = attachConnection(socket, h);
    monitor.start();
    socket.emit('connect_error', new Error('refused'));
    expect(h.onConnectError).toHaveBeenCalledTimes(1);
    expect(monitor.getStatus()).toBe('connecting');
    vi.advanceTimersByTime(30_000);
    expect(monitor.getStatus()).toBe('disconnected');
  });

  it('reconnect() forces an immediate attempt (disconnect + connect)', () => {
    const socket = new FakeSocket();
    const { h } = handlers();
    const monitor = attachConnection(socket, h);
    monitor.start();
    monitor.reconnect();
    expect(socket.disconnectCalls).toBe(1);
    expect(socket.connectCalls).toBe(2);
  });

  it('browser offline → Disconnected; online → reconnect', () => {
    const socket = new FakeSocket();
    const target = new EventTarget();
    const { h } = handlers();
    const monitor = attachConnection(socket, h, { windowTarget: target as unknown as Window });
    monitor.start();
    socket.serverConnect();
    socket.serverDrop();
    target.dispatchEvent(new Event('offline'));
    expect(monitor.getStatus()).toBe('disconnected');
    target.dispatchEvent(new Event('online'));
    expect(socket.connectCalls).toBe(2);
  });

  it('attaches exactly one listener per message, whatever the number of reconnects', () => {
    const socket = new FakeSocket();
    const { h } = handlers();
    const monitor = attachConnection(socket, h);
    monitor.start();
    for (let i = 0; i < 5; i += 1) {
      socket.serverConnect();
      socket.serverDrop();
      monitor.reconnect();
    }
    for (const event of [
      ...Object.values(SOCKET_EVENTS),
      'connect',
      'disconnect',
      'connect_error',
    ]) {
      expect(socket.listenerCount(event)).toBe(1);
    }
  });
});

describe('runtime: N reconnects → one feed row per event (REQ-052)', () => {
  it('one office:event after 5 reconnects produces exactly one feed row', async () => {
    const socket = new FakeSocket();
    const api = createFakeApi();
    const runtime = createRuntime({ api, socket });
    runtime.start();
    for (let i = 0; i < 5; i += 1) {
      socket.serverConnect();
      await vi.waitFor(() => expect(runtime.store.getState().connection.syncing).toBe(false));
      socket.serverDrop();
    }
    socket.serverConnect();
    await vi.waitFor(() => expect(runtime.store.getState().connection.syncing).toBe(false));

    socket.emit(SOCKET_EVENTS.OFFICE_EVENT, {
      event: makeEvent({ id: 'once', seq: 900 }),
      agent: null,
      task: null,
    });
    socket.emit(SOCKET_EVENTS.OFFICE_EVENT, {
      event: makeEvent({ id: 'once', seq: 900 }),
      agent: null,
      task: null,
    });

    expect(runtime.store.getState().feed.filter((e) => e.id === 'once')).toHaveLength(1);
    expect(socket.listenerCount(SOCKET_EVENTS.OFFICE_EVENT)).toBe(1);
    // Every connect resynced (6 connects; no extra eager fetch, CR-10).
    expect(api.getSnapshot).toHaveBeenCalledTimes(6);
    expect(runtime.store.getState().syncGeneration).toBeGreaterThanOrEqual(1);
    runtime.stop();
  });

  it('office:resync triggers a snapshot resync; demo:state updates the store', async () => {
    const socket = new FakeSocket();
    const api = createFakeApi();
    const runtime = createRuntime({ api, socket });
    runtime.start();
    socket.serverConnect();
    await vi.waitFor(() => expect(runtime.store.getState().loaded).toBe(true));
    const calls = api.getSnapshot.mock.calls.length;
    socket.emit(SOCKET_EVENTS.OFFICE_RESYNC, { reason: 'demo-restored' });
    expect(api.getSnapshot).toHaveBeenCalledTimes(calls + 1);
    socket.emit(SOCKET_EVENTS.DEMO_STATE, { active: true, intervalMs: 3000, startedAt: 'now' });
    expect(runtime.store.getState().demo?.active).toBe(true);
    runtime.stop();
  });

  it('socket status is mirrored into the store', async () => {
    const socket = new FakeSocket();
    const runtime = createRuntime({ api: createFakeApi(), socket });
    runtime.start();
    expect(runtime.store.getState().connection.socket).toBe('connecting');
    socket.serverConnect();
    expect(runtime.store.getState().connection.socket).toBe('connected');
    socket.serverDrop();
    expect(runtime.store.getState().connection.socket).toBe('reconnecting');
    await Promise.resolve();
    runtime.stop();
  });

  it('CR-10: a normal page load makes exactly one snapshot request', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const api = createFakeApi();
    const runtime = createRuntime({ api, socket });
    runtime.start();
    expect(api.getSnapshot).not.toHaveBeenCalled();
    socket.serverConnect(); // socket connects quickly (normal case)
    await vi.advanceTimersByTimeAsync(5_000); // past the HTTP fallback delay
    expect(api.getSnapshot).toHaveBeenCalledTimes(1);
    expect(runtime.store.getState().loaded).toBe(true);
    runtime.stop();
  });

  it('CR-10 / ADR-033: if the socket cannot connect, the HTTP snapshot still loads', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();
    const api = createFakeApi();
    const runtime = createRuntime({ api, socket });
    runtime.start();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(api.getSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getSnapshot).toHaveBeenCalledTimes(1);
    expect(runtime.store.getState().loaded).toBe(true);
    // A late socket connection still resyncs (events between that snapshot and the connect are recovered).
    socket.serverConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot).toHaveBeenCalledTimes(2);
    runtime.stop();
  });
});
