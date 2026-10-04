// Server application assembly (API_CONTRACTS §9.8): Express + Socket.IO + services on an opened, migrated
// database. Does not listen; `index.ts` (or the tests) call `httpServer.listen`.
import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Express, type RequestHandler } from 'express';
import { APP_VERSION } from '@vo/shared';
import { createApiRouter } from './api/router';
import { errorHandler } from './api/middleware/errorHandler';
import { hostGuard } from './api/middleware/hostGuard';
import { apiNotFound } from './api/middleware/notFound';
import { originGuard } from './api/middleware/originGuard';
import { mountWebApp } from './api/static';
import type { AppConfig } from './config';
import type { DatabaseHandle } from './db/types';
import { appErrors, toErrorBody } from './errors';
import { createLogger, type Logger } from './logger';
import type { Broadcaster } from './realtime/broadcaster';
import { createSocketServer, type OfficeIoServer } from './realtime/socketServer';
import { createDemoService, type DemoService } from './services/demoService';
import { createEventService, type EventService } from './services/eventService';
import { createProjectResolver } from './services/projectResolver';
import { createSnapshotService, type SnapshotService } from './services/snapshotService';
import { createTaskService, type TaskService } from './services/taskService';

export interface ServerAppOptions {
  config: AppConfig;
  database: DatabaseHandle; // opened + migrated; seeding is the caller's job
  logger?: Logger; // default createLogger({ level: config.logLevel })
  broadcaster?: Broadcaster; // default: the Socket.IO broadcaster; tests may wrap it in RecordingBroadcaster
  clock?: () => Date; // default () => new Date()
  /**
   * Listen-first boot (ADR-035 §2): `false` creates the app gated — `/api/*` answers 503 "starting" and
   * sockets are refused — until `markReady()`. Default `true`.
   */
  startReady?: boolean;
}

export interface ServerApp {
  app: Express;
  httpServer: HttpServer;
  io: OfficeIoServer;
  services: {
    events: EventService;
    tasks: TaskService;
    demo: DemoService;
    snapshot: SnapshotService;
  };
  /** Opens the readiness gate (ADR-035 §2). Idempotent. */
  markReady(): void;
  isReady(): boolean;
  /** Stops demo (restore), closes io and the HTTP server; does NOT close the database. Idempotent. */
  close(): Promise<void>;
}

const FORCE_CLOSE_AFTER_MS = 2000;

export function createServerApp(options: ServerAppOptions): ServerApp {
  const { config, database } = options;
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  const clock = options.clock ?? (() => new Date());

  let ready = options.startReady ?? true;

  const app = express();
  app.disable('x-powered-by');
  const httpServer = createServer(app);
  const socket = createSocketServer(httpServer, { config, logger, isReady: () => ready });
  const broadcaster = options.broadcaster ?? socket.broadcaster;

  const projects = createProjectResolver(() => database.repos.projects.list());
  const events = createEventService({ database, broadcaster, logger, clock, projects });
  const tasks = createTaskService({ database, events, projects, logger, clock });
  const demo = createDemoService({
    database,
    events,
    broadcaster,
    logger,
    clock,
    projects,
    defaultIntervalMs: config.demoDefaultIntervalMs,
  });
  const snapshot = createSnapshotService({
    database,
    projects,
    demoState: () => demo.getState(),
    clock,
  });

  // Order: framing headers on every response → Host guard → Origin rule for writes → readiness gate → routes.
  app.use(frameProtection);
  app.use('/api', apiHeaders); // before the guards, so their 403s carry them too (CR-19)
  app.use(hostGuard(config.host));
  app.use('/api', originGuard(config.corsOrigins));
  app.use(
    '/api',
    readinessGate(() => ready, clock, logger),
  );
  app.use(
    '/api',
    createApiRouter(
      { database, logger, clock, projects, events, tasks, demo, snapshot },
      config.corsOrigins,
    ),
  );
  if (config.serveWeb) mountWebApp(app, { webDistPath: config.webDistPath, logger });
  // Anything not served above (non-/api paths: API-only mode, or non-GET in one-port mode) gets our JSON 404,
  // never Express's finalhandler page, whose CSP `default-src 'none'` would drop `frame-ancestors` (QA-4).
  app.use(apiNotFound);
  app.use(errorHandler(logger));

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        demo.stop('shutdown');
      } catch (error) {
        logger.error('demo_stop_failed', { err: error });
      }
      demo.dispose();
      await new Promise<void>((resolve) => {
        // io.close() disconnects every socket and closes the HTTP server (callback after it closed).
        void socket.io.close(() => resolve());
        httpServer.closeIdleConnections();
        setTimeout(() => httpServer.closeAllConnections(), FORCE_CLOSE_AFTER_MS).unref();
      });
    })();
    return closing;
  };

  return {
    app,
    httpServer,
    io: socket.io,
    services: { events, tasks, demo, snapshot },
    markReady: () => {
      ready = true;
    },
    isReady: () => ready,
    close,
  };
}

/** 503 `SERVICE_UNAVAILABLE` "Server is starting" for every `/api` request until ready (ADR-035 §2). */
function readinessGate(isReady: () => boolean, clock: () => Date, logger: Logger): RequestHandler {
  return (req, res, next) => {
    if (isReady()) {
      next();
      return;
    }
    const error = appErrors.starting({
      status: 'starting',
      uptimeSec: Math.floor(process.uptime()),
      version: APP_VERSION,
      time: clock().toISOString(),
    });
    logger.warn('request_failed', {
      status: error.status,
      code: error.code,
      method: req.method,
      route: req.originalUrl.split('?')[0] ?? '',
    });
    res.set('Retry-After', '1');
    res.status(error.status).json(toErrorBody(error));
  };
}

/**
 * Clickjacking protection on every HTTP response, including the served web build (ADR-037, SEC-5).
 * Only framing is restricted here; a full CSP for the Phaser bundle is a later hardening step.
 */
const frameProtection: RequestHandler = (_req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  next();
};

/** API_CONTRACTS §0 headers on every `/api` response, including guard refusals and the starting 503. */
export const apiHeaders: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
};
