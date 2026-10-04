// Socket.IO server (API_CONTRACTS §4, ADR-009): server → client only. No client handlers are registered;
// anything a client emits is ignored and logged at debug (REQ-051).
import type { Server as HttpServer } from 'node:http';
import {
  SOCKET_EVENTS,
  SOCKET_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@vo/shared';
import { Server } from 'socket.io';
import { isAllowedHost } from '../api/middleware/hostGuard';
import { isAllowedOrigin } from '../api/middleware/originGuard';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';
import type { Broadcaster } from './broadcaster';

export type OfficeIoServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Broadcasts to every connected client of `io` (default namespace, no rooms in Phase 1). */
export function createIoBroadcaster(io: OfficeIoServer): Broadcaster {
  return {
    officeEvent: (payload) => {
      io.emit(SOCKET_EVENTS.OFFICE_EVENT, payload);
    },
    demoState: (state) => {
      io.emit(SOCKET_EVENTS.DEMO_STATE, state);
    },
    resync: (payload) => {
      io.emit(SOCKET_EVENTS.OFFICE_RESYNC, payload);
    },
  };
}

type RejectionReason = 'host' | 'origin' | 'starting';

const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = {
  host: 'Host not allowed',
  origin: 'Origin not allowed',
  starting: 'Server is starting',
};

// The Origin rule is shared with the HTTP write path (ADR-037 SEC-2).
export { isAllowedOrigin };

/** First failing rule of a Socket.IO request, or `null` when it may connect. */
export function socketRejection(
  headers: { host?: string | undefined; origin?: string | undefined },
  config: Pick<AppConfig, 'host' | 'corsOrigins'>,
  ready: boolean,
): RejectionReason | null {
  if (!isAllowedHost(headers.host, config.host)) return 'host';
  if (
    headers.origin !== undefined &&
    !isAllowedOrigin(headers.origin, headers.host, config.corsOrigins)
  ) {
    return 'origin';
  }
  if (!ready) return 'starting';
  return null;
}

export function createSocketServer(
  httpServer: HttpServer,
  deps: { config: AppConfig; logger: Logger; isReady?: () => boolean },
): { io: OfficeIoServer; broadcaster: Broadcaster } {
  const { config, logger } = deps;
  const isReady = deps.isReady ?? (() => true);
  const io: OfficeIoServer = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    cors: { origin: config.corsOrigins, methods: ['GET', 'POST'] },
    // Runs for the polling handshake and for a direct WebSocket upgrade (engine.io `verify`).
    allowRequest: (req, callback) => {
      const reason = socketRejection(req.headers, config, isReady());
      if (reason === null) {
        callback(null, true);
        return;
      }
      logger.warn('socket_rejected', {
        reason,
        host: (req.headers.host ?? '').slice(0, 200),
        origin: (req.headers.origin ?? null)?.slice(0, 200) ?? null,
      });
      callback(REJECTION_MESSAGES[reason], false);
    },
  });

  io.on('connection', (socket) => {
    logger.info('socket_connected', { socketId: socket.id, clients: io.of('/').sockets.size });
    socket.onAny((event: string) => {
      logger.debug('socket_message_ignored', {
        socketId: socket.id,
        event: String(event).slice(0, 100),
      });
    });
    socket.on('disconnect', (reason) => {
      logger.info('socket_disconnected', {
        socketId: socket.id,
        clients: io.of('/').sockets.size,
        reason,
      });
    });
  });

  return { io, broadcaster: createIoBroadcaster(io) };
}
