import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, REPO_ROOT, isLoopbackHost, loadConfig, readDotEnvFile } from './config';

const EXPECTED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function load(env: Record<string, string | undefined> = {}, argv: readonly string[] = []) {
  return loadConfig({ env, argv, loadDotEnv: false });
}

describe('loadConfig defaults (API_CONTRACTS §11)', () => {
  it('uses the documented defaults with an empty environment', () => {
    expect(load()).toEqual({
      port: 4000,
      host: '127.0.0.1',
      dbPath: path.join(EXPECTED_ROOT, 'data', 'office.db'),
      logLevel: 'info',
      corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      serveWeb: false,
      demoDefaultIntervalMs: 3000,
      repoRoot: EXPECTED_ROOT,
      webDistPath: path.join(EXPECTED_ROOT, 'apps', 'web', 'dist'),
    });
  });

  it('repoRoot is three levels above apps/server/src (independent of the CWD)', () => {
    expect(REPO_ROOT).toBe(EXPECTED_ROOT);
    expect(path.basename(path.join(REPO_ROOT, 'apps', 'server'))).toBe('server');
  });

  it('blank values count as unset', () => {
    expect(
      load({ PORT: '  ', HOST: '', LOG_LEVEL: ' ', CORS_ORIGINS: '', SERVE_WEB: '', DB_PATH: '' }),
    ).toEqual(load());
  });
});

describe('loadConfig values', () => {
  it('parses every variable', () => {
    const config = load({
      PORT: '4100',
      HOST: '0.0.0.0',
      DB_PATH: ':memory:',
      LOG_LEVEL: 'DEBUG',
      CORS_ORIGINS: ' http://localhost:3000/ , https://example.test ,, http://localhost:3000 ',
      SERVE_WEB: 'TRUE',
      DEMO_DEFAULT_INTERVAL_MS: '2000',
    });
    expect(config).toMatchObject({
      port: 4100,
      host: '0.0.0.0',
      dbPath: ':memory:',
      logLevel: 'debug',
      corsOrigins: ['http://localhost:3000', 'https://example.test'],
      serveWeb: true,
      demoDefaultIntervalMs: 2000,
    });
  });

  it('resolves a relative DB_PATH against the repo root, keeps absolute paths', () => {
    expect(load({ DB_PATH: 'data/test.db' }).dbPath).toBe(
      path.join(EXPECTED_ROOT, 'data', 'test.db'),
    );
    expect(load({ DB_PATH: './tmp/../data/x.db' }).dbPath).toBe(
      path.join(EXPECTED_ROOT, 'data', 'x.db'),
    );
    const absolute = path.join(tmpdir(), 'vo', 'office.db');
    expect(load({ DB_PATH: absolute }).dbPath).toBe(absolute);
  });

  it('--serve-web enables serving the web build regardless of SERVE_WEB', () => {
    expect(load({}, ['--serve-web']).serveWeb).toBe(true);
    expect(load({ SERVE_WEB: 'false' }, ['--serve-web']).serveWeb).toBe(true);
    expect(load({ SERVE_WEB: 'false' }).serveWeb).toBe(false);
    expect(load({}, ['--other']).serveWeb).toBe(false);
  });

  it('accepts the range boundaries', () => {
    expect(load({ PORT: '1' }).port).toBe(1);
    expect(load({ PORT: '65535' }).port).toBe(65535);
    expect(load({ DEMO_DEFAULT_INTERVAL_MS: '10000' }).demoDefaultIntervalMs).toBe(10000);
  });
});

describe('loadConfig errors (fail fast)', () => {
  it.each([
    [{ PORT: '0' }, 'Invalid PORT: "0" (expected an integer from 1 to 65535)'],
    [{ PORT: '65536' }, 'Invalid PORT'],
    [{ PORT: '40.5' }, 'Invalid PORT'],
    [{ PORT: '-1' }, 'Invalid PORT'],
    [{ PORT: 'abc' }, 'Invalid PORT'],
    [{ PORT: '1e3' }, 'Invalid PORT'],
    [{ LOG_LEVEL: 'verbose' }, 'Invalid LOG_LEVEL: "verbose"'],
    [{ SERVE_WEB: 'yes' }, 'Invalid SERVE_WEB: "yes" (expected true or false)'],
    [
      { DEMO_DEFAULT_INTERVAL_MS: '1999' },
      'Invalid DEMO_DEFAULT_INTERVAL_MS: "1999" (expected an integer from 2000 to 10000)',
    ],
    [{ DEMO_DEFAULT_INTERVAL_MS: '10001' }, 'Invalid DEMO_DEFAULT_INTERVAL_MS'],
    [{ CORS_ORIGINS: 'not a url' }, 'Invalid CORS_ORIGINS entry: "not a url"'],
    [{ CORS_ORIGINS: 'ftp://localhost' }, 'Invalid CORS_ORIGINS entry: "ftp://localhost"'],
    [{ CORS_ORIGINS: ' , ' }, 'Invalid CORS_ORIGINS: no origin given'],
    [{ HOST: 'local host' }, 'Invalid HOST: "local host"'],
    [{ HOST: 'http://x' }, 'Invalid HOST'],
  ])('%j → ConfigError', (env, message) => {
    expect(() => load(env)).toThrow(ConfigError);
    expect(() => load(env)).toThrow(message);
  });

  it('ConfigError is an Error named ConfigError', () => {
    const error = new ConfigError('x');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigError');
  });
});

describe('.env handling', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vo-config-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('readDotEnvFile parses with Node’s dotenv parser and returns null for a missing file', () => {
    const file = path.join(dir, '.env');
    writeFileSync(file, '# comment\nPORT=4200\nHOST="localhost"\nEMPTY=\n');
    expect(readDotEnvFile(file)).toEqual({ PORT: '4200', HOST: 'localhost', EMPTY: '' });
    expect(readDotEnvFile(path.join(dir, 'missing.env'))).toBeNull();
  });

  it('an injected env does not load the repo .env by default', () => {
    // loadDotEnv defaults to false when `env` is given, so the result only depends on `env`.
    expect(loadConfig({ env: { PORT: '4300' }, argv: [] }).port).toBe(4300);
  });

  it('with loadDotEnv the environment wins over the file (no repo .env → defaults)', () => {
    const config = loadConfig({ env: { PORT: '4400' }, argv: [], loadDotEnv: true });
    expect(config.port).toBe(4400);
  });
});

describe('isLoopbackHost', () => {
  it.each([
    ['localhost', true],
    ['LOCALHOST', true],
    [' localhost ', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['::1', true],
    ['[::1]', true],
    ['0:0:0:0:0:0:0:1', true],
    ['::ffff:127.0.0.1', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['10.0.0.1', false],
    ['::ffff:192.168.1.1', false],
    ['fe80::1%eth0', false],
    ['example.com', false],
    ['localhost.example.com', false],
    ['', false],
  ])('%s → %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
