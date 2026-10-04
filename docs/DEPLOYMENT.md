# DEPLOYMENT — AI Virtual Office MVP (Phase 1)

Owner: devops-engineer · Task: TASK-009 · Date: 2026-10-04 · Related: ADR-013, ADR-019, ADR-029, ADR-036,
ADR-037, `docs/API_CONTRACTS.md` §11–§12, `docs/SECURITY.md`.

> **Phase 1 is local-only. There is no cloud, server or container deployment.** The app runs on the owner's
> machine and binds to `127.0.0.1` with no authentication (ADR-019). Do not expose it to a network. Hosting,
> auth, process management and a compiled server build are Phase 9 work (see `tasks/BACKLOG.md`).

## 1. Requirements

| Item | Value |
|---|---|
| OS | Windows 11 (verified), macOS/Linux expected to work (scripts are portable) |
| Node.js | ≥ 22.13 (`engines`), verified on **24.12.0** |
| npm | verified on 11.6.2 |
| Shell | PowerShell, cmd or Git Bash — every script works in all three (no inline env, no `rm -rf`) |
| Native build tools | not needed (SQLite is Node's built-in `node:sqlite`) |
| Network | only for `npm install`; at runtime no CDN or external service is used |

## 2. Install

```powershell
npm ci          # exact versions from package-lock.json (or: npm install)
npm run verify  # format:check → lint → typecheck → test → build; prints a PASS/FAIL summary
```

Expected install notice: `npm warn deprecated eslint@9.39.x` (ESLint 9 is kept on purpose, PM-5; upgrade is
BACKLOG BL-010). No `EBADENGINE` warnings and 0 vulnerabilities are expected.

## 3. Run modes and URLs

| Mode | Command | URLs | Notes |
|---|---|---|---|
| **Dev (both)** | `npm run dev` | web http://localhost:5173 · API http://127.0.0.1:4000 | `scripts/dev.mjs`: server (tsx, restarted by the launcher on real source changes) + Vite with HMR; Vite proxies `/api` and `/socket.io` to `127.0.0.1:4000` |
| Dev server only | `npm run dev:server` | http://127.0.0.1:4000 | `scripts/dev.mjs --only=server`; restarts when the **content** of a file in `apps/server/src` or `packages/shared/src` changes (tests excluded) |
| Dev web only | `npm run dev:web` | http://localhost:5173 | needs a server on 4000 for data |
| **One-port production mode** | `npm run build` then `npm start` | http://127.0.0.1:4000 (web + API + Socket.IO) | server serves `apps/web/dist` with SPA fallback; `/api/*` misses stay JSON 404 |
| Vite preview (optional) | `npm run build` then `npm run preview -w @vo/web` | http://localhost:4173 | static preview of `dist`, proxies `/api` like dev; needs a server on 4000 |

`npm start` runs `node --disable-warning=ExperimentalWarning --import tsx src/index.ts --serve-web` in
`apps/server` (ADR-013: the server runs from TypeScript source through the `tsx` loader; there is no server
build step). `--serve-web` is a CLI flag because inline `SERVE_WEB=true npm start` syntax does not work in
PowerShell/cmd. If `apps/web/dist` is missing, the server logs a warning and serves the API only.

Stop any mode with **Ctrl+C** in its terminal.

### Ports

| Port | Used by | Bound to |
|---|---|---|
| 4000 | API + Socket.IO (+ web in one-port mode) | `127.0.0.1` (`HOST`) |
| 5173 | Vite dev server (`strictPort`) | `localhost` |
| 4173 | Vite preview (`strictPort`) | `localhost` |

## 4. Configuration (server only; the web app has no env vars)

Optional `.env` in the repo root (copy `.env.example`; never commit `.env`). Real environment variables win
over `.env`. No secrets exist in Phase 1.

| Var | Default | Rule |
|---|---|---|
| `PORT` | `4000` | integer 1–65535. The Vite proxy targets 4000, so change it only for one-port mode |
| `HOST` | `127.0.0.1` | a non-loopback value logs `non_loopback_host` — the API has **no auth** |
| `DB_PATH` | `<repo>/data/office.db` | relative paths resolve against the repo root, `:memory:` allowed |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | browser origins allowed for REST reads/writes and Socket.IO |
| `SERVE_WEB` | `false` | `true`/`false`; `npm start` passes `--serve-web` instead |
| `DEMO_DEFAULT_INTERVAL_MS` | `3000` | 2000–10000 |

Logs are JSON lines on stdout (`warn`/`error` on stderr), e.g. `{"level":"info","msg":"server_started",…}`.
Health check: `GET http://127.0.0.1:4000/api/health` → `200 {"data":{"status":"ok","db":"ok",…}}`
(`503` while starting or when the DB is unavailable).

## 5. Data, seed, reset and backup

- Database: SQLite file `data/office.db` (+ `office.db-wal`, `office.db-shm` in WAL mode). The folder is in
  git, the files are gitignored. The server creates and migrates the file on first start and seeds the
  baseline (15 agents, 4 projects, 11 tasks, historical events) **only when it is empty**; restarts keep all data.
- **Reset the dev database:** stop the server first, then `npm run db:reset`. It deletes `data/office.db*`
  and reseeds. It refuses (exit 1, nothing touched) when `DB_PATH` is `:memory:`, points outside `data/`, or
  a server is listening on `HOST:PORT` ("Server is running on 127.0.0.1:4000 — stop it before resetting the
  database."). It is never run implicitly.
- **Backup:** stop the server, then copy `data/office.db` (and `-wal`/`-shm` if present) somewhere safe.
  Restore by copying the files back while the server is stopped. Copying while the server runs can capture
  an inconsistent WAL state.
- Demo mode is persisted: if the process dies during a demo, the next start restores the pre-demo state
  (`demo_recovered` log, ADR-011).

## 6. Verification commands

| Command | What it proves |
|---|---|
| `npm run verify` | format, lint (incl. architecture boundaries), typecheck, all unit/integration tests (workspaces + `npm run test:scripts` for the dev launcher's process-identity/reaper safety), production build |
| `npm run smoke` | live one-port run on a free port with a **temporary database** (never `data/office.db`): health, 15 agents, `index.html` + assets + SPA fallback + JSON 404, clickjacking headers, Socket.IO connect, §12 example `POST /api/events` → 201 and the matching `office:event` on the socket, foreign-Origin socket and PATCH refused (403 `ORIGIN_NOT_ALLOWED`), graceful stop, restart on the same DB (state persisted, no re-seed), temp dir removed. Builds the web app first if `dist` is missing (`--build` forces it) |
| `npm run smoke -- --dev` | additionally starts `npm run dev`'s launcher: API and Socket.IO through the Vite proxy, Vite security headers, no CORS reflection for other localhost origins (SEC-1). Ports 4000/5173 must be free: if either is busy, it reports one FAIL naming the holder (PID + command line) and skips the dev checks, never testing someone else's stack; if the launcher exits before the stack is healthy, it fails at once with the launcher's output. It never kills a process it did not start |

## 7. Troubleshooting

**`npm run dev` says a port is in use.** The launcher checks 4000 and 5173 before starting and prints the
holder instead of starting, e.g.

```
[dev] Port(s) 4000 already in use — not starting anything.
[dev]   port 4000 is held by PID 12345 (node.exe): "C:\Program Files\nodejs\node.exe" --disable-warning=ExperimentalWarning --import tsx src/index.ts
[dev] Stop the holder (e.g. `taskkill /PID <pid> /T /F`) if it is a leftover dev process, then retry.
```

If the command line shows this project (`src/index.ts`, `vite\bin\vite.js`, `scripts\dev.mjs`), stop it with
`taskkill /PID <pid> /T /F` (PowerShell/cmd) and run `npm run dev` again. If it is another app, stop that app
or free the port — the launcher never kills processes it did not start. `npm start` with a busy port exits with
`server_start_failed` (`EADDRINUSE`) before touching the database.

**Stopping dev.** Ctrl+C stops both processes. The launcher also stops both process trees when either one
exits, when the launcher itself is killed (a small reaper process cleans up), and when any process of the chain
that started it disappears — npm, npm's script shell, or the root shell/IDE task/agent tool that ran
`npm run dev` (e.g. a tool stopping a background command by killing only its shell). Verified on Windows 11 with
Git Bash, PowerShell and cmd as the root shell (ADR-036 and its AUD-3 addendum). To see which processes the
launcher watches, run it with the environment variable `DEV_DEBUG_ANCESTORS=1`.

The launcher only ever kills processes it started and still holds (or, for the reaper, whose PID **and**
creation time it re-verified), so a reused PID can never make it kill an unrelated program (ADR-036, CR-20). If it
cannot prove a process is its own, it leaves it running; when 4000/5173 are still in use after stopping it prints
a warning — use the port-in-use recovery above.

**Graceful stop and restarts in dev (ADR-036, QA-6).** The dev server is no longer run under `node --watch`.
The launcher watches `apps/server/src` and `packages/shared/src` itself and restarts the server only when a
file's **content** changes (SHA-1), so reading the sources (typecheck, lint, tests, smoke, a second server)
never restarts it — not even on NTFS with last-access updates enabled, which made `node --watch` restart on
mere reads and end a running demo. Every stop and restart is graceful: the server receives Ctrl+C itself and
the launcher stops it through its IPC channel, so it logs `server_stopped` (demo restored, sockets closed). Only
if the launcher process itself is killed hard does its reaper force-stop the server; an active demo is then
restored on the next start (boot recovery). `npm start` has no watcher and handles Ctrl+C, Ctrl+Break and
console close (SIGINT, SIGBREAK, SIGHUP) gracefully; `npm run smoke` verifies the graceful path.

**`localhost` vs `127.0.0.1`.** The server binds IPv4 `127.0.0.1`. On some systems `localhost` resolves to
`::1` first, so the Vite proxy targets `http://127.0.0.1:4000` explicitly. Open the API as
`http://127.0.0.1:4000`; the host guard accepts `localhost`, `127.0.0.1` and `[::1]` host names.

**`ExperimentalWarning: SQLite is an experimental feature`.** Expected on Node 24.12 (`node:sqlite`). All npm
scripts and the test config pass `--disable-warning=ExperimentalWarning`; you only see it when running node
by hand.

**403 `HOST_NOT_ALLOWED` / `ORIGIN_NOT_ALLOWED`.** Requests must use a loopback host name, and browser writes and
sockets must come from an origin in `CORS_ORIGINS` (or the server's own origin in one-port mode). curl/scripts
without an `Origin` header are allowed. This blocks other local web apps (e.g. dev servers on 5174/5188) from
reading or changing the office (ADR-035, ADR-037).

**Tests are slow on the first run after `npm ci`.** Windows' cold file cache (and antivirus scanning) can make
the first lint/test run take ~1 minute; later runs take seconds.

**Line endings.** `.gitattributes` forces LF so `npm run format:check` passes on fresh Windows clones with
`core.autocrlf=true` (ADR-029).

## 8. What a real deployment would still need (not in Phase 1)

Authentication and producer tokens, rate limiting, event retention, TLS and a reverse proxy, a process manager
or container image, a compiled server build, backups on a schedule, CI running `npm ci && npm run verify &&
npm run smoke`. See `docs/SECURITY.md` §6 and `tasks/BACKLOG.md`.
