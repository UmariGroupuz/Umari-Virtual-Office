# AI Virtual Office — MVP (Phase 1)

A real-time monitoring UI for a team of 15 AI agents. A Phaser 3 virtual office and a dark operations
dashboard show the status of every agent (working, planning, waiting, reviewing, failed, offline). They
also show the project and task each agent is on, its progress, and a live activity feed. All changes go
through one backend event pipeline (REST → SQLite → Socket.IO).

**Phase 1 is monitoring only and local only.** Nothing is connected to real Claude Code agents,
Telegram, GitHub or any other external system. The office is driven by the **Developer Simulator**,
**Demo Mode** and any script that posts events to the API. The event format does not depend on any one
producer, so real producers can be connected later (see [Roadmap](docs/ROADMAP.md)).

## Features

- 15 seeded agents, 4 projects (Sellway, Ishkun24, ERP, Ana Market) plus the "All Projects" filter,
  11 realistic tasks and 44 historical events.
- Agent and task state machines enforced by the server. Illegal transitions are rejected with `409`
  ([AGENT_STATE_MACHINE.md](docs/AGENT_STATE_MACHINE.md)).
- Generic event API (`POST /api/events`, 13 producer event types). Every event is validated, stored,
  applied to agent/task state and broadcast over Socket.IO.
- Live dashboard: top bar, project filter, metrics, Phaser office, agent roster, agent detail panel, live
  activity feed.
- Developer Simulator and Demo Mode. Both write through the backend API; neither changes the UI state
  directly.
- Loading, empty, error, "backend unavailable" and socket connection states (Connected / Reconnecting /
  Disconnected) with automatic reconnect and resync.
- Structured JSON logs, strict input validation (Zod), local-only security defaults.

## The UI

The app has one screen (`/`). Desktop first; it also works on laptops and tablets. Below 768 px it shows a
simplified view without the canvas.

- **Top bar**: product name, system status (Operational / Degraded / Backend unavailable), project
  selector, current time, connected agents (`14/15 online`), live-update connection status, Demo mode
  switch and the **Simulator** button.
- **Metrics row**: Agents Online, Working, Planning, Waiting, Reviewing, Failed, Active Tasks, Completed
  Tasks. The numbers follow the project filter.
- **Office**: eight rooms (Management, Development, Design, Infrastructure, Quality, AI Lab,
  Documentation, Audit). Each agent sits at a desk with a label, a status indicator and a subtle status
  animation (typing when working, a thinking bubble when planning, gray when offline, and so on). When a
  project is selected, agents on other projects are dimmed. Clicking a desk opens the detail panel.
- **Agent roster**: the same agents as a keyboard- and screen-reader-friendly list.
- **Agent detail panel**: name, role, department, status, project, task and task ID, progress, started at,
  running duration, current action, last activity and last message. Tabs:
  - **Activity** and **Tasks** come from stored data.
  - **Logs** is derived from the agent's stored events.
  - **Files** and **Git** show sample data, labelled "Sample data — not connected (Phase 1)".
- **Live activity feed**: time, agent, action, project, message and severity. It follows the project
  filter and has a "Hide demo" toggle and a severity filter.

The URL keeps the view state: `/?project=sellway&agent=04-backend-engineer`.

## Requirements

| Item | Version |
|---|---|
| Node.js | **≥ 22.13** (`engines`); tested on **24.12.0** |
| npm | tested on 11.6.2 (comes with Node) |
| OS / shell | Windows 11 tested (PowerShell, cmd, Git Bash). macOS/Linux should work; the scripts are portable |

No database server and no native build tools are needed. SQLite is Node's built-in `node:sqlite`. After
`npm install`, nothing needs the network: fonts and assets are bundled.

## Installation

```bash
npm install          # or `npm ci` for the exact lockfile versions
npm run verify       # optional: format check, lint, typecheck, tests, build
```

`npm install` prints one expected notice: `npm warn deprecated eslint@9.39.x`. ESLint 9 is kept on
purpose; see BL-010 in `tasks/BACKLOG.md`.

## Development

### Start both (recommended)

```bash
npm run dev
```

`scripts/dev.mjs` starts the API server (`tsx`, no `node --watch`) and the Vite dev server (hot reload).
Their output is prefixed `[server]` / `[web]`. The launcher watches `apps/server/src` and
`packages/shared/src` itself and restarts the server gracefully only when a file's **content** changes;
reading the sources (typecheck, lint, tests) never restarts it. **Ctrl+C stops both**, and the server
shuts down gracefully (`server_stopped`, an active demo is restored). If port 4000 or 5173 is already
taken, the launcher starts nothing and prints the process that holds the port.

Open **http://localhost:5173**. Vite proxies `/api` and `/socket.io` to the server at
`http://127.0.0.1:4000`.

### Start the backend only

```bash
npm run dev:server   # API + Socket.IO on http://127.0.0.1:4000 (= scripts/dev.mjs --only=server)
```

### Start the frontend only

```bash
npm run dev:web      # Vite on http://localhost:5173
```

The frontend needs a running backend on port 4000. Without one, it shows "Can't reach the AI Virtual
Office server" and retries automatically.

### One-port mode (production-like, local)

```bash
npm run build        # typecheck + Vite build into apps/web/dist
npm start            # server on http://127.0.0.1:4000 serves the web app, the API and Socket.IO
```

The server runs from TypeScript source through the `tsx` loader. There is no separate server build
(ADR-013). If `apps/web/dist` is missing, the server logs a warning and serves only the API.

### Local URLs

| URL | What |
|---|---|
| http://localhost:5173 | Web app in dev mode (`npm run dev` / `npm run dev:web`) |
| http://127.0.0.1:4000/api | REST API (both modes) |
| http://127.0.0.1:4000/api/health | Health check → `200 {"data":{"status":"ok","db":"ok",…}}` |
| http://127.0.0.1:4000 | Web app in one-port mode (`npm run build && npm start`) |
| `ws://127.0.0.1:4000/socket.io` | Socket.IO (in dev, the browser connects through `localhost:5173/socket.io`) |

Use `127.0.0.1` for the API: the server binds to IPv4 loopback, and on some systems `localhost` resolves
to `::1` first.

## Configuration

Everything works without configuration. To override a value, copy `.env.example` to `.env` in the repo
root, or set real environment variables (they take precedence over `.env`). Only the server reads
configuration; the web app has no environment variables. Phase 1 needs no secrets.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | Server port. The Vite proxy always targets 4000, so change it only for one-port mode |
| `HOST` | `127.0.0.1` | Bind address. A non-loopback value logs a `non_loopback_host` warning: the API has **no auth** |
| `DB_PATH` | `<repo>/data/office.db` | SQLite file. Relative paths resolve against the repo root; `:memory:` is allowed |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Browser origins allowed to call the API and open sockets |
| `SERVE_WEB` | `false` | Serve `apps/web/dist`. `npm start` enables it with the `--serve-web` flag |
| `DEMO_DEFAULT_INTERVAL_MS` | `3000` | Demo tick interval, 2000–10000 |

Example (PowerShell, one-port mode on another port with a throwaway database):

```powershell
$env:PORT = '4100'; $env:DB_PATH = "$env:TEMP\vo-test\office.db"; npm start
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server + web; the server restarts on source changes (see above) |
| `npm run dev:server` / `npm run dev:web` | One side only |
| `npm run build` | Typecheck all workspaces, then build the web app |
| `npm start` | One-port mode (server + built web app on 4000) |
| `npm run verify` | `format:check` → `lint` → `typecheck` → `test` → `build`. Prints a PASS/FAIL summary and stops at the first failure |
| `npm run lint` | ESLint (zero warnings allowed; also checks the architecture import boundaries) |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm test` | Vitest in `packages/shared`, `apps/server` and `apps/web`, then `npm run test:scripts` (Node tests of the dev-launcher helpers) |
| `npm run format` / `npm run format:check` | Prettier write / check |
| `npm run smoke` | Live end-to-end check with a **temporary** database (never `data/office.db`). It starts the one-port server on a free port and checks health, agents, `POST /api/events` with a Socket.IO broadcast, static serving, the Origin rules, graceful stop, and a restart with persistence |
| `npm run smoke -- --dev` | Also checks `npm run dev` through the Vite proxy (ports 4000 and 5173 must be free) |
| `npm run db:reset` | Deletes and reseeds the dev database (see below) |

## Data, seed and reset

- The database is `data/office.db` (SQLite, WAL mode; gitignored). On the first start the server creates
  and migrates it and seeds 15 agents, 4 projects, 11 tasks and 44 historical events. It seeds **only when
  the database is empty**, so restarts keep all data.
- **Reset:** stop the server, then run `npm run db:reset`. It refuses to run while a server is listening
  on `HOST:PORT`, when `DB_PATH` is `:memory:`, or when `DB_PATH` points outside `data/`.
- Backup and restore: copy `data/office.db*` while the server is stopped
  ([DEPLOYMENT.md](docs/DEPLOYMENT.md) §5).

## How the Developer Simulator works

Open it with the **Simulator** button in the top bar. It lets you test the office without real agents,
and it never changes the UI state directly. Every action is a real API call. The result reaches all open
browsers through the normal Socket.IO broadcast.

1. **Target**: choose an **Agent**, optionally a **Project** and a **Task** of that project. The panel
   preselects the agent's current project and task.
2. **Status buttons**: Set Idle, Start Planning, Start Work, Set Waiting, Start Review, Complete, Fail,
   Set Offline. Each one sends:

   ```http
   PATCH /api/agents/:id/status
   Content-Type: application/json

   { "status": "working", "source": "simulator", "project": "sellway", "taskId": "SW-123" }
   ```

   The server turns this into an `agent.status.changed` event and runs it through the same pipeline as
   `POST /api/events`. A button that is illegal from the agent's current status is marked "Not allowed
   from <status> — the server will reject this". If you click it anyway, the server answers `409` and the
   panel shows the server's message inline, e.g. `Illegal transition: idle → completed`, with the allowed
   buttons. Clicking the current status is a no-op: nothing is stored ("No change · … is already …").
3. **Send Activity**: enter an **Action** (e.g. `run_tests`), an optional **Message** and a **Severity**,
   then click **Send Event**. This sends
   `POST /api/events` with `{ "type": "agent.activity", "source": "simulator", "agentId", "action", … }`.

The simulator has no "force" option. Forcing an illegal transition is possible only through the API
(`"force": true` on the PATCH endpoints).

## Demo Mode

Turn on the **Demo mode** switch in the top bar to generate realistic activity every few seconds (default
3 s). The PM assigns tasks, the Architect plans, Backend and Frontend work, QA waits and then reviews, the
Reviewer reviews and the Product Auditor audits. The project rotates through all four projects.

- The demo runs **on the server**. It uses the same event pipeline with `source: "demo"`, so the feed can
  hide it ("Hide demo"), and every open browser sees the same demo.
- When the demo starts, the server saves a snapshot of all agents and tasks (persisted in the database).
  When you turn it off, the server restores that snapshot and deletes the tasks the demo created. A toast
  shows the counts.
- **Your own changes are kept.** An agent or task that you changed during the demo (simulator, curl, any
  non-demo event) is not restored, and the demo leaves that agent alone from then on.
- A graceful stop (Ctrl+C in `npm start` or `npm run dev`) restores the snapshot right away. If the server
  ends during a demo without restoring (crash, killed process), the next start restores
  the pre-demo state (`demo_recovered` in the log). Demo mode is off after any restart.
- API: `GET /api/demo`, `POST /api/demo/start` with body `{}` or `{"intervalMs": 5000}`,
  `POST /api/demo/stop` with body `{}`.

## How events work

Any producer reports what an agent is doing by posting one JSON event to `POST /api/events`. Producers
include the simulator, the demo engine, scripts and, later, Claude Code, CI or Telegram. For every event
the backend:

1. **validates** it (strict Zod schema: unknown fields, bad statuses, unknown agents or projects are
   rejected);
2. **stores** it in SQLite with a sequence number (`seq`) and server timestamp;
3. **updates the agent** (status, project, task, progress, action, message), checking the agent state
   machine;
4. **updates the task** if needed, e.g. `agent.task.started` moves the task to `in_progress`;
5. **broadcasts** the result to every browser over Socket.IO (`office:event`);
6. **returns** the accepted event with the updated agent and task.

Steps 2–4 run in one transaction. A rejected event changes nothing and is not broadcast.

### Example: the §12 event

On a fresh seed, this switches Backend Engineer from `idle` to `working` on task SW-123 (Lost Goods API).
SW-123 moves from `assigned` to `in_progress`.

**bash / Git Bash / macOS / Linux**

```bash
curl -X POST http://127.0.0.1:4000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "agent.activity",
    "agentId": "04-backend-engineer",
    "project": "Sellway",
    "taskId": "SW-123",
    "status": "working",
    "action": "run_command",
    "message": "Running backend tests",
    "metadata": { "command": "npm test" }
  }'
```

**PowerShell** (Windows PowerShell 5.1 and PowerShell 7)

```powershell
$body = @'
{
  "type": "agent.activity",
  "agentId": "04-backend-engineer",
  "project": "Sellway",
  "taskId": "SW-123",
  "status": "working",
  "action": "run_command",
  "message": "Running backend tests",
  "metadata": { "command": "npm test" }
}
'@
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4000/api/events -ContentType 'application/json' -Body $body
```

In Windows PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`. To use real curl, call
`curl.exe`, and pass the JSON from a file to avoid quoting problems:
`curl.exe -X POST http://127.0.0.1:4000/api/events -H "Content-Type: application/json" --data-binary "@event.json"`.

Response `201` (shortened):

```json
{
  "data": {
    "event": { "id": "…", "seq": 45, "type": "agent.activity", "source": "api", "project": "sellway",
               "status": "working", "severity": "info", "forced": false, "createdAt": "…" },
    "agent": { "id": "04-backend-engineer", "status": "working", "currentProject": "sellway",
               "taskId": "SW-123", "currentTask": "Lost Goods API", "currentAction": "run_command",
               "lastMessage": "Running backend tests", "startedAt": "…", "version": 2 },
    "task":  { "id": "SW-123", "status": "in_progress", "startedAt": "…", "version": 2 }
  }
}
```

Rules to keep in mind:

- `Content-Type: application/json` is required on every POST/PATCH. Without it the API answers `400
  INVALID_JSON`. The body limit is 100 KB and `metadata` is limited to 8 KB.
- Scripts and curl send no `Origin` header and are allowed. A browser page on a different origin (another
  local dev server, for example) gets `403 ORIGIN_NOT_ALLOWED`. Only the origins in `CORS_ORIGINS` and the
  app itself may write.
- `project` accepts the id or the name, in any case (`sellway`, `Sellway`). Responses always use the id.
  `source` defaults to `"api"`; `demo` and `system` are reserved for the server.
- Errors use one shape: `{"error":{"code":"ILLEGAL_TRANSITION","message":"Illegal transition: idle →
  completed","details":{…}}}`. Codes: `400 VALIDATION_ERROR`/`INVALID_JSON`, `404`, `409
  ILLEGAL_TRANSITION`, `413`, `422 UNKNOWN_AGENT`/`UNKNOWN_PROJECT`/`UNKNOWN_TASK`/`PROJECT_MISMATCH`.

### Event types

| Type | Required fields | Effect |
|---|---|---|
| `agent.connected` / `agent.disconnected` | `agentId` | offline → idle / any → offline |
| `agent.status.changed` | `agentId`, `status` | status transition; a bound task follows (working → `in_progress`, …) |
| `agent.activity` | `agentId`, `action` | sets the current action; optional `status`, `taskId`, `progress` |
| `agent.message` | `agentId`, `message` | sets the last message; optional `status` |
| `agent.task.assigned` | `agentId`, `taskId` | assigns the task (and creates it if `project` is given and the id is new) |
| `agent.task.started` | `agentId`, `taskId` | agent → working, task → in_progress |
| `agent.task.progress` | `agentId`, `taskId`, `progress` | progress 0–100 on agent and task |
| `agent.task.completed` | `agentId`, `taskId` | agent → completed, task → completed (100 %) |
| `agent.task.failed` | `agentId`, `taskId` | agent → failed, task → failed |
| `system.info` / `system.warning` / `system.error` | `message` | feed entry only; never changes agents or tasks |

A task changes only when it is assigned to the event's agent or is unassigned (the agent then claims
it). Another agent can report on a task, e.g. the Reviewer reviewing SW-123, without changing it.

The server writes two more types itself: `task.created` and `task.updated` (from `POST /api/tasks` and
`PATCH /api/tasks/:id`). Producers cannot send them. Optional fields on all types: `source`, `project`,
`taskId`, `action`, `message`, `severity`, `metadata`, `occurredAt`. Full rules:
[EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md). Exact contracts: [API_CONTRACTS.md](docs/API_CONTRACTS.md).

### Other endpoints

`GET /api/health` · `GET /api/projects` · `GET /api/agents[?project=]` · `GET /api/agents/:id` ·
`PATCH /api/agents/:id/status` · `GET /api/events?project&agentId&taskId&type&source&before&limit`
(newest first, paged by `seq`) · `GET /api/tasks?project&agentId&status` · `POST /api/tasks` ·
`PATCH /api/tasks/:id` · `GET /api/snapshot` (consistent initial state for clients) · `GET /api/demo` ·
`POST /api/demo/start` · `POST /api/demo/stop`. Every success body is `{ "data": … }`.

### Real-time

The browser opens one Socket.IO connection. The server only sends; it ignores client messages:

- `office:event`: the `data` of every committed write (`{event, agent, task}`);
- `demo:state`: Demo Mode switched on or off;
- `office:resync`: after a demo restore, so clients reload.

On every connect and reconnect, the client fetches `GET /api/snapshot` and replays the events it buffered
in the meantime. Duplicates are dropped by event id and entity `version`, so nothing is lost or shown
twice.

## Project structure

```
apps/
  server/          Express 5 + Socket.IO 4 + node:sqlite (TypeScript via tsx)
    src/api/       routes (system, agents, events, tasks, demo), middleware (host/origin guards, JSON, errors), static
    src/services/  eventService (single write path), eventEffects (pure rules), taskService, demoService,
                   demoScript (pure storyline), snapshotService, projectResolver
    src/db/        connection, migrations, repositories
    src/realtime/  Socket.IO server + broadcaster
    src/seed/      seed-if-empty, reset CLI
  web/             React 19 + Vite + Tailwind v4 + Zustand + Phaser 3.90
    src/office/    Phaser office (only module that imports Phaser; seam = OfficeCanvas)
    src/layout/ dashboard/ agents/ activity/ simulator/   UI features
    src/store/ socket/ api/                              state, sync, HTTP client
packages/
  shared/          @vo/shared: types, Zod schemas, state machines, constants, reference data, adapters
scripts/           dev.mjs (dev launcher), verify.mjs, smoke-live.mjs, lib/ (source watcher, process identity)
data/              office.db (created at runtime, gitignored)
docs/  tasks/      design documents and the task board
```

## Documentation

| Document | Content |
|---|---|
| [docs/PROJECT.md](docs/PROJECT.md) | Vision, scope, feature status, docs index |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, data model, stack |
| [docs/EVENT_SYSTEM.md](docs/EVENT_SYSTEM.md) | Event envelope, types, effects, pipeline, real-time delivery, adapters |
| [docs/AGENT_STATE_MACHINE.md](docs/AGENT_STATE_MACHINE.md) | Legal/illegal agent and task transitions |
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | Exact REST and Socket.IO contracts, error codes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 1–10 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Run modes, ports, troubleshooting, backup |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, accepted risks |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Integration status (Claude Code adapter) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision records ADR-001…037 |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md), [docs/UX.md](docs/UX.md) | Requirements and UX specification |

## Known limitations

- **Local only, no authentication.** The server binds `127.0.0.1` and trusts every local process. Do not
  expose it to a network ([SECURITY.md](docs/SECURITY.md)).
- **Not connected to real agents.** The Claude Code format from the request is an **UNVERIFIED**
  example. The pure adapter `claudeCodeAdapter` in `@vo/shared` is tested with hand-written payloads only
  and is **not wired** to any endpoint ([INTEGRATIONS.md](docs/INTEGRATIONS.md)).
- **Files and Git tabs show sample data** (labelled as such). The Logs tab is derived from stored events,
  not from real log streams.
- **A task keeps its status when its agent goes idle or offline.** Agent and task state are coupled only
  through events (REQ-042). `idle` and `offline` map to "task unchanged". Setting an agent to `idle`
  clears the agent's `taskId`, current task and progress. The task row itself keeps its status and
  assignee: SW-123 stays `in_progress`, assigned to the now idle Backend Engineer, and the simulator's task
  list shows "(In progress)". To change the task, send a task event (`agent.task.completed` /
  `agent.task.failed`) before the agent goes idle, or use `PATCH /api/tasks/:id`.
- **Demo Mode also drives agents that you changed before the demo started.** Only changes made while the
  demo runs mark an agent or task as "yours". The demo cast is PM, Architect, Backend, Frontend, QA,
  Reviewer and Product Auditor. Demo tasks (e.g. `SW-D50-1b`) are assigned to these agents and their
  status changes, even if one was busy with a real task such as SW-123 before you turned the demo on.
  During the demo those tasks show up in the agents' Tasks tab. On stop, the demo tasks are deleted and the
  agents are restored to their pre-demo state.
- **The app cannot be embedded in an iframe**, not even on the same origin. Every response sends
  `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (clickjacking protection,
  ADR-037). This also affects tools that load pages in frames.
- **Simulator feedback can be out of view on short screens.** The result line ("Accepted · …", errors) sits
  at the bottom of the simulator panel. On a low browser window, scroll the panel to see it.
- **No event retention and no rate limiting yet.** The `events` table grows without limit (BL-001,
  BL-007). Both are required before Phase 2 producers.
- **Hard-killing the dev launcher skips the graceful stop.** If the `scripts/dev.mjs` process itself is
  killed hard (e.g. `taskkill /F` on it), its reaper force-stops the server. An active demo is then restored
  on the next start. Ctrl+C and every other stop path are graceful.
- The Phaser chunk (~1.2 MB, loaded lazily) is the largest asset. The canvas is not shown below 768 px.
- Producers get no exactly-once guarantee: a retried POST creates a second event (idempotency key = BL-005).

## Next: Phase 2

Phase 2 connects real Claude Code agents. Planned work: an ingest endpoint
`POST /api/ingest/:source` with an adapter registry, adapter verification against real hook payloads,
producer tokens, event retention and per-source rate limits. See [docs/ROADMAP.md](docs/ROADMAP.md) and
`tasks/BACKLOG.md`.
