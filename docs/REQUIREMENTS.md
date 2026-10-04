# REQUIREMENTS — AI Virtual Office MVP (Phase 1)

Owner: product-analyst · Task: VO-000 · Date: 2026-10-03 · Status: BASELINE v1.2.1
Change log: v1.2.1 (2026-10-04, product-analyst; DOC-5 / QA note) — REQ-191(a) corrected: Active Tasks stays
unchanged when seeded `assigned` SW-123 moves to `in_progress` (both active, A-06). Marked *(v1.2.1)*.
v1.2 (2026-10-03, product-analyst + PM) — aligned with `docs/API_CONTRACTS.md` and
ADR-021…028: `{data}` success envelope (REQ-025), PATCH status `source`/`action` + `event:null` no-op
(REQ-004), Tasks API create/assignee rules (REQ-040/041, ADR-024), 403 `HOST_NOT_ALLOWED` and
Content-Type rule (§3.5, REQ-161), rate limiting deferred (A-15); PM decisions on connection states
(REQ-052) and Logs tab (REQ-082). Changed text is marked *(v1.2)*. Business meaning unchanged.
v1.1 (2026-10-03, architect) — agent table §3.3 and task table §3.4 revised (ADR-016);
coupling rules in REQ-003/021/042 clarified, `PROJECT_MISMATCH` added (ADR-017); `force` on operator
PATCH endpoints (ADR-015); server-only `task.*` event types, reserved sources, `seq` cursor (ADR-005);
snapshot + demo endpoints (ADR-010/011). Changed text is marked *(v1.1)*.
Sources (binding): `docs/ORIGINAL_REQUEST.md` (cited as §N), `docs/PM_BRIEF.md` (cited as PM-N).

Conventions: "MUST" = required for Phase 1 DONE. "Rejected" = 4xx JSON error, **nothing is stored,
no agent/task state changes, nothing is broadcast** (see REQ-029). IDs are grouped in ranges per area
with gaps for future additions. Architecture choices are out of this document's scope; where a
business rule needs a concrete value, a baseline is given and the architect may refine it only by
updating this file and `docs/DECISIONS.md`.

---

## 1. Goal

Give the owner a real-time, local, monitoring-only "AI Operations Center" in which all 15 AI agents
are visible in a professional virtual office with their status, project, task, progress and
activity — driven by a producer-agnostic backend event pipeline, so that real producers (Claude
Code, CI, Telegram, …) can be connected in later phases without redesign.

## 2. Users / roles

| Role | Phase 1 capabilities |
|---|---|
| **Owner / Operator** (single local user, no login) | Views dashboard, office, metrics, feed; filters by project; opens agent details; uses Developer Simulator; toggles Demo Mode; creates/updates tasks via API/UI where provided. |
| **Event producer** (any HTTP client: simulator, demo engine, curl/scripts today; Claude Code, GitHub Actions, Telegram, Docker, CI/CD, monitors later) | Sends events to `POST /api/events`; reads state via GET endpoints. Identified only by the `source` field — no authentication in Phase 1 (local only, see REQ-161). |
| **Live viewer** (browser tab) | Receives server→client Socket.IO broadcasts. Cannot change state over the socket. |

## 3. Reference data (business baseline)

### 3.1 Agents (§2, §7) — exactly 15

| id | code | name | shortRole | department / roomId |
|---|---|---|---|---|
| `01-pm-orchestrator` | PM | PM / Orchestrator | PM | Management / `management` |
| `02-product-analyst` | PA | Product Analyst | Analyst | Management / `management` |
| `03-architect` | ARC | Architect | Architect | Management / `management` |
| `04-backend-engineer` | BE | Backend Engineer | Backend | Development / `development` |
| `05-frontend-engineer` | FE | Frontend Engineer | Frontend | Development / `development` |
| `06-database-engineer` | DBE | Database Engineer | Database | Development / `development` |
| `07-devops-engineer` | OPS | DevOps Engineer | DevOps | Infrastructure / `infrastructure` |
| `08-security-engineer` | SEC | Security Engineer | Security | Infrastructure / `infrastructure` |
| `09-qa-engineer` | QA | QA Engineer | QA | Quality / `quality` |
| `10-ui-ux-designer` | UX | UI/UX Designer | UI/UX | Design / `design` |
| `11-mobile-engineer` | MOB | Mobile Engineer | Mobile | Development / `development` |
| `12-ai-engineer` | AIE | AI Engineer | AI | AI Lab / `ai-lab` |
| `13-documentation-engineer` | DOC | Documentation Engineer | Docs | Documentation / `documentation` |
| `14-reviewer` | REV | Reviewer | Reviewer | Quality / `quality` |
| `15-product-auditor` | AUD | Product Auditor | Auditor | Audit / `audit` |

`deskId` = `<roomId>-<n>` (unique). `avatar` = generated, non-copyrighted (initials/geometric/sprite
key). `name` is the role title (no fictional persona names) — assumption A-03.

### 3.2 Projects (§6, §17, PM-8)

Stored projects (4): `sellway` "Sellway" (task prefix `SW`), `ishkun24` "Ishkun24" (`IK`),
`erp` "ERP" (`ERP`), `ana-market` "Ana Market" (`AM`). **"All Projects" is a virtual "no filter"
option in the selector, not a stored project** (assumption A-01). Wherever an API accepts `project`,
it accepts the project id or its exact name (case-insensitive) and stores the id.

### 3.3 Agent statuses (§3) and state machine baseline

`idle, planning, working, waiting, reviewing, completed, failed, offline`. Active statuses =
`planning, working, waiting, reviewing`.

| from \ to | idle | planning | working | waiting | reviewing | completed | failed | offline |
|---|---|---|---|---|---|---|---|---|
| idle | – | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ | ✔ |
| planning | ✔ | – | ✔ | ✔ | ✘ | ✘ | ✔ | ✔ |
| working | ✔ | ✘ | – | ✔ | ✔ | ✔ | ✔ | ✔ |
| waiting | ✔ | ✔ | ✔ | – | ✔ | ✘ | ✔ | ✔ |
| reviewing | ✔ | ✘ | ✔ | ✔ | – | ✔ | ✔ | ✔ |
| completed | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| failed | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | – | ✔ |
| offline | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | – |

All 9 owner examples (§3) are legal. `idle → working` is legal because §32 verifies it directly.
*(v1.1, ADR-016)* Added `idle/completed → waiting|reviewing|failed` and `failed → waiting|reviewing` so that
Reviewer/Auditor can start reviewing, an agent with a blocked task can wait, and an assigned-but-unstarted
task can fail. The table now follows six rules (any → offline, offline → idle only; any online → idle; resting
`idle/completed/failed` → any active; directed flow between active statuses; `completed` only from
`working`/`reviewing`; `failed` from any online status) — 43 legal, 13 illegal, see
`docs/AGENT_STATE_MACHINE.md`.
Same-status ("X → X") is not a transition: accepted as a no-op for status (other fields may update).

### 3.4 Task model (§14) and task state machine baseline

Fields: `id, title, description, project, assignedAgentId, status, priority, progress, createdAt,
startedAt, completedAt, blockedBy, metadata`. Statuses: `todo, assigned, planning, in_progress,
waiting, review, completed, failed, cancelled`. Priorities: `low, normal, high, critical`.
"Active task" = status in `assigned, planning, in_progress, waiting, review` (assumption A-06).

| from | legal targets |
|---|---|
| todo | assigned, planning, in_progress, cancelled |
| assigned | todo, planning, in_progress, waiting, review *(v1.1)*, failed, cancelled |
| planning | in_progress, waiting, failed, cancelled |
| in_progress | waiting, review, completed, failed, cancelled |
| waiting | planning, in_progress, review, failed, cancelled |
| review | in_progress, waiting, completed, failed, cancelled |
| failed | assigned, planning, in_progress, waiting *(v1.1)*, review *(v1.1)*, cancelled |
| completed, cancelled | none (terminal; only operator `force`, ADR-015) |

*(v1.1, ADR-017)* Implicit assignment: a `todo` task that is (or becomes in the same operation) assigned is
validated as if it were `assigned`. With these additions an agent transition is legal iff the mirrored
task transition is legal (property-tested, `docs/AGENT_STATE_MACHINE.md` §6).

### 3.5 Error contract (applies to every endpoint)

Error body: `{ "error": { "code": string, "message": string, "details"?: any } }`. No stack traces.
*(v1.2, ADR-021/023)* Every 2xx body is `{ "data": <payload> }` (paged lists add `page`); error `message`
strings are part of the contract (exact texts: `docs/API_CONTRACTS.md` §2.2).

| HTTP | code | when |
|---|---|---|
| 400 | `INVALID_JSON` | body is not parseable JSON; *(v1.2, ADR-027)* or a POST/PATCH without `Content-Type: application/json` |
| 403 | `HOST_NOT_ALLOWED` *(v1.2, ADR-027)* | HTTP request or Socket.IO handshake whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or the configured `HOST` (DNS-rebinding guard) |
| 400 | `VALIDATION_ERROR` | schema violation (unknown event type, invalid status/priority, missing/extra field, bad types, out-of-range); `details` lists `{path, message}` |
| 404 | `NOT_FOUND` | unknown route |
| 404 | `AGENT_NOT_FOUND` / `TASK_NOT_FOUND` | unknown id in the URL path |
| 409 | `ILLEGAL_TRANSITION` | agent or task transition not allowed; `details: {entity, id, from, to}` |
| 409 | `TASK_EXISTS` | client-supplied task id already exists |
| 422 | `PROJECT_MISMATCH` *(v1.1)* | explicit `project` differs from the referenced existing task's project; `details: {taskId, taskProject, eventProject}` |
| 413 | `PAYLOAD_TOO_LARGE` | body over limit (NFR-004) |
| 422 | `UNKNOWN_AGENT` / `UNKNOWN_PROJECT` / `UNKNOWN_TASK` | body references a non-existent entity (`UNKNOWN_TASK` also for `agent.task.assigned` of a new task without `project`) |
| 500 | `INTERNAL_ERROR` | unexpected/DB failure |
| 503 | `SERVICE_UNAVAILABLE` | health check when the DB is unusable |

---

## 4. User stories and acceptance criteria

### A. Agent model (§2)

**REQ-001** As the owner, I want the 15 agents of §3.1 to exist with the full field set, so that every agent can be monitored.
- Given a freshly seeded DB, When `GET /api/agents`, Then 200 with exactly 15 agents whose ids match §3.1 and each has all §2 fields: `id, code, name, role, shortRole, avatar, department, roomId, deskId, status, currentProject, currentTask, taskId, progress, startedAt, lastActivityAt, currentAction, lastMessage, online, metadata` (nullable fields present as `null`, never missing).
- `code`, `id`, `deskId` are unique; `status` ∈ §3.3; `progress` is an integer 0–100; timestamps are UTC ISO-8601 strings or `null`.

**REQ-002** As the owner, I want to fetch one agent, so that the detail panel shows authoritative data.
- Given `04-backend-engineer` exists, When `GET /api/agents/04-backend-engineer`, Then 200 with that agent.
- When `GET /api/agents/99-nobody`, Then 404 `AGENT_NOT_FOUND`.
- When `GET /api/agents?project=sellway`, Then only agents whose `currentProject` is `sellway`; `?project=unknown` → 422 `UNKNOWN_PROJECT`.

**REQ-003** As the owner, I want agent field side-effects to be consistent, so that the UI never shows contradictory data.
- `status = offline` ⇔ `online = false`. Leaving `offline` (→ `idle`) sets `online = true`.
- Entering `idle` clears `taskId`, `currentTask`, `currentAction`, sets `progress = 0`, keeps `currentProject` (A-05).
- Entering an active status from a non-active status sets `startedAt = now`; moving between active statuses keeps it; entering `idle`/`offline` clears it.
- Entering `completed` with a current task sets `progress = 100`.
- Every accepted agent event sets `lastActivityAt` = server time; an event carrying `project`/`taskId` updates `currentProject` / `taskId` and `currentTask` (task title if the task exists, else the taskId) — except when the resulting status is `idle` or `offline`, and except `agent.task.assigned` without an explicit `status` (assignment alone does not bind the agent to the task) *(v1.1, ADR-017)*.
- *(v1.1)* Entering `offline` clears `startedAt` and `currentAction` and keeps task/project/progress as last-known context. A status change sets `currentAction` to the event's `action` or `null`. Entering `completed`/`failed` keeps `startedAt`. When the bound task changes, agent `progress` = event `progress` ?? task progress ?? 0. Full ordered rules: `docs/AGENT_STATE_MACHINE.md` §4.

**REQ-004** As the owner, I want to change an agent's status by API, so that simple tools can drive state.
- When `PATCH /api/agents/:id/status` with `{status, source?, action?, message?, project?, taskId?, force?}` *(v1.2: `source`, `action`, ADR-022)*, Then it is processed as an `agent.status.changed` event through the same pipeline (stored, state updated, broadcast, PM-7) and returns 200 `{data: {event, agent, task}}` with the stored event and the updated agent/task.
- *(v1.2, ADR-022)* `source` follows the envelope rules of REQ-020/023 (default `"api"`; reserved `demo`/`system` → 400); the Developer Simulator status buttons use this endpoint with `source: "simulator"`. `action` becomes the agent's `currentAction`.
- Invalid status (`"sleeping"`) → 400 `VALIDATION_ERROR`; unknown `:id` → 404 `AGENT_NOT_FOUND`; illegal transition → 409 `ILLEGAL_TRANSITION`; all rejected per REQ-029.
- Same status as current → 200 with `event: null` *(v1.2)*, no state change, nothing stored or broadcast.
- *(v1.1, ADR-015)* `force: true` skips only transition legality (agent and coupled task); the stored event has `forced: true` and a `warn` log is written. `POST /api/events` never accepts `force`.

### B. Status state machine (§3)

**REQ-010** As the owner, I want one shared state-machine definition, so that server, simulator and docs agree.
- The transition table of §3.3 exists once in shared code and is used by the server for enforcement and by the UI for hints; `docs/AGENT_STATE_MACHINE.md` documents every legal and every illegal transition and status meanings (§3).
- Unit tests cover every cell of the 8×8 table (legal → allowed, illegal → rejected).

**REQ-011** As the owner, I want illegal transitions rejected, so that the state stays trustworthy.
- Given Backend Engineer is `idle`, When an event sets status `completed`, Then 409 `ILLEGAL_TRANSITION` with `details {entity:"agent", from:"idle", to:"completed"}`; agent unchanged; nothing stored/broadcast; a structured `warn` log entry is written.
- Given an agent is `offline`, When an event sets `working`, Then 409 (must go `offline → idle` first, e.g. via `agent.connected`).

**REQ-012** As the owner, I want `agent.disconnected` and `agent.connected` to work from any state.
- `agent.disconnected` from any status → `offline`, `online=false`. `agent.connected` on an `offline` agent → `idle`, `online=true`; on an online agent → status unchanged, accepted.

**REQ-013** As the owner, I want task state rules enforced, so that task metrics are trustworthy.
- The task table of §3.4 is shared code with unit tests per row; terminal tasks (`completed`, `cancelled`) reject every transition with 409 `ILLEGAL_TRANSITION` (`entity:"task"`).

### C. Event system and API (§11–13, §25)

**REQ-020** Canonical event envelope. As a producer, I want one documented envelope, so that any system can report activity.
- Fields: `type` (required, one of REQ-021), `source` (string, default `"api"`; simulator `"simulator"`, demo `"demo"`), `agentId`, `project`, `taskId`, `status`, `action`, `message`, `severity` (`info|warning|error`), `progress` (int 0–100), `metadata` (JSON object), `occurredAt` (optional producer ISO time). Server adds `id` (unique), `createdAt` (server UTC), *(v1.1)* `seq` (monotonic integer order/cursor) and `forced` (boolean). Unknown top-level fields → 400 (strict); `metadata` is free-form within size limits (A-08).
- *(v1.1, ADR-005)* Sources `demo` and `system` are reserved for in-process producers and rejected on `POST /api/events` (400). Server-only types `task.created` / `task.updated` (written by the Tasks API) are rejected on `POST /api/events` (400). `status` is not accepted on `agent.connected`, `agent.disconnected`, `system.*` (400).
- `severity` defaults: `system.warning`→warning; `system.error`, `agent.task.failed`, or status `failed`→error; else info.

**REQ-021** Event types and effects. As the owner, I want each event type to have defined effects.

| type | required (besides `type`) | effect (all subject to REQ-011/013) |
|---|---|---|
| `agent.connected` | agentId | REQ-012 |
| `agent.disconnected` | agentId | REQ-012 |
| `agent.status.changed` | agentId, status | status transition + REQ-003 + REQ-042 |
| `agent.activity` | agentId, action | sets `currentAction`, `lastMessage` (if message), optional `status` transition |
| `agent.task.assigned` | agentId, taskId | task → `assigned`, `assignedAgentId = agentId`; agent task fields set only if `status` is given *(v1.1)*; agent status unchanged unless `status` given. Unknown taskId → task is created (title = `metadata.title` ?? `message` ?? taskId; `project` required, else 422) (A-07) |
| `agent.task.started` | agentId, taskId (existing) | task → `in_progress`, `startedAt` set if null; agent → `working` |
| `agent.task.progress` | agentId, taskId (existing), progress | task.progress and agent.progress = value |
| `agent.task.completed` | agentId, taskId (existing) | task → `completed`, progress 100, `completedAt`; agent → `completed` |
| `agent.task.failed` | agentId, taskId (existing) | task → `failed`; agent → `failed` |
| `agent.message` | agentId, message | sets `lastMessage` |
| `system.info` / `system.warning` / `system.error` | message | no state change; `agentId` optional (must exist if given) |

- An explicit `status` in the event overrides the implied agent status. If any implied/explicit agent **or** task transition is illegal, the whole event is rejected (409).
- `agent.task.started/progress/completed/failed` with a non-existent taskId → 422 `UNKNOWN_TASK`. Other agent events with an unknown taskId are accepted; the id is stored on the event/agent without creating a task.
- *(v1.1, ADR-017)* Task effects of any agent event (incl. `agent.task.started/progress/completed/failed`) apply only when the task's `assignedAgentId` is the event's agent or is null (then the task is claimed). Events from non-assignees update the agent and are stored, but leave the task unchanged (e.g. Reviewer reviewing Backend's task). Progress cannot change on a terminal task (409).
- *(v1.1, ADR-006)* The stored event `project` is explicit ?? the referenced task's project ?? the agent's `currentProject` after the event ?? null. Explicit project ≠ existing task's project → 422 `PROJECT_MISMATCH`.

**REQ-022** `POST /api/events` pipeline (§12). As a producer, I want my event validated, stored, applied and broadcast.
- Given the exact §12 example payload on a fresh seed, When POSTed, Then 201 with the stored event (incl. `id`, `createdAt`, normalized `project:"sellway"`); Backend Engineer becomes `working` with `currentAction:"run_command"`, `lastMessage:"Running backend tests"`, `taskId:"SW-123"`; a broadcast is received by connected clients; the event is returned by `GET /api/events`.
- Order: validate → (one DB transaction: store event + agent update + task update) → broadcast after commit → respond. If the DB write fails: 500 `INTERNAL_ERROR`, nothing broadcast, error logged.
- Events are applied in arrival order; two events for the same agent never interleave partially.

**REQ-023** Validation (§25). As the owner, I want malformed input rejected.
- Unknown `agentId` (`"99-ghost"`) → 422 `UNKNOWN_AGENT`. Unknown `project` (incl. `"All Projects"`) → 422 `UNKNOWN_PROJECT`. Invalid `status` / `type` / `severity`, `progress` outside 0–100 or non-integer, `metadata` not an object, missing required field per REQ-021, non-JSON body → 400. Body > limit → 413. All rejected per REQ-029.
- Field limits: `action` 1–100 chars; `message` ≤ 2000; `taskId` matches `^[A-Za-z0-9._-]{1,64}$`; `source` 1–50 chars `^[a-z0-9._-]+$`; strings trimmed; `metadata` ≤ 8 KB serialized.
- Validation schemas live in shared code (Zod) and are reused by the web client for form validation.

**REQ-024** `GET /api/events`. As the owner, I want queryable history.
- Returns newest first; query `project`, `agentId`, `type`, `limit` (default 50, max 500), `before` (cursor: event `seq`, *(v1.1)*). `project=P` follows the feed rule of REQ-062 (P's events plus project-less `system.warning/error`). Invalid params → 400; unknown project/agent → 422.

**REQ-025** `GET /api/health`.
- 200 `{data: {status:"ok", db:"ok", uptimeSec, version, time}}` *(v1.2, ADR-021)* when healthy; 503 `SERVICE_UNAVAILABLE` with `error.details: {status:"error", db:"error", uptimeSec, version, time}` *(v1.2)* when the DB cannot be queried.

**REQ-026** `GET /api/projects`.
- Returns the 4 stored projects (id, name, task prefix); "All Projects" is not returned.

**REQ-027** Tasks API (§13). See REQ-040–041.

**REQ-028** Unknown routes return JSON 404 `NOT_FOUND`, never an HTML page, under `/api/*`.

**REQ-029** Rejection guarantee. Given any request rejected with 4xx/5xx, Then the DB contains no new event, no agent/task field changed, and no Socket.IO broadcast was emitted (verified by tests that listen on a socket client).

### D. Task model (§14)

**REQ-040** `GET /api/tasks` / `POST /api/tasks`.
- `GET` supports `project`, `agentId`, `status` filters; unknown project/agent → 422; invalid status → 400.
- `POST {title (1–200), project (required), description? (≤ 5000), assignedAgentId?, priority? (default normal), status? (default todo, or assigned if assignedAgentId given), blockedBy? (task ids), metadata?, id?}` → 201 with task. Server generates `id` as `<PREFIX>-<n>` when absent; supplied duplicate → 409 `TASK_EXISTS`. Unknown agent/project/blockedBy task → 422; self-reference in `blockedBy` → 400.
- *(v1.2, ADR-024)* On create, `status` may only be `todo` or `assigned`: `assigned` without `assignedAgentId` → 400; `todo` with `assignedAgentId` → 400. Other statuses are reached only via PATCH or agent events. `blockedBy` ≤ 20 ids, duplicates removed. Generated `n` = 1 + highest numeric suffix in that project's prefix (fresh seed → `SW-126`).
- Creation is stored as an event and broadcast so all clients update live (event type `task.created`, source `api`; updates use `task.updated`) *(v1.1, ADR-005)*.

**REQ-041** `PATCH /api/tasks/:id`.
- Partial update of `title, description, status, priority, progress, assignedAgentId (nullable), blockedBy, metadata` and *(v1.1)* `force?` (ADR-015: skips only status legality, incl. reopening terminal tasks; logged); empty body → 400; unknown id → 404 `TASK_NOT_FOUND`; illegal status → 409; stored as an event and broadcast. PATCH on a task does not change agent status.
- `startedAt` is set on the first entry into `in_progress`; `completedAt` + `progress = 100` on `completed`.
- *(v1.2, ADR-024)* Without `status` in the body: setting an assignee on a `todo` task moves it to `assigned`; clearing the assignee of an `assigned` task moves it to `todo`; otherwise status is unchanged. A PATCH whose fields all equal stored values → 200 with `event: null`, nothing stored or broadcast.

**REQ-042** Agent-driven task updates. (Mapping and consistency property: `docs/AGENT_STATE_MACHINE.md` §6.)
- When an accepted agent event changes the agent's status and carries a `taskId` of an existing task whose `assignedAgentId` is that agent (or is null — then the task is assigned to that agent), the task status follows: planning→`planning`, working→`in_progress`, waiting→`waiting`, reviewing→`review`, completed→`completed`, failed→`failed`; idle/offline → unchanged. Events from non-assignees are recorded but do not change the task.

### E. Real-time and reconnection (§10, §18, §23)

**REQ-050** As the owner, I want every accepted state change pushed live, so that no page reload is needed.
- Given two browser tabs open, When any accepted event/PATCH/POST occurs, Then both tabs reflect it within 1 s (NFR-001) without reload. Broadcast payload contains the stored event plus the updated agent and/or task snapshot.
- Real-time is never simulated inside the frontend: UI state changes only from API responses/broadcasts (§10, PM-7).

**REQ-051** Socket is server→client only.
- Clients cannot change state via socket messages in Phase 1; unknown client-emitted messages are ignored and logged at debug.

**REQ-052** Connection status (§23).
- Top bar shows `Connected` / `Reconnecting` / `Disconnected` with icon + text. Client reconnects automatically with backoff.
- On (re)connect the client re-fetches agents, tasks and recent events, so changes missed while disconnected appear; feed items are de-duplicated by event `id`. *(v1.1, ADR-010)* Implemented with `GET /api/snapshot` (one consistent read), buffered live messages during the fetch, and an integer `version` on agents/tasks so stale updates are ignored.
- *(v1.2, PM, UX I-4)* Initial state `Connecting…`; after a drop the status is `Reconnecting` and becomes `Disconnected` after 30 s without success (retries continue in the background). System status `Degraded` = backend health OK but socket not connected.
- Reconnecting N times never registers duplicate listeners (one received event → exactly one UI update / one feed row; tested).

**REQ-053** Restart.
- Given the server is stopped and restarted, Then data persists (agents, tasks, events), seed is not duplicated, and an open browser returns to `Connected` and resyncs without manual reload.

### F. Dashboard, top bar, metrics, project filter (§6, §20, §21)

**REQ-060** Top bar. Shows product name "AI Virtual Office"; system status (`Operational` = health ok + socket connected; `Degraded` = reconnecting; `Backend unavailable` = health failing); current project filter; current local time (24 h, updates every second); connected agents count as `online/15` (global, not filtered); Demo Mode badge when active.

**REQ-061** Project selector. Options: All Projects (default), Sellway, Ishkun24, ERP, Ana Market (5). Selection is reflected in the URL query (`?project=sellway`) and survives reload; an invalid value in the URL falls back to All Projects.

**REQ-062** Project filtering semantics. Given project P selected:
- Metrics count only agents with `currentProject = P` and tasks with `project = P`.
- Activity feed shows only events with `project = P`, plus `system.warning`/`system.error` events without a project (so failures are never hidden) (A-09).
- Office keeps all 15 agents in place; agents not on P are visibly dimmed (not hidden).
- Agent roster shows agents on P first and dims the rest (consistent with the office); if no agent is on P, a "No agents on <P>" message is shown above the dimmed list.
- Live events for other projects do not appear in the filtered feed; switching back to All Projects shows them.
- Selecting All Projects removes all filtering.

**REQ-063** Top metrics. Tiles: Agents Online, Working, Planning, Waiting, Reviewing, Failed (agent counts by status/online), Active Tasks (A-06), Completed Tasks (status `completed`). Values recompute on every relevant broadcast and on filter change; each tile has a text label (not color only).

**REQ-064** Agent roster (agent cards, §31 step 11). A list/grid of 15 cards (name, shortRole, status icon+label, project, current task, progress) that updates live, opens the detail panel on click/Enter, and doubles as the keyboard-accessible and mobile alternative to the canvas.

### G. Virtual office visualization (§7–8, §21)

**REQ-070** Office layout. A Phaser 3 scene renders 8 labeled areas (Management, Development, Design, Infrastructure, Quality, AI Lab, Documentation, Audit) with agents placed per §3.1; each agent has a desk/workstation, avatar, visible name/shortRole label, status indicator and click target.

**REQ-071** Status visuals. Each status is distinguishable by indicator color **and** shape/icon: idle neutral seated; planning thinking bubble; working active monitor + typing animation + green/blue indicator; waiting yellow paused; reviewing check/review icon purple/blue; completed green check with a short (≈2–3 s) success emphasis then steady completed state; failed red alert; offline gray, inactive workstation. Animations subtle; disabled when `prefers-reduced-motion`.

**REQ-072** Live office. When an agent's status changes via any producer, its visual changes within 1 s without re-creating the scene.

**REQ-073** Interaction. Clicking an agent opens the detail panel (REQ-080) and highlights the selected agent; hover shows a highlight and tooltip with name, status, current action (RECOMMENDED: tooltip).

**REQ-074** Style and assets. Dark graphite, professional, subtle pixel-office influence, not childish/cartoon/neon (§7, §21). All art is generated in code or original — no copyrighted game assets and no CDN/network assets.

**REQ-075** Robustness. Exactly one Phaser game instance exists per page (no duplicates on re-render, React StrictMode or navigation); the canvas scales to its container on resize without distortion; destroying the view releases the instance.

### H. Agent detail panel (§9)

**REQ-080** Opening. Clicking an agent (office, roster, or a feed row's agent — RECOMMENDED) opens a side panel; Close button and `Esc` close it; opening another agent swaps content; focus moves into the panel and returns on close.

**REQ-081** Fields. Shows name, role, department, status (icon+label), current project, current task, task ID, progress (bar + %), started at, running duration (ticks every second while status is active; `—` otherwise), current action, last activity (relative + absolute time), last message. Null values render as `—`. All fields update live while the panel is open.

**REQ-082** Tabs: Activity, Tasks, Logs, Files, Git.
- **Activity** (real): this agent's stored events, newest first, from the API, live-appended; empty state "No activity yet"; error state with retry. Not filtered by the project selector (A-10).
- **Tasks** (real): tasks with `assignedAgentId` = agent, with id, title, project, status, priority, progress; live; empty state.
- **Logs** *(v1.2, PM decision resolving UX I-2)*: derived from the agent's real stored events, rendered as log lines, with a persistent visible label "Derived from stored events — live log streaming arrives in Phase 2". Never reads the real filesystem or process output.
- **Files, Git** (mock allowed, §9): each shows a persistent, visible "Sample data — not connected (Phase 1)" label; never reads the real filesystem or git; no actions that imply real operations.

**REQ-083** Unknown/removed agent. If the panel's agent id does not resolve (e.g. stale URL), the panel shows "Agent not found" instead of a blank or crash.

### I. Live activity feed (§10)

**REQ-090** Feed content. Each row: time (HH:MM:SS local), agent name (or "System"), action, project, message, severity indicator (icon + color for warning/error), and a `demo` marker when `source = "demo"`.

**REQ-091** Feed behavior. Initial load from `GET /api/events` (latest 50, respecting filter); new events prepend live via Socket.IO; no duplicates (by id); in-memory list capped (e.g. 200) for performance; scrolling down does not jump while new events arrive (RECOMMENDED); empty, loading and error states present.

**REQ-092** Feed text safety. Messages render as plain text (no HTML interpretation) — an event with `message: "<img src=x onerror=alert(1)>"` displays literally.

### J. Developer Simulator (§15)

**REQ-100** Access. A Developer Simulator panel is reachable from the main screen without hiding the office/metrics/feed (e.g. drawer), so results are visible live.

**REQ-101** Inputs. Agent (15, required, default none selected → actions disabled), Project (4 stored projects + "none"), Task (tasks of the selected project + "none"), plus Send Activity fields `action` (required) and `message` (optional).

**REQ-102** Status actions. Buttons Set Idle, Start Planning, Start Work, Set Waiting, Start Review, Complete, Fail, Set Offline send `agent.status.changed` (status idle/planning/working/waiting/reviewing/completed/failed/offline) with `source:"simulator"` and the selected project/task, via HTTP to the backend (*(v1.2, ADR-022)* through `PATCH /api/agents/:id/status`, REQ-004; Send Event uses `POST /api/events`). Buttons whose transition is illegal from the agent's current status are visually marked (not hidden); clicking one shows the server's 409 message (e.g. "Illegal transition: idle → completed").

**REQ-103** Send Activity. "Send Event" posts `agent.activity` with action/message/project/task. Example: Agent Backend Engineer, Project Sellway, action `run_tests`, message "Running API tests" → feed row and Backend Engineer's current action/last message update live. Empty action → inline validation error, no request sent.

**REQ-104** Simulator integrity. The simulator never mutates frontend state directly; the UI changes only after the backend broadcast/response (test: with the API mocked to fail, store state is unchanged and an error is shown). Buttons are disabled while a request is pending (no double submit); success/failure feedback is shown for each action; backend-unavailable disables actions with a message.

### K. Demo Mode (§16, PM-10)

**REQ-110** Toggle. Demo Mode is off by default; a clearly visible toggle starts/stops it; while on, the top bar shows a `DEMO` badge. Turning it off stops new demo events within one interval. *(v1.1, ADR-011)* API: `GET /api/demo`, `POST /api/demo/start {intervalMs?}`, `POST /api/demo/stop` (idempotent); state pushed as `demo:state`.

**REQ-111** Behavior. While on, the server emits realistic events every few seconds (default ~3 s, configurable 2–10 s) through the same EventService with `source:"demo"`, following the §16 story (PM assigns task, Architect plans, Backend works, Frontend works, QA waits, QA reviews, Reviewer reviews, Product Auditor audits) and respecting both state machines (demo never produces 409s that it ignores silently; any rejection is logged).

**REQ-112** State safety. On start, agents and tasks are snapshotted (persisted). On stop, every agent/task not changed by a non-demo event during the demo is restored to its snapshot; entities changed by user/API/simulator events during the demo keep their user state; tasks created by demo are removed; user-created tasks are kept. Demo events remain in history marked `source:"demo"` (A-11).

**REQ-113** Crash safety. If the server stops while Demo Mode is on, on next start demo is **not** resumed and the snapshot restore of REQ-112 is applied before serving requests.

### L. Seed data (§17)

**REQ-120** Content. 15 agents (§3.1), 4 projects + virtual All Projects (§3.2), the 11 tasks of §17 with ids `SW-123` Lost Goods API, `SW-124` Dashboard performance optimization, `SW-125` Campaign analytics, `IK-201` Vacancy posting workflow, `IK-202` Recruitment pipeline, `IK-203` Telegram bot integration, `ERP-301` Inventory architecture, `ERP-302` Order management module, `ERP-303` CRM integration, `AM-401` Seller dashboard, `AM-402` Marketplace integration; a realistic mix of statuses/priorities (≥1 completed, ≥1 in_progress, ≥1 waiting with `blockedBy`, ≥1 todo), and ≥ 30 historical events over the past ~2 hours across all 4 projects and several event types.

**REQ-121** Consistency. Seeded agent states are legal and consistent with seeded tasks (REQ-003, REQ-042); a mix of statuses is visible on first load including ≥1 offline agent. **Backend Engineer is seeded `idle` and `SW-123` is `todo` or `assigned` to Backend Engineer**, so the §12 example and §32 scenario work on a fresh seed.

**REQ-122** Idempotency. Seeding runs automatically only when the DB is empty; restarts never duplicate data; an explicit reset+reseed script exists for the local dev DB only (clearly named, documented, never runs implicitly).

### M. Producer-agnostic design (§18–19, §34)

**REQ-130** No Claude dependency. Core server/domain code has no Claude-specific logic; `source` is free-form within REQ-023 limits. Any HTTP client can produce events.

**REQ-131** Adapter for future Claude Code format. A pure, unit-tested adapter maps the §19 example (`source, agentId, project, taskId, event:"tool.executed", tool, command, result`) to a canonical envelope (e.g. `agent.activity`, action derived from tool, `result:"failure"` → severity error, raw fields in `metadata`). It is not connected to any real Claude process in Phase 1.

**REQ-132** Action vocabulary. A shared list of known actions includes §19's `read_file, write_file, edit_file, search, run_command, git_status, git_diff, git_commit, test, build, browser, wait, error`; `action` is not restricted to the list (other producers may send others).

### N. Empty / loading / error / disconnected states (§22)

**REQ-140** Loading: dashboard, office, roster, feed, panel tabs show skeletons/spinners while initial data loads; never an indefinite spinner (timeout → error state).
**REQ-141** Empty: feed with no events, panel tabs with no data, filtered project with no agents/tasks each show a specific message.
**REQ-142** Backend unavailable: if the API is unreachable at start or later, a visible error state/banner with Retry appears; last known data (if any) is marked stale; the UI does not silently fail. When the backend returns, the UI recovers without reload.
**REQ-143** Socket disconnected: banner/status per REQ-052; actions that rely only on HTTP may continue, with a note that live updates are paused.
**REQ-144** API errors in any UI action surface a readable message (from `error.message`), never a silent no-op.

### O. Logging (§24)

**REQ-150** Structured logs (JSON lines: `time, level, msg` + context) for: server start/stop (port, host, DB path), API request errors (4xx `warn` with code/route, 5xx `error`), invalid events (`warn`, reason code, type, agentId — not the full payload), illegal transitions, socket connect/disconnect (`info`, socket id, client count), DB failures (`error`), demo start/stop.
**REQ-151** Low noise: successful GET requests and individual accepted events are not logged at `info` by default; level configurable via env (`LOG_LEVEL`); tests run with logs suppressed.

### P. Security basics (§26, CLAUDE.md §15)

**REQ-160** Monitoring only: no endpoint executes shell commands, reads/writes arbitrary files, exposes the filesystem, offers a terminal, or evaluates code. `metadata.command` etc. are stored as inert text only.
**REQ-161** Local by default: server binds `127.0.0.1`; CORS allows only the local web origin(s); if configured to bind a non-loopback host, a startup `warn` states there is no authentication. No auth in Phase 1 (documented limitation). *(v1.2, ADR-027)* Host-header guard on HTTP and Socket.IO (403 `HOST_NOT_ALLOWED`, §3.5) and `Content-Type: application/json` required on every POST/PATCH, so no cross-site simple request can change state. Rate limiting is not in Phase 1 (A-15).
**REQ-162** Input limits per NFR-004 and REQ-023; strict schemas on every endpoint.
**REQ-163** Output safety: all user/producer-supplied text rendered as text in React and Phaser (REQ-092); error responses contain no stack traces or SQL; SQL uses parameterized statements only.
**REQ-164** No secrets: no API keys or credentials in the repo; configuration via env with a committed-safe `.env.example`; `data/*.db` and `.env` gitignored.

### Q. Testing (§27)

**REQ-170** Automated tests exist and pass for: agent status transitions (full table), task transitions, event validation (each REQ-023 rule), Event API (Supertest: happy path, each error code, REQ-029 guarantee), task state updates (REQ-021/041/042), project filtering (API + UI selector logic), Socket.IO propagation (socket.io-client receives broadcast after POST; no broadcast on rejection), agent detail panel rendering (fields, tabs, mock labels, empty states), simulator actions (correct payloads, no direct store mutation, error display), demo snapshot/restore (REQ-112), Claude adapter (REQ-131).
**REQ-171** Root scripts exist and succeed: `npm install`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, plus dev scripts to start server, web, and both together. Results are actually run and reported (§27 "Run them").

### R. Documentation (§28–30)

**REQ-180** `README.md` explains: requirements (Node/npm versions), installation, development, starting frontend, backend, both, local URLs (web 5173, API 4000), how the simulator works, how events work (with a curl example of POST /api/events), demo mode, seed/reset, tests.
**REQ-181** `docs/ARCHITECTURE.md`, `docs/EVENT_SYSTEM.md` (envelope, types, effects, errors, adapters), `docs/AGENT_STATE_MACHINE.md` (legal/illegal transitions, task machine), `docs/ROADMAP.md` (Phases 1–10 exactly as §29), `docs/IMPLEMENTATION_PLAN.md` (§30 contents: architecture, folder structure, dependencies, DB model, Socket.IO flow, Phaser architecture, phases, risks).
**REQ-182** Docs match implemented behavior (auditor checks endpoints, event types, transitions, commands against code).

### S. Verification (§32–33)

**REQ-190** Full run verification is performed and recorded: install, lint, typecheck, tests, build, backend start, frontend start, `GET /api/health`, `GET /api/agents`, `POST /api/events`, Socket.IO live update, simulator, project filter, restart (REQ-053).

**REQ-191** §32 key scenario. Given a fresh seed with Backend Engineer `idle` and the web UI open (All Projects) with the detail panel of Backend Engineer open, When Backend Engineer is changed `idle → working` (run 1: simulator "Start Work" with project Sellway, task SW-123; run 2, after returning the agent to `idle` or on a fresh seed: `POST /api/events` with the §12 example), Then, without page reload and within 1 s: (a) metrics: Working +1; *(v1.2.1)* Active Tasks unchanged and Completed Tasks unchanged — SW-123 is seeded `assigned` (already active per A-06) and moves `assigned → in_progress`, which stays within the active set; (b) office: Backend Engineer's desk shows the working visual; (c) detail panel: status Working, project Sellway, task SW-123 / Lost Goods API, started at set, running duration ticking; (d) activity feed: new row for Backend Engineer with project Sellway at the top. With filter = ERP the Sellway row is absent from the feed and Backend Engineer is dimmed.

**REQ-192** Final report follows §33 and explicitly states committed/pushed/deployed = NO/NO/NO.

---

## 5. Scope

**In scope (Phase 1):** everything in section 4 — local monitoring UI, Phaser office, agent/task models
and state machines, event pipeline + REST API + Socket.IO, simulator, demo mode, seed, SQLite
persistence, tests, docs, local verification.

**Out of scope (Phase 1):** sending commands to agents / remote control; real Claude Code, Telegram,
GitHub, terminal, browser-agent, Docker, CI/CD integrations (only the pure adapter of REQ-131);
real Files/Git/Logs data; authentication, users, teams, multi-tenancy; cloud deployment, any push or
commit; notifications (email/push); perfect mobile Phaser layout; UI localization beyond English;
event retention/pruning policies (only a simple count cap is RECOMMENDED, ADR-014); agent-to-agent handoff logic.

## 6. Non-functional requirements

- **NFR-001 Performance (real-time):** on localhost, an accepted `POST /api/events` is reflected in metrics, office, open detail panel and feed in **< 1 s** (target p95 < 300 ms). Server processing of an event p95 < 100 ms with ≤ 10k stored events.
- **NFR-002 Performance (UI):** production build interactive < 3 s on localhost; office animates smoothly (target 60 fps, ≥ 30 fps on a typical laptop) and stays light when idle; Demo Mode at default rate for 30 min shows no unbounded memory growth (feed/event lists capped).
- **NFR-003 Reliability:** event processing atomic (REQ-022); data persists across restarts; graceful shutdown closes DB and sockets; server survives malformed input without crashing.
- **NFR-004 Request limits:** JSON body ≤ 100 KB (→ 413); `metadata` ≤ 8 KB; string limits per REQ-023/040; list endpoints max 500 items.
- **NFR-005 Responsive:** primary 1920×1080 and 2560×1440; laptop 1366×768 and 1440×900 fully usable; tablet 768–1024 px with collapsible panels; < 768 px simplified monitoring view (top bar, metrics, roster, feed; office may be hidden or scaled). No horizontal page scroll at these widths.
- **NFR-006 Accessibility basics:** status never conveyed by color alone (icon + text); all controls keyboard-operable with visible focus; panel focus management and `Esc`; text contrast WCAG AA; `prefers-reduced-motion` honored; roster provides an accessible equivalent of the canvas; form fields labeled.
- **NFR-007 Logging:** per REQ-150–151.
- **NFR-008 Security:** per REQ-160–164.
- **NFR-009 Maintainability:** TypeScript strict across packages; ESLint + Prettier clean; shared types, Zod schemas, state machines and constants in `packages/shared` used by both apps (PM-1); modular folders per §5.
- **NFR-010 Portability/offline:** runs on Windows 11 + Node 24 + npm with no global installs and no native compilation (PM-2); npm scripts work in PowerShell and bash; no runtime internet/CDN dependency (fonts and assets bundled).
- **NFR-011 Localization/time:** UI in English; times shown in local timezone, 24-hour; stored as UTC ISO-8601.
- **NFR-012 Visual design:** §21 — graphite/near-black background, dark-gray panels, subtle borders, Inter, slightly rounded cards; no excessive gradients, cartoon look, neon overload, huge empty areas or excessive animation.

## 7. Assumptions (reversible; recorded for the architect and auditor)

- **A-01** "All Projects" is a virtual no-filter selector option, not a stored project (PM-8). `GET /api/projects` returns 4 projects.
- **A-02** Agent ids follow the §12 example pattern `NN-role-slug` (§3.1); codes are short unique abbreviations.
- **A-03** Agent `name` = role title (e.g. "Backend Engineer"); no persona names.
- **A-04** `idle → working` is legal (required by §32); other additions to the owner's 9 example transitions are listed in §3.3.
- **A-05** Entering `idle` keeps `currentProject` (last project association) but clears task fields.
- **A-06** "Active Tasks" = tasks in `assigned, planning, in_progress, waiting, review`; `todo` is not active.
- **A-07** `agent.task.assigned` with an unknown taskId creates the task (producer-friendly); other task events require an existing task.
- **A-08** Canonical envelope is strict at top level (typos rejected); free-form data goes into `metadata`; producer-specific formats go through adapters (PM-9).
- **A-09** Under a project filter, project-less `system.warning/error` events stay visible.
- **A-10** The detail panel's Activity/Tasks tabs show all of the agent's data regardless of the project filter.
- **A-11** Demo events stay in history, tagged `source:"demo"` and marked in the feed; demo-created tasks are removed on stop.
- **A-12** Single local operator, no authentication in Phase 1 (bound to 127.0.0.1).
- **A-13** Seeded task ids use project prefixes (`SW-`, `IK-`, `ERP-`, `AM-`); `SW-123` = Lost Goods API to match the §12 example.
- **A-14** Files/Git tabs use clearly labeled sample data (§9); *(v1.2)* the Logs tab is derived from real stored events (REQ-082).
- **A-15** *(v1.2)* HTTP rate limiting is deferred to backlog **BL-007** (with producer authentication): Phase 1 is local-only, bound to 127.0.0.1 with a Host guard and body-size limits. It must be in place before any non-loopback exposure.

## 8. Open questions (none blocking; defaults apply unless the owner overrides)

- **Q-1 UI language.** English (matches the request) vs Uzbek UI. **Default: English**; layout should not prevent later localization.
- **Q-2 Strictness for future real producers.** Phase 1 rejects illegal transitions (409). In Phase 2, real Claude Code agents may report states out of order. **Default: keep strict rejection in Phase 1; revisit in Phase 2** (possible "accept and flag" mode).

## 9. Traceability (request section → requirements)

| § | Requirements | § | Requirements |
|---|---|---|---|
| 1, 34 | Goal, REQ-130 | 16 | REQ-110–113 |
| 2 | REQ-001–004, §3.1 | 17 | REQ-120–122 |
| 3 | REQ-010–013, §3.3 | 18, 19 | REQ-050, REQ-130–132 |
| 4, 5 | NFR-009, NFR-010 (PM brief) | 20, 21 | NFR-005, NFR-012, REQ-074 |
| 6 | REQ-060–064 | 22 | REQ-140–144 |
| 7, 8 | REQ-070–075 | 23 | REQ-052–053 |
| 9 | REQ-080–083 | 24 | REQ-150–151 |
| 10 | REQ-090–092, REQ-050 | 25 | REQ-023, REQ-029 |
| 11 | REQ-020–021 | 26 | REQ-160–164, NFR-004 |
| 12 | REQ-022 | 27 | REQ-170–171 |
| 13 | REQ-002, 004, 024–028, 040–041 | 28–30 | REQ-180–182 |
| 14 | REQ-040–042, §3.4 | 31 | REQ-064 (agent cards) |
| 15 | REQ-100–104 | 32, 33 | REQ-190–192 |
