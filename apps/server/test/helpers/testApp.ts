// Test helper (API_CONTRACTS §9.8): a real server on 127.0.0.1:<ephemeral port> over a `:memory:` database,
// silent logger, and a RecordingBroadcaster that also forwards to the real Socket.IO server.
// Additive options (beyond the contract) let tests use a file DB, a capturing logger or config overrides.
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createServerApp, type ServerApp } from '../../src/app';
import { REPO_ROOT, type AppConfig } from '../../src/config';
import { openDatabase } from '../../src/db/connection';
import type { DatabaseHandle } from '../../src/db/types';
import { createLogger, type Logger } from '../../src/logger';
import {
  NoopBroadcaster,
  RecordingBroadcaster,
  type Broadcaster,
} from '../../src/realtime/broadcaster';
import { createIoBroadcaster } from '../../src/realtime/socketServer';
import { seedIfEmpty } from '../../src/seed/seed';

export interface TestApp {
  server: ServerApp;
  database: DatabaseHandle;
  recorder: RecordingBroadcaster;
  baseUrl: string;
  port: number;
  close(): Promise<void>;
}

export interface TestAppOptions {
  seed?: boolean; // default true
  now?: Date; // seed clock
  config?: Partial<AppConfig>;
  logger?: Logger;
  clock?: () => Date;
  /** `false` → the app starts gated (ADR-035 §2) until `server.markReady()`. Default true. */
  startReady?: boolean;
  /** Use this (already opened) database instead of a fresh `:memory:` one; it is not closed by close(). */
  database?: DatabaseHandle;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    logLevel: 'silent',
    corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    serveWeb: false,
    demoDefaultIntervalMs: 10_000,
    repoRoot: REPO_ROOT,
    webDistPath: path.join(REPO_ROOT, 'apps', 'web', 'dist'),
    ...overrides,
  };
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const ownsDatabase = options.database === undefined;
  const database = options.database ?? openDatabase({ path: ':memory:' });
  if (options.seed !== false) seedIfEmpty(database, options.now ?? new Date());

  // The recorder forwards to the Socket.IO broadcaster, which exists only once the app is created.
  let target: Broadcaster = new NoopBroadcaster();
  const lateBound: Broadcaster = {
    officeEvent: (payload) => target.officeEvent(payload),
    demoState: (state) => target.demoState(state),
    resync: (payload) => target.resync(payload),
  };
  const recorder = new RecordingBroadcaster(lateBound);
  const server = createServerApp({
    config: testConfig(options.config),
    database,
    logger: options.logger ?? createLogger({ level: 'silent' }),
    broadcaster: recorder,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.startReady === undefined ? {} : { startReady: options.startReady }),
  });
  target = createIoBroadcaster(server.io);

  await new Promise<void>((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.httpServer.address() as AddressInfo).port;

  return {
    server,
    database,
    recorder,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await server.close();
      if (ownsDatabase) database.close();
    },
  };
}

/** A debug-level logger that keeps every line as a parsed record. */
export function captureLogger(): { logger: Logger; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    write: (line) => {
      records.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, records };
}
