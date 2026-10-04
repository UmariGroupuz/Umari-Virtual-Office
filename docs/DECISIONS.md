# DECISIONS — AI Virtual Office MVP

Owner: architect · Task: VO-000 · Format: `ADR-NNN — Title · Date · Status · Context · Decision · Consequences`.
Sources: `docs/ORIGINAL_REQUEST.md` (§N), `docs/PM_BRIEF.md` (PM-N), `docs/REQUIREMENTS.md` (REQ-/NFR-/A-).
New ADRs are appended; a changed decision gets a new ADR that supersedes the old one (never edit history
silently).

---

## ADR-001 — Monorepo with npm workspaces; `packages/types` merged into `packages/shared`
· 2026-10-03 · Accepted

**Context.** §5 suggests `apps/web`, `apps/server`, `packages/shared`, `packages/types` and says "do not
over-engineer". PM-1 pre-decided npm workspaces. Types, Zod schemas, state machines and constants are
tightly coupled (types are inferred from or checked against schemas).

**Decision.** One root `package.json` with `"workspaces": ["apps/*", "packages/*"]` and three
workspaces: `apps/server` (`@vo/server`), `apps/web` (`@vo/web`), `packages/shared` (`@vo/shared`).
`packages/types` is not created; its content lives in `packages/shared/src/types`. Root scripts orchestrate
lint/typecheck/test/build/dev. No pnpm/Turborepo/Nx.

**Consequences.** + one install, one lockfile, no tooling beyond npm. + a single import path for all
contract code. − deviates from the owner's illustrative tree (documented here and in README). Splitting
types out later is a mechanical move.

## ADR-002 — `@vo/shared` consumed as TypeScript source (no build step)
· 2026-10-03 · Accepted

**Context.** A build step for the shared package adds watch processes and stale-output bugs. Vite (web),
`tsx` (server) and Vitest all compile TypeScript on the fly.

**Decision.** `packages/shared/package.json` uses `"type": "module"` and points `exports["."]` (and
`types`) at `./src/index.ts`. The package never emits JS. Both apps depend on it via
`"@vo/shared": "*"` (workspace link). Root `tsconfig.base.json` holds strict settings; each workspace has
its own `tsconfig.json` for `tsc --noEmit`. Shared code must be platform-neutral: **no Node or DOM APIs**
(no `node:*` imports, no `window`), only `zod` as a runtime dependency.

**Consequences.** + edits in shared are picked up instantly by both apps and tests. − the server must also
run from source in production (see ADR-013). − shared cannot use path aliases that only one bundler
understands; use relative imports inside shared.

## ADR-003 — SQLite through built-in `node:sqlite` (`DatabaseSync`)
· 2026-10-03 · Accepted

**Context.** §4 asks for SQLite and "Prisma if practical". NFR-010 forbids native compilation and global
installs on Windows 11 + Node 24.12. Probe (architect, 2026-10-03, Node 24.12.0): `node:sqlite` loads,
`DatabaseSync` supports `exec/prepare/isTransaction/function/close`, `PRAGMA user_version` is
transactional (rolled back with the transaction), rows are null-prototype objects, and the
`ExperimentalWarning` is suppressed by `--disable-warning=ExperimentalWarning`.

**Decision.** Use `node:sqlite` `DatabaseSync` behind a thin repository layer (ADR-004). DB file
`data/office.db` (path resolved relative to the repo root, not CWD); tests use `:memory:`.
Connection pragmas: `journal_mode = WAL` (file DB only), `foreign_keys = ON`, `busy_timeout = 5000`,
`synchronous = NORMAL`.

Rejected:
- **Prisma** — generate step, engine binary download (network at install), Windows friction, async-only
  API that makes "whole event in one atomic step" harder; overkill for 5 tables.
- **better-sqlite3** — excellent API, but a native addon: Node 24 ABI prebuilds may be missing →
  node-gyp/Visual Studio toolchain on Windows (violates NFR-010).
- **sql.js (WASM)** — in-memory DB with manual file persistence; crash-unsafe.
- **Drizzle/Kysely** — still need a driver; extra abstraction not justified for this scope.

**Consequences.** + zero native deps, synchronous API gives natural serialization (ADR-008).
− API is marked experimental: pin Node ≥ 22.13 in `engines`, keep all SQL in repositories so the driver is
swappable, suppress the warning in scripts. − Vitest/Vite must treat `node:sqlite` as a builtin
(prefix-only module) — verify in the first scaffolding task (risk R-2 in ARCHITECTURE.md).

## ADR-004 — Embedded SQL migrations + repository layer + synchronous transactions
· 2026-10-03 · Accepted

**Context.** Without an ORM we need schema versioning, row mapping and atomic multi-table writes.

**Decision.**
- Migrations are an ordered TypeScript array in `apps/server/src/db/migrations/` (`001_init.ts`, …), each
  `{ version: number, name: string, sql: string }`. `runMigrations(db)` applies every migration with
  `version > PRAGMA user_version` inside one `BEGIN IMMEDIATE … COMMIT`, setting `user_version` in the
  same transaction. Migrations are forward-only; a failed migration rolls back and aborts startup.
- Repositories (`agentRepository`, `taskRepository`, `eventRepository`, `projectRepository`,
  `settingsRepository`) own all SQL, use only parameterized prepared statements (cached per connection),
  and map snake_case rows ↔ camelCase domain objects (JSON columns parsed/serialized in `mappers.ts`).
- `withTransaction(db, fn)` runs `fn` between `BEGIN IMMEDIATE` and `COMMIT` (`ROLLBACK` on throw).
  **`fn` must be synchronous** — no `await` inside a transaction. This is a lint-reviewable rule.
- Timestamps are stored as UTC ISO-8601 TEXT, booleans as INTEGER 0/1, JSON as TEXT.

**Consequences.** + migrations need no file-system path resolution (work identically in tsx and Vitest).
+ atomicity is trivial. − no automatic down-migrations (acceptable for a local MVP; reset script exists).

## ADR-005 — Canonical event envelope: strict top level, free-form `metadata`
· 2026-10-03 · Accepted

**Context.** §11/§12/§18 require a generic, producer-agnostic event system. REQ-020/A-08 require strict
top-level validation. Producers must be distinguishable; server-generated events need a home.

**Decision.**
- Producer input (`POST /api/events`) is a Zod **discriminated union on `type`** over the 13 producer types
  (REQ-021), each a `z.strictObject` (unknown keys → 400). Optional common fields: `source`, `agentId`,
  `project`, `taskId`, `status`, `action`, `message`, `severity`, `progress`, `metadata`, `occurredAt`;
  per-type required/forbidden fields are defined in `docs/EVENT_SYSTEM.md` §3.
- `metadata` is any JSON object ≤ 8 KB serialized; it is stored and returned verbatim, never interpreted
  by core logic (except `metadata.title` for task creation, REQ-021).
- Server-added fields: `id` (UUID v4, `crypto.randomUUID()`), `seq` (monotonic integer, SQLite
  `INTEGER PRIMARY KEY AUTOINCREMENT`, the total order and paging cursor), `createdAt` (server UTC),
  `forced` (boolean, ADR-015). Stored events always expose every field (nullable → `null`).
- **Server-only event types** `task.created` and `task.updated` are written by the Tasks API (REQ-040/041)
  and are rejected on `POST /api/events` (400) — producers change tasks through agent events or the
  Tasks API, never by forging task events.
- **Reserved sources** `demo` and `system` are rejected on `POST /api/events` (400); they are set only by
  in-process code (demo engine; server lifecycle messages). Default source for HTTP input is `api`.

**Consequences.** + typos surface immediately; the envelope is self-describing and versionable.
− producers with richer native formats must go through an adapter (ADR-007). − no client idempotency
key in Phase 1 (a retried POST creates a second event); adding an optional `eventKey` later is additive.

## ADR-006 — Project referenced by id or name, normalized to id
· 2026-10-03 · Accepted

**Context.** §12 sends `"project": "Sellway"` (a name); REQ-022 expects `project: "sellway"` back.
"All Projects" is a virtual filter (A-01).

**Decision.** Every API input that takes a project (body or query) is resolved by `projectResolver`:
trim, lowercase, match against lowercased `id` or `name` of the 4 stored projects; no match (including
"All Projects"/"all") → 422 `UNKNOWN_PROJECT`. Stored and returned values are always the project **id**.
Projects are immutable in Phase 1 and cached in memory at boot (the DB stays the source of truth).
For events, the stored project is **derived** when absent: explicit → the referenced existing task's
project → the agent's `currentProject` after the event → `null` (so the Sellway feed shows Backend's
Sellway activity even if a producer omits `project`). An explicit project that differs from an existing
task's project → 422 `PROJECT_MISMATCH` (new code, ADR-017).

**Consequences.** + producer-friendly, unambiguous storage. − a project rename would break name-based
producers (not possible in Phase 1).

## ADR-007 — Producer adapters are pure functions in shared; no adapter endpoint in Phase 1
· 2026-10-03 · Accepted

**Context.** §19 shows a future Claude Code format; REQ-130/131 require a producer-agnostic core and a
pure, tested adapter, but no real integration.

**Decision.** `packages/shared/src/adapters/` defines
`type ProducerAdapter<TRaw> = { source: string; schema: ZodType<TRaw>; toCanonical(raw: TRaw): EventInput[] }`
and implements `claudeCodeAdapter` (mapping in `docs/EVENT_SYSTEM.md` §10). Adapters are pure (no I/O,
no clock, no DB) and return canonical input that still goes through normal validation. **No HTTP route
uses an adapter in Phase 1.** Phase 2 adds `POST /api/ingest/:source` that looks the adapter up in a
registry and feeds the result into `EventService.ingest`.

Why no endpoint now: the §19 format is UNVERIFIED (no real producer to test against); exposing it would
create a public contract we would likely break in Phase 2.

**Consequences.** + core stays Claude-free; adapter is testable in isolation. − the Phase 2 route and
the real Claude Code hook wiring are still to be built (ROADMAP Phase 2).

## ADR-008 — Functional-core event processing in one synchronous transaction; broadcast after commit
· 2026-10-03 · Accepted

**Context.** REQ-022 requires validate → (store + agent + task in one transaction) → broadcast after commit
→ respond, arrival-order application and no partial interleaving; REQ-029 requires that rejected input
leaves no trace.

**Decision.**
- `EventService.ingest(input, ctx)`: (1) Zod parse (outside the transaction); (2) `withTransaction`:
  load agent/task/project, call the **pure** `decideEvent(state, input, ctx) → Decision | Rejection`
  (`apps/server/src/services/eventEffects.ts`, uses the shared state machines), write event + agent +
  task rows; (3) after `COMMIT`, call `broadcaster.officeEvent({event, agent, task})`; (4) return the same
  payload to the HTTP handler.
- Because `DatabaseSync` and the whole step (2) are synchronous and Node is single-threaded, events are
  serialized automatically in arrival order — no queue or lock is needed. Broadcast order equals commit
  order.
- Every state-changing path (Events API, `PATCH /api/agents/:id/status`, Tasks API, demo engine, demo
  restore) uses the same private `commitAndBroadcast(work)` helper so there is exactly one place where
  commit and broadcast happen.
- A thrown `AppError` or DB error inside the transaction rolls back; nothing is broadcast.

**Consequences.** + business rules unit-testable without DB/sockets; + atomicity and ordering by
construction. − any future async work (e.g. calling an external service) must happen outside the
transaction, before or after; a long synchronous transaction blocks the event loop (fine at Phase 1 load,
NFR-001 target p95 < 100 ms).

## ADR-009 — Socket.IO message design (server → client only)
· 2026-10-03 · Accepted (adopts and refines the PM suggestion)

**Context.** REQ-050 needs the event plus updated agent/task in one push so the UI updates atomically;
REQ-051 makes the socket server→client only; demo restore changes many entities at once (and deletes
demo tasks).

**Decision.** Default namespace `/`, no rooms in Phase 1 (all clients get everything; filtering is
client-side). Typed `ServerToClientEvents` in shared; `ClientToServerEvents` is empty.
- `office:event` → `{ event: OfficeEvent, agent: Agent | null, task: Task | null }` — exactly one per
  accepted event (incl. `task.created`/`task.updated` and system lifecycle events).
- `demo:state` → `DemoState` (`{ active, intervalMs, startedAt }`) — on start/stop/recovery.
- `office:resync` → `{ reason: "demo-restored" }` — tells clients to re-run the snapshot resync
  (ADR-010). Used instead of per-entity `agent:updated`/`task:updated`/`task:removed` messages because a
  restore touches many rows and deletes tasks, and the resync path already exists and is tested.
The server registers no client handlers; `socket.onAny` logs ignored client messages at `debug`.

**Consequences.** + one listener per message type on the client, trivially de-duplicated. + one code path
for bulk changes. − a restore causes one snapshot fetch per client (cheap locally). Rooms per project /
tenant are a later optimization.

## ADR-010 — Client sync: snapshot endpoint, buffered resync, id dedupe, `version` gating
· 2026-10-03 · Accepted

**Context.** REQ-052/053: on (re)connect the client must recover missed changes, not duplicate feed rows,
and never register duplicate listeners. Live messages can arrive while the resync fetch is in flight.

**Decision.**
- Server adds an integer **`version`** to agents and tasks, incremented on every write to the row
  (including demo restores — a restore never lowers a version).
- New endpoint **`GET /api/snapshot?project=<p>&eventsLimit=<n>`** returns, from one synchronous read,
  `{ agents, tasks, events, projects, demo, serverTime }` (events follow the feed filter semantics,
  default 50, max 500).
- Client sync algorithm (on first connect, every reconnect, and on `office:resync`):
  1. set `syncing = true`, start buffering `office:event` payloads;
  2. fetch the snapshot; on success **replace** agents/tasks/feed/demo wholesale;
  3. replay buffered payloads through the normal reducer; clear buffer; `syncing = false`;
  4. on failure keep last data marked stale, show backend-unavailable state, retry with backoff.
- Reducer rules: agent/task in a payload replace the stored one **only if `version` is greater** (or the
  entity is unknown); a feed row is added only if its `event.id` is not already present; the feed list is
  capped at 200 newest.
- HTTP responses of write calls carry the same `{event, agent, task}` shape and go through the same
  reducer (idempotent with the broadcast).
- The socket is a module-level singleton; listeners are attached once at creation, never inside React
  effects.

**Consequences.** + correct under reconnects, restarts and races; + one reducer for every source.
− `version` is an extra field beyond §2 (additive, documented). A DB reset while a client is connected is
handled because the server restart forces a reconnect → wholesale replace.

## ADR-011 — Demo Mode: server-side engine on the same pipeline, persisted snapshot, restore by event log
· 2026-10-03 · Accepted

**Context.** §16, REQ-110–113, PM-10: demo must use the backend pipeline, be easy to turn off, never
permanently overwrite user state, and survive crashes.

**Decision.**
- `DemoService` runs in the server process; API `GET /api/demo`, `POST /api/demo/start {intervalMs?}`
  (2000–10000, default 3000), `POST /api/demo/stop` (both idempotent).
- **Start** (one transaction): store in `settings` key `demo` the value
  `{ active: true, intervalMs, startedAt, startSeq, snapshot: { agents, tasks } }` where `startSeq` is the
  current max event `seq`; write a `system.info` event (source `system`); commit → broadcast
  `office:event` + `demo:state`. Then schedule ticks with `setTimeout` chaining.
- **Tick**: a pure `nextDemoBeat(state, cursor)` picks the next storyline beat (EVENT_SYSTEM.md §9),
  skipping **user-touched** agents; each produced input goes through `EventService.ingest` with
  `source: "demo"`. A rejection (409/422) is logged at `warn` and the beat is skipped — never silent.
  Demo only creates and mutates its **own** tasks (ids `<PREFIX>-D<n>`, `metadata.demo = true`); it never
  changes pre-existing tasks.
- **User-touched** is derived from the event log, so it is crash-safe with no extra bookkeeping: agents =
  distinct `agent_id` of events with `seq > startSeq`, `source <> 'demo'`, type `agent.*`; tasks =
  distinct `task_id` of events with `seq > startSeq`, `source <> 'demo'` (any type). Conservative: when
  in doubt, user state wins.
- **Stop / restore** (one transaction, function `restoreDemoSnapshot`): for each snapshot agent/task not
  user-touched and differing from the snapshot → restore snapshot fields, `version = current + 1`;
  tasks absent from the snapshot and not user-touched → delete; delete the `demo` setting; write a
  `system.info` summary event. Commit → broadcast `office:event`, `demo:state {active:false}`,
  `office:resync {reason:"demo-restored"}`.
- **Triggers**: user stop; graceful shutdown (SIGINT/SIGTERM); **boot recovery** — if the `demo` setting
  exists at startup, restore runs before the HTTP server listens and demo is not resumed (REQ-113).
- Retention never prunes events with `seq > startSeq` while demo is active (ADR-014).

**Consequences.** + one restore function for three triggers; + no in-memory state needed for safety.
− a user-touched agent keeps a state that may include earlier demo influence, and may reference a deleted
demo task (`taskId` dangling — allowed by REQ-021). Documented limitation.

## ADR-012 — Phaser ↔ React bridge
· 2026-10-03 · Accepted

**Context.** REQ-072/075: exactly one Phaser game per page (StrictMode-safe), live updates without
re-creating the scene, crisp scaling; clicks must open the React detail panel.

**Decision.**
- `office/gameManager.ts` (plain module, outside React) owns at most one `Phaser.Game`.
  `mountOffice(parentEl, bridge)`: if a game exists with a pending destroy for the same parent → cancel the
  destroy and reuse it; if none → create. `unmountOffice()`: schedules `game.destroy(true)` on a short
  timeout (next macrotask). React StrictMode's mount → unmount → mount therefore keeps one instance; a real
  unmount destroys it. `OfficeCanvas.tsx` calls these in `useEffect` and is lazy-loaded (`React.lazy`) so
  Phaser (~1 MB) does not delay the dashboard.
- **Bridge** (`office/bridge.ts`) passed to the scene through scene init data:
  `{ getState(): OfficeViewState; subscribe(listener): () => void; onAgentSelect(id): void;
  onAgentHover(id | null, anchor?: {x, y}): void; reducedMotion: boolean }` (anchor = screen position for
  the HTML tooltip layer of UX.md §5), where
  `OfficeViewState = { agents, projectFilter, selectedAgentId }`. It is implemented over the Zustand store
  (`store.subscribe` with a selector) — the scene never imports React or the store module directly.
- The scene diffs agents by `version` and updates only changed `AgentDesk` containers (label, indicator,
  tween). Unsubscribe on scene `shutdown`/`destroy`.
- Clicks/hover on desk hit areas call `bridge.onAgentSelect/Hover`; React handles panel/tooltips.
  Selection/filter are UI state, not agent state (PM-7 is not affected).
- Scaling: `scale.mode = Phaser.Scale.RESIZE` (canvas = container size), fixed logical world
  **1140 × 540** with the room/desk table of UX.md §5.2 (canonical for `deskId`s); on resize,
  `camera.zoom = min(w / 1140, h / 540, 1.6)` (UX.md §2.2) and the camera centers the world.
  All art is vector `Graphics` + textures generated at boot; `Text` objects use
  `setResolution(devicePixelRatio)` for crisp labels; `roundPixels: true`; no `pixelArt` mode.
  UX.md asks for a DPR backing store (canvas = CSS size × `devicePixelRatio`): RECOMMENDED; implement via
  `Scale.NONE` + manual `game.scale.resize(w·dpr, h·dpr)`, CSS size `w × h`, zoom × dpr **only after a
  spike confirms pointer hit-testing stays correct**; otherwise keep the RESIZE baseline.
- Below 768 px no game is created (UX.md §2.6); crossing the breakpoint mounts/destroys the single
  instance through the same `gameManager`.
- `prefers-reduced-motion` disables tweens (static indicators remain).

**Consequences.** + no duplicate games, no React re-render cost for animation. − Phaser cannot run in
jsdom: component tests mock `gameManager`; the scene logic that maps agent → visual spec is a pure
function (`office/visuals.ts`) tested separately.

## ADR-013 — Production: one port, server runs from TypeScript source via the tsx loader
· 2026-10-03 · Accepted

**Context.** PM-3 allows the server to serve the built web app on one port. Shared is TS source
(ADR-002), so a compiled server would need bundling of shared.

**Decision.** `npm run build` = typecheck all workspaces + `vite build` of `apps/web` → `apps/web/dist`.
The server always runs as `node --disable-warning=ExperimentalWarning --import tsx src/index.ts` (`tsx`
is a runtime dependency of `@vo/server`). With `SERVE_WEB=true` (or a `--serve-web` CLI flag, which avoids
inline env syntax that breaks in PowerShell/cmd), Express serves `apps/web/dist` statically with an SPA
fallback for `GET` requests outside `/api` and `/socket.io`; `/api/*` misses stay JSON 404 (REQ-028).
Dev: Vite on 5173 proxies `/api` and `/socket.io` (`ws: true`) to `http://127.0.0.1:4000` (explicit IPv4:
`localhost` may resolve to `::1` and miss a 127.0.0.1-bound server).

**Consequences.** + no server bundler, identical code in dev/test/prod. − small tsx startup cost;
production hardening (compiled build, process manager) deferred to Phase 9.

## ADR-014 — Event retention: simple count cap
· 2026-10-03 · Accepted (implementation priority: RECOMMENDED for Phase 1; may move to backlog)

**Context.** Demo at 3 s produces ~1 200 events/hour; NFR-002 forbids unbounded growth in the UI, and the
DB grows without limit. REQUIREMENTS §5 lists retention *policies* as out of scope.

**Decision.** `EVENT_RETENTION_MAX` (default 100 000; `0` disables). `retentionService.prune()` runs at boot
and after every 1 000th accepted event: deletes events with `seq <= maxSeq - cap`, never deleting events
with `seq > demo.startSeq` while demo is active. Logged at `info` with the count. No time-based policy, no
archiving. UI lists are capped independently (feed 200, API max 500). Indexes keep queries fast well
beyond 10k rows (NFR-001).

**Consequences.** + bounded disk; trivial code. − old history silently disappears beyond the cap
(documented in README). Real policies (per-project, archive) belong to Phase 9/10.

## ADR-015 — Strict state machines with an explicit, logged `force` escape hatch
· 2026-10-03 · Accepted

**Context.** REQ-011/013 require strict rejection (409). Terminal tasks (`completed`, `cancelled`) can
never leave their state, and an operator occasionally needs to correct a wrong state.

**Decision.** All producer input (`POST /api/events`, demo) is always strict — there is no `force` field
in the event envelope. Only the operator endpoints accept `force?: boolean`:
`PATCH /api/agents/:id/status` and `PATCH /api/tasks/:id`. With `force: true`: status values, ids and all
schema rules are still validated; only transition legality (agent **and** coupled task, incl. terminal
tasks) is skipped; the target status side effects still apply (e.g. leaving `completed` clears
`completedAt`). The stored event has `forced: true`; a `warn` log `forced_transition` records
`{entity, id, from, to}`. The UI may expose force only behind an explicit control (OPTIONAL; not required
in Phase 1 — the simulator stays strict).

**Consequences.** + strictness stays the default and trustworthy; + recovery path exists and is auditable.
− no auth means any local client can force (same trust level as every other write in Phase 1, A-12).

## ADR-016 — Revised agent transition table; task `assigned → review`, `failed → waiting|review`
· 2026-10-03 · Accepted · Changes REQUIREMENTS.md §3.3 and §3.4

**Context.** The baseline table (REQUIREMENTS v1) blocked flows the product needs:
1. The Reviewer and Product Auditor, whose job *is* reviewing, could not enter `reviewing` from `idle` or
   `completed` (needed `idle → working → reviewing`), contrary to §16 "Reviewer reviews", "Product
   Auditor audits".
2. An agent assigned a blocked task could not go `idle → waiting` (§16 "QA waits"), although the task
   machine allows `assigned → waiting`.
3. A task assigned to an idle agent could fail (`assigned → failed` legal) but the agent could not go
   `idle → failed`, so `agent.task.failed` for that task was always rejected.
4. The rules were not expressible as a small set of principles, making docs/tests harder to reason about.

**Decision.** Restate the agent machine as rules and derive the table (see `docs/AGENT_STATE_MACHINE.md`):
R1 any → `offline`; `offline` → `idle` only. R2 any online status → `idle`. R3 resting statuses
(`idle`, `completed`, `failed`) → any active status. R4 between active statuses only the directed flow
`planning→working|waiting`, `working→waiting|reviewing`, `waiting→planning|working|reviewing`,
`reviewing→working|waiting`. R5 `completed` only from `working` or `reviewing`. R6 `failed` from every
online status.
Net change vs v1: **added** `idle→waiting`, `idle→reviewing`, `idle→failed`, `completed→waiting`,
`completed→reviewing`, `completed→failed`, `failed→waiting`, `failed→reviewing` (13 illegal transitions
remain). Task machine: **added** `assigned → review`, `failed → waiting`, `failed → review` (a failed task,
like a failed agent, may re-enter any active status).
Property (tested): for an agent that owns a task whose status mirrors the agent's status, an agent
transition is legal **iff** the mapped task transition is legal — the two machines can never deadlock each
other on the same task (exact statement in AGENT_STATE_MACHINE.md §6; the only exception is a terminal
`completed` task, which by design cannot be restarted).

**Consequences.** All 9 owner examples, `idle → working` (§32) and the REQ-011 examples (`idle →
completed` and `offline → working` illegal) are unchanged. Tests must cover the new 8 × 8 table.

## ADR-017 — Agent/task coupling rules
· 2026-10-03 · Accepted · Clarifies REQ-003, REQ-021, REQ-042; adds error `PROJECT_MISMATCH`

**Context.** REQ-021 said `agent.task.assigned` sets the agent's task fields, but a busy agent being
assigned a second task would then display the wrong task, and REQ-003 already forbids task fields on
idle agents. Lifecycle events from non-assignees and `todo` tasks were unspecified.

**Decision.** (Full rules in `docs/EVENT_SYSTEM.md` §5 and `docs/AGENT_STATE_MACHINE.md` §4.)
- **Task binding**: an agent's `taskId/currentTask/currentProject` are set from the event's task when the
  resulting agent status is not `idle`/`offline`, **except** `agent.task.assigned` without an explicit
  `status` (assignment is recorded on the task only; the agent binds when it starts work).
- **Ownership**: task effects of an agent event apply only if the task's `assignedAgentId` is the event's
  agent, or is `null` (the task is then claimed: `assignedAgentId = agentId`). Events from non-assignees are
  stored and update the agent, but never change the task (e.g. Reviewer reviewing Backend's task).
  `agent.task.assigned` is the exception: its purpose is to set the assignee.
- **Implicit assignment**: a `todo` task that is, or becomes in the same operation, assigned is validated
  as if it were `assigned` (`todo → assigned` is legal), then the requested transition is checked.
- **Project consistency**: explicit event `project` ≠ existing task's project → 422 `PROJECT_MISMATCH`.
- Generic agent events (`agent.status.changed/activity/message`) change a task only when they change the
  agent's status (REQ-042, unchanged); they never use the agent's *current* task implicitly.

**Consequences.** + the UI never shows an agent "working" on a task it was merely queued for. − producers
must include `taskId` to keep a task in sync (documented; simulator should preselect the agent's current
task — RECOMMENDED for UX).

## ADR-018 — Structured logging with a minimal in-house JSON logger
· 2026-10-03 · Accepted

**Context.** REQ-150/151: JSON lines, low noise, `LOG_LEVEL`, silent tests.

**Decision.** `apps/server/src/logger.ts` (~50 lines, no dependency): levels `debug|info|warn|error|silent`;
`logger.info(msg, ctx?)` writes one JSON line `{time, level, msg, ...ctx}` to stdout (`warn`/`error` to
stderr); `logger.child(ctx)`. `msg` is a stable snake_case key (e.g. `event_rejected`). Never logs full
payloads, metadata or stack traces at < `error`. Rejected: pino (fine, but extra deps + pretty printer for
readability), winston (heavy).

**Consequences.** + zero deps, easy to assert in tests. − no log rotation/transport (not needed locally).

## ADR-019 — Local-only security posture
· 2026-10-03 · Accepted

**Context.** §26, REQ-160–164, A-12: no auth in Phase 1; the server must still not be an easy target from
other machines or from websites open in the owner's browser.

**Decision.** Bind `HOST=127.0.0.1` by default (startup `warn` if non-loopback). CORS (Express and
Socket.IO) limited to `CORS_ORIGINS` (default `http://localhost:5173,http://127.0.0.1:5173`). Write
endpoints require `Content-Type: application/json` (other types → 400 `INVALID_JSON`), which forces a CORS
preflight for cross-site browsers. **RECOMMENDED**: a Host-header allowlist middleware (`localhost`,
`127.0.0.1`, `[::1]`, any port) for HTTP and Socket.IO `allowRequest`, against DNS-rebinding. Body limit
100 KB, `metadata` 8 KB. No rate limiting in Phase 1 (loopback only; demo interval ≥ 2 s); listed for
Phase 8/9. No endpoint executes commands or touches the filesystem beyond the DB file and static web dist.

**Consequences.** + realistic local threat model covered cheaply. − anything running locally can write
events (accepted for Phase 1, documented in SECURITY.md by the security engineer).

## ADR-020 — Error handling: `AppError` + one error-envelope middleware
· 2026-10-03 · Accepted

**Context.** REQUIREMENTS §3.5 defines one error body and code table for every endpoint.

**Decision.** `apps/server/src/errors.ts` exports `class AppError { status; code; message; details? }` and
factory helpers (`notFound`, `unknownAgent`, `illegalTransition(entity, id, from, to)`, …). Error codes are
a shared constant (`@vo/shared` `ERROR_CODES`) so the web client can switch on them. The final Express error
middleware maps: `AppError` → its status/body; body-parser `entity.parse.failed` → 400 `INVALID_JSON`;
`entity.too.large` → 413 `PAYLOAD_TOO_LARGE`; `ZodError` → 400 `VALIDATION_ERROR` with
`details: [{path, message}]`; anything else → 500 `INTERNAL_ERROR` (logged at `error` with stack, body
without stack/SQL). 4xx are logged at `warn` with `{code, method, route}`. A `/api` catch-all returns 404
`NOT_FOUND` JSON. Express 5 forwards async handler rejections automatically.

**Consequences.** + uniform, testable error behavior; the web `api/client.ts` turns any non-2xx into an
`ApiError {status, code, message, details}`.

---

*ADR-021…028 added by tech-lead (contracts step, 2026-10-03). Exact contracts: `docs/API_CONTRACTS.md`.*

## ADR-021 — Response envelope `{ data }` and `seq`-cursor paging
· 2026-10-03 · Accepted · Refines ARCHITECTURE §6, EVENT_SYSTEM §6 step 11 and §8.1, ADR-009/010

**Context.** The PM fixed the success envelope as `{ data }` and the error envelope as
`{ error: { code, message, details? } }`. ARCHITECTURE/EVENT_SYSTEM described write responses as a bare
`{event, agent, task}` body that is "identical to the socket payload".

**Decision.** Every 2xx body is `{ "data": <payload> }`; paged lists add
`"page": { "limit", "nextBefore" }` where `nextBefore` is the `before` value for the next older page (`null` =
no older items; the server reads `limit + 1` rows to decide). Write endpoints return
`{ data: { event, agent, task } }`; the socket `office:event` payload equals `data` (not the whole body).
No-op writes return `event: null`. Socket payloads are never wrapped. Only `GET /api/events` is paged in
Phase 1 (`GET /api/tasks` returns ≤ 500 rows, unpaged).

**Consequences.** + one client unwrap rule (`apiRequest` returns `data`). + room for `page`/`meta`
without breaking clients. − docs that show the bare body must be read as "the `data` of the response"
(documentation-engineer aligns ARCHITECTURE/EVENT_SYSTEM wording in TASK-010).

## ADR-022 — Operator and simulator write paths; Force not in the UI
· 2026-10-03 · Accepted · Resolves UX I-1, I-2, I-3; refines ADR-011, ADR-015

**Context.** UX raised: force control (I-1), Logs tab labelling (I-2), missing demo endpoints (I-3). The
simulator needs a clean "same status = no change" response, which `POST /api/events` does not give (a
same-status event is stored as a status no-op with other effects).

**Decision.**
- **I-1:** no Force control in the simulator in Phase 1. `force` exists only on `PATCH
  /api/agents/:id/status` and `PATCH /api/tasks/:id`. The simulator shows the server's 409 message inline.
- `PATCH /api/agents/:id/status` additionally accepts `source?` (same rules as the envelope; reserved
  sources rejected; default `api`) and `action?`. Simulator **status buttons** call this endpoint with
  `source: "simulator"` (the server writes `agent.status.changed`; same status → full no-op with
  `event: null`). Simulator **Send Event** calls `POST /api/events` with `type: "agent.activity"`,
  `source: "simulator"`. Both go through `EventService` (PM-7).
- **I-2:** Logs tab = log lines derived from the agent's real stored events with the notice "Derived from
  stored events — live log streaming arrives in Phase 2" (REQUIREMENTS v1.2 REQ-082). Files/Git keep the
  sample label.
- **I-3:** demo endpoints are `GET /api/demo`, `POST /api/demo/start {intervalMs?}` (idempotent, returns
  `DemoState`), `POST /api/demo/stop {}` (idempotent, returns `{ demo, restored: DemoRestoreSummary | null }`
  so the UI can show restore counts). Both POSTs require `Content-Type: application/json` like every write.

**Consequences.** + simulator feedback maps 1:1 to responses; + no dead controls. − a second write path
for status (PATCH) — it is a thin wrapper around `EventService.ingest`, tested for parity with POST.

## ADR-023 — Human-readable, stable error messages
· 2026-10-03 · Accepted · Resolves UX I-6; refines ADR-020

**Context.** The UI displays `error.message` verbatim (UX §9.5); REQ-102 quotes
`Illegal transition: idle → completed`.

**Decision.** Error messages are part of the contract (API_CONTRACTS §2.2): e.g. agent
`Illegal transition: <from> → <to>` (U+2192, raw status values), task
`Illegal task transition: <from> → <to> (task <id>)`, `Unknown agent: <id>`, `Unknown project: <value>`,
`Validation failed: <path>: <message> (+n more)`. Custom Zod messages are defined for unknown keys
(`Unrecognized key`, one issue per key with `path` = key), unknown/server-only event types and reserved
sources. `toValidationIssues` (shared) performs the mapping so server and web agree. Messages never contain
stack traces, SQL or payload content beyond the offending identifier.

**Consequences.** + UI needs no message tables for server errors; tests can assert exact strings.
− changing a message is a contract change.

## ADR-024 — Tasks API rules (create statuses, auto-assignment, id generation, no-op PATCH)
· 2026-10-03 · Accepted · Refines REQ-040/041, ADR-017

**Context.** REQ-040/041 leave open which statuses a new task may have, what happens when only the
assignee changes, and whether an unchanged PATCH writes an event.

**Decision.**
- `POST /api/tasks` accepts `status` ∈ {`todo`, `assigned`} only; default `assigned` when
  `assignedAgentId` is given, else `todo`. `assigned` without assignee → 400; `todo` with assignee → 400.
  Other statuses are reached through PATCH or agent events (keeps the task machine meaningful).
- Generated id `<taskPrefix>-<n>`, `n` = 1 + max numeric suffix among ids `^<prefix>-\d+$`, computed inside
  the creating transaction. Client ids are allowed (pattern only); duplicates → 409 `TASK_EXISTS`.
- `blockedBy`: ≤ 20 ids, duplicates removed (order kept), each must exist (422 `UNKNOWN_TASK`), never the
  task's own id (400).
- PATCH without `status`: setting an assignee on a `todo` task → `assigned`; clearing the assignee of an
  `assigned` task → `todo`; otherwise status unchanged. With `status`: legality uses implicit assignment
  (`canTransitionTask(from, to, { owned: assigneeAfter !== null })`).
- `progress` cannot change on a terminal task (409) unless `force`; entering `completed` forces 100.
- A PATCH whose provided fields all equal the stored values is a no-op: 200 with `event: null`, nothing
  stored or broadcast (mirrors REQ-004).
- `task.updated` events carry `metadata.changes` (sorted changed field names); `agentId` = assignee after the
  update. PATCH never changes agent rows (REQ-041).

**Consequences.** + deterministic, testable task writes. − creating a task directly `in_progress` takes two
calls (acceptable; producers normally use agent events).

## ADR-025 — Frontend seam: `OfficeCanvas` props; visual constants in `@vo/shared`
· 2026-10-03 · Accepted · Refines ADR-012 (bridge stays, but becomes internal to `office/`)

**Context.** The web shell (TASK-006) and the Phaser office (TASK-007) are built in parallel by two
engineers. ADR-012's bridge was implemented "over the Zustand store", which would make the office code
depend on the store module owned by the other task. Status/department colors and status labels are needed
by both React and Phaser.

**Decision.**
- The only seam is the lazily-loaded default export of `apps/web/src/office/OfficeCanvas.tsx` with the props
  in API_CONTRACTS §10.2 (`agents, projectFilter, selectedAgentId, reducedMotion, paused, onAgentSelect,
  onBackgroundClick, onAgentHover`). Inside `office/`, OfficeCanvas feeds props into the ADR-012 bridge
  (`getState/subscribe/onAgentSelect/onAgentHover`) and the `gameManager` singleton; the scene still diffs by
  `version` and never re-creates on updates. Re-rendering the OfficeCanvas wrapper is cheap (it renders one
  `div`).
- HTML tooltip, `role="img"` summary, Suspense placeholder, breakpoint (< 768 px no game) and host sizing are
  the shell's job; canvas drawing, animation, LOD, dimming and hit-testing are the office's job.
- `UI_COLORS`, `STATUS_COLORS`, `DEPARTMENT_COLORS`, `TASK_STATUS_COLOR_KEY`, `PRIORITY_COLORS`, status/priority
  labels, and the office layout (`OFFICE_ROOMS`, `OFFICE_WORLD`, `DESK_SLOT`, `AGENT_DISPLAY_ORDER`) live in
  `@vo/shared` (plain data, platform-neutral). Tailwind `@theme` repeats the hex values (CSS cannot import TS);
  a web test asserts they match the shared palette.
- ESLint `no-restricted-imports` enforces the boundary (only `office/**` imports `phaser`; `office/**` imports
  no shell modules; the shell imports only `office/OfficeCanvas`).

**Consequences.** + zero shared files between TASK-006 and TASK-007; + one color/label source.
− shared contains UI copy/colors (acceptable: data only; localization later swaps the label module).

## ADR-026 — Toolchain and dependency versions
· 2026-10-03 · Accepted · Refines PM-4/PM-5, ARCHITECTURE §8

**Context.** Registry check on 2026-10-03 (npm 11.6.2, Node 24.12.0): latest are TypeScript 7.0, ESLint 10,
Vitest 5.0 (released 2026-09-03), Vite 8.3, React Router 8.4 (requires Node ≥ 22.22), jsdom 30 (requires Node
≥ 24.15 on the 24 line — **incompatible with the installed 24.12**), Phaser 4.2. typescript-eslint 8.71 supports
TypeScript < 6.1 and ESLint 8/9/10.

**Decision.** Pin majors per `docs/IMPLEMENTATION_PLAN.md` §3: TypeScript `~5.9.3`, ESLint `^9.39`
(PM-5), typescript-eslint `^8.71`, Vite `^8.3`, Vitest `^4.1.11` (mature line that supports Vite 8; Vitest 5 is
one month old — upgrade is BACKLOG), `@vitejs/plugin-react` `^6.1`, React `^19.3`, React Router `^7.18`
(stable line; v8 brings nothing Phase 1 needs), Phaser `^3.90.0` (never 4, PM-4), Tailwind `^4.3` +
`@tailwindcss/vite`, Zustand `^5.0`, Zod `^4.6`, Express `^5.2`, Socket.IO/client `^4.8`, jsdom `^29.1`
(Node 24.12-compatible), `@types/node` `~24.19` (matches Node 24), Prettier pinned exactly `3.9.9`.
If the TASK-001 smoke tests show Vite 8/Vitest 4.1 friction with `node:sqlite` (R-2), DevOps may fall back to
Vite 7 + `@vitejs/plugin-react` 5 and records the change here.

**Consequences.** + versions known to install on this machine without engine conflicts. − a later upgrade
wave (TS 6/7 once typescript-eslint supports it, Vitest 5, React Router 8) is backlog work.

## ADR-027 — Phase 1 scope adjustments and small rules
· 2026-10-03 · Accepted

**Decision.**
1. **Host-header guard is REQUIRED** (was RECOMMENDED in ADR-019): HTTP middleware and Socket.IO
   `allowRequest` accept only `localhost`, `127.0.0.1`, `[::1]` and the configured `HOST`; otherwise 403
   `HOST_NOT_ALLOWED` (new error code). Reason: cheap, and the only defence against DNS rebinding for an
   unauthenticated server.
2. **Every POST/PATCH requires `Content-Type: application/json`**, including the demo endpoints (body `{}`), so
   no cross-site "simple request" can change state; an empty JSON body is `{}`.
3. **Event retention (ADR-014) is deferred to BACKLOG** (BL-001): 30 min of demo ≈ 600 events; no Phase 1
   requirement depends on it. `EVENT_RETENTION_MAX` is therefore not in `.env.example`.
4. **Demo task ids** are `<PREFIX>-D<startSeq>-<cycle><a|b|c|d>` (e.g. `SW-D57-1a`) so ids are unique across
   demo sessions and never match `^<PREFIX>-\d+$` (no effect on id generation). Refines ADR-011/ES §9
   (`<PREFIX>-D<n>`).
5. **Shared package name is `@vo/shared`** (confirmed by the PM).
6. In request bodies, `null` for an optional field means "absent", except documented nullable fields
   (`PATCH /api/tasks/:id` `description`, `assignedAgentId`).

**Consequences.** + smaller Phase 1; − retention must be added before long-running real producers (Phase 2).

## ADR-028 — Contract-file ownership for parallel implementation
· 2026-10-03 · Accepted

**Context.** Database, server-rules and app-assembly work run in parallel and must compile against the same
interfaces; two parallel tasks must never create the same file.

**Decision.** Contract files are created **before** the parallel wave by the task that precedes it, verbatim
from API_CONTRACTS, and then handed over:
- `apps/server/src/db/types.ts` (repository interfaces, patches, `DatabaseHandle`) — created by TASK-002,
  owned afterwards by TASK-003 (database-engineer).
- Stubs created by TASK-001 and handed over: `apps/server/src/index.ts` → TASK-008,
  `packages/shared/src/index.ts` → TASK-002, `apps/web/src/main.tsx`, `src/App.tsx`, `src/styles/index.css` →
  TASK-006, `apps/web/src/office/OfficeCanvas.tsx` → TASK-007.
- `packages/shared/src/adapters/index.ts` starts as `export {}` (TASK-002) and is owned by TASK-004.
Any signature change goes through the tech-lead (contract update + DECISIONS entry) before code changes.

**Consequences.** + parallel tasks never touch the same file; typecheck works from the first commit of each
task. − one small cross-area file creation per handover (documented in each task).

## ADR-029 — Scaffolding outcomes: jest-dom 7, LF line endings, shared typings, R-2/R-18 results
· 2026-10-04 · Accepted · Refines ADR-026 (TASK-001, devops-engineer)

**Context.** TASK-001 installed the ADR-026 dependency set on Windows 11 / Node 24.12.0 / npm 11.6.2 and ran
the smoke tests. Findings: (1) `@testing-library/jest-dom@6.10.0` (the only version matching `^6.10.0`) is
deprecated upstream: "Incorrect minor release with breaking changes (Node >=22 and required
@testing-library/dom peer). Use 6.9.1 for the 6.x line, or upgrade to 7.0.0." (2) Git for Windows ships
`core.autocrlf=true` system-wide, so a fresh clone would check files out with CRLF while Prettier enforces
LF → `npm run format:check` would fail on every file. (3) API-C §5 allows `TextEncoder` in `@vo/shared`, but
`lib: ES2023` alone does not declare it. (4) R-2 and R-18 needed evidence.

**Decision.**
1. `apps/web` uses `@testing-library/jest-dom` `^7.0.1` (installed 7.0.1) instead of `^6.10.0`: same
   `@testing-library/jest-dom/vitest` entry and matchers; its requirements (Node ≥ 22, peer
   `@testing-library/dom` 10) are already met. Every other ADR-026 range resolved unchanged.
2. Add `/.gitattributes` with `* text=auto eol=lf` (binary fonts/images/DB excluded) so the working tree is LF
   on every OS; `.prettierrc.json` sets `endOfLine: "lf"`, `.editorconfig` matches.
3. `packages/shared/tsconfig.json` uses `lib: ["ES2023"]` + `types: ["node"]` (provides `TextEncoder`; the
   Vitest/Vite typings pull in `@types/node` anyway). Platform neutrality is enforced by ESLint instead:
   `no-restricted-imports` (all Node built-ins with and without `node:`, express, react, react-dom, phaser,
   socket.io*, the apps) and `no-restricted-globals` (`process`, `Buffer`, `__dirname`, `__filename`,
   `require`, `module`, `global`, `window`, `document`, `navigator`, `localStorage`, `sessionStorage`).
4. R-2 resolved with the primary stack (no Vite 7 fallback): Vitest 4.1.11 on Vite 8.3.2 loads `node:sqlite`
   with `environment: 'node'`, `pool: 'forks'`; no `server.deps` tweak was needed. The `ExperimentalWarning` is
   suppressed with `test.execArgv: ['--disable-warning=ExperimentalWarning']` in `apps/server/vitest.config.ts`
   (verified: the warning appears without it and is absent with it).
5. R-18 checked: `node --watch --import tsx` restarts the server when a file in `packages/shared/src` changes
   (followed through the `node_modules/@vo/shared` workspace link). The `dev` script stays as in API-C §12.2;
   the `tsx watch` fallback is not needed.
6. `scripts/verify.mjs` calls `spawnSync('npm run <step>', { shell: true })` with one command string: an args
   array combined with `shell: true` triggers Node 24's DEP0190 warning.

**Consequences.** + clean install on this machine with 0 vulnerabilities and no `EBADENGINE`; + fresh clones
pass `format:check` on Windows. − `npm install` still prints one deprecation notice: ESLint 9.39.x is out of
support upstream (ESLint 10 is current). ESLint 9 is kept per PM-5; the move to ESLint 10 belongs to the
toolchain upgrade wave in BACKLOG.

## ADR-030 — `@vo/shared` schema interpretations (TASK-002)
· 2026-10-04 · Accepted · Clarifies API_CONTRACTS §0, §2.2, §3, §5.2 (backend-engineer, TASK-002). No signature changes.

**Context.** Implementing the shared Zod schemas exposed points where the contract is silent or two rules
conflict. Each choice below is the option most consistent with the docs; all are covered by shared tests.

**Decision.**
1. **Empty query values are invalid (400), not absent.** §0 says optional strings that are empty after trim are
   absent, but §3.3 lists "empty `project`" as 400 and §0 requires numbers in queries to be digits only. The
   specific rule wins for every query parameter: `?project=`, `?limit=`, `?type=` → 400 `VALIDATION_ERROR`.
   In **bodies** the §0 rule applies (optional blank or `null` → absent). A repeated query key arrives as an
   array and is rejected ("expected string").
2. **Enum-valued fields are exact tokens, not trimmed** (`type`, `status`, `severity`, `priority`, query
   enums): `"agent.activity "` → `Unknown event type: agent.activity `. Free-text fields (ids, project,
   source, action, message, title, description, occurredAt) are trimmed. Reason: trimming an enum needs a
   string pre-step that would widen `EventInputBody` from literal unions to `string` and weaken the web and
   adapter typing.
3. **Extra custom messages** (allowed: §2.2 lets every other message be a Zod default): the Developer
   Simulator copy of UX §9.5 is produced by the shared schema itself — `Action is required.`,
   `Action must be 100 characters or fewer.`, `Message is required.`, `Message must be 2,000 characters or
   fewer.` — plus `Metadata must be a JSON object`, `Metadata must contain only JSON values`, readable
   pattern messages for task ids and sources, and `Expected a whole number (digits only)` for query numbers.
4. **Echoed values are bounded:** `Unknown event type: <value>` shows at most 100 characters of the value,
   then `…` (ADR-023: no payload content beyond the offending identifier).
5. **`metadata`:** a plain object (also null-prototype) of JSON values; `undefined` property values are
   ignored as by `JSON.stringify`; dates, maps, functions, non-finite numbers, `undefined` array items →
   400. The check walks iteratively and stops after 8 192 values, so cyclic or hostile deeply nested input
   yields `Metadata exceeds 8 KB` instead of a stack overflow. The parsed value is the input object itself
   (stored verbatim). Byte length helper `jsonByteLength` is exported for server reuse.
6. **Body outputs omit absent fields** (keys that were `null`/blank are removed), except documented nullable
   fields of `PATCH /api/tasks/:id`: `description: null` or `""` → `null` (clears); `assignedAgentId: null`
   → `null` (unassigns), `assignedAgentId: ""` → absent. Defaults in parsed output: `agentStatusPatchSchema`
   `source "api"`, `force false`; `taskPatchSchema` `force false`; `taskCreateSchema` per §3.9.
   `demoStartSchema` has **no** default `intervalMs` — the server applies `DEMO_DEFAULT_INTERVAL_MS`.
7. **`blockedBy`:** the 20-item limit applies to the array as sent (before de-duplication); output is
   de-duplicated keeping first-occurrence order. `taskPatchSchema` cannot know the path id, so the
   "own id → 400" rule of §3.10 must be enforced by the server (TASK-005/008) with the same issue
   `{ path: "blockedBy", message: "A task cannot block itself" }`.
8. **Exported schema types are inferred, not annotated** as `z.ZodType<string>` (an annotation would erase the
   input type to `unknown` and make `EventInputBody` useless). Shared type tests assert that each field
   schema is assignable to its §5.2 signature and that `z.output` of both event schemas equals `EventInput`
   per member.
9. Cross-field rules (task create status/assignee, blockedBy self-reference, PATCH "at least one field") are
   evaluated only when every field is individually valid (Zod 4 skips refinements after field errors).

**Consequences.** + server and web share identical validation and messages; + typing of producer bodies stays
precise. − a producer sending padded enum values gets a 400 (documented behavior). − TASK-005/008 own the
PATCH self-block check (item 7).

## ADR-031 — Database layer additive deviations (TASK-003)
2026-10-04 · Accepted (PM, on behalf of tech-lead) · Context: TASK-003 report.

**Context.** The database engineer implemented `apps/server/src/db/**` and `seed/**` with additive deviations
from API-C §9; none breaks a contracted signature used by TASK-005/008.

**Decision.** Accept all of them:
1. `openDatabase` returns `OpenedDatabaseHandle` = `DatabaseHandle` + `migrations: {from, to}` (TASK-008 logs
   `migrations_applied`).
2. `runMigrations(db, migrations = MIGRATIONS)` — optional second argument for tests only.
3. `runMigrations` refuses a DB whose `user_version` is newer than the code supports (fail fast, no unknown schema).
4. `resetDatabase` is async (port probe) with options `{dbPath, repoRoot, host, port, now?, connectTimeoutMs?}`;
   wildcard HOST is probed via loopback.
5. Repository `update`/`replace` read-merge-write all mutable columns; an empty patch still bumps `version`;
   list limits < 1 throw `RangeError`.
6. Seed history contains 3 `task.created` + 1 `task.updated` events (source `api`); `occurredAt` is null on seeded events.
7. Extra helper files: `repositories/index.ts`, `repositories/statements.ts`, `db/testing.ts` (test fixtures only).

**Consequences.** + safer migrations and reset; + TASK-008 can log migration ranges. − async transaction
callbacks remain a review-discipline item (ADR-004): the transaction rolls back and throws, but code continuing
after an aborted async callback could write outside it — code-reviewer must check that no `await` happens inside
`transaction()`.

## ADR-032 — Server core interpretations (TASK-005)
2026-10-04 · Accepted (PM, on behalf of tech-lead) · Context: TASK-005 report.

**Decision.** Accept the TASK-005 contract interpretations:
1. Decision patches contain only changed fields; `agentPatch` always includes `lastActivityAt`; `taskEffect` is null
   when no task field changes.
2. Stored event `status` = the explicit input status or null. Default severity derives from the status the event
   actually sets (activity on an already-failed agent → `info`).
3. Binding an unknown taskId without a project keeps the agent's `currentProject`.
4. Events change task progress only via `agent.task.progress`; it returns 409 on an owned/claimable terminal task
   even with the same value. Task PATCH uses change semantics (no-op check first); entering `completed` via PATCH
   ignores body progress (sets 100).
5. `agent.task.assigned` 409 reports `to: "assigned"` when the assignment step fails, otherwise the mapped status.
   A task created by `agent.task.assigned` with an explicit status is created directly in the mapped status.
6. Tasks created by `agent.task.assigned` get metadata `{demo:true}` when source is `demo`, else `{}`; title
   truncated to 200 chars.
7. Task PATCH auto-status triggers when `assignedAgentId` is present in the body; `metadata.changes` lists every
   changed field including side effects.
8. `.env` parsed with `util.parseEnv` and merged under the real environment (process.env not mutated); blank values
   = unset; `LOG_LEVEL`/`SERVE_WEB` case-insensitive; CORS entries normalized to origins.
9. Logger: errors serialized as `{name, message}` (stack only on `error` lines); unserializable context never throws;
   reserved keys `time|level|msg` dropped from context.
10. Extra (non-contracted) exports allowed: `REPO_ROOT`, `MEMORY_DB_PATH`, `SERVE_WEB_FLAG`, `readDotEnvFile`,
    `LOG_LEVELS`, `checkSelfBlock`, `SELF_BLOCK_ISSUE`, `jsonEqual`, `DEMO_*`, `RecordedMessage`.
11. `apps/server/src/services/testHarness.ts` approved as a test-only helper (never imported by production code).
12. Demo storyline bridges illegal seeded states (e.g. PM `working → idle → planning`) and skips inputs that would
    still be rejected; offline agents are bridged with `agent.connected`.

**Consequences.** + rules are pure and exhaustively tested (336 tests incl. 8 demo cycles with zero rejections).
− TASK-008 must call `checkSelfBlock` right after schema parsing (400 before 404/422), discard same-status decisions
on PATCH agent status (full no-op), and keep every `-D<sessionKey>-` demo task in the demo world.

## ADR-033 — Frontend implementation deviations (TASK-006, TASK-007)
2026-10-04 · Accepted (PM, on behalf of tech-lead / ui-ux-designer) · Context: TASK-006 and TASK-007 reports.

**Decision.** Accept:
- TASK-006 (shell):
  1. Extra store mutators fed only by server data: `applyDemoState` (`demo:state` + demo responses) and the feed
     loader (`setFeedProject` / `hydrateFeed` / `feedFailed`) for `GET /api/events?project=`. No optimistic writes.
  2. One HTTP snapshot fetch at startup in addition to the snapshot resync on every socket connect, so the page
     loads even if the socket cannot connect. If the first connection never succeeds: `Connecting…` → `Disconnected`
     after 30 s.
  3. The simulator "Allowed from <status>" hint is computed from the shared state machine (ADR-016), not the UX example.
  4. The simulator dock precedes the feed in tab order (it lives in the main column).
  5. "Show more" on Last message appears for > 280 chars or > 6 lines.
  6. `GET /api/agents/:id` used by the panel is not written to the store; the panel shows the higher-`version` copy.
  7. The mobile view switch uses pressed-state buttons instead of ARIA tabs.
- TASK-007 (office):
  1. `office/layout.ts` is named `office/officeLayout.ts` (the §10.1 lint regex false-positive on `../layout`).
  2. All art is vector Graphics redrawn on state change (no baked bitmap textures).
  3. Canvas-only art colors (bezel, desk, chair, screen fills) live in `office/palette.ts`; token colors come from `@vo/shared`.
  4. No high-DPI backing store (ADR-012 plain `Scale.RESIZE`); text renders at device resolution. DPR spike stays in BL-003.
  5. Vacant desk (agent missing) = furniture at alpha .5, not clickable. Phaser chunk load failure shows
     "Office view could not be loaded.".

**Consequences.** + resilient startup; + consistent rules in UI and server. − the Phaser chunk (~1.2 MB, lazy) triggers
Vite's chunk-size warning (TASK-009 decides on `chunkSizeWarningLimit`).

## ADR-034 — Server app assembly deviations (TASK-008)
2026-10-04 · Accepted (PM, on behalf of tech-lead) · Context: TASK-008 report.

**Decision.** Accept (all additive):
1. `index.ts` exports `boot()` → `{ server, shutdown() }`; `main()` (signals, `uncaughtException`, `unhandledRejection`)
   runs only when the file is the entry point; a shutdown exceeding 5 s is forced with exit code 1.
2. Extra methods/exports: `TaskService.listTasks`, `DemoService.tick()`, `parseInput`, `insertEvent`,
   `restoreDemoSnapshot`, `DEMO_SETTING_KEY`, `createIoBroadcaster`; `createTestApp` accepts optional
   `config/logger/clock/database` and returns `port`; `captureLogger` test helper.
3. `requireJson` runs only on matched routes (unknown `/api/*` is always 404); the error handler is mounted on the
   `/api` router so `request_failed.route` keeps the prefix.
4. Socket connect/disconnect `clients` = namespace socket count.
5. The demo world loads every task (no 500 cap) filtered by `-D<startSeq>-` (ADR-032).
6. Restore safety beyond ADR-011: a task is deleted only if absent from the snapshot, untouched, and
   `metadata.demo === true`; if the `demo` setting is lost mid-session, stop restores nothing, logs
   `demo_setting_invalid` and writes a zero summary.
7. HTTP test files disable `no-unsafe-*` per file (supertest `res.body: any`) — to be replaced by a test-files override
   in `eslint.config.js` (devops, RECOMMENDED).

**Consequences.** + safer demo restore; + testable boot. − real SIGINT/SIGTERM not exercised live on Windows (path is
tested via `boot().shutdown()`).

## ADR-035 — Review round 1 fixes: socket Origin check, listen-first boot, resync watermark (CR-1…CR-11)
2026-10-04 · Accepted (PM, on behalf of tech-lead) · Context: `tasks/reports/VO-000-review.md` (VERDICT: FAIL).

**Decision.**
1. **CR-1 Socket.IO Origin check.** `allowRequest` checks Host (existing) AND `Origin`: allowed when absent
   (non-browser producers/tests), when it is in `CORS_ORIGINS`, or when it equals the request's own origin
   (`http://<Host>`, one-port mode). Everything else is rejected (handshake 403, logged `socket_rejected` with reason).
   API-C §4 is updated accordingly.
2. **CR-2 Listen-first boot.** Boot order becomes: config → open DB + migrate → **listen** (port = single-instance lock)
   → seed if empty → demo crash recovery → ready. Until ready, `/api/*` (except `/api/health`, which reports
   `status:"starting"` with 503) returns 503 `SERVICE_UNAVAILABLE` and socket connections are refused. A failed
   listen (EADDRINUSE) exits before touching any data. API-C §9.8 is updated.
3. **CR-4 Resync watermark.** `GET /api/snapshot` data gains `lastSeq: number` (highest stored event seq at read
   time, 0 if none; `@vo/shared` Snapshot type). The client discards buffered `office:event` messages whose
   `event.seq <= lastSeq` when replaying after a snapshot.
4. **CR-6 Snapshot task cap.** The snapshot returns the newest 500 tasks (by `createdAt` desc, then id) — plus every
   task referenced by an agent's `taskId` — instead of the oldest 500.
5. **CR-3** `demo:state` received while a resync is in flight wins over the snapshot's demo field (buffered and
   re-applied after the snapshot). **CR-5** a React error boundary wraps the office card (and the app root) with a
   visible error + Retry. **CR-10** one snapshot request per page load. **CR-11** feed day-divider labels do not
   re-render the whole feed every second.
6. **CR-7** dev launcher `scripts/dev.mjs` (no shell, kills both process trees on exit/signal on Windows via
   `taskkill /T /F`, pre-checks ports 4000/5173 and names the holder). `npm run dev` uses it.
7. **CR-8** handle `SIGHUP` and `SIGBREAK` like SIGINT/SIGTERM. **CR-9** demo restore never deletes a demo task still
   referenced by a kept agent's `taskId` or a kept task's `blockedBy` (it is kept and logged instead).
8. Deferred to backlog: CR-12, CR-13, CR-14 (frontend polish/tests), CR-15 (eslint test override) unless cheap.

**Consequences.** + closes cross-origin read of the live stream; + a second instance can no longer corrupt a running
demo; + resync is gap/duplicate-safe. − brief 503 window during boot.

## ADR-036 — Dev launcher `scripts/dev.mjs` and lint/build follow-ups (CR-7, CR-15)
2026-10-04 · Accepted (devops-engineer) · Implements ADR-035 §6; also CR-15 and two TASK-007 RECOMMENDED items.

**Decision.**
1. `npm run dev` = `node scripts/dev.mjs` (`dev:server` / `dev:web` unchanged). The launcher spawns
   `process.execPath` directly (no shell, no npm layers): the server with the exact `dev:server` arguments
   (`--watch --disable-warning=ExperimentalWarning --import tsx src/index.ts`, cwd `apps/server`) and
   `vite/bin/vite.js` (cwd `apps/web`); output is line-prefixed `[server]` / `[web]` (colors only on a TTY).
2. Preflight: if 4000 or 5173 accepts connections (127.0.0.1 or ::1), print the holder (PID, image, command
   line via `Get-NetTCPConnection` + `Win32_Process`; `lsof` elsewhere), start nothing, exit 1. It never kills
   a foreign process.
3. Stop paths (all verified on Windows 11, see TASK report): SIGINT/SIGBREAK/SIGHUP/SIGTERM, either child exiting,
   the npm parent disappearing (launcher watches its parent and, under `npm run`, the npm process — the CR-7
   case), and the launcher itself being hard-killed (a detached reaper `dev.mjs --reaper` kills the children's
   trees when the launcher PID is gone; it never kills a PID after that process has exited). Kill = `taskkill
   /PID <pid> /T /F` on win32, process-group `SIGKILL` elsewhere (children are `detached` on POSIX). After a
   console signal the launcher waits up to 3 s for the children and the ports, then force-kills; a leftover
   4000/5173 listener is killed only if its PID or parent PID is one of the launcher's children.
4. Children are spawned **without** `windowsHide`: Node maps it to `CREATE_NO_WINDOW`, which gives each child
   its own hidden console, so a terminal Ctrl+C would never reach the server.
5. ESLint: test files (`**/*.test.{ts,tsx}`, `apps/server/test/**/*.ts`) turn off `no-unsafe-argument/assignment/
   call/member-access/return` (supertest bodies are `any`); the per-file disables were removed. The office
   boundary of API-C §10.1 is generated per directory depth, so `../X` is flagged only when it really leaves
   `src/office/` (`office/objects/*` may import `../layout` = `office/layout`).
6. Vite `build.chunkSizeWarningLimit: 1300` for the lazily loaded Phaser chunk (1 223 kB).
7. (TASK-009) When the launcher is started with an IPC channel, `disconnect` stops it like a signal — this is how
   `npm run smoke -- --dev` stops it on Windows. `scripts/smoke-live.mjs` likewise stops the one-port server
   gracefully through the server's own IPC `disconnect` handler (CR-8), never by signals.

**Consequences.** + no orphaned `node --watch`/vite processes on Windows in any tested stop path. − `concurrently`
is no longer used by any script but stays installed (removing it changes the lockfile while other tasks run;
BACKLOG). − Known limitation (not launcher-specific): under `node --watch` on Windows, Node's watch process
forwards SIGINT with `child.kill()` = TerminateProcess, so the dev server's graceful shutdown (demo restore) is cut
short after `server_stopping`; boot crash recovery (ADR-011) restores the demo on the next start. `npm start`
(no watch) is unaffected.

**Addendum (2026-10-04, AUD-3).** Watching only the direct parent (and npm) missed the case where a tool/IDE kills
only the *root shell* above `npm run dev`: npm, its `cmd /d /s /c` script shell and the launcher stayed alive.
Now, at start, the launcher records its **whole ancestor chain** through npm's own layers (npm/npx CLI, npm's
script shell, npm shims incl. Git Bash's `npm` script) up to and including the first non-npm process (the user's
shell, IDE task or tool), and stops when any of them disappears. Desktop/system processes (explorer, svchost, …)
are never watched. Git Bash breaks Windows parent links (MSYS fork emulation); the walk bridges them through Git
Bash's own `ps -al` (MSYS parent → WINPID), and — when the MSYS parent is a native program (PPID 1) — through the
cygwin exec "stub" (newest live MSYS process with `npm` in its command line under a native parent, created
≤ 15 s before the segment; a wrong match can only stop the launcher early, never kill anything). Windows
PowerShell 5.1 does not escape control characters in `ConvertTo-Json`, so the process list is sanitised before
parsing (a failed parse would silently fall back to "direct parent only"). `DEV_DEBUG_ANCESTORS=1` prints the
watched chain. Verified on Windows 11: root shell = Git Bash / PowerShell / cmd killed alone → ports 4000/5173
free in 4.8–4.9 s, 0 survivors; agent tool background command stopped (the audit scenario) → stopped, ports free,
no project processes; the six earlier stop paths unchanged; `smoke` 27/27, `smoke --dev` 35/35.

**Addendum 2 (2026-10-04, CR-20 — PID-reuse safety).** A PID is not an identity: Windows reuses PIDs as soon as no
handle to the exited process is open. Rules now enforced in `scripts/dev.mjs` (if in doubt, don't kill):
1. The launcher kills a child (or the reaper) **only while Node still holds it un-exited**
   (`exitCode === null && signalCode === null`): the OS handle is open, so the PID cannot have been reused. This
   covers the normal stop path, the `process.on('exit')` last resort and the reaper kill. `isAlive(pid)` is never
   used as identity before a kill (it only drives watching/polling).
2. The **leftover port-holder kill is removed**: nothing is ever looked up by PID or port and then killed. A
   grandchild that outlives its exited parent is left alone; the launcher prints a warning if 4000/5173 are still
   in use after stopping.
3. The **reaper** receives `pid:creationTime` identities, recorded by the launcher while it still held the
   children un-exited (an identity recorded after a child exited is stored as unknown = never killable). Right
   before any kill it re-verifies `isSameProcess(pid, creationTime)` (`scripts/lib/processIdentity.mjs`:
   `Win32_Process.CreationDate` / `ps -o lstart=`) and skips on mismatch or unknown.
4. Tests: `scripts/lib/processIdentity.test.mjs` (fake process table: same / reused / missing / unknown identity;
   argv format; real OS query incl. "exited child is no longer the same process") and
   `scripts/lib/devReaper.test.mjs` (real reaper with stand-in processes: kills the verified child once the
   launcher is gone, leaves a mismatched-creation-time child and an unknown-identity child alive). Run by
   `npm run test:scripts`, which root `npm test` (and therefore `npm run verify`) now includes — a deliberate
   extension of API-C §12.2's `test` script.
Residual (low): a few milliseconds between the reaper's identity check and `taskkill`; `taskkill /T` finds
descendants by `ParentProcessId`, which is sound for processes created by a live, verified child.

**Addendum 3 (2026-10-04, QA-6 — reads restarted the dev server).** Cause (reproduced): Node's watch mode
(`internal/watch_mode/files_watcher`, Node 24.12) restarts on *every* `fs.watch` event of a loaded file, with no
stat or content check, and on Windows libuv also reports last-access updates. With NTFS last-access updates enabled
(`fsutil behavior query DisableLastAccess` = 2 here), the first read of a source file whose atime is > 1 h old
(typecheck, lint, smoke, a second server) restarted the dev server and ended a running demo. `--watch-path` uses
the same watcher, so it would not help. Decision:
1. The dev server runs **without `--watch`**:
   `node --disable-warning=ExperimentalWarning --import tsx src/index.ts`, with an IPC channel.
2. The launcher watches `apps/server/src` and `packages/shared/src` itself (`scripts/lib/sourceWatcher.mjs`,
   recursive `fs.watch` + SHA-1 content snapshot; TS/JS/JSON, tests excluded). It restarts only on a real content
   change, addition or removal. Reads, atime and mtime-only touches never restart.
3. Every restart and stop is graceful: IPC `disconnect` (server CR-8 handler), then a 6 s grace period, then a
   force-kill only while the child is un-exited (CR-20). A server that exits by itself is restarted on the next
   real change, like `node --watch`. The reaper's identities are refreshed after each restart.
4. `apps/server` `dev` script = `node ../../scripts/dev.mjs --only=server`, so `npm run dev:server` gets the same
   behaviour. This deviates from API-C §12.2 (`node --watch …`) and supersedes the R-18 fallback note; tech-lead
   to update the contract. The launcher also supports `--only=web`. The preflight uses `PORT` when set.
5. This removes the ADR-036 "Known limitation" (dev shutdown cut short under `node --watch`): Ctrl+C, Ctrl+Break,
   a vanished parent and Vite exiting now all end with `server_stopped`.

Verified on Windows 11:
- Before/after on spare ports, with the sources' atime aged 2 h:
  - `node --watch`: restarted at startup and on an atime-only update.
  - Launcher: 0 restarts for atime-only, pure read and read-only `tsc --noEmit`; a real edit and its restore in
    `apps/server/src` and in `packages/shared/src` each restarted (files restored byte-identical).
- Tests: `scripts/lib/sourceWatcher.test.mjs` (in `npm run test:scripts` → `verify`).
- The six stop paths, three root-shell kills and the agent-tool scenario all left 0 survivors, now with a
  graceful `server_stopped` except for the launcher hard-kill.
- `smoke --dev` 35/35, `smoke` 27/27, `npm run dev:server` start/stop, `verify` green.

## ADR-037 — Security and QA minor fixes before release (SEC-1…SEC-6, QA-1…QA-3)
2026-10-04 · Accepted (PM, on behalf of architect/tech-lead) · Context: `tasks/reports/VO-000-security.md`
(VERDICT: PASS, 1 medium + 5 low) and `tasks/reports/VO-000-qa.md` (VERDICT: PASS, 3 minor).

**Decision.** Fix now (cheap, and the owner runs other localhost apps, which makes SEC-1 realistic):
1. **SEC-1** Vite dev and preview servers: `server.cors: false`, `preview.cors: false` (the backend allowlist stays
   the only CORS authority).
2. **SEC-2** HTTP state-changing requests (POST/PATCH/PUT/DELETE under `/api`) apply the same Origin rule as the socket
   (ADR-035 §1): allowed when `Origin` is absent, listed in `CORS_ORIGINS`, or same-origin (`http(s)://<Host>`);
   otherwise 403 `ORIGIN_NOT_ALLOWED` "Origin not allowed". GETs are unaffected (CORS already blocks reads).
3. **SEC-3** compressed request bodies are not accepted (`inflate: false`) → 415/400 per contract wording; a corrupt
   body never yields 500.
4. **SEC-4** web store keys tasks/agents in `Map` or null-prototype objects; additionally the shared id schema rejects
   `__proto__`, `constructor`, `prototype` as task ids.
5. **SEC-5** HTML responses carry `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`
   (server static mode and Vite dev/preview headers).
6. **SEC-6 / QA-2** document that a refused socket handshake returns engine.io's own response (polling 403 `{code:4}`,
   websocket 400); the refusal and logging are the contract, not the body.
7. **QA-1** Logs tab status-change lines include the new status. **QA-3** singular/plural in demo stop summary text
   ("1 agent", "2 agents") on server and client; API-C §3.14 updated.
8. QA note: on mobile (< 768 px) the simulator never auto-opens full-screen on load (remembered desktop preference is ignored on mobile).

**Consequences.** + closes the localhost cross-app write path; + defence in depth for writes. Deferred to Phase 2 (see
`docs/SECURITY.md` §6): producer token, ingest rate limit, retention, redaction.
