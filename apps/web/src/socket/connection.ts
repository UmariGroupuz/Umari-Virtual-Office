// Socket connection status machine (UX §11.2, REQ-052, ADR-010). Listeners are attached exactly once,
// when the socket is attached — never inside React effects — so N reconnects never add handlers.
import {
  SOCKET_EVENTS,
  type DemoState,
  type OfficeEventPayload,
  type OfficeResyncPayload,
} from '@vo/shared';

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** The part of a Socket.IO client socket this module uses (a fake implements it in tests). */
export interface SocketLike {
  readonly connected: boolean;
  on(event: 'connect', listener: () => void): unknown;
  on(event: 'disconnect', listener: (reason: string) => void): unknown;
  on(event: 'connect_error', listener: (error: Error) => void): unknown;
  on(event: 'office:event', listener: (payload: OfficeEventPayload) => void): unknown;
  on(event: 'demo:state', listener: (state: DemoState) => void): unknown;
  on(event: 'office:resync', listener: (payload: OfficeResyncPayload) => void): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export interface ConnectionHandlers {
  onStatus(status: SocketStatus): void;
  /** Every successful connect; `recovered` = a previous connection existed (it is a reconnect). */
  onConnect(info: { recovered: boolean }): void;
  onConnectError?(): void;
  onDisconnect?(reason: string): void;
  onOfficeEvent(payload: OfficeEventPayload): void;
  onDemoState(state: DemoState): void;
  onResync(payload: OfficeResyncPayload): void;
}

export interface ConnectionOptions {
  /** Reconnecting → Disconnected after this long without success (UX §11.2: 30 s). */
  disconnectAfterMs?: number;
  /** Window-like target for `online`/`offline` events (omit in tests). */
  windowTarget?: Pick<Window, 'addEventListener'> | null;
}

export interface ConnectionMonitor {
  getStatus(): SocketStatus;
  /** "Reconnect": forces an immediate attempt (cancels the backoff wait). */
  reconnect(): void;
  /** Starts the first connection attempt. */
  start(): void;
}

export const DISCONNECTED_AFTER_MS = 30_000;

/** Socket.IO reason when the server closed the connection; the client must reconnect manually. */
const SERVER_DISCONNECT = 'io server disconnect';
const CLIENT_DISCONNECT = 'io client disconnect';

export function attachConnection(
  socket: SocketLike,
  handlers: ConnectionHandlers,
  options: ConnectionOptions = {},
): ConnectionMonitor {
  const disconnectAfterMs = options.disconnectAfterMs ?? DISCONNECTED_AFTER_MS;
  let status: SocketStatus = 'connecting';
  let everConnected = false;
  let started = false;
  let manualReconnect = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: SocketStatus) => {
    if (next === status) return;
    status = next;
    handlers.onStatus(next);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const armDisconnectTimer = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!socket.connected) setStatus('disconnected');
    }, disconnectAfterMs);
  };

  socket.on('connect', () => {
    clearTimer();
    manualReconnect = false;
    const recovered = everConnected;
    everConnected = true;
    setStatus('connected');
    handlers.onConnect({ recovered });
  });

  socket.on('disconnect', (reason) => {
    handlers.onDisconnect?.(reason);
    if (reason === CLIENT_DISCONNECT && manualReconnect) return;
    if (reason === SERVER_DISCONNECT) {
      // Socket.IO does not retry after a server-side close: keep trying ourselves (UX §11.2).
      setStatus('disconnected');
      clearTimer();
      socket.connect();
      return;
    }
    setStatus('reconnecting');
    armDisconnectTimer();
  });

  socket.on('connect_error', () => {
    handlers.onConnectError?.();
  });

  // Server → client messages (API-C §4). One handler each, for the lifetime of the socket.
  socket.on(SOCKET_EVENTS.OFFICE_EVENT, (payload) => handlers.onOfficeEvent(payload));
  socket.on(SOCKET_EVENTS.DEMO_STATE, (state) => handlers.onDemoState(state));
  socket.on(SOCKET_EVENTS.OFFICE_RESYNC, (payload) => handlers.onResync(payload));

  const reconnect = () => {
    if (socket.connected) return;
    manualReconnect = true;
    socket.disconnect();
    socket.connect();
  };

  options.windowTarget?.addEventListener('offline', () => {
    if (status !== 'connected') {
      clearTimer();
      setStatus('disconnected');
    }
  });
  options.windowTarget?.addEventListener('online', () => {
    if (!socket.connected) reconnect();
  });

  return {
    getStatus: () => status,
    reconnect,
    start() {
      if (started) return;
      started = true;
      armDisconnectTimer();
      socket.connect();
    },
  };
}
