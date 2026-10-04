import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogLevel } from './logger';

type Line = { line: string; level: string; record: Record<string, unknown> };

function capture(level: LogLevel) {
  const lines: Line[] = [];
  const logger = createLogger({
    level,
    write: (line, lineLevel) => {
      lines.push({ line, level: lineLevel, record: JSON.parse(line) as Record<string, unknown> });
    },
  });
  return { logger, lines };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger (ADR-018)', () => {
  it('writes one JSON line {time, level, msg, ...ctx} in that key order', () => {
    const { logger, lines } = capture('debug');
    logger.info('server_started', { host: '127.0.0.1', port: 4000 });
    expect(lines).toHaveLength(1);
    const [entry] = lines;
    expect(entry?.line).not.toContain('\n');
    expect(Object.keys(entry?.record ?? {})).toEqual(['time', 'level', 'msg', 'host', 'port']);
    expect(entry?.record).toMatchObject({
      level: 'info',
      msg: 'server_started',
      host: '127.0.0.1',
      port: 4000,
    });
    expect(entry?.record.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it.each([
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['info', ['info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['error', ['error']],
    ['silent', []],
  ] as const)('level %s writes %j', (level, expected) => {
    const { logger, lines } = capture(level);
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => l.level)).toEqual(expected);
    expect(logger.level).toBe(level);
  });

  it('child loggers merge context; call context wins; reserved keys cannot be overridden', () => {
    const { logger, lines } = capture('info');
    const child = logger.child({ service: 'demo', socketId: 'a' }).child({ socketId: 'b' });
    child.warn('demo_event_rejected', {
      code: 'ILLEGAL_TRANSITION',
      service: 'events',
      msg: 'hijack',
      level: 'debug',
    });
    expect(lines[0]?.record).toEqual({
      time: expect.any(String) as string,
      level: 'warn',
      msg: 'demo_event_rejected',
      service: 'events',
      socketId: 'b',
      code: 'ILLEGAL_TRANSITION',
    });
    expect(child.level).toBe('info');
  });

  it('serializes errors: stack only on error lines', () => {
    const { logger, lines } = capture('debug');
    const err = new Error('boom');
    logger.warn('request_failed', { err });
    logger.error('request_failed', { err });
    expect(lines[0]?.record.err).toEqual({ name: 'Error', message: 'boom' });
    expect(lines[1]?.record.err).toMatchObject({
      name: 'Error',
      message: 'boom',
      stack: expect.stringContaining('boom') as string,
    });
  });

  it('never throws on unserializable context or a failing sink', () => {
    const { logger, lines } = capture('info');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => logger.info('x', { circular, big: 10n })).not.toThrow();
    expect(lines[0]?.record).toMatchObject({
      msg: 'x',
      logContextError: 'context not serializable',
    });
    logger.info('y', { big: 10n });
    expect(lines[1]?.record.big).toBe('10');
    const broken = createLogger({
      level: 'info',
      write: () => {
        throw new Error('disk full');
      },
    });
    expect(() => broken.error('z')).not.toThrow();
  });

  it('drops undefined context values', () => {
    const { logger, lines } = capture('info');
    logger.info('x', { a: undefined, b: null });
    expect(lines[0]?.record).toEqual({
      time: expect.any(String) as string,
      level: 'info',
      msg: 'x',
      b: null,
    });
  });

  it('rejects an unknown level', () => {
    expect(() => createLogger({ level: 'verbose' as LogLevel })).toThrow(
      'Unknown log level: verbose',
    );
  });

  it('default sink: debug/info → stdout, warn/error → stderr, newline-terminated', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ level: 'debug' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    const outLines = out.mock.calls.map(([chunk]) => String(chunk));
    const errLines = err.mock.calls.map(([chunk]) => String(chunk));
    expect(outLines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual(['a', 'b']);
    expect(errLines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual(['c', 'd']);
    for (const line of [...outLines, ...errLines]) expect(line.endsWith('\n')).toBe(true);
  });

  it('silent writes nothing to the real streams', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ level: 'silent' });
    logger.error('x');
    logger.child({ a: 1 }).warn('y');
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
