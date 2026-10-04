// CR-2 / ADR-035 §2: listen-first boot. The port is the single-instance lock; until the boot finishes,
// /api answers 503 "starting" and sockets are refused.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClientToServerEvents, ServerToClientEvents } from '@vo/shared';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection';
import { boot } from '../src/index';
import { captureState } from './helpers/state';
import { captureLogger, createTestApp, testConfig } from './helpers/testApp';

const dir = mkdtempSync(path.join(tmpdir(), 'vo-startup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readiness gate', () => {
  it('503 "starting" on /api and refused sockets until markReady()', async () => {
    const logs = captureLogger();
    const t = await createTestApp({ startReady: false, logger: logs.logger });
    try {
      expect(t.server.isReady()).toBe(false);
      const health = await request(t.baseUrl).get('/api/health');
      expect(health.status).toBe(503);
      expect(health.headers['cache-control']).toBe('no-store');
      expect(health.body.error).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Server is starting',
        details: {
          status: 'starting',
          uptimeSec: expect.any(Number) as number,
          version: '0.1.0',
          time: expect.any(String) as string,
        },
      });
      for (const [method, url] of [
        ['get', '/api/agents'],
        ['post', '/api/events'],
        ['post', '/api/demo/start'],
        ['get', '/api/nope'],
      ] as const) {
        const res = await request(t.baseUrl)[method](url).send({});
        expect(res.status, `${method} ${url}`).toBe(503);
      }
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(t.baseUrl, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      const outcome = await new Promise<string>((resolve) => {
        socket.once('connect', () => resolve('connected'));
        socket.once('connect_error', () => resolve('refused'));
      });
      socket.disconnect();
      expect(outcome).toBe('refused');
      expect(logs.records).toContainEqual(
        expect.objectContaining({ msg: 'socket_rejected', reason: 'starting' }),
      );

      t.server.markReady();
      expect((await request(t.baseUrl).get('/api/health')).status).toBe(200);
      expect((await request(t.baseUrl).get('/api/agents')).body.data).toHaveLength(15);
    } finally {
      await t.close();
    }
  });

  it('the host guard still answers before the gate', async () => {
    const t = await createTestApp({ startReady: false });
    try {
      expect((await request(t.baseUrl).get('/api/health').set('Host', 'evil.example')).status).toBe(
        403,
      );
    } finally {
      await t.close();
    }
  });
});

describe('single instance (CR-2)', () => {
  it('a second instance on a busy port fails without touching the DB or the running demo', async () => {
    const dbPath = path.join(dir, 'shared', 'office.db');
    const a = await boot({ config: testConfig({ dbPath }), logger: captureLogger().logger });
    const urlA = `http://127.0.0.1:${a.port}`;
    try {
      await request(urlA).post('/api/demo/start').send({});
      for (let i = 0; i < 5; i += 1) a.server.services.demo.tick();
      const before = captureState(a.database);
      expect(before.demoSetting).not.toBeNull();

      const logsB = captureLogger();
      await expect(
        boot({ config: testConfig({ dbPath, port: a.port }), logger: logsB.logger }),
      ).rejects.toThrow(/EADDRINUSE/);
      expect(logsB.records.map((r) => r.msg)).not.toContain('demo_recovered');
      expect(logsB.records.map((r) => r.msg)).not.toContain('seed_applied');

      // A is untouched: same rows, same demo setting, demo still active and its stop still restores.
      expect(captureState(a.database)).toEqual(before);
      expect((await request(urlA).get('/api/demo')).body.data.active).toBe(true);
      const stop = await request(urlA).post('/api/demo/stop').send({});
      expect(stop.body.data.restored.agentsRestored).toBeGreaterThan(0);
    } finally {
      await a.shutdown('SIGTERM');
    }
  });

  it('listen happens before seeding: a failed boot leaves a new database unseeded', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    const dbPath = path.join(dir, 'unseeded', 'office.db');
    try {
      await expect(
        boot({ config: testConfig({ dbPath, port }), logger: captureLogger().logger }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    const db = openDatabase({ path: dbPath });
    try {
      expect(db.repos.agents.count()).toBe(0);
      expect(db.repos.events.count()).toBe(0);
    } finally {
      db.close();
    }
  });

  it('a normal boot ends ready, with the documented log order', async () => {
    const logs = captureLogger();
    const booted = await boot({
      config: testConfig({ dbPath: path.join(dir, 'order.db') }),
      logger: logs.logger,
    });
    try {
      expect(booted.server.isReady()).toBe(true);
      expect(logs.records.map((r) => r.msg)).toEqual([
        'migrations_applied',
        'seed_applied',
        'server_started',
      ]);
    } finally {
      await booted.shutdown('SIGTERM');
    }
  });
});
