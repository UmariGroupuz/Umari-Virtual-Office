// Embedded, forward-only SQL migrations (ADR-004, API_CONTRACTS §8).
import type { DatabaseSync } from 'node:sqlite';
import { migration001Init } from './001_init';

export interface Migration {
  /** Positive integer; strictly increasing across `MIGRATIONS`. Stored in `PRAGMA user_version`. */
  version: number;
  name: string;
  sql: string;
}

/** Every migration of the server, in order. Phase 1 = `1 / init`. */
export const MIGRATIONS: readonly Migration[] = Object.freeze([migration001Init]);

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  const value = row?.['user_version'];
  if (typeof value !== 'number') throw new Error('Could not read PRAGMA user_version');
  return value;
}

function assertOrdered(migrations: readonly Migration[]): void {
  let previous = 0;
  for (const m of migrations) {
    if (!Number.isSafeInteger(m.version) || m.version <= previous) {
      throw new Error(
        `Invalid migration list: version ${String(m.version)} (${m.name}) must be an integer greater than ${previous}`,
      );
    }
    previous = m.version;
  }
}

/**
 * Applies every migration with `version > PRAGMA user_version` inside one `BEGIN IMMEDIATE … COMMIT`,
 * setting `user_version` in the same transaction. Any failure rolls everything back and throws
 * (startup must abort). A database whose schema is newer than the known migrations is refused.
 * `migrations` is injectable for tests only; production always uses `MIGRATIONS`.
 */
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): { from: number; to: number } {
  assertOrdered(migrations);
  if (db.isTransaction) throw new Error('runMigrations must not be called inside a transaction');

  const from = readUserVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) {
    throw new Error(
      `Database schema version ${from} is newer than this server supports (${latest}); refusing to start`,
    );
  }

  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from };

  db.exec('BEGIN IMMEDIATE');
  let current: Migration | undefined;
  try {
    for (const migration of pending) {
      current = migration;
      db.exec(migration.sql);
      // PRAGMA values cannot be bound as parameters; `version` is a validated safe integer.
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    const label = current ? `${current.version}/${current.name}` : 'unknown';
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${label} failed: ${reason}`, { cause: error });
  }

  return { from, to: readUserVersion(db) };
}
