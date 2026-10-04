#!/usr/bin/env node
// Live smoke test (TASK-009, REQ-053/190): builds the web app if needed, starts the real server in one-port
// mode (`--serve-web`) on a free port with a temporary database, checks HTTP + Socket.IO + static serving,
// stops it gracefully, restarts it on the same database and checks persistence (no duplicate seed), then
// removes the temporary directory. Never touches data/office.db. Exits non-zero on any failure.
//
//   npm run smoke            one-port mode + restart check
//   npm run smoke -- --dev   additionally runs `npm run dev`'s launcher (ports 4000/5173 must be free) and checks
//                            the Vite proxy, the socket through the proxy and the Vite security settings.
//                            If 4000/5173 are busy it reports one FAIL naming the holder and skips these checks;
//                            if the launcher exits before the stack is healthy it fails fast (CR-18).
//
// Windows-safe: no shell for the server, env passed via spawn options, graceful stop through the IPC channel
// (the server shuts down on `disconnect`), force-kill only of the processes this script started.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const IS_WIN = process.platform === 'win32';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = join(REPO_ROOT, 'apps/server');
const WEB_INDEX = join(REPO_ROOT, 'apps/web/dist/index.html');
const RUN_DEV = process.argv.includes('--dev');
const FOREIGN_ORIGIN = 'http://localhost:5174';

/** §12 example of the original request (REQ-022). */
const EXAMPLE_EVENT = {
  type: 'agent.activity',
  agentId: '04-backend-engineer',
  project: 'Sellway',
  taskId: 'SW-123',
  status: 'working',
  action: 'run_command',
  message: 'Running backend tests',
  metadata: { command: 'npm test' },
};

const results = [];
const started = new Set(); // child processes started by this script (for the final safety cleanup)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function http(method, url, { body, headers = {}, timeoutMs = 10_000 } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

async function waitFor(check, timeoutMs, intervalMs = 250) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (await check()) return true;
    } catch {
      /* not yet */
    }
    await sleep(intervalMs);
  }
  return false;
}

/** Spawn a node process with an IPC channel; collects output lines. */
function spawnNode(args, { cwd, env, label }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  started.add(child);
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? '';
      for (const line of parts) {
        lines.push(line);
        if (process.env.SMOKE_VERBOSE) console.log(`    [${label}] ${line}`);
      }
    });
  }
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  return { child, lines, exited };
}

/** Graceful stop through IPC disconnect; force-kill after the timeout. */
async function stopGracefully(proc, timeoutMs = 10_000) {
  if (proc.child.exitCode !== null) return { graceful: false, code: proc.child.exitCode };
  if (proc.child.connected) proc.child.disconnect();
  const outcome = await Promise.race([proc.exited, sleep(timeoutMs).then(() => null)]);
  if (outcome === null) {
    killTree(proc.child.pid);
    await proc.exited;
    return { graceful: false, code: null };
  }
  return { graceful: true, code: outcome.code };
}

/** True when something accepts TCP connections on the port (IPv4 or IPv6 loopback). */
async function isPortInUse(port) {
  const tryConnect = (host) =>
    new Promise((res) => {
      const socket = connect({ host, port });
      const done = (inUse) => {
        socket.destroy();
        res(inUse);
      };
      socket.setTimeout(700, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  return (await Promise.all([tryConnect('127.0.0.1'), tryConnect('::1')])).some(Boolean);
}

/** "port N held by PID P (image): command line" for each listener (read-only; never kills anything). */
function describePortHolders(ports) {
  if (IS_WIN) {
    const script = [
      `foreach ($p in @(${ports.join(',')})) {`,
      '  Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |',
      '    Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {',
      '      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue',
      '      "port $p held by PID $_ ($($proc.Name)): $($proc.CommandLine)"',
      '    }',
      '}',
    ].join('\n');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const lines = (r.stdout ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.length > 0 ? lines : ['holder unknown (see `netstat -ano`)'];
  }
  const lines = ports.flatMap((port) =>
    (spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '')
      .split('\n')
      .filter((l) => l.trim() !== ''),
  );
  return lines.length > 0 ? lines : ['holder unknown (see `lsof -iTCP -sTCP:LISTEN`)'];
}

function connectSocket(baseUrl, extraHeaders) {
  return io(baseUrl, {
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    reconnection: false,
    timeout: 5000,
    forceNew: true,
    ...(extraHeaders ? { extraHeaders } : {}),
  });
}

function waitForSocketConnect(socket, timeoutMs = 8000) {
  return new Promise((res) => {
    const timer = setTimeout(() => res({ ok: false, error: 'timeout' }), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      res({ ok: true });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      res({ ok: false, error: error.message });
    });
  });
}

async function countAll(base, path) {
  const r = await http('GET', `${base}${path}${path.includes('?') ? '&' : '?'}limit=500`);
  return Array.isArray(r.json?.data) ? r.json.data.length : -1;
}

// -------------------------------------------------------------------------------------------------------

async function ensureBuild() {
  console.log('\n[1] Web build');
  if (existsSync(WEB_INDEX) && !process.argv.includes('--build')) {
    record('apps/web/dist exists (pass --build to rebuild)', true);
    return true;
  }
  const r = spawnSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit', shell: true });
  return record('npm run build', r.status === 0, `exit ${r.status}`);
}

async function oneportRun({ base, port, env, firstRun, state }) {
  const label = firstRun ? 'boot 1' : 'boot 2';
  console.log(`\n[${firstRun ? 2 : 3}] One-port server (${label}) on ${base}`);
  const proc = spawnNode(
    ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts', '--serve-web'],
    { cwd: SERVER_DIR, env: { ...env, PORT: String(port) }, label },
  );
  try {
    const healthy = await waitFor(async () => {
      const r = await http('GET', `${base}/api/health`, { timeoutMs: 2000 });
      return r.status === 200 && r.json?.data?.status === 'ok';
    }, 40_000);
    if (!record(`${label}: GET /api/health → 200 status ok`, healthy)) {
      console.log(proc.lines.slice(-15).join('\n'));
      return false;
    }

    const agents = await http('GET', `${base}/api/agents`);
    record(
      `${label}: GET /api/agents → 15 agents`,
      agents.status === 200 && agents.json?.data?.length === 15,
      `${agents.status}, ${agents.json?.data?.length}`,
    );

    if (firstRun) {
      // Static web app + SPA fallback + API 404 + SEC-5 headers.
      const home = await http('GET', `${base}/`);
      record(
        'GET / serves index.html',
        home.status === 200 &&
          /<title>AI Virtual Office<\/title>/.test(home.text) &&
          (home.headers.get('content-type') ?? '').includes('text/html'),
        `${home.status} ${home.headers.get('content-type')}`,
      );
      record(
        'GET / has X-Frame-Options: DENY (SEC-5)',
        home.headers.get('x-frame-options') === 'DENY',
        `${home.headers.get('x-frame-options')}`,
      );
      record(
        "GET / has CSP frame-ancestors 'none' (SEC-5)",
        /frame-ancestors 'none'/.test(home.headers.get('content-security-policy') ?? ''),
        `${home.headers.get('content-security-policy')}`,
      );
      const asset = home.text.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
      const assetRes = asset
        ? await http('GET', `${base}${asset}`)
        : { status: 0, headers: new Headers() };
      record(
        'GET built JS asset',
        assetRes.status === 200 && /javascript/.test(assetRes.headers.get('content-type') ?? ''),
        `${asset} ${assetRes.status}`,
      );
      const spa = await http('GET', `${base}/some/client/route?agent=x`);
      record(
        'SPA fallback for non-API GET',
        spa.status === 200 && /<div id="root">/.test(spa.text),
        `${spa.status}`,
      );
      const api404 = await http('GET', `${base}/api/does-not-exist`);
      record(
        'unknown /api path → JSON 404 NOT_FOUND',
        api404.status === 404 && api404.json?.error?.code === 'NOT_FOUND',
        `${api404.status} ${api404.json?.error?.code}`,
      );

      // Socket + §12 example event.
      const socket = connectSocket(base);
      const connected = await waitForSocketConnect(socket);
      record('Socket.IO client connects (no Origin header)', connected.ok, connected.error ?? '');
      const received = new Promise((res) => {
        const timer = setTimeout(() => res(null), 5000);
        socket.on('office:event', (payload) => {
          if (payload?.event?.agentId === EXAMPLE_EVENT.agentId) {
            clearTimeout(timer);
            res(payload);
          }
        });
      });
      const post = await http('POST', `${base}/api/events`, { body: EXAMPLE_EVENT });
      const data = post.json?.data;
      record(
        'POST /api/events (§12 example) → 201',
        post.status === 201,
        `${post.status} ${post.json?.error?.code ?? ''}`,
      );
      record(
        'response: agent working on SW-123 / Sellway',
        data?.agent?.status === 'working' &&
          data?.agent?.taskId === 'SW-123' &&
          data?.event?.project === 'sellway',
        `${data?.agent?.status} ${data?.agent?.taskId} ${data?.event?.project}`,
      );
      const payload = await received;
      record(
        'socket receives the matching office:event',
        payload?.event?.id !== undefined && payload.event.id === data?.event?.id,
        payload ? `event ${payload.event.id}` : 'nothing within 5 s',
      );
      socket.close();
      state.eventId = data?.event?.id;

      // Origin rules (ADR-035 socket, ADR-037 SEC-2 HTTP writes).
      const foreign = connectSocket(base, { Origin: FOREIGN_ORIGIN });
      const refused = await waitForSocketConnect(foreign);
      foreign.close();
      record(
        `socket with Origin ${FOREIGN_ORIGIN} is refused`,
        !refused.ok,
        refused.error ?? 'connected!',
      );
      const foreignWrite = await http('PATCH', `${base}/api/agents/04-backend-engineer/status`, {
        body: { status: 'planning', source: 'smoke' },
        headers: { Origin: FOREIGN_ORIGIN },
      });
      record(
        `PATCH with Origin ${FOREIGN_ORIGIN} → 403 ORIGIN_NOT_ALLOWED (SEC-2)`,
        foreignWrite.status === 403 && foreignWrite.json?.error?.code === 'ORIGIN_NOT_ALLOWED',
        `${foreignWrite.status} ${foreignWrite.json?.error?.code ?? ''}`,
      );

      state.events = await countAll(base, '/api/events');
      state.tasks = await countAll(base, '/api/tasks');
      record(
        'counts recorded before restart',
        state.events > 0 && state.tasks > 0,
        `events ${state.events}, tasks ${state.tasks}`,
      );
    } else {
      const be = await http('GET', `${base}/api/agents/04-backend-engineer`);
      record(
        'persisted: backend engineer still working on SW-123',
        be.json?.data?.status === 'working' && be.json?.data?.taskId === 'SW-123',
        `${be.json?.data?.status} ${be.json?.data?.taskId}`,
      );
      const events = await countAll(base, '/api/events');
      const tasks = await countAll(base, '/api/tasks');
      record(
        'no duplicate seed: event and task counts unchanged',
        events === state.events && tasks === state.tasks,
        `events ${events}/${state.events}, tasks ${tasks}/${state.tasks}`,
      );
      const list = await http('GET', `${base}/api/events?agentId=04-backend-engineer&limit=500`);
      record(
        'the §12 event is still stored',
        Boolean(list.json?.data?.some((e) => e.id === state.eventId)),
        `${state.eventId}`,
      );
      record('second boot did not seed', !proc.lines.some((l) => l.includes('"seed_applied"')));
    }
  } finally {
    const stop = await stopGracefully(proc);
    record(
      `${label}: graceful stop (IPC disconnect) → exit 0 with server_stopped`,
      stop.graceful && stop.code === 0 && proc.lines.some((l) => l.includes('"server_stopped"')),
      `graceful=${stop.graceful} code=${stop.code}`,
    );
    const free = await waitFor(async () => {
      try {
        await http('GET', `${base}/api/health`, { timeoutMs: 1000 });
        return false;
      } catch {
        return true;
      }
    }, 5000);
    record(`${label}: port ${port} released`, free);
  }
  return true;
}

async function devRun(env) {
  console.log('\n[4] Dev mode: scripts/dev.mjs (server :4000 + Vite :5173)');
  // CR-18: never run the dev checks against someone else's stack — the ports must be free before we start.
  const busy = [];
  for (const port of [4000, 5173]) if (await isPortInUse(port)) busy.push(port);
  if (busy.length > 0) {
    record(
      `dev ports free before start (${busy.join(', ')} busy — dev checks skipped)`,
      false,
      describePortHolders(busy).join(' | '),
    );
    return;
  }
  const proc = spawnNode([join(REPO_ROOT, 'scripts/dev.mjs')], {
    cwd: REPO_ROOT,
    env,
    label: 'dev',
  });
  const web = 'http://localhost:5173';
  try {
    // Fail fast when the launcher exits before the stack is healthy (e.g. its own port preflight).
    const launcherGone = () => proc.child.exitCode !== null || proc.child.signalCode !== null;
    const up = await waitFor(async () => {
      if (launcherGone()) return true;
      const r = await http('GET', `${web}/api/health`, { timeoutMs: 2000 });
      return r.status === 200 && r.json?.data?.status === 'ok';
    }, 60_000);
    if (launcherGone()) {
      record(
        'dev launcher stays running until healthy',
        false,
        `exited with code ${proc.child.exitCode}`,
      );
      console.log(proc.lines.slice(-15).join('\n'));
      return;
    }
    if (!record('GET :5173/api/health through the Vite proxy → 200', up)) {
      console.log(proc.lines.slice(-15).join('\n'));
      return;
    }
    const page = await http('GET', `${web}/`);
    record(
      'Vite serves the app with X-Frame-Options DENY + frame-ancestors (SEC-5)',
      page.status === 200 &&
        page.headers.get('x-frame-options') === 'DENY' &&
        /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') ?? ''),
      `${page.headers.get('x-frame-options')} | ${page.headers.get('content-security-policy')}`,
    );

    const socket = connectSocket(web, { Origin: web });
    const connected = await waitForSocketConnect(socket);
    socket.close();
    record(
      'socket connects through the proxy (Origin http://localhost:5173)',
      connected.ok,
      connected.error ?? '',
    );

    const preflight = await http('OPTIONS', `${web}/api/events`, {
      headers: {
        Origin: FOREIGN_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    record(
      `preflight via :5173 with Origin ${FOREIGN_ORIGIN}: no ACAO (SEC-1)`,
      preflight.headers.get('access-control-allow-origin') === null,
      `${preflight.status} ACAO=${preflight.headers.get('access-control-allow-origin')}`,
    );
    const read = await http('GET', `${web}/api/agents`, { headers: { Origin: FOREIGN_ORIGIN } });
    record(
      `GET via :5173 with Origin ${FOREIGN_ORIGIN}: no ACAO (SEC-1)`,
      read.headers.get('access-control-allow-origin') === null,
      `${read.status} ACAO=${read.headers.get('access-control-allow-origin')}`,
    );
    const write = await http('PATCH', `${web}/api/agents/04-backend-engineer/status`, {
      body: { status: 'planning', source: 'smoke' },
      headers: { Origin: FOREIGN_ORIGIN },
    });
    record(
      `PATCH via :5173 with Origin ${FOREIGN_ORIGIN} → 403 ORIGIN_NOT_ALLOWED (SEC-1/2)`,
      write.status === 403 && write.json?.error?.code === 'ORIGIN_NOT_ALLOWED',
      `${write.status} ${write.json?.error?.code ?? ''}`,
    );
    // Same status as now = accepted no-op (200, `event: null`); proves the app origin passes the Origin rule
    // without depending on which transitions are legal from the current state.
    const current = await http('GET', `${web}/api/agents/04-backend-engineer`);
    const own = await http('PATCH', `${web}/api/agents/04-backend-engineer/status`, {
      body: { status: current.json?.data?.status, source: 'smoke' },
      headers: { Origin: web },
    });
    record(
      'PATCH via :5173 with the app origin → 200',
      own.status === 200,
      `${own.status} ${own.json?.error?.code ?? ''}`,
    );
  } finally {
    await stopGracefully(proc, 15_000);
    const free = await waitFor(async () => {
      for (const url of ['http://127.0.0.1:4000/api/health', `${web}/`]) {
        try {
          await http('GET', url, { timeoutMs: 800 });
          return false;
        } catch {
          /* closed */
        }
      }
      return true;
    }, 10_000);
    record('dev launcher stopped: ports 4000 and 5173 released', free);
  }
}

// -------------------------------------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'vo-smoke-'));
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  DB_PATH: join(tmp, 'smoke.db'), // never the real data/office.db
  LOG_LEVEL: 'info',
  SERVE_WEB: 'false', // one-port mode is enabled with the --serve-web flag only where intended
};
console.log(`smoke-live: temp DB ${env.DB_PATH}`);

let crashed = null;
try {
  if (await ensureBuild()) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const state = {};
    if (await oneportRun({ base, port, env, firstRun: true, state })) {
      await oneportRun({ base, port, env, firstRun: false, state });
    }
    if (RUN_DEV) await devRun(env);
  }
} catch (error) {
  crashed = error;
  record(
    'smoke script error',
    false,
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
} finally {
  for (const child of started)
    if (child.exitCode === null && child.signalCode === null) killTree(child.pid);
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    record('temp directory removed', !existsSync(tmp), tmp);
  } catch (error) {
    record('temp directory removed', false, String(error));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\nsmoke-live: ${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}`,
);
process.exit(failed.length > 0 || crashed ? 1 : 0);
