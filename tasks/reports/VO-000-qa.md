# VO-000 — QA gate, integrated Phase 1 MVP

QA: qa-engineer (gate) · Date: 2026-10-04 · Scope: the whole Phase 1 app (TASK-001 … TASK-008), after code review
round 2 PASS (`tasks/reports/VO-000-review.md`). Binding inputs: ORIGINAL_REQUEST §32, REQUIREMENTS v1.2,
UX.md, API_CONTRACTS v1.1, DECISIONS ADR-031…036 (accepted deviations are not re-raised).

Environment: Windows 11 Pro, Node v24.12.0, npm 11.6.2, Chrome via Claude in Chrome. The real dev DB
`data/office.db` was used (local dev data only). It was reset to the seed baseline (`npm run db:reset`) before
testing and again at the end, so it is now the fresh seed. No application code was changed. No test files were
added: the existing 2 802 automated tests already cover the matrix below, and I found no defect that needs a new
regression test. The live exercise scripts are in the session scratchpad, not in the repo. Nothing was committed.

## 1. Commands run (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npm run verify` | **exit 0**, 43 s. PASS format:check 2.4 s · lint 11.5 s · typecheck 6.3 s · test 14.4 s · build 8.0 s |
| 1a | tests in verify | shared 16 files / **854** · server 31 / **639** · web 22 / **1309**; all passed, 0 skipped |
| 1b | build in verify | vite build OK, no chunk warning. Lazy Phaser `runtime-*.js` is 1 223 kB (limit 1300, ADR-036) |
| 2 | `npm run db:reset` (server stopped) | `Seeded 15 agents, 11 tasks, 44 events.` |
| 3 | `node scripts/dev.mjs` (= `npm run dev`) | `[web] VITE ready`, `[server] server_started host 127.0.0.1 port 4000`. `/api/health` 200 directly and through the Vite proxy on :5173 |
| 4 | live API + Socket.IO script (`live-api.mjs`, scratchpad, socket.io-client) | **169 / 170 PASS**. The one FAIL (SG-5) is a harness artefact, re-verified with curl → PASS (see §2.3) |
| 5 | second `node scripts/dev.mjs` while running | exit 1: `Port(s) 4000, 5173 already in use — not starting anything.` Names both holder PIDs and command lines. Kills nothing |
| 6 | `db:reset` while server running | exit 1: `db:reset refused: Server is running on 127.0.0.1:4000 — stop it before resetting the database.` |
| 7 | stop launcher (hard stop of the parent shell) | within 4 s: 4000/5173 free, 0 project node processes left, Sellway 5174/5188 untouched |
| 8 | restart test (launcher) | snapshot before vs after restart **identical**: 15 agents, 14 tasks, lastSeq 70, all agent versions equal. No reseed |
| 9 | browser session (server and web started separately, so the server alone could be stopped) | §3 below |
| 10 | crash test: demo active (2 s), `taskkill /F` server, restart | boot log `demo_recovered {agentsRestored:4, tasksDeleted:3}` **before** `server_started`. State identical to pre-demo, demo inactive, no demo events 4.5 s after boot (REQ-113) |
| 11 | cleanup | ports 4000/5173 free, 0 project processes, DB reset to seed, my browser tab closed |

## 2. Test matrix — API, socket, persistence (live, real server)

### 2.1 Reference data, agents, health (REQ-001/002/025/026/028, REQ-120/121)

| ID | Case | Result |
|---|---|---|
| H-1/2 | `GET /api/health` → 200 `{status:ok, db:ok, uptimeSec, version:"0.1.0", time}`; headers `no-store`, `nosniff`, JSON | PASS |
| P-1 | `GET /api/projects` → 4 ordered (sellway, ishkun24, erp, ana-market); no "All Projects" | PASS |
| A-1…3 | `GET /api/agents` → 15, every §2 field present, unique id/code/deskId, `online ⇔ status≠offline` | PASS |
| A-4/5, T-0 | seed: BE idle on sellway with no task; SW-123 `assigned` to BE; metrics 14/3/1/1/1/1/7/1 (API-C §7.2) | PASS |
| A-6/7 | `GET /api/agents/04-backend-engineer` 200; `/99-nobody` 404 `Agent not found: 99-nobody` | PASS |
| A-8…12 | `?project=sellway` filters; `SELLWAY` accepted; `unknown` and `All Projects` → 422; unknown query key → 400 | PASS |
| R-1/2 | `GET /api/nope` and `DELETE /api/agents` → JSON 404 `Route not found: GET /api/nope` | PASS |

### 2.2 Writes: PATCH status, POST events, tasks (REQ-004, 011, 020–024, 029, 040–042)

Every rejection case also checked that **no `office:event` was broadcast** to a connected socket.io-client. The
REQ-029 sweeps (S-8, E-36) checked that the agent is byte-identical and `MAX(seq)` is unchanged.

| ID | Case | Result |
|---|---|---|
| S-1 | PATCH BE idle→completed → 409, message `Illegal transition: idle → completed`, details `{entity:agent, from:idle, to:completed}`, no broadcast | PASS |
| S-2/3/5/7 | `status:"sleeping"` 400 · unknown agent 404 · `source:"demo"` 400 `Source "demo" is reserved` · `text/plain` 400 `Content-Type must be application/json`; no broadcast | PASS |
| S-4 | PATCH idle→idle → 200 `event:null`, no broadcast | PASS |
| S-6 | offline DevOps → working 409 `Illegal transition: offline → working` | PASS |
| S-8 | BE unchanged after all PATCH rejections | PASS |
| S-9 | working→idle clears taskId/currentTask/progress/startedAt and keeps currentProject (REQ-003) | PASS |
| E-1…6 | §12 example → 201. Event `project:"sellway"`, `source:"api"`, `severity:"info"`, `forced:false`. Agent working with `run_command` / "Running backend tests", SW-123 / "Lost Goods API", startedAt set. SW-123 → in_progress with startedAt. **Exactly one** broadcast, deep-equal to the response `data`. Returned first by `GET /api/events` | PASS |
| E-7 | metrics after §12: Working 3→4. Active Tasks stays 7, because SW-123 `assigned`→`in_progress` is active→active (A-06) | PASS (see note N-1) |
| E-10…31 | 22 invalid bodies with the expected status and code: unknown agent/project/"All Projects" 422 · invalid status/type 400 · unknown field `foo: Unrecognized key` · server-only `task.created` · reserved `system` · progress 101 / 1.5 · metadata array / > 8 KB · missing action · `force` · `status` on `agent.connected` · working→planning 409 · lifecycle on unknown task 422 · PROJECT_MISMATCH 422 · action 101 / message 2001 chars · bad taskId pattern · `agent.task.assigned` new task without project 422 | PASS (all, no broadcast) |
| E-32/33/34/35 | malformed JSON 400 `Request body is not valid JSON` · missing Content-Type 400 · 120 KB body 413 `Request body exceeds 100 KB` · `application/json; charset=utf-8` accepted | PASS |
| E-36 | REQ-029 sweep: no event stored, BE unchanged after 26 rejections | PASS |
| E-37/38 | `<img src=x onerror=…>` message stored literally · project-less `system.warning` 201, `agent:null`, severity warning | PASS |
| Q-1…8 | `GET /api/events`: project feed predicate (incl. project-less warning) · limit 501 / `abc` 400 · type bogus 400 · unknown agentId 422 · `before` cursor pages older with no overlap · agentId filter · `source=demo` allowed | PASS |
| TK-1…4 | `GET /api/tasks` filters; invalid status 400; unknown agent/project 422 | PASS |
| TK-5/6 | POST `{title, project:"Sellway"}` → 201 **SW-126** todo, `task.created`, version 1, one broadcast | PASS |
| TK-7…12 | duplicate id 409 TASK_EXISTS · `assigned` without assignee 400 · self `blockedBy` 400 · unknown blockedBy 422 · empty title 400 · unknown assignee 422; no broadcast | PASS |
| TK-13…16 | todo→completed 409 `Illegal task transition: todo → completed (task SW-126)` · empty PATCH 400 `At least one field is required` · unknown 404 · no-op PATCH `event:null` | PASS |
| TK-17…22 | assignee on todo → auto `assigned`; agent row unchanged (REQ-041); → in_progress sets startedAt; → completed sets completedAt and progress 100; progress on a completed task 409 `Task SW-126 is completed; progress cannot change`; exactly 3 broadcasts | PASS |
| TK-23 | POST with assignee → `assigned`, id ERP-304 | PASS |
| SN-1…4 | snapshot shape (15 agents, tasks, 4 projects, events ≤ eventsLimit, `lastSeq`, demo, serverTime); `project` filters events only; unknown project 422; `eventsLimit=0` 400 | PASS |

### 2.3 Security basics (REQ-160/161, ADR-027, ADR-035)

| ID | Case | Result |
|---|---|---|
| HG-1/2 | HTTP `Host: evil.example:4000` → 403 `Host not allowed: evil.example:4000`; `localhost:4000` allowed | PASS |
| CO-1/2 | preflight from `http://evil.example` gets no ACAO; from `http://localhost:5173` it is allowed | PASS |
| SG-1…4 | socket Origin `http://evil.example` refused (websocket and polling); `http://localhost:5174` refused; `http://localhost:5173` connects | PASS |
| SG-5 | socket foreign Host | script FAIL is a **harness artefact**: Node's XHR polyfill does not send a custom `Host`. Re-tested with curl: polling handshake → **403** `{"code":4,"message":"Host not allowed"}`, websocket upgrade → **400** `Host not allowed`, server log `socket_rejected {reason:"host"}`. **PASS** (see QA-2 for the status/body detail) |
| SOCK-2 | client emits (`office:event`, `agent:status`) ignored; no state change, no broadcast (REQ-051) | PASS |

### 2.4 Demo mode (REQ-110…113)

| ID | Case | Result |
|---|---|---|
| D-1…5 | GET inactive · `intervalMs:1000` 400 · start 2000 → active · second start idempotent (interval ignored) · `demo:state` active broadcast | PASS |
| D-6/7 | 12 `source:"demo"` events in about 11.5 s; user PATCH (Auditor → planning) and user task (AM-403) accepted during the demo | PASS |
| D-8/9 | stop → 200 `{agentsRestored:4, agentsKept:1, tasksKept:1, tasksDeleted:3}`; `demo:state` inactive + `office:resync {reason:"demo-restored"}` | PASS |
| D-10…13 | untouched agents restored exactly (Architect and BE were changed by the demo); user-touched Auditor keeps `planning`; demo tasks SW-D53-1a/b/c removed; user task kept; pre-existing tasks restored | PASS |
| D-14…17 | demo events stay in history · second stop → `restored:null` · no demo events after stop · unknown key 400 | PASS |
| D-crash | REQ-113: hard kill while active → next boot restores the pre-demo state **before** `server_started`; not resumed | PASS |

### 2.5 Restart and process hygiene (REQ-053, REQ-122, CR-7)

| ID | Case | Result |
|---|---|---|
| RS-1 | launcher restart: data persists, identical snapshot, seed not duplicated | PASS |
| RS-2 | second launcher refuses (busy ports) and touches nothing; `db:reset` refuses while the server runs | PASS |
| RS-3 | stopping the launcher frees 4000/5173 with no orphan processes; foreign 5174/5188 untouched | PASS |
| RS-4 | browser resyncs after a server restart without reload (§3, B-16) | PASS |

## 3. Test matrix — browser (Chrome, real UI against the live server)

Viewport: `resize_window` reported success but the window stayed at **1920×889** CSS px (it appears maximized),
so the §32 scenario ran in the 1920 "ultra" layout: metrics, office, docked detail panel, feed and simulator dock
all visible at once (UX §2.4). I checked 1440×790, ~1020 (laptop/tablet) and 390 (mobile) with a same-origin
`<iframe>` of that width inside my tab (media queries follow the iframe width). I created my own tab and closed
it at the end. A pre-existing "AI Virtual Office" tab (`?project=ishkun24`) in the browser group is not mine; I
did not touch it. Its socket shows up as the extra client in the server logs.

| ID | Case | Result |
|---|---|---|
| B-1 | first load: Operational / Connected, clock ticking, metrics 14/3/1/1/1/1/7/1, 15 desks in 8 labeled rooms, feed newest first; 1 canvas; no console errors | PASS |
| B-2 | click the Backend desk (canvas) → panel opens and the desk is highlighted, `?agent=04-backend-engineer`; fields render "—" for nulls | PASS |
| **B-3 §32 run 1 (Simulator)** | Agent "Backend Engineer (Idle)" → Project prefilled Sellway → Task "SW-123 · Lost Goods API (Assigned)" → **Start Work**. All without reload, **282 ms** from request start to DOM change: (a) Working 3→4, Development "3 active"→"4 active"; Active Tasks 7 (N-1) (b) Backend desk shows the green working monitor and "Working" chip (c) panel: Working, Sellway, Lost Goods API, SW-123, started at 01:51:44, running duration ticking 00:00:00→00:00:06 (d) feed: new top row "Backend Engineer [Sellway] Status → Working". Task option relabels "(In progress)" | **PASS** |
| B-4 | Illegal button styling: "Complete" dashed while Idle; "Start Planning" dashed while Working, with title "Not allowed from Working — the server will reject this" | PASS |
| B-5 | click illegal "Start Planning" → inline `Illegal transition: working → planning · Allowed from Working: Set Idle, Set Waiting, Start Review, Complete, Fail, Set Offline`; nothing else changes | PASS |
| B-6 | click current "Start Work" → "No change · Backend Engineer is already Working" | PASS |
| B-7 | Send Event with empty Action → "Action is required.", `aria-invalid=true`, **0** requests to `/api/events` | PASS |
| B-8 | Send Event `run_tests` / "Running API tests" (Enter submits) → "Event sent · run_tests · 01:53:05"; feed row; panel current action / last message update | PASS |
| **B-9 §32 run 2 (POST /api/events)** | Set Idle (UI), then the §12 example via curl from outside the browser → metrics Working 3→4, panel Working / SW-123 / Lost Goods API / `run_command` / "Running backend tests" with ticking duration, desk working, feed top row — **162 ms** from curl start to DOM change | **PASS** |
| B-10 | panel tabs: Activity (real, newest first, "Beginning of activity") · Tasks 1 (SW-123 In progress, High, 0%) · Logs ("Derived from stored events — live log streaming arrives in Phase 2", lines `01:53:24.932  INFO  agent.activity  run_command "Running backend tests" [api]`) · Files and Git ("Sample data — not connected (Phase 1)", non-interactive) | PASS (see QA-1) |
| **B-11 project filter** | select ERP in the top bar → URL `?project=erp&agent=…`. Metrics **3/1/0/0/1/1/2/0** (matches ERP data: PM, ARC, OPS(offline), QA; ERP-301 review + ERP-303 assigned). Office: non-ERP desks dimmed, **Backend dimmed**. Roster: 4 ERP agents first, the other 11 dimmed. Feed "Filtered: ERP · Show all projects", only ERP rows + the project-less warning | **PASS** |
| B-12 | live under the ERP filter: a Sellway event does **not** appear in the feed; an ERP event appears; the open panel's Activity tab (A-10, unfiltered) does show the Sellway event | PASS |
| B-13 | `?project=bogus&agent=99-nobody` → falls back to All Projects (URL cleaned); panel "Agent not found / No agent with ID “99-nobody” exists." + Close | PASS |
| B-14 | reload `?project=sellway` → filter kept; metrics 4/2/0/0/0/0/2/0 (correct for Sellway) | PASS |
| B-15 | feed text safety: `<img src=x onerror=…><b>bold</b>` shows literally; 0 `<img>` and 0 `<b>` in the feed; nothing logged to the console | PASS |
| **B-16 demo toggle** | switch on → DEMO badge, DEMO-tagged rows every ~3 s, office animating; "Hide demo" hides all 20 demo rows and restores them; switch off → badge gone, toast "Demo mode stopped. Demo changes were rolled back. · 1 agents and 0 tasks restored", agents **identical** to pre-demo (API diff) | **PASS** (QA-3 cosmetic) |
| **B-17 socket drop** | stop the API server only → "Backend unavailable" pill, banner "Backend unavailable — showing last known data from 01:56:54. Actions are paused. Retrying automatically every 5 s [Retry]", content greyed, simulator "Simulator is unavailable while the backend is offline.", demo switch disabled, pill "Reconnecting" → **"Disconnected" after 31 s**. Only one banner (priority rule) | **PASS** |
| **B-18 reconnect + resync** | restart the server, and post an event while 0 sockets are connected (a missed change) → UI Operational / Connected about 2 s later with "Reconnected — data refreshed." (3 s banner). The missed change appears (Documentation Engineer → Planning, Planning 1→2) **exactly once** in the feed; greying removed; **no reload** | **PASS** |
| B-19 | backend unavailable at initial load (server stopped, page reloaded) → state card "Can't reach the AI Virtual Office server … (npm run dev) … Retry · Retrying automatically in 5 s"; top bar live ("Backend unavailable", "Connecting…", clock). Server started → dashboard recovers **without reload**, data persisted | PASS |
| B-20 | 1440×790 (iframe): viewport-locked (scrollHeight 790), no horizontal scroll, non-modal 360 px overlay panel, canvas 1032×390 (zoom ≈ 0.72 with simulator open, UX §2.2 table), legend compacts to icons | PASS |
| B-21 | ~1020 (iframe): page-scroll layout, metrics 4×2, panel = modal sheet with scrim (`aria-modal=true`), simulator = bottom sheet, office present, no horizontal scroll | PASS |
| B-22 | 390 (iframe): **no canvas**, no horizontal scroll, top bar, short metric labels (Online / Review / Active / Done), "Agents (15) / Activity" switch, note "Office view is available on screens 768 px and wider.", simulator = full-screen sheet | PASS |
| B-23 | console over the whole session: no errors or exceptions (only Vite connect debug and the React DevTools info) | PASS |

## 4. Acceptance-criteria roll-up

| Area | REQs | Result |
|---|---|---|
| Agent model, state machine, enforcement | 001–004, 010–013 | PASS (live: 2.1, 2.2; full 8×8 / task tables in automated tests) |
| Event pipeline, validation, rejection guarantee | 020–029 | PASS |
| Tasks | 040–042 | PASS |
| Real-time, reconnect, restart | 050–053 | PASS. REQ-050 "two tabs": the socket client and the browser received the same broadcasts. I did not run two browser tabs side by side (§6) |
| Dashboard, metrics, filter | 060–064 | PASS |
| Office | 070–075 | PASS for live visuals, dimming and click; 1 canvas per page. Hover tooltip and reduced motion not exercised live (§6) |
| Detail panel | 080–083 | PASS for open, fields, tabs, live updates and not-found. Esc and focus return not exercised live (§6) |
| Feed | 090–092 | PASS |
| Simulator | 100–104 | PASS |
| Demo | 110–113 | PASS (incl. live crash recovery) |
| Seed | 120–122 | PASS |
| States | 140–144 | PASS for backend-unavailable (start and later), disconnected, inline simulator errors |
| Security basics | 160–164 | PASS (host guard, Origin rule, CORS, content-type, text safety) |
| Tests and scripts | 170–171 | PASS (`verify` green; dev / start scripts run). `npm install` was not re-run (§6) |
| §32 verification list / REQ-190, REQ-191 | 190, 191 | **PASS**: lint, typecheck, tests, backend, frontend, health, agents, POST events, Socket.IO, simulator, §32 BE idle→working (both runs: metrics, visual, panel, feed), project filter, restart |

## 5. Findings

No blockers. No majors. Three minors (not gate-failing):

```
[QA-1] severity: minor
ROOT_CAUSE: frontend — the Logs tab line for `agent.status.changed` does not show the new status.
OWNER: frontend-engineer
AFFECTED_COMPONENTS: apps/web detail panel Logs tab (derived log lines)
INVALIDATED_GATES: none
Evidence: open Backend Engineer → Simulator Start Work, then Set Idle → Logs tab →
  expected a line that says what changed (e.g. "… agent.status.changed  → working  [simulator]")
  actual "01:51:44.413  INFO   agent.status.changed  [simulator]" and "01:53:17.848  INFO   agent.status.changed  [simulator]",
  with no status, so the two lines look the same.
  The UX §7.3 line template (time · level · type · action · "message" · [source]) has no status slot, so this follows the
  spec literally, but the derived log loses the most important fact.
Fix: when `event.status` is non-null, include it, e.g. "→ <status>" after the type (both agent and task.* events).
  Add a render test. A UX copy decision can go to ui-ux-designer if wanted.
```

```
[QA-2] severity: minor
ROOT_CAUSE: contract/backend — a Socket.IO handshake refused by the Host guard does not answer with the documented
  `403 HOST_NOT_ALLOWED` envelope.
OWNER: backend-engineer (or tech-lead to adjust REQUIREMENTS §3.5 / API-C §0 wording)
AFFECTED_COMPONENTS: apps/server/src/realtime/socketServer.ts (allowRequest), API-C §0/§4, REQUIREMENTS §3.5
INVALIDATED_GATES: none
Evidence:
  curl -H "Host: evil.example" "http://127.0.0.1:4000/socket.io/?EIO=4&transport=polling" → 403, body {"code":4,"message":"Host not allowed"} (engine.io format)
  curl -H "Host: evil.example:4000" -H "Upgrade: websocket" … "/socket.io/?EIO=4&transport=websocket" → 400 text/html "Host not allowed"
  The refusal itself works (connection denied, `socket_rejected {reason:"host"}` logged). Only the status/body differ from the
  documented 403 `{error:{code:"HOST_NOT_ALLOWED"}}`, which engine.io's allowRequest callback cannot fully control.
Fix: document that Socket.IO refusals use engine.io's own response (polling 403, websocket upgrade 400), or reject
  foreign-Host upgrades before engine.io (http `upgrade` listener writing a 403). Low priority.
```

```
[QA-3] severity: minor
ROOT_CAUSE: frontend + backend copy — singular/plural agreement in the demo stop summary.
OWNER: frontend-engineer (toast in apps/web/src/copy.ts:78) and backend-engineer (system.info message,
  apps/server/src/services/demoService.ts:209, text fixed by API-C §3.14)
AFFECTED_COMPONENTS: demo stop toast, demo-stopped feed row
INVALIDATED_GATES: none
Evidence: start demo, stop after ~3 s → toast "Demo mode stopped. Demo changes were rolled back. · 1 agents and 0 tasks restored";
  feed "Demo mode stopped: 1 agents and 0 tasks restored, 0 demo tasks removed". Expected "1 agent".
Fix: pluralize ("agent"/"agents", "task"/"tasks"). The server message text is contracted, so change API-C §3.14 together. Cosmetic.
```

Notes (not defects):
- **N-1 (requirements wording):** REQ-191 (a) says "Active Tasks +1 if SW-123 moved to `in_progress`". On the
  binding seed (API-C §7.1) SW-123 is already `assigned`, which is active (A-06). Active Tasks therefore correctly
  stays 7, and the conditional clause does not apply. The product-analyst may want to reword it to avoid confusion
  at audit.
- **N-2:** the mobile view opens the full-screen simulator sheet on load when `vo.simulator.open` was persisted as
  open from a desktop session. This is consistent with UX §9.1 (state persisted), but on a phone it hides the
  monitoring view until closed. Optional backlog item for ui-ux-designer.
- **N-3:** the Vite proxy prints `ECONNREFUSED` / `ECONNRESET` stack lines while the API is down. This is expected
  dev noise.

## 6. Not tested (and why)

- `npm install` / `npm ci`: not re-run, by instruction (existing `node_modules`; review and devops ran it).
- Real browser window sizes: `resize_window` had no effect on the maximized window. 1440 / 1020 / 390 were emulated
  with a same-origin iframe. 1366×768 and 2560×1440 were not checked.
- Two browser tabs side by side (REQ-050): not run as two tabs. Equivalent coverage: the socket.io-client received
  a broadcast deep-equal to the HTTP response while the browser updated live from the same pipeline.
- Canvas hover tooltip, keyboard navigation (Tab, roster Enter, tab arrow keys), `Esc` close and focus return,
  `prefers-reduced-motion`: not exercised live. Covered only by the web unit tests.
- Graceful console Ctrl+C / Ctrl+Break of `npm run dev`: I cannot send console control events from this
  environment. Stops were hard kills (TaskStop, `taskkill /F`). The demo crash path was verified instead (D-crash).
- NFR-002 (30-minute demo, memory growth) and 60 fps: not measured (time-boxed). Demo ran ~25 s per run, 4 runs, no errors.
- `npm start` one-port mode (`--serve-web`): not run in this gate.

Round 1 result: PASS (superseded by Round 2 below).

---

## Round 2 — QA delta after ADR-037, CR-18/19, AUD-3 (2026-10-04)

Trigger: product audit AUD-1. The QA gate was invalidated by the ADR-037 fixes, which landed after round 1:
- SEC-1: Vite `cors:false`.
- SEC-2: HTTP Origin rule on writes.
- SEC-3: compressed bodies rejected.
- SEC-4: reserved task ids and a null-prototype store.
- SEC-5: XFO/CSP framing headers.
- QA-1, QA-3, and the mobile simulator rule.
- CR-18, CR-19, and the AUD-3 launcher ancestor chain.

Scope: everything AUD-1 lists, plus the AUD-5 items where feasible. Inputs: ADR-037, API_CONTRACTS v1.2 (§0 Origin
rule, framing headers, Content-Encoding; §2.2; §3.14), `tasks/reports/VO-000-audit.md` §4, and
`tasks/reports/VO-000-review.md` rounds 3–4.

Environment as in round 1. The dev DB was reset to the seed before and after; one-port mode used a scratchpad DB. I
added no test files and changed no app code. The scratch scripts `live-api.mjs` (round 1) and `live-delta.mjs` (new,
39 checks) are in the session scratchpad.

Concurrency note: another agent edited `scripts/dev.mjs` and `scripts/lib/*` (CR-20) during this round
(03:34–03:36 local). The AUD-3 stop tests below were run on a fresh start of the **final** file
(`sha1 065c26c2…`), and once on the earlier in-memory instance.

### R2.1 Commands (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npm run verify` | **exit 0**. format · lint · typecheck · test · build all PASS. Tests: shared **864**, server **687**, web **1317** (= 2 868, +66 since round 1), 0 skipped |
| 2 | `npm run smoke` (one-port, temp DB, free port) | **27/27 PASS**: `GET /` XFO DENY + CSP `frame-ancestors 'none'`, SPA fallback, JSON 404, socket, §12 event + broadcast, foreign-Origin socket refused, PATCH with Origin `localhost:5174` → 403 `ORIGIN_NOT_ALLOWED`, graceful stop, restart persistence, no reseed, temp dir removed |
| 3 | `npm run db:reset` → `npm run dev` | stack healthy on 127.0.0.1:4000 and through the Vite proxy on :5173 |
| 4 | round-1 regression `live-api.mjs` (fresh seed) | **169/170**. The only FAIL is again SG-5, the harness artefact of round 1 (curl re-check: socket foreign Host → 403) |
| 5 | `live-delta.mjs 4000` (dev) | **38/39**. The FAIL is `GET /` on the API-only dev server → see QA-4 |
| 6 | `live-delta.mjs 4100` (one-port `--serve-web`, temp DB) | **39/39 PASS** |
| 7 | Vite dev checks (curl) | `GET /` with `Origin: http://evil.example` → no `Access-Control-Allow-Origin` (SEC-1); HTML has XFO DENY + CSP `frame-ancestors 'none'`, JS module has XFO DENY (SEC-5); proxied `POST /api/events` with a foreign Origin → 403 `ORIGIN_NOT_ALLOWED` |
| 8 | AUD-3: kill **only** the `npm-cli.js run dev` PID (`taskkill /PID <npm> /F`, current launcher) | `[dev] stopping (parent process exited)… [dev] stopped`; 4000/5173 free after **4 s**; 0 project processes; 5174/5188 untouched |
| 9 | AUD-3 variant: stop the root shell of a background `npm run dev` (earlier in-memory launcher) | same: stopped by itself within 10 s, nothing left |
| 10 | end-of-round cleanup | ports 4000/4100/5173 free, 0 project processes, DB reset to seed, my browser tabs closed, one-port temp DB left in scratchpad only |

### R2.2 Delta matrix — API (live)

| ID | Case | dev :4000 | one-port :4100 |
|---|---|---|---|
| O-1 | `POST /api/events` with Origin `http://evil.example`, `http://localhost:5174`, `null`, `http://127.0.0.1:5174` → 403 `ORIGIN_NOT_ALLOWED` "Origin not allowed", **no broadcast** | PASS | PASS |
| O-2 | foreign Origin on PATCH agent status, POST/PATCH tasks, demo start/stop, DELETE/PUT tasks → 403 | PASS | PASS |
| O-3…6 | allowed: Origin `http://localhost:5173`, `http://127.0.0.1:5173`, no Origin (curl/producer), same-origin `http://<Host>` → 201 | PASS | PASS |
| O-7/8 | GET with foreign Origin unaffected (200, no ACAO); OPTIONS preflight not 403, no ACAO | PASS | PASS |
| O-9 | order: Host guard before Origin rule (foreign Host + foreign Origin → `HOST_NOT_ALLOWED`) | PASS | PASS |
| C-1…4 | `Content-Encoding: gzip` → 400 `INVALID_JSON` "Content-Encoding is not supported", no broadcast; corrupt "gzip" → 400 (never 500); deflate → 400; `identity` accepted | PASS | PASS |
| R-1/2 | task id `__proto__`, `constructor`, `prototype` → 400 `Task id "<id>" is reserved` (POST /api/tasks and `agent.task.assigned`), no broadcast | PASS | PASS |
| R-3/4 | prototype-ish but legal ids `toString`, `hasOwnProperty` accepted (201) | PASS | PASS |
| H-* | XFO DENY + CSP `frame-ancestors 'none'` and (for `/api`) `no-store` + `nosniff` on 200, 404, 400, 403 Origin, 403 Host, 413, malformed JSON (**CR-19**) | PASS | PASS |
| H-GET / | same headers on a non-API path | **FAIL** (QA-4) | PASS (static handler) |
| P-1 | demo stop `system.info` message singular/plural (**QA-3**): "Demo mode stopped: 1 agent and 0 tasks restored, 0 demo tasks removed" | PASS | PASS |

### R2.3 Delta matrix — browser (Chrome)

Viewport limits:
- The Chrome window again reported a 1920-px inner width; `resize_window` had no effect (`outerWidth` = 0, `document.hidden` = true).
- Iframes are now blocked by `frame-ancestors 'none'`, as intended.
- Real viewports were obtained with **top-level popup windows** (`window.open(…, 'popup,width=…')`) opened by a real click. Those windows are background windows, so I used them for layout/DOM checks only, not for canvas input.

| ID | Case | Result |
|---|---|---|
| B2-1 | §32 run 1 through the Vite proxy (browser sends `Origin: http://localhost:5173`): detail panel open; simulator Agent preselected "Backend Engineer (Idle)" and Project Sellway; Task SW-123 → **Start Work** → "Accepted · Backend Engineer → Working · 03:41:54"; Working 3→4, panel Working / Sellway / Lost Goods API / SW-123 / started at / duration ticking, feed top row, all without reload (≤ 699 ms measured from my arm call, which includes tool latency) | **PASS** |
| B2-2 | Send Activity (`run_tests` / "Running API tests r2", Enter) → "Event sent · run_tests · 03:42:17"; panel current action and last message updated | PASS |
| B2-3 | illegal "Start Planning" from Working → inline `Illegal transition: working → planning · Allowed from Working: …` | PASS |
| B2-4 | **QA-1** Logs tab: `03:41:54.328  INFO   agent.status.changed → working  [simulator]` | **PASS (fixed)** |
| B2-5 | **§32 run 2 + two tabs (REQ-050):** two tabs open with the BE panel; §12 example via curl → both tabs show Working 3→4, panel Working / SW-123 / `run_command` / "Running backend tests", feed top row; DOM updated **+129 ms (tab A) and +144 ms (tab B)** after the curl started | **PASS** |
| B2-6 | task writes from the page (`fetch` from :5173, real browser Origin, through the proxy): `POST /api/tasks` → 201 AM-404; `PATCH` → cancelled 200; Active Tasks 9→10→9 live; feed "Task created / updated AM-404". The UI has no task-write controls in Phase 1 (tasks are read-only in the panel) | PASS |
| B2-7 | store with reserved-looking ids after reload/resync (AUD-1 item 3): tasks `toString` (todo) and `hasOwnProperty` (assigned) present → Active Tasks = 9 = 7 seed + ERP-304 + `hasOwnProperty`; no errors | PASS |
| B2-8 | demo start/stop via the UI switch through the proxy: DEMO badge, demo rows, stop toast **"Demo mode stopped. Demo changes were rolled back. · 1 agent and 0 tasks restored"**, feed "Demo mode stopped: 1 agent and 0 tasks restored, 0 demo tasks removed" (**QA-3** client + server) | **PASS (fixed)** |
| B2-9 | **Demo soak 10.5 min** (UI switch 22:48:06 → 22:58:48 UTC, 3 s interval, ~48 events/min, 500 demo events). Tab sampler: heap 88 MB at start → 120–130 MB plateau from minute 1 on (last 123.7 MB); feed rows capped at **200** with the footer "Showing the latest 200 events"; DOM nodes flat at ~3 500; **0** errors / unhandled rejections / console.error; socket Connected throughout. Stop → agents **and** tasks identical to pre-soak (API diff), 67 demo tasks removed | **PASS** (caveat: hidden window, so Phaser rAF was throttled; heap is not representative of a visible canvas) |
| B2-10 | **mobile rule (ADR-037 §8):** 400-px popup with `vo.simulator.open = "true"` stored → simulator **not** open on load; no canvas; no horizontal scroll (385 ≤ 400); short metric labels; still reachable via "More" → "Developer Simulator" (full-screen sheet) | **PASS (fixed)** |
| B2-11 | real **1366×711** viewport (popup): viewport-locked (scrollHeight 711), no horizontal scroll (1366), non-modal 360-px overlay panel, canvas 998×311 | PASS (layout) |
| B2-12 | real **1000×743** viewport (popup): modal detail sheet 440 px (`aria-modal=true`), simulator bottom sheet, no horizontal scroll (985) | PASS (layout) |
| B2-13 | **hover tooltip (REQ-073):** hovering a desk shows "Frontend Engineer · Working · Sellway · edit_file — Memoizing chart selectors in DashboardPage.tsx · Click to open details" | PASS |
| B2-14 | **keyboard (NFR-006):** focused roster card + Enter → swaps the panel to Reviewer, focus stays on the card; Esc → panel closes, `?agent=` cleared; Enter on Architect card → focus moves into the panel heading; Esc → focus returns to the Architect card | PASS |
| B2-15 | one-port `npm start`-equivalent (`--serve-web`, :4100) in the browser: page loads, **Phaser office renders** with the new XFO/CSP headers, socket Connected (Operational), simulator Start Work / Set Idle stored with `source:"simulator"`, demo start/stop accepted (same-origin rule), 0 console errors | **PASS** |
| B2-16 | console over the round: 0 errors in every page I loaded (dev :5173 and one-port :4100) | PASS |
| B2-17 | **canvas click-through:** a click on DOM UI above the office's area selects the desk underneath → **QA-5** | **FAIL** |

### R2.4 Status of earlier findings

| ID | Status | Evidence |
|---|---|---|
| QA-1 | **FIXED** | B2-4 |
| QA-2 | **CLOSED (documented)**, ADR-037 §6 / API-C §0: refusal + `socket_rejected` log is the contract. Re-checked: polling → 403 | — |
| QA-3 | **FIXED** | P-1, B2-8 |
| N-2 (mobile simulator) | **FIXED** (ADR-037 §8) | B2-10 |
| CR-19 (no-store/nosniff on 403s) | **verified** | H-* rows |
| AUD-3 | **verified** with the final launcher | R2.1 #8 |
| AUD-5 | two tabs, tooltip, keyboard, 1366 (layout), ≥10-min soak: done (B2-5, B2-13, B2-14, B2-11, B2-9). Remaining items in R2.6 | — |

### R2.5 New findings

```
[QA-5] severity: major
ROOT_CAUSE: frontend — Phaser processes mouse events whose DOM target is NOT the canvas, so a click on any element
  layered over the office's area also "clicks" the desk underneath. This includes the part of the canvas that is
  scrolled out of view under the metrics row and top bar.
OWNER: frontend-engineer
AFFECTED_COMPONENTS: apps/web/src/office/runtime.ts:38 (game config `input: { keyboard: false, gamepad: false }`,
  `windowEvents` left at its default `true`), apps/web/src/office/objects/AgentDesk.ts:226 (desk opens on
  GAMEOBJECT_POINTER_DOWN); REQ-073 / REQ-080, UX §7.6 closing rules.
INVALIDATED_GATES: none (pre-existing since TASK-007; not introduced by ADR-037. Round 1 missed it because I never
  clicked top-bar controls with the main column scrolled.)
Evidence (Chrome, dev :5173, 1920×945, real clicks, nothing injected):
  1. Scroll the main column down to the agents roster (office canvas top = −149 px, its top rows hidden under
     the metrics row).
  2. Click the "Working" metric card (a non-interactive <dl> item; elementFromPoint confirms it is the card).
     → expected: nothing, or, per UX §7.6, close an open panel.
     → actual: the Product Analyst detail panel opens (?agent=02-product-analyst).
  3. Close the panel, keep the scroll, click the top-bar project selector ("All Projects ▾").
     → expected: only the project listbox opens.
     → actual: the listbox opens AND the Product Analyst panel opens. Below 1760 px the panel covers the live feed
       column. If a panel is already open, it is swapped to the hidden agent.
  Control: with my own plain <div> above the canvas, a click both reached the div and selected the Backend / Database
  desk underneath (a real click and a synthetic event both reproduce it).
  Typical trigger: at 1366–1440 px the roster sits below the office, so scrolling the main column and then using
  the project filter or the top bar is a normal flow.
Fix: set `input: { …, windowEvents: false }` in the Phaser game config, and/or ignore pointer events whose
  `pointer.event.target !== game.canvas` (or require pointerdown and pointerup on the same desk). Add a regression
  test: a pointerdown dispatched on a DOM element positioned over a desk must not call `onSelectAgent`. Then re-check
  that hover, tooltip and desk clicks still work and that pointer-up-outside does not leave a desk "pressed".
```

```
[QA-4] severity: minor
ROOT_CAUSE: backend — the framing headers are not "on every Express response" (API-C §0 v1.2) for Express's
  default 404 (finalhandler) on non-API paths: it overrides CSP with `default-src 'none'` and has no `frame-ancestors`.
OWNER: backend-engineer
AFFECTED_COMPONENTS: apps/server/src/app.ts (non-/api fallthrough)
INVALIDATED_GATES: none
Evidence: dev (API-only) `GET http://127.0.0.1:4000/` → 404, `X-Frame-Options: DENY`, `Content-Security-Policy:
  default-src 'none'`. One-port `POST http://127.0.0.1:4100/` → same. Clickjacking is still prevented by XFO DENY
  and the page is an empty "Cannot GET /" text, so the impact is low.
Fix: add a final catch-all 404 handler after static/SPA that sets the framing headers (and `nosniff`), or re-set CSP
  with `frame-ancestors 'none'` there. Add a test for `GET /` in API-only mode and `POST /` in one-port mode.
```

```
[QA-6] severity: minor
ROOT_CAUSE: infrastructure — on this Windows machine (NTFS "Last Access Time Updates ENABLED", `fsutil behavior query
  DisableLastAccess` = 2) the dev server's `node --watch` restarts when another process merely READS the server
  sources. libuv's Windows watcher also reports last-access changes. NTFS rewrites the access time at most once per
  hour per file, so the restart happens on the first such read.
OWNER: devops-engineer
AFFECTED_COMPONENTS: apps/server `dev` script (`node --watch`), scripts/dev.mjs, docs/DEPLOYMENT.md
INVALIDATED_GATES: none
Evidence: dev-r2.log shows 3 "Restarting 'src/index.ts'" with no source file modified (find -newermt over the repo
  shows only data/office.db-wal/-shm changed):
  - 22:36:28, coincides with another agent's `npm run smoke`;
  - 22:45:02, the moment I started a second tsx server (one-port on :4100, separate DB);
  - 23:01:3x, reproduced with a read-only `npx tsc -p apps/server/tsconfig.json --noEmit` (restart count 2 → 3).
  Side effect seen at 22:45:02: a demo started 18 s earlier was ended by boot recovery (`demo_recovered`, state
  restored). Open pages briefly show "Reconnecting", then resync. No data loss (recovery works as designed), but a
  running demo or an observer's session is silently interrupted whenever tests, typecheck, lint or smoke run next
  to `npm run dev`.
Fix: watch with a content/mtime-based watcher that ignores atime (e.g. `tsx watch`, or `--watch-path` limited to
  `src` plus a content hash), or document the effect and the `fsutil behavior set disablelastaccess 1` workaround in
  DEPLOYMENT.md. RECOMMENDED; backlog is acceptable.
```

### R2.6 Not tested in round 2 (and why)

- **`prefers-reduced-motion`:** no DevTools emulation is available in this toolset, and changing the OS accessibility
  setting is a system-setting change I may not make. Covered by web unit tests only.
- **2560×1440:** the screen is 1920×1032, so a larger window cannot be opened. Not tested.
- **Canvas interaction at 1366/1000/400 px:** the popup windows are background windows with throttled rAF. Phaser
  input did not process even direct events there, so only layout/DOM was checked. QA-5 was reproduced at 1920.
- **Keyboard in a second tab:** the tool's key events reached only the original tab. Keyboard was verified there (B2-14).
- **NFR-002 30 minutes and fps:** a 10.5-min soak was run (B2-9). The full 30 min and frame rate were not measured,
  and the window was hidden during the soak.
- **Graceful console Ctrl+C / Ctrl+Break of `npm run dev`:** still not possible from this environment (round 1 §6).
  The AUD-3 stop paths were verified instead.

### R2.7 Round 2 summary

All ADR-037 changes behave as specified in dev and one-port mode:
- Origin rule on writes.
- Compressed bodies rejected.
- Reserved task ids.
- Framing headers (except QA-4).
- CR-19 headers.
- QA-1 and QA-3 fixed.
- Mobile simulator rule.
- AUD-3 launcher stop.

The UI write paths work through the Vite proxy with the new Origin rule. §32 passes again in two tabs at once, and
one-port mode works in the browser. AUD-5 items were covered where the environment allows.

The gate fails on **QA-5 (major, frontend)**: clicks on top-bar and metrics UI open or swap a hidden agent's detail
panel when the main column is scrolled. The fix is small and local to the Phaser input config. QA-4 and QA-6 are minor.
Re-test scope after the QA-5 fix: B2-17 / QA-5 steps, desk click, hover and tooltip, background-click close,
`npm run verify`.

Round 2 result: FAIL (superseded by Round 3 below).

---

## Round 3 — QA delta after the QA-4 / QA-5 / QA-6 / CR-20 fixes (2026-10-04)

Trigger: PM request after code review round 5 PASS. Fixes under test:
- **QA-5:** `office/runtime.ts` sets `input.windowEvents: false`, and the new `office/inputGuard.ts` lets only events
  that target the canvas select a desk or close the panel.
- **QA-4:** non-`/api` 404s are now JSON with framing headers.
- **QA-6:** the dev server no longer uses `node --watch`. `scripts/dev.mjs` restarts it only when source content
  hashes change (`scripts/lib/sourceWatcher.mjs`).
- **CR-20:** the launcher's kill paths now require process-identity checks.

Environment as in rounds 1–2. Ports 4000/5173 were free at the start. The dev DB was reset before and after; one-port
used a scratchpad DB. I added no test files, changed no app code and made no commits.

### R3.1 Commands (real output)

| # | Command | Result |
|---|---|---|
| 1 | `npm run verify` | **exit 0**. format · lint · typecheck · test · build all PASS. Tests: shared **864**, server **689**, web **1328** (= 2 881), 0 skipped |
| 2 | `npm run smoke` | **27/27 PASS** |
| 3 | `npm run db:reset` → `npm run dev` | healthy on :4000 and through the :5173 proxy; launcher banner `[dev] server http://127.0.0.1:4000 + web http://localhost:5173 — Ctrl+C stops everything` |
| 4 | `live-api.mjs` (round-1 regression, fresh seed) | **169/170**; the only FAIL is the known SG-5 harness artefact |
| 5 | `live-delta.mjs 4000` (dev) | **39/39 PASS**. `H-GET /` now passes (QA-4) |
| 6 | `live-delta.mjs 4100` (one-port `--serve-web`, temp DB) | **39/39 PASS** |
| 7 | QA-6 trigger set, run **while demo mode was active** on the dev server: `npx tsc -p apps/server/tsconfig.json --noEmit`, a full `cat` of every file in `apps/server/src` and `packages/shared/src`, and a second tsx server process (one-port :4100) | **no restart**: one `server_started` in the dev log for the whole session (23:22:57 → 23:30:16 UTC); demo still `active:true` afterwards, no `demo_recovered` |
| 8 | CR-20 stop path: stop `npm run dev` via the tool's background-task stop | ports 4000/5173 free after **1 s**; log `server_stopping {signal:"disconnect"}` → `server_stopped` → `[dev] stopped` (a graceful server stop, not a hard kill); 0 project processes; Sellway 5174/5188 untouched |
| 9 | cleanup | `npm run db:reset` → `Seeded 15 agents, 11 tasks, 44 events.`; one-port server stopped; browser tab closed |

### R3.2 Matrix

| ID | Case | Result |
|---|---|---|
| **QA-5 a** | exact round-2 repro, real clicks, 1920×945: main column scrolled (office canvas top −12 px, top desk row hidden under the metrics row) → click the "Working" metric card → **no panel** (`?agent=` absent); click the project selector → only the listbox opens, **no panel**. A capture listener confirms both clicks reached their own targets ("Working 3", "All Projects") | **PASS (fixed)** |
| **QA-5 b** | control from round 2: plain `<div>` overlay above the Backend desk, real click → the overlay receives the click, **no desk selected** | **PASS (fixed)** |
| QA-5 c | desk click on the canvas → Backend panel opens; desk and roster card highlighted | PASS |
| QA-5 d | hover → desk outline + tooltip "Frontend Engineer · Working · Sellway · edit_file — … · Click to open details" | PASS |
| QA-5 e | panel swap: click the Frontend desk while Backend is open → panel shows Frontend Engineer | PASS |
| QA-5 f | click on empty floor (gap between Management and Development) → panel closes, `?agent=` cleared | PASS |
| QA-5 g | Esc with the panel open (opened from a desk) → closes; focus goes to the agent's roster card | PASS |
| **QA-4** | dev API-only `GET /` and `POST /nope` → 404 JSON `{"error":{"code":"NOT_FOUND","message":"Route not found: GET /"}}` with XFO DENY, CSP `frame-ancestors 'none'`, `no-store`, `nosniff`. One-port `POST /`, `GET /api/nope`, `PUT /x` → same JSON 404 + framing headers; `GET /` still serves the app (200) | **PASS (fixed)** |
| **QA-6** | R3.1 #7; whole-session log check, no spurious restart | **PASS (fixed)**. A real source edit triggering a restart was not exercised (I may not edit app code); review round 5 covers that path |
| **CR-20** | R3.1 #8 | PASS |
| R-§32 run 1 | simulator (BE preselected from the open panel, Sellway, SW-123) → Start Work → "Accepted · Backend Engineer → Working · 04:29:21"; Working 3→4, panel Working / Lost Goods API / SW-123 / started at / duration ticking, feed top row | PASS |
| R-§32 run 2 | Set Idle, then the §12 example via curl → panel Working / SW-123 / `run_command` / "Running backend tests", Working 3→4, feed top row "run_command — Running backend tests" | PASS |
| R-filter | `?project=erp` → metrics 3/1/0/0/1/1/4/0 (Active 4 includes the two ERP tasks created by the QA scripts); feed "Filtered: ERP", only ERP tags; roster lists the 4 ERP agents first | PASS |
| R-demo | UI switch start → DEMO badge + demo rows; stop → toast "Demo mode stopped. Demo changes were rolled back. · 1 agent and 0 tasks restored", badge gone | PASS |
| R-console | 0 console errors in every page loaded this round | PASS |

### R3.3 Observation (not a defect)

- **Stale hit-testing in this hidden browser window.** The Chrome window under test is hidden (`document.hidden` =
  true): requestAnimationFrame ran **0 frames per second** there, so Phaser never steps.
  - **What happened:** right after the detail panel opened or closed (the office canvas re-sizes without a window
    resize), the next one or two canvas clicks sometimes used the previous layout's mapping. A click on the empty gap
    opened Product Analyst, and a click between Frontend and Database opened Backend.
  - **Why it's the environment:** whenever a frame was forced first (taking a screenshot renders one), every click
    mapped correctly. That covered floor-close, Database in the wide layout and Analyst in the narrow layout, and hover
    always matched once rendered.
  - **Conclusion:** consistent with Phaser applying the resize/camera update in its game step, which a visible window
    runs at ~60 fps. I cannot verify the visible-window behavior in this environment, so I did not file it as a
    finding.
  - **Suggestion:** frontend-engineer may want a one-time manual check in a normal visible window: open/close the
    panel, then click a desk immediately.

### R3.4 Not tested in round 3 (and why)

- **Canvas interaction at a smaller width:** the only real smaller viewports available are popup windows, which are
  background windows where Phaser does not process input (round 2, R2.6). Layout at 1366/1000/400 px was verified in
  round 2 and is unaffected by these fixes. 2560 px and `prefers-reduced-motion` remain untestable (round 2, R2.6).
- **QA-6 positive path** (a real content change restarts the server): requires editing app code, which QA may not do;
  covered by review round 5 and `scripts/lib/sourceWatcher.test.mjs` in `verify`.
- **Console Ctrl+C:** still not possible from this environment. The background-task stop exercised the graceful
  IPC-disconnect path instead.

### R3.5 Round 3 summary

QA-5 (major) is fixed and verified with the exact round-2 repro and the overlay control, with no regression in desk
click, hover/tooltip, panel swap, empty-floor close or Esc. QA-4 is fixed in both modes. QA-6 is fixed: no spurious
restart during the whole session, including during the old triggers while demo was running. The CR-20 stop path is
clean and graceful. The regression set (§32 both runs, project filter, demo, `npm run verify`, `npm run smoke`, both
live API scripts) passes. No open blocker or major finding remains; the earlier minors are fixed or documented.

VERDICT: PASS
