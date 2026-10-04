import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Agent } from '@vo/shared';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { boot } from '../src/index';
import { captureLogger, createTestApp, testConfig } from './helpers/testApp';

const dir = mkdtempSync(path.join(tmpdir(), 'vo-boot-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BE = '04-backend-engineer';
const withoutVersion = (a: Agent) => ({ ...a, version: 0 });

describe('boot (API_CONTRACTS §9.8)', () => {
  it('opens + migrates + seeds a new file DB, listens, and shuts down gracefully', async () => {
    const logs = captureLogger();
    const dbPath = path.join(dir, 'first', 'office.db');
    const booted = await boot({ config: testConfig({ dbPath }), logger: logs.logger });
    const url = `http://127.0.0.1:${booted.port}`;
    try {
      const msgs = logs.records.map((r) => r.msg);
      expect(msgs).toEqual(['migrations_applied', 'seed_applied', 'server_started']);
      expect(logs.records[0]).toMatchObject({ from: 0, to: 1 });
      expect(logs.records[1]).toMatchObject({ agents: 15, tasks: 11 });
      expect(logs.records[2]).toMatchObject({
        host: '127.0.0.1',
        port: booted.port,
        dbPath,
        serveWeb: false,
      });
      expect((await request(url).get('/api/health')).body.data.status).toBe('ok');
      expect(
        (
          await request(url)
            .post('/api/events')
            .send({ type: 'system.info', message: 'persist me' })
        ).status,
      ).toBe(201);
    } finally {
      await booted.shutdown('SIGTERM');
    }
    expect(logs.records.slice(-2).map((r) => r.msg)).toEqual(['server_stopping', 'server_stopped']);
    expect(logs.records.at(-2)).toMatchObject({ signal: 'SIGTERM' });
    expect(booted.database.ping()).toBe(false);
    await booted.shutdown('SIGINT'); // idempotent

    // Restart on the same file: no reseed, no migration, data persisted.
    const again = captureLogger();
    const second = await boot({ config: testConfig({ dbPath }), logger: again.logger });
    try {
      expect(again.records.map((r) => r.msg)).toEqual(['server_started']);
      const res = await request(`http://127.0.0.1:${second.port}`).get(
        '/api/events?type=system.info&limit=5',
      );
      expect(res.body.data.map((e: { message: string }) => e.message)).toContain('persist me');
      expect(
        (await request(`http://127.0.0.1:${second.port}`).get('/api/agents')).body.data,
      ).toHaveLength(15);
      expect(second.database.repos.tasks.count()).toBe(11);
    } finally {
      await second.shutdown('SIGTERM');
    }
  });

  it('crash during demo → the next boot restores the snapshot and demo stays off (REQ-113)', async () => {
    const dbPath = path.join(dir, 'crash', 'office.db');
    const first = await boot({ config: testConfig({ dbPath }), logger: captureLogger().logger });
    const agentsBefore = first.database.repos.agents.list();
    const url = `http://127.0.0.1:${first.port}`;
    await request(url).post('/api/demo/start').send({});
    for (let i = 0; i < 8; i += 1) first.server.services.demo.tick();
    await request(url)
      .post('/api/events')
      .send({ type: 'agent.status.changed', agentId: BE, status: 'planning' });
    const beDuringDemo = first.database.repos.agents.getById(BE);
    expect(first.database.repos.tasks.list({ limit: 500 }).some((x) => x.id.includes('-D'))).toBe(
      true,
    );
    // Simulated crash: the timer dies, nothing is restored, the setting stays on disk.
    first.server.services.demo.dispose();
    await first.shutdown('crash');
    expect(first.database.ping()).toBe(false);

    const logs = captureLogger();
    const second = await boot({ config: testConfig({ dbPath }), logger: logs.logger });
    try {
      const recovered = logs.records.find((r) => r.msg === 'demo_recovered');
      expect(recovered).toMatchObject({
        level: 'info',
        agentsKept: 1,
        tasksDeleted: expect.any(Number) as number,
      });
      expect(logs.records.findIndex((r) => r.msg === 'demo_recovered')).toBeLessThan(
        logs.records.findIndex((r) => r.msg === 'server_started'),
      );
      const url2 = `http://127.0.0.1:${second.port}`;
      expect((await request(url2).get('/api/demo')).body.data.active).toBe(false);
      expect(second.database.repos.settings.get('demo')).toBeNull();
      // CR-9: the only demo task left is the one the kept (user-touched) Backend still points to.
      const leftover = second.database.repos.tasks
        .list({ limit: 500 })
        .filter((x) => x.id.includes('-D'));
      expect(leftover.map((x) => x.id)).toEqual(
        beDuringDemo?.taskId?.includes('-D') ? [beDuringDemo.taskId] : [],
      );
      expect(logs.records.some((r) => r.msg === 'demo_task_kept') === leftover.length > 0).toBe(
        true,
      );
      for (const agent of second.database.repos.agents.list()) {
        if (agent.id === BE) expect(agent).toEqual(beDuringDemo);
        else
          expect(withoutVersion(agent)).toEqual(
            withoutVersion(agentsBefore.find((a) => a.id === agent.id) as Agent),
          );
      }
    } finally {
      await second.shutdown('SIGTERM');
    }
  });

  it('a busy port fails the boot and closes the database', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    try {
      await expect(
        boot({
          config: testConfig({ dbPath: path.join(dir, 'busy.db'), port }),
          logger: captureLogger().logger,
        }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('warns about a non-loopback HOST (no auth) before listening', async () => {
    const logs = captureLogger();
    await expect(
      boot({
        config: testConfig({ dbPath: ':memory:', host: 'no-such-host.invalid' }),
        logger: logs.logger,
      }),
    ).rejects.toThrow();
    expect(logs.records[0]).toMatchObject({
      msg: 'non_loopback_host',
      level: 'warn',
      host: 'no-such-host.invalid',
    });
  });
});

describe('one-port mode: static web build (ADR-013)', () => {
  it('serves dist, falls back to index.html for SPA routes, keeps /api JSON', async () => {
    const dist = path.join(dir, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>AI Virtual Office</title>');
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1);');
    const t = await createTestApp({ config: { serveWeb: true, webDistPath: dist } });
    try {
      const root = await request(t.baseUrl).get('/');
      expect(root.status).toBe(200);
      expect(root.text).toContain('AI Virtual Office');
      const spa = await request(t.baseUrl).get('/agents/04-backend-engineer?project=sellway');
      expect(spa.status).toBe(200);
      expect(spa.headers['content-type']).toContain('text/html');
      const asset = await request(t.baseUrl).get('/assets/app.js');
      expect(asset.headers['content-type']).toContain('javascript');
      const api = await request(t.baseUrl).get('/api/missing');
      expect(api.status).toBe(404);
      expect(api.body.error.code).toBe('NOT_FOUND');
      expect((await request(t.baseUrl).get('/api/health')).status).toBe(200);
      expect((await request(t.baseUrl).get('/').set('Host', 'evil.example')).status).toBe(403);
    } finally {
      await t.close();
    }
  });

  it('a missing dist logs warn and serves the API only', async () => {
    const logs = captureLogger();
    const t = await createTestApp({
      logger: logs.logger,
      config: { serveWeb: true, webDistPath: path.join(dir, 'no-dist') },
    });
    try {
      expect(logs.records).toContainEqual(
        expect.objectContaining({ msg: 'web_dist_missing', level: 'warn' }),
      );
      expect((await request(t.baseUrl).get('/')).status).toBe(404);
      expect((await request(t.baseUrl).get('/api/health')).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});
