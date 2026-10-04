import type { OfficeEventPayload, ServerToClientEvents, ClientToServerEvents } from '@vo/shared';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogger, createTestApp, type TestApp } from './helpers/testApp';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const BE = '04-backend-engineer';

let t: TestApp;
let logs: ReturnType<typeof captureLogger>;
const clients: ClientSocket[] = [];

async function connectClient(): Promise<ClientSocket> {
  const socket: ClientSocket = connect(t.baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function nextOfficeEvent(socket: ClientSocket): Promise<OfficeEventPayload> {
  return new Promise((resolve) => socket.once('office:event', resolve));
}

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await t.close();
});

describe('Socket.IO real-time delivery (API_CONTRACTS §4, REQ-050)', () => {
  it('POST /api/events → the client receives office:event equal to the response data', async () => {
    const client = await connectClient();
    const received = nextOfficeEvent(client);
    const res = await request(t.baseUrl).post('/api/events').send({
      type: 'agent.activity',
      agentId: BE,
      project: 'Sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'run_command',
      message: 'Running backend tests',
    });
    expect(res.status).toBe(201);
    const payload = await received;
    expect(payload).toEqual(res.body.data);
    expect(payload.agent).toMatchObject({ id: BE, status: 'working' });
    expect(payload.event.type).toBe('agent.activity');
  });

  it('nothing is sent for a rejection or a no-op: the next message is the next accepted write', async () => {
    const client = await connectClient();
    const seen: OfficeEventPayload[] = [];
    client.on('office:event', (payload) => seen.push(payload));
    expect(
      (
        await request(t.baseUrl)
          .post('/api/events')
          .send({ type: 'agent.status.changed', agentId: BE, status: 'completed' })
      ).status,
    ).toBe(409);
    expect(
      (await request(t.baseUrl).patch(`/api/agents/${BE}/status`).send({ status: 'idle' })).body
        .data.event,
    ).toBeNull();
    expect(
      (await request(t.baseUrl).patch('/api/tasks/SW-123').send({ title: 'Lost Goods API' })).body
        .data.event,
    ).toBeNull();
    const marker = nextOfficeEvent(client);
    const ok = await request(t.baseUrl)
      .post('/api/events')
      .send({ type: 'system.info', message: 'marker' });
    await marker;
    expect(seen).toEqual([ok.body.data]);
  });

  it('two clients both receive every broadcast (tasks API included)', async () => {
    const a = await connectClient();
    const b = await connectClient();
    const both = Promise.all([nextOfficeEvent(a), nextOfficeEvent(b)]);
    const res = await request(t.baseUrl)
      .post('/api/tasks')
      .send({ title: 'Socket task', project: 'erp' });
    const [pa, pb] = await both;
    expect(pa).toEqual(res.body.data);
    expect(pb).toEqual(res.body.data);
  });

  it('client-emitted messages are ignored (no handlers) and logged at debug', async () => {
    const client = await connectClient();
    const before = t.database.repos.events.count();
    (client as unknown as { emit(name: string, payload: unknown): void }).emit('office:event', {
      event: { type: 'agent.status.changed' },
    });
    (client as unknown as { emit(name: string, payload: unknown): void }).emit('agent:hack', {
      status: 'offline',
    });
    // A broadcast after the emits proves the server has processed them (in-order on one connection).
    const marker = nextOfficeEvent(client);
    await request(t.baseUrl).post('/api/events').send({ type: 'system.info', message: 'marker' });
    await marker;
    expect(t.database.repos.events.count()).toBe(before + 1);
    expect(t.database.repos.agents.getById(BE)?.status).toBe('idle');
    const ignored = logs.records
      .filter((r) => r.msg === 'socket_message_ignored')
      .map((r) => r.event);
    expect(ignored).toEqual(['office:event', 'agent:hack']);
  });

  it('connect / disconnect are logged at info with the client count', async () => {
    const client = await connectClient();
    expect(logs.records).toContainEqual(
      expect.objectContaining({
        msg: 'socket_connected',
        level: 'info',
        socketId: client.id,
        clients: 1,
      }),
    );
    const id = client.id;
    client.disconnect();
    await expect
      .poll(() => logs.records.some((r) => r.msg === 'socket_disconnected' && r.socketId === id))
      .toBe(true);
    expect(logs.records.find((r) => r.msg === 'socket_disconnected')).toMatchObject({
      clients: 0,
      level: 'info',
    });
  });

  it('the handshake is host-guarded (ADR-027)', async () => {
    const bad = await request(t.baseUrl)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Host', 'evil.example');
    expect(bad.status).toBe(403);
    const good = await request(t.baseUrl)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Host', 'localhost:5173');
    expect(good.status).toBe(200);
  });

  it('a demo start sends office:event then demo:state; a stop ends with office:resync', async () => {
    const client = await connectClient();
    const order: string[] = [];
    client.on('office:event', (p) => order.push(`office:event:${p.event.message ?? ''}`));
    client.on('demo:state', (s) => order.push(`demo:state:${String(s.active)}`));
    const resync = new Promise<void>((resolve) => {
      client.on('office:resync', (p) => {
        order.push(`office:resync:${p.reason}`);
        resolve();
      });
    });
    await request(t.baseUrl).post('/api/demo/start').send({});
    await request(t.baseUrl).post('/api/demo/stop').send({});
    await resync;
    expect(order).toEqual([
      'office:event:Demo mode started',
      'demo:state:true',
      'office:event:Demo mode stopped: 0 agents and 0 tasks restored, 0 demo tasks removed',
      'demo:state:false',
      'office:resync:demo-restored',
    ]);
  });
});
