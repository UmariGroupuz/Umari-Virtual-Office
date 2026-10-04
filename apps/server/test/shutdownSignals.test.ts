// CR-8: graceful shutdown on SIGINT/SIGTERM/SIGHUP, SIGBREAK on Windows, and IPC disconnect; runs once.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdownHandlers } from '../src/index';
import { captureLogger } from './helpers/testApp';

function fakeProcess(connected?: boolean): EventEmitter & { connected?: boolean } {
  const proc = new EventEmitter() as EventEmitter & { connected?: boolean };
  if (connected !== undefined) proc.connected = connected;
  return proc;
}

function setup(options: { platform: NodeJS.Platform; connected?: boolean; fail?: boolean }) {
  const proc = fakeProcess(options.connected);
  const logs = captureLogger();
  const shutdown = vi.fn((_signal: string) =>
    options.fail === true ? Promise.reject(new Error('close failed')) : Promise.resolve(),
  );
  const exit = vi.fn<(code: number) => void>();
  const events = installShutdownHandlers(
    proc,
    { shutdown, logger: logs.logger },
    {
      exit,
      platform: options.platform,
      forceAfterMs: 60_000,
    },
  );
  return { proc, shutdown, exit, events, logs };
}

describe('installShutdownHandlers (CR-8)', () => {
  it('registers SIGINT, SIGTERM, SIGHUP and — on Windows — SIGBREAK', () => {
    expect(setup({ platform: 'win32' }).events).toEqual([
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
      'SIGBREAK',
    ]);
    expect(setup({ platform: 'linux' }).events).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
  });

  it('adds IPC disconnect when started with an IPC channel (e.g. node --watch)', () => {
    expect(setup({ platform: 'win32', connected: true }).events).toContain('disconnect');
    expect(setup({ platform: 'win32', connected: false }).events).not.toContain('disconnect');
  });

  it.each(['SIGHUP', 'SIGBREAK', 'SIGINT', 'SIGTERM', 'disconnect'])(
    '%s → one graceful shutdown, then exit 0',
    async (event) => {
      const { proc, shutdown, exit } = setup({ platform: 'win32', connected: true });
      proc.emit(event);
      proc.emit('SIGINT'); // a second signal while stopping is ignored
      proc.emit(event);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledWith(event);
    },
  );

  it('a failing shutdown logs shutdown_failed and exits 1', async () => {
    const { proc, exit, logs } = setup({ platform: 'linux', fail: true });
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logs.records).toContainEqual(
      expect.objectContaining({ msg: 'shutdown_failed', level: 'error' }),
    );
  });

  it('a hanging shutdown is forced after the timeout (exit 1)', () => {
    vi.useFakeTimers();
    try {
      const proc = fakeProcess();
      const exit = vi.fn<(code: number) => void>();
      const logs = captureLogger();
      installShutdownHandlers(
        proc,
        { shutdown: () => new Promise<void>(() => undefined), logger: logs.logger },
        { exit, platform: 'linux', forceAfterMs: 5000 },
      );
      proc.emit('SIGHUP');
      vi.advanceTimersByTime(5000);
      expect(exit).toHaveBeenCalledWith(1);
      expect(logs.records).toContainEqual(expect.objectContaining({ msg: 'shutdown_timeout' }));
    } finally {
      vi.useRealTimers();
    }
  });
});
