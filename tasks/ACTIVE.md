# ACTIVE

## VO-000 — AI Virtual Office MVP, Phase 1 (epic)
Owner: pm
Status: DONE (Phase 1 complete — all gates PASS, 2026-10-04)
Objective: Build a runnable, verified real-time Virtual Office monitoring MVP for the 15-agent AI team.
Context: docs/ORIGINAL_REQUEST.md, docs/PM_BRIEF.md
Dependencies: none
Files/modules affected: entire project root
Acceptance criteria: all requirements in docs/REQUIREMENTS.md met; §32 verification of the original request performed; all gates PASS.
Required tests: install, lint, typecheck, tests, build, live run (backend + frontend + socket), restart.
Status log:
- 2026-10-03 PM: intake + repository inspection done (empty repo, Node 24.12, npm 11.6.2).
- 2026-10-03 PM: requirements → product-analyst.
- 2026-10-03 PM: architect ∥ ui-ux-designer done; tech-lead contracts/plan/tasks done; REQUIREMENTS v1.2 aligned.
- 2026-10-04 PM: TASK-001 implemented; PM re-ran `npm run verify` → all 5 steps PASS. Gate decision: code review
  runs once over the integrated implementation (TASK-001…008) after W3, per the CLAUDE.md §23 pipeline
  (engineers → code-reviewer), instead of a separate review run per task. TASK-002 started.
- 2026-10-04 PM: W2 (TASK-003…007) and W3 (TASK-008) implemented; deviations accepted as ADR-031…034.
  PM integration check: `npm run verify` PASS; live dev run in Chrome — office renders, §32 Backend idle → working
  via simulator updated metrics/office/panel/feed; `?project=ishkun24` filter OK.
- 2026-10-04 Gate log (each FAIL → owners → re-run):
  - code-reviewer r1 FAIL (CR-1 socket Origin, CR-2 boot order; majors) → fixes per ADR-035/036 → r2 PASS.
  - qa-engineer r1 PASS (3 minors QA-1…3).
  - security-engineer r1 PASS (SEC-1 medium + 5 low) → fixes per ADR-037 → security r2 PASS; code-reviewer r3 PASS
    (CR-18, CR-19 minors → fixed by devops/backend).
  - documentation-engineer TASK-010 PASS (DOC-1…6 stale-text items → fixed by tech-lead/product-analyst).
  - product-auditor r1 FAIL (AUD-1 critical: QA not re-run after ADR-037 changes; AUD-2…5 minors) →
    AUD-3 → devops, README limitations → documentation, task tracking updated (AUD-4); next: QA delta round +
    reviewer addendum (CR-18/19, AUD-3) → audit delta.
  - code-reviewer r4 addendum FAIL (CR-20 major: PID-reuse-unsafe kill paths in scripts/dev.mjs) → devops fix
    (PID + creation-time identity, kill only un-exited children) → see r5.
  - qa-engineer r2 FAIL (QA-5 major: office click-through via Phaser window events; QA-4, QA-6 minors) → frontend
    (windowEvents:false + inputGuard), backend (app-level 404 with framing headers), devops (content-hash watcher
    replacing `node --watch`) → code-reviewer r5 PASS (CR-21/22 minors → BL-023/024) → qa-engineer r3 PASS.
  - product-auditor r2 PASS (AUD-6…9 minors: task log, stale docs, incident record, BL-025 unconfirmed).
- 2026-10-04 INCIDENT (process, not product) — recorded per AUD-8:
  - What: during AUD-3 verification, a devops scratch test harness (scratchpad only, never shipped) force-killed an
    unrelated Windows process `MoNotificationUx.exe` (PID 34100, Windows Update notification UI).
  - Cause: the harness tracked a process tree by PID only; a PID was reused by Windows and the cleanup step's
    `taskkill /T /F` hit the unrelated process.
  - Impact: transient Windows UI process stopped; no data involved; Windows restarts it on demand. Owner's other
    processes (Sellway vite on 5174/5188) were never touched.
  - Fix: harnesses and the shipped launcher now kill only processes they provably own (un-exited Node child handles,
    or PID + creation-time identity); port-lookup kills removed (CR-20, ADR-036 addendum 2). Disclosed to the owner
    in the final report.
- 2026-10-04 PM: all tasks moved to DONE; `tasks/COMPLETED.md` updated. Remaining minors live in `tasks/BACKLOG.md`
  (BL-001…025).
Blocked: none (`tasks/BLOCKED.md`).
Skipped roles: none.

<!-- tech-lead: add VO implementation tasks (TASK-NNN) below this line. Do not remove VO-000. -->

## Plan overview (tech-lead, 2026-10-03)

Contracts: `docs/API_CONTRACTS.md` (API-C) · plan: `docs/IMPLEMENTATION_PLAN.md` (IP) · decisions:
ADR-021…028 in `docs/DECISIONS.md`. Every engineer reads, before starting: `CLAUDE.md` (org rules),
`docs/PM_BRIEF.md`, the task below, the API-C sections it cites, and the REQ IDs it links.

| Wave | Tasks (parallel within a wave) | Starts when |
|---|---|---|
| W0 | TASK-001 devops | now |
| W1 | TASK-002 backend | TASK-001 DONE |
| W2 | TASK-003 database ∥ TASK-004 integration ∥ TASK-005 backend ∥ TASK-006 frontend (A) ∥ TASK-007 frontend (B) | TASK-002 DONE |
| W3 | TASK-008 backend | TASK-003 + TASK-005 DONE |
| W4 | TASK-009 devops ∥ TASK-010 documentation | TASK-006 + TASK-007 + TASK-008 DONE (TASK-010 may start ROADMAP.md in W1) |

Critical path: TASK-001 → TASK-002 → TASK-003 / TASK-005 → TASK-008 → TASK-009 → QA → security → audit.
Near-critical: TASK-002 → TASK-006 (largest task). File ownership is disjoint inside each wave (IP §2,
ADR-028); an engineer who needs a change in a file owned by another task stops and reports to the PM.
Common rules for all tasks: no `npm install <pkg>` after TASK-001; no commits; no feature code outside the
listed files; tests are run, not only written; `npm run lint`, `npm run typecheck` and the workspace tests
must be green at the end of every task. Gates per CLAUDE.md §23: each task → `code-reviewer`; integrated
system → `qa-engineer`, `security-engineer`, `product-auditor`.

---

## TASK-001 — Project scaffolding, toolchain and smoke tests
Owner: devops-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W0 (alone)
Status log:
- 2026-10-04 devops-engineer: implemented; `npm ci` clean (0 vulnerabilities, no EBADENGINE), `npm run verify`
  green in Git Bash and PowerShell, `npm run dev` checked; R-2 and R-18 resolved without fallback. Deviations
  in ADR-029 (jest-dom `^7.0.1`, added `.gitattributes`, shared `types: ["node"]` + lint globals ban). → code-reviewer.
Objective: Create a compiling, lint-clean, test-green monorepo skeleton with every dependency of every
workspace installed once, so W1–W3 tasks never need `npm install`.
Context: API-C §0, §10.1 (lint boundaries), §10.2 (OfficeCanvas stub), §11, §12; IP §2, §3; ADR-001, 002,
013, 026, 027, 028; risks R-2, R-8, R-9, R-14, R-17, R-18.
Dependencies: none
Files/modules affected (creates; ownership after this task in brackets):
- `/package.json`, `/package-lock.json`, `/tsconfig.base.json`, `/eslint.config.js`, `/.prettierrc.json`,
  `/.prettierignore`, `/.gitignore`, `/.editorconfig`, `/.env.example`, `/data/.gitkeep`, `/scripts/verify.mjs`
  [TASK-001/devops]
- `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`,
  `packages/shared/test/smoke.test.ts` [devops]; stub `packages/shared/src/index.ts` (`export {};`) [→ TASK-002]
- `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`,
  `apps/server/test/smoke/sqlite.smoke.test.ts` [devops]; stub `apps/server/src/index.ts` (opens a `node:sqlite`
  `:memory:` DB, prints one JSON log line, exits 0) [→ TASK-008]
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`,
  `apps/web/index.html` (title "AI Virtual Office"), `apps/web/src/vite-env.d.ts`, `apps/web/test/setup.ts`,
  `apps/web/test/smoke.test.tsx` [devops]; stubs `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (dark page with the
  text "AI Virtual Office"), `apps/web/src/styles/index.css` (`@import "tailwindcss";` + Inter import) [→ TASK-006];
  stub `apps/web/src/office/OfficeCanvas.tsx` exactly per API-C §10.2 stub rule [→ TASK-007]
Acceptance criteria:
1. Dependencies exactly per IP §3 (ADR-026) in the right workspaces; `npm install` from a clean clone
   succeeds on Windows with no `EBADENGINE` warnings; lockfile created. (REQ-171, NFR-010)
2. All scripts of API-C §12.2 exist in root/workspace manifests and run from PowerShell and Git Bash
   (no `rm -rf`, no inline env, no `&`). `scripts/verify.mjs` runs format:check → lint → typecheck → test →
   build, prints a pass/fail summary, exits non-zero on the first failure (uses `spawnSync` with
   `shell: true` for `npm` on Windows). (REQ-171, R-8)
3. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
   `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, `module: ESNext`,
   `moduleResolution: Bundler`, `target: ES2023`, `skipLibCheck`, `noEmit`; workspace tsconfigs extend it
   (web: DOM libs, `jsx: react-jsx`, `types: ["vite/client"]`; server: `types: ["node"]`) and include
   `src`, `test` and config files. (NFR-009)
4. `eslint.config.js` (flat, ESLint 9): `@eslint/js` recommended, typescript-eslint
   `recommendedTypeChecked` with `projectService`, `no-floating-promises`, `no-misused-promises`
   (`checksVoidReturn: { attributes: false }`), react-hooks + react-refresh for `apps/web`, ban of
   `dangerouslySetInnerHTML` via `no-restricted-syntax`, `no-restricted-imports` boundaries of API-C §5
   (shared: no `node:*`, `express`, `react`, `phaser`, `socket.io*`) and §10.1 (phaser only in
   `apps/web/src/office/**`; office imports no shell modules; shell imports only `office/OfficeCanvas`),
   `eslint-config-prettier` last; ignores `**/dist`, `**/coverage`, `data/`, `node_modules`. (NFR-009, REQ-163)
5. Prettier config (`singleQuote`, `printWidth: 100`, `trailingComma: "all"`); `.prettierignore` excludes
   `**/*.md`, `docs/`, `tasks/`, `package-lock.json`, `dist`, `coverage`, `data`.
6. `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `data/*` except `data/.gitkeep`, `.env`, `*.log`,
   `*.tsbuildinfo`, `.vite/`. `.env.example` byte-for-byte API-C §11. (REQ-164)
7. Vite: port 5173 `strictPort`, proxy `/api` and `/socket.io` (`ws: true`) → `http://127.0.0.1:4000`
   (R-9); `@vitejs/plugin-react` + `@tailwindcss/vite`. Vitest: shared `environment: node`; server
   `environment: node`, `pool: 'forks'`, include `src/**/*.test.ts` and `test/**/*.test.ts`; web
   `environment: jsdom`, `setupFiles: ['test/setup.ts']`; `globals: false` everywhere;
   `passWithNoTests: false`. `test/setup.ts` registers `@testing-library/jest-dom/vitest`, `afterEach(cleanup)`,
   and stubs `matchMedia` and `ResizeObserver` (web tasks must not edit it).
8. R-2 resolved: `sqlite.smoke.test.ts` imports `DatabaseSync` from `node:sqlite` under Vitest, creates a
   `:memory:` DB, runs CREATE/INSERT/SELECT and proves `PRAGMA user_version` is rolled back with a
   transaction. No `ExperimentalWarning` noise in test output (RECOMMENDED; pass the flag via Vitest
   `execArgv`/env in config, not in npm scripts). If Vite 8/Vitest 4.1 cannot load `node:sqlite`, apply the
   fallback of ADR-026 and record it in DECISIONS.md.
9. `npm run lint`, `typecheck`, `test`, `build`, `format:check`, `verify` all green. `npm run dev` starts both
   processes without crashing; `http://localhost:5173` shows the dark placeholder page with Inter (a Tailwind
   utility class visibly applied); `npm run dev:server` keeps watching after the stub exits.
10. No feature code (no routes, components, schemas, SQL beyond the smoke test).
Required tests: `packages/shared/test/smoke.test.ts` (imports `@vo/shared`), `apps/server/test/smoke/sqlite.smoke.test.ts`,
`apps/web/test/smoke.test.tsx` (renders `<App />` with Testing Library, asserts the text). Run and report
the output of every script in criterion 9 (PowerShell and Git Bash).
Gate: code-reviewer.

## TASK-002 — `@vo/shared`: types, schemas, state machines, constants, reference data
Owner: backend-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W1 (alone — everything else imports it)
Status log:
- 2026-10-04 backend-engineer: implemented all API-C §5.1 files (except TASK-004 adapters; `adapters/index.ts` =
  `export {}`) and `apps/server/src/db/types.ts` (verbatim §9.2). 14 colocated test files, 666 tests green;
  `npm run lint`, `typecheck`, `test`, `format:check` green. Interpretations of ambiguous contract points in
  ADR-030 (empty query values → 400, enum tokens not trimmed, extra UX §9.5 messages, PATCH blockedBy
  self-check left to the server). → code-reviewer.
Objective: Implement the complete shared domain contract exactly as specified, with exhaustive unit tests,
plus the server repository contract file.
Context: API-C §1, §2, §5, §6; ASM §1–§7; ES §2–§3, §8.3; UX §1.2–1.4, §5.2, §6, §9.3; REQ-001, 010, 013,
020, 021, 023, 026, 062, 120 (reference part), 132; ADR-002, 005, 006, 016, 017, 023, 025, 027, 028.
Dependencies: TASK-001
Files/modules affected:
- `packages/shared/src/**` — all files of API-C §5.1 incl. colocated `*.test.ts`, **except**
  `packages/shared/src/adapters/{types,claudeCode}.ts` and adapter tests (TASK-004). Create
  `packages/shared/src/adapters/index.ts` as `export {};` and re-export it from `src/index.ts` (→ TASK-004).
- `apps/server/src/db/types.ts` — verbatim from API-C §9.2 (type-only; → TASK-003 after this task).
Acceptance criteria:
1. Every export of API-C §5.2 exists with the exact name and signature; types structurally equal to §1
   (asserted with `expectTypeOf`). (REQ-010, NFR-009)
2. `AGENT_TRANSITIONS` = ASM §2.1 (43 legal / 13 illegal); `TASK_TRANSITIONS` = ASM §5.2; implicit
   assignment via `canTransitionTask(…, { owned: true })`; status mapping = ASM §6. (REQ-010, 011, 013, 042)
3. `producerEventInputSchema`/`eventInputSchema`: discriminated union, strict objects, per-type
   required/forbidden fields (ES §3), limits (REQ-023, API-C §3.7), trimming, empty-as-absent, null-as-absent,
   reserved sources (producer schema only), server-only types, custom messages of API-C §2.2. (REQ-020, 023)
4. Body and query schemas for every endpoint of API-C §3 incl. defaults and cross-field rules (ADR-024);
   `toValidationIssues` expands unknown keys to one issue per key. (REQ-004, 024, 040, 041, 110)
5. Reference data exactly API-C §6.1–6.4; palette/labels exactly UX §1.2–1.4 / API-C §5.2;
   `resolveProjectRef` and project filter predicates per ES §8.3 / ADR-006. (REQ-001, 026, 062)
6. No `node:*`/DOM/framework imports (lint passes); only runtime dependency `zod`.
7. `apps/server/src/db/types.ts` compiles and matches API-C §9.2 exactly.
Required tests (colocated, `npm test -w @vo/shared`): all 64 agent cells (diagonal = false) and 81 task
cells table-driven from the docs' tables; legal/illegal counts; the 9 owner examples + `idle → working`;
ASM §6 consistency property over all statuses; implicit-assignment cases; every REQ-023 schema rule with
boundary values (action 100/101, message 2000/2001, metadata 8192/8193 bytes, progress -1/0/100/101/1.5,
taskId pattern, source pattern, reserved sources, `status` on `agent.connected`/`system.*`, unknown key
`foo` → `{path:"foo", message:"Unrecognized key"}`, unknown and server-only types); the §12 example parses;
query schemas (digits only, ranges, defaults, unknown key); task create/patch cross-field rules;
`eventMatchesProject` (project match, project-less warning/error visible, project-less info hidden, null
filter); `resolveProjectRef` (id, name, case, whitespace, "All Projects" → null); reference invariants of
API-C §6.4 (unique ids/codes/deskIds, desk ∈ layout, room match, display order permutation, desks inside rooms);
palette/labels cover every enum value.
Gate: code-reviewer.

## TASK-003 — Database layer, migrations, repositories, seed and reset
Owner: database-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W2 (parallel with TASK-004, 005, 006, 007)
Status log:
- 2026-10-04 database-engineer: implemented `db/connection.ts`, `db/migrations/{index,001_init}.ts`, `db/mappers.ts`,
  `db/repositories/{index,statements,project,agent,task,event,settings}Repository.ts`, `db/testing.ts` (test fixtures),
  `seed/{seedData,seed,reset}.ts` + 9 colocated test files (93 tests; seed consistency proven by an independent
  replay oracle, mutation-checked). `db/types.ts` unchanged. Server typecheck green; eslint/prettier clean on
  `db/**` + `seed/**`; `npm run db:reset` exercised end-to-end (fresh, existing, `:memory:`, outside `data/`,
  busy port → exit 0/1 as contracted). Additive deviations (no contract signature broken) listed in the report
  to the PM for an ADR decision. → code-reviewer.
Objective: Implement the SQLite persistence behind the contracted repository interfaces, the seed baseline
and the dev-only reset CLI.
Context: API-C §7, §8, §9.1–9.2, §12.3; ARCHITECTURE §5; ADR-003, 004, 010, 011 (touch detection), 027
(demo id format); REQ-001, 053, 120–122; NFR-003; risks R-1, R-12.
Dependencies: TASK-002
Files/modules affected: `apps/server/src/db/**` (takes over `db/types.ts`; adds `connection.ts`,
`migrations/index.ts`, `migrations/001_init.ts`, `mappers.ts`, `repositories/*.ts`, colocated `*.test.ts`),
`apps/server/src/seed/**` (`seed.ts`, `seedData.ts`, `reset.ts`, tests). Nothing else.
Acceptance criteria:
1. `openDatabase` per API-C §9.2: parent dir creation, pragmas (WAL only for file DBs), migrations,
   repositories; `transaction` semantics incl. thenable rejection and nested-call error; `ping`; idempotent
   `close`. (ADR-003/004, NFR-003)
2. Schema exactly API-C §8 via migration `1/init` and `PRAGMA user_version`; failing migration rolls back and
   throws. (ADR-004)
3. Every repository method of API-C §9.2 implemented with prepared, parameterized statements; mapping
   rules of §8; `version` increments; events list = feed predicate, filters AND-combined, `seq DESC`,
   `limit + 1` paging; `touchedSince` per ADR-011; `maxNumericSuffix` ignores demo ids. (REQ-024, 029)
4. `seedIfEmpty` writes exactly the baseline of API-C §7 in one transaction, only when `agents` is empty;
   restarts never duplicate. (REQ-120, 121, 122)
5. `reset.ts` behaves per API-C §12.3 and exports a testable `resetDatabase(options)` used by the CLI.
   (REQ-122)
6. No SQL outside `apps/server/src/db/**` and `seed/**`; no logging dependency (return info to the caller).
Required tests (colocated): migrations 0→1, re-run no-op, rollback on a failing migration; pragmas
(`foreign_keys` = 1; WAL on a temp-file DB); each repository method incl. ordering, null/boolean/JSON
mapping, `version` increments, `replace`, `delete`, unknown-id throws; events filters + feed predicate +
exact `nextBefore` + `before` cursor; `touchedSince` (demo vs non-demo sources, agent vs task rules);
`maxNumericSuffix` with `SW-D57-1a`; transaction rollback on throw / thenable / nested; `ping` false after
close; seed: idempotent double call, counts (15/4/11/≥30), metrics totals of API-C §7.2, ASM §4 invariants
for every agent, REQ-121 (BE idle, SW-123 assigned to BE), all event references exist, ≥ 4 projects and ≥ 6
types covered, no `demo` source, `seq` order = chronological; reset refuses `:memory:`, paths outside
`data/`, and a busy port (temporary listening server), and reseeds a temp DB inside a temp repoRoot. Use
`os.tmpdir()` temp dirs and clean up.
Gate: code-reviewer.

## TASK-004 — Claude Code producer adapter (pure) and integrations doc
Owner: integration-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W2
Status log:
- 2026-10-04 integration-engineer: implemented `adapters/{types,claudeCode,index}.ts` + `claudeCode.test.ts`,
  `index.test.ts` (188 tests; shared suite 854 green), `docs/INTEGRATIONS.md` (Claude Code format UNVERIFIED,
  adapter MOCKED). Scoped typecheck/eslint/prettier green; grep: no route/script/process uses the adapter.
  Interpretations recorded in INTEGRATIONS.md §3.5 (ellipsis inside limits, tool/result capped at 100 in raw,
  `metadata.truncated`/`droppedRawFields` markers). → code-reviewer.
Objective: Provide the unit-tested, unwired adapter that maps the owner's §19 Claude Code format to the
canonical envelope, and document integration status honestly.
Context: ORIGINAL_REQUEST §18–19; ES §10; API-C §5.3; REQ-130, 131, 132; ADR-007; CLAUDE.md §16.
Dependencies: TASK-002
Files/modules affected: `packages/shared/src/adapters/**` (`types.ts`, `claudeCode.ts`, `index.ts` (takes
over the stub), `*.test.ts`), `docs/INTEGRATIONS.md` (new). Nothing else.
Acceptance criteria:
1. Exports exactly API-C §5.3; adapters are pure (no I/O, clock, randomness). (REQ-131, ADR-007)
2. Mapping exactly ES §10.1 (type, source, ids, tool → action table, message format and truncation, severity,
   `metadata.adapter/adapterVersion/raw`, ≤ 8 KB). The §19 example produces exactly the expected output of
   ES §10.1. Output passes `producerEventInputSchema`. (REQ-131, 132)
3. Unsupported `event` → `AdapterError('UNSUPPORTED_EVENT')`; schema failure → `AdapterError('INVALID_PAYLOAD')`.
4. No server route, script or process uses the adapter (verified by grep in the report). (ADR-007)
5. `docs/INTEGRATIONS.md`: table of integrations with status per CLAUDE.md §16 — Claude Code format
   **UNVERIFIED** (owner example, not a confirmed contract), adapter **MOCKED** (unit tests only); Telegram,
   GitHub, Docker, CI/CD, browser/OpenAI agents not started; Phase 2 plan (`POST /api/ingest/:source`,
   adapter registry, producer auth) and what must be verified against a real Claude Code hook. (REQ-130)
Required tests: §19 example; each tool-map row (case-insensitive); terminal command classification (git
status/diff/commit, npm/pnpm/yarn test/build, vitest, jest, pytest, tsc, vite build, other); failure results
(`failure`, `failed`, `error`) → severity error + " (failed)"; truncation (command 500 in message, 1000 in raw);
oversized raw payload stays ≤ 8 KB; unknown tool → slug; unsupported event; invalid payload; every output
validates against `producerEventInputSchema`.
Gate: code-reviewer (+ security-engineer reads INTEGRATIONS.md in the security gate).

## TASK-005 — Server core: pure event/task/demo rules, config, logger, errors, broadcaster
Owner: backend-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W2 (parallel with TASK-003; no DB access in this task)
Status log:
- 2026-10-04 backend-engineer: implemented config/logger/errors/broadcaster and the pure rules
  (`decideEvent`, `decideTaskCreate`/`decideTaskPatch` incl. self-block 400, `nextDemoBeat`). 7 colocated test
  files, 336 tests green (incl. 1 000 seeded random sequences and an 8-cycle demo simulation from the §7 baseline
  with zero rejections). Scoped eslint/prettier clean; `npm run typecheck -w apps/server` green. Extra test-only
  helper `services/testHarness.ts`; contract interpretations proposed as ADR-031 in the report. → code-reviewer.
- 2026-10-04 backend-engineer: `errors.ts` gained `appErrors.starting()` (503 "Server is starting", ADR-035 §2) + test.
Objective: Implement all server business rules as pure, deterministic functions plus the infrastructure
modules the server app assembles in TASK-008.
Context: API-C §2.2, §9.3, §9.4, §9.5, §9.7, §11; ASM §4–§8; ES §2.3, §3–§5, §9, §11; ADR-008, 011, 015,
016, 017, 018, 020, 022, 023, 024, 027; REQ-003, 004, 011–013, 020–022, 041, 042, 111, 150, 151.
Dependencies: TASK-002 (imports `apps/server/src/db/types.ts` type-only)
Files/modules affected: `apps/server/src/config.ts`, `apps/server/src/logger.ts`, `apps/server/src/errors.ts`,
`apps/server/src/services/eventEffects.ts`, `apps/server/src/services/taskRules.ts`,
`apps/server/src/services/demoScript.ts`, `apps/server/src/realtime/broadcaster.ts`, and their colocated
`*.test.ts`. Nothing else.
Acceptance criteria:
1. `decideEvent` implements ASM §4 (ordered steps) and ES §4–§5 (effects, existence, ownership/claiming,
   implicit assignment, project derivation/mismatch, severity defaults, force) for all 13 producer types; never
   reads a clock (uses `now`). Agent legality is checked before task legality. (REQ-003, 011, 012, 013, 021, 042)
2. `decideTaskCreate`/`decideTaskPatch` implement ADR-024 and ASM §5.3 incl. no-op detection and
   `metadata.changes`. (REQ-040, 041)
3. `nextDemoBeat` follows ES §9 storyline, uses `demoTaskId` (ADR-027), skips touched agents, inserts bridging
   inputs, emits only `source: "demo"`, never references non-demo tasks. (REQ-111, 112)
4. `errors.ts` messages exactly API-C §2.2; `toErrorBody` envelope. `logger.ts` per ADR-018 and the msg keys of
   API-C §9.3. `config.ts` per API-C §11 (defaults, validation, `--serve-web`, path resolution from
   `import.meta.url`, `.env` via `process.loadEnvFile`, env wins). `broadcaster.ts` per API-C §9.7.
   (REQ-150, 151, 161, ADR-020/023)
Required tests (colocated): table-driven `decideEvent` per event type and per ASM §4 step; ES §11 example
(exact agent/task patches); every rejection (409 agent first, 409 task, terminal progress, UNKNOWN_TASK
incl. create-without-project message, PROJECT_MISMATCH); claim vs non-assignee (Reviewer reviewing BE's task
leaves the task unchanged); implicit assignment of a `todo` task; force (`forced` list, `forced:false` when legal
anyway, terminal task reopen); `agent.connected`/`disconnected` from every status; `system.*` never patches;
invariant property (ASM §4) over ≥ 1 000 random event sequences from a seeded PRNG starting from the API-C §7
baseline; task rules per ADR-024 bullet; demo: simulate ≥ 3 full cycles from the seed baseline by applying each
input through `decideEvent` sequentially → zero rejections, touched agents skipped, ids unique per
`sessionKey`, offline agent bridged with `agent.connected`; config defaults/errors/flags/relative and
`:memory:` DB_PATH/`isLoopbackHost`; logger JSON shape, levels, `child`, `silent`, stderr for warn/error;
every `appErrors` message string; `RecordingBroadcaster` records and forwards.
Gate: code-reviewer.

## TASK-006 — Web shell: data layer, dashboard, roster, detail panel, feed, simulator, demo toggle, states
Owner: frontend-engineer (instance A)
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W2 (parallel with TASK-007; builds against API-C with the API mocked in tests)
Status log:
- 2026-10-04 frontend-engineer (A): implemented `apps/web/src/**` except `office/**` (data layer, socket status
  machine + buffered resync, reducer/store/selectors, all screens/states of UX §2–§15, URL state, NotFound).
  14 test files / 182 tests (API and OfficeCanvas mocked); `npm run lint`, `typecheck`, `format:check`,
  `npm run test -w apps/web`, `npm run build -w apps/web` green. Visual spot-check in Chrome against a
  throwaway contract-shaped mock server (not committed) with TASK-007's office integrated. Not verified
  against the real backend (TASK-008 pending). Deviations/gaps in the report to the PM. → code-reviewer.
- 2026-10-04 frontend-engineer (A): review round 1 fixes CR-3, CR-4 (client), CR-5, CR-10, CR-11 + PM live-check
  finding (roster hidden behind the open simulator dock). Web: 22 files / 1309 tests (own: 16 / 191), lint,
  typecheck, format:check, build green. → code-reviewer (re-review).
Objective: Build the complete React application around the office seam — every screen, state and flow of
UX.md except the canvas drawing — driven only by API responses and socket broadcasts.
Context: UX §1–§4, §6–§15; API-C §1, §3, §4, §10; ARCHITECTURE §4.2, §7; ADR-010, 021, 022, 023, 025;
REQ-050–053, 060–064, 080–083, 090–092, 100–104, 110, 140–144; NFR-001, 002, 005, 006, 011, 012.
Dependencies: TASK-002 (TASK-007 not required: the TASK-001 stub OfficeCanvas compiles; TASK-008 needed only
for the live run, which happens in TASK-009/QA)
Files/modules affected: `apps/web/src/**` **except** `apps/web/src/office/**` — takes over `main.tsx`,
`App.tsx`, `styles/index.css`; creates `copy.ts`, `api/`, `socket/`, `store/`, `components/`, `layout/`,
`dashboard/` (incl. `OfficeCard.tsx`), `agents/` (incl. `tabs/`), `activity/`, `simulator/`, `mocks/`, `lib/`,
`hooks/`, `pages/`, colocated `*.test.tsx`. Must not edit `apps/web/test/setup.ts` or configs (TASK-001).
Acceptance criteria:
1. Data layer: `api/client.ts` per API-C §10.3 (envelope unwrap, `ApiError`, 10 s / 5 s timeouts); socket
   singleton with listeners attached once, status machine (connecting/connected/reconnecting/disconnected per
   UX §11.2), resync algorithm of API-C §4; Zustand store whose only domain mutators are `hydrate` and
   `applyOfficeEvent` (pure reducer: version gating, id dedupe, feed cap 200); health polling. Simulator and
   demo writes never mutate the store directly (responses go through the reducer). (REQ-050–053, 104, ADR-010)
2. Layout and components per UX §1–§4, §6–§12: tokens (Tailwind `@theme` matching `@vo/shared` palette), top
   bar (all 10 elements), metrics (8 tiles, filter-aware), office card around the lazy `OfficeCanvas` per API-C
   §10.2 (sizing formula, `role="img"` summary, placeholder, < 768 px gating, tooltip from `OfficeHoverInfo`),
   roster, detail panel (fields, ticking duration, 5 tabs: Activity real + Load older, Tasks real, Logs derived
   with notice, Files/Git deterministic sample with the exact "Sample data — not connected (Phase 1)" label),
   feed (row anatomy, labels UX §8.3, live behavior, Hide demo, severity filter), simulator dock (fields, 8
   buttons with legality hints, Send Event, validation and feedback copy of UX §9.5), demo switch + DEMO badge +
   toasts, banners and system states of UX §11, responsive modes of UX §2. (REQ-060–064, 080–083, 090–092,
   100–103, 110, 140–144, NFR-005, 012)
3. URL state `?project=` / `?agent=` (`replaceState`; invalid project → All Projects; unknown agent → "Agent not
   found"); routes `/` and a NotFound page. (REQ-061, 083)
4. All producer text rendered as plain text (no `dangerouslySetInnerHTML`). Accessibility per UX §14 (landmarks,
   focus management, `Esc` layering, live regions, labels, reduced motion). (REQ-092, 163, NFR-006)
5. Times local 24 h per UX §15 via one formatting module; durations use the snapshot `serverTime` offset. (NFR-011)
Required tests: reducer (version gating, dedupe, cap, hydrate replace, demo state, no-op `event: null`
responses); sync orchestration with a fake socket (buffer during snapshot fetch, replay, `syncGeneration`);
N reconnects → exactly one handler per message (one feed row per event); selectors (metrics All and Sellway
with the API-C §7.2 baseline, roster ordering/dimming, "No agents on <P>", feed predicate); project selector
↔ URL; detail panel (every field, `—` nulls, ticking duration with fake timers, tabs, exact notices, Activity
empty/error/retry/Load older/"Beginning of activity", Agent not found, Esc + focus return); feed (literal
rendering of `<img src=x onerror=alert(1)>`, DEMO tag, severity icon/text, empty states, new-events pill);
simulator (exact PATCH/POST payloads incl. `source:"simulator"`, empty action → no request, 409 message
verbatim + "Allowed from" hint, same-status feedback, pending disables all buttons, failure leaves store
unchanged, backend unavailable disables); demo toggle (start/stop calls, reflects `demo:state`, toast counts);
top bar pills (system/connection rules); palette CSS ↔ shared test. API and `OfficeCanvas` mocked.
Gate: code-reviewer; UX conformance spot-check by ui-ux-designer is OPTIONAL (PM decision).

## TASK-007 — Phaser virtual office (`apps/web/src/office/**`)
Owner: frontend-engineer (instance B)
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W2 (parallel with TASK-006)
Status log:
- 2026-10-04 frontend-engineer (B): implemented `apps/web/src/office/**` (OfficeCanvas, gameManager, bridge, runtime,
  OfficeScene, objects/AgentDesk, visuals, palette, textures, officeLayout + 6 test files, 1118 tests green). Office
  eslint/prettier/web typecheck green. Real-browser check via a scratchpad harness (not in repo) at the UX §2.2 canvas
  sizes for 1366/1440/1920/2560: render, hover rect, select, background click, filter dimming, completed pop, compact
  LOD, reduced motion, unmount/remount = 1 canvas, no console errors. Deviations: `layout.ts` named `officeLayout.ts`
  (the §10.1 lint regex flags `../layout` from `objects/`); vector art instead of baked textures; DPR backing store
  not done (ADR-012 RESIZE baseline). Integrated check with the shell still due in QA (AC 7). → code-reviewer.
Objective: Implement the professional Phaser 3 office behind the contracted `OfficeCanvas` props seam:
single game instance, rooms, desks, characters, status visuals and animations, dimming, selection, hover.
Context: UX §1.2, §1.4, §1.6, §5; API-C §6.3–6.4, §10.2; ARCHITECTURE §7; ADR-012, 025; REQ-070–075, 062
(dimming), 163; NFR-002, 006; risks R-3, R-4, R-5.
Dependencies: TASK-002
Files/modules affected: `apps/web/src/office/**` only — takes over the stub `OfficeCanvas.tsx`; creates
`gameManager.ts`, `bridge.ts`, `OfficeScene.ts`, `objects/AgentDesk.ts`, `visuals.ts`, `palette.ts`,
`textures.ts`, `layout.ts` (thin adapter over shared `OFFICE_ROOMS`, no copied numbers), colocated tests.
Acceptance criteria:
1. `OfficeCanvas` default export with exactly the API-C §10.2 props; renders one full-size `div`; lazy-load
   friendly (no Phaser import outside `office/`). (ADR-025)
2. `gameManager`: at most one `Phaser.Game` per page; StrictMode mount→unmount→mount reuses it; real unmount
   destroys it; props updates never re-create the scene. (REQ-072, 075, R-3)
3. Scene per UX §5.2–5.6: 8 labeled rooms from `OFFICE_ROOMS`, 15 workstations placed by `deskId`, name label =
   `shortRole`, status chip (full/compact LOD), status visuals and animations exactly per UX §5.4 table
   (loops created/destroyed per status, `completed` emphasis only on live transitions, offline gray), hover and
   selection plates, dimming alpha .40 (.25 offline) for `projectFilter`, room "N active" counts, reduced
   motion variants, `paused` → `tweens.pauseAll()`. Colors only from `@vo/shared` palette. (REQ-070, 071, 073,
   062, 074, NFR-006)
4. Scaling: `Scale.RESIZE`, `zoom = min(w/1140, h/540, 1.6)`, centered, crisp text (`setResolution`), no
   distortion on resize; `onAgentHover(null)` on resize/zoom change. (REQ-075, R-4)
5. Interaction: slot hit areas → `onAgentSelect(id)`; hover → `onAgentHover` with the slot rect in CSS px
   relative to the root `div`; empty floor → `onBackgroundClick()`. All text set as plain strings. (REQ-073, 163)
6. No network/CDN assets; all art generated in code. (REQ-074, NFR-010)
7. Visual check in a real browser at 1366, 1440, 1920 and 2560 px widths once TASK-006/TASK-008 are integrated
   (performed in the QA round if not possible earlier; findings route back to this task).
Required tests (Phaser mocked in jsdom): `visuals.ts` for every status × {dimmed, selected, recentlyCompleted,
reducedMotion, lod}; layout adapter resolves every seed `deskId` and handles an unknown `deskId` without
crashing; single-instance test across mount/unmount/mount and destroy on real unmount; bridge diff (same
`version` → no desk update; new version → one update); completed emphasis triggered only by a live
transition, not on first render; palette hex → number conversion; `OfficeCanvas` mounts/unmounts the game and
forwards callbacks.
Gate: code-reviewer.

## TASK-008 — Server application: EventService, Tasks/Demo/Snapshot services, REST API, Socket.IO, boot
Owner: backend-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W3 (alone)
Status log:
- 2026-10-04 backend-engineer: implemented services (event/task/demo/snapshot/projectResolver), all API-C §3
  routes, middleware (host guard, JSON-only writes, error envelope, JSON 404), Socket.IO server, static one-port
  mode, `app.ts`, `index.ts` (exported `boot()` + signal handling), `test/helpers/testApp.ts`. 9 new test files
  under `apps/server/test/**` (Supertest, socket.io-client on an ephemeral port, demo restore, boot/crash
  recovery on temp-file DBs, static serving, seed-history replay through `decideEvent`). Server workspace:
  593 tests green, eslint/prettier/typecheck clean; repo-wide verify steps green. Live run of `npm run dev:server`
  (PORT=4100, because 4000 was held by another agent's mock server) checked health/agents/POST events/socket/demo,
  then stopped. → code-reviewer.
- 2026-10-04 backend-engineer: review round 1 (VO-000-review, ADR-035) fixed — CR-1 socket Origin rule, CR-2 listen-first
  boot + readiness gate, CR-4 snapshot `lastSeq`, CR-6 snapshot task selection, CR-8 SIGHUP/SIGBREAK/IPC disconnect,
  CR-9 restore keeps referenced demo tasks; API-C §1.5/§2.2/§3.1/§3.11/§3.14/§4/§9.3/§9.8 updated (ADR-035, v1.1).
  Server: 31 files / 639 tests green, eslint/prettier/typecheck clean; CR-1/CR-2 tests mutation-checked. Status stays
  REVIEW → code-reviewer re-run.
- 2026-10-04 backend-engineer: ADR-037 fixes — SEC-2 Origin rule on /api writes (403 ORIGIN_NOT_ALLOWED, new shared code),
  SEC-3 `inflate:false` + decompression/4xx errors never 500, SEC-4 shared `taskIdSchema` rejects reserved ids,
  SEC-5 X-Frame-Options/CSP frame-ancestors on every response, SEC-6/QA-2 engine.io refusal format documented,
  QA-3 singular/plural demo summary. API-C v1.2 (*ADR-037*). shared 864 / server 678 tests green.
- 2026-10-04 backend-engineer: CR-19 — no-store/nosniff on Host/Origin-guard 403s (app-level `/api` headers + every
  error envelope); API-C §0 wording (framing headers on every Express response). Server 687 tests green.
- 2026-10-04 backend-engineer: QA-4 — app-level JSON 404 for unmatched non-/api paths keeps framing/security headers
  (no Express finalhandler page). Server 689 tests green.
Objective: Assemble the runnable server on top of the repositories and pure rules: every endpoint, the single
commit-and-broadcast path, Socket.IO, demo engine with persisted snapshot/restore, boot and graceful shutdown,
with the full integration test suite.
Context: API-C §0, §2, §3, §4, §9.6, §9.8, §11; ES §6–§8; ARCHITECTURE §4, §9; ADR-008–011, 013, 015, 019,
020, 021, 022, 024, 027; REQ-002, 004, 020–029, 040–042, 050–053, 110–113, 150, 151, 160–164; NFR-001, 003, 004.
Dependencies: TASK-003, TASK-005 (and TASK-002)
Files/modules affected: `apps/server/src/services/{eventService,taskService,demoService,snapshotService,projectResolver}.ts`,
`apps/server/src/realtime/socketServer.ts`, `apps/server/src/api/**` (`router.ts`, `routes/*.ts`,
`middleware/{hostGuard,requireJson,errorHandler,notFound}.ts`, `static.ts`), `apps/server/src/app.ts`,
`apps/server/src/index.ts` (takes over the stub), `apps/server/test/**` except `test/smoke/**`. Nothing in
`db/`, `seed/` or the TASK-005 files (report needed changes).
Acceptance criteria:
1. Every endpoint of API-C §3 with exact schemas, status codes, envelopes, check order, messages and headers
   (§0); `/api/*` unknown → JSON 404; JSON-only writes, 100 KB limit, host guard (HTTP + Socket.IO), CORS
   allowlist. (REQ-002, 004, 020–028, 040, 041, 110, 161, 162, NFR-004)
2. One `commitAndBroadcast` path: synchronous transaction, broadcast strictly after commit, response = socket
   payload; REQ-029 guarantee for every rejection; DB failure → 500, nothing broadcast. (REQ-022, 029, ADR-008)
3. Socket.IO per API-C §4 (no client handlers, `onAny` debug log, connection logs). (REQ-050, 051)
4. Demo per ADR-011/API-C §3.12–3.14, §9.6: timer chaining, beats through `EventService.ingest` with
   `origin: 'internal'`, rejections logged, restore rules, `office:resync`, idempotent start/stop, shutdown and
   boot recovery. (REQ-110–113)
5. Boot/shutdown per API-C §9.8; `SERVE_WEB`/`--serve-web` serves `apps/web/dist` with SPA fallback for
   non-`/api`, non-`/socket.io` GETs; missing dist → warn. Structured logs per API-C §9.3, no payloads, quiet
   successful GETs. (REQ-053, 150, 151, ADR-013, NFR-003)
6. `createServerApp` and `test/helpers/testApp.ts` per API-C §9.8.
Required tests (`apps/server/test/**`, Supertest + socket.io-client): every endpoint happy path; every error
code each endpoint can return (incl. 413, `INVALID_JSON` for content-type and parse, 403 host guard, 404
route); a reusable REQ-029 assertion (row counts, entity deep-equality, recorder empty) applied to every
rejection case; the §12 example (REQ-022) and REQ-191 API steps (idle → working, back to idle, POST again);
PATCH agent status no-op + parity with the equivalent POST; events filters, feed predicate, paging
(`nextBefore`, `before`); tasks: generated `SW-126`, `TASK_EXISTS`, blockedBy rules, ADR-024 auto-status and
no-op, terminal progress 409, force reopen + `forced_transition` log; snapshot shape/consistency; health 200 and
503; socket: payload received equals response `data`, none after a rejection or no-op, client-emitted message
changes nothing, two clients both receive; demo: start/tick/stop with short intervals or fake timers, user event
during demo keeps that agent/task, untouched restored with `version` +1, demo tasks deleted, user tasks kept,
`office:resync` sent, idempotency, crash recovery on a temp-file DB (start, close without stop, re-boot →
restored, inactive), graceful shutdown restores; restart persistence on a file DB without reseeding; static
serving with a temp dist dir; `event_rejected` log has no payload.
Gate: code-reviewer → qa-engineer → security-engineer.

## TASK-009 — Build verification, live smoke run and deployment notes
Owner: devops-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W4 (parallel with TASK-010)
Status log:
- 2026-10-04 devops-engineer: `scripts/smoke-live.mjs` + `npm run smoke`, `docs/DEPLOYMENT.md`; also ADR-037 SEC-1
  (`server.cors`/`preview.cors: false`) and SEC-5 Vite part (X-Frame-Options + frame-ancestors) in
  `apps/web/vite.config.ts`, launcher IPC stop (ADR-036 §7). Results: `npm run verify` green (2 859 tests), `npm run
  smoke` 27/27 twice in a row, `npm run smoke -- --dev` 35/35 (proxy, socket via proxy, SEC-1/SEC-5 live),
  `npm run build && npm start` one-port check on :4000 (web + API + socket) passed. Temp DBs only; `data/office.db`
  untouched. → code-reviewer.
Objective: Prove the integrated system builds and runs locally in both modes, automate the §32 checks that can
be automated, and document local run/build/reset.
Context: ORIGINAL_REQUEST §32; API-C §11, §12; ADR-013; REQ-053, 171, 190, 191; NFR-001, 003, 010.
Dependencies: TASK-006, TASK-007, TASK-008
Files/modules affected: `scripts/smoke-live.mjs` (new), root `package.json` (add `"smoke": "node scripts/smoke-live.mjs"`),
`docs/DEPLOYMENT.md` (new). Nothing else (defects found → reported to the PM for routing).
Acceptance criteria:
1. From a clean state: `npm ci` (or `npm install`), `npm run verify` green; results recorded. (REQ-171, 190)
2. `scripts/smoke-live.mjs`: builds if needed, starts the server in one-port mode on a free port with a temp
   `DB_PATH` (env passed via `spawn` options, not shell syntax), waits for `/api/health`, checks
   `GET /api/agents` (15), `POST /api/events` with the §12 example (201 + effects), a socket.io-client receives
   the matching `office:event`, `GET /` serves `index.html`; stops the server gracefully (Windows-safe), restarts
   it on the same DB and verifies persistence and no duplicate seed; removes the temp dir; exits non-zero on any
   failure. (REQ-053, 190)
3. Dev mode check: `npm run dev` → `http://localhost:5173/api/health` works through the proxy and the socket
   connects through the proxy. (REQ-171)
4. `docs/DEPLOYMENT.md`: local-only run modes (dev, one-port start), ports/URLs, env vars, build, `db:reset`,
   data location, troubleshooting (port in use, `::1` vs `127.0.0.1`, ExperimentalWarning), explicit "no cloud
   deployment in Phase 1". (REQ-180 support)
Required tests: `npm run smoke` passes twice in a row; output attached to the report.
Gate: code-reviewer; feeds the QA §32 checklist.

## TASK-010 — Documentation: README, ROADMAP, PROJECT, doc alignment
Owner: documentation-engineer
Status: DONE (all gates PASS — review r5, QA r3, security r2, audit r2; 2026-10-04)
Wave: W4 (ROADMAP may start in W1)
Status log:
- 2026-10-04 documentation-engineer: `README.md` and `docs/ROADMAP.md` created; `docs/PROJECT.md` updated;
  `docs/ARCHITECTURE.md`, `docs/EVENT_SYSTEM.md`, `docs/AGENT_STATE_MACHINE.md` aligned with the code and
  ADR-021…037 (edits marked "TASK-010"). Commands run on Windows: `npm run verify` (all 5 steps PASS), `npm run
  smoke` (27/27), `npm run dev` / `dev:server` / `dev:web` (health direct + through the proxy), `npm start` on
  PORT 4100 with a temp DB (web + API), §12 curl/Invoke-RestMethod examples (201, effects as documented),
  409/403/400 cases, demo start/stop, `db:reset` (temp DB in `data/`, removed; `:memory:` refused). `data/office.db`
  untouched. Report: `tasks/reports/TASK-010-documentation.md`. → code-reviewer (docs).
Objective: Produce the owner-required documentation and make every doc match the implemented behavior.
Context: ORIGINAL_REQUEST §28, §29, §33; REQ-180, 181, 182; ADR-021, 022, 025, 027 (wording changes needed
in ARCHITECTURE.md §6 and EVENT_SYSTEM.md §6/§8.1: responses are `{ data: … }`).
Dependencies: TASK-006, TASK-007, TASK-008 (ROADMAP: TASK-001)
Files/modules affected: `README.md` (new), `docs/ROADMAP.md` (new), `docs/PROJECT.md`, wording-only alignment
edits in `docs/ARCHITECTURE.md` and `docs/EVENT_SYSTEM.md` (each edit noted in a change-log line; no design
changes — design questions go to the PM).
Acceptance criteria:
1. README per REQ-180: requirements (Node ≥ 22.13, tested on 24.12; npm), install, dev (server, web, both),
   one-port start, local URLs (web 5173, API 4000), how the simulator works, how events work (curl example of
   `POST /api/events` with the §12 payload and the `Content-Type` header), demo mode, seed/reset, tests/verify,
   monitoring-only and local-only limitations, Phase 1 integration status (link INTEGRATIONS.md). (REQ-180)
2. `docs/ROADMAP.md` lists Phases 1–10 exactly as §29 with short goals; Phase 2 references BACKLOG items. (REQ-181)
3. Docs ↔ code consistency check (endpoints, event types, transitions, scripts, env vars) with a findings list;
   every mismatch fixed in docs or reported as a code defect. (REQ-182)
Required tests: every README command executed once on Windows (PowerShell) and the outcome noted in the
report; links resolve.
Gate: code-reviewer (docs) → product-auditor uses it.
