# AI Virtual Office MVP

Updated 2026-10-04 (TASK-010). How to install and run: `../README.md`.

## Vision

A real-time "AI Operations Center": a professional virtual office where the owner sees all 15 AI
agents of the team — who is working, planning, waiting, reviewing, failed or offline, on which
project and task, with progress and activity history. Phase 1 builds the monitoring foundation and a
producer-agnostic event system so that real producers (Claude Code, Telegram, GitHub, CI/CD,
terminals, browser agents) can be connected later, followed by remote control (see `ROADMAP.md`).

## Users

- **Owner / Operator** — single local user; monitors agents, filters by project, inspects agent
  details, drives the Developer Simulator and Demo Mode.
- **Event producers** — any HTTP client posting to `POST /api/events` (today: simulator, demo
  engine, scripts; later: real agents and tools).

## Status

Phase 1 (VO-000) is implemented. Gates so far, reports in `../tasks/reports/`: code review **PASS**, QA
**PASS**, security **PASS**. Documentation (TASK-010) is in review; the product audit is still open. Live
state of the work: `../tasks/ACTIVE.md`. Nothing has been committed, pushed or deployed.

| Feature (Phase 1 scope) | Status |
|---|---|
| 15 seeded agents, 4 projects (+ virtual "All Projects" filter), 11 tasks, 44 historical events | Done |
| Agent and task state machines enforced by the backend | Done |
| Event pipeline: validate → store (SQLite) → update agent/task state → Socket.IO broadcast | Done |
| REST API: health, projects, agents, agent status, events, tasks, snapshot, demo | Done |
| Web UI: top bar, project filter, metrics, Phaser 3 office, roster, detail panel, live feed, connection/loading/empty/error states | Done |
| Detail panel tabs: Activity, Tasks (stored data); Logs (derived from stored events) | Done |
| Detail panel tabs: Files, Git | Sample data, labelled (by design in Phase 1) |
| Developer Simulator and Demo Mode, both through the backend pipeline | Done |
| Local-only security baseline (Host guard, CORS, Origin rule, JSON-only writes, limits, framing headers) | Done |
| Claude Code adapter for the §19 example format | Pure function, MOCKED tests only; format UNVERIFIED; not wired (`INTEGRATIONS.md`) |
| Event retention, rate limiting, producer auth | Deferred: BL-001, BL-007 (required before Phase 2 producers) |
| Lint, typecheck, tests, build (`npm run verify`), live smoke (`npm run smoke`) | Green on 2026-10-04 |

Out of scope for Phase 1: commands/remote control, real Claude/Telegram/GitHub/Docker/CI integrations,
auth, deployment, commits/pushes. Roadmap: `ROADMAP.md`. Deferred work: `../tasks/BACKLOG.md`.

## Documents

| Document | Owner | Content |
|---|---|---|
| `../README.md` | documentation-engineer | Install, run, scripts, simulator, demo, events, limitations |
| `ORIGINAL_REQUEST.md` | PM | Owner's verbatim request (binding) |
| `PM_BRIEF.md` | PM | PM hard rules and technical constraints |
| `REQUIREMENTS.md` | product-analyst | User stories, acceptance criteria, NFRs, assumptions |
| `ARCHITECTURE.md` | architect | Components, data flow, data model, stack, cross-cutting concerns |
| `DECISIONS.md` | architect / tech-lead | ADR-001…037 |
| `UX.md` | ui-ux-designer | Screens, states, accessibility |
| `API_CONTRACTS.md` | tech-lead | Exact REST and Socket.IO contracts (v1.2) |
| `EVENT_SYSTEM.md` | architect | Event envelope, types, effects, pipeline, real-time delivery, adapters |
| `AGENT_STATE_MACHINE.md` | architect | Agent and task state machines |
| `IMPLEMENTATION_PLAN.md` | tech-lead | Plan, dependencies, phases, risks |
| `ROADMAP.md` | documentation-engineer | Phases 1–10 |
| `INTEGRATIONS.md` | integration-engineer | Integration status |
| `SECURITY.md` | security-engineer | Threat model, controls, accepted risks, Phase 2 prerequisites |
| `DEPLOYMENT.md` | devops-engineer | Run modes, ports, configuration, data/reset/backup, troubleshooting |

Tasks: `../tasks/ACTIVE.md`, `../tasks/BACKLOG.md`. Gate reports: `../tasks/reports/`.
