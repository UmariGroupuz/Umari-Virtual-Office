# IMPLEMENTATION PLAN — AI Virtual Office MVP (Phase 1)

Owner: tech-lead · Task: VO-000 · Date: 2026-10-04 · Status: v1.2 (v1.1: doc fixes DOC-2/DOC-6 — dev launcher, `.env` parsing,
jest-dom 7; v1.2: dev server without `node --watch`, content-based restarts, ADR-036 addendum 3)
Required by the owner (§30): architecture, folder structure, dependencies, database model, Socket.IO
flow, Phaser architecture, implementation phases, risks. Exact contracts: `docs/API_CONTRACTS.md`
(API-C §N). Decisions: `docs/DECISIONS.md` (ADR-001…037). Tasks: `tasks/ACTIVE.md`, `tasks/BACKLOG.md`.

---

## 0. Repository inspection (§30, recorded by the PM at intake, 2026-10-03)

| Item | Result |
|---|---|
| Folder | `C:\Users\User\Music\Claude agentlar\Virtual Office MVP` |
| Files at intake | none except `.git/` (now also `docs/`, `tasks/` written by the AI team — untracked) |
| Git | repository exists, branch `master`, **no commits**, clean at intake |
| Node / npm | v24.12.0 / 11.6.2 |
| OS / shells | Windows 11 Pro; Git Bash and PowerShell 5.1 available |
| SQLite | built-in `node:sqlite` (SQLite 3.50.4) works without flags (prints an `ExperimentalWarning`) |
| Registry | reachable; versions checked 2026-10-03 (ADR-026) |

Nothing existing to preserve; no migrations, tests or deployment config yet.

## 1. Architecture summary

A local, single-operator, monitoring-only system in one npm-workspaces monorepo (ADR-001):

- **`@vo/shared`** (`packages/shared`, TS source, no build — ADR-002): domain types, Zod schemas, agent/task
  state machines, constants (statuses, event types, limits, error codes, labels, palette, office layout),
  reference data (15 agents, 4 projects), project filter predicates, the Claude Code adapter (pure,
  UNVERIFIED, not wired).
- **`@vo/server`** (`apps/server`, Node 24 + `tsx`, Express 5, Socket.IO 4, `node:sqlite`): one write path —
  `EventService` validates → (one synchronous transaction: store event + agent + task) → broadcast after
  commit → respond (ADR-008). Pure rules (`decideEvent`, task rules, demo storyline) are separate from I/O.
  Demo Mode is an in-process producer on the same pipeline with a persisted snapshot/restore (ADR-011).
- **`@vo/web`** (`apps/web`, React 19 + Vite 8 + Tailwind v4 + Zustand + React Router 7 + Phaser 3.90): a
  projection of server state. Socket singleton + snapshot resync (ADR-010); one pure reducer is the only
  mutator of domain data; the Phaser office is isolated behind the `OfficeCanvas` props seam (ADR-025).

```
Producer (simulator · curl · demo · future adapters)
  → POST /api/events | PATCH /api/agents/:id/status | Tasks API | demo tick
  → EventService ─ Zod (shared) ─ BEGIN IMMEDIATE ─ resolve refs ─ decideEvent (pure, shared machines)
                ─ INSERT event · UPDATE agent · UPSERT task (version+1) ─ COMMIT
  → Broadcaster → Socket.IO `office:event` {event, agent, task} → every browser
  → HTTP 2xx { data: {event, agent, task} }
Browser: socket → reducer (version-gated, id-deduped) → React (metrics, roster, panel, feed) + OfficeCanvas → Phaser scene
```

## 2. Folder structure (final, with task ownership)

```
Virtual Office MVP/
├─ package.json  package-lock.json  tsconfig.base.json  eslint.config.js      TASK-001
├─ .prettierrc.json  .prettierignore  .gitignore  .editorconfig  .env.example  TASK-001
├─ README.md                                                                   TASK-010
├─ data/.gitkeep                     (office.db* gitignored, created at runtime) TASK-001
├─ scripts/verify.mjs                                                          TASK-001
├─ scripts/smoke-live.mjs                                                      TASK-009
├─ docs/  (ARCHITECTURE, EVENT_SYSTEM, AGENT_STATE_MACHINE, API_CONTRACTS, DECISIONS, UX, REQUIREMENTS,
│          IMPLEMENTATION_PLAN, INTEGRATIONS (TASK-004), DEPLOYMENT (TASK-009), SECURITY (security gate),
│          ROADMAP + PROJECT (TASK-010))
├─ tasks/  ACTIVE.md BACKLOG.md reports/
├─ packages/shared/
│  ├─ package.json tsconfig.json vitest.config.ts  test/smoke.test.ts                 TASK-001
│  └─ src/  index.ts constants/ types/ schemas/ state/ filters/ reference/             TASK-002
│           adapters/                                                                  TASK-004
├─ apps/server/
│  ├─ package.json tsconfig.json vitest.config.ts  test/smoke/sqlite.smoke.test.ts    TASK-001
│  ├─ src/db/types.ts                                  created by TASK-002 → owned by TASK-003
│  ├─ src/db/** (connection, migrations/, mappers, repositories/) src/seed/**          TASK-003
│  ├─ src/config.ts logger.ts errors.ts                                                TASK-005
│  ├─ src/services/eventEffects.ts taskRules.ts demoScript.ts  src/realtime/broadcaster.ts  TASK-005
│  ├─ src/services/eventService.ts taskService.ts demoService.ts snapshotService.ts projectResolver.ts  TASK-008
│  ├─ src/realtime/socketServer.ts  src/api/**  src/app.ts  src/index.ts               TASK-008
│  └─ test/** (api/, realtime/, demo/, helpers/; not smoke/)                           TASK-008
└─ apps/web/
   ├─ package.json tsconfig.json vite.config.ts vitest.config.ts index.html           TASK-001
   ├─ test/setup.ts test/smoke.test.tsx  src/vite-env.d.ts                             TASK-001
   ├─ src/office/**   (OfficeCanvas.tsx stub from TASK-001)                            TASK-007
   └─ src/** except office/  main.tsx App.tsx styles/ api/ socket/ store/ components/ layout/
          dashboard/ agents/ activity/ simulator/ mocks/ lib/ hooks/ pages/ copy.ts    TASK-006
```

The owner's illustrative `packages/types` is merged into `packages/shared/src/types` (ADR-001);
`apps/server/src/agents|events|socket|types` map to `services/`, `api/routes/`, `realtime/` and
`@vo/shared` types.

## 3. Dependencies (binding, ADR-026)

Installed once by TASK-001 with `npm install`; later tasks must not add packages (request via the PM).

| Workspace | Package | Range | Kind | Why |
|---|---|---|---|---|
| root | `typescript` | `~5.9.3` | dev | strict TS; typescript-eslint supports < 6.1 |
| root | `eslint` / `@eslint/js` | `^9.39.0` | dev | ESLint 9 flat config (PM-5) |
| root | `typescript-eslint` | `^8.71.0` | dev | TS rules, `projectService` |
| root | `eslint-plugin-react-hooks` | `^7.1.0` | dev | hooks rules |
| root | `eslint-plugin-react-refresh` | `^0.5.0` | dev | Vite HMR safety |
| root | `eslint-config-prettier` | `^10.1.0` | dev | disable stylistic conflicts |
| root | `globals` | `^17.13.0` | dev | env globals for flat config |
| root | `prettier` | `3.9.9` (exact) | dev | formatting |
| root | `vitest` | `^4.1.11` | dev | tests in all workspaces (hoisted) |
| root | `concurrently` | `^10.0.0` | dev | installed but **unused**: `npm run dev` = `node scripts/dev.mjs` (ADR-036); removal tracked as BL-022 |
| shared | `zod` | `^4.6.0` | prod | schemas |
| server | `@vo/shared` | `*` | prod | workspace link |
| server | `express` | `^5.2.0` | prod | HTTP |
| server | `socket.io` | `^4.8.0` | prod | real-time |
| server | `cors` | `^2.8.5` | prod | CORS allowlist |
| server | `zod` | `^4.6.0` | prod | config/env parsing |
| server | `tsx` | `^4.23.0` | prod | runtime TS loader (ADR-013) |
| server | `@types/express` `^5.0.0`, `@types/cors` `^2.8.17`, `@types/node` `~24.19.0` | | dev | typings |
| server | `supertest` `^7.3.0`, `@types/supertest` `^7.2.0`, `socket.io-client` `^4.8.0` | | dev | API + socket tests |
| web | `@vo/shared` | `*` | prod | workspace link |
| web | `react`, `react-dom` | `^19.3.0` | prod | UI |
| web | `react-router` | `^7.18.0` | prod | `/` route, query params, 404 |
| web | `zustand` | `^5.0.0` | prod | store |
| web | `phaser` | `^3.90.0` | prod | office (never 4.x) |
| web | `socket.io-client` | `^4.8.0` | prod | real-time |
| web | `lucide-react` | `^1.51.0` | prod | icons (UX names) |
| web | `@fontsource-variable/inter` | `^5.3.0` | prod | bundled Inter (no CDN) |
| web | `zod` | `^4.6.0` | prod | form validation via shared schemas |
| web | `vite` `^8.3.0`, `@vitejs/plugin-react` `^6.1.0` | | dev | build/dev server |
| web | `tailwindcss` `^4.3.0`, `@tailwindcss/vite` `^4.3.0` | | dev | styling |
| web | `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0` | | dev | typings |
| web | `@testing-library/react` `^16.3.0`, `@testing-library/dom` `^10.4.0`, `@testing-library/user-event` `^14.6.0`, `@testing-library/jest-dom` `^7.0.1` (ADR-029: 6.10.0 deprecated upstream), `jsdom` `^29.1.0` | | dev | component tests (jsdom 30 needs Node ≥ 24.15) |

Not used (decided): Prisma/ORMs (ADR-003), better-sqlite3, dotenv (`.env` is parsed with `util.parseEnv` and merged under the real environment,
ADR-032 §8), pino/winston
(ADR-018), shadcn/Radix (custom primitives), `cross-env` (not needed: no inline env in scripts), Playwright
(BACKLOG). No runtime CDN or network assets.

## 4. Database model

SQLite file `data/office.db` (WAL), tests `:memory:`; schema in API-C §8 (5 tables: `projects`, `agents`,
`tasks`, `events`, `settings`), migration `1/init` via `PRAGMA user_version` (ADR-004). Key points:

- `events.seq INTEGER PRIMARY KEY AUTOINCREMENT` = total order and paging cursor; `events.id` UUID = feed
  dedupe key; indexes `(project_id, seq)`, `(agent_id, seq)`, `(type, seq)`, `(task_id, seq)`.
- `agents.version`, `tasks.version` incremented on every write (ADR-010), never lowered (demo restore = +1).
- No FK from `events.task_id`/`agents.task_id` (demo tasks are deleted on restore).
- Repositories own all SQL (prepared, parameterized), map snake_case ↔ camelCase, expose the interfaces of
  API-C §9.2; `DatabaseHandle.transaction(fn)` = `BEGIN IMMEDIATE … COMMIT`, synchronous `fn` only.
- Seed (API-C §7): 15 agents, 4 projects, 11 tasks, ≥ 30 consistent historical events, only when empty;
  `npm run db:reset` for the dev DB only.

## 5. Socket.IO flow

1. Server: one `Server` on the HTTP server, default namespace, CORS allowlist, host guard in
   `allowRequest`, no client handlers (`onAny` → debug log). `SocketBroadcaster` implements `Broadcaster`;
   only `EventService.commitAndBroadcast` and `DemoService` call it, always **after** `COMMIT`.
2. Messages: `office:event` (`OfficeEventPayload`, one per committed event, `seq` order), `demo:state`,
   `office:resync {reason:"demo-restored"}` (API-C §4).
3. Client: module-level singleton `io()` (same origin; Vite proxies `/socket.io` with `ws: true`), listeners
   attached once at module creation. Status machine: `connecting` → `connected` ↔ `reconnecting`
   (first 30 s) → `disconnected` (> 30 s / offline / server close; retries continue, backoff 1–10 s).
4. Resync on every `connect` and on `office:resync`: buffer live payloads → `GET /api/snapshot?project=` →
   replace state → replay buffer → `syncGeneration++` (panels refetch). Reducer is version-gated and
   id-deduplicated, so HTTP responses and broadcasts of the same write are idempotent.
5. Health poll (`GET /api/health`, 15 s OK / 5 s failing, 5 s timeout) distinguishes "Backend unavailable"
   from "socket only" (REQ-142/143).

## 6. Phaser architecture

- `apps/web/src/office/OfficeCanvas.tsx` (lazy chunk) is the only entry (ADR-025). It calls
  `gameManager.mountOffice(hostDiv, bridge)` / `unmountOffice()` in `useEffect`; `gameManager` owns at most
  one `Phaser.Game` with a deferred destroy so StrictMode mount→unmount→mount reuses it (ADR-012, R-3).
- Internal bridge (`office/bridge.ts`): a tiny observable fed from props (`agents`, `projectFilter`,
  `selectedAgentId`, `reducedMotion`, `paused`) + callbacks; the scene subscribes, diffs agents by `version`
  and updates only changed `AgentDesk` containers; unsubscribes on shutdown.
- `OfficeScene`: world 1140 × 540, rooms/desks from `@vo/shared` `OFFICE_ROOMS`, `Scale.RESIZE`,
  `zoom = min(w/1140, h/540, 1.6)`, centered camera, LOD compact below 0.70, `Text.setResolution(dpr)`,
  `roundPixels`, vector `Graphics` + generated textures only (no external assets, REQ-074).
- `objects/AgentDesk.ts`: plate → glow → monitor → desk → character (from behind) → chair → badge/bubble →
  label → chip (UX §5.3). Status animations per UX §5.4; loops created on entering a status and destroyed on
  leaving; `completed` emphasis only on live transitions (2.5–3 s); reduced motion = static variants;
  `paused` → `tweens.pauseAll()`.
- `visuals.ts`: pure `(status, recentlyCompleted, dimmed, selected, reducedMotion, lod) → VisualSpec`,
  unit-tested; `palette.ts` converts shared hex strings to Phaser numbers.
- Input: each slot `setInteractive(Rectangle(0,0,116,200))` with hand cursor → `onAgentSelect`; hover →
  `onAgentHover({agentId, x, y, width, height})` in CSS px relative to the host; empty floor →
  `onBackgroundClick`. Tooltip, `role="img"` summary and < 768 px gating are in the React shell.

## 7. Implementation phases (owner §31 order → tasks)

| §31 step | Deliverable | Task(s) | Wave |
|---|---|---|---|
| 1 Repository inspection | §0 above | PM (done) | — |
| 2 Project scaffolding | workspaces, configs, deps, stubs, smoke tests | TASK-001 | W0 |
| 3 Shared types | `@vo/shared` + `db/types.ts` contract file | TASK-002 | W1 |
| 4 Database | connection, migrations, repositories | TASK-003 | W2 |
| 5 Backend API | routes, middleware, error envelope | TASK-008 | W3 |
| 6 Event service | pure rules (`decideEvent`, task rules) / `EventService` | TASK-005 / TASK-008 | W2 / W3 |
| 7 Socket.IO | broadcaster interface / socket server | TASK-005 / TASK-008 | W2 / W3 |
| 8 Seed data | seed + reset CLI | TASK-003 | W2 |
| 9 Frontend shell | layout, top bar, API/socket clients, store | TASK-006 | W2 |
| 10 Dashboard metrics | metrics row | TASK-006 | W2 |
| 11 Agent cards | roster | TASK-006 | W2 |
| 12 Phaser virtual office | `office/**` | TASK-007 | W2 |
| 13 Agent detail panel | panel + tabs | TASK-006 | W2 |
| 14 Activity feed | live feed | TASK-006 | W2 |
| 15 Project filtering | URL filter, metrics/feed/roster, office dimming | TASK-006 + TASK-007 | W2 |
| 16 Developer Simulator | simulator dock | TASK-006 | W2 |
| 17 Demo Mode | storyline / demo service + endpoints / toggle | TASK-005 / TASK-008 / TASK-006 | W2–W3 |
| 18 Tests | per task + QA gate | all + qa-engineer | W1–W4 |
| 19 Documentation | README, ROADMAP, PROJECT, INTEGRATIONS, DEPLOYMENT, doc alignment | TASK-010, TASK-004, TASK-009 | W2–W4 |
| 20 Full run verification | §32 checklist, restart | TASK-009 + qa-engineer + PM | W4 |
| (adapter) | Claude Code adapter (REQ-131) | TASK-004 | W2 |

### 7.1 Waves, parallel groups and critical path

```
W0  TASK-001 (devops)
W1  TASK-002 (backend: @vo/shared + db/types.ts)
W2  ┌ TASK-003 (database)   ┐
    ├ TASK-005 (backend)    ┤  all in parallel — disjoint files (ownership table §2)
    ├ TASK-004 (integration)┤
    ├ TASK-006 (frontend A) ┤
    └ TASK-007 (frontend B) ┘
W3  TASK-008 (backend: server app)          needs TASK-003 + TASK-005
W4  TASK-009 (devops: build + live run) ∥ TASK-010 (documentation)   needs TASK-006/007/008
Gates (PM-run, per CLAUDE.md §23): code-review after each task → QA (after W3/W4 integration)
      → security ∥ documentation → devops build verification → product audit
```

- **Critical path:** TASK-001 → TASK-002 → TASK-003 (or TASK-005, whichever finishes later) → TASK-008 →
  TASK-009 → QA → security → product audit. The web branch (TASK-002 → TASK-006) is near-critical: TASK-006
  is the largest single task; if it finishes after TASK-008, it becomes the critical path.
- Two frontend engineers run TASK-006 and TASK-007 simultaneously (no shared files, seam = `OfficeCanvas`
  props). Two backend-engineer tasks (TASK-005, later TASK-008) never overlap in time.
- Code review may start per task as soon as it is in REVIEW; QA's integrated suites need W3.

### 7.2 Verification per wave

| After | Must be green |
|---|---|
| W0 | `npm install`, `npm run lint`, `typecheck`, `test` (3 smoke tests incl. `node:sqlite` under Vitest), `build`, `format:check`, `npm run dev` starts both processes |
| W1 | + shared unit tests (full 8×8 agent table, task table, consistency property, schemas, reference/layout invariants) |
| W2 | + db/seed tests, server rule tests, adapter tests, web reducer/selector/component tests (API mocked), office pure tests |
| W3 | + Supertest suite (every endpoint, every error code, REQ-029 guarantee), socket propagation, demo snapshot/restore + crash recovery |
| W4 | `npm run verify`, `npm start` (one port) + `npm run dev` live run, `scripts/smoke-live.mjs`, §32 manual checklist (REQ-190/191) at 1920×1080, restart persistence |

## 8. Testing strategy (summary)

Every task ships its own tests (Required tests in each task). Layers: pure shared/server rules (Vitest,
fixed `now`), repositories on `:memory:`, HTTP via Supertest on `createServerApp` with
`RecordingBroadcaster`, real socket propagation with `socket.io-client` on an ephemeral port, web reducer /
selectors / components with Testing Library + jsdom (Phaser mocked), office pure visuals + single-instance
test with a mocked Phaser. QA adds cross-cutting suites and runs the §32 live checklist. Never weaken an
assertion to make a test pass (CLAUDE.md §9).

## 9. Risks

| ID | Risk | L / I | Mitigation | Owner |
|---|---|---|---|---|
| R-1 | `node:sqlite` experimental (API/warnings) | low / med | `engines`, repository isolation, `--disable-warning=ExperimentalWarning` | database |
| R-2 | Vitest/Vite cannot load `node:sqlite` | med / high | TASK-001 smoke test first; `pool: 'forks'`, `environment: 'node'`, `server.deps.external` fallback; ADR-026 fallback to Vite 7 | devops |
| R-3 | StrictMode double mount → two Phaser games | high / med | deferred-destroy `gameManager` + single-instance test | frontend B |
| R-4 | Blurry canvas text | med / med | `Text.setResolution`, zoom-to-fit, check 1366/1920/2560; DPR backing store = BACKLOG spike | frontend B |
| R-5 | Phaser bundle slows first paint | med / low | `React.lazy` chunk; dashboard renders first | frontend A |
| R-6 | Demo restore overwrites user changes / leaves debris | med / high | persisted snapshot + event-log touch detection; restore + crash-recovery tests | backend |
| R-7 | Duplicate socket listeners / feed rows | med / med | singleton, listeners once, id dedupe, version gating, N-reconnect test | frontend A |
| R-8 | Windows script portability | high / med | no inline env, node scripts (dev launcher `scripts/dev.mjs` instead of `concurrently`, ADR-036), paths from `import.meta.url` | devops |
| R-9 | `localhost` → `::1` vs `127.0.0.1` | med / med | proxy target `http://127.0.0.1:4000`; host guard allows both names | devops |
| R-10 | Strict machines vs real producers (Phase 2) | med / med | ADR-016 rules; `force` for operators; Q-2 later | architect |
| R-11 | Long synchronous transactions | low / low | ≤ 3 rows per event; restore ≤ ~50 rows | backend |
| R-12 | Seed bypasses `decideEvent` → inconsistent state | med / med | seed invariant test (API-C §7.3) | database |
| R-13 | Docs drift from code | med / med | tests assert tables from shared code; TASK-010 alignment; auditor | documentation |
| R-14 | Vite 8 / plugin-react 6 / Vitest 4.1 combination issues | low / med | smoke tests in W0; fallback in ADR-026 | devops |
| R-15 | `lucide-react` 1.x icon names differ from UX names | low / low | frontend verifies imports at typecheck; map to the nearest icon and note it | frontend A |
| R-16 | Parallel tasks edit the same file (stubs, contract files) | med / med | ownership table §2 + ADR-028 + lint import boundaries; PM checks `git status` per task | PM |
| R-17 | jsdom/engines mismatch on Node 24.12 | med / med | jsdom `^29.1` (not 30); `engines` check at install | devops |
| R-18 | Dev-server reload misses changes in `packages/shared`, or restarts on mere reads | med / low | resolved: `node --watch` dropped — on Windows it restarted on last-access updates; the launcher `scripts/dev.mjs` watches `apps/server/src` + `packages/shared/src` by content hash and restarts gracefully only on real changes (ADR-036 addendum 3, tested by `npm run test:scripts`) | devops |

## 10. Out of scope / deferred

See `tasks/BACKLOG.md` (event retention, Force UI, Playwright e2e, idempotency keys, Socket.IO rooms,
rate limiting, compiled server build, toolchain upgrade wave, Phase 2 ingest endpoint, and UX OPTIONAL
items).
