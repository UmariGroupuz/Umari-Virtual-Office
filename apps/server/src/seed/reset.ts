// `npm run db:reset` (API_CONTRACTS §12.3, REQ-122): deletes the LOCAL DEV database file and reseeds it.
// Never invoked implicitly. Refuses `:memory:`, any path outside `<repoRoot>/data/`, and a running server.
import { existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMORY_DB_PATH, openDatabase } from '../db/connection';
import { seedIfEmpty } from './seed';

export interface ResetOptions {
  /** Absolute (or repoRoot-relative) database path, i.e. `config.dbPath`. */
  dbPath: string;
  repoRoot: string;
  /** Server address that must NOT be accepting connections (`config.host` / `config.port`). */
  host: string;
  port: number;
  now?: Date;
  /** TCP probe timeout; default 1000 ms. */
  connectTimeoutMs?: number;
}

export interface ResetResult {
  dbPath: string;
  /** Files that existed and were deleted (db, -wal, -shm). */
  deleted: string[];
  agents: number;
  tasks: number;
  events: number;
}

/** A safety refusal (exit 1 with this message); the database was not touched. */
export class ResetRefusedError extends Error {
  override name = 'ResetRefusedError';
}

function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** True when `target` is strictly inside `dir` (not `dir` itself). */
export function isInsideDirectory(target: string, dir: string): boolean {
  const relative = path.relative(
    normalizeForCompare(path.resolve(dir)),
    normalizeForCompare(path.resolve(target)),
  );
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Wildcard bind addresses are probed through loopback; `[::1]` brackets are stripped. */
function probeHost(host: string): string {
  const bare = host.replace(/^\[(.*)\]$/, '$1');
  if (bare === '0.0.0.0' || bare === '') return '127.0.0.1';
  if (bare === '::') return '::1';
  return bare;
}

/** Resolves true when a TCP connection to host:port succeeds (something is listening). */
export function isPortInUse(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: probeHost(host), port });
    let settled = false;
    const finish = (inUse: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function resetDatabase(options: ResetOptions): Promise<ResetResult> {
  if (options.dbPath.trim() === MEMORY_DB_PATH) {
    throw new ResetRefusedError('DB_PATH is :memory: — there is no database file to reset.');
  }
  const dataDir = path.resolve(options.repoRoot, 'data');
  const dbPath = path.resolve(options.repoRoot, options.dbPath);
  if (!isInsideDirectory(dbPath, dataDir)) {
    throw new ResetRefusedError(
      `DB_PATH ${dbPath} is not inside ${dataDir}${path.sep} — db:reset only resets the local dev database.`,
    );
  }
  if (await isPortInUse(options.host, options.port, options.connectTimeoutMs)) {
    throw new ResetRefusedError(
      `Server is running on ${options.host}:${options.port} — stop it before resetting the database.`,
    );
  }

  const deleted: string[] = [];
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(file)) deleted.push(file);
    rmSync(file, { force: true });
  }

  const handle = openDatabase({ path: dbPath });
  try {
    const result = seedIfEmpty(handle, options.now);
    return { dbPath, deleted, agents: result.agents, tasks: result.tasks, events: result.events };
  } finally {
    handle.close();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return (
    normalizeForCompare(path.resolve(entry)) === normalizeForCompare(fileURLToPath(import.meta.url))
  );
}

async function main(): Promise<number> {
  try {
    // Loaded lazily so tests can import `resetDatabase` without the server config module.
    const { loadConfig } = await import('../config');
    const config = loadConfig();
    const result = await resetDatabase({
      dbPath: config.dbPath,
      repoRoot: config.repoRoot,
      host: config.host,
      port: config.port,
    });
    process.stdout.write(
      `Database reset: ${result.dbPath}\n` +
        `Seeded ${result.agents} agents, ${result.tasks} tasks, ${result.events} events.\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const prefix = error instanceof ResetRefusedError ? 'db:reset refused' : 'db:reset failed';
    process.stderr.write(`${prefix}: ${message}\n`);
    return 1;
  }
}

if (isDirectRun()) {
  process.exitCode = await main();
}
