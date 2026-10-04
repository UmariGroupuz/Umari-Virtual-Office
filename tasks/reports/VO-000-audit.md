# VO-000 — Product audit (final gate), AI Virtual Office MVP Phase 1

Auditor: product-auditor · Date: 2026-10-04 · Scope: the whole Phase 1 deliverable before the PM reports to the owner.
Compared: `docs/ORIGINAL_REQUEST.md` §1–§34 → `docs/REQUIREMENTS.md` v1.2.1 → code (`packages/shared`, `apps/server`,
`apps/web`, `scripts`) → tests → `tasks/ACTIVE.md` / `tasks/BACKLOG.md`, plus PM_BRIEF, DECISIONS (ADR-001…037), UX,
API_CONTRACTS v1.2.2, INTEGRATIONS, SECURITY, DEPLOYMENT, README, ROADMAP, ARCHITECTURE, EVENT_SYSTEM,
AGENT_STATE_MACHINE, IMPLEMENTATION_PLAN and the gate reports (review, QA, security, TASK-010 documentation).
No application code was changed. Nothing was committed.

## 1. Evidence I produced myself

| # | Command / check | Result |
|---|---|---|
| E-1 | `npm run verify` | **exit 0**. PASS format:check 2.4 s · lint 11.3 s · typecheck 6.0 s · test 14.0 s · build 7.9 s |
| E-2 | tests inside verify | shared 16 files / **864** · server 32 / **687** · web 22 / **1317** = **2 868 passed**, 0 failed, 0 skipped |
| E-3 | `npm run smoke` | **27/27 PASS**, exit 0. Temp DB. Covers one-port boot, health, 15 agents, index.html + XFO/CSP, SPA fallback, JSON 404, socket, §12 event 201 + broadcast, foreign-Origin socket refused and PATCH 403, graceful IPC stop, restart persistence, no reseed |
| E-4 | `npm run db:reset` (before and after the live run, server stopped) | `Seeded 15 agents, 11 tasks, 44 events.` The dev DB is left at the fresh seed |
| E-5 | `npm run dev` → `/api/health` direct (:4000) and through the Vite proxy (:5173) | both 200 `{data:{status:"ok",db:"ok",…}}` |
| E-6 | `GET /api/agents` | 15 agents. **All 20 §2 fields present on every agent** (scripted check: missing = []). ids, rooms and desks match §7 |
| E-7 | `GET /api/projects`, `/agents/:id`, `/events`, `/tasks`, `/snapshot`, `/demo` | 200 each; projects = Sellway, Ishkun24, ERP, Ana Market (A-01: "All Projects" is the virtual selector option) |
| E-8 | `POST /api/events` with the exact §12 payload (curl, outside the browser) | 201 in 3 ms, `project:"sellway"`, `source:"api"`, seq 48; UI updated live (B-4) |
| E-9 | Restart: snapshot saved → stack stopped → `node scripts/dev.mjs` again | agents, tasks and `lastSeq` (68) **identical**; no reseed; the open browser went Backend unavailable → Operational/Connected **without reload** |
| E-10 | Git | `master` has no commits; no remotes; nothing pushed; nothing deployed |
| E-11 | Cleanup | browser tabs I created are closed; ports 4000/5173 free; owner's Sellway listeners on 5174/5188 untouched (PIDs 17636/15680 unchanged) |

### 1.1 Browser run (Chrome, my own tab, 1568×772 CSS viewport, real UI against the live dev stack)

| ID | Check | Result |
|---|---|---|
| B-1 | First load | Operational / Connected, clock ticking, 14/15 online, metrics 14/3/1/1/1/1/7/1, Phaser office with 8 labelled rooms and 15 desks (status chips with icon + text), feed newest first, 1 canvas, no console errors |
| B-2 | Click Backend desk on the canvas | panel opens, desk highlighted, `?agent=04-backend-engineer`; null fields render `—` |
| **B-3** | **§32 run 1** — simulator Agent "Backend Engineer (Idle)" → Project auto-filled Sellway → Task "SW-123 · Lost Goods API (Assigned)" → real click **Start Work** | **PASS** without reload: (a) Working 3→4, Development "3 active"→"4 active", Active Tasks 7 (unchanged, A-06 / REQ-191 v1.2.1), Completed 1; (b) Backend desk shows the green working monitor and "Working" chip; (c) panel: Working, Sellway, Lost Goods API, SW-123, started 02:57:42, running duration ticking; (d) feed: new top row "Backend Engineer · Sellway · Status → Working" |
| B-3a | Send Activity `run_tests` / "Running API tests" (typed + real clicks) | feed row, panel current action `run_tests`, last message updated live |
| **B-4** | **§32 run 2** — Set Idle (UI, feedback "Accepted · Backend Engineer → Idle"), then the §12 example via curl | **PASS**: Working back to 4, panel Working / SW-123 / `run_command` / "Running backend tests", desk working, feed top row |
| B-5 | Tabs | Activity (real events, newest first, "Beginning of activity"), Tasks 1 (SW-123 In progress / High / 0%), Logs (label "Derived from stored events — live log streaming arrives in Phase 2"; lines now include `→ <status>`, QA-1 fix visible), **Files and Git: "Sample data — not connected (Phase 1)" label, 0 interactive elements** |
| **B-6** | **Project filter** ERP (real clicks on the top-bar selector) | **PASS**: URL `?project=erp`, metrics 3/1/0/0/1/1/2/0, non-ERP desks dimmed incl. Backend, feed "Filtered: ERP · Show all projects" with only ERP rows + the project-less warning. Live: a Sellway event did **not** appear, an ERP event did. "Show all projects" clears the filter. Reload with `?project=sellway` keeps the filter (4/2/0/0/0/0/2/0) |
| B-7 | Text safety | message `AUDIT-ERP-PROBE <b>x</b>` shown literally; 0 `<b>` elements in the DOM |
| B-8 | Demo toggle (real clicks) | DEMO badge, DEMO-tagged rows every ~3 s through the server; switch off → badge gone, feed "Demo mode stopped: 5 agents and 0 tasks restored, 4 demo tasks removed"; API afterwards: all 15 agents and 11 tasks back to the pre-demo state, demo tasks removed, user-changed Backend kept |
| B-9 | Feed controls | "Hide demo" hides every DEMO row and restores them; severity filter "Errors only" shows only the ERP-302 failure; back to "All events" |
| B-10 | Roster card click | opens QA Engineer panel, `?agent=09-qa-engineer` |
| B-11 | `Esc` | closes the panel and clears `?agent=` |
| B-12 | Illegal action | QA (Failed) → "Complete" is dashed with title "Not allowed from Failed — the server will reject this"; click → inline "Illegal transition: failed → completed · Allowed from Failed: …"; server logs `event_rejected` + `request_failed 409` |
| B-13 | Backend down / back | stopping the stack → "Backend unavailable" pill, red banner with last-known time, Retry, greyed content, "Simulator is unavailable while the backend is offline.", demo switch disabled, Reconnecting; restart → recovers to Operational/Connected without reload (E-9) |
| B-14 | Console | no errors or exceptions during the session (checked before and after reload) |

Not exercised by me: canvas hover tooltip, keyboard Tab/Enter navigation, `prefers-reduced-motion`, real 1366/1440/1920/2560
and tablet/mobile widths (the same-origin iframe method QA used no longer works: SEC-5 `frame-ancestors 'none'` now
blocks it — `contentDocument` is null), two tabs side by side, `npm start` one-port mode in a browser (smoke covers it
headless), a 30-minute demo (NFR-002), `npm install`/`npm ci` (not re-run; devops ran `npm ci` in TASK-001/009).

## 2. Traceability (request → REQ → code → test → verified)

Legend: **V-live** = verified by me in the running app/API; **V-test** = covered by passing automated tests I re-ran;
**V-doc** = verified by reading code/docs.

| § | Requirement | REQ | Implementing code | Tests | Status |
|---|---|---|---|---|---|
| 1, 34 | Monitoring-only foundation, producer-agnostic | REQ-130, 160 | `services/eventService.ts`, `realtime/socketServer.ts`; no exec/fs APIs | `securityHardening.test.ts`, events tests | V-doc, V-test (security gate also probed) |
| 2 | 15 agents, all fields | REQ-001–004, §3.1 | `shared/reference/agents.ts`, `seed/seedData.ts`, `routes/agents.ts` | `reference.test.ts`, `api/agents.test.ts`, `seed.test.ts` | **V-live** (E-6) |
| 3 | 8 statuses, state machine, legal/illegal documented | REQ-010–013 | `shared/state/agentStateMachine.ts`, `taskStateMachine.ts`, `statusMapping.ts`; `docs/AGENT_STATE_MACHINE.md` (43 legal / 13 illegal, all 9 owner examples legal) | full 8×8 + task tables in `*StateMachine.test.ts` | V-test, **V-live** (B-12) |
| 4 | Stack: React/TS/Vite/Tailwind/Zustand/Phaser 3; Node/Express/Socket.IO; SQLite; Vitest/Supertest; ESLint/Prettier | NFR-009/010 | manifests; Prisma replaced by `node:sqlite` repo layer (ADR-003, allowed by §4 "if friction") | verify | V-doc, E-1 |
| 5 | Monorepo structure | NFR-009 | `apps/web`, `apps/server`, `packages/shared` (`packages/types` merged, ADR-001) | lint boundaries | V-doc |
| 6 | Top bar: name, system status, project filter, time, connected count | REQ-060 | `layout/TopBar.tsx`, `StatusPills.tsx` | `TopBar.test.tsx` | **V-live** (B-1) |
| 6 | Project selector, 5 options, filtering | REQ-061, 062 | `layout/ProjectSelector.tsx`, `shared/filters/projectFilters.ts`, `store/selectors.ts` | `projectFilters.test.ts`, `selectors.test.ts`, API filter tests | **V-live** (B-6) |
| 6 | 8 top metrics | REQ-063 | `dashboard/MetricsRow.tsx` | `selectors.test.ts`, `OfficePage.test.tsx` | **V-live** |
| 7 | Phaser office, 8 areas, desk per agent, label, indicator, click target | REQ-070, 073–075 | `office/OfficeScene.ts`, `objects/AgentDesk.ts`, `officeLayout.ts`, `gameManager.ts` | `officeLayout.test.ts`, `gameManager.test.ts`, `OfficeCanvas.test.tsx` | **V-live** (B-1, B-2); hover tooltip not live-tested |
| 8 | Status visuals per status | REQ-071, 072 | `office/visuals.ts`, `AgentDesk.ts` | `visuals.test.ts` (every status × modifiers) | **V-live** for idle/planning/working/waiting/reviewing/completed/failed/offline as rendered on seed + transitions; reduced motion V-test only |
| 9 | Detail panel fields + tabs; Activity/Tasks real; Files/Git/Logs may be mock | REQ-080–083 | `agents/AgentDetailPanel.tsx`, `tabs/*`, `mocks/sampleWorkspace.ts` | `AgentDetailPanel.test.tsx` | **V-live** (B-3, B-5, B-11). Files/Git labelled sample, non-interactive; Logs derived from real events and labelled |
| 10 | Live feed: time, agent, action, project, message, severity; via Socket.IO through backend | REQ-090–092, 050 | `activity/ActivityFeed.tsx`, `FeedRow.tsx`, `socket/*` | `ActivityFeed*.test.tsx`, `socket.test.ts` | **V-live** (B-3, B-6, B-7, B-9) |
| 11 | 13 core event types | REQ-020, 021 | `shared/constants/eventTypes.ts` (13 producer + 2 server-only `task.*`) | `event.test.ts`, `eventEffects.test.ts` | V-test, V-doc |
| 12 | POST /api/events: validate, store, agent state, task state, broadcast, return | REQ-022, 029 | `eventService.ts` (`commitAndBroadcast`), `routes/events.ts` | `api/events.test.ts`, `socket.test.ts` (REQ-029 `expectNoTrace`) | **V-live** (E-8, B-4), smoke E-3 |
| 13 | 10 endpoints + validation | REQ-002, 004, 024–028, 040–041 | `api/routes/*` (+ snapshot, demo) | `api/*.test.ts` | **V-live** GETs (E-7), POST events, PATCH status (simulator); POST/PATCH tasks V-test + QA live |
| 14 | Task model, 9 statuses, 4 priorities | REQ-040–042 | `shared/constants/statuses.ts`, `schemas/task.ts`, `services/taskService.ts` | `taskRules.test.ts`, `api/tasks.test.ts` | V-test; fields seen live in snapshot |
| 15 | Simulator: Agent/Project/Task/Status, 8 actions, Send Activity, via API | REQ-100–104 | `simulator/SimulatorDock.tsx`, `simulatorLogic.ts` (PATCH status / POST events) | `SimulatorDock.test.tsx`, `simulatorLogic.test.ts` | **V-live** (B-3, B-3a, B-4, B-12) |
| 16 | Demo mode, story beats, easy off, no overwrite of user state | REQ-110–113 | `services/demoService.ts`, `demoScript.ts` (PM assigns, Architect plans, Backend/Frontend work, QA waits/reviews, Reviewer reviews, Auditor audits) | `demo.test.ts`, `demoReferences.test.ts`, `demoScript.test.ts`, `boot.test.ts` | **V-live** (B-8); crash recovery V-test + QA live |
| 17 | Seed: 15 agents, projects, 11 example tasks, history | REQ-120–122 | `seed/seedData.ts`, `seed.ts`, `reset.ts` | `seed.test.ts`, `seedReplay.test.ts`, `reset.test.ts` | **V-live** (E-4: 15/11/44; ids SW-123…AM-402 as §17) |
| 18, 19 | Producer-agnostic pipeline; future Claude format designed, not built | REQ-130–132 | `shared/adapters/claudeCode.ts` (pure, not wired), `constants/actions.ts` | `claudeCode.test.ts`, `adapters/index.test.ts` | V-doc. **Marked UNVERIFIED (format) / MOCKED (adapter)** in INTEGRATIONS.md, README and the source header — not presented as working |
| 20, 21 | Responsive, premium dark design | NFR-005, 012 | Tailwind tokens, `useViewport`, layout modes | `palette.test.ts`, `OfficePage.test.tsx` | 1568 px V-live; other widths by QA (pre-SEC-5) |
| 22 | Loading/empty/error/disconnected/backend-unavailable | REQ-140–144 | `layout/SystemBanners.tsx`, `components/Feedback.tsx`, `api/client.ts` (10 s timeout) | web tests | **V-live** backend-unavailable + recovery (B-13) |
| 23 | Connected / Reconnecting / Disconnected, auto-reconnect, no duplicate listeners | REQ-052, 053 | `socket/connection.ts`, `sync.ts`, `lib/runtime.ts` | `connection.test.ts`, `sync.test.ts` | **V-live** Reconnecting → Connected (B-13); 30 s → Disconnected by QA |
| 24 | Structured logs | REQ-150, 151 | `logger.ts` | `logger.test.ts` | **V-live** (JSON lines: server_started, socket_connected/disconnected, event_rejected, request_failed, demo_stopped) |
| 25 | Validation (Zod), reject unknown agents / invalid statuses / malformed payloads | REQ-023 | `shared/schemas/*` | `event.test.ts`, `bodies.test.ts`, `api/*` | V-test; 409/400 seen live |
| 26 | Security basics | REQ-160–164, NFR-004 | host guard, origin guard, requireJson (100 KB, `inflate:false`), framing headers | `securityHardening.test.ts`, `socketOrigin.test.ts` | V-test, smoke E-3, security gate round 2; spot-checked in code (§4) |
| 27 | Meaningful tests, actually run | REQ-170, 171 | 70 test files | 2 868 tests | **E-1/E-2** |
| 28 | README + 4 docs | REQ-180, 181 | README.md, ARCHITECTURE, EVENT_SYSTEM, AGENT_STATE_MACHINE, ROADMAP (+ IMPLEMENTATION_PLAN, DEPLOYMENT, SECURITY, INTEGRATIONS) | — | V-doc: README has requirements, install, dev, frontend, backend, both, URLs, simulator, events (bash + PowerShell §12 examples), demo, seed/reset, scripts, limitations |
| 29 | ROADMAP Phases 1–10 | REQ-181 | `docs/ROADMAP.md` | — | V-doc: 10 phase headings match §29 verbatim |
| 30 | Inspection + IMPLEMENTATION_PLAN contents | REQ-181 | `docs/IMPLEMENTATION_PLAN.md` §0–§9 (inspection, architecture, folders, deps, DB model, Socket.IO, Phaser, phases, risks) | — | V-doc |
| 31 | Implementation order | — | IMPLEMENTATION_PLAN §7 | — | V-doc |
| 32 | Verification list incl. BE idle → working, filter, restart | REQ-190, 191 | — | smoke, QA, this audit | **V-live**: lint, typecheck, tests, backend, frontend, health, agents, POST events, Socket.IO live update, simulator, §32 scenario (both runs), project filter, restart. `npm install` not re-run by me |
| 33 | Final report format, NO/NO/NO | REQ-192 | PM deliverable | — | **Pending** (PM). Facts for it: committed NO, pushed NO, deployed NO (E-10) |

## 3. Areas checked without a finding

- **Fake completion**: none found. Files/Git tabs are permanently labelled "Sample data — not connected (Phase 1)" and have
  no controls. Logs are real stored events, labelled. The Claude Code adapter is UNVERIFIED/MOCKED everywhere and wired to
  nothing (grep of `apps/**/src`: no import). Demo events are tagged DEMO.
- **Dead controls**: every control I clicked did something real — project selector, "Show all projects", Demo switch,
  Simulator toggle, panel close/Esc, panel tabs, simulator 8 status buttons (legal ones change state; illegal ones are
  marked and show the server's 409), Send Event, severity filter, Hide demo, roster cards, desks, Retry banner (present,
  auto-retry observed).
- **Gate findings spot-checked in code**: CR-1 (`socketServer.ts` `allowRequest` → `isAllowedOrigin`), CR-2 (`index.ts`
  `startReady:false` → listen → seed → recoverOnBoot → markReady), CR-18 (`smoke-live.mjs` port preflight + launcher
  exit check), CR-19 (`app.ts:174-175`, `errorHandler.ts:75-76`, tests `basics.test.ts:71+`), SEC-1 (`vite.config.ts`
  `cors:false` ×2), SEC-2 (`originGuard.ts`, live 403 in smoke), SEC-3 (`inflate:false`), SEC-4 (`RESERVED_TASK_IDS`),
  SEC-5 (XFO + frame-ancestors in `app.ts` and Vite), DOC-1…6 (API_CONTRACTS v1.2.2 header, IMPLEMENTATION_PLAN rows).
  All present. All four gate reports end with `VERDICT: PASS`. Deferred minors CR-12/13/14/16/17 and the ADR-036
  follow-up are in BACKLOG (BL-017…022).
- **Documented deviations accepted**: A-01 (4 stored projects + virtual All Projects), ADR-001 (types merged into shared),
  ADR-003 (`node:sqlite` instead of Prisma), ADR-021 `{data}` envelope, REQ-191 v1.2.1 Active Tasks wording.

## 4. Findings

```
[AUD-1] severity: critical
ROOT_CAUSE: infrastructure (process) — gate integrity: the QA gate was invalidated and not re-run.
OWNER: qa-engineer (PM schedules it)
AFFECTED_COMPONENTS: tasks/reports/VO-000-qa.md; ADR-037 changes in apps/server/src/api/middleware/{originGuard,requireJson,errorHandler}.ts,
  apps/server/src/app.ts, apps/web/src/store/reducer.ts, apps/web/src/agents/logLine.ts, apps/web/src/lib/runtime.ts,
  apps/web/src/copy.ts, apps/server/src/services/demoService.ts, apps/web/vite.config.ts
INVALIDATED_GATES: qa-engineer (explicitly named by SEC-2: "review + QA re-check of the new middleware only")
Evidence: VO-000-qa.md was written at 02:03 and has a single round ("after code review round 2"). The ADR-037 fixes
  landed 02:19–02:21 (file mtimes) and change the UI write path (Origin rule on every POST/PATCH the simulator and demo
  switch send), the web store's record construction, the Logs line format, the mobile simulator start rule and the demo
  summary text. Code review round 3 and security round 2 (both 02:34) re-checked them; QA did not. SEC-2's own
  INVALIDATED_GATES line names QA. Per the auditor rules a gate that passed before a later fix touched its domain does
  not count. My own live run (§1.1) found no defect in the changed paths (simulator PATCH/POST through the proxy with
  Origin 5173 work, Logs "→ status", demo stop text plural, store hydrate after reload), so the re-run is expected to
  be short — but it is the QA gate's job, not the auditor's.
Fix: qa-engineer runs a delta round on the ADR-037 + CR-19 changes and appends "Round 2" with its own VERDICT line:
  (1) browser: simulator status + Send Event, demo start/stop, task create via UI paths through :5173 (Origin rule);
  (2) one-port `npm run build && npm start` in a real browser (new XFO/CSP headers must not break Phaser or the socket);
  (3) store with ids `toString`/legacy rows after resync; (4) mobile < 768 px: simulator never auto-opens (ADR-037 §8);
  (5) singular demo summary ("1 agent"); (6) Origin/Host 403s carry no-store/nosniff (CR-19).
  Note: the same-origin iframe width emulation used in round 1 no longer works (SEC-5 frame-ancestors 'none'); use real
  window sizes or DevTools device emulation. Then the PM re-runs this audit (delta only).
```

```
[AUD-2] severity: minor
ROOT_CAUSE: infrastructure (process) — the CR-19 fix landed after the last review and security rounds.
OWNER: code-reviewer
AFFECTED_COMPONENTS: apps/server/src/app.ts, apps/server/src/api/middleware/errorHandler.ts, apps/server/test/api/basics.test.ts
INVALIDATED_GATES: none declared (CR-19: "INVALIDATED_GATES: none")
Evidence: app.ts / errorHandler.ts mtime 02:36; VO-000-review.md round 3 and VO-000-security.md round 2 at 02:34. The
  review report still lists CR-19 as an open new minor; there is no status line saying it is fixed. I verified the code
  (app-level /api headers + error-envelope headers) and that the CR-19 test cases pass in E-2.
Fix: code-reviewer appends a one-line R3 addendum confirming CR-19 FIXED (and CR-18, which is also fixed in
  smoke-live.mjs:401-430), so the review report reflects the final code.
```

```
[AUD-3] severity: minor
ROOT_CAUSE: infrastructure — `npm run dev` leaves the whole dev stack running when only the root of the npm process
  tree is killed (the way an IDE/agent tool stops a background command).
OWNER: devops-engineer
AFFECTED_COMPONENTS: scripts/dev.mjs (ancestor watch), docs/DEPLOYMENT.md, README "Start both"
INVALIDATED_GATES: none
Evidence: I started `npm run dev` as a background shell and stopped that shell. 13 s later ports 4000/5173 were still
  held: chain npm-cli.js (36608, parent shell gone) → cmd /c (33648) → dev.mjs (40140) → node --watch (39664) → server
  (37740) and vite (35268) + reaper (36640). The launcher only watches its direct parent (cmd), which stays alive under
  the orphaned npm. The same stop applied to `node scripts/dev.mjs` started directly freed both ports within 6 s.
  I cleaned up with `taskkill /PID 36608 /T /F` (my own processes only). Console Ctrl+C in a real terminal is not
  affected (CR-7 scope), and a second `npm run dev` refuses to start (preflight), so no data risk (CR-2 fixed).
Fix: either watch the full ancestor chain up to the first non-npm/cmd process (exit when any ancestor dies), or
  document in README/DEPLOYMENT that tools should run `node scripts/dev.mjs` (or stop with `taskkill /T` on the npm
  PID). Add to BL-022 if deferred.
```

```
[AUD-4] severity: minor
ROOT_CAUSE: documentation (tracking) — task files do not reflect the real state.
OWNER: pm
AFFECTED_COMPONENTS: tasks/ACTIVE.md, tasks/BACKLOG.md, tasks/ (COMPLETED.md, BLOCKED.md, FAIL_LOG.md absent)
INVALIDATED_GATES: none
Evidence: TASK-001…010 are all still `Status: REVIEW` although review/QA/security/doc gates passed; the VO-000 status
  log stops at "TASK-002 started" (no entries for the gates, ADR-035/036/037 rounds, SEC/QA/DOC fixes); there is no
  COMPLETED.md/BLOCKED.md (CLAUDE.md §7) and no FAIL_LOG.md, so FAIL-log integrity cannot be audited — the
  review/QA/security reports' round history is the only record. CR-18/CR-19 closure is not recorded anywhere in tasks/.
Fix: after AUD-1, move TASK-001…010 to DONE with the gate references, update the VO-000 log, record the round history
  (CR-1…19, QA-1…3, SEC-1…6, DOC-1…6 → fixed/deferred with ADR/BL ids) in ACTIVE.md or a COMPLETED.md.
```

```
[AUD-5] severity: minor
ROOT_CAUSE: requirements verification gap — NFRs and a few REQ details have no live evidence.
OWNER: qa-engineer
AFFECTED_COMPONENTS: NFR-002 (30-min demo memory, fps), NFR-005 (1366×768, 2560×1440 real windows), REQ-073 hover
  tooltip, NFR-006 keyboard/focus/reduced motion, REQ-050 two tabs
INVALIDATED_GATES: none
Evidence: VO-000-qa.md §6 lists them as not tested; I could not test them either (§1.1). They are covered only by unit
  tests (visuals, reducer caps, focus logic) — reasonable, but unverified in a browser.
Fix: fold a short pass into the AUD-1 delta round where feasible (two tabs, tooltip, keyboard Esc/Tab/Enter, one
  non-1920 real width, ≥10 min demo with heap snapshot before/after); otherwise record the remaining items as known
  untested in the §33 report "KNOWN ISSUES".
```

## 5. Undocumented / under-documented limitations (for the §33 "KNOWN ISSUES")

1. Stopping `npm run dev` by killing only the npm root process (not Ctrl+C) leaves the server and Vite running (AUD-3).
   DEPLOYMENT.md covers the symptom ("port in use") but not the cause.
2. After an agent goes `idle`, its task keeps its last status (e.g. SW-123 stays `in_progress` with an idle assignee). This
   follows REQ-042 ("idle/offline → unchanged") but the UI never explains it; the simulator shows "(In progress)".
3. Demo Mode assigns demo tasks even to agents the user changed before the demo (seen: SW-D50-1b assigned to Backend
   while it worked on SW-123). They are removed on stop, but during the demo the Tasks tab shows them.
4. The dashboard cannot be embedded in any iframe, including same-origin (SEC-5 by design). Worth one line in README,
   since it also affects testing tools.
5. Simulator success/failure feedback sits at the bottom of the 200 px dock; at a 772 px-high viewport it can be below
   the dock's visible area (I read "Accepted · Backend Engineer → Idle" from the DOM). Cosmetic, UX §9 placement.
6. Event history grows without limit and there is no rate limiting (documented: BL-001/BL-007, SECURITY §6).

## 6. Summary

The product is real and complete for Phase 1 against the owner's request: every §2–§29 item is implemented and traced,
the §32 key scenario passes in a real browser through both the simulator and `POST /api/events`, the project filter and
restart work, `verify` (2 868 tests) and `smoke` (27/27) are green on my own runs, mock content is honestly labelled, and
nothing was committed, pushed or deployed. I found no missing requirement, no fake completion and no dead control.

The gate fails on process integrity only: **AUD-1** — the QA gate was explicitly invalidated by SEC-2 and the ADR-037
fixes, and was never re-run. AUD-2…AUD-5 are minor and can go to ACTIVE (AUD-2, AUD-4) or BACKLOG (AUD-3, AUD-5).
After the QA delta round passes, a delta audit (AUD-1/AUD-2 only) is sufficient.

Round 1 result: FAIL (superseded by Round 2 below).

---

## Round 2 — delta audit after AUD-1…AUD-5 (2026-10-04)

Scope: gate integrity after the round-1 findings, the fixes made since (ADR-036 addenda 1–3, CR-20, QA-4, QA-5, QA-6,
CR-14), tracking, docs, and anything still blocking completion. Inputs: `VO-000-qa.md` rounds 2–3, `VO-000-review.md`
rounds 4–5, `tasks/ACTIVE.md`, `BACKLOG.md`, `BLOCKED.md`, `COMPLETED.md`, README limitations, DECISIONS ADR-036
addenda, DEPLOYMENT, SECURITY. No application code changed by me; nothing committed.

### R2.1 Evidence I produced

| # | Check | Result |
|---|---|---|
| 1 | `npm run verify` | **exit 0**. PASS format:check 2.3 s · lint 10.5 s · typecheck 5.6 s · test 20.1 s · build 7.5 s. Tests: shared **864**, server **689**, web **1328**, scripts (`node --test`) **15** = **2 896 passed**, 0 failed |
| 2 | `npm run smoke` | **27/27 PASS**, exit 0 |
| 3 | Gate timeline (file mtimes) | review r5 04:21 → QA r3 04:31; **no file other than `tasks/BACKLOG.md` changed after either report** (find over the repo, excluding node_modules/dist/DB). Both final gates therefore cover the final code |
| 4 | **AUD-3 exact repro**: `npm run dev` started as a background shell, then the shell stopped with the agent tool | ports 4000/5173 free after **1 s**; log `[dev] stopping (parent process exited)… server_stopping {signal:"disconnect"} → server_stopped → [dev] stopped` (graceful); **0** project node processes left; Sellway 5174/5188 untouched |
| 5 | **QA-5 repro** (Chrome, real clicks, 1920×945): main column scrolled so the canvas top (0 px) sits under the metrics row → click the "Working" metric card | **no panel**, URL unchanged; project selector opens only its listbox; a click on a visible desk still opens Backend (`?agent=04-backend-engineer`) |
| 6 | §32 run 2 regression: §12 example via curl with the Backend panel open | 201; panel Working / Sellway / Lost Goods API / SW-123 / `run_command` / ticking duration, Working 3→4, feed top row, desk working — without reload |
| 7 | Code spot-checks | QA-5: `office/runtime.ts` `input.windowEvents:false` + `office/inputGuard.ts` (`isPrimaryCanvasPress`). CR-20: every `killTree`/`.kill` in `scripts/dev.mjs` guarded by `isRunningChild` or `isSameProcess(pid, creationTime)`; the port-lookup kill is gone. QA-4: `app.use(apiNotFound)` after router/static in `app.ts`. All present |
| 8 | Cleanup | browser tab closed; dev stack stopped; `npm run db:reset` → seed (15/11/44); ports 4000/5173 free |

My Chrome window was hidden as well (`document.visibilityState = "hidden"`, 0 rAF frames/s), so I could not confirm or
rule out BL-025 in a visible window either.

### R2.2 Status of round-1 findings

| ID | Sev | Status | Evidence |
|---|---|---|---|
| AUD-1 | critical | **CLOSED** | QA re-ran: round 2 **FAIL** (QA-5 major, QA-4/QA-6 minor) → fixes → code review round 5 PASS → QA round 3 **PASS** (04:31), covering every ADR-037 item listed in AUD-1 (Origin rule via proxy, store ids, Logs, mobile rule, demo plural, CR-19 headers, one-port mode in a browser). Re-run order is correct (fix → review → QA) and no code changed afterwards (R2.1 #3) |
| AUD-2 | minor | **CLOSED** | Review round 4 confirms CR-18 and CR-19 FIXED; it also found **CR-20 (major)**, fixed and re-verified in round 5 (PASS). New minors CR-21/CR-22 → BL-023/BL-024 |
| AUD-3 | minor | **FIXED, verified** | R2.1 #4 (exact repro now stops gracefully in 1 s). Also QA r2 #8/#9, review r5, ADR-036 addenda 1–3. QA-6 replaced `node --watch` with a content-hash watcher, so the old "dev stop skips graceful shutdown" limitation is gone |
| AUD-4 | minor | **PARTLY FIXED** | `BLOCKED.md` (none) and `COMPLETED.md` (empty, pending) exist; VO-000 has a gate log; tasks moved to `QA`. Remaining: the gate log stops at "audit r1 FAIL … next: QA delta" — QA r2 FAIL / r3 PASS and review r4 FAIL / r5 PASS (CR-20) are not logged; tasks still not DONE (PM: after this PASS). → AUD-6 |
| AUD-5 | minor | **CLOSED (with documented residue)** | QA r2/r3: real 1366 and ~1000 px windows (layout), hover tooltip, keyboard Enter/Esc/focus return, two tabs live (+129/+144 ms), 10.5-min demo soak (feed cap 200, heap plateau, 0 errors). Not testable here: 2560 px, `prefers-reduced-motion`, 30-min soak, console Ctrl+C (devops verified via GenerateConsoleCtrlEvent). Must be listed as untested in the §33 report |

Round-1 undocumented limitations (§5 items 2–5) are now in README "Known limitations"; item 1 is fixed (AUD-3).

### R2.3 Gate integrity (final state)

| Gate | Last round | Verdict | Covers final code? |
|---|---|---|---|
| code-reviewer | round 5 (04:21) | PASS | yes — no code change after it |
| qa-engineer | round 3 (04:31) | PASS | yes |
| security-engineer | round 2 (02:34) | PASS | yes in substance: later changes were QA-4 (adds framing headers to 404s, a tightening), QA-5 (canvas input), QA-6 + CR-20 (dev-only launcher/watcher; CR-20 is a destructive-action safety fix reviewed by code-reviewer with identity tests). No finding named security in INVALIDATED_GATES, and `docs/SECURITY.md` §3's "only kills processes it started" is now actually true. Not re-run; acceptable |
| documentation (TASK-010) | round 1 | PASS | docs later edited by PM/devops for AUD/QA items; see AUD-7 for stale `--watch` wording |
| product-auditor | this round | — | — |

All gate reports end with exactly one `VERDICT:` line. Every major found after round 1 of its gate (QA-5, CR-20) is
fixed and verified by a later round of that gate. No open critical, blocker, major or high finding remains.

### R2.4 New findings

```
[AUD-6] severity: minor
ROOT_CAUSE: documentation (tracking)
OWNER: pm
AFFECTED_COMPONENTS: tasks/ACTIVE.md (VO-000 gate log, task statuses), tasks/COMPLETED.md
INVALIDATED_GATES: none
Evidence: the VO-000 gate log ends at "product-auditor r1 FAIL … next: QA delta round + reviewer addendum"; QA r2 FAIL
  (QA-4/5/6), review r4 FAIL (CR-20), review r5 PASS, QA r3 PASS and this audit are not recorded. TASK-001…010 are
  `Status: QA (… QA delta round pending — AUD-1)`, which is no longer true.
Fix: append those rounds to the gate log, move TASK-001…010 to DONE with gate references, fill COMPLETED.md.
```

```
[AUD-7] severity: minor
ROOT_CAUSE: documentation — stale text after QA-6 (dev server no longer runs under `node --watch`).
OWNER: documentation-engineer
AFFECTED_COMPONENTS: docs/ARCHITECTURE.md:370 and :386, docs/DEPLOYMENT.md:105 (sample preflight output)
INVALIDATED_GATES: none
Evidence: ARCHITECTURE.md:370 "spawns the server (`node --watch` + tsx)"; :386 "under `node --watch` on Windows the dev
  server is terminated before this runs (ADR-036)"; DEPLOYMENT.md:105 sample holder line "--watch … src/index.ts".
  README:83 and DEPLOYMENT.md:126-129 already say "no `node --watch`" (ADR-036 addendum 3).
Fix: reword the three places to the content-hash watcher + graceful IPC stop.
```

```
[AUD-8] severity: minor
ROOT_CAUSE: documentation (process transparency) — an out-of-repository destructive action is recorded only in chat.
OWNER: pm
AFFECTED_COMPONENTS: tasks/ACTIVE.md (VO-000 log), final §33 report
INVALIDATED_GATES: none
Evidence: per the PM, a devops scratch harness (not shipped) force-killed the unrelated Windows process
  `MoNotificationUx.exe` through PID reuse during AUD-3 testing. The only repository trace is the phrase "the devops
  test-harness incident" in VO-000-review.md CR-20; ADR-036 addendum 2 documents the fix but not the event. The owner's
  rules forbid destructive changes outside the repository, and CLAUDE.md §7/§21 require important facts to be durable
  and reported honestly.
Fix: record the incident (time, process, cause, impact as far as known, remediation = CR-20 identity rule now used by
  the launcher and the harnesses) in the VO-000 log, and state it explicitly in the §33 final report next to
  "committed/pushed/deployed". The shipped product is not affected (CR-20 verified by review r5 and QA r3).
```

```
[AUD-9] severity: minor
ROOT_CAUSE: requirements verification gap — BL-025 is unconfirmed either way.
OWNER: qa-engineer (or the owner, 30-second manual check)
AFFECTED_COMPONENTS: apps/web/src/office/** (BL-025), REQ-073/REQ-080
INVALIDATED_GATES: none
Evidence: QA r3 and the PM saw a desk click hit-tested against the previous layout right after the panel opened or
  closed, only in a hidden window (rAF 0/s). My window was hidden too, so I cannot rule it out in a visible one. If it
  reproduced in a visible window it would be a major defect in a core flow (wrong agent opened).
Fix: one manual check in a visible, focused browser window — open/close the panel, then immediately click a different
  desk, ×5 — before or at handover; list BL-025 under KNOWN ISSUES until then. If it reproduces, it returns to ACTIVE
  as a major frontend item.
```

### R2.5 Items for the §33 final report (KNOWN ISSUES / process)

- Untested: 2560×1440, `prefers-reduced-motion` in a browser, 30-minute demo soak (10.5 min done), BL-025 in a visible
  window, real console Ctrl+C in this environment (verified by devops via console control events).
- Backlog minors: BL-017/018/020…025 (BL-019 closed), CR-21/CR-22 watcher follow-ups.
- The PID-reuse process incident (AUD-8).
- Committed NO, pushed NO, deployed NO (`master` still has no commits; no remote).

### R2.6 Round 2 summary

AUD-1 is closed: the QA gate was re-run in the right order, found a real major defect (QA-5 click-through), and passed
after the fix; code review found and closed another major (CR-20). Both final gates postdate every code change. My own
re-runs are green (`verify` 2 896 tests, `smoke` 27/27), the AUD-3 and QA-5 repros no longer reproduce, and the §32
scenario still works live. No critical or major gap remains between the original request, the requirements, the code
and the tests. AUD-6…AUD-9 are minor and do not block completion; AUD-6 and AUD-8 should be done by the PM before the
owner report, AUD-7 and AUD-9 can go to ACTIVE or the final report's KNOWN ISSUES.

VERDICT: PASS
