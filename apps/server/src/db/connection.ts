// SQLite connection (ADR-003/004, API_CONTRACTS §8, §9.2): pragmas, migrations, repositories and the
// synchronous transaction helper. No logging here — callers log `migrations_applied` from `migrations`.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations/index';
import { createRepositories } from './repositories/index';
import type { DatabaseHandle, Repositories } from './types';

export const MEMORY_DB_PATH = ':memory:';

export const SYNC_TRANSACTION_ERROR = 'Transaction callback must be synchronous';
export const NESTED_TRANSACTION_ERROR = 'Nested transactions are not supported';

export interface OpenedDatabaseHandle extends DatabaseHandle {
  /** Result of `runMigrations` for this open (`from === to` when nothing was pending). */
  readonly migrations: { from: number; to: number };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function applyPragmas(db: DatabaseSync, isFile: boolean): void {
  db.exec('PRAGMA busy_timeout = 5000');
  if (isFile) db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
}

/**
 * Opens (creating if needed) the database at `options.path` — `':memory:'` or a file path (resolved to
 * an absolute path; the parent directory is created) — applies the pragmas, runs pending migrations
 * and builds the repositories. A failing migration closes the connection and throws.
 */
export function openDatabase(options: { path: string }): OpenedDatabaseHandle {
  const isFile = options.path !== MEMORY_DB_PATH;
  const dbPath = isFile ? path.resolve(options.path) : MEMORY_DB_PATH;
  if (isFile) mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  let migrations: { from: number; to: number };
  try {
    applyPragmas(db, isFile);
    migrations = runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const repos: Repositories = createRepositories(db);
  let closed = false;
  let inTransaction = false;

  function transaction<T>(fn: (repos: Repositories) => T): T {
    if (inTransaction || db.isTransaction) throw new Error(NESTED_TRANSACTION_ERROR);
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    try {
      const result = fn(repos);
      if (isThenable(result)) {
        // Swallow the eventual rejection of the abandoned promise; the caller gets the error below.
        result.then(undefined, () => undefined);
        throw new Error(SYNC_TRANSACTION_ERROR);
      }
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      inTransaction = false;
    }
  }

  function ping(): boolean {
    if (closed) return false;
    try {
      return db.prepare('SELECT 1 AS ok').get()?.['ok'] === 1;
    } catch {
      return false;
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    db.close();
  }

  return {
    db,
    path: dbPath,
    repos,
    schemaVersion: migrations.to,
    migrations,
    transaction,
    ping,
    close,
  };
}
