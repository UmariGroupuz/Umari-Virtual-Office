#!/usr/bin/env node
// Dev launcher (CR-7, ADR-035 §6, ADR-036): starts the API server (tsx) and Vite directly with node — no shell,
// no npm layers — prefixes their output, restarts the server when its sources REALLY change (content hash,
// QA-6), and guarantees that everything it started is stopped when it stops: Ctrl+C / Ctrl+Break / SIGTERM /
// SIGHUP, Vite exiting, the npm/shell chain that started it disappearing (AUD-3), or the launcher itself being
// hard-killed (a detached reaper cleans up). Never kills a process it cannot prove is its own (CR-20).
// Ports are checked first; when busy, the holder is printed and nothing is started.
//
//   node scripts/dev.mjs                 server + web        (npm run dev)
//   node scripts/dev.mjs --only=server   server only         (npm run dev:server)
//   node scripts/dev.mjs --only=web      web only
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  formatIdentity,
  isSameProcess,
  parseIdentity,
  readCreationTimes,
} from './lib/processIdentity.mjs';
import { watchSources } from './lib/sourceWatcher.mjs';

const IS_WIN = process.platform === 'win32';
const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT), '..');
const SERVER_PORT = Number(process.env.PORT) || 4000;
const WEB_PORT = 5173;
// The server forces its own exit after 5 s of graceful shutdown; give it slightly more.
const GRACE_MS = 6000;
const POLL_MS = 500;
const WATCH_ROOTS = [join(REPO_ROOT, 'apps/server/src'), join(REPO_ROOT, 'packages/shared/src')];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Force-kill a process and all of its descendants. Callers MUST have proven identity first (CR-20): either Node
 * still holds the process un-exited (`exitCode === null && signalCode === null` — the OS handle is open, so the
 * PID cannot have been reused) or `isSameProcess(pid, recordedCreationTime)`. `isAlive(pid)` is NOT identity.
 */
function killTree(pid) {
  if (!pid) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL'); // children are spawned detached = own process group
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/** Node still holds this child un-exited → its PID cannot have been reused (safe to kill). */
const isRunningChild = (child) =>
  Boolean(child?.pid) && child.exitCode === null && child.signalCode === null;

const exitOf = (child) =>
  isRunningChild(child) ? new Promise((r) => child.once('exit', r)) : Promise.resolve();

// ---------------------------------------------------------------------------------------------------------
// Reaper mode: `node dev.mjs --reaper <launcherPid> <pid:creationTime>...` (spawned detached by the launcher).
// Kills the children trees once the launcher is gone — but only children whose identity (PID + creation time,
// recorded by the launcher while it held their handles) is re-verified right before the kill (CR-20).
// Exits when nothing is left to watch. If identity cannot be proven, it does not kill.
// ---------------------------------------------------------------------------------------------------------
if (process.argv[2] === '--reaper') {
  const launcherPid = Number(process.argv[3]);
  // Unknown creation time (0) = never killable; keep only verifiable identities.
  let children = process.argv
    .slice(4)
    .map(parseIdentity)
    .filter((c) => c.pid > 0 && c.created > 0);
  const timer = setInterval(() => {
    children = children.filter((c) => isAlive(c.pid)); // cheap filter: only ever DROPS candidates
    if (children.length === 0) {
      clearInterval(timer);
      return;
    }
    if (!isAlive(launcherPid)) {
      clearInterval(timer);
      for (const c of children) {
        if (isSameProcess(c.pid, c.created)) killTree(c.pid); // identity re-verified immediately before kill
      }
    }
  }, POLL_MS);
} else {
  await main();
}

// ---------------------------------------------------------------------------------------------------------

async function main() {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, text) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const log = (text) => console.log(`${paint('1', '[dev]')} ${text}`);

  const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  if (onlyArg !== undefined && onlyArg !== 'server' && onlyArg !== 'web') {
    log(`unknown --only=${onlyArg} (use --only=server or --only=web)`);
    process.exit(1);
  }
  const runServer = onlyArg !== 'web';
  const runWeb = onlyArg !== 'server';

  // 1. Port preflight.
  const busy = [];
  for (const port of [...(runServer ? [SERVER_PORT] : []), ...(runWeb ? [WEB_PORT] : [])]) {
    if (await isPortInUse(port)) busy.push(port);
  }
  if (busy.length > 0) {
    log(`Port(s) ${busy.join(', ')} already in use — not starting anything.`);
    for (const line of describePortHolders(busy)) log(`  ${line}`);
    log(
      IS_WIN
        ? 'Stop the holder (e.g. `taskkill /PID <pid> /T /F`) if it is a leftover dev process, then retry.'
        : 'Stop the holder (e.g. `kill <pid>`) if it is a leftover dev process, then retry.',
    );
    process.exit(1);
  }

  // 2. Resolve entry points (no npm/shell layers).
  const viteBin = [
    join(REPO_ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
    join(REPO_ROOT, 'node_modules/vite/bin/vite.js'),
  ].find((p) => existsSync(p));
  if (runWeb && !viteBin) {
    log('vite is not installed — run `npm install` first.');
    process.exit(1);
  }

  const childEnv = { ...process.env, ...(color ? { FORCE_COLOR: '1' } : {}) };
  const SERVER_SPEC = {
    name: 'server',
    colorCode: '34', // blue
    cwd: join(REPO_ROOT, 'apps/server'),
    // No `--watch`: restarts are driven by the content-based watcher below (QA-6). The IPC channel lets the
    // launcher stop the server gracefully (the server shuts down on `disconnect`, CR-8).
    args: ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts'],
    ipc: true,
  };
  const WEB_SPEC = {
    name: 'web',
    colorCode: '35', // magenta
    cwd: join(REPO_ROOT, 'apps/web'),
    args: [viteBin],
    ipc: false,
  };

  log(
    [
      runServer ? `server http://127.0.0.1:${SERVER_PORT}` : null,
      runWeb ? `web http://localhost:${WEB_PORT}` : null,
    ]
      .filter(Boolean)
      .join(' + ') + ' — Ctrl+C stops everything',
  );

  let shuttingDown = false;
  let restarting = false;
  let restartAgain = false;
  let reaper = null;
  const procs = { server: null, web: null };

  const startChild = (spec) => {
    const child = spawn(process.execPath, spec.args, {
      cwd: spec.cwd,
      env: childEnv,
      stdio: spec.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      detached: !IS_WIN, // POSIX: own process group, so the whole tree can be signalled
      // Windows: no windowsHide here — it maps to CREATE_NO_WINDOW, which gives each child its own hidden
      // console, so Ctrl+C in the user's terminal would never reach the server (no graceful shutdown).
      windowsHide: false,
    });
    const prefix = paint(spec.colorCode, `[${spec.name}]`);
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => console.log(`${prefix} ${line}`));
    }
    child.on('error', (error) => {
      log(`${spec.name} failed to start: ${error.message}`);
      if (spec.name === 'web') void shutdown('web failed to start', 1);
    });
    child.on('exit', (code, signal) => {
      if (shuttingDown || (spec.name === 'server' && restarting)) return;
      if (spec.name === 'server') {
        // Like `node --watch`: keep running and restart on the next real source change.
        log(
          `server exited (${signal ?? `code ${code}`}) — waiting for a source change to restart it`,
        );
        refreshReaper();
      } else {
        log(`web exited (${signal ?? `code ${code}`}) — stopping`);
        void shutdown('web exited', code === 0 ? 0 : 1);
      }
    });
    return child;
  };

  /** Graceful stop of one child: IPC disconnect (server) and wait; force-kill only while still ours. */
  const stopChild = async (child, { graceful }) => {
    if (!isRunningChild(child)) return;
    if (graceful && child.connected) child.disconnect();
    if (graceful) await Promise.race([exitOf(child), new Promise((r) => setTimeout(r, GRACE_MS))]);
    if (isRunningChild(child)) killTree(child.pid);
    await exitOf(child);
  };

  // 3. Safety net for a hard-killed launcher (TerminateProcess / SIGKILL run no handlers): a detached reaper
  //    that knows each running child's identity (PID + creation time, recorded while we hold it un-exited —
  //    CR-20). Refreshed whenever the set of children changes (server restart/exit).
  function refreshReaper() {
    if (shuttingDown) return;
    if (isRunningChild(reaper)) reaper.kill();
    const running = Object.values(procs).filter(isRunningChild);
    if (running.length === 0) {
      reaper = null;
      return;
    }
    const created = readCreationTimes(running.map((c) => c.pid));
    // A child that exited during the query may have a reused PID → record "unknown" (never killable).
    const identities = running.map((c) =>
      formatIdentity(c.pid, isRunningChild(c) ? created.get(c.pid) : 0),
    );
    reaper = spawn(process.execPath, [SCRIPT, '--reaper', String(process.pid), ...identities], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    reaper.unref();
  }

  if (runServer) procs.server = startChild(SERVER_SPEC);
  if (runWeb) procs.web = startChild(WEB_SPEC);
  refreshReaper();

  // 4. Server restarts on REAL source changes only (content hash; reads/atime never restart — QA-6).
  const restartServer = async (changed) => {
    if (shuttingDown) return;
    if (restarting) {
      restartAgain = true;
      return;
    }
    restarting = true;
    const shown = changed
      .slice(0, 3)
      .map((f) => relative(REPO_ROOT, f).replace(/\\/g, '/'))
      .join(', ');
    log(`source changed (${shown}${changed.length > 3 ? ', …' : ''}) — restarting server`);
    await stopChild(procs.server, { graceful: true });
    if (!shuttingDown) {
      procs.server = startChild(SERVER_SPEC);
      refreshReaper();
    }
    restarting = false;
    if (restartAgain && !shuttingDown) {
      restartAgain = false;
      void restartServer(['(more changes)']);
    }
  };
  const sourceWatcher = runServer
    ? watchSources({ roots: WATCH_ROOTS, onChange: (changed) => void restartServer(changed) })
    : null;

  // 5. Stop when any process of the ancestor chain (npm layers + the root shell/tool) disappears (AUD-3).
  const ancestors = parentPidsToWatch();
  if (process.env.DEV_DEBUG_ANCESTORS) log(`watching ancestors: ${ancestors.join(' → ')}`);
  const initialPpid = process.ppid;
  const ancestorTimer = setInterval(() => {
    if (ancestors.some((pid) => !isAlive(pid)) || (!IS_WIN && process.ppid !== initialPpid)) {
      void shutdown('parent process exited', 0);
    }
  }, POLL_MS);
  ancestorTimer.unref();

  async function shutdown(reason, exitCode, { signal } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(ancestorTimer);
    sourceWatcher?.close();
    log(`stopping (${reason})…`);

    // Server: graceful via IPC disconnect on every path (on Ctrl+C it also got the console event itself).
    // Web: on Windows a console signal already reached it; POSIX: signal its process group. Then wait, and
    // force-kill only children Node still holds un-exited (CR-20) — never anything looked up by PID or port.
    const server = procs.server;
    const web = procs.web;
    if (!IS_WIN && isRunningChild(web)) {
      try {
        process.kill(-web.pid, signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    const webGraceful = !IS_WIN || ['SIGINT', 'SIGBREAK', 'SIGHUP'].includes(signal ?? '');
    await Promise.all([
      stopChild(server, { graceful: true }),
      stopChild(web, { graceful: webGraceful }),
    ]);
    if (isRunningChild(reaper)) {
      try {
        reaper.kill();
      } catch {
        /* already gone */
      }
    }
    const stillBusy =
      (runServer && (await isPortInUse(SERVER_PORT))) || (runWeb && (await isPortInUse(WEB_PORT)));
    if (stillBusy)
      log('warning: a dev port is still in use after stopping — see the preflight next time');
    log('stopped');
    process.exit(exitCode);
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => void shutdown(signal, 0, { signal }));
  }
  // Last resort for any other exit path (uncaught error, process.exit elsewhere): synchronous tree kill of
  // children Node still holds un-exited only (CR-20).
  process.on('exit', () => {
    for (const child of Object.values(procs)) if (isRunningChild(child)) killTree(child.pid);
  });
  process.on('uncaughtException', (error) => {
    log(`launcher error: ${error.message}`);
    void shutdown('launcher error', 1);
  });
  process.stdout.on('error', () => void shutdown('output closed', 0));
  // Started by a tool with an IPC channel (e.g. scripts/smoke-live.mjs --dev): disconnect = stop.
  if (process.connected) process.on('disconnect', () => void shutdown('IPC disconnect', 0));
}

/**
 * Parses ConvertTo-Json output. Windows PowerShell 5.1 does not escape control characters inside strings (some
 * command lines contain them), which makes JSON.parse throw; they are replaced by spaces first. Always an array.
 */
function parsePowerShellJson(stdout) {
  // eslint-disable-next-line no-control-regex -- intentionally matches raw control characters
  const text = (stdout ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (text === '') return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** True when something accepts TCP connections on the port (IPv4 or IPv6 loopback). */
async function isPortInUse(port) {
  const tryConnect = (host) =>
    new Promise((resolvePromise) => {
      const socket = connect({ host, port });
      const done = (inUse) => {
        socket.destroy();
        resolvePromise(inUse);
      };
      socket.setTimeout(700, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  const results = await Promise.all([tryConnect('127.0.0.1'), tryConnect('::1')]);
  return results.some(Boolean);
}

/**
 * Windows: listeners on the given ports as { port, pid, ppid, name, commandLine }. `ppid` stays the original
 * parent's PID even after that parent has exited, which lets the launcher recognise its own grandchildren.
 */
function windowsPortHolders(ports) {
  const script = [
    '$rows = @()',
    `foreach ($p in @(${ports.join(',')})) {`,
    '  $owners = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |',
    '    Select-Object -ExpandProperty OwningProcess -Unique',
    '  foreach ($o in $owners) {',
    '    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$o" -ErrorAction SilentlyContinue',
    '    $rows += [pscustomobject]@{ port = $p; pid = [int]$o; ppid = [int]$proc.ParentProcessId;',
    '      name = [string]$proc.Name; commandLine = [string]$proc.CommandLine }',
    '  }',
    '}',
    'ConvertTo-Json -Compress -InputObject @($rows)',
  ].join('\n');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  try {
    const parsed = parsePowerShellJson(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/** Human-readable "port → PID → command" lines for the listeners on the given ports. */
function describePortHolders(ports) {
  if (IS_WIN) {
    const lines = windowsPortHolders(ports).map(
      (h) => `port ${h.port} is held by PID ${h.pid} (${h.name}): ${h.commandLine}`,
    );
    return lines.length > 0 ? lines : ['(could not identify the process — try `netstat -ano`)'];
  }
  const lines = [];
  for (const port of ports) {
    const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    lines.push(...(result.stdout ?? '').split('\n').filter((l) => l.trim() !== ''));
  }
  return lines.length > 0
    ? lines
    : ['(could not identify the process — try `lsof -iTCP -sTCP:LISTEN`)'];
}

/** pid → { ppid, name, cmd, exe } for every process (one OS query). Empty map when the query fails. */
function processTable() {
  const table = new Map();
  if (IS_WIN) {
    const script = [
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,',
      "@{n='Created';e={[long](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)}}",
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    try {
      for (const p of parsePowerShellJson(result.stdout)) {
        table.set(p.ProcessId, {
          ppid: p.ParentProcessId,
          name: p.Name ?? '',
          cmd: p.CommandLine ?? '',
          exe: p.ExecutablePath ?? '',
          created: Number(p.Created) || 0,
        });
      }
    } catch {
      /* fall through with an empty table */
    }
    return table;
  }
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' });
  for (const line of (result.stdout ?? '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) {
      const cmd = m[3];
      table.set(Number(m[1]), {
        ppid: Number(m[2]),
        name: cmd.split(/\s+/)[0] ?? '',
        cmd,
        exe: '',
      });
    }
  }
  return table;
}

/** npm's own process layers: npm/npx CLI, npm's `cmd /d /s /c` script shell, npm shims (npm.cmd, npm.ps1, sh). */
function isNpmLayer({ name, cmd }) {
  if (/npm-cli\.js|npx-cli\.js|(^|[\\/\s"'])np[mx](\.cmd|\.ps1)?(["'\s]|$)/i.test(cmd)) return true;
  return /^cmd(\.exe)?$/i.test(name) && /\s\/d\s+\/s\s+\/c\s/i.test(` ${cmd} `);
}

/** Desktop/system processes are never watched (their exit says nothing about the dev session). */
// Function declarations (hoisted): `main()` runs at module top level before later `const`s are initialized.
function isSystemProcess(name) {
  return /^(system|idle|smss|csrss|wininit|winlogon|services|lsass|svchost|explorer|sihost|runtimebroker|dllhost|taskhostw|launchd|systemd|init)(\.exe)?$/i.test(
    name,
  );
}

/** Git Bash / Cygwin process (MSYS fork emulation breaks Windows parent links between them). */
function isMsysProcess(info) {
  return /[\\/]usr[\\/]bin[\\/][^\\/]+\.exe$/i.test(info.exe);
}

/**
 * Windows PID of the MSYS parent of the MSYS processes `winpids` (one MSYS process can appear as several Windows
 * processes after exec; `ps` lists only one of them), via Git Bash's own `ps -al`, skipping MSYS ancestors whose
 * Windows process is gone (fork intermediates). null when there is none (MSYS PPID 1) or `ps` is unavailable.
 */
function msysParentWinPid(winpids, msysExe, table) {
  const psExe = join(dirname(msysExe), 'ps.exe');
  if (!existsSync(psExe)) return null;
  const result = spawnSync(psExe, ['-al'], { encoding: 'utf8', windowsHide: true });
  const rows = new Map(); // msys pid → { ppid, winpid }
  let current;
  for (const line of (result.stdout ?? '').split('\n')) {
    const m = line.match(/^\s*[A-Z]?\s*(\d+)\s+(\d+)\s+\d+\s+(\d+)\s/);
    if (!m) continue;
    const row = { pid: Number(m[1]), ppid: Number(m[2]), winpid: Number(m[3]) };
    rows.set(row.pid, row);
    if (winpids.has(row.winpid)) current = row;
  }
  for (let depth = 0; current && depth < 12; depth += 1) {
    const parent = current.ppid > 1 ? rows.get(current.ppid) : undefined;
    if (!parent) return null;
    if (table.has(parent.winpid)) return parent.winpid;
    current = parent;
  }
  return null;
}

/**
 * Git Bash started by a native program (`bash.exe -c "… npm run dev"`): the MSYS chain has PPID 1 and the
 * Windows link is broken by a fork intermediate, but cygwin keeps the original `bash -c` process alive as an
 * exec "stub" under the native parent. Heuristic: the newest live MSYS process not on the chain, whose command
 * line mentions npm, whose parent is native, created at most 15 s before the segment. A wrong match can only
 * make the launcher stop early — it never kills anything.
 */
function findCygwinStub(segment, table) {
  const created = [...segment].map((pid) => table.get(pid)?.created ?? 0).filter((t) => t > 0);
  if (created.length === 0) return null;
  const segmentStart = Math.min(...created);
  let best = null;
  for (const [pid, info] of table) {
    if (segment.has(pid) || !isMsysProcess(info) || !/\bnp[mx]\b/i.test(info.cmd)) continue;
    const parent = table.get(info.ppid);
    if (parent && isMsysProcess(parent)) continue;
    if (info.created > segmentStart || segmentStart - info.created > 15_000) continue;
    if (!best || info.created > best.created) best = { pid, created: info.created };
  }
  return best?.pid ?? null;
}

/**
 * PIDs whose disappearance means "the user stopped dev" (AUD-3): the whole ancestor chain through npm's own
 * layers (npm CLI, npm's script shell, npm shims — under Git Bash bridged through MSYS's own parent links), up
 * to and including the first process that is not an npm layer: the user's shell, IDE task or tool. Killing any
 * of them — typically only the root shell — stops the launcher. Desktop/system processes are never watched.
 * Falls back to the direct parent when the process query fails.
 */
function parentPidsToWatch() {
  const table = processTable();
  const pids = [];
  const seen = new Set();
  let pid = process.ppid;
  let msysExe = null; // set while walking a run of consecutive MSYS processes
  let msysSegment = new Set(); // their Windows PIDs
  for (let depth = 0; depth < 24 && pid > 1 && !seen.has(pid); depth += 1) {
    seen.add(pid);
    const info = table.get(pid);
    if (!info) {
      // Broken link (parent already gone). Under Git Bash, continue through MSYS's parent chain.
      const bridged = msysExe
        ? (msysParentWinPid(msysSegment, msysExe, table) ?? findCygwinStub(msysSegment, table))
        : null;
      if (bridged === null) break;
      msysExe = null;
      msysSegment = new Set();
      pid = bridged;
      continue;
    }
    if (isSystemProcess(info.name)) break;
    pids.push(pid);
    if (!isNpmLayer(info)) break; // the first non-npm ancestor (root shell/tool) is watched, nothing above it
    if (isMsysProcess(info)) {
      msysExe = info.exe;
      msysSegment.add(pid);
    } else {
      msysExe = null;
      msysSegment = new Set();
    }
    pid = info.ppid;
  }
  return pids.length > 0 ? pids : [process.ppid];
}
