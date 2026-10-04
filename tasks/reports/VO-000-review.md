# VO-000 — Integrated code review, TASK-001 … TASK-008 (Phase 1)

Reviewer: code-reviewer (gate) · Date: 2026-10-04 · Scope: `packages/shared/src/**`, `apps/server/src/**`,
`apps/server/test/**`, `apps/web/src/**`, root configs, `scripts/**`. I read the files directly because the repo
has no commits yet. Binding inputs: API_CONTRACTS v1, REQUIREMENTS v1.2, DECISIONS ADR-001…034 (ADR-029…034 are
accepted deviations and are not re-raised here).

## 1. Verification actually run

| Step | Result |
|---|---|
| `npm run verify` (format:check → lint → typecheck → test → build) | **all 5 PASS**, exit 0 |
| tests | shared 16 files / 854 tests · server 26 / 593 · web 20 / 1300 — all green, no skipped/`.only` tests |
| build | OK. Vite warns that the lazy Phaser chunk `runtime-*.js` is 1.22 MB; ADR-033 already defers this to TASK-009. |
| Probe 1 (scratchpad, not in repo) | socket.io-client with `transports:['websocket']` and `Origin: http://evil.example` → **connects and receives `office:event`** (CR-1). |
| Probe 2 (scratchpad) | Instance A runs with demo active on a temp file DB; instance B boots on the same DB and port → B fails with `EADDRINUSE` **after** it has restored A's demo snapshot and deleted the `demo` setting. A's later stop restores nothing (CR-2). |
| Probe 3 (scratchpad) | The `node --watch` child has an IPC channel (`process.connected === true`). Hard-killing the watcher parent also ended the child in this test. Orphans therefore come from the npm/cmd layers above the watcher (CR-7). |

`data/office.db` was not touched.

## 2. Findings

### [CR-1] severity: major
ROOT_CAUSE: contract — API-C §4 sets `allowRequest` = host guard and relies on the Socket.IO `cors` option. That option does not apply to WebSocket transports, so the REQ-161 / ADR-019 goal ("CORS allows only the local web origin(s)", protection from websites open in the owner's browser) is not met for the live stream.
OWNER: tech-lead (add an Origin rule to API-C §4). backend-engineer then implements it.
AFFECTED_COMPONENTS: `apps/server/src/realtime/socketServer.ts`, API-C §4, `apps/server/test/socket.test.ts`
INVALIDATED_GATES: none yet (security gate not run). Must be re-checked by security-engineer.
Evidence:
- `apps/server/src/realtime/socketServer.ts:415-430`: only `Host` is checked.
- `docs/API_CONTRACTS.md:566`.
- Probe 1: a cross-origin page can open `ws://127.0.0.1:4000/socket.io/?EIO=4&transport=websocket`. Its Host header is allowed, so it reads every `office:event`, including messages, task titles and projects.
- REST is not affected: there are no ACAO headers for foreign origins, and writes need JSON, which triggers a preflight.

Fix:
- In `allowRequest`, also check `req.headers.origin`:
  - **absent** → allow (Node clients, curl, the test client)
  - in `config.corsOrigins` → allow
  - same-origin (the origin's host equals the request `Host`, as in one-port mode at `http://127.0.0.1:4000`) → allow
  - otherwise → `callback('Origin not allowed', false)`, and log `request_failed {status:403, code:'HOST_NOT_ALLOWED'…}` or a new `ORIGIN_NOT_ALLOWED` code, as the contract decides.
- Add tests:
  - a websocket-only client with a foreign Origin gets `connect_error`
  - an allowed origin connects
  - a same-origin one-port origin connects

### [CR-2] severity: major
ROOT_CAUSE: contract — the API-C §9.8 boot order (`openDatabase → seedIfEmpty → createServerApp → demo.recoverOnBoot() → listen`) mutates shared state before the process has proven it is the only instance.
OWNER: tech-lead (boot-order / single-instance rule in API-C §9.8). backend-engineer then implements it.
AFFECTED_COMPONENTS: `apps/server/src/index.ts`, `apps/server/src/services/demoService.ts` (`recoverOnBoot`), API-C §9.8, `apps/server/test/boot.test.ts`
INVALIDATED_GATES: none yet (REQ-112/113 data safety; QA must re-test).
Evidence:
- `apps/server/src/index.ts:162-178`: recovery runs before `listen`.
- `apps/server/src/services/demoService.ts:362-374`.
- Probe 2 shows the effect: a second `npm run dev` / `npm start` against a DB used by a running instance (exactly the PM's orphaned-process situation) runs `recoverOnBoot()` on that instance's live demo. It restores the snapshot, deletes the `demo` setting and writes "Demo mode stopped…", then dies on `EADDRINUSE`.
- The running instance never learns about this:
  - Its clients get no broadcast or resync.
  - Its demo keeps ticking.
  - Its later stop hits `demo_setting_invalid` and restores nothing.
  - The office stays in demo state permanently, which violates REQ-112.

Fix:
- Make the port the single-instance lock. Call `listen` before any state-changing boot step, but gate traffic until boot completes:
  - HTTP: middleware returns 503 `SERVICE_UNAVAILABLE`.
  - Socket.IO: `allowRequest` denies.
  - Then run `seedIfEmpty` + `recoverOnBoot` and open the gate. REQ-113 ("restore before serving requests") is still satisfied.
- RECOMMENDED: also protect against a second instance on a *different* port with the same DB. Use a lock file next to the DB (pid + port, stale-lock detection) or `PRAGMA locking_mode=EXCLUSIVE` for file DBs.
- Add a test: boot A with demo active, then boot B on the same DB/port. B must fail and A's `demo` setting must be intact.

### [CR-3] severity: minor
ROOT_CAUSE: frontend — `demo:state` and the demo start/stop responses bypass the resync buffer.
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/lib/runtime.ts`, `apps/web/src/socket/sync.ts`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/lib/runtime.ts:157` (`onDemoState` → `applyDemoState` immediately).
- `runtime.ts:228-232` (start/stop responses).
- `store/reducer.ts:113` (`hydrate` sets `demo: snapshot.demo`).
- If a demo **start** commits after the server read the snapshot but before the response arrives, `hydrate` overwrites `active:true` with the stale `active:false`. Start sends no `office:resync`, so the switch and DEMO badge stay off while demo events keep arriving (REQ-110). Stop is self-healing because it ends with `office:resync`.

Fix:
- While `syncing`, remember the last `DemoState` from both the socket and response paths, and re-apply it after `hydrate`, next to the buffer replay.
- Add a `sync.test.ts` case: demo:state arrives during the fetch, the snapshot says inactive, and the result must be active.

### [CR-4] severity: minor
ROOT_CAUSE: contract — the buffered replay (ADR-010 / API-C §4) has no watermark, so it can resurrect rows that the newer snapshot no longer has. This happens with tasks deleted by demo restore.
OWNER: tech-lead
AFFECTED_COMPONENTS: API-C §1.5/§3.11/§4, `apps/web/src/socket/sync.ts:64-68`, `apps/web/src/store/reducer.ts:87-89`
INVALIDATED_GATES: none
Evidence:
- `shouldReplace` accepts any unknown task (`reducer.ts:88`).
- A buffered demo-tick payload received before a snapshot that was read after a demo stop re-adds the deleted demo task.
- The buffer survives superseded and failed resyncs (`sync.ts:56-57, 78-85`, up to 1 000 items), so the "ghost" task stays until a later clean resync. It shows up in metrics, the simulator task list and the Tasks tab.

Fix:
- Add `lastSeq` to `Snapshot`: the global `MAX(events.seq)` read in the same synchronous read, before any project filter.
- The client drops buffered payloads with `event.seq <= snapshot.lastSeq` before replaying.

### [CR-5] severity: minor
ROOT_CAUSE: frontend — there is no React error boundary anywhere in `apps/web/src`.
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/dashboard/OfficeCard.tsx`, `apps/web/src/App.tsx`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/dashboard/OfficeCard.tsx:29` and `:233-245`: `lazy(() => import('../office/OfficeCanvas'))` inside `<Suspense>` with no boundary.
- `office/gameManager.ts:66-68`: the synchronous `startGame` path runs inside the mount effect (`OfficeCanvas.tsx:88-93`).
- Two failures can reach React and blank the whole dashboard with no recovery:
  - a failed chunk load, for example after a rebuild in one-port mode when the window is later widened past 768 px
  - a `Phaser.Game` constructor throw on remount
- Only the inner `./runtime` import failure is handled (`gameManager.ts:45-47`).

Fix:
- Wrap the Suspense block in a small class boundary. Its fallback is `<OfficePlaceholder label="Office view could not be loaded." />` plus a Retry that remounts with a new `key`.
- Optionally add an app-level boundary with a "Reload" action.
- Add a test with a throwing lazy module.

### [CR-6] severity: minor
ROOT_CAUSE: contract — `GET /api/tasks` and the snapshot return tasks `ORDER BY created_at, id LIMIT 500`. When there are more than 500 tasks, the **newest** ones are cut off.
OWNER: tech-lead
AFFECTED_COMPONENTS: API-C §1.5 (`tasks ≤ 500`), §3.8; `apps/server/src/services/snapshotService.ts:186`; `apps/server/src/db/repositories/taskRepository.ts:223`
INVALIDATED_GATES: none
Evidence:
- The demo creates 4 tasks per 13-beat cycle: about 370 per hour at 3 s.
- After roughly 80 minutes of continuous demo, a reconnect or resync hydrates a store that lacks the current demo tasks. The agent cards still show `currentTask`, but the Tasks tab, metrics and simulator list are wrong.

Fix (contract decision):
- Either keep active (non-terminal) tasks first and drop the oldest terminal ones when the snapshot is capped,
- or return the newest 500 (`ORDER BY created_at DESC, id DESC LIMIT 500`, re-sorted ascending) and document it.

### [CR-7] severity: minor
ROOT_CAUSE: infrastructure — the PM observed orphaned processes after stopping `npm run dev` on Windows. They come from the nested launcher chain:

`concurrently -k` → `cmd /c npm run dev:server` → npm → `cmd /c npm run dev -w @vo/server` → npm → cmd → `node --watch` → node, and the same chain for vite.

When concurrently or the npm layer is terminated without console Ctrl+C (closed terminal, a tool or IDE stopping the process tree root, a background run), Windows does not cascade the kill. `node --watch` and `vite` keep ports 4000 and 5173. The next `npm run dev` then fails (`strictPort`, `EADDRINUSE`), and through CR-2 it can corrupt the running instance's demo.
OWNER: devops-engineer
AFFECTED_COMPONENTS: root `package.json` `dev` script, `scripts/`
INVALIDATED_GATES: none
Evidence:
- `package.json` scripts `dev`, `dev:server`, `dev:web`.
- Probe 3: the watcher's own child is not the orphan source.

Fix (RECOMMENDED):
1. Add `scripts/dev.mjs` to replace the `npm:`-in-concurrently chain. It spawns `process.execPath` directly, with no shell and no npm layers:
   - `--watch --disable-warning=ExperimentalWarning --import tsx src/index.ts` (cwd `apps/server`)
   - `node_modules/vite/bin/vite.js` (cwd `apps/web`)
   - It prefixes output, and on `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGBREAK`/`exit` or either child's exit it kills both trees. On win32 it uses `taskkill /pid <pid> /T /F`; elsewhere it uses `kill`.
   - Point `dev` at it. `concurrently` may then be dropped.
2. Add a port preflight. Before spawning, `dev.mjs` checks 4000/5173 and prints which PID holds them, using `netstat -ano` on Windows. An optional `npm run dev:free-ports` kills those PIDs after confirmation.
3. Document the recovery steps in `docs/DEPLOYMENT.md` (TASK-009).

### [CR-8] severity: minor
ROOT_CAUSE: backend — on Windows, closing the console window emits `SIGHUP` and Ctrl+Break emits `SIGBREAK`. Neither is handled, so `npm start` gets no graceful shutdown (demo restore, socket close, DB close) in those cases. Boot recovery limits the damage.
OWNER: backend-engineer
AFFECTED_COMPONENTS: `apps/server/src/index.ts`
INVALIDATED_GATES: none
Evidence: `apps/server/src/index.ts:247-248` (only `SIGINT`/`SIGTERM`).
Fix:
- Register the same `onSignal` for `SIGHUP` and `SIGBREAK` (guarded so it runs once).
- When `process.connected` (an IPC parent, such as `node --watch`), also shut down on `process.on('disconnect')`.

### [CR-9] severity: minor
ROOT_CAUSE: backend — demo restore can leave dangling references. ADR-011/034 restore rules keep a user-touched agent but still delete the untouched demo task it points to. The same applies to a user-created task whose `blockedBy` names a demo task.
OWNER: backend-engineer
AFFECTED_COMPONENTS: `apps/server/src/services/demoService.ts:153-185`, `apps/server/test/demo.test.ts`
INVALIDATED_GATES: none
Evidence:
- During a demo, a user sends `agent.message` (no `taskId`) to an agent that the demo has bound to `SW-D57-1a`.
- On stop, the agent is kept (`taskId`/`currentTask` still `SW-D57-1a`), but the task is not in `touched.taskIds`, so it is deleted (`demoService.ts:180-183`).
- The UI shows the agent working on a task that no longer exists.

Fix:
- Before the delete loop, add to the keep set every demo task referenced by a kept agent's `taskId` or by any remaining task's `blockedBy`. Count these as `tasksKept`.
- Add a test.

### [CR-10] severity: minor
ROOT_CAUSE: frontend
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/lib/runtime.ts`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/lib/runtime.ts:265` calls the eager `sync.resync()` on start, and `:137-138` calls `resync()` again on the first `connect`.
- On a normal page load, two `GET /api/snapshot` requests run and the first is aborted. The eager fetch is an accepted deviation (ADR-033 item 2); the duplication is not.

Fix: skip the `onConnect` resync when a resync started within the last ~1 s is still in flight (or completed after the socket connected), or document the trade-off in code.

### [CR-11] severity: minor
ROOT_CAUSE: frontend (performance)
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/activity/ActivityFeed.tsx`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/activity/ActivityFeed.tsx:58`: `useNow()` (1 s tick) re-renders the whole feed every second, only for day-divider labels.
- That means up to 200 memoized `FeedRow` element creations and prop comparisons per second.

Fix: use a minute or midnight ticker for divider labels, or move the label into a small child that subscribes to `useNow`.

### [CR-12] severity: minor
ROOT_CAUSE: frontend
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/office/objects/AgentDesk.ts`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/office/objects/AgentDesk.ts:362-384`: the fade-out `onComplete` draws the *captured* `spec`.
- If the LOD crosses zoom 0.70 during the 120 ms fade, for example on a resize during a live status change, the stale spec redraws the old chip variant. It stays until the next change on that desk. The effect is cosmetic.

Fix: draw from `this.spec` in `onComplete` (or reset the applied chip key and redraw from `this.spec`).

### [CR-13] severity: minor
ROOT_CAUSE: frontend (tests)
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/office/OfficeScene.ts`, `apps/web/src/office/objects/AgentDesk.ts`
INVALIDATED_GATES: none
Evidence:
- `OfficeScene.ts` and `objects/AgentDesk.ts` (about 1 150 lines) have no unit tests.
- Tween lifecycle has no automated proof:
  - loops replaced on status change
  - crossfade cancel on rapid A→B→C
  - zero live tweens after `destroy`/`clearAgent`
- Room counts and hover-on-resize are also unproven. Only the engineer's manual browser harness covers them. The 1 118 office tests cover `visuals`, `bridge`, `gameManager`, `OfficeCanvas`, layout and palette.

Fix (backlog): scene and desk tests with a minimal Phaser stub (`tweens.add` returning stoppable fakes). Assert the live-loop count after N rapid status changes and zero after `destroy`.

### [CR-14] severity: minor
ROOT_CAUSE: frontend (performance)
OWNER: frontend-engineer
AFFECTED_COMPONENTS: `apps/web/src/office/gameManager.ts`
INVALIDATED_GATES: none
Evidence:
- `apps/web/src/office/gameManager.ts:116, 121-122`: every `pointermove` over the host calls `scale.updateBounds()`, which calls `getBoundingClientRect`.
- That is a synchronous layout read per move, and a forced layout flush while feed rows are being inserted.

Fix: update bounds on `pointerenter`/`pointerdown` plus resize/scroll, or rAF-throttle the move handler.

### [CR-15] severity: minor
ROOT_CAUSE: infrastructure
OWNER: devops-engineer
AFFECTED_COMPONENTS: `eslint.config.js`, `apps/server/test/**`
INVALIDATED_GATES: none
Evidence: ADR-034 item 7. HTTP test files disable `no-unsafe-*` per file because supertest's `res.body` is `any`.
Fix: add a test-files override block in `eslint.config.js` for `apps/server/test/**/*.test.ts` and remove the per-file disables.

## 3. Focus areas checked and found correct

- **Event pipeline**
  - `EventService.commitAndBroadcast` runs `database.transaction(work)` synchronously and broadcasts only after it returns, so after COMMIT.
  - There is no `await` or `async` anywhere in `services/`, `api/` or `realtime/`.
  - `transaction()` rejects thenables and nested calls, and rolls back on throw.
  - Rejections (400/404/409/422) throw inside or before the transaction, so nothing is stored or broadcast (REQ-029).
  - The PATCH-status same-status case validates first and then discards the decision.
  - A DB failure → 500 with nothing broadcast; this is tested.
  - Check order matches API-C §0: schema → path id → agent/project/task (422) → no-op → legality (409). The self-block 400 runs before 404 (ADR-032).
- **Contracts**
  - Every route of API-C §3 exists with the contracted paths, `{data}`/`page` envelopes and status codes.
  - Error messages in `errors.ts` match §2.2 verbatim.
  - JSON-only writes, 100 KB limit, the empty body treated as `{}`, JSON 404 for unknown `/api/*`, and no-store/nosniff headers are all in place.
  - The CORS allowlist for REST is correct.
  - The Socket.IO server registers no client handlers and has an `onAny` debug log. Message order is office:event → demo:state → office:resync.
- **Demo restore safety**
  - start persists the snapshot and `startSeq` in one transaction.
  - "Touched" is derived from non-demo events (`touchedSince`).
  - Only `metadata.demo === true` untouched tasks absent from the snapshot are deleted.
  - A lost setting restores nothing.
  - Graceful close and boot recovery restore (REQ-113, tested on temp-file DBs).
  - A stop failure keeps the demo running. Exceptions are CR-2 and CR-9.
- **SQL**: everything is prepared and parameterized. Dynamic WHERE clauses are built only from fixed fragments, and `json_each` is used for lists. Event paging is `limit + 1` with an exact `nextBefore`. There are no unbounded list endpoints (max 500).
- **Security basics (REQ-160–164)**
  - No `child_process`/exec/eval.
  - The only fs access is `.env` read, DB dir creation, static dist (express.static, dotfiles ignored) and the guarded `db:reset`.
  - The host guard covers HTTP and the Socket.IO handshake/upgrade.
  - Non-loopback HOST produces a warning.
  - Errors never carry stacks or SQL.
  - Logs carry identifiers only, no payloads.
  - The Claude Code adapter is pure and wired to nothing.
- **Frontend data layer**
  - A single socket (`autoConnect:false`) with listeners attached once outside React, and an idempotent runtime `start()`. StrictMode and N reconnects give exactly one handler; this is tested.
  - Resync buffers `office:event` with the newest-snapshot-wins attempt counter, a bounded buffer and backoff retry.
  - The reducer has version gating, id dedupe, and the feed and recentEvents capped at 200. Toasts are capped at 3.
  - Simulator and demo writes go only through the reducer, with no optimistic updates (REQ-104).
  - There is no `dangerouslySetInnerHTML` or `innerHTML`. All producer text renders as React/Phaser text.
  - Zustand selectors return stable references.
- **Phaser**
  - Single game instance, with a deferred destroy that a StrictMode remount cancels.
  - Props updates go through the bridge without re-creating the scene, with a version-based diff.
  - Scene teardown removes the RESIZE listener, bridge subscription, desks and tweens. Host DOM listeners are removed.
  - There is no `update()` loop, so no per-frame allocations.
  - There are no network assets.
  - `pauseAll` and reduced motion follow API-C §10.2.
- **Tests**: meaningful and not weakened. Examples:
  - the reusable REQ-029 `expectNoTrace` (row counts, deep entity equality, empty recorder)
  - socket payload equal to response `data`
  - crash recovery on file DBs
  - seed-history replay through `decideEvent`
  - 1 000 random sequences
  - multi-cycle demo with zero rejections

## 4. Summary

There are no blockers and 2 majors, both reproduced with probes:
- **CR-1**: cross-origin read of the live socket stream.
- **CR-2**: a failed second instance silently restores and disarms the running instance's demo.

Both trace to the contract (tech-lead) and are implemented by backend-engineer. Thirteen minors are backlog or RECOMMENDED; the cheap ones are worth doing in the same fix round: CR-3, CR-5, CR-8 and CR-9. The PM's orphaned-process observation is CR-7 (devops-engineer), and it is the trigger that makes CR-2 likely.

Re-run scope after fixes: socketServer + socket tests, the index.ts boot path + boot tests, the demo restore tests, and a full `npm run verify`.

Round 1 result: FAIL (superseded by Round 2 below).

---

## Round 2 — re-review of the ADR-035 / ADR-036 fixes (2026-10-04)

Scope: every file changed since round 1:
- **Server:** `app.ts`, `index.ts`, `errors.ts`, `realtime/socketServer.ts`, `services/{demoService,projectResolver,snapshotService}.ts`, and the new and changed tests under `apps/server/test/**`.
- **Shared:** `packages/shared/src/types/api.ts`.
- **Web:** `socket/sync.ts`, `lib/runtime.ts`, `components/ErrorBoundary.tsx`, `AppErrorFallback.tsx`, `App.tsx`, `dashboard/{OfficeCard,officeSizing}.tsx`, `activity/ActivityFeed.tsx`, `pages/OfficePage.tsx`, `simulator/SimulatorDock.tsx`, plus tests.
- **Tooling:** `scripts/dev.mjs`, `eslint.config.js`, `apps/web/vite.config.ts`, root `package.json`.
- **Contract and decisions:** API_CONTRACTS v1.1 *(ADR-035)* sections, ADR-035, ADR-036.

### R2.1 Verification actually run

| Check | Result |
|---|---|
| `npm run verify` | **all 5 steps PASS**, exit 0 |
| tests | shared 16 / 854, server 31 / 639 (+46), web 22 / 1309 (+9). No skips. Build: no chunk warning (limit 1300). |
| Probe 1 re-run (server only, ephemeral port) | **Refused:** websocket with `Origin: http://evil.example`, polling with the same Origin, `Origin: null`, `Origin: http://localhost:5174` (another local app). **Connected:** `Origin: http://localhost:5173` (allowed), same-origin `http://127.0.0.1:<port>`, no Origin over websocket, no Origin over default polling→ws. |
| Probe 2 re-run (temp file DBs) | Instance B fails with `EADDRINUSE`. **A's `demo` setting is intact** and A's last event is still its own demo beat. A's later stop restores normally (2 agents restored, 1 demo task removed, 0 left). |
| Live dev stack (`node scripts/dev.mjs` with `DB_PATH` in the scratchpad) | `GET /api/health` returned 200 both directly and through the Vite proxy. Socket via proxy with `Origin: http://localhost:5173` connects on websocket and polling; direct foreign Origin is refused. |
| Launcher hard-kill (`taskkill /F /PID <launcher>` without `/T`, the CR-7 case) | Within 3 s all three children are gone (server watcher, vite, reaper) and ports 4000/5173 are free. The owner's 5174/5188 Sellway listeners are untouched. No project node processes are left. |
| Launcher started from a shell that then exits | It stops itself ("parent process exited"), as ADR-036 §3 intends. |
| Launcher busy-port preflight (own dummy listener on 4000) | Exit 1, prints the holder's PID and command line, starts nothing, kills nothing. |
| Office lint boundary (ESLint on stdin against existing filenames) | **Flagged:** `office/objects/*` → `../../store`; `office/*` → `../api/client` and `../layout/ids`; `dashboard/*` → `../office/bridge` and `phaser`. **Allowed:** `office/objects/*` → `../officeLayout`. Correct depth handling. |

Not independently verified: the interactive console Ctrl+C / Ctrl+Break path of `dev.mjs`. I cannot send a console control event from this environment; ADR-036 reports it as tested by devops.

### R2.2 Status of round-1 findings

| ID | Sev | Status | Evidence |
|---|---|---|---|
| CR-1 | major | **FIXED** | `socketServer.ts:46-77, 90-102`. Order is Host → Origin → readiness. Origin is allowed when absent, in CORS_ORIGINS, or same-origin (`url.host === Host`). `null`, other schemes and other ports are refused, with a `socket_rejected` log. Tests in `test/socketOrigin.test.ts` cover websocket and polling, a 403 polling handshake, no `office:event` for a refused client, same-origin, and the unit table. Probe 1 confirms. |
| CR-2 | major | **FIXED** (same port) | See the walkthrough below. |
| CR-3 | minor | FIXED | `sync.ts:117-120, 81-86`: `pendingDemo` is re-applied after `hydrate`. Both the socket path (`runtime.ts:172`) and the response path (`runtime.ts:244, 247`) go through `handleDemoState`. If the snapshot response overtakes a later `demo:state`, the socket message still arrives afterwards and corrects it. Test: `sync.test.ts:168`. |
| CR-4 | minor | FIXED | `snapshotService.ts:65` takes `lastSeq` (global `maxSeq`, before the project filter) in the same synchronous read. `sync.ts:76-79` drops buffered payloads with `seq <= lastSeq` and keeps `event:null` results, which stay version-gated. Tests: `snapshotWatermark.test.ts:14-45`, `sync.test.ts:138`. |
| CR-5 | minor | FIXED | `components/ErrorBoundary.tsx` remounts via a key on Retry. `OfficeCard.tsx:256-296` wraps the host; `onReset` re-creates the `lazy()` component (`:41-42`, `:258`), because React caches a rejected lazy import. The app-level boundary in `App.tsx:93` uses `AppErrorFallback` (Retry + Reload). Effect-time errors are covered as well. Tests: `OfficeCard.test.tsx:29, 47`. |
| CR-6 | minor | FIXED | `snapshotService.ts:34-53` returns the newest 500 plus agent-bound tasks, in `GET /api/tasks` order. This matches API-C v1.1 §3.11. Test: `snapshotWatermark.test.ts:48, 90`. |
| CR-7 | minor | FIXED | `scripts/dev.mjs`, root `"dev": "node scripts/dev.mjs"`. No shell or npm layers; children are spawned with `process.execPath`. Stop is by signal, child exit, ancestor watch, or detached reaper. Tree-kill is `taskkill /T /F`. A leftover port listener is killed only if it is provably one of the launcher's own processes. Foreign processes are never killed. The live checks above confirm. |
| CR-8 | minor | FIXED | `index.ts:128-155`: SIGINT, SIGTERM, SIGHUP, SIGBREAK (win32), and IPC `disconnect` when `process.connected`. Runs once, with a forced exit 1 after 5 s. Test: `test/shutdownSignals.test.ts`. The `node --watch` limitation is documented in ADR-036 and is covered by boot crash recovery. |
| CR-9 | minor | FIXED | `demoService.ts:178-205`: transitive keep set from surviving agents' `taskId` and surviving tasks' `blockedBy`. Each kept id is counted once in `tasksKept` (it is removed from `deletable` when kept) and reported through `keptReferences`. Test: `test/demoReferences.test.ts` (3 cases, including the unchanged no-reference behaviour). |
| CR-10 | minor | FIXED | `runtime.ts:151-153, 282-285`: the first snapshot comes from the socket connect; the HTTP fallback fires after 1.5 s only if no sync has started. If the socket connects later than 1.5 s, a second fetch still happens. That is acceptable and matches the ADR-033 intent. |
| CR-11 | minor | FIXED | `ActivityFeed.tsx:26-31`: the `DayLabel` child owns `useNow`, so the feed no longer re-renders every second. Test: `ActivityFeed.render.test.tsx:31`. |
| CR-12, CR-13, CR-14 | minor | DEFERRED (ADR-035 §8) | Accepted as backlog. **PM action:** they are not yet in `tasks/BACKLOG.md`, and neither is the "remove `concurrently`" item from ADR-036. Add them so the deferral is tracked. |
| CR-15 | minor | FIXED | `eslint.config.js:225-227` test-files override. No `eslint-disable` remains in the server tests or web src; the only one left is the contracted one in `shared/types/socket.ts`. |

**CR-2 walkthrough** (`index.ts:56-91`, `app.ts:59, 86-90, 133-156`):
- `createServerApp({ startReady:false })` → `listen` → seed → `recoverOnBoot` → `markReady`.
- A listen failure aborts before seed or recovery. `abort` → `server.close()` is safe because no demo session exists.
- The readiness gate returns 503 `Server is starting` with `Retry-After: 1` and no-store/nosniff headers. Sockets are refused with reason `starting`.
- `projectResolver` loads lazily and does not cache an empty list, because the app now exists before the seed.
- Seed, recovery and `markReady` run synchronously in one continuation after `listen` resolves, so no request can observe a half-recovered state.
- Tests in `test/startup.test.ts`: gate, host guard first, busy port leaves the DB and running demo untouched, failed boot leaves a new DB unseeded, log order.
- Probe 2 confirms.

### R2.3 New findings

**[CR-16] severity: minor**
ROOT_CAUSE: contract — ADR-035 makes the **port** the single-instance lock. A second instance on a **different** `PORT` with the same `DB_PATH` still runs `recoverOnBoot()` against a running instance's demo, which is the CR-2 effect again. The round-1 RECOMMENDED DB-level lock was not adopted.
OWNER: tech-lead (decide), then backend-engineer.
AFFECTED_COMPONENTS: `apps/server/src/index.ts`, API-C §9.8
INVALIDATED_GATES: none
Evidence:
- `index.ts:56, 74-87`. The lock is the port only.
- Reaching this case requires a deliberate `PORT` override with the default DB, so the likelihood is low. That is why this is minor, not major.

Fix (backlog): a lock file next to the DB (pid + port, stale detection via `process.kill(pid, 0)`), or `PRAGMA locking_mode=EXCLUSIVE` for file DBs, taken before `recoverOnBoot`. `db:reset` could then check the same lock instead of only the port.

**[CR-17] severity: minor**
ROOT_CAUSE: backend (performance)
OWNER: backend-engineer
AFFECTED_COMPONENTS: `apps/server/src/services/snapshotService.ts`
INVALIDATED_GATES: none
Evidence:
- `snapshotService.ts:39-41` reads and maps **every** task row on each snapshot to keep the newest 500.
- The payload stays bounded, but server work grows with history. It is negligible at Phase 1 sizes.

Fix (backlog): query the newest 500 directly (`ORDER BY created_at DESC, id DESC LIMIT 500`, e.g. a `TaskRepository.listNewest(limit)`), then re-sort.

### R2.4 Regressions checked

None found:
- REST CORS, host guard and the REQ-029 tests are unchanged and green.
- The readiness gate sits after the host guard and before the router (`app.ts:86-97`), so a foreign Host still gets 403 first. This is tested.
- `createTestApp` defaults to `startReady: true`, so the existing suites are unaffected.
- The `Snapshot` type gained a required `lastSeq`. Every web fixture was updated, and the client tolerates a missing value (`sync.ts:76`).
- The simulator dock moved outside the office/roster scroll area (`OfficePage.tsx:128-144`). It is still `shrink-0`, 200 px tall, with its own scroller; the sheet and fullscreen variants are unchanged. Web tests are green.
- Lint boundaries are still enforced (probe above).

### R2.5 Round 2 summary

Both majors are fixed and confirmed by re-running the probes that exposed them. All round-1 minors are fixed except CR-12/13/14, which are deferred by ADR-035 §8. Two new minors (CR-16, CR-17) go to the backlog. No blockers or majors remain.

Round 2 result: PASS (superseded by Round 3 below).

---

## Round 3 — focused delta review of ADR-037 and the TASK-009 changes (2026-10-04)

Scope: the files changed since the round 2 PASS.
- **Server:** `api/middleware/{originGuard,requireJson,errorHandler}.ts`, `app.ts`, `errors.ts`, `realtime/socketServer.ts`, `services/demoService.ts`, `test/securityHardening.test.ts`, `test/demo.test.ts`.
- **Shared:** `constants/{errorCodes,limits}.ts`, `schemas/common.ts`, plus tests.
- **Web:** `store/reducer.ts`, `agents/logLine.ts`, `copy.ts`, `lib/runtime.ts`, plus tests.
- **Tooling:** `apps/web/vite.config.ts`, `scripts/{smoke-live,dev}.mjs`, root `package.json`.
- **Docs:** `docs/DEPLOYMENT.md`, API_CONTRACTS v1.2 *(ADR-037)*, ADR-036 §7, ADR-037.

The security engineer re-verifies SEC-1…6 in parallel, so I focused on correctness, contract adherence, tests and regressions, and did not probe security in depth.

### R3.1 Verification actually run

| Check | Result |
|---|---|
| `npm run verify` | **all 5 steps PASS**, exit 0 |
| tests | shared 16 / 864 (+10), server 32 / 678 (+39), web 22 / 1317 (+8). No skips. |
| `npm run smoke` | **27/27 PASS**, exit 0, on a free port with a temp DB. Covers boot, health, 15 agents, `index.html` with XFO/CSP, asset, SPA fallback, JSON 404, socket, the §12 event (201 + broadcast), foreign-Origin socket refused and PATCH 403, graceful IPC stop, restart persistence with no reseed, temp dir removed. |
| `npm run smoke -- --dev` (ports 4000/5173 free) | **35/35 PASS**, exit 0. Afterwards 4000/5173 are released, 5174/5188 (owner's Sellway) are untouched, and no smoke or launcher processes are left. |
| `npm run smoke -- --dev`, first attempt | 34/35 checks reported PASS, exit 1. Ports 4000/5173 were held by another agent's stack (started from this session's scratchpad with `r2.db`), so most of those PASS checks ran against it — see CR-18. I killed nothing; that stack exited on its own before the retry above. |
| Delta probe (scratchpad, `createTestApp`) | **Foreign-Origin requests:** PATCH → 403 `ORIGIN_NOT_ALLOWED`; POST to an unknown route → 403, because the Origin rule runs before routing, as API-C §0 orders it. **Bodies:** gzip → 400 `INVALID_JSON` "Content-Encoding is not supported"; `Content-Encoding: identity` → 201. **Ids:** `__proto__` → 400 `Task id "__proto__" is reserved`. **Reads:** GET with a foreign Origin → 200. **Headers:** XFO DENY on every Express response. |

### R3.2 Delta review (correct unless listed in R3.3)

- **SEC-2**
  - `originGuard.ts` moves `isAllowedOrigin` out of `socketServer.ts` (now a re-export, one rule for both).
  - It applies only to POST/PATCH/PUT/DELETE with an Origin header.
  - The order in `app.ts:86-99` is framing → Host → Origin → readiness → router, which matches §0.
  - Tests: `securityHardening.test.ts:27-124`.
- **SEC-3**
  - `inflate:false` (`requireJson.ts:54-59`); `encoding.unsupported` maps to 400 `Content-Encoding is not supported`.
  - The fallback mapping (zlib codes, `expose` 4xx → 400) keeps genuine internal errors at 500, which is tested.
  - Content-type is still checked before encoding, so a non-JSON type stays the first failure (§0 step 1).
- **SEC-4**
  - Shared `taskIdSchema` rejects `RESERVED_TASK_IDS` in every task-id position: body, event, PATCH-status, `blockedBy`, query.
  - The web reducer builds every entity record with `Object.create(null)` and `defineProperty`, in initial state, `hydrate` and `withEntry`. No remaining `{...state.agents}` spreads.
  - The per-update record copy is O(n), the same cost as before.
- **SEC-5**: framing headers come from `app.ts:166-170` (Express) and `vite.config.ts` (dev and preview). `cors:false` on dev and preview.
- **QA-1**: `logLine.ts:13` appends `→ <status>`.
- **QA-3**:
  - Server `countOf`/`stoppedMessage` (`demoService.ts:209-216`) matches API-C §3.14 v1.2 exactly ("1 agent and 0 tasks restored, 1 demo task removed").
  - The client toast pluralizes (`copy.ts:80-81`).
- **Mobile rule**: `initialUi` opens the simulator from storage only at ≥ 768 px (`runtime.ts:318-323`).
- **Tooling**
  - `dev.mjs:251-252`: an IPC `disconnect` stops the launcher (ADR-036 §7).
  - `smoke-live.mjs`:
    - spawns with no shell and passes env through `spawn` options
    - uses a temp DB, never `data/office.db`
    - stops gracefully through IPC `disconnect`
    - force-kills only the PIDs it started, then removes its temp dir
  - Root script `"smoke"` exists, and every `npm run …` command in `DEPLOYMENT.md` maps to an existing script.
- **Regressions**: none found. REQ-029, host guard, CORS, readiness gate, the socket Origin rule (re-exported) and the round-2 tests are all green. The Origin rule passes same-origin vite preview (`localhost:4173`, proxied Host) and the dev proxy (`localhost:5173`).

### R3.3 New findings

**[CR-18] severity: minor**
ROOT_CAUSE: infrastructure — `smoke-live.mjs --dev` neither checks that ports 4000/5173 are free nor checks that its launcher is still alive. When another stack already holds the ports, the launcher exits 1 at its own preflight, but the script still runs every dev check against the foreign stack. It reports PASS for those checks and sends it a (no-op) PATCH.
OWNER: devops-engineer
AFFECTED_COMPONENTS: `scripts/smoke-live.mjs`
INVALIDATED_GATES: none
Evidence:
- `smoke-live.mjs:354-368`: `devRun` spawns `dev.mjs`, then only polls `:5173/api/health`.
- Observed in this round: 34 "PASS" results against a parallel agent's server and Vite.
- The run still exited 1, but only because the final "ports released" check happened to fail. The header comment (`:8`) says the ports "must be free", but nothing enforces it.

Fix:
- Before spawning, probe 4000/5173 (127.0.0.1 and ::1). If either is busy, record one FAIL ("ports busy — dev checks not run") and skip the dev checks.
- While waiting for health, fail fast if `proc.child.exitCode !== null` (launcher exited) and print its last output lines.

**[CR-19] severity: minor**
ROOT_CAUSE: backend — API-C §0 requires `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on `/api` responses. The new 403 `ORIGIN_NOT_ALLOWED` responses lack both, as do host-guard 403s, because those errors are answered by the app-level error handler before the `/api` router middleware that sets the headers.
OWNER: backend-engineer
AFFECTED_COMPONENTS: `apps/server/src/app.ts`, `apps/server/src/api/router.ts`
INVALIDATED_GATES: none
Evidence:
- Delta probe: PATCH or POST with `Origin: http://localhost:5174` → 403 with `cache-control: null` and `x-content-type-options: null`.
- The readiness gate sets both explicitly (`app.ts`, `readinessGate`); the router sets them at `router.ts:17-21`.

Fix:
- Move the no-store/nosniff middleware to the app level (next to `frameProtection`) for `/api`, or set both headers in `errorHandler`.
- Extend the "every /api response has … headers" test to Origin and Host refusals.

Note (no finding): engine.io answers `/socket.io` handshakes itself, so those JSON responses carry no framing headers, despite §0's "every HTTP response". They are not frameable documents, but the contract wording could say "every Express response" (tech-lead, wording only).

### R3.4 Round 3 summary

The ADR-037 changes match API-C v1.2 and are covered by tests. `verify`, `smoke` and `smoke --dev` are green, and the ports were left clean. Two new minors go to the backlog:
- **CR-18** (devops): `smoke --dev` gives false PASS results when the ports are taken.
- **CR-19** (backend): missing no-store/nosniff headers on 403 guard responses.

No blockers or majors.

Round 3 result: PASS (superseded by Round 4 below).

---

## Round 4 (addendum) — AUD-2: CR-18, CR-19 and the AUD-3 `dev.mjs` change (2026-10-04)

Scope:
- `apps/server/src/{app.ts, api/router.ts, api/middleware/errorHandler.ts}` and `test/api/basics.test.ts`
- `scripts/smoke-live.mjs`, `scripts/dev.mjs` (now 497 lines), and the ADR-036 AUD-3 addendum

This round was read-only plus `verify` and `smoke`. As instructed, I did not run `npm run dev` or `smoke --dev` and I killed no process.

### R4.1 Runs

- **`npm run verify`:** all 5 steps PASS. Tests: shared 864, server 687 (+9), web 1317.
- **`npm run smoke`:** 27/27 PASS on a free port with a temp DB. The port was released and the temp dir removed.

### R4.2 CR-19 — FIXED

- `app.ts:89` adds `apiHeaders` (no-store + nosniff) at app level **before** the Host and Origin guards.
- `errorHandler.ts:75-76` sets both headers on every error envelope, which also covers a Host refusal outside `/api`.
- `router.ts` no longer duplicates them.
- Tests in `basics.test.ts:17-86`:
  - 200
  - Host-guard 403 on a read and on a write
  - Origin-rule 403
  - Host refusal outside `/api`

### R4.3 CR-18 — FIXED

`smoke-live.mjs:398-439`:
- **Port pre-check:** before spawning, it probes 4000/5173 on 127.0.0.1 and ::1. If either is busy it records one FAIL with the holder description (read-only) and runs none of the dev checks.
- **Fail-fast:** while waiting for health, `launcherGone()` stops the wait. A launcher that exits before it is healthy gives a FAIL with its last output, so checks can no longer run against someone else's stack.

### R4.4 AUD-3 `dev.mjs` and PID-reuse safety (special focus)

I traced every kill call in both scripts (`grep kill`): `dev.mjs:35/42/45/66/200/217/225/231/245` and `smoke-live.mjs:54/57/137/545`.

**Confirmed safe:**
- **Ancestor chain** (`parentPidsToWatch`, MSYS bridging, `findCygwinStub`, `dev.mjs:340-497`): **watched only, never killed.** Ancestor PIDs are used only in `isAlive(pid)` (`:174-178`). A wrong match or a reused ancestor PID can only make the launcher stop early, or keep it running. Robustness note: if a dead ancestor's PID is reused within 500 ms, the launcher misses that ancestor's exit. That is fail-safe and does not kill anything.
- **PowerShell JSON sanitising** (`parsePowerShellJson`, `:260`) only feeds the watch list and the read-only holder description.
- **`smoke-live.mjs` is PID-reuse safe.** It kills only processes it spawned itself, and only while Node has not yet observed their exit:
  - `:137` runs only after the graceful-stop timeout, while the `exited` promise is still unresolved.
  - `:545` is guarded by `exitCode === null && signalCode === null`.
  - Until Node/libuv reaps the exit, it holds the child's process handle, and Windows never reuses a PID while a handle to that process is open.
  - There is no PID-lookup or port-lookup kill in the smoke script.

**Not safe — see CR-20.**

**[CR-20] severity: major**
ROOT_CAUSE: infrastructure — the shipped launcher has kill paths that identify their target only by a PID number that may already belong to a different process. `killTree` uses `taskkill /PID <pid> /T /F`, and its `isAlive(pid)` pre-check (`dev.mjs:33`) is exactly what makes a **reused** PID look like "ours". This is the same failure class as the devops test-harness incident, and it violates CLAUDE.md §13 (no destructive action without justification) and ADR-036 §2 ("never kills a foreign process").
OWNER: devops-engineer
AFFECTED_COMPONENTS: `scripts/dev.mjs`
INVALIDATED_GATES: none (the code-review gate for this file fails until fixed)
Evidence:
1. **Main stop path, `dev.mjs:217`.** `for (const { child } of children) killTree(child.pid);` has no exit guard.
   - On Ctrl+C / Ctrl+Break / console close, and on a vanished ancestor (`graceful = true`), the children exit by themselves. `running()` then becomes empty and the launcher waits for the ports to free.
   - It then runs `taskkill /T /F` on both **already-exited** child PIDs.
   - Node closed those process handles when it processed the exits, so Windows may already have reused the PIDs. If so, a foreign process and its whole tree are force-killed.
   - The same applies to the `process.on('exit')` handler (`:244-246`), which runs right after `process.exit` in `shutdown` and therefore makes a second pass on every stop.
2. **Reaper, `dev.mjs:56-69`.**
   - The detached reaper is not the children's parent and holds no handle to them. It knows them only as PID numbers polled every 500 ms (`children.filter(isAlive)`).
   - Suppose a child exits and its PID is reused between two polls, and the launcher then disappears. The reaper force-kills the foreign tree. The comment "never kill a PID after its process has exited" is true only at 500 ms granularity.
3. **`dev.mjs:229-231`.** `process.kill(reaper.pid)` is guarded only by `isAlive(reaper.pid)`. The reaper may already have exited on its own once all children were gone (`:61-63`), so this has the same reuse window (TerminateProcess on a foreign PID).
4. **`dev.mjs:219-226`.** A leftover port listener is killed when `own.has(holder.pid) || own.has(holder.ppid)`. `childPids` are numbers of possibly-exited children, and Windows `ParentProcessId` is never updated, so it can name a reused PID. This path is limited to listeners on 4000/5173, but it is still a lookup-based kill.

Fix:
- (1) and (3): kill a child, or the reaper, **only while Node has not observed its exit** (`child.exitCode === null && child.signalCode === null`). The handle is still open then, so the PID cannot have been reused. Drop `isAlive()` as identity proof in `killTree` callers.
- (2): when the reaper starts, record each child's identity: PID **plus creation time** (`Win32_Process.CreationDate`; `ps -o lstart=` on POSIX). Immediately before `killTree`, re-read and compare it, and skip on mismatch.
- (4): either remove it (the server under `node --watch` is a descendant that `taskkill /T` reaches while its watcher is alive), or require that the holder's creation time is not earlier than our matching child's spawn time and that the matching child has not exited.
- Add a unit-testable `isSameProcess(pid, recordedCreationTime)` helper and a test using a fake process table.
- Residual note (uncertain, low): `taskkill /T` itself finds descendants by `ParentProcessId`. Killing only live, un-reaped children keeps that sound for processes created after our child.

### R4.5 Round 4 summary

- CR-18 and CR-19 are fixed and verified.
- The AUD-3 ancestor watching is correct and never kills anything it finds by lookup.
- `smoke-live.mjs` has no PID-reuse kill path.
- The shipped `dev.mjs` still has four kill paths that can hit a reused PID (CR-20, major, devops-engineer). Fixing it is small and confined to `scripts/dev.mjs`.
- Re-run scope: `dev.mjs` kill paths, plus `npm run verify` and `npm run smoke`. A `smoke --dev` run is needed once ports 4000/5173 are free.

Round 4 result: FAIL (superseded by Round 5 below).

---

## Round 5 (delta) — CR-20, QA-4, QA-5, QA-6, CR-14 (2026-10-04)

Scope:
- **Launcher:** `scripts/dev.mjs` (588 lines), `scripts/lib/{processIdentity,sourceWatcher}.mjs` and the three `scripts/lib/*.test.mjs` files.
- **Scripts:** `apps/server/package.json` (`dev` → `dev.mjs --only=server`), root `test` / `test:scripts`.
- **Office:** `apps/web/src/office/{runtime,inputGuard,OfficeScene,gameManager}.ts`, `objects/AgentDesk.ts`, plus tests.
- **Server:** `apps/server/src/app.ts` (QA-4), plus `test/securityHardening.test.ts`.

No process was killed. Everything I started was stopped through its own stop path (IPC `disconnect`).

### R5.1 Runs

| Check | Result |
|---|---|
| `npm run verify` | **all 5 steps PASS**. Tests: shared 864, server 689, web 1328, scripts (`node --test`) 15/15. |
| `npm run smoke` | **27/27 PASS** on a free port with a temp DB. |
| `npm run smoke -- --dev` (4000/5173 checked free first) | **35/35 PASS**. Ports released afterwards; 5174/5188 untouched. |
| Live `dev.mjs --only=server` (scratchpad DB, started from a node wrapper with IPC) | Healthy. **No restart** after reading `apps/server/src/logger.ts` and `packages/shared/src/index.ts` and re-applying `logger.ts`'s own atime/mtime. IPC disconnect → `server_stopping {signal:"disconnect"}` → `server_stopped` → launcher exit 0 in 53 ms → port 4000 free. The server now really shuts down gracefully, which removes the old ADR-036 `--watch` limitation. |
| Watcher probe (`watchSources` on a temp dir) | **No event:** read, mtime-only touch, rewrite with identical content. **One event each:** content edit, file add, file delete. **No event:** directory rename, directory delete (CR-21). |

### R5.2 CR-20 — FIXED (PID-reuse safety re-verified against my round-4 criteria)

Every kill call in `dev.mjs`, by line:

| Line | Call | Why it is safe |
|---|---|---|
| `:220` (`stopChild`) | `killTree` | Guarded by `isRunningChild(child)`. Node has not reaped the child, so the OS handle is open and the PID cannot be reused. |
| `:229`, `:317` | `reaper.kill()` | Guarded by `isRunningChild(reaper)`. |
| `:305` (POSIX) | process-group signal | Guarded by `isRunningChild(web)`. |
| `:336` (`exit` handler) | `killTree` | Guarded by `isRunningChild`. |
| `:99` (reaper) | `killTree` | Only for identities `pid:creationTime` that the launcher recorded while it held the children un-exited (`refreshReaper`, `:226-246`). A child that exits during the query gets identity 0, which is never killable. `isSameProcess` re-reads the creation time immediately before each kill, and the kill is skipped on any mismatch, unknown value or missing process. |

- `isAlive()` now only **drops** candidates in the reaper and watches ancestors. It is never used as proof of identity.
- **The port-lookup kill is removed.** `windowsPortHolders` now only feeds the read-only preflight description.
- `smoke-live.mjs` is unchanged and safe (round 4).
- Tests:
  - `processIdentity.test.mjs`: fake table covering same, reused, gone, unknown and invalid identities; real OS query; an exited child is no longer the same process.
  - `devReaper.test.mjs`: a real reaper kills only the verified child and spares both the "reused" identity (creation time shifted) and the unknown one.
- Residual (accepted, not a finding): a tiny window between the reaper's identity check and `taskkill`. The check is a synchronous PowerShell query immediately before the kill. Its only consequence is on the hard-killed-launcher path.

### R5.3 QA-6 — content-hash watcher (FIXED, with 2 minors)

- **Correctness**
  - The server runs without `--watch` and with IPC.
  - `restartServer` (`:250-272`) does a graceful stop (IPC disconnect, up to `GRACE_MS` 6 s, then a kill only while the child is still ours), then starts a new child and refreshes the reaper.
  - Overlapping changes are coalesced (`restarting` / `restartAgain`).
  - Shutdown during a restart never starts a new child.
  - A crashed server waits for the next change, like `node --watch`.
- **Resources**
  - One recursive `fs.watch` per root (2 roots).
  - A snapshot map of hashes, one per watched source file.
  - A `pending` set cleared on every debounced flush.
  - The watchers are closed in `shutdown`.
  - Nothing grows without bound.
- **Tests:** `sourceWatcher.test.mjs` uses a real `fs.watch`: reads and metadata-only changes do not fire, a real edit does.

**[CR-21] severity: minor**
ROOT_CAUSE: infrastructure
OWNER: devops-engineer
AFFECTED_COMPONENTS: `scripts/lib/sourceWatcher.mjs`
INVALIDATED_GATES: none
Evidence:
- `sourceWatcher.mjs:157-159, 119-131`. A directory rename or delete produces events named after the **directory**. `isWatchedSource` (extension filter) drops that path, so the files under it are neither re-hashed nor reported. The probe confirmed no restart for both.
- `node --watch` did restart when a loaded file vanished. Moving or deleting a source folder now leaves the server running stale code until the next real file edit.

Fix: when an event name does not pass the filter, add that path as a rescan prefix: re-scan it and diff snapshot keys under `prefix + sep`. Add a test for directory rename and delete.

**[CR-22] severity: minor**
ROOT_CAUSE: infrastructure
OWNER: devops-engineer
AFFECTED_COMPONENTS: `scripts/lib/sourceWatcher.mjs`
INVALIDATED_GATES: none
Evidence: `sourceWatcher.mjs:163-165`. A watcher `error` is swallowed. After an error, a recursive `fs.watch` delivers nothing more, so the dev server silently stops auto-restarting.
Fix: log a warning through the launcher (`onError` callback) and re-arm the watcher (re-snapshot the root), or at least tell the user to restart `npm run dev`.

### R5.4 QA-5 office input guard — FIXED

- `runtime.ts:28-41`: `buildGameConfig` sets `input.windowEvents:false`, so window-level mousedown/touchstart over DOM UI is no longer fed into Phaser.
- `inputGuard.ts`: pure functions that check the target is the canvas, plus a primary-button test.
- The guard is applied to:
  - background press (`OfficeScene.ts:68-73`)
  - desk over / move / down (`:105-124`; `AgentDesk.ts` delegates to the host)
- Leaving the canvas still clears the hover (`GAME_OUT`, and `deskPointerOut` is unguarded).
- Touch works: `TouchEvent.target` is the canvas and `button` is 0.
- Tests: `inputGuard.test.ts`, `runtime.test.ts`.
- I did not check this in a real browser; jsdom tests only.

### R5.5 CR-14 — FIXED

- `gameManager.ts:113-157`: bounds are always refreshed on `pointerdown` (capture on the host, before Phaser's canvas listener). On `pointermove` they are refreshed only when marked dirty (`pointerenter`, window resize, scroll, ResizeObserver). All listeners are removed symmetrically.
- Note (no finding): a layout shift without resize or scroll (e.g. a banner inserted above while the pointer stays on the canvas) leaves the hover-tooltip rect stale until the pointer re-enters. Clicks are unaffected.

### R5.6 QA-4 — FIXED

- `app.ts:104-108`: an app-level `apiNotFound` runs after the API router and static mount, so unmatched non-`/api` paths (API-only mode, non-GET in one-port mode) answer the JSON 404 envelope with framing, no-store and nosniff headers instead of Express's finalhandler page.
- One-port GET/HEAD page routes are still served by the SPA fallback first (`npm run smoke` confirms index, SPA fallback and the JSON 404).
- Tests: `securityHardening.test.ts:235+`.

### R5.7 Round 5 summary

- **CR-20** is fixed: every kill path in the shipped launcher now targets only processes the launcher provably owns.
- **QA-4, QA-5, QA-6 and CR-14** are fixed and tested.
- `verify`, `smoke` and `smoke --dev` are green, and the dev server now shuts down gracefully.
- Two new minors go to the backlog: **CR-21** (directory rename/delete not detected) and **CR-22** (silent watcher failure), both devops-engineer.
- No blockers or majors.

VERDICT: PASS
