// Minimal structured logger (ADR-018, API_CONTRACTS §9.3): one JSON line `{time, level, msg, ...ctx}` per
// call; `warn`/`error` → stderr, `debug`/`info` → stdout. `msg` is a stable snake_case key. Never throws.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type WriteLevel = Exclude<LogLevel, 'silent'>;

export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

export const LOG_LEVELS: readonly LogLevel[] = Object.freeze([
  'debug',
  'info',
  'warn',
  'error',
  'silent',
]);

const RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
});

/** Keys owned by the logger; a context value with one of these names is dropped. */
const RESERVED_KEYS = new Set(['time', 'level', 'msg']);

/** Default sink: one line + `\n`; warn/error to stderr, everything else to stdout. */
function defaultWrite(line: string, level: WriteLevel): void {
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/** Errors become `{name, message}`; the stack is included only on `error` lines (ADR-018). */
function replacerFor(level: WriteLevel) {
  return (_key: string, value: unknown): unknown => {
    if (value instanceof Error) {
      return level === 'error'
        ? { name: value.name, message: value.message, stack: value.stack }
        : { name: value.name, message: value.message };
    }
    if (typeof value === 'bigint') return value.toString();
    return value;
  };
}

function formatLine(level: WriteLevel, msg: string, ctx: Record<string, unknown>): string {
  const time = new Date().toISOString();
  const record: Record<string, unknown> = { time, level, msg };
  for (const [key, value] of Object.entries(ctx)) {
    if (!RESERVED_KEYS.has(key) && value !== undefined) record[key] = value;
  }
  try {
    return JSON.stringify(record, replacerFor(level));
  } catch {
    // Circular or otherwise unserializable context: keep the line, drop the context.
    return JSON.stringify({ time, level, msg, logContextError: 'context not serializable' });
  }
}

function build(
  level: LogLevel,
  write: (line: string, level: WriteLevel) => void,
  base: Record<string, unknown>,
): Logger {
  const threshold = RANK[level];
  const log = (lineLevel: WriteLevel, msg: string, ctx?: Record<string, unknown>): void => {
    if (RANK[lineLevel] < threshold) return;
    try {
      write(formatLine(lineLevel, msg, { ...base, ...ctx }), lineLevel);
    } catch {
      // A broken sink must never take the server down.
    }
  };
  return {
    level,
    debug: (msg, ctx) => log('debug', msg, ctx),
    info: (msg, ctx) => log('info', msg, ctx),
    warn: (msg, ctx) => log('warn', msg, ctx),
    error: (msg, ctx) => log('error', msg, ctx),
    child: (ctx) => build(level, write, { ...base, ...ctx }),
  };
}

/**
 * Creates a logger. `write` receives the JSON line without a trailing newline (default: stdout/stderr).
 * A child's context is merged under the call context (call keys win).
 */
export function createLogger(options: {
  level: LogLevel;
  write?: (line: string, level: Exclude<LogLevel, 'silent'>) => void;
}): Logger {
  if (!LOG_LEVELS.includes(options.level)) {
    throw new TypeError(`Unknown log level: ${String(options.level)}`);
  }
  return build(options.level, options.write ?? defaultWrite, {});
}
