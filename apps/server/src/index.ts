// Server entry point (API_CONTRACTS §9.8, ADR-035 §2). Listen-first boot — the port is the single-instance
// lock, so a second instance fails before it changes any data:
//   loadConfig → createLogger → warn if non-loopback → openDatabase (migrations) → createServerApp (gated:
//   /api → 503 "starting", sockets refused) → listen → seedIfEmpty → demo.recoverOnBoot() → markReady →
//   server_started.
// SIGINT/SIGTERM/SIGHUP (+ SIGBREAK on Windows, + IPC disconnect) → server_stopping → app.close() (demo
// restore, sockets, HTTP) → database.close() → server_stopped → exit 0; a shutdown that takes longer than
// 5 s is forced (exit 1).
import type { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServerApp, type ServerApp } from './app';
import { isLoopbackHost, loadConfig, type AppConfig } from './config';
import { openDatabase, type OpenedDatabaseHandle } from './db/connection';
import { createLogger, type Logger } from './logger';
import { seedIfEmpty } from './seed/seed';

const FORCE_EXIT_AFTER_MS = 5000;

export interface BootedServer {
  config: AppConfig;
  logger: Logger;
  database: OpenedDatabaseHandle;
  server: ServerApp;
  /** Actual bound port (differs from config.port when it is 0). */
  port: number;
  /** Graceful stop; idempotent. Does not exit the process. */
  shutdown(signal: string): Promise<void>;
}

function listen(httpServer: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    httpServer.once('error', onError);
    httpServer.listen(port, host, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });
}

export async function boot(
  options: { config?: AppConfig; logger?: Logger; clock?: () => Date } = {},
): Promise<BootedServer> {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger({ level: config.logLevel });
  if (!isLoopbackHost(config.host)) {
    logger.warn('non_loopback_host', {
      host: config.host,
      note: 'The API has no authentication in Phase 1; bind to 127.0.0.1 unless you trust the network.',
    });
  }

  const database = openDatabase({ path: config.dbPath });
  const { from, to } = database.migrations;
  if (from !== to) logger.info('migrations_applied', { from, to });

  const server = createServerApp({
    config,
    database,
    logger,
    startReady: false,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });

  const abort = async (error: unknown): Promise<never> => {
    await server.close();
    database.close();
    throw error;
  };

  // 1) Take the port first: EADDRINUSE (another instance) fails here, before seed or demo recovery.
  try {
    await listen(server.httpServer, config.port, config.host);
  } catch (error) {
    return abort(error);
  }

  // 2) Only the instance that owns the port touches shared state; requests stay gated meanwhile.
  try {
    const seed = seedIfEmpty(database, options.clock?.() ?? new Date());
    if (seed.seeded) {
      logger.info('seed_applied', { agents: seed.agents, tasks: seed.tasks, events: seed.events });
    }
    server.services.demo.recoverOnBoot();
    server.markReady();
  } catch (error) {
    return abort(error);
  }

  const port = (server.httpServer.address() as AddressInfo).port;
  logger.info('server_started', {
    host: config.host,
    port,
    dbPath: config.dbPath,
    serveWeb: config.serveWeb,
  });

  let stopping: Promise<void> | null = null;
  return {
    config,
    logger,
    database,
    server,
    port,
    shutdown(signal) {
      stopping ??= (async () => {
        logger.info('server_stopping', { signal });
        await server.close();
        database.close();
        logger.info('server_stopped');
      })();
      return stopping;
    },
  };
}

/** The part of `process` the shutdown wiring needs (injectable for tests). */
export type ShutdownProcess = Pick<EventEmitter, 'on'> & { connected?: boolean };

/**
 * Graceful shutdown on SIGINT, SIGTERM, SIGHUP (console window closed on Windows / terminal hang-up),
 * SIGBREAK (Ctrl+Break, Windows only) and — when started with an IPC channel, e.g. by `node --watch` — on
 * `disconnect` from the parent (CR-8). Runs once; later signals are ignored while it completes.
 */
export function installShutdownHandlers(
  proc: ShutdownProcess,
  booted: Pick<BootedServer, 'shutdown' | 'logger'>,
  options: { exit: (code: number) => void; platform?: NodeJS.Platform; forceAfterMs?: number },
): string[] {
  const forceAfterMs = options.forceAfterMs ?? FORCE_EXIT_AFTER_MS;
  let triggered = false;
  const onSignal = (signal: string): void => {
    if (triggered) return;
    triggered = true;
    setTimeout(() => {
      booted.logger.error('shutdown_timeout', { afterMs: forceAfterMs });
      options.exit(1);
    }, forceAfterMs).unref();
    booted.shutdown(signal).then(
      () => options.exit(0),
      (error: unknown) => {
        booted.logger.error('shutdown_failed', { err: error });
        options.exit(1);
      },
    );
  };
  const events = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  if ((options.platform ?? process.platform) === 'win32') events.push('SIGBREAK');
  if (proc.connected === true) events.push('disconnect');
  for (const event of events) proc.on(event, () => onSignal(event));
  return events;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const normalize = (url: string): string =>
    process.platform === 'win32' ? url.toLowerCase() : url;
  return normalize(import.meta.url) === normalize(pathToFileURL(path.resolve(entry)).href);
}

async function main(): Promise<void> {
  let booted: BootedServer;
  try {
    booted = await boot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'server_start_failed', error: message })}\n`,
    );
    process.exit(1);
  }

  installShutdownHandlers(process, booted, { exit: (code) => process.exit(code) });
  const fatal = (error: unknown): void => {
    booted.logger.error('uncaught_exception', { err: error });
    process.exit(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
}

if (isMainModule()) void main();
