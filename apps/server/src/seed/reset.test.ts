import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection';
import { T0 } from '../db/testing';
import { isInsideDirectory, isPortInUse, resetDatabase, ResetRefusedError } from './reset';
import { seedIfEmpty } from './seed';

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A port that nothing listens on (bound, then released). */
async function freePort(): Promise<number> {
  const server = await listen();
  const port = portOf(server);
  await close(server);
  return port;
}

describe('isInsideDirectory', () => {
  it('accepts only paths strictly inside the directory', () => {
    const data = path.resolve('/repo/data');
    expect(isInsideDirectory(path.join(data, 'office.db'), data)).toBe(true);
    expect(isInsideDirectory(path.join(data, 'sub', 'x.db'), data)).toBe(true);
    expect(isInsideDirectory(data, data)).toBe(false);
    expect(isInsideDirectory(path.resolve('/repo/office.db'), data)).toBe(false);
    expect(isInsideDirectory(path.resolve('/repo/data-old/office.db'), data)).toBe(false);
    expect(isInsideDirectory(path.join(data, '..', 'office.db'), data)).toBe(false);
    expect(isInsideDirectory(path.resolve('/elsewhere/data/office.db'), data)).toBe(false);
  });
});

describe('isPortInUse', () => {
  it('is true for a listening port and false for a free one', async () => {
    const server = await listen();
    try {
      expect(await isPortInUse('127.0.0.1', portOf(server))).toBe(true);
      expect(await isPortInUse('0.0.0.0', portOf(server))).toBe(true); // wildcard probed via loopback
    } finally {
      await close(server);
    }
    expect(await isPortInUse('127.0.0.1', await freePort())).toBe(false);
  });
});

describe('resetDatabase', () => {
  let repoRoot: string;
  let dataDir: string;
  let dbPath: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'vo-reset-'));
    dataDir = path.join(repoRoot, 'data');
    mkdirSync(dataDir);
    dbPath = path.join(dataDir, 'office.db');
  });
  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('refuses :memory:', async () => {
    const port = await freePort();
    await expect(
      resetDatabase({ dbPath: ':memory:', repoRoot, host: '127.0.0.1', port }),
    ).rejects.toThrow(
      new ResetRefusedError('DB_PATH is :memory: — there is no database file to reset.'),
    );
  });

  it('refuses paths outside <repoRoot>/data/ and never deletes them', async () => {
    const port = await freePort();
    const outside = path.join(repoRoot, 'office.db');
    writeFileSync(outside, 'keep me');
    for (const candidate of [
      outside,
      '../office.db',
      path.join(repoRoot, 'data-backup', 'office.db'),
      dataDir,
    ]) {
      await expect(
        resetDatabase({ dbPath: candidate, repoRoot, host: '127.0.0.1', port }),
      ).rejects.toBeInstanceOf(ResetRefusedError);
    }
    expect(existsSync(outside)).toBe(true);
  });

  it('refuses while a server listens on HOST:PORT and leaves the database untouched', async () => {
    writeFileSync(dbPath, 'existing');
    const server = await listen();
    const port = portOf(server);
    try {
      await expect(resetDatabase({ dbPath, repoRoot, host: '127.0.0.1', port })).rejects.toThrow(
        `Server is running on 127.0.0.1:${port} — stop it before resetting the database.`,
      );
    } finally {
      await close(server);
    }
    expect(existsSync(dbPath)).toBe(true);
  });

  it('deletes the db, -wal and -shm files and reseeds a fresh database', async () => {
    // A used database: seeded, then modified, then closed (WAL mode leaves -wal/-shm next to it).
    const first = openDatabase({ path: dbPath });
    seedIfEmpty(first, new Date('2026-01-01T00:00:00.000Z'));
    first.repos.agents.update('04-backend-engineer', { status: 'working', startedAt: T0 }, T0);
    first.repos.settings.set('demo', { active: true }, T0);
    first.close();
    writeFileSync(`${dbPath}-wal`, '');
    writeFileSync(`${dbPath}-shm`, '');

    const now = new Date('2026-10-04T12:00:00.000Z');
    const result = await resetDatabase({
      dbPath,
      repoRoot,
      host: '127.0.0.1',
      port: await freePort(),
      now,
    });

    expect(result).toEqual({
      dbPath,
      deleted: [dbPath, `${dbPath}-wal`, `${dbPath}-shm`],
      agents: 15,
      tasks: 11,
      events: 44,
    });
    const reopened = openDatabase({ path: dbPath });
    try {
      expect(reopened.repos.agents.getById('04-backend-engineer')?.status).toBe('idle');
      expect(reopened.repos.agents.getById('04-backend-engineer')?.version).toBe(1);
      expect(reopened.repos.settings.get('demo')).toBeNull();
      expect(reopened.repos.events.count()).toBe(44);
      expect(reopened.repos.tasks.getById('SW-123')?.createdAt.startsWith('2026-10-04')).toBe(true);
    } finally {
      reopened.close();
    }
  });

  it('accepts a repoRoot-relative DB_PATH and a missing database file', async () => {
    const result = await resetDatabase({
      dbPath: 'data/sub/dev.db',
      repoRoot,
      host: '127.0.0.1',
      port: await freePort(),
    });
    expect(result.dbPath).toBe(path.join(dataDir, 'sub', 'dev.db'));
    expect(result.deleted).toEqual([]);
    expect(result.agents).toBe(15);
    expect(existsSync(result.dbPath)).toBe(true);
  });
});
