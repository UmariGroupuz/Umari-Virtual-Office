// Server configuration (API_CONTRACTS §11, ADR-013/019/027): parsed once at boot, fail fast with ConfigError.
import { existsSync, readFileSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { DEFAULT_SERVER_PORT, LIMITS } from '@vo/shared';
import { LOG_LEVELS, type LogLevel } from './logger';

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string; // ':memory:' or an absolute path
  logLevel: LogLevel;
  corsOrigins: string[];
  serveWeb: boolean;
  demoDefaultIntervalMs: number;
  repoRoot: string;
  webDistPath: string;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export const MEMORY_DB_PATH = ':memory:';
export const SERVE_WEB_FLAG = '--serve-web';

/** Repository root: three levels up from `apps/server/src/config.ts` (never the CWD). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

const DEFAULTS = {
  host: '127.0.0.1',
  logLevel: 'info' as LogLevel,
  corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  dbRelativePath: path.join('data', 'office.db'),
};

type Env = Record<string, string | undefined>;

/** Returns the trimmed value, or `undefined` when the variable is unset or blank. */
function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseInteger(name: string, raw: string, min: number, max: number): number {
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`Invalid ${name}: "${raw}" (expected an integer from ${min} to ${max})`);
  }
  return value;
}

function parseLogLevel(raw: string): LogLevel {
  const value = raw.toLowerCase();
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) {
    throw new ConfigError(`Invalid LOG_LEVEL: "${raw}" (expected one of ${LOG_LEVELS.join(', ')})`);
  }
  return level;
}

function parseBoolean(name: string, raw: string): boolean {
  const value = raw.toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ConfigError(`Invalid ${name}: "${raw}" (expected true or false)`);
}

function parseHost(raw: string): string {
  if (!/^[A-Za-z0-9.:[\]%-]+$/.test(raw)) {
    throw new ConfigError(`Invalid HOST: "${raw}" (expected a hostname or IP address)`);
  }
  return raw;
}

/** Comma-separated http(s) origins, normalized to `URL.origin` (no path, no trailing slash). */
function parseOrigins(raw: string): string[] {
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const candidate = part.trim();
    if (candidate === '') continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new ConfigError(
        `Invalid CORS_ORIGINS entry: "${candidate}" (expected an http(s) origin)`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ConfigError(
        `Invalid CORS_ORIGINS entry: "${candidate}" (expected an http(s) origin)`,
      );
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  if (origins.length === 0) {
    throw new ConfigError('Invalid CORS_ORIGINS: no origin given');
  }
  return origins;
}

/** `:memory:` is kept; relative paths resolve against the repo root (not the CWD). */
function resolveDbPath(raw: string | undefined, repoRoot: string): string {
  if (raw === undefined) return path.join(repoRoot, DEFAULTS.dbRelativePath);
  if (raw === MEMORY_DB_PATH) return MEMORY_DB_PATH;
  return path.resolve(repoRoot, raw);
}

/**
 * Reads a dotenv file with Node's own parser (the one behind `process.loadEnvFile`) without touching
 * `process.env`. Returns `null` when the file does not exist.
 */
export function readDotEnvFile(filePath: string): Record<string, string> | null {
  if (!existsSync(filePath)) return null;
  const parsed = parseEnv(readFileSync(filePath, 'utf8'));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Loads the server configuration.
 * - `env` defaults to `process.env`; `argv` to `process.argv.slice(2)` (`--serve-web` enables serveWeb).
 * - `loadDotEnv` (default: `true` only when `env` is not injected) merges `<repoRoot>/.env` under `env`:
 *   variables already present in the environment win over the file.
 */
export function loadConfig(
  options: {
    env?: Record<string, string | undefined>;
    argv?: readonly string[];
    loadDotEnv?: boolean;
  } = {},
): AppConfig {
  const repoRoot = REPO_ROOT;
  const baseEnv: Env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const loadDotEnv = options.loadDotEnv ?? options.env === undefined;

  let env: Env = baseEnv;
  if (loadDotEnv) {
    const fromFile = readDotEnvFile(path.join(repoRoot, '.env'));
    if (fromFile !== null) env = { ...fromFile, ...definedOnly(baseEnv) };
  }

  const portRaw = read(env, 'PORT');
  const hostRaw = read(env, 'HOST');
  const logLevelRaw = read(env, 'LOG_LEVEL');
  const corsRaw = read(env, 'CORS_ORIGINS');
  const serveWebRaw = read(env, 'SERVE_WEB');
  const demoRaw = read(env, 'DEMO_DEFAULT_INTERVAL_MS');

  return {
    port: portRaw === undefined ? DEFAULT_SERVER_PORT : parseInteger('PORT', portRaw, 1, 65_535),
    host: hostRaw === undefined ? DEFAULTS.host : parseHost(hostRaw),
    dbPath: resolveDbPath(read(env, 'DB_PATH'), repoRoot),
    logLevel: logLevelRaw === undefined ? DEFAULTS.logLevel : parseLogLevel(logLevelRaw),
    corsOrigins: corsRaw === undefined ? [...DEFAULTS.corsOrigins] : parseOrigins(corsRaw),
    serveWeb:
      argv.includes(SERVE_WEB_FLAG) ||
      (serveWebRaw === undefined ? false : parseBoolean('SERVE_WEB', serveWebRaw)),
    demoDefaultIntervalMs:
      demoRaw === undefined
        ? LIMITS.DEMO_INTERVAL_DEFAULT_MS
        : parseInteger(
            'DEMO_DEFAULT_INTERVAL_MS',
            demoRaw,
            LIMITS.DEMO_INTERVAL_MIN_MS,
            LIMITS.DEMO_INTERVAL_MAX_MS,
          ),
    repoRoot,
    webDistPath: path.join(repoRoot, 'apps', 'web', 'dist'),
  };
}

function definedOnly(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * True for loopback hosts: `localhost`, `127.0.0.0/8`, `::1` (also bracketed or written out) and
 * IPv4-mapped `::ffff:127.x.x.x`. `0.0.0.0`/`::` (all interfaces) are not loopback.
 */
export function isLoopbackHost(host: string): boolean {
  let value = host.trim().toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value === 'localhost') return true;
  if (isIPv4(value)) return value.startsWith('127.');
  if (!isIPv6(value)) return false;
  let canonical: string;
  try {
    canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    return false; // e.g. zone ids (`fe80::1%eth0`) are not loopback
  }
  return canonical === '::1' || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(canonical);
}
