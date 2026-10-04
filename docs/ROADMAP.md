# ROADMAP — AI Virtual Office

Owner: documentation-engineer · Task: TASK-010 · Date: 2026-10-04
Source: `ORIGINAL_REQUEST.md` §29 (phase list, binding), §1 (long-term product), §34 (target flow).
Deferred items: `tasks/BACKLOG.md` (BL-NNN). Security prerequisites: `docs/SECURITY.md` §6.

The long-term target is the flow from §34. The owner (via Telegram or the web) talks to the PM /
Orchestrator. The PM directs the 15 agents. The agents work through Claude Code, terminals, GitHub,
browsers and APIs. Everything they do flows through one event system into the Virtual Office for
real-time monitoring and, later, control. Phase 1 built the monitoring end of that flow. Each later phase
connects one more piece.

Phases 2–10 below are plans, not commitments: goals and prerequisites, no dates. Each phase starts with
its own requirements, architecture and ADRs.

| Phase | Name (§29) | Status |
|---|---|---|
| 1 | Virtual Office Monitoring MVP | **Done** (gates in `tasks/reports/`) |
| 2 | Claude Code event integration | Next |
| 3 | Agent-to-agent task handoff | Planned |
| 4 | Telegram Control Center | Planned |
| 5 | GitHub monitoring | Planned |
| 6 | Terminal/browser activity monitoring | Planned |
| 7 | Remote agent control | Planned |
| 8 | Authentication and teams | Planned |
| 9 | Cloud deployment | Planned |
| 10 | Multi-company SaaS | Planned |

---

## Phase 1 — Virtual Office Monitoring MVP

**Status: done.** Monitoring only, local only, no real integrations.

Delivered:
- npm-workspaces monorepo: `apps/server`, `apps/web`, `packages/shared` (`@vo/shared`: types, Zod schemas,
  state machines, constants, reference data, adapters).
- Server: Express 5, Socket.IO 4 and SQLite through `node:sqlite`, with migrations and repositories. It
  binds `127.0.0.1` and follows a listen-first boot. Graceful shutdown restores an active demo.
- 15 seeded agents, 4 projects (+ "All Projects" filter), 11 tasks, 44 historical events. Seeding runs only
  on an empty DB; `npm run db:reset` resets it.
- Agent state machine (43 legal / 13 illegal transitions) and task state machine, enforced by the server
  and used by the UI for hints only (`AGENT_STATE_MACHINE.md`).
- Producer-agnostic event pipeline `POST /api/events`: validate → store → update agent/task → broadcast,
  in one transaction (`EVENT_SYSTEM.md`). REST API for health, projects, agents, agent status, events,
  tasks, snapshot and demo, with a `{ data }` envelope and stable error codes (`API_CONTRACTS.md`).
- Real-time sync: `office:event` / `demo:state` / `office:resync`, snapshot resync with a `lastSeq`
  watermark, and deduplication by id and `version`.
- Web UI: top bar, project filter, 8 metrics, a Phaser 3 office with 8 rooms and status animations, the
  agent roster, the detail panel (Activity/Tasks from stored data, Logs derived from events, Files/Git
  sample data), the live feed, and loading/empty/error/disconnected states.
- Developer Simulator (status buttons → `PATCH /api/agents/:id/status`; Send Activity →
  `POST /api/events`) and server-side Demo Mode with snapshot/restore that keeps user changes.
- Local-only security baseline: Host guard, CORS allowlist, Origin rule on writes and sockets, JSON-only
  writes, size limits, framing headers. No shell, file or code-execution API (`SECURITY.md`).
- Pure, unwired Claude Code adapter for the §19 example format: **UNVERIFIED** format, adapter tested
  with mocks only (`INTEGRATIONS.md`).
- Tooling: ESLint (with architecture import boundaries), Prettier, Vitest/Supertest/socket.io-client/Testing
  Library tests, `npm run verify`, `npm run smoke`, dev launcher `scripts/dev.mjs`.

Known limitations carried forward: see README "Known limitations" and `SECURITY.md` §5.

---

## Phase 2 — Claude Code event integration

**Goal.** Real Claude Code sessions of the 15 agents report what they do (tool use, commands, file edits,
tests, errors). The office shows that live, through the existing pipeline and with no Claude-specific
code in the core.

Scope:
- `POST /api/ingest/:source` with the adapter registry `PRODUCER_ADAPTERS`. Each mapped event goes
  through `EventService.ingest` like `POST /api/events` (BL-008, ADR-007).
- Capture real Claude Code hook output and verify the adapter against it, then move the integration from
  UNVERIFIED to VERIFIED (`INTEGRATIONS.md` §3.8). Add mappings for session start/end and errors.
- Decide on "accept and flag" for out-of-order states from real producers (BL-009, REQUIREMENTS Q-2).
- Optional producer idempotency key for retried hooks (BL-005).
- Real Logs tab content from captured activity, replacing the "derived from stored events" notice.

Prerequisites (must be done first, `SECURITY.md` §6):
- Event retention cap with a tested prune (BL-001, ADR-014).
- Producer token for `POST /api/events` and `/api/ingest/:source` (BL-007, part 1).
- Per-source ingest rate limit with a `429` envelope (BL-007).
- Redaction rules for secrets and tokens in captured commands before they are stored.
- Keep the ADR-037 controls (no Vite CORS layer, Origin rule on writes).

## Phase 3 — Agent-to-agent task handoff

**Goal.** Make the hand-offs between agents visible and traceable, e.g. PM → Architect → Backend → QA →
Reviewer → Auditor: who passed which task to whom, what blocks what, and where work is waiting.

Scope: handoff/dependency events built on `blockedBy` and `agent.task.assigned`; a task detail view and
clickable task rows (BL-016); handoff timelines in the detail panel and feed; waiting-on-whom indicators
in the office.

Prerequisites: Phase 2 (real producers emit task lifecycle events); a requirements pass on the handoff
model.

## Phase 4 — Telegram Control Center

**Goal.** The owner follows the office from Telegram (notifications, status summaries, failures) and
sends notes and, later, commands to the PM / Orchestrator.

Scope: a Telegram bot as an event producer (operator notes → `agent.message`) and notification consumer
(failures, completions, waiting agents). Commands go over a **separate, authenticated command channel**.
They never travel on the event socket, which stays server → client only (ARCHITECTURE §13).

Prerequisites: an authenticated command channel with an audit trail; bot credentials from the
environment or a secret store (never in code); producer authentication (BL-007). Full remote control is
Phase 7.

## Phase 5 — GitHub monitoring

**Goal.** Show repository activity next to agent activity: branches, commits, pull requests, reviews and
CI runs per project and agent.

Scope: GitHub / GitHub Actions adapter (workflow runs → `agent.activity` `build`/`test`, failures →
`system.error` or `agent.task.failed`, EVENT_SYSTEM §10.2). The real **Git** tab replaces the Phase 1
sample data.

Prerequisites: webhook signature verification or a token-scoped poller; producer authentication;
retention (BL-001). Integration status starts as UNVERIFIED until it is tested against real payloads.

## Phase 6 — Terminal/browser activity monitoring

**Goal.** See what agents do in terminals and browsers: commands, test and build runs, pages visited,
with live log streaming.

Scope: terminal and browser-agent adapters; the real **Logs** and **Files** tabs, replacing the Phase 1
derived and sample data; Docker/server monitor events (container down → `agent.disconnected` /
`system.error`).

Prerequisites: strict redaction and size limits for captured output (`SECURITY.md` §6 item 5); retention;
rate limits. Monitoring stays read-only. REQ-160 still applies: the Virtual Office never executes or opens
anything named in an event.

## Phase 7 — Remote agent control

**Goal.** Control agents from the office: assign and reprioritize tasks, pause, resume, retry or stop
agents.

Scope: command API and UI actions (including the simulator-only "force" control, BL-002), with
confirmations, permissions and a full audit log. Commands are delivered to the agent runtimes through the
command channel from Phase 4.

Prerequisites: authentication and authorization for operator actions (at least the core of Phase 8);
audit logging; a threat model review. This phase introduces execution-adjacent capability and needs a
full security gate.

## Phase 8 — Authentication and teams

**Goal.** More than one person can use the office safely: user accounts, teams and roles (viewer,
operator, admin).

Scope: authentication for the UI, REST writes and the Socket.IO handshake; roles and authorization; producer
tokens per producer; rate limiting and brute-force protection (BL-007); optional Socket.IO rooms per project
or team (BL-006).

Prerequisites: `SECURITY.md` §6 "before binding anything other than loopback", items 1–2 and 5.

## Phase 9 — Cloud deployment

**Goal.** Run the office as a hosted service instead of only on the owner's machine.

Scope: compiled server build and process manager or container image (BL-011); TLS / reverse proxy, HSTS
and a full CSP (`SECURITY.md` §6 items 3–4); a production database (the repository layer allows swapping
SQLite for Postgres); scheduled backups and a retention policy; CI running `npm ci && npm run verify &&
npm run smoke`; deployment and rollback runbooks in `DEPLOYMENT.md`.

Prerequisites: Phase 8 authentication; owner approval for any deployment (Phase 1 rule: no deploys).

## Phase 10 — Multi-company SaaS

**Goal.** Several companies use the product, each with its own agents, projects and data, fully
isolated.

Scope: a tenant id on every table and query; tenant-scoped Socket.IO rooms (BL-006); per-tenant producer
credentials, quotas and rate limits; billing and onboarding; data export and deletion.

Prerequisites: Phases 8–9; tenant-isolation tests and a security review of every query path.
