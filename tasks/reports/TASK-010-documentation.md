# TASK-010 — Documentation report

Agent: documentation-engineer · Date: 2026-10-04 · Environment: Windows 11, Node 24.12.0, npm 11.6.2

## Docs changed

| File | Change |
|---|---|
| `README.md` | New. Covers what it is (Phase 1, monitoring only), features, the UI, requirements, install, dev (both / backend / frontend), one-port mode, local URLs, env vars, scripts, data/seed/reset, simulator, demo mode, how events work (pipeline, §12 example for bash and PowerShell, rules, event types, endpoints, real-time), structure, docs index, known limitations, Phase 2 |
| `docs/ROADMAP.md` | New. Phases 1–10 exactly as §29; Phase 1 delivered; goals, scope and prerequisites for 2–10 with BL-NNN and SECURITY §6 references |
| `docs/PROJECT.md` | Status and feature table; docs index with owners; removed links to the non-existent `COMPLETED.md`/`BLOCKED.md` |
| `docs/ARCHITECTURE.md` | Aligned with the code (update note at the top, edits marked *(TASK-010)*): component diagram (middleware chain, routes, no retentionService), §3 replaced by the implemented tree, `{ data }` envelope, listen-first boot, snapshot `lastSeq`/task cap, ADR-025 seam, ADR-033 store mutators, Logs derived, Host guard/Origin rule, retention deferred, config/.env parsing, dev launcher, extra `task_id` index, demo id format, seed counts, test seams, recommendation statuses |
| `docs/EVENT_SYSTEM.md` | `{ data }` responses and socket payload = `data`; middleware order; PATCH body (`source`, `action`); 403/503/Content-Encoding rows; socket handshake rules and refusal response; `lastSeq` replay; demo id format, beat builder and restore safety; adapter sketch note; §11 example wrapped in `data` (checked live) |
| `docs/AGENT_STATE_MACHINE.md` | Update note (tables checked against the code: identical); ADR-032 §3 and §5, ADR-024 clarifications |
| `tasks/ACTIVE.md` | TASK-010 → REVIEW (own block only) |

## Verified against code and by running commands (PowerShell + Git Bash)

| Check | Result |
|---|---|
| `npm run verify` | format:check, lint, typecheck, test, build all PASS (it rebuilt `apps/web/dist`) |
| `npm run smoke` | 27/27 PASS |
| `npm run dev` (temp `DB_PATH`) | launcher banner; `GET http://127.0.0.1:4000/api/health` and `http://localhost:5173/api/health` 200; `/` 200; simulator-style PATCH through the proxy with `Origin: http://localhost:5173` → 200; same status → `event: null` |
| `npm run dev:server`, `npm run dev:web` separately | both healthy, proxy works |
| `npm start` (PORT 4100, temp DB) | seeds 15/11/44; `/` serves `text/html`; unknown `/api` → 404 JSON |
| §12 example, `Invoke-RestMethod` (README PowerShell variant) | 201; event seq 45, agent working/SW-123/Lost Goods API/version 2, task in_progress/version 2 |
| `curl.exe` with `--data-binary "@event.json"` and with `-d '{\"…\"}'` in PowerShell 5.1 | 201 / 409 `Illegal transition: idle → completed` |
| bash `curl -d '…'` | 201 |
| Foreign `Origin` POST / missing `Content-Type` | 403 `ORIGIN_NOT_ALLOWED` / 400 `INVALID_JSON` |
| Demo start `{intervalMs:2000}` → events with `source=demo` → stop | restore summary returned (4 agents restored, 3 demo tasks deleted) |
| `POST /api/tasks` | `SW-126` generated, `todo` |
| `npm run db:reset` | temp DB in `data/` reset and seeded (then deleted); `:memory:` refused, exit 1 |
| Scripts, env vars, ports, defaults | checked against `package.json` (root and workspaces), `.env.example`, `config.ts`, `vite.config.ts`, `scripts/*.mjs` |
| State tables, mapping | checked against `packages/shared/src/state/*` (43 legal / 13 illegal) |
| UI copy in README (buttons, toggles, notices) | checked against `apps/web/src/copy.ts` |
| Relative links in the changed docs | all resolve |

Not run: `npm run format` (it writes files while other agents are editing); `npm run smoke -- --dev`
(owned by the parallel devops fix). `data/office.db` was never touched; temp DBs and dirs were removed.

## Findings in documents I do not own

```
[DOC-1] severity: minor
ROOT_CAUSE: contract — stale script table
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/API_CONTRACTS.md §12.2
INVALIDATED_GATES: none
Evidence: §12.2 lists `dev` = `concurrently -k …` and has no `smoke` row; package.json has
  "dev": "node scripts/dev.mjs" (ADR-036) and "smoke": "node scripts/smoke-live.mjs".
Fix: update the two rows (and drop the `tsx watch` fallback note if no longer relevant).

[DOC-2] severity: minor
ROOT_CAUSE: contract — `.env` loading described wrongly
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/API_CONTRACTS.md §11 (also IMPLEMENTATION_PLAN §3 "dotenv (`process.loadEnvFile`)")
INVALIDATED_GATES: none
Evidence: config.ts reads `<repo>/.env` with `util.parseEnv` and merges it under the real environment
  without mutating process.env (ADR-032 §8); §11 says `process.loadEnvFile()`.
Fix: reword §11 per ADR-032 §8.

[DOC-3] severity: minor
ROOT_CAUSE: contract — boot order contradiction
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/API_CONTRACTS.md §9.6
INVALIDATED_GATES: none
Evidence: §9.6 "Boot: if present → restoreDemoSnapshot before `listen`"; §9.8 and index.ts (ADR-035): listen →
  seedIfEmpty → demo.recoverOnBoot() → markReady.
Fix: "after listen, before the readiness gate opens".

[DOC-4] severity: minor
ROOT_CAUSE: contract — header metadata
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/API_CONTRACTS.md header
INVALIDATED_GATES: none
Evidence: header says "Status: CONTRACT v1" and inputs "ADR-001…028"; the change log is at v1.2 (ADR-035/037).
Fix: bump header to v1.2 / ADR-001…037.

[DOC-5] severity: minor
ROOT_CAUSE: requirements — misleading metric expectation
OWNER: product-analyst
AFFECTED_COMPONENTS: docs/REQUIREMENTS.md REQ-191 (a)
INVALIDATED_GATES: none
Evidence: "Active Tasks +1 if SW-123 moved to in_progress"; SW-123 starts `assigned`, which is already an active
  status (A-06, ACTIVE_TASK_STATUSES), so Active Tasks does not change in the §32 scenario.
Fix: "Working +1; Active Tasks unchanged (SW-123 assigned → in_progress stays active)".

[DOC-6] severity: minor
ROOT_CAUSE: documentation — outdated plan row
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/IMPLEMENTATION_PLAN.md §3 (`concurrently` "npm run dev on Windows"), R-8
INVALIDATED_GATES: none
Evidence: `concurrently` is installed but unused since ADR-036 (BL-022).
Fix: note "unused since ADR-036, removal BL-022".
```

DECISIONS.md ADR-011/ADR-014 mention `<PREFIX>-D<n>` and `retentionService`. They are historical and
superseded by ADR-027, so no change is needed. `DEPLOYMENT.md` and `SECURITY.md` match the code; nothing
found.

No blocker or major findings.

VERDICT: PASS
