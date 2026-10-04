# API CONTRACTS — AI Virtual Office MVP (Phase 1)

Owner: tech-lead · Task: VO-000 (contracts step) · Date: 2026-10-04 · Status: CONTRACT v1.2.3 (binding)
Inputs: `ORIGINAL_REQUEST.md` (§N), `PM_BRIEF.md` (PM-N), `REQUIREMENTS.md` v1.2 (REQ-/NFR-/A-),
`ARCHITECTURE.md`, `DECISIONS.md` (ADR-001…037), `EVENT_SYSTEM.md` (ES §N), `AGENT_STATE_MACHINE.md`
(ASM §N), `UX.md` (UX §N).

Engineers build **in parallel** against this file. If something here is ambiguous or wrong, stop and
report it to the PM (routed to tech-lead) — do not invent a variant. Business rules (effects, coupling,
state tables) are defined in ES/ASM and are not repeated here except where an exact value is needed.

Contents: 0 Conventions · 1 Shared types · 2 Errors · 3 REST endpoints · 4 Socket.IO · 5 `@vo/shared`
layout and exports · 6 Reference data · 7 Seed baseline · 8 Database schema · 9 Server internal
contracts · 10 Frontend internal contracts · 11 Configuration · 12 Workspaces and npm scripts ·
13 Change log.

---

## 0. Conventions (apply to every endpoint)

| Topic | Rule |
|---|---|
| Base URL | Server `http://127.0.0.1:4000`; all REST paths start with `/api`. Dev web (`http://localhost:5173`) proxies `/api` and `/socket.io` to `http://127.0.0.1:4000`. |
| Auth | None in Phase 1 (A-12, ADR-019). |
| Request body | Only `POST`/`PATCH` have bodies. They **must** send `Content-Type: application/json` (a `charset` parameter is allowed), otherwise 400 `INVALID_JSON` ("Content-Type must be application/json"). A JSON request with an empty body is treated as `{}`. Max body 100 KB = 102 400 bytes (→ 413). *(ADR-037)* Compressed bodies are not accepted: any `Content-Encoding` other than `identity` → 400 `INVALID_JSON` ("Content-Encoding is not supported"); a malformed body never yields 500. |
| Success envelope | `{ "data": <payload> }` for every 2xx response (ADR-021). Paged lists add `"page": { "limit": number, "nextBefore": number \| null }`. |
| Error envelope | `{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }` (§2). Never stack traces or SQL. |
| Strictness | Every body schema is a strict object: unknown keys → 400 `VALIDATION_ERROR` (one issue per unknown key, `path` = key, `message` = `"Unrecognized key"`). Endpoints that define query parameters reject unknown query keys and repeated keys the same way. Endpoints without query parameters ignore the query string. |
| Strings | All string inputs are trimmed. Optional strings that are empty after trim are treated as absent. Required strings that are empty after trim → 400. In bodies, `null` for an optional field means "absent" — **except** where a field is documented as nullable with a meaning (`PATCH /api/tasks/:id` `description`, `assignedAgentId`). |
| Numbers in query | Decimal digits only (`^\d+$`), then range-checked; anything else → 400. |
| Timestamps | UTC ISO-8601 with milliseconds and `Z` (`new Date().toISOString()`), e.g. `2026-10-03T22:41:07.123Z`. Server clock is authoritative. |
| Nulls | Entity fields that have no value are present as `null` (never missing). `metadata` is always an object (`{}` when empty). |
| Projects | Any `project` input (body or query) accepts the project **id or name**, case-insensitive (`"Sellway"`, `"sellway"`, `"SELLWAY"`). Stored/returned values are always the id. `"All Projects"`/`"all"` are not projects → 422 `UNKNOWN_PROJECT` (ADR-006). |
| Check order | (1) size / content-type / JSON parse → (2) schema (400) → (3) path id (404) → (4) referenced entities (422) → (5) no-op detection (where defined) → (6) state legality (409) → (7) DB write (500 on failure). First failing step wins; within schema validation all issues are reported. |
| Rejection guarantee | Any 4xx/5xx: nothing stored, no entity changed, nothing broadcast (REQ-029). |
| Headers on `/api` responses | `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` — on **every** `/api` response, including Host/Origin-guard 403s and the starting 503; every JSON error envelope (any path) carries `no-store` + `nosniff` too *(CR-19)*. |
| Framing headers *(ADR-037)* | **Every Express response** (API, errors, guard refusals, the served web build in one-port mode; not the `/socket.io` handshakes, which engine.io answers itself) carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` (clickjacking protection). A full CSP for the web bundle is not part of Phase 1. |
| CORS | Allowed origins = `CORS_ORIGINS` (§11). Methods `GET, POST, PATCH, OPTIONS`; request header `Content-Type`. No credentials. |
| Host guard | Requests (HTTP and Socket.IO handshake) whose `Host` hostname is not `localhost`, `127.0.0.1`, `[::1]` or the configured `HOST` → 403 `HOST_NOT_ALLOWED` (ADR-027, DNS-rebinding protection). A refused Socket.IO handshake gets engine.io's own response, not this envelope (§4, *ADR-037*). |
| Origin rule for writes *(ADR-037)* | State-changing requests (`POST`, `PATCH`, `PUT`, `DELETE`) under `/api` with an `Origin` header must pass the same rule as Socket.IO (ADR-035): allowed when `Origin` is **absent** (curl, producers), listed in `CORS_ORIGINS`, or the server's own origin (`http(s)://<Host>`, one-port mode); otherwise 403 `ORIGIN_NOT_ALLOWED` ("Origin not allowed"). `GET`/`HEAD` and CORS preflights (`OPTIONS`) are not affected. Order: Host guard → Origin rule → readiness gate (§9.8) → route. Through the Vite dev proxy the browser sends `Origin: http://localhost:5173` (allowed). |
| Unknown routes | Any method on an unknown `/api/*` path → 404 `NOT_FOUND` JSON (no 405). |
| Logging | Per ARCHITECTURE §9 and §9.3 below. |

---

## 1. Shared types (`@vo/shared`)

These are the **exact** TypeScript shapes. Type names are binding; field order is not. Where a type is
inferred from a Zod schema (`z.output<typeof …>`), the inferred type must be structurally identical to
the shape written here (assert with `expectTypeOf` in shared tests).

### 1.1 JSON helpers — `types/json.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
```

### 1.2 Enumerations — `constants/statuses.ts`, `constants/eventTypes.ts`, `constants/rooms.ts`

```ts
export const AGENT_STATUSES = ['idle', 'planning', 'working', 'waiting', 'reviewing', 'completed', 'failed', 'offline'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export const ACTIVE_AGENT_STATUSES = ['planning', 'working', 'waiting', 'reviewing'] as const;   // ASM §1
export const RESTING_AGENT_STATUSES = ['idle', 'completed', 'failed'] as const;

export const TASK_STATUSES = ['todo', 'assigned', 'planning', 'in_progress', 'waiting', 'review', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const ACTIVE_TASK_STATUSES = ['assigned', 'planning', 'in_progress', 'waiting', 'review'] as const; // A-06
export const TERMINAL_TASK_STATUSES = ['completed', 'cancelled'] as const;

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const SEVERITIES = ['info', 'warning', 'error'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PRODUCER_EVENT_TYPES = [
  'agent.connected', 'agent.disconnected', 'agent.status.changed', 'agent.activity', 'agent.message',
  'agent.task.assigned', 'agent.task.started', 'agent.task.progress', 'agent.task.completed', 'agent.task.failed',
  'system.info', 'system.warning', 'system.error',
] as const;                                                    // 13, accepted on POST /api/events
export type ProducerEventType = (typeof PRODUCER_EVENT_TYPES)[number];
export const SERVER_EVENT_TYPES = ['task.created', 'task.updated'] as const;   // written by the Tasks API only
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export const EVENT_TYPES = [...PRODUCER_EVENT_TYPES, ...SERVER_EVENT_TYPES] as const;   // 15
export type EventType = ProducerEventType | ServerEventType;

export const SOURCES = { API: 'api', SIMULATOR: 'simulator', DEMO: 'demo', SYSTEM: 'system' } as const;
export const DEFAULT_SOURCE = 'api';
export const RESERVED_SOURCES = ['demo', 'system'] as const;    // rejected on HTTP input (ADR-005)
export const PROJECTLESS_VISIBLE_TYPES = ['system.warning', 'system.error'] as const;   // feed rule, ES §8.3

export const ROOM_IDS = ['management', 'development', 'design', 'infrastructure', 'quality', 'ai-lab', 'documentation', 'audit'] as const;
export type RoomId = (typeof ROOM_IDS)[number];
```

### 1.3 Entities — `types/project.ts`, `types/agent.ts`, `types/task.ts`

```ts
export interface Project {
  id: string;            // 'sellway' | 'ishkun24' | 'erp' | 'ana-market' in Phase 1
  name: string;          // 'Sellway' …
  taskPrefix: string;    // 'SW' | 'IK' | 'ERP' | 'AM'
}

export interface Agent {
  id: string;                    // '04-backend-engineer'
  code: string;                  // 'BE' (unique, ≤ 3 chars)
  name: string;                  // 'Backend Engineer' (A-03)
  role: string;                  // 'Senior Backend Engineer' (§6.1)
  shortRole: string;             // 'Backend' (≤ 12 chars, office label)
  avatar: string;                // 'monogram:BE' — generated avatar descriptor, no image asset
  department: string;            // 'Development' (room label)
  roomId: RoomId;
  deskId: string;                // 'development-1' (UX §5.2, unique)
  status: AgentStatus;
  currentProject: string | null; // project id
  currentTask: string | null;    // task title, or the taskId if the task does not exist
  taskId: string | null;
  progress: number;              // integer 0–100
  startedAt: string | null;
  lastActivityAt: string | null;
  currentAction: string | null;
  lastMessage: string | null;
  online: boolean;               // === (status !== 'offline')
  metadata: JsonObject;
  version: number;               // ≥ 1, +1 on every row write (ADR-010)
}

export interface Task {
  id: string;                    // 'SW-123'; matches TASK_ID_PATTERN
  title: string;
  description: string | null;
  project: string;               // project id (required)
  assignedAgentId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;              // integer 0–100
  createdAt: string;
  startedAt: string | null;      // first entry into in_progress
  completedAt: string | null;    // entry into completed; null when it leaves completed (force)
  blockedBy: string[];           // task ids, ≤ 20, unique, never contains `id`
  metadata: JsonObject;
  version: number;               // ≥ 1, +1 on every row write
  updatedAt: string;
}
```

### 1.4 Events — `types/event.ts`

```ts
/** Stored event: returned by the API and pushed over the socket (ES §2.2). */
export interface OfficeEvent {
  id: string;                    // UUID v4
  seq: number;                   // strictly increasing integer; total order and paging cursor
  type: EventType;
  source: string;                // resolved; 'api' when the producer omitted it
  agentId: string | null;
  project: string | null;        // resolved/derived project id (ES §5.4)
  taskId: string | null;
  status: AgentStatus | TaskStatus | null;  // TaskStatus only for type 'task.updated' / 'task.created'
  action: string | null;
  message: string | null;
  severity: Severity;            // resolved (ES §2.3)
  progress: number | null;
  metadata: JsonObject;
  occurredAt: string | null;     // producer clock, informational
  createdAt: string;             // server time
  forced: boolean;               // ADR-015
}

/** Producer input after parsing (= z.output<typeof eventInputSchema>). */
interface EventInputCommon {
  source?: string;
  project?: string;              // id or name, unresolved
  action?: string;
  message?: string;
  severity?: Severity;
  metadata?: JsonObject;
  occurredAt?: string;
}
export type EventInput =
  | (EventInputCommon & { type: 'agent.connected' | 'agent.disconnected'; agentId: string; taskId?: string })
  | (EventInputCommon & { type: 'agent.status.changed'; agentId: string; status: AgentStatus; taskId?: string; progress?: number })
  | (EventInputCommon & { type: 'agent.activity'; agentId: string; action: string; status?: AgentStatus; taskId?: string; progress?: number })
  | (EventInputCommon & { type: 'agent.message'; agentId: string; message: string; status?: AgentStatus; taskId?: string; progress?: number })
  | (EventInputCommon & {
      type: 'agent.task.assigned' | 'agent.task.started' | 'agent.task.completed' | 'agent.task.failed';
      agentId: string; taskId: string; status?: AgentStatus; progress?: number;
    })
  | (EventInputCommon & { type: 'agent.task.progress'; agentId: string; taskId: string; progress: number; status?: AgentStatus })
  | (EventInputCommon & { type: 'system.info' | 'system.warning' | 'system.error'; message: string; agentId?: string; taskId?: string });

```

`EventInputBody` (the raw JSON a client sends, `null` allowed for optional fields) is exported from
`schemas/event.ts` as `z.input<typeof producerEventInputSchema>` (types never import schemas; schemas may
import types and constants — no cycles).

Forbidden-field matrix (ES §3) is enforced by the strict objects above: e.g. `status`/`progress` are not
keys of `agent.connected`, so sending them → 400 `"Unrecognized key"`.

### 1.5 Demo, API and socket payloads — `types/demo.ts`, `types/api.ts`, `types/socket.ts`

```ts
export interface DemoState {
  active: boolean;
  intervalMs: number;            // current interval when active, else the configured default
  startedAt: string | null;      // null when inactive
}
export interface DemoRestoreSummary {
  agentsRestored: number;        // snapshot agents restored (not user-touched, differed)
  agentsKept: number;            // user-touched agents left as they are
  tasksRestored: number;
  tasksKept: number;
  tasksDeleted: number;          // demo-created, not user-touched
}
export interface DemoStopResult { demo: DemoState; restored: DemoRestoreSummary | null } // null = demo was not running

export interface ApiSuccess<T> { data: T }
export interface ApiPage { limit: number; nextBefore: number | null }  // nextBefore = `before` value for the next older page, null = no older items
export interface ApiPagedList<T> { data: T[]; page: ApiPage }
export interface ApiErrorBody { error: { code: ErrorCode; message: string; details?: unknown } }

export interface ValidationIssue { path: string; message: string }   // path: dot-joined, '' = root
export interface IllegalTransitionDetails { entity: 'agent' | 'task'; id: string; from: string; to: string }
export interface ProjectMismatchDetails { taskId: string; taskProject: string; eventProject: string }

/** Result of every accepted write; identical to the `office:event` socket payload. */
export interface OfficeEventPayload { event: OfficeEvent; agent: Agent | null; task: Task | null }
/** Write result that may be a no-op (event === null: nothing stored or broadcast). */
export type WriteResult = OfficeEventPayload | { event: null; agent: Agent | null; task: Task | null };

export interface HealthData { status: 'ok'; db: 'ok'; uptimeSec: number; version: string; time: string }
export interface HealthErrorDetails { status: 'error'; db: 'error'; uptimeSec: number; version: string; time: string }

export interface Snapshot {
  agents: Agent[];               // all 15, ordered by agent number
  tasks: Task[];                 // newest 500 tasks + every task bound to an agent, same order as GET /api/tasks (ADR-035)
  projects: Project[];           // 4
  events: OfficeEvent[];         // newest first, feed predicate for `project`
  eventsPage: ApiPage;
  demo: DemoState;
  serverTime: string;            // for client clock-offset (RECOMMENDED use)
  lastSeq: number;               // highest stored event seq at read time (0 if none), unfiltered — resync watermark (ADR-035)
}

export interface OfficeResyncPayload { reason: 'demo-restored' }
export interface ServerToClientEvents {
  'office:event': (payload: OfficeEventPayload) => void;
  'demo:state': (state: DemoState) => void;
  'office:resync': (payload: OfficeResyncPayload) => void;
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- server→client only (REQ-051)
export interface ClientToServerEvents {}
```

Body/query input types are exported as `z.input<…>` of the schemas in §5.2:
`AgentStatusPatchBody`, `TaskCreateBody`, `TaskPatchBody`, `DemoStartBody`, `AgentsQuery`,
`EventsQuery`, `TasksQuery`, `SnapshotQuery`; parsed forms as `z.output<…>`: `AgentStatusPatchInput`,
`TaskCreateInput`, `TaskPatchInput`, `DemoStartInput`, `EventsQueryInput`, `TasksQueryInput`,
`AgentsQueryInput`, `SnapshotQueryInput`.

---

## 2. Errors

### 2.1 Codes — `constants/errorCodes.ts`

```ts
export const ERROR_CODES = {
  INVALID_JSON: 'INVALID_JSON',                 // 400
  VALIDATION_ERROR: 'VALIDATION_ERROR',         // 400
  HOST_NOT_ALLOWED: 'HOST_NOT_ALLOWED',         // 403 (ADR-027)
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',     // 403 (ADR-037)
  NOT_FOUND: 'NOT_FOUND',                       // 404
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',           // 404
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',             // 404
  ILLEGAL_TRANSITION: 'ILLEGAL_TRANSITION',     // 409
  TASK_EXISTS: 'TASK_EXISTS',                   // 409
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',       // 413
  UNKNOWN_AGENT: 'UNKNOWN_AGENT',               // 422
  UNKNOWN_PROJECT: 'UNKNOWN_PROJECT',           // 422
  UNKNOWN_TASK: 'UNKNOWN_TASK',                 // 422
  PROJECT_MISMATCH: 'PROJECT_MISMATCH',         // 422
  INTERNAL_ERROR: 'INTERNAL_ERROR',             // 500
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',   // 503
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>>;   // the numbers above
```

### 2.2 Exact messages (ADR-023 — shown verbatim by the UI)

`→` is U+2192, statuses are the raw enum values. `<x>` = the offending value.

| Code | `message` | `details` |
|---|---|---|
| `INVALID_JSON` | `Content-Type must be application/json` · `Request body is not valid JSON` · `Content-Encoding is not supported` *(ADR-037)* | — |
| `VALIDATION_ERROR` | `Validation failed: <path>: <issue message>` for the first issue, plus ` (+<n> more)` when n > 0 more issues; root path shown as `body`/`query` | `ValidationIssue[]` (all issues) |
| `HOST_NOT_ALLOWED` | `Host not allowed: <host>` | — |
| `ORIGIN_NOT_ALLOWED` *(ADR-037)* | `Origin not allowed` | — |
| `NOT_FOUND` | `Route not found: <METHOD> <path>` | — |
| `AGENT_NOT_FOUND` | `Agent not found: <id>` | — |
| `TASK_NOT_FOUND` | `Task not found: <id>` | — |
| `ILLEGAL_TRANSITION` (agent) | `Illegal transition: <from> → <to>` | `IllegalTransitionDetails` (`entity:"agent"`) |
| `ILLEGAL_TRANSITION` (task) | `Illegal task transition: <from> → <to> (task <id>)` | `entity:"task"` |
| `ILLEGAL_TRANSITION` (progress on terminal task) | `Task <id> is <status>; progress cannot change` | `entity:"task", from = to = <status>` |
| `TASK_EXISTS` | `Task already exists: <id>` | `{ id }` |
| `PAYLOAD_TOO_LARGE` | `Request body exceeds 100 KB` | — |
| `UNKNOWN_AGENT` | `Unknown agent: <id>` | `{ agentId }` |
| `UNKNOWN_PROJECT` | `Unknown project: <value as sent>` | `{ project }` |
| `UNKNOWN_TASK` (lifecycle event / blockedBy) | `Unknown task: <id>` | `{ taskId }` |
| `UNKNOWN_TASK` (`agent.task.assigned` new task, no project) | `Task <id> does not exist; include project to create it` | `{ taskId }` |
| `PROJECT_MISMATCH` | `Task <taskId> belongs to project <taskProject>, not <eventProject>` | `ProjectMismatchDetails` |
| `INTERNAL_ERROR` | `Internal server error` | — |
| `SERVICE_UNAVAILABLE` | `Database is not available` | `HealthErrorDetails` |
| `SERVICE_UNAVAILABLE` (boot not finished, *ADR-035*) | `Server is starting` | `{ status: "starting", uptimeSec, version, time }` |

Required custom Zod issue messages (all other issue messages may be Zod defaults):

| Case | path | message |
|---|---|---|
| unknown key | `<key>` (prefixed by parent path) | `Unrecognized key` |
| `type` missing | `type` | `Event type is required` |
| `type` not a known type | `type` | `Unknown event type: <value>` |
| `type` server-only (`task.*`) | `type` | `Event type <value> is server-only` |
| reserved `source` | `source` | `Source "<value>" is reserved` |
| `metadata` > 8 KB | `metadata` | `Metadata exceeds 8 KB` |
| `blockedBy` contains the task's own id | `blockedBy` | `A task cannot block itself` |
| reserved task id `__proto__` / `constructor` / `prototype` *(ADR-037)* | path of the id field | `Task id "<value>" is reserved` |
| PATCH task empty | `` (root) | `At least one field is required` |
| POST task status/assignee mismatch | `status` | `Status "assigned" requires assignedAgentId` · `A task with an assignee must start as "assigned"` |

`toValidationIssues(error: ZodError): ValidationIssue[]` (shared, §5.2) performs the mapping, including
expanding a Zod `unrecognized_keys` issue into one issue per key.

---

## 3. REST endpoints

Legend for status codes: ✔ success, ✘ error. Every endpoint can also return 500 `INTERNAL_ERROR`,
403 `HOST_NOT_ALLOWED`; POST/PATCH can also return 400 `INVALID_JSON` and 413 `PAYLOAD_TOO_LARGE`.

| # | Method & path | Success | Purpose (REQ) |
|---|---|---|---|
| 3.1 | `GET /api/health` | 200 `HealthData` | REQ-025 |
| 3.2 | `GET /api/projects` | 200 `Project[]` | REQ-026 |
| 3.3 | `GET /api/agents` | 200 `Agent[]` | REQ-001, 002 |
| 3.4 | `GET /api/agents/:id` | 200 `Agent` | REQ-002 |
| 3.5 | `PATCH /api/agents/:id/status` | 200 `WriteResult` | REQ-004, 102 |
| 3.6 | `GET /api/events` | 200 paged `OfficeEvent[]` | REQ-024 |
| 3.7 | `POST /api/events` | 201 `OfficeEventPayload` | REQ-020–023 |
| 3.8 | `GET /api/tasks` | 200 `Task[]` | REQ-040 |
| 3.9 | `POST /api/tasks` | 201 `OfficeEventPayload` | REQ-040 |
| 3.10 | `PATCH /api/tasks/:id` | 200 `WriteResult` | REQ-041 |
| 3.11 | `GET /api/snapshot` | 200 `Snapshot` | REQ-052, ADR-010 |
| 3.12 | `GET /api/demo` | 200 `DemoState` | REQ-110 |
| 3.13 | `POST /api/demo/start` | 200 `DemoState` | REQ-110, 111 |
| 3.14 | `POST /api/demo/stop` | 200 `DemoStopResult` | REQ-110, 112 |

### 3.1 `GET /api/health`

- Query: none (ignored). Checks the DB with `DatabaseHandle.ping()`.
- ✔ 200 `{ "data": { "status": "ok", "db": "ok", "uptimeSec": 12, "version": "0.1.0", "time": "2026-10-03T22:41:07.123Z" } }`
  — `uptimeSec` = `Math.floor(process.uptime())`, `version` = `APP_VERSION`.
- ✘ 503 `SERVICE_UNAVAILABLE`, `details: { "status": "error", "db": "error", uptimeSec, version, time }`; logged `error` `db_error`.
- ✘ 503 `SERVICE_UNAVAILABLE` `Server is starting`, `details: { "status": "starting", uptimeSec, version, time }` while the
  listen-first boot has not finished (§9.8). Every other `/api/*` request answers the same 503 in that window
  (header `Retry-After: 1`). *(ADR-035)*

### 3.2 `GET /api/projects`

- Query: none. ✔ 200 `{ "data": Project[] }` — exactly the 4 stored projects ordered Sellway, Ishkun24, ERP, Ana Market. "All Projects" is never returned (A-01).

### 3.3 `GET /api/agents`

| Query | Type | Rule |
|---|---|---|
| `project` | string, 1–100 | optional; id or name; filter `currentProject = <id>` |

- ✔ 200 `{ "data": Agent[] }` ordered by agent number (`01…15`).
- ✘ 400 `VALIDATION_ERROR` (unknown query key, empty `project`), 422 `UNKNOWN_PROJECT`.

### 3.4 `GET /api/agents/:id`

- ✔ 200 `{ "data": Agent }` · ✘ 404 `AGENT_NOT_FOUND` (any unknown id string).

### 3.5 `PATCH /api/agents/:id/status`

Operator status change, processed as an `agent.status.changed` event through `EventService` (REQ-004,
ADR-022). Used by the Developer Simulator status buttons with `source: "simulator"`.

Body (strict):

| Field | Type / limits | Default | Notes |
|---|---|---|---|
| `status` | `AgentStatus` | required | |
| `source` | string 1–50, `^[a-z0-9._-]+$`, not `demo`/`system` | `"api"` | simulator sends `"simulator"` |
| `project` | string 1–100 (id or name) | — | |
| `taskId` | `TASK_ID_PATTERN` | — | unknown task ids are allowed (bound to the agent, no task created, ES §5.1) |
| `action` | string 1–100 | — | becomes `currentAction` |
| `message` | string ≤ 2000 | — | becomes `lastMessage` |
| `force` | boolean | `false` | ADR-015: skips only transition legality (agent + coupled task) |

Processing (inside one transaction): schema → 404 `AGENT_NOT_FOUND` → resolve `project` (422
`UNKNOWN_PROJECT`) → build the `agent.status.changed` input and call `decideEvent` → a `reject` decision
(422 `PROJECT_MISMATCH`, 409 `ILLEGAL_TRANSITION`) is returned as the error → **if `status === agent.status`
the accepted decision is discarded: full no-op** (nothing written or broadcast) → otherwise commit →
broadcast.

- ✔ 200 `{ "data": { "event": OfficeEvent, "agent": Agent, "task": Task | null } }` (event type `agent.status.changed`, `forced` true only if a transition was actually forced).
- ✔ 200 no-op `{ "data": { "event": null, "agent": Agent, "task": null } }` — nothing stored, nothing broadcast.
- ✘ 400 `VALIDATION_ERROR` · 404 `AGENT_NOT_FOUND` · 422 `UNKNOWN_PROJECT` / `PROJECT_MISMATCH` · 409 `ILLEGAL_TRANSITION`.

Example: `PATCH /api/agents/04-backend-engineer/status` `{"status":"completed","source":"simulator"}` on an idle
agent → 409 `{"error":{"code":"ILLEGAL_TRANSITION","message":"Illegal transition: idle → completed","details":{"entity":"agent","id":"04-backend-engineer","from":"idle","to":"completed"}}}`.

### 3.6 `GET /api/events`

| Query | Type | Default | Rule |
|---|---|---|---|
| `project` | string 1–100 (id or name) | — | feed predicate: `project = P` OR (`project IS NULL` AND `type IN (system.warning, system.error)`) (ES §8.3) |
| `agentId` | string 1–64 | — | must exist (422 `UNKNOWN_AGENT`); `agent_id = agentId` |
| `taskId` | `TASK_ID_PATTERN` | — | `task_id = taskId`; existence not checked |
| `type` | `EventType` (15) | — | single value |
| `source` | `SOURCE_PATTERN` | — | exact match (reserved sources allowed here) |
| `before` | integer ≥ 1 | — | returns events with `seq < before` |
| `limit` | integer 1–500 | 50 | |

All given filters are AND-combined. Order: `seq` descending (newest first).
`page.nextBefore` = `seq` of the last (oldest) returned event if at least one older matching event exists
(server fetches `limit + 1` rows), else `null`.

- ✔ 200 `{ "data": OfficeEvent[], "page": { "limit": 50, "nextBefore": 812 } }`
- ✘ 400 `VALIDATION_ERROR` (bad number, unknown type, unknown key) · 422 `UNKNOWN_PROJECT` / `UNKNOWN_AGENT`.

### 3.7 `POST /api/events`

Body: `EventInputBody` validated by `producerEventInputSchema` (discriminated union on `type`, strict,
§1.4). Field rules (ES §2.1):

| Field | Rule |
|---|---|
| `type` | one of the 13 producer types; `task.*` → 400 server-only |
| `source` | 1–50, `^[a-z0-9._-]+$`, default `"api"`; `demo`/`system` → 400 |
| `agentId` | 1–64 chars; must exist (422 `UNKNOWN_AGENT`) |
| `project` | 1–100 chars; id or name (422 `UNKNOWN_PROJECT`) |
| `taskId` | `^[A-Za-z0-9._-]{1,64}$` |
| `status` | `AgentStatus`, only on types that allow it (ES §3) |
| `action` | 1–100 chars |
| `message` | ≤ 2000 chars (required types: 1–2000) |
| `severity` | `info` \| `warning` \| `error` (default ES §2.3) |
| `progress` | integer 0–100 |
| `metadata` | JSON object (not array/null), `JSON.stringify` ≤ 8192 UTF-8 bytes |
| `occurredAt` | ISO-8601 datetime with `Z` or offset |
| (`force`, `id`, `seq`, `createdAt`, …) | not keys → 400 `Unrecognized key` |

- ✔ 201 `{ "data": OfficeEventPayload }` — `agent` is the updated agent for every `agent.*` event (at least `lastActivityAt` changes); `null` for `system.*`. `task` = created/updated task, or `null` when no task row changed.
- ✘ 400 `VALIDATION_ERROR` · 422 `UNKNOWN_AGENT` / `UNKNOWN_PROJECT` / `UNKNOWN_TASK` / `PROJECT_MISMATCH` · 409 `ILLEGAL_TRANSITION`.

§12 example on a fresh seed → 201; response and effects exactly as ES §11.

### 3.8 `GET /api/tasks`

| Query | Type | Default | Rule |
|---|---|---|---|
| `project` | string 1–100 | — | `project = <id>` (422 `UNKNOWN_PROJECT`) |
| `agentId` | string 1–64 | — | `assignedAgentId = agentId` (422 `UNKNOWN_AGENT`) |
| `status` | `TaskStatus` | — | (400 if invalid) |
| `limit` | integer 1–500 | 500 | |

Order: `createdAt` ascending, then `id` ascending. ✔ 200 `{ "data": Task[] }` (no paging in Phase 1).

### 3.9 `POST /api/tasks`

Body (strict, `taskCreateSchema`):

| Field | Type / limits | Default | Rule |
|---|---|---|---|
| `id` | `TASK_ID_PATTERN` | generated | generated = `<taskPrefix>-<n>`, n = 1 + max numeric suffix of ids matching `^<prefix>-\d+$` in that project's prefix (none → 1). Seed → next Sellway id `SW-126`. |
| `title` | string 1–200 | required | |
| `description` | string ≤ 5000 | `null` | |
| `project` | string 1–100 (id or name) | required | 422 `UNKNOWN_PROJECT` |
| `assignedAgentId` | string 1–64 | `null` | 422 `UNKNOWN_AGENT` |
| `priority` | `TaskPriority` | `"normal"` | |
| `status` | `"todo"` \| `"assigned"` | `"assigned"` if `assignedAgentId` else `"todo"` | `assigned` without assignee → 400; `todo` with assignee → 400 (ADR-024) |
| `blockedBy` | array of task ids, ≤ 20 | `[]` | duplicates removed (order kept); every id must exist (422 `UNKNOWN_TASK`); own id → 400 |
| `metadata` | JSON object ≤ 8 KB | `{}` | |

Check order: schema → project → assignee → blockedBy → `TASK_EXISTS` (409, explicit id only).
Writes one `task.created` event: `source "api"`, `agentId = assignedAgentId`, `project`, `taskId`,
`status = task.status`, `message = "Task created: <title>"`, `severity "info"`, `metadata {}`.

- ✔ 201 `{ "data": { "event": OfficeEvent, "agent": null, "task": Task } }` (task `version` 1, `progress` 0).
- ✘ 400 · 422 `UNKNOWN_PROJECT` / `UNKNOWN_AGENT` / `UNKNOWN_TASK` · 409 `TASK_EXISTS`.

### 3.10 `PATCH /api/tasks/:id`

Body (strict, `taskPatchSchema`, at least one field other than `force`):

| Field | Type | Notes |
|---|---|---|
| `title` | string 1–200 | |
| `description` | string ≤ 5000 \| `null` | `null` or empty string clears |
| `status` | `TaskStatus` | legality: `canTransitionTask(from, to, { owned: assigneeAfter !== null })` unless `force` |
| `priority` | `TaskPriority` | |
| `progress` | integer 0–100 | 409 on a terminal task (current status, or resulting status when `status` is also given) unless `force`; ignored (set to 100) when the result is `completed` |
| `assignedAgentId` | string 1–64 \| `null` | must exist (422); see auto-status rules |
| `blockedBy` | array of task ids, ≤ 20 | replaces the list; dedupe; must exist (422); own id → 400 |
| `metadata` | JSON object ≤ 8 KB | replaces the object |
| `force` | boolean | ADR-015 |

Auto-status rules (ADR-024), applied only when the body has **no** `status`:
`assignedAgentId` set on a `todo` task → status `assigned`; `assignedAgentId: null` on an `assigned` task →
status `todo`; any other combination leaves the status unchanged.
Side effects (ASM §5.3): first entry into `in_progress` → `startedAt = now` if null; entry into
`completed` → `completedAt = now`, `progress = 100`; leaving `completed` (force) → `completedAt = null`.
PATCH never changes agent rows (REQ-041).

No-op: if no provided field differs from the stored value (deep equality for arrays/objects) → nothing
stored or broadcast.

Event `task.updated`: `source "api"`, `agentId` = assignee after update (or `null`), `project`, `taskId`,
`status` = new status if it changed else `null`, `progress` = new progress if it changed else `null`,
`message = "Task updated: <title after update>"`, `severity "info"`,
`metadata { "changes": string[] }` (changed field names, sorted), `forced`.

- ✔ 200 `{ "data": { "event": OfficeEvent, "agent": null, "task": Task } }`
- ✔ 200 no-op `{ "data": { "event": null, "agent": null, "task": Task } }`
- ✘ 400 · 404 `TASK_NOT_FOUND` · 422 `UNKNOWN_AGENT` / `UNKNOWN_TASK` · 409 `ILLEGAL_TRANSITION`.

### 3.11 `GET /api/snapshot`

| Query | Type | Default | Rule |
|---|---|---|---|
| `project` | string 1–100 | — | applies **only** to `events` (feed predicate); agents/tasks are never filtered |
| `eventsLimit` | integer 1–500 | 50 | |

One synchronous read (consistent state). ✔ 200 `{ "data": Snapshot }`. ✘ 400 · 422 `UNKNOWN_PROJECT`.

*(ADR-035)* `lastSeq` = `MAX(events.seq)` (0 if empty) read in the same synchronous read, **before** any project
filter. Clients drop buffered `office:event` payloads with `event.seq <= lastSeq` when replaying after the snapshot
(§4). `tasks` = the newest 500 tasks (`createdAt` desc, then `id` desc) **plus** every task referenced by an agent's
`taskId`, returned in the `GET /api/tasks` order (`createdAt` asc, then `id`); with ≤ 500 tasks it equals
`GET /api/tasks`. `GET /api/tasks` itself is unchanged (oldest first, `limit` ≤ 500).

### 3.12 `GET /api/demo`

✔ 200 `{ "data": DemoState }`.

### 3.13 `POST /api/demo/start`

Body (strict): `{ "intervalMs"?: integer 2000–10000 }` (default `DEMO_DEFAULT_INTERVAL_MS`).
Idempotent: if demo is already active → 200 with the current state, nothing changes (the requested
interval is ignored). Otherwise one transaction persists the `demo` setting (§9.6) and writes a
`system.info` event (`source "system"`, `message "Demo mode started"`); after commit broadcasts
`office:event` and `demo:state`; logs `info` `demo_started`.

✔ 200 `{ "data": DemoState }` (`active: true`). ✘ 400.

### 3.14 `POST /api/demo/stop`

Body (strict): `{}`. Idempotent: not active → 200 `{ "data": { "demo": DemoState, "restored": null } }`.
Otherwise runs `restoreDemoSnapshot` (ADR-011) in one transaction, writes a `system.info` event
(`source "system"`, `message "Demo mode stopped: <a> agent(s) and <t> task(s) restored, <d> demo task(s) removed"` — singular for exactly 1, e.g. `1 agent and 0 tasks restored, 1 demo task removed` *(ADR-037)*,
`metadata` = the summary); after commit broadcasts `office:event`, `demo:state` (`active:false`),
`office:resync {reason:"demo-restored"}`; logs `info` `demo_stopped`.
*(ADR-035)* Restore never deletes a demo task that a surviving row still references — an agent's `taskId` after
the restore, or the `blockedBy` of a task that stays (transitively); such tasks are kept, counted in `tasksKept`
and logged `info` `demo_task_kept {reason:"referenced", taskIds}`. Only untouched tasks with `metadata.demo = true`
that are absent from the snapshot are deleted; a missing/invalid `demo` setting restores nothing (`demo_setting_invalid`).

✔ 200 `{ "data": { "demo": DemoState, "restored": DemoRestoreSummary } }`. ✘ 400.

---

## 4. Socket.IO

| Item | Value |
|---|---|
| Path / namespace | `/socket.io` / `/` (default). No rooms in Phase 1. |
| Transports | Socket.IO defaults (polling → websocket upgrade). |
| Server options | `cors: { origin: CORS_ORIGINS, methods: ['GET','POST'] }`, `allowRequest` = host guard (§0) **+ Origin rule + readiness** (below, *ADR-035*), `serveClient: false`. |
| Origin rule *(ADR-035)* | `allowRequest` runs for the polling handshake **and** a direct WebSocket upgrade (the `cors` option does not cover WebSocket). Order: Host guard → `Origin` header: allowed when **absent** (non-browser clients), when it is in `CORS_ORIGINS`, or when it is the server's own origin (`http(s)://<Host>`, one-port mode); anything else (incl. `null`, other ports, non-http schemes) is refused (handshake 403) → not ready (listen-first boot, §9.8) → refused. Every refusal logs `warn` `socket_rejected {reason: "host" \| "origin" \| "starting", host, origin}`. |
| Refusal response *(ADR-037)* | Socket.IO refusals are answered by engine.io, not with the REST error envelope: polling handshake → **403** `{"code":4,"message":"Host not allowed" \| "Origin not allowed" \| "Server is starting"}`; direct WebSocket upgrade → **400** with the same message as plain text. Clients must treat any `connect_error` as a refusal. The contract is the refusal itself (no session, nothing sent) and the `socket_rejected` log, not the body. |
| Client options (web) | `io({ path: '/socket.io', reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000, timeout: 10000 })` — same origin (dev proxy). One module-level instance. |
| Direction | Server → client only (REQ-051). The server registers **no** client event handlers; `socket.onAny` logs `debug` `socket_message_ignored {socketId, event}`. |
| Typing | `Server<ClientToServerEvents, ServerToClientEvents>` / `Socket<ServerToClientEvents, ClientToServerEvents>` (§1.5). |

| Message (`SOCKET_EVENTS`) | Payload | Sent when | Order |
|---|---|---|---|
| `office:event` | `OfficeEventPayload` | after every committed event (POST events, PATCH agent status, POST/PATCH tasks, demo ticks, demo start/stop `system.info`) — **never** for no-ops or rejections | commit (`seq`) order |
| `demo:state` | `DemoState` | demo start, stop, boot recovery (no clients usually) | after the `office:event` of the same operation |
| `office:resync` | `OfficeResyncPayload` | after a demo restore committed | last message of a stop |

Connection logging: `info` `socket_connected {socketId, clients}` / `socket_disconnected {socketId, clients, reason}`
(`clients` = connected sockets of the namespace after the change).

Client sync contract (ADR-010): on `connect` (first and every reconnect) and on `office:resync`: buffer
`office:event` payloads → `GET /api/snapshot?project=<URL filter>` → replace agents/tasks/feed/demo →
replay buffer through the reducer → done. Reducer: entity replaced only if `incoming.version >
stored.version` or unknown; feed row added only if `event.id` is new; feed capped at 200 newest.

---

## 5. `@vo/shared` — layout and exports

Package `packages/shared`, name `@vo/shared`, consumed as TS source (ADR-002). Rules: no `node:*`, no DOM
(`window`, `document`), no `express`/`react`/`phaser`/`socket.io*` imports (lint-enforced). Only runtime
dependency: `zod`. `TextEncoder` (a global in Node and browsers) may be used for byte lengths. Relative
imports inside the package, no extensions. `src/index.ts` re-exports every module below.

### 5.1 Files

```
packages/shared/src/
  index.ts                       export * from each module (and './adapters')
  constants/
    statuses.ts                  §1.2 statuses, priorities, severities
    eventTypes.ts                §1.2 event types, SOURCES, DEFAULT_SOURCE, RESERVED_SOURCES, PROJECTLESS_VISIBLE_TYPES
    rooms.ts                     ROOM_IDS, RoomId, ROOMS (§6.3)
    officeLayout.ts              OFFICE_WORLD, DESK_SLOT, OFFICE_ROOMS, OFFICE_ZOOM, AGENT_DISPLAY_ORDER (§6.4)
    actions.ts                   KNOWN_ACTIONS, SIMULATOR_ACTION_SUGGESTIONS
    limits.ts                    LIMITS, TASK_ID_PATTERN, SOURCE_PATTERN
    errorCodes.ts                §2.1
    labels.ts                    AGENT_STATUS_LABELS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, SEVERITY_LABELS
    palette.ts                   UI_COLORS, STATUS_COLORS, DEPARTMENT_COLORS, TASK_STATUS_COLOR_KEY, PRIORITY_COLORS
    app.ts                       APP_NAME, APP_VERSION, API_PREFIX, SOCKET_PATH, SOCKET_EVENTS, DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT
  types/
    json.ts agent.ts task.ts project.ts event.ts demo.ts api.ts socket.ts
  schemas/
    common.ts                    primitives (see 5.2)
    event.ts                     eventInputSchema, producerEventInputSchema
    agent.ts                     agentStatusPatchSchema
    task.ts                      taskCreateSchema, taskPatchSchema
    demo.ts                      demoStartSchema, demoStopSchema
    query.ts                     agentsQuerySchema, eventsQuerySchema, tasksQuerySchema, snapshotQuerySchema
    issues.ts                    toValidationIssues
  state/
    agentStateMachine.ts         AGENT_TRANSITIONS, canTransitionAgent, getAllowedAgentTargets, isActiveAgentStatus
    taskStateMachine.ts          TASK_TRANSITIONS, canTransitionTask, isTerminalTaskStatus, isActiveTaskStatus
    statusMapping.ts             AGENT_TO_TASK_STATUS, mapAgentStatusToTaskStatus
  filters/
    projectFilters.ts            eventMatchesProject, agentMatchesProject, taskMatchesProject
  reference/
    projects.ts                  PROJECTS, PROJECT_IDS, ALL_PROJECTS_LABEL, resolveProjectRef
    agents.ts                    AGENT_REFERENCE, AGENT_IDS, AgentReference
  adapters/                      owned by TASK-004 (index.ts starts as `export {}` from TASK-002)
    types.ts claudeCode.ts index.ts
  (tests colocated: *.test.ts)
```

### 5.2 Exports (signatures)

```ts
// constants/limits.ts
export const LIMITS = {
  BODY_BYTES: 102_400, METADATA_BYTES: 8_192, ACTION_MAX: 100, MESSAGE_MAX: 2_000, SOURCE_MAX: 50,
  AGENT_ID_MAX: 64, PROJECT_REF_MAX: 100, TASK_ID_MAX: 64, TITLE_MAX: 200, DESCRIPTION_MAX: 5_000,
  BLOCKED_BY_MAX: 20, LIST_MAX: 500, EVENTS_DEFAULT_LIMIT: 50, TASKS_DEFAULT_LIMIT: 500, FEED_CAP: 200,
  DEMO_INTERVAL_MIN_MS: 2_000, DEMO_INTERVAL_MAX_MS: 10_000, DEMO_INTERVAL_DEFAULT_MS: 3_000,
  REQUEST_TIMEOUT_MS: 10_000, HEALTH_TIMEOUT_MS: 5_000,
} as const;
export const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const RESERVED_TASK_IDS = ['__proto__', 'constructor', 'prototype'] as const;   // rejected by taskIdSchema (ADR-037)
export const SOURCE_PATTERN = /^[a-z0-9._-]{1,50}$/;

// constants/actions.ts
export const KNOWN_ACTIONS = ['read_file', 'write_file', 'edit_file', 'search', 'run_command', 'git_status',
  'git_diff', 'git_commit', 'test', 'build', 'browser', 'wait', 'error'] as const;          // REQ-132 (§19)
export const SIMULATOR_ACTION_SUGGESTIONS = ['run_tests', ...KNOWN_ACTIONS] as const;      // UX §9.3 order
export type KnownAction = (typeof KNOWN_ACTIONS)[number];

// constants/app.ts
export const APP_NAME = 'AI Virtual Office';
export const APP_VERSION = '0.1.0';
export const API_PREFIX = '/api';
export const SOCKET_PATH = '/socket.io';
export const SOCKET_EVENTS = { OFFICE_EVENT: 'office:event', DEMO_STATE: 'demo:state', OFFICE_RESYNC: 'office:resync' } as const;
export const DEFAULT_SERVER_PORT = 4000;
export const DEFAULT_WEB_PORT = 5173;

// constants/labels.ts (English UI copy, UX §1.2/§1.3)
export const AGENT_STATUS_LABELS: Readonly<Record<AgentStatus, string>>;   // idle→'Idle', planning→'Planning', working→'Working', waiting→'Waiting', reviewing→'Reviewing', completed→'Completed', failed→'Failed', offline→'Offline'
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>>;     // 'To do','Assigned','Planning','In progress','Waiting','In review','Completed','Failed','Cancelled'
export const TASK_PRIORITY_LABELS: Readonly<Record<TaskPriority, string>>; // 'Low','Normal','High','Critical'
export const SEVERITY_LABELS: Readonly<Record<Severity, string>>;          // 'Info','Warning','Error'

// constants/palette.ts — hex strings '#RRGGBB' copied from UX §1 (single source for React + Phaser, ADR-025)
export const UI_COLORS: { readonly bg: '#0B0D10'; readonly bgSunken: '#0E1014'; readonly panel: '#13161B'; readonly raised: '#1A1E24';
  readonly raisedHover: '#222730'; readonly borderSubtle: '#262B33'; readonly borderStrong: '#3A414C'; readonly textPrimary: '#E6E8EB';
  readonly textSecondary: '#A3AAB5'; readonly textMuted: '#8B939E'; readonly accent: '#5B8DEF'; readonly accentText: '#8AB0FF';
  readonly accentStrong: '#3B6FD9'; readonly accentTint: '#1A2230'; readonly roomFloor: '#15181D' };
export const STATUS_COLORS: Readonly<Record<AgentStatus, { color: string; chipTint: string }>>;  // UX §1.2 (e.g. working: '#3FB950' / '#1A3023')
export const DEPARTMENT_COLORS: Readonly<Record<RoomId, { color: string; avatarBg: string }>>;   // UX §1.4
export const TASK_STATUS_COLOR_KEY: Readonly<Record<TaskStatus, AgentStatus>>;  // todo→idle, assigned→planning, planning→planning, in_progress→working, waiting→waiting, review→reviewing, completed→completed, failed→failed, cancelled→offline
export const PRIORITY_COLORS: Readonly<Record<TaskPriority, string>>;  // low→textMuted, normal→textSecondary, high→'#E08A4F', critical→STATUS_COLORS.failed.color

// schemas/common.ts
export const agentIdSchema: z.ZodType<string>;        // trimmed 1–64
export const projectRefSchema: z.ZodType<string>;     // trimmed 1–100 (id or name, unresolved)
export const taskIdSchema: z.ZodType<string>;         // trimmed, TASK_ID_PATTERN, not in RESERVED_TASK_IDS (ADR-037)
export const sourceSchema: z.ZodType<string>;         // trimmed, SOURCE_PATTERN
export const agentStatusSchema; taskStatusSchema; taskPrioritySchema; severitySchema;   // z.enum(...)
export const progressSchema: z.ZodType<number>;       // int 0–100
export const actionSchema; messageSchema;             // trimmed 1–100 / 0–2000
export const metadataSchema: z.ZodType<JsonObject>;   // plain JSON object, ≤ METADATA_BYTES (TextEncoder byte length of JSON.stringify)
export const isoDateTimeSchema: z.ZodType<string>;    // z.iso.datetime({ offset: true })

// schemas/event.ts
export const eventInputSchema;            // discriminated union on `type` over PRODUCER_EVENT_TYPES; any valid source (incl. reserved) — used by in-process producers (demo)
export const producerEventInputSchema;    // eventInputSchema + reserved-source rejection + server-only/unknown type messages — used by POST /api/events and the web simulator
export type EventInputBody = z.input<typeof producerEventInputSchema>;

// schemas/agent.ts · task.ts · demo.ts · query.ts
export const agentStatusPatchSchema;   // §3.5 body
export const taskCreateSchema;         // §3.9 body (cross-field rules: status/assignee; blockedBy self-reference when id given)
export const taskPatchSchema;          // §3.10 body (≥ 1 field besides force)
export const demoStartSchema;          // { intervalMs?: int 2000–10000 }
export const demoStopSchema;           // strict {}
export const agentsQuerySchema; eventsQuerySchema; tasksQuerySchema; snapshotQuerySchema;  // input: Record<string,string>, output: typed numbers/enums with defaults

// schemas/issues.ts
export function toValidationIssues(error: z.ZodError): ValidationIssue[];

// state/agentStateMachine.ts
export const AGENT_TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>>;  // ASM §2.1 exactly (43 legal)
export function canTransitionAgent(from: AgentStatus, to: AgentStatus): boolean;        // false when from === to (not a transition)
export function getAllowedAgentTargets(from: AgentStatus): readonly AgentStatus[];
export function isActiveAgentStatus(status: AgentStatus): boolean;

// state/taskStateMachine.ts
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>>;     // ASM §5.2 exactly
export function canTransitionTask(from: TaskStatus, to: TaskStatus, options?: { owned?: boolean }): boolean;
  // false when from === to; when from === 'todo' && options.owned: legal iff to === 'assigned' || TASK_TRANSITIONS.assigned.includes(to) (implicit assignment, ADR-017)
export function isTerminalTaskStatus(status: TaskStatus): boolean;
export function isActiveTaskStatus(status: TaskStatus): boolean;

// state/statusMapping.ts
export const AGENT_TO_TASK_STATUS: Readonly<Partial<Record<AgentStatus, TaskStatus>>>;  // ASM §6
export function mapAgentStatusToTaskStatus(status: AgentStatus): TaskStatus | null;     // idle/offline → null

// filters/projectFilters.ts
export function eventMatchesProject(event: Pick<OfficeEvent, 'project' | 'type'>, projectId: string | null): boolean;
export function agentMatchesProject(agent: Pick<Agent, 'currentProject'>, projectId: string | null): boolean;  // null filter → true
export function taskMatchesProject(task: Pick<Task, 'project'>, projectId: string | null): boolean;

// reference/projects.ts · agents.ts (§6)
export const PROJECTS: readonly (Project & { sortOrder: number })[];
export const PROJECT_IDS: readonly string[];
export const ALL_PROJECTS_LABEL = 'All Projects';
export function resolveProjectRef(ref: string, projects: readonly Project[]): Project | null;  // trim + lowercase; match id or name
export interface AgentReference { id: string; code: string; name: string; role: string; shortRole: string; avatar: string;
  department: string; roomId: RoomId; deskId: string; sortOrder: number }
export const AGENT_REFERENCE: readonly AgentReference[];   // 15 rows, §6.1
export const AGENT_IDS: readonly string[];
```

### 5.3 Adapters (TASK-004, ADR-007, ES §10)

```ts
// adapters/types.ts
export interface ProducerAdapter<TRaw> {
  source: string;
  schema: z.ZodType<TRaw>;
  toCanonical(raw: TRaw): EventInputBody[];   // pure; output must pass producerEventInputSchema
}
export class AdapterError extends Error { constructor(readonly code: 'UNSUPPORTED_EVENT' | 'INVALID_PAYLOAD', message: string) }

// adapters/claudeCode.ts
export const claudeCodeEventSchema;           // z.looseObject: source 'claude-code', agentId, project?, taskId?, event, tool?, command?, result?
export type ClaudeCodeEvent = z.output<typeof claudeCodeEventSchema>;
export function mapClaudeToolToAction(tool: string, command?: string): string;   // ES §10.1 table
export const claudeCodeAdapter: ProducerAdapter<ClaudeCodeEvent>;

// adapters/index.ts
export const PRODUCER_ADAPTERS: Readonly<Record<string, ProducerAdapter<unknown>>>;  // { 'claude-code': claudeCodeAdapter } — not wired to any route in Phase 1
export * from './types'; export * from './claudeCode';
```

---

## 6. Reference data

### 6.1 Agents (`AGENT_REFERENCE`) — REQUIREMENTS §3.1 + desks from UX §5.2

| sortOrder | id | code | name | role | shortRole | roomId | department | deskId | avatar |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `01-pm-orchestrator` | PM | PM / Orchestrator | Project Manager / Orchestrator | PM | management | Management | `management-1` | `monogram:PM` |
| 2 | `02-product-analyst` | PA | Product Analyst | Product Analyst | Analyst | management | Management | `management-2` | `monogram:PA` |
| 3 | `03-architect` | ARC | Architect | System Architect | Architect | management | Management | `management-3` | `monogram:ARC` |
| 4 | `04-backend-engineer` | BE | Backend Engineer | Senior Backend Engineer | Backend | development | Development | `development-1` | `monogram:BE` |
| 5 | `05-frontend-engineer` | FE | Frontend Engineer | Senior Frontend Engineer | Frontend | development | Development | `development-2` | `monogram:FE` |
| 6 | `06-database-engineer` | DBE | Database Engineer | Database Engineer | Database | development | Development | `development-3` | `monogram:DBE` |
| 7 | `07-devops-engineer` | OPS | DevOps Engineer | DevOps Engineer | DevOps | infrastructure | Infrastructure | `infrastructure-1` | `monogram:OPS` |
| 8 | `08-security-engineer` | SEC | Security Engineer | Security Engineer | Security | infrastructure | Infrastructure | `infrastructure-2` | `monogram:SEC` |
| 9 | `09-qa-engineer` | QA | QA Engineer | QA Engineer | QA | quality | Quality | `quality-1` | `monogram:QA` |
| 10 | `10-ui-ux-designer` | UX | UI/UX Designer | UI/UX Designer | UI/UX | design | Design | `design-1` | `monogram:UX` |
| 11 | `11-mobile-engineer` | MOB | Mobile Engineer | Mobile Engineer | Mobile | development | Development | `development-4` | `monogram:MOB` |
| 12 | `12-ai-engineer` | AIE | AI Engineer | AI Engineer | AI | ai-lab | AI Lab | `ai-lab-1` | `monogram:AIE` |
| 13 | `13-documentation-engineer` | DOC | Documentation Engineer | Documentation Engineer | Docs | documentation | Documentation | `documentation-1` | `monogram:DOC` |
| 14 | `14-reviewer` | REV | Reviewer | Code Reviewer | Reviewer | quality | Quality | `quality-2` | `monogram:REV` |
| 15 | `15-product-auditor` | AUD | Product Auditor | Product Auditor | Auditor | audit | Audit | `audit-1` | `monogram:AUD` |

`avatar` format: `monogram:<code>` — the UI renders the code initials on the department color (UX §12).

### 6.2 Projects (`PROJECTS`)

| sortOrder | id | name | taskPrefix |
|---|---|---|---|
| 1 | `sellway` | Sellway | SW |
| 2 | `ishkun24` | Ishkun24 | IK |
| 3 | `erp` | ERP | ERP |
| 4 | `ana-market` | Ana Market | AM |

### 6.3 Rooms (`ROOMS`)

`readonly { id: RoomId; label: string }[]` in this order: management "Management", development
"Development", design "Design", infrastructure "Infrastructure", quality "Quality", ai-lab "AI Lab",
documentation "Documentation", audit "Audit". `label` equals the agents' `department`.

### 6.4 Office layout (`constants/officeLayout.ts`) — copied from UX §5.2, canonical

```ts
export const OFFICE_WORLD = { width: 1140, height: 540 } as const;
export const DESK_SLOT = { width: 116, height: 200 } as const;
export const OFFICE_ZOOM = { max: 1.6, compactBelow: 0.7 } as const;    // UX §2.2 / §5.5
export interface OfficeDesk { deskId: string; x: number; y: number }   // slot top-left, world px
export interface OfficeRoom { roomId: RoomId; label: string; x: number; y: number; width: number; height: number; desks: readonly OfficeDesk[] }
export const OFFICE_ROOMS: readonly OfficeRoom[];
export const AGENT_DISPLAY_ORDER: readonly string[];  // office reading order (UX §6): 01,02,03,04,05,06,11,10,07,08,09,14,12,13,15 (full ids)
```

| roomId | x | y | width | height | desks (deskId: x, y) |
|---|---|---|---|---|---|
| management | 16 | 16 | 412 | 248 | management-1: 36,56 · management-2: 164,56 · management-3: 292,56 |
| development | 440 | 16 | 516 | 248 | development-1: 448,56 · development-2: 576,56 · development-3: 704,56 · development-4: 832,56 |
| design | 968 | 16 | 156 | 248 | design-1: 988,56 |
| infrastructure | 16 | 276 | 280 | 248 | infrastructure-1: 34,316 · infrastructure-2: 162,316 |
| quality | 308 | 276 | 280 | 248 | quality-1: 326,316 · quality-2: 454,316 |
| ai-lab | 600 | 276 | 168 | 248 | ai-lab-1: 626,316 |
| documentation | 780 | 276 | 168 | 248 | documentation-1: 806,316 |
| audit | 960 | 276 | 164 | 248 | audit-1: 984,316 |

Shared tests assert: every `AGENT_REFERENCE.deskId` exists exactly once in `OFFICE_ROOMS` and its room
matches the agent's `roomId`; desks of a room are inside the room rect; `AGENT_DISPLAY_ORDER` is a
permutation of `AGENT_IDS`.

---

## 7. Seed baseline (binding for TASK-003; REQ-120/121)

### 7.1 Tasks (11)

| id | title | project | assignee | status | priority | progress | blockedBy |
|---|---|---|---|---|---|---|---|
| SW-123 | Lost Goods API | sellway | 04-backend-engineer | assigned | high | 0 | — |
| SW-124 | Dashboard performance optimization | sellway | 05-frontend-engineer | in_progress | normal | 40 | — |
| SW-125 | Campaign analytics | sellway | — | todo | low | 0 | — |
| IK-201 | Vacancy posting workflow | ishkun24 | 10-ui-ux-designer | completed | normal | 100 | — |
| IK-202 | Recruitment pipeline | ishkun24 | 06-database-engineer | waiting | high | 20 | IK-203 |
| IK-203 | Telegram bot integration | ishkun24 | 12-ai-engineer | planning | normal | 10 | — |
| ERP-301 | Inventory architecture | erp | 03-architect | review | high | 70 | — |
| ERP-302 | Order management module | erp | 09-qa-engineer | failed | critical | 55 | — |
| ERP-303 | CRM integration | erp | 08-security-engineer | assigned | normal | 0 | — |
| AM-401 | Seller dashboard | ana-market | 11-mobile-engineer | in_progress | high | 65 | — |
| AM-402 | Marketplace integration | ana-market | — | todo | critical | 0 | — |

Each task gets a one-sentence `description`; `createdAt` 1–3 h ago; `startedAt` set for tasks that passed
`in_progress` (SW-124, IK-201, ERP-301, ERP-302, AM-401); `completedAt` for IK-201; `version` 1.

### 7.2 Agent states (15)

| Agent | status | currentProject | taskId / currentTask | progress | startedAt | currentAction |
|---|---|---|---|---|---|---|
| 01 PM | working | erp | — | 0 | ~25 min ago | `assign_task` |
| 02 PA | idle | sellway | — | 0 | — | — |
| 03 ARC | reviewing | erp | ERP-301 Inventory architecture | 70 | set | `review` |
| 04 BE | **idle** | sellway | — | 0 | — | — |
| 05 FE | working | sellway | SW-124 | 40 | set | `edit_file` |
| 06 DBE | waiting | ishkun24 | IK-202 | 20 | set | `wait` |
| 07 OPS | **offline** (`online:false`) | erp | — | 0 | — | — |
| 08 SEC | idle | — | — (ERP-303 is assigned but not bound, ADR-017) | 0 | — | — |
| 09 QA | failed | erp | ERP-302 | 55 | set (kept) | — |
| 10 UX | completed | ishkun24 | IK-201 | 100 | set (kept) | — |
| 11 MOB | working | ana-market | AM-401 | 65 | set | `build` |
| 12 AIE | planning | ishkun24 | IK-203 | 10 | set | — |
| 13 DOC | idle | — | — | 0 | — | — |
| 14 REV | idle | sellway | — | 0 | — | — |
| 15 AUD | idle | — | — | 0 | — | — |

All agents `lastActivityAt` within the last 2 h, a realistic `lastMessage` for non-idle agents,
`metadata {}`, `version` 1. Resulting All-Projects metrics: Online 14, Working 3, Planning 1, Waiting 1,
Reviewing 1, Failed 1, Active Tasks 7, Completed Tasks 1.

### 7.3 History

≥ 30 events (target 40) with `createdAt` spread over the past ~2 h, ascending `seq` in chronological order,
all 4 projects, ≥ 6 event types incl. `agent.task.assigned/started/progress/completed/failed`,
`agent.activity`, `agent.status.changed`, `agent.disconnected` (OPS), one `system.warning` without project,
one `agent.task.failed` with severity `error`; sources `api`/`simulator` only (never `demo`). History must
be **consistent** with §7.1/§7.2 (the last status event of each agent leads to its seeded state). A seed
test asserts ASM §4 invariants for every agent, REQ-121 (BE idle, SW-123 assigned to BE), and that every
event `agentId`/`project` exists.

---

## 8. Database schema (TASK-003; ADR-003/004)

Driver `node:sqlite` `DatabaseSync`. Pragmas on open: `journal_mode = WAL` (file DBs only),
`foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`. Migrations: ordered array
`{ version, name, sql }` in `apps/server/src/db/migrations/`; `runMigrations` applies all with
`version > PRAGMA user_version` inside one `BEGIN IMMEDIATE … COMMIT`, setting `PRAGMA user_version = <n>`
in the same transaction; forward-only; failure rolls back and aborts startup. Phase 1 = migration
`1 / init`.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, task_prefix TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  short_role TEXT NOT NULL, avatar TEXT NOT NULL, department TEXT NOT NULL, room_id TEXT NOT NULL,
  desk_id TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle','planning','working','waiting','reviewing','completed','failed','offline')),
  current_project TEXT NULL REFERENCES projects(id), current_task TEXT NULL, task_id TEXT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  started_at TEXT NULL, last_activity_at TEXT NULL, current_action TEXT NULL, last_message TEXT NULL,
  online INTEGER NOT NULL CHECK (online IN (0,1)), metadata TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id), assigned_agent_id TEXT NULL REFERENCES agents(id),
  status TEXT NOT NULL CHECK (status IN ('todo','assigned','planning','in_progress','waiting','review','completed','failed','cancelled')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL, started_at TEXT NULL, completed_at TEXT NULL,
  blocked_by TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assigned_agent_id);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, source TEXT NOT NULL,
  agent_id TEXT NULL REFERENCES agents(id), project_id TEXT NULL REFERENCES projects(id), task_id TEXT NULL,
  status TEXT NULL, action TEXT NULL, message TEXT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  progress INTEGER NULL CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  metadata TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NULL, created_at TEXT NOT NULL,
  forced INTEGER NOT NULL DEFAULT 0 CHECK (forced IN (0,1))
);
CREATE INDEX idx_events_project_seq ON events(project_id, seq);
CREATE INDEX idx_events_agent_seq ON events(agent_id, seq);
CREATE INDEX idx_events_type_seq ON events(type, seq);
CREATE INDEX idx_events_task_seq ON events(task_id, seq);
CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL );
```

Mapping: snake_case ↔ camelCase in `db/mappers.ts`; booleans 0/1; JSON columns parsed/serialized;
`tasks.project_id` ↔ `Task.project`; `events.project_id` ↔ `OfficeEvent.project`; `agents.sort_order`,
`projects.sort_order/created_at` are not exposed. No FK on `events.task_id` / `agents.task_id` (tasks can be
deleted by demo restore). Agents are never deleted. All SQL uses prepared statements with parameters.

---

## 9. Server internal contracts

### 9.1 Ownership of contract files (ADR-028)

| File | Created by | Then owned by | Consumers |
|---|---|---|---|
| `apps/server/src/db/types.ts` | TASK-002 (verbatim from §9.2) | TASK-003 | TASK-005, TASK-008 |
| `apps/server/src/realtime/broadcaster.ts` | TASK-005 | TASK-005 | TASK-008 |
| `apps/server/src/errors.ts`, `logger.ts`, `config.ts` | TASK-005 | TASK-005 | TASK-008 |
| `apps/server/src/index.ts` (stub) | TASK-001 | TASK-008 | — |

Signature changes require a tech-lead contract update first.

### 9.2 `apps/server/src/db/types.ts` (exact)

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { Agent, EventType, JsonValue, OfficeEvent, Project, Task, TaskStatus } from '@vo/shared';

export type AgentMutableField = 'status' | 'currentProject' | 'currentTask' | 'taskId' | 'progress' | 'startedAt'
  | 'lastActivityAt' | 'currentAction' | 'lastMessage' | 'online' | 'metadata';
export type AgentPatch = Partial<Pick<Agent, AgentMutableField>>;
export type TaskMutableField = 'title' | 'description' | 'status' | 'priority' | 'progress' | 'assignedAgentId'
  | 'startedAt' | 'completedAt' | 'blockedBy' | 'metadata';
export type TaskPatch = Partial<Pick<Task, TaskMutableField>>;
export type NewTask = Omit<Task, 'version' | 'updatedAt'>;
export type NewEvent = Omit<OfficeEvent, 'seq'>;                    // id + createdAt assigned by EventService
export type EventDraft = Omit<OfficeEvent, 'seq' | 'id' | 'createdAt'>;  // produced by pure rules

export interface EventListQuery {
  projectId?: string;            // feed predicate (ES §8.3)
  agentId?: string; taskId?: string; type?: EventType; source?: string;
  before?: number;               // seq < before
  limit: number;                 // 1–500
}
export interface EventListResult { events: OfficeEvent[]; nextBefore: number | null }
export interface TouchedEntities { agentIds: Set<string>; taskIds: Set<string> }

export interface ProjectRepository {
  list(): Project[];                                              // ORDER BY sort_order
  getById(id: string): Project | null;
  insert(project: Project & { sortOrder: number }, now: string): void;
}
export interface AgentRepository {
  list(filter?: { projectId?: string }): Agent[];                 // ORDER BY sort_order
  getById(id: string): Agent | null;
  count(): number;
  insert(agent: Agent & { sortOrder: number }, now: string): void;   // seed only; stores agent.version as given
  update(id: string, patch: AgentPatch, now: string): Agent;      // applies patch, version = version + 1, updated_at = now; throws if id unknown
  replace(agent: Agent, now: string): Agent;                      // demo restore: writes all mutable fields of `agent`, version = current + 1 (ignores agent.version)
}
export interface TaskRepository {
  list(filter?: { projectId?: string; agentId?: string; status?: TaskStatus; limit?: number }): Task[];  // ORDER BY created_at, id; default limit 500
  getById(id: string): Task | null;
  existingIds(ids: readonly string[]): Set<string>;
  count(): number;
  maxNumericSuffix(prefix: string): number | null;               // max n over ids matching ^<prefix>-(\d+)$; null if none
  insert(task: NewTask, now: string): Task;                       // version 1, updated_at = now
  update(id: string, patch: TaskPatch, now: string): Task;        // version + 1; throws if id unknown
  replace(task: Task, now: string): Task;                         // demo restore: all mutable fields, version = current + 1
  delete(id: string): boolean;                                    // demo restore only
}
export interface EventRepository {
  insert(event: NewEvent): OfficeEvent;                           // assigns seq
  list(query: EventListQuery): EventListResult;                   // seq DESC; fetches limit + 1 to compute nextBefore
  maxSeq(): number;                                               // 0 when empty
  count(): number;
  touchedSince(startSeq: number): TouchedEntities;                // ADR-011: agents = agent_id of type 'agent.%' events, tasks = task_id of any type; seq > startSeq AND source <> 'demo'
}
export interface SettingsRepository {
  get(key: string): JsonValue | null;
  set(key: string, value: JsonValue, now: string): void;          // upsert
  delete(key: string): boolean;
}
export interface Repositories {
  projects: ProjectRepository; agents: AgentRepository; tasks: TaskRepository;
  events: EventRepository; settings: SettingsRepository;
}
export interface DatabaseHandle {
  readonly db: DatabaseSync;
  readonly path: string;                                          // ':memory:' or absolute file path
  readonly repos: Repositories;
  readonly schemaVersion: number;
  /** BEGIN IMMEDIATE … COMMIT; ROLLBACK and rethrow on throw. `fn` must be synchronous: a returned thenable
   *  causes ROLLBACK and an Error('Transaction callback must be synchronous'). Nested calls throw. */
  transaction<T>(fn: (repos: Repositories) => T): T;
  ping(): boolean;                                                // SELECT 1; false on error (never throws)
  close(): void;                                                  // idempotent
}
```

Implementations (TASK-003): `db/connection.ts` → `export function openDatabase(options: { path: string }): DatabaseHandle`
(creates the parent directory of a file path, applies pragmas, runs migrations, builds repositories);
`db/migrations/index.ts` → `export const MIGRATIONS: readonly Migration[]; export function runMigrations(db: DatabaseSync): { from: number; to: number }`;
`seed/seed.ts` → `export function seedIfEmpty(handle: DatabaseHandle, now?: Date): { seeded: boolean; agents: number; tasks: number; events: number }`
(runs only when `agents.count() === 0`, one transaction); `seed/reset.ts` CLI (§12.3).

### 9.3 `logger.ts`, `errors.ts`, `config.ts` (TASK-005)

```ts
// logger.ts — JSON lines {time, level, msg, ...ctx}; warn/error → stderr, others → stdout (ADR-018)
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}
export function createLogger(options: { level: LogLevel; write?: (line: string, level: Exclude<LogLevel, 'silent'>) => void }): Logger;

// errors.ts (ADR-020) — messages per §2.2
export class AppError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly details?: unknown);
}
export const appErrors: {
  invalidJson(kind: 'content-type' | 'parse'): AppError;
  validation(issues: ValidationIssue[], scope?: 'body' | 'query'): AppError;
  hostNotAllowed(host: string): AppError;
  routeNotFound(method: string, path: string): AppError;
  agentNotFound(id: string): AppError;
  taskNotFound(id: string): AppError;
  illegalAgentTransition(id: string, from: AgentStatus, to: AgentStatus): AppError;
  illegalTaskTransition(id: string, from: TaskStatus, to: TaskStatus): AppError;
  terminalTaskProgress(id: string, status: TaskStatus): AppError;
  taskExists(id: string): AppError;
  payloadTooLarge(): AppError;
  unknownAgent(id: string): AppError;
  unknownProject(ref: string): AppError;
  unknownTask(id: string): AppError;
  unknownTaskForCreate(id: string): AppError;
  projectMismatch(taskId: string, taskProject: string, eventProject: string): AppError;
  internal(): AppError;
  serviceUnavailable(details: HealthErrorDetails): AppError;
};
export function toErrorBody(error: AppError): ApiErrorBody;

// config.ts (§11)
export interface AppConfig {
  port: number; host: string; dbPath: string; logLevel: LogLevel; corsOrigins: string[];
  serveWeb: boolean; demoDefaultIntervalMs: number; repoRoot: string; webDistPath: string;
}
export class ConfigError extends Error {}
export function loadConfig(options?: { env?: Record<string, string | undefined>; argv?: readonly string[]; loadDotEnv?: boolean }): AppConfig;
export function isLoopbackHost(host: string): boolean;
```

Stable log `msg` keys: `server_started {host, port, dbPath, serveWeb}`, `server_stopping {signal}`,
`server_stopped`, `non_loopback_host {host}` (warn), `migrations_applied {from, to}`,
`seed_applied {agents, tasks, events}`, `request_failed {status, code, method, route}` (4xx warn, 5xx error
+ `err` stack), `event_rejected {code, type, agentId, source}` (warn), `forced_transition {entity, id, from, to}`
(warn), `socket_connected` / `socket_disconnected` (info), `socket_message_ignored` (debug), `db_error`
(error), `demo_started {intervalMs, startSeq}`, `demo_stopped {reason, ...summary}`, `demo_recovered {...summary}`,
`demo_event_rejected {code, type, agentId}` (warn), `uncaught_exception` (error, then exit 1).
*(ADR-035)* `socket_rejected {reason, host, origin}` (warn), `demo_task_kept {reason, taskIds}` (info),
`demo_setting_invalid {key}` (warn), `shutdown_timeout {afterMs}` / `shutdown_failed` (error), `web_dist_missing` (warn).

### 9.4 Pure rules — `services/eventEffects.ts`, `services/taskRules.ts` (TASK-005)

```ts
// eventEffects.ts — ASM §4, ES §4–5; no DB, no clock, no sockets
export interface EventDecisionInput {
  input: EventInput;           // parsed (eventInputSchema / producerEventInputSchema)
  source: string;              // input.source ?? 'api'
  agent: Agent | null;         // loaded by input.agentId (existence already checked by the service → 422 otherwise)
  task: Task | null;           // existing task with id input.taskId, or null
  projectId: string | null;    // resolved explicit project id, or null if input.project absent
  now: string;
  force: boolean;              // true only from PATCH /api/agents/:id/status with force
}
export interface ForcedTransition { entity: 'agent' | 'task'; id: string; from: string; to: string }
export type TaskEffect =
  | { op: 'create'; task: NewTask }
  | { op: 'update'; id: string; patch: TaskPatch };
export type EventDecision =
  | { kind: 'accept'; event: EventDraft; agentPatch: AgentPatch | null; taskEffect: TaskEffect | null; forced: ForcedTransition[] }
  | { kind: 'reject'; error: AppError };   // UNKNOWN_TASK, PROJECT_MISMATCH, ILLEGAL_TRANSITION
export function decideEvent(input: EventDecisionInput): EventDecision;
export function defaultSeverity(type: EventType, resultingStatus: AgentStatus | null): Severity;

// taskRules.ts — Tasks API rules (ADR-024); references (project, assignee, blockedBy, TASK_EXISTS) checked by the service first
export function decideTaskCreate(input: { body: TaskCreateInput; projectId: string; id: string; now: string }):
  { kind: 'accept'; task: NewTask; event: EventDraft } | { kind: 'reject'; error: AppError };
export function decideTaskPatch(input: { task: Task; body: TaskPatchInput; now: string }):
  | { kind: 'noop' }
  | { kind: 'accept'; patch: TaskPatch; event: EventDraft; forced: ForcedTransition | null }
  | { kind: 'reject'; error: AppError };
```

`agentPatch` includes `lastActivityAt` for every agent event; `version`/`updated_at` are handled by the
repository. `EventDraft.forced` = `forced.length > 0`.

### 9.5 Demo storyline — `services/demoScript.ts` (TASK-005)

```ts
export interface DemoWorld {
  agents: readonly Agent[];
  tasks: ReadonlyMap<string, Task>;          // current rows of demo tasks (ids from this session)
  touchedAgentIds: ReadonlySet<string>;      // skip these agents (user wins)
  projects: readonly Project[];
  sessionKey: number;                         // demo startSeq; makes task ids unique per session
}
export interface DemoCursor { cycle: number; beat: number }   // cycle ≥ 1, beat 1–13 (ES §9)
export const INITIAL_DEMO_CURSOR: DemoCursor;                 // { cycle: 1, beat: 1 }
export function demoTaskId(prefix: string, sessionKey: number, cycle: number, letter: 'a' | 'b' | 'c' | 'd'): string;  // `${prefix}-D${sessionKey}-${cycle}${letter}`, e.g. 'SW-D57-1a'
export function nextDemoBeat(world: DemoWorld, cursor: DemoCursor): { inputs: EventInput[]; cursor: DemoCursor };
```

Every produced input has `source: 'demo'` and is legal **when applied in order** against `world`
(bridging inputs included: `agent.connected` for offline agents, `→ idle` first when the next status is
illegal). Demo task ids never match `^<prefix>-\d+$` and carry `metadata.demo = true`. The service ingests
the inputs of one beat sequentially; on the first rejection it logs `demo_event_rejected` and skips the
rest of that beat.

### 9.6 Persisted demo setting (TASK-008)

Settings key `demo`, value:
`{ "active": true, "intervalMs": number, "startedAt": string, "startSeq": number, "snapshot": { "agents": Agent[], "tasks": Task[] } }`.
Boot: if present → `restoreDemoSnapshot` runs **after** `listen` and `seedIfEmpty`, before the server is marked
ready (listen-first boot, ADR-035 §2 / §9.8; requests other than `/api/health` get 503 until ready), log
`demo_recovered`, demo stays off (REQ-113).

### 9.7 Broadcaster — `realtime/broadcaster.ts` (TASK-005)

```ts
export interface Broadcaster {
  officeEvent(payload: OfficeEventPayload): void;
  demoState(state: DemoState): void;
  resync(payload: OfficeResyncPayload): void;
}
export class NoopBroadcaster implements Broadcaster { … }
export class RecordingBroadcaster implements Broadcaster {
  readonly messages: Array<{ name: keyof ServerToClientEvents; payload: unknown }>;
  constructor(forward?: Broadcaster);
  clear(): void;
}
```
`realtime/socketServer.ts` (TASK-008): `export function createSocketServer(httpServer, deps: { config: AppConfig; logger: Logger }): { io: Server<ClientToServerEvents, ServerToClientEvents>; broadcaster: Broadcaster }`.

### 9.8 Services and app assembly (TASK-008)

```ts
// services/eventService.ts
export interface IngestContext { origin: 'http' | 'internal'; force?: boolean }  // http → producerEventInputSchema; internal → eventInputSchema
export interface EventService {
  ingest(raw: unknown, ctx: IngestContext): OfficeEventPayload;                  // throws AppError
  patchAgentStatus(agentId: string, raw: unknown): WriteResult;                  // PATCH /api/agents/:id/status
  commitAndBroadcast<T>(work: (repos: Repositories) => { payloads: OfficeEventPayload[]; result: T }): T;  // the only commit+broadcast path (ADR-008)
}
// services/taskService.ts: createTask(raw: unknown): OfficeEventPayload; patchTask(id: string, raw: unknown): WriteResult
// services/demoService.ts: getState(): DemoState; start(raw: unknown): DemoState; stop(reason: 'user' | 'shutdown'): DemoStopResult; recoverOnBoot(): DemoRestoreSummary | null; dispose(): void
// services/snapshotService.ts: getSnapshot(query: SnapshotQueryInput): Snapshot

// app.ts
export interface ServerAppOptions {
  config: AppConfig;
  database: DatabaseHandle;        // opened + migrated; seeding is the caller's job
  logger?: Logger;                 // default createLogger({ level: config.logLevel })
  broadcaster?: Broadcaster;       // default: the Socket.IO broadcaster; tests may wrap it in RecordingBroadcaster
  clock?: () => Date;              // default () => new Date()
  startReady?: boolean;            // default true; false → gated until markReady() (ADR-035)
}
export interface ServerApp {
  app: import('express').Express;
  httpServer: import('node:http').Server;
  io: import('socket.io').Server<ClientToServerEvents, ServerToClientEvents>;
  services: { events: EventService; tasks: TaskService; demo: DemoService; snapshot: SnapshotService };
  markReady(): void;               // opens the readiness gate (ADR-035)
  isReady(): boolean;
  close(): Promise<void>;          // stops demo (restore), closes io, http server; does NOT close the database
}
export function createServerApp(options: ServerAppOptions): ServerApp;   // does not listen
```

`index.ts` boot order *(ADR-035, listen-first — the port is the single-instance lock)*: `loadConfig` →
`createLogger` → warn if non-loopback → `openDatabase` (migrations) → `createServerApp({ startReady: false })` →
`httpServer.listen(port, host)` → `seedIfEmpty` → `demo.recoverOnBoot()` → `markReady()` → log `server_started`.
A failed listen (e.g. `EADDRINUSE`: another instance owns the port) closes the app and the database and exits
**before** seeding or demo recovery, so a second instance can never restore or disarm the running instance's demo.
Until `markReady()`: `/api/*` → 503 `Server is starting` (§3.1), Socket.IO handshakes refused (§4); REQ-113
("restore before serving requests") still holds.
Shutdown: SIGINT / SIGTERM / SIGHUP (console window closed), SIGBREAK (Ctrl+Break, Windows) and, when the process has
an IPC parent (e.g. the dev launcher `scripts/dev.mjs` or `scripts/smoke-live.mjs`), `disconnect` → `server_stopping {signal}` → `app.close()` → `database.close()`
→ `server_stopped` → exit 0; handled once; force exit 1 after 5 s (`shutdown_timeout`). `boot()` and
`installShutdownHandlers()` are exported for tests.

Test helper (TASK-008): `apps/server/test/helpers/testApp.ts` →
`createTestApp(options?: { seed?: boolean; now?: Date; startReady?: boolean; config?; logger?; clock?; database? }): Promise<{ server: ServerApp; database: DatabaseHandle; recorder: RecordingBroadcaster; baseUrl: string; port: number; close(): Promise<void> }>`
(`:memory:` DB, logger level `silent`, listens on `127.0.0.1:0`).

---

## 10. Frontend internal contracts

### 10.1 File ownership (no overlap)

| Area | Owner |
|---|---|
| `apps/web/src/office/**` | TASK-007 (Phaser office) |
| `apps/web/src/**` except `office/**` | TASK-006 (web shell) |
| `apps/web/index.html`, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `package.json`, `test/setup.ts`, `test/smoke.test.tsx` | TASK-001 (change requests go through the PM) |

Lint-enforced boundaries (ESLint `no-restricted-imports`): only `src/office/**` may import `phaser`;
`src/office/**` may not import from `src/store`, `src/api`, `src/socket`, `src/components`, `src/layout`,
`src/agents`, `src/activity`, `src/simulator`, `src/dashboard`; code outside `src/office/**` may import from
`src/office` **only** `src/office/OfficeCanvas` (lazy).

### 10.2 Office seam — `apps/web/src/office/OfficeCanvas.tsx` (ADR-025, refines ADR-012)

```ts
import type { Agent } from '@vo/shared';

/** Desk slot rectangle in CSS pixels relative to the OfficeCanvas root element's top-left corner. */
export interface OfficeHoverInfo { agentId: string; x: number; y: number; width: number; height: number }

export interface OfficeCanvasProps {
  agents: readonly Agent[];               // all 15 (store order irrelevant; placed by deskId)
  projectFilter: string | null;           // project id; agents with currentProject !== filter are dimmed (alpha .40 / offline .25)
  selectedAgentId: string | null;         // selection ring
  reducedMotion: boolean;                 // true → no tweens (UX §5.4 "Reduced motion" column)
  paused: boolean;                        // true while backend unavailable → tweens.pauseAll()
  onAgentSelect: (agentId: string) => void;
  onBackgroundClick: () => void;          // pointerdown on empty floor (closes the detail panel)
  onAgentHover: (hover: OfficeHoverInfo | null) => void;  // null on leave, resize, zoom change
  className?: string;
}
declare function OfficeCanvas(props: OfficeCanvasProps): React.JSX.Element;
export default OfficeCanvas;   // renders one <div> with width/height 100% of its parent; the game fills it
```

Responsibilities:
- **TASK-007 (inside OfficeCanvas)**: `gameManager` singleton (one `Phaser.Game`, deferred destroy,
  StrictMode-safe), internal bridge feeding props to the scene (diff agents by `version`), rooms/desks/
  characters, status visuals/animations, `completed` emphasis on live transitions only, LOD by zoom
  (`zoom = min(w/1140, h/540, 1.6)`, compact < 0.70), dimming, selection/hover plates, room "N active"
  counts (respecting `projectFilter`), crisp text, pause/reduced motion. Never renders HTML tooltips.
- **TASK-006 (around OfficeCanvas)**: `OfficeCard` (header "OFFICE" + legend), host sizing per UX §2.2
  formula, `role="img"` host with the debounced summary `aria-label`, "Skip to agents list" link,
  `React.lazy` + `Suspense` fallback (static floor-plan placeholder drawn from `OFFICE_ROOMS` + "Loading
  office…"), not rendering OfficeCanvas below 768 px (debounce 200 ms), the HTML tooltip positioned from
  `OfficeHoverInfo`, `prefers-reduced-motion` detection, mapping callbacks to store/URL.
- TASK-001 creates a stub `OfficeCanvas.tsx` with the same props except `agents: ReadonlyArray<{ readonly id: string }>`
  rendering `<div data-testid="office-canvas-stub" />`; TASK-007 replaces it. TASK-006 tests mock the module
  (`vi.mock('../office/OfficeCanvas')`).

### 10.3 Web → API usage (TASK-006)

- `api/client.ts`: `apiRequest<T>(method, path, body?, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>`
  returns `data`; sends `Content-Type: application/json` for bodies; non-2xx → `ApiError { status, code, message, details }`
  from the envelope; network failure → `ApiError { status: 0, code: 'NETWORK_ERROR' }`; timeout (10 s, health 5 s)
  → `ApiError { status: 0, code: 'TIMEOUT' }` (client-only codes).
- Simulator status button → `PATCH /api/agents/:id/status` `{ status, source: "simulator", project?, taskId? }`
  (project/task omitted when "None"). Never `force` (ADR-022).
- Simulator "Send Event" → `POST /api/events` `{ type: "agent.activity", source: "simulator", agentId, action, message?, severity?, project?, taskId? }`
  (severity omitted when Info). Validate first with `producerEventInputSchema` (field messages per UX §9.5).
- Feedback: 409 → show `error.message` verbatim + client hint "Allowed from <Status>: <buttons>" from
  `getAllowedAgentTargets`; same-status → response `event === null` → "No change · <name> is already <Status>".
- Demo switch → `POST /api/demo/start` `{}` / `POST /api/demo/stop` `{}`; toast uses `restored` counts.
- Write responses (`data`) go through the same reducer as `office:event` (no optimistic updates, REQ-104).
- URL: `?project=<id>` and `?agent=<id>` (`replaceState`); invalid project → All Projects.
  localStorage keys: `vo.feed.hideDemo`, `vo.simulator.open` (wrapped in try/catch).

---

## 11. Configuration

Server env (parsed by `loadConfig`, fail fast with `ConfigError`). When `<repoRoot>/.env` exists it is parsed
with `util.parseEnv` and merged **under** the real environment (real env vars win; `process.env` is not
mutated; blank values count as unset) — no `dotenv` dependency (ADR-032 §8):

| Var | Default | Rule |
|---|---|---|
| `PORT` | `4000` | integer 1–65535 |
| `HOST` | `127.0.0.1` | non-loopback → startup `warn` `non_loopback_host` (no auth) |
| `DB_PATH` | `<repoRoot>/data/office.db` | relative paths resolve against `repoRoot` (not CWD); `:memory:` allowed |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated origins |
| `SERVE_WEB` | `false` | `true`/`false`; CLI flag `--serve-web` also enables it |
| `DEMO_DEFAULT_INTERVAL_MS` | `3000` | integer 2000–10000 |

`repoRoot` = three levels up from `apps/server/src/config.ts` (via `import.meta.url`), `webDistPath` =
`<repoRoot>/apps/web/dist`. With `serveWeb` and a missing `dist`, log `warn` and serve API only.

`.env.example` (committed, TASK-001):

```dotenv
# AI Virtual Office — server configuration. Copy to .env to override. All values are optional.
# No secrets are needed in Phase 1. Never commit .env.
PORT=4000
HOST=127.0.0.1
# DB_PATH defaults to <repo>/data/office.db (resolved from the repo root, not the current directory)
# DB_PATH=data/office.db
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
SERVE_WEB=false
DEMO_DEFAULT_INTERVAL_MS=3000
```

The web app has no env vars. Vite dev server: port 5173 (`strictPort: true`); proxy `/api` →
`http://127.0.0.1:4000`, `/socket.io` → `http://127.0.0.1:4000` with `ws: true`.

---

## 12. Workspaces and npm scripts

### 12.1 Manifests

| Package | `name` | `type` | Key fields |
|---|---|---|---|
| root | `ai-virtual-office` (private) | module | `"workspaces": ["packages/*", "apps/*"]`, `"engines": { "node": ">=22.13.0" }` |
| `packages/shared` | `@vo/shared` (private) | module | `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }` |
| `apps/server` | `@vo/server` (private) | module | dependency `"@vo/shared": "*"` |
| `apps/web` | `@vo/web` (private) | module | dependency `"@vo/shared": "*"` |

Dependency versions: `docs/IMPLEMENTATION_PLAN.md` §3 (binding, ADR-026). All dependencies of all
workspaces are installed by TASK-001; later tasks must not run `npm install <pkg>` (request via the PM).

### 12.2 Scripts (all portable: no `rm -rf`, no inline `VAR=x`, no `&`)

Root `package.json`:

| Script | Command | Purpose |
|---|---|---|
| `dev` | `node scripts/dev.mjs` | both dev servers via the launcher (ADR-036: no shell, port preflight, kills both process trees on exit) |
| `dev:server` | `npm run dev -w @vo/server` | API + Socket.IO on 4000 (launcher `--only=server`, content-based restart) |
| `dev:web` | `npm run dev -w @vo/web` | Vite on 5173 |
| `build` | `npm run typecheck && npm run build -w @vo/web` | ADR-013 |
| `start` | `npm run start -w @vo/server` | one port, serves `apps/web/dist` |
| `lint` | `eslint . --max-warnings=0` | all workspaces |
| `typecheck` | `npm run typecheck --workspaces --if-present` | `tsc --noEmit` each |
| `test` | `npm run test --workspaces --if-present && npm run test:scripts` | Vitest in each workspace (run mode), then the script tests |
| `test:scripts` | `node --test scripts/lib/processIdentity.test.mjs scripts/lib/devReaper.test.mjs scripts/lib/sourceWatcher.test.mjs` | `node:test` suites of the dev-launcher helpers in `scripts/lib/` (ADR-036 addenda 2–3) |
| `format` | `prettier --write .` | |
| `format:check` | `prettier --check .` | |
| `db:reset` | `npm run db:reset -w @vo/server` | dev DB reset + reseed |
| `verify` | `node scripts/verify.mjs` | format:check → lint → typecheck → test → build; summary; exit ≠ 0 on first failure |
| `smoke` | `node scripts/smoke-live.mjs` | live smoke run (TASK-009): one-port server on a temp DB + restart check; `npm run smoke -- --dev` additionally checks the dev launcher, Vite proxy and socket through the proxy (ports 4000/5173 must be free) |

`packages/shared`: `typecheck` = `tsc -p tsconfig.json --noEmit`, `test` = `vitest run`, `lint` = `eslint .`.

`apps/server`:

| Script | Command |
|---|---|
| `dev` | `node ../../scripts/dev.mjs --only=server` |
| `start` | `node --disable-warning=ExperimentalWarning --import tsx src/index.ts --serve-web` |
| `db:reset` | `node --disable-warning=ExperimentalWarning --import tsx src/seed/reset.ts` |
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `test` | `vitest run` |
| `lint` | `eslint .` |

`apps/web`: `dev` = `vite`, `build` = `vite build`, `preview` = `vite preview`, `typecheck` =
`tsc -p tsconfig.json --noEmit`, `test` = `vitest run`, `lint` = `eslint .`.

Dev server reloading (ADR-036 addendum 3): the server runs **without** `node --watch`
(`node --disable-warning=ExperimentalWarning --import tsx src/index.ts`, spawned by `scripts/dev.mjs` with an IPC
channel). Node's watch mode restarted on Windows last-access updates, so plain reads of source files (typecheck,
lint, smoke) restarted the server. The launcher watches `apps/server/src` and `packages/shared/src` itself
(`scripts/lib/sourceWatcher.mjs`, SHA-1 content snapshots) and restarts gracefully (IPC `disconnect`) only on a
real content change, addition or removal. `dev.mjs` also accepts `--only=web`. No `tsx watch` fallback is used.

### 12.3 `db:reset` behavior (TASK-003)

`apps/server/src/seed/reset.ts`: loads config; refuses (exit 1, clear message) when `DB_PATH` is `:memory:`
or not inside `<repoRoot>/data/`, or when a TCP connect to `HOST:PORT` succeeds ("Server is running on
127.0.0.1:4000 — stop it before resetting the database."); otherwise deletes `office.db`, `-wal`, `-shm`
(`fs.rmSync`, `force: true`), opens + migrates + seeds, prints counts, exits 0. Never invoked implicitly.

---

## 13. Change log

- v1 (2026-10-03, tech-lead): initial contract. New ADRs 021–028 in `DECISIONS.md`.
- v1.1 (2026-10-04, backend-engineer under ADR-035, pre-approved by the PM for the tech-lead): §1.5 `Snapshot.lastSeq` and
  task selection; §2.2 `Server is starting`; §3.1 starting 503; §3.11 watermark + task cap; §3.14 referenced demo
  tasks are kept; §4 Socket.IO Origin rule + readiness; §9.3 new log keys; §9.8 listen-first boot, readiness gate,
  SIGHUP/SIGBREAK/IPC disconnect, `createTestApp` options.
- v1.2 (2026-10-04, backend-engineer under ADR-037, pre-approved): §0 Origin rule for writes, compressed bodies, framing
  headers, socket refusal note; §2.1 `ORIGIN_NOT_ALLOWED`; §2.2 new messages and reserved task ids; §3.14 singular/plural
  summary; §4 engine.io refusal response; §5.2 `RESERVED_TASK_IDS`.
- v1.2.1 (2026-10-04, backend-engineer, CR-19): §0 no-store/nosniff on guard refusals; framing headers scoped to Express responses.
- v1.2.2 (2026-10-04, tech-lead, doc fixes DOC-1…DOC-4): header version/ADR range; §9.6 demo recovery after listen
  (ADR-035); §11 `.env` via `util.parseEnv` merged under the real env (ADR-032 §8); §12.2 `dev` = `node scripts/dev.mjs`
  (ADR-036), `smoke` script added, stale `tsx watch` fallback note replaced (ADR-029 §5). No behavior change.
- v1.2.3 (2026-10-04, tech-lead, ADR-036 addenda 2–3): §12.2 `apps/server` `dev` = `node ../../scripts/dev.mjs --only=server`
  (no `node --watch`; the launcher restarts on content changes); root `test` also runs `npm run test:scripts`; new
  `test:scripts` row; §9.8 IPC-parent example updated. Documents already-implemented behavior.
