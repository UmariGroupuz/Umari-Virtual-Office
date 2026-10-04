import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NESTED_TRANSACTION_ERROR, SYNC_TRANSACTION_ERROR, openDatabase } from './connection';
import { makeTask, openTestDatabase, T0 } from './testing';
import type { DatabaseHandle } from './types';

function pragma(handle: DatabaseHandle, name: string): unknown {
  const row = handle.db.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : Object.values(row)[0]; // busy_timeout's column is named "timeout"
}

describe('openDatabase — :memory:', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase();
  });
  afterEach(() => {
    handle.close();
  });

  it('applies pragmas, migrates and exposes path / schemaVersion / repos', () => {
    expect(handle.path).toBe(':memory:');
    expect(handle.schemaVersion).toBe(1);
    expect(pragma(handle, 'foreign_keys')).toBe(1);
    expect(pragma(handle, 'busy_timeout')).toBe(5000);
    expect(pragma(handle, 'synchronous')).toBe(1); // NORMAL
    expect(pragma(handle, 'journal_mode')).toBe('memory'); // WAL only for file DBs
    expect(Object.keys(handle.repos).sort()).toEqual([
      'agents',
      'events',
      'projects',
      'settings',
      'tasks',
    ]);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      handle.repos.tasks.insert(makeTask('SW-1', { project: 'no-such-project' }), T0),
    ).toThrow(/FOREIGN KEY/);
  });

  describe('transaction', () => {
    it('commits and returns the callback result', () => {
      const result = handle.transaction((repos) => {
        repos.tasks.insert(makeTask('SW-1'), T0);
        return 'done';
      });
      expect(result).toBe('done');
      expect(handle.repos.tasks.count()).toBe(1);
      expect(handle.db.isTransaction).toBe(false);
    });

    it('rolls back and rethrows the same error when the callback throws', () => {
      const boom = new Error('boom');
      expect(() =>
        handle.transaction((repos) => {
          repos.tasks.insert(makeTask('SW-1'), T0);
          throw boom;
        }),
      ).toThrow(boom);
      expect(handle.repos.tasks.count()).toBe(0);
      expect(handle.db.isTransaction).toBe(false);
    });

    it('rolls back when the callback returns a thenable (async callback)', async () => {
      expect(() =>
        handle.transaction(async (repos) => {
          repos.tasks.insert(makeTask('SW-1'), T0);
          await Promise.resolve();
          throw new Error('late');
        }),
      ).toThrow(SYNC_TRANSACTION_ERROR);
      expect(handle.repos.tasks.count()).toBe(0);
      expect(handle.db.isTransaction).toBe(false);
      // the abandoned promise's rejection is swallowed: Vitest would fail the run on an unhandled rejection
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('rolls back for a non-promise thenable too', () => {
      expect(() =>
        handle.transaction((repos) => {
          repos.tasks.insert(makeTask('SW-1'), T0);
          return { then: () => undefined };
        }),
      ).toThrow(SYNC_TRANSACTION_ERROR);
      expect(handle.repos.tasks.count()).toBe(0);
    });

    it('throws on a nested call and rolls the outer transaction back', () => {
      expect(() =>
        handle.transaction((repos) => {
          repos.tasks.insert(makeTask('SW-1'), T0);
          return handle.transaction(() => 1);
        }),
      ).toThrow(NESTED_TRANSACTION_ERROR);
      expect(handle.repos.tasks.count()).toBe(0);
      // the handle is usable again afterwards
      handle.transaction((repos) => repos.tasks.insert(makeTask('SW-2'), T0));
      expect(handle.repos.tasks.count()).toBe(1);
    });

    it('throws when a raw transaction is already open on the connection', () => {
      handle.db.exec('BEGIN');
      expect(() => handle.transaction(() => 1)).toThrow(NESTED_TRANSACTION_ERROR);
      handle.db.exec('ROLLBACK');
    });

    it('rolls back on a constraint violation inside the callback', () => {
      expect(() =>
        handle.transaction((repos) => {
          repos.tasks.insert(makeTask('SW-1'), T0);
          repos.tasks.insert(makeTask('SW-1'), T0); // duplicate primary key
        }),
      ).toThrow(/UNIQUE/);
      expect(handle.repos.tasks.count()).toBe(0);
    });
  });

  it('ping is true while open and false after close; close is idempotent', () => {
    expect(handle.ping()).toBe(true);
    handle.close();
    expect(handle.ping()).toBe(false);
    expect(() => handle.close()).not.toThrow();
    expect(handle.db.isOpen).toBe(false);
  });
});

describe('openDatabase — file database', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'vo-db-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates missing parent directories, resolves an absolute path and uses WAL', () => {
    const file = path.join(dir, 'nested', 'deeper', 'office.db');
    const handle = openDatabase({ path: file });
    try {
      expect(handle.path).toBe(path.resolve(file));
      expect(path.isAbsolute(handle.path)).toBe(true);
      expect(existsSync(file)).toBe(true);
      expect(pragma(handle, 'journal_mode')).toBe('wal');
      expect(pragma(handle, 'foreign_keys')).toBe(1);
      expect(handle.ping()).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('persists data across re-open and does not re-run migrations', () => {
    const file = path.join(dir, 'office.db');
    const first = openDatabase({ path: file });
    expect(first.migrations).toEqual({ from: 0, to: 1 });
    first.repos.settings.set('k', { a: 1 }, T0);
    first.close();

    const second = openDatabase({ path: file });
    try {
      expect(second.migrations).toEqual({ from: 1, to: 1 });
      expect(second.schemaVersion).toBe(1);
      expect(second.repos.settings.get('k')).toEqual({ a: 1 });
    } finally {
      second.close();
    }
  });

  it('closes the connection and throws when migrations fail (startup aborts)', () => {
    const file = path.join(dir, 'future.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    expect(() => openDatabase({ path: file })).toThrow(/newer than this server supports/);
    // the failed open released the file (would throw EBUSY on Windows otherwise)
    expect(() => rmSync(file)).not.toThrow();
  });
});
