// CR-1 / ADR-035 §1: the Socket.IO handshake and the WebSocket upgrade enforce the browser Origin rule.
import type { ClientToServerEvents, ServerToClientEvents } from '@vo/shared';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAllowedOrigin, socketRejection } from '../src/realtime/socketServer';
import { captureLogger, createTestApp, type TestApp } from './helpers/testApp';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let t: TestApp;
let logs: ReturnType<typeof captureLogger>;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  logs = captureLogger();
  t = await createTestApp({ logger: logs.logger });
});
afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await t.close();
});

/** Resolves 'connected' or the connect_error message. */
function attempt(
  origin: string | undefined,
  transports: ('websocket' | 'polling')[],
): Promise<string> {
  const socket: ClientSocket = connect(t.baseUrl, {
    path: '/socket.io',
    transports,
    reconnection: false,
    forceNew: true,
    ...(origin === undefined ? {} : { extraHeaders: { Origin: origin } }),
  });
  clients.push(socket);
  return new Promise((resolve) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', (error) => resolve(`error: ${error.message}`));
  });
}

describe('Socket.IO Origin rule (CR-1)', () => {
  it.each([['websocket'], ['polling']] as const)(
    'a foreign Origin is rejected (%s only)',
    async (transport) => {
      expect(await attempt('http://evil.example', [transport])).toMatch(/^error/);
      expect(logs.records).toContainEqual(
        expect.objectContaining({
          msg: 'socket_rejected',
          level: 'warn',
          reason: 'origin',
          origin: 'http://evil.example',
        }),
      );
      expect(logs.records.some((r) => r.msg === 'socket_connected')).toBe(false);
    },
  );

  it('a rejected client receives no office:event', async () => {
    const socket: ClientSocket = connect(t.baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Origin: 'https://attacker.test' },
    });
    clients.push(socket);
    const received: unknown[] = [];
    socket.on('office:event', (payload) => received.push(payload));
    await new Promise<void>((resolve) => socket.once('connect_error', () => resolve()));
    await request(t.baseUrl).post('/api/events').send({ type: 'system.info', message: 'private' });
    expect(received).toEqual([]);
  });

  it.each([
    ['absent (non-browser client)', undefined],
    ['allowed CORS origin', 'http://localhost:5173'],
    ['the other allowed CORS origin', 'http://127.0.0.1:5173'],
  ])('%s connects over websocket and polling', async (_name, origin) => {
    expect(await attempt(origin, ['websocket'])).toBe('connected');
    expect(await attempt(origin, ['polling'])).toBe('connected');
  });

  it('same-origin one-port mode (Origin = http://<Host>) connects', async () => {
    expect(await attempt(`http://127.0.0.1:${t.port}`, ['websocket'])).toBe('connected');
  });

  it.each([
    'null',
    'file://',
    'http://localhost:5174',
    'http://127.0.0.1:9999',
    'ftp://localhost:5173',
  ])('Origin %s is rejected', async (origin) => {
    expect(await attempt(origin, ['websocket'])).toMatch(/^error/);
  });

  it('the polling handshake answers 403 for a foreign Origin', async () => {
    const res = await request(t.baseUrl)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', 'http://evil.example');
    expect(res.status).toBe(403);
    const ok = await request(t.baseUrl)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', 'http://localhost:5173');
    expect(ok.status).toBe(200);
  });
});

describe('isAllowedOrigin / socketRejection', () => {
  const config = { host: '127.0.0.1', corsOrigins: ['http://localhost:5173'] };

  it.each([
    ['http://localhost:5173', '127.0.0.1:4000', true],
    ['http://LOCALHOST:5173', '127.0.0.1:4000', true],
    ['http://127.0.0.1:4000', '127.0.0.1:4000', true],
    ['https://127.0.0.1:4000', '127.0.0.1:4000', true],
    ['http://localhost:4000', 'LocalHost:4000', true],
    ['http://evil.example', 'evil.example', true], // same-origin by itself; the Host guard rejects it first
    ['http://evil.example', '127.0.0.1:4000', false],
    ['null', '127.0.0.1:4000', false],
    ['not a url', '127.0.0.1:4000', false],
  ])('%s with Host %s → %s', (origin, host, expected) => {
    expect(isAllowedOrigin(origin, host, config.corsOrigins)).toBe(expected);
  });

  it('checks Host first, then Origin, then readiness', () => {
    expect(
      socketRejection({ host: 'evil.example', origin: 'http://evil.example' }, config, true),
    ).toBe('host');
    expect(
      socketRejection({ host: '127.0.0.1:4000', origin: 'http://evil.example' }, config, true),
    ).toBe('origin');
    expect(
      socketRejection({ host: '127.0.0.1:4000', origin: 'http://localhost:5173' }, config, false),
    ).toBe('starting');
    expect(socketRejection({ host: '127.0.0.1:4000' }, config, true)).toBeNull();
  });
});
