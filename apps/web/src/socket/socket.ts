// The module-level Socket.IO client (API-C §4, ADR-010): one instance per page, same origin (dev proxy).
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@vo/shared';
import { io, type Socket } from 'socket.io-client';
import type { SocketLike } from './connection';

let instance: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  instance ??= io({
    path: SOCKET_PATH,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
    // The runtime decides when to connect (after the store exists).
    autoConnect: false,
  });
  return instance;
}

/** Adapts the singleton to the narrow interface the connection monitor uses. */
export function getBrowserSocket(): SocketLike {
  const socket = getSocket();
  return {
    get connected() {
      return socket.connected;
    },
    on(event: string, listener: (...args: never[]) => void) {
      socket.on(event as never, listener as never);
      return undefined;
    },
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
  };
}
