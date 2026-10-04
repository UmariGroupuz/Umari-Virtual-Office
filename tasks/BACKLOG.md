# BACKLOG

Deferred items (not Phase 1 DONE criteria). Classification per CLAUDE.md §20. Planned Phase 1 work that
is merely waiting for a dependency lives in `ACTIVE.md` with status BACKLOG/READY, not here.
Maintained by tech-lead/PM. Date: 2026-10-03.

| ID | Title | Class | Source | Target |
|---|---|---|---|---|
| BL-001 | Event retention count cap | RECOMMENDED | ADR-014, ADR-027 | before Phase 2 producers |
| BL-002 | Force control in the simulator UI | OPTIONAL | UX I-1, ADR-022 | Phase 2+ |
| BL-003 | DPR backing-store spike for the office canvas | RECOMMENDED | ADR-012, UX §5.1 | Phase 1.x |
| BL-004 | Playwright e2e for the §32 scenario | OPTIONAL | ARCHITECTURE §14 | Phase 2 |
| BL-005 | Optional producer idempotency key (`eventKey`) | OPTIONAL | ADR-005, ES §8.2 | Phase 2 |
| BL-006 | Socket.IO rooms per project/tenant | OPTIONAL | ADR-009 | Phase 8–10 |
| BL-007 | HTTP rate limiting and producer authentication | RECOMMENDED | ADR-019 | Phase 8 |
| BL-008 | Phase 2 ingest endpoint `POST /api/ingest/:source` + adapter registry | RECOMMENDED | ADR-007 | Phase 2 |
| BL-009 | "Accept and flag" mode for out-of-order real producers | RECOMMENDED | REQUIREMENTS Q-2 | Phase 2 |
| BL-010 | Toolchain upgrade wave (TS 6/7, Vitest 5, React Router 8, jsdom 30, ESLint 10) | OPTIONAL | ADR-026 | when typescript-eslint supports TS ≥ 6.1 |
| BL-011 | Compiled production server build / process manager | OPTIONAL | ADR-013 | Phase 9 |
| BL-012 | Metric cards clickable to filter the roster | OPTIONAL | UX §16.2 | Phase 1.x |
| BL-013 | Demo interval control in the UI | OPTIONAL | UX §16.2 | Phase 1.x |
| BL-014 | Arrow-key navigation in the canvas / roving tabindex in the roster | OPTIONAL | UX §16.2 | Phase 1.x |
| BL-015 | Mobile "Office" tab with a scaled read-only canvas | OPTIONAL | UX §16.2 | Phase 1.x |
| BL-016 | Task detail view / clickable task rows | OPTIONAL | UX §7.3 | Phase 3 |

---

## BL-001 — Event retention count cap
Owner: backend-engineer (+ database-engineer for `EventRepository.pruneToMax`)
Status: BACKLOG
Objective: Bound DB growth with `EVENT_RETENTION_MAX` (default 100 000, `0` disables): prune at boot and
after every 1 000th accepted event, never inside the active demo window (`seq > demo.startSeq`).
Context: ADR-014 (design), ADR-027 (deferred: 30 min of demo ≈ 600 events; no Phase 1 requirement depends on it).
Dependencies: TASK-003, TASK-008
Files/modules affected: `apps/server/src/db/repositories/eventRepository.ts`, `apps/server/src/db/types.ts`
(contract update by tech-lead first), `apps/server/src/services/retentionService.ts`, `apps/server/src/config.ts`,
`.env.example`, README.
Acceptance criteria: ADR-014 rules; `info` log with deleted count; feed and Activity tab unaffected for recent events.
Required tests: prune boundary, demo-window protection, disabled with 0, boot prune.

## BL-002 — Force control in the simulator UI
Owner: frontend-engineer
Status: BACKLOG
Objective: Optional "Force (bypass state rules)" checkbox under Status actions that sends `force: true` on
`PATCH /api/agents/:id/status`, with a warning tint and confirmation copy.
Context: UX §16 I-1; ADR-015, ADR-022 (not in Phase 1). Backend support already exists.
Dependencies: TASK-006, TASK-008
Files/modules affected: `apps/web/src/simulator/**`
Acceptance criteria: off by default, never persisted, clearly labelled, server `forced_transition` log visible in the feed via `forced` flag.
Required tests: payload with/without force; default off.

## BL-003 — DPR backing-store spike for the office canvas
Owner: frontend-engineer
Status: BACKLOG
Objective: Evaluate `Scale.NONE` + manual `game.scale.resize(w·dpr, h·dpr)` with CSS size `w × h` and
zoom × dpr; adopt only if pointer hit-testing stays correct.
Context: ADR-012, UX §5.1, risk R-4. Phase 1 baseline: `Scale.RESIZE` + `Text.setResolution`.
Dependencies: TASK-007
Files/modules affected: `apps/web/src/office/**`
Acceptance criteria: sharper text at DPR 2 without hit-test offset; no FPS regression.
Required tests: manual check at DPR 1/1.5/2; existing office tests stay green.

## BL-004 — Playwright e2e for the §32 scenario
Owner: qa-engineer (+ devops-engineer for the dependency)
Status: BACKLOG
Objective: Automate REQ-191 (simulator Start Work → metrics/office/panel/feed within 1 s; filter ERP).
Dependencies: Phase 1 DONE
Files/modules affected: `e2e/**`, root `package.json` (new devDependency, needs PM approval)
Acceptance criteria: runs headless locally on Windows; no network beyond localhost.
Required tests: the scenario itself.

## BL-005 — Optional producer idempotency key
Owner: backend-engineer
Status: BACKLOG
Objective: Optional `eventKey` on the envelope; a repeated key returns the original event (200) without a new row.
Context: ADR-005 consequence, ES §8.2.
Dependencies: Phase 2 planning
Files/modules affected: shared schemas, `events` table (migration 2), EventService.
Acceptance criteria: additive, backwards compatible; documented in EVENT_SYSTEM.
Required tests: duplicate key, different payload same key (409), no key unchanged behavior.

## BL-006 — Socket.IO rooms per project/tenant
Owner: backend-engineer + frontend-engineer
Status: BACKLOG
Objective: Join rooms by project/tenant to reduce traffic; keep project-less warning/error visible.
Context: ADR-009. Needed only with many clients/tenants (Phase 8–10).
Dependencies: Phase 8 auth
Files/modules affected: `apps/server/src/realtime/**`, `apps/web/src/socket/**`
Acceptance criteria: same visible behavior as client-side filtering.
Required tests: propagation per room.

## BL-007 — HTTP rate limiting and producer authentication
Owner: security-engineer (design) → backend-engineer
Status: BACKLOG
Objective: Producer tokens, per-source rate limits, auth for operator endpoints before any non-loopback exposure.
Context: ADR-019, A-12; ROADMAP Phase 8.
Dependencies: Phase 8
Files/modules affected: `apps/server/src/api/middleware/**`, config, docs/SECURITY.md
Acceptance criteria: defined in Phase 8 requirements.
Required tests: defined in Phase 8.

## BL-008 — Phase 2 ingest endpoint and adapter registry
Owner: integration-engineer → backend-engineer
Status: BACKLOG
Objective: `POST /api/ingest/:source` that validates with the adapter schema, maps with `toCanonical`, and feeds
`EventService.ingest`; first adapter = Claude Code after verification against real hook output.
Context: ADR-007, ES §10, `docs/INTEGRATIONS.md` (status UNVERIFIED).
Dependencies: Phase 2 kickoff; a real Claude Code hook payload sample
Files/modules affected: `apps/server/src/api/routes/ingest.ts`, `packages/shared/src/adapters/**`
Acceptance criteria: status moves to VERIFIED only with captured real payloads.
Required tests: adapter contract tests with recorded real payloads.

## BL-009 — "Accept and flag" mode for out-of-order producers
Owner: architect → backend-engineer
Status: BACKLOG
Objective: Decide whether real producers may report illegal transitions that are stored and flagged instead of 409.
Context: REQUIREMENTS Q-2, ARCHITECTURE R-10.
Dependencies: Phase 2 data from real producers
Files/modules affected: TBD by ADR
Acceptance criteria: ADR + requirement update.
Required tests: TBD.

## BL-010 — Toolchain upgrade wave
Owner: devops-engineer
Status: BACKLOG
Objective: Move to TypeScript ≥ 6, Vitest 5, React Router 8, jsdom 30 (needs Node ≥ 24.15), ESLint 10 once
typescript-eslint supports them and the local Node is upgraded.
Context: ADR-026.
Dependencies: Phase 1 DONE
Files/modules affected: manifests, lockfile, configs
Acceptance criteria: `npm run verify` and `npm run smoke` green after the upgrade.
Required tests: full suite.

## BL-011 — Compiled production server build
Owner: devops-engineer
Status: BACKLOG
Objective: Bundle server + shared to JS (e.g. tsup/esbuild) and run under a process manager.
Context: ADR-013; ROADMAP Phase 9.
Dependencies: Phase 9
Files/modules affected: `apps/server` build config, `docs/DEPLOYMENT.md`
Acceptance criteria: same behavior as tsx runtime; smoke test green.
Required tests: smoke-live against the bundle.

## BL-012 … BL-016 — UX OPTIONAL items
Owner: frontend-engineer (ui-ux-designer for specs)
Status: BACKLOG
Objective/Context: see UX §16.2 (metric-card filtering, demo interval control, canvas keyboard navigation and
roster roving tabindex, mobile office tab) and UX §7.3 (task rows not clickable in Phase 1).
Dependencies: Phase 1 DONE
Files/modules affected: `apps/web/src/**`
Acceptance criteria / Required tests: to be specified when scheduled.

## BL-017 … BL-022 — Deferred code-review findings (VO-000 review rounds 1–2)
Owner: see each item
Status: BACKLOG
Context: `tasks/reports/VO-000-review.md`, ADR-035 §8, ADR-036.
- **BL-017 (CR-12, frontend-engineer, minor)** stale crossfade can leave the wrong chip size on a desk (cosmetic).
- **BL-018 (CR-13, frontend-engineer, minor)** unit tests for `OfficeScene` / `AgentDesk` tween lifecycle.
- **BL-019 (CR-14, frontend-engineer, minor)** avoid a layout read (`updateBounds`) on every pointer move over the office.
- **BL-020 (CR-16, tech-lead → backend-engineer, minor)** single-instance DB lock (lock file next to the DB or SQLite
  exclusive locking) so a second instance on a different `PORT` cannot restore a running instance's demo.
- **BL-021 (CR-17, backend-engineer, minor)** snapshot should query the newest 500 tasks directly instead of reading all rows.
- **BL-022 (ADR-036, devops-engineer, optional)** remove the unused `concurrently` devDependency; optional `dev:free-ports`;
  graceful dev-mode shutdown on Windows (alternative watcher for `dev:server`).

## BL-023 … BL-024 — Dev launcher watcher follow-ups (code review round 5)
Owner: devops-engineer
Status: BACKLOG (minor, dev tooling only)
- **BL-023 (CR-21)** source watcher misses directory renames/deletes (event names a folder, dropped by the extension
  filter) → server keeps stale code until the next real edit. Fix: re-scan the subtree on non-file events.
- **BL-024 (CR-22)** watcher errors are swallowed → auto-restart can stop silently. Fix: log a warning and re-arm.

Note: BL-019 (CR-14) closed — implemented with QA-5 fix (gameManager refreshes bounds only when stale).

## BL-025 — Office: synchronous re-layout on press after a host resize
Owner: frontend-engineer · Status: BACKLOG (minor, unconfirmed in a visible window)
QA r3 + PM observation: in a hidden Chrome window (document.visibilityState = "hidden", rAF/ResizeObserver paused),
a desk click right after the detail panel opens/closes is hit-tested against the previous office layout (wrong
desk). In a visible window the resize lands before the next paint (< 1 frame), so it is most likely a test-environment
artifact. Hardening: on pointerdown, if the host size differs from the game size, resize + re-layout synchronously
before hit-testing. Verify manually in a visible window.
