// R-2 smoke test: node:sqlite must load under Vitest (Vite 8 module runner, forks pool).
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

describe('node:sqlite under Vitest', () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it('creates an in-memory database and runs CREATE / INSERT / SELECT', () => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO smoke (name) VALUES (?)');
    insert.run('alpha');
    insert.run('beta');

    const rows = db.prepare('SELECT id, name FROM smoke ORDER BY id').all();

    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]);
  });

  it('rolls back PRAGMA user_version together with the transaction', () => {
    db = new DatabaseSync(':memory:');
    const userVersion = (): unknown =>
      (db?.prepare('PRAGMA user_version').get() as { user_version: number } | undefined)
        ?.user_version;

    expect(userVersion()).toBe(0);

    db.exec('BEGIN IMMEDIATE');
    db.exec('PRAGMA user_version = 1');
    expect(db.isTransaction).toBe(true);
    expect(userVersion()).toBe(1);
    db.exec('ROLLBACK');

    expect(db.isTransaction).toBe(false);
    expect(userVersion()).toBe(0);

    db.exec('BEGIN IMMEDIATE');
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
    expect(userVersion()).toBe(2);
  });
});
