import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations, type Migration } from './index';

function userVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.['user_version']);
}

function tableNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => String(r['name']));
}

function indexNames(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
    )
    .all()
    .map((r) => String(r['name']));
}

function columns(db: DatabaseSync, table: string): string[] {
  return db
    .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
    .all(table)
    .map((r) => String(r['name']));
}

describe('runMigrations', () => {
  let db: DatabaseSync;

  afterEach(() => {
    if (db.isOpen) db.close();
  });

  it('declares migration 1/init only, in order', () => {
    db = new DatabaseSync(':memory:');
    expect(MIGRATIONS.map((m) => [m.version, m.name])).toEqual([[1, 'init']]);
  });

  it('migrates 0 → 1 and creates the API_CONTRACTS §8 schema', () => {
    db = new DatabaseSync(':memory:');
    expect(userVersion(db)).toBe(0);

    expect(runMigrations(db)).toEqual({ from: 0, to: 1 });

    expect(userVersion(db)).toBe(1);
    expect(tableNames(db)).toEqual(['agents', 'events', 'projects', 'settings', 'tasks']);
    expect(indexNames(db)).toEqual([
      'idx_events_agent_seq',
      'idx_events_project_seq',
      'idx_events_task_seq',
      'idx_events_type_seq',
      'idx_tasks_assignee',
      'idx_tasks_project_status',
    ]);
    expect(columns(db, 'projects')).toEqual([
      'id',
      'name',
      'task_prefix',
      'sort_order',
      'created_at',
    ]);
    expect(columns(db, 'agents')).toEqual([
      'id',
      'code',
      'name',
      'role',
      'short_role',
      'avatar',
      'department',
      'room_id',
      'desk_id',
      'sort_order',
      'status',
      'current_project',
      'current_task',
      'task_id',
      'progress',
      'started_at',
      'last_activity_at',
      'current_action',
      'last_message',
      'online',
      'metadata',
      'version',
      'updated_at',
    ]);
    expect(columns(db, 'tasks')).toEqual([
      'id',
      'title',
      'description',
      'project_id',
      'assigned_agent_id',
      'status',
      'priority',
      'progress',
      'created_at',
      'started_at',
      'completed_at',
      'blocked_by',
      'metadata',
      'version',
      'updated_at',
    ]);
    expect(columns(db, 'events')).toEqual([
      'seq',
      'id',
      'type',
      'source',
      'agent_id',
      'project_id',
      'task_id',
      'status',
      'action',
      'message',
      'severity',
      'progress',
      'metadata',
      'occurred_at',
      'created_at',
      'forced',
    ]);
    expect(columns(db, 'settings')).toEqual(['key', 'value', 'updated_at']);
    // seq is AUTOINCREMENT (never reused after deletes)
    expect(
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'events'").get()?.['sql'],
    ).toContain('AUTOINCREMENT');
  });

  it('is a no-op when re-run on an up-to-date database', () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    db.exec(
      "INSERT INTO projects (id, name, task_prefix, sort_order, created_at) VALUES ('p', 'P', 'P', 1, 'x')",
    );

    expect(runMigrations(db)).toEqual({ from: 1, to: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects').get()?.['n']).toBe(1);
  });

  it('rolls back every pending migration and user_version when one fails, and throws', () => {
    db = new DatabaseSync(':memory:');
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: 2, name: 'adds_table', sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY);' },
      { version: 3, name: 'broken', sql: 'CREATE TABLE oops (;' },
    ];

    expect(() => runMigrations(db, broken)).toThrow(/^Migration 3\/broken failed: /);

    expect(userVersion(db)).toBe(0);
    expect(tableNames(db)).toEqual([]);
    expect(db.isTransaction).toBe(false);
  });

  it('keeps already-applied migrations when a later run fails', () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    const broken: Migration[] = [
      ...MIGRATIONS,
      { version: 2, name: 'broken', sql: 'SELECT * FROM nope;' },
    ];

    expect(() => runMigrations(db, broken)).toThrow('Migration 2/broken failed');
    expect(userVersion(db)).toBe(1);
    expect(tableNames(db)).toContain('agents');
  });

  it('refuses a database whose schema is newer than the known migrations', () => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 7');
    expect(() => runMigrations(db)).toThrow(
      'Database schema version 7 is newer than this server supports (1)',
    );
  });

  it('rejects an unordered migration list and calls inside a transaction', () => {
    db = new DatabaseSync(':memory:');
    const unordered: Migration[] = [
      { version: 2, name: 'b', sql: '' },
      { version: 1, name: 'a', sql: '' },
    ];
    expect(() => runMigrations(db, unordered)).toThrow(/Invalid migration list/);

    db.exec('BEGIN');
    expect(() => runMigrations(db)).toThrow(
      'runMigrations must not be called inside a transaction',
    );
    db.exec('ROLLBACK');
  });
});
