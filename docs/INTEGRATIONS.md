# INTEGRATIONS — AI Virtual Office MVP

Owner: integration-engineer · Task: TASK-004 · Date: 2026-10-04 · Status: Phase 1
Binding inputs: ORIGINAL_REQUEST §18–§19; REQ-130, REQ-131, REQ-132; ADR-005, ADR-007;
`docs/EVENT_SYSTEM.md` §10; `docs/API_CONTRACTS.md` §5.3; CLAUDE.md §16.

Phase 1 has **no live external integration**. Every producer reaches the system through the canonical
envelope on `POST /api/events` (EVENT_SYSTEM §2.1). The only producer-specific code is one pure, unwired
adapter for the owner's example Claude Code format.

## 1. Status legend (CLAUDE.md §16)

| Status | Meaning |
|---|---|
| VERIFIED | Tested against the real or sandbox service |
| PARTIALLY_VERIFIED | Some paths tested against the real service, others not |
| MOCKED | Exercised only with mocked/recorded data in unit tests |
| UNVERIFIED | Inferred or example-based; not confirmed by provider docs or real tests |
| BLOCKED | Cannot proceed (e.g. missing credentials) |
| NOT STARTED | No code exists (Phase 2+ roadmap item) |

## 2. Integration table

| Integration | Direction | Status | Code | Notes |
|---|---|---|---|---|
| Generic HTTP producer (`POST /api/events`, canonical envelope) | inbound | Internal API — covered by TASK-008 tests, not an external integration | `apps/server` (TASK-008) | Any script, CI job or agent can send canonical events (REQ-130). Local-only, no auth (ADR-019). |
| **Claude Code — §19 event format** | inbound | **UNVERIFIED** | — | The format is the owner's example in ORIGINAL_REQUEST §19, not a documented Claude Code contract. No real Claude Code hook or process has produced it. |
| **Claude Code — adapter `claudeCodeAdapter`** | inbound (mapping only) | **MOCKED** (unit tests only) | `packages/shared/src/adapters/claudeCode.ts` | Pure function, **not wired** to any route, script or process (ADR-007). Tested with hand-written payloads only. |
| Telegram | inbound / outbound | NOT STARTED | — | Phase 2+ (operator notes → `agent.message`; control commands later). |
| GitHub / GitHub Actions | inbound | NOT STARTED | — | Phase 2+ (workflow runs → `agent.activity` `build`/`test`; failures → `system.error`). |
| Docker / server monitor | inbound | NOT STARTED | — | Phase 2+ (container down → `agent.disconnected` / `system.error`). |
| CI/CD, custom scripts | inbound | NOT STARTED (no adapter needed) | — | Can already POST the canonical envelope; no dedicated integration. |
| Browser agent / OpenAI agents | inbound | NOT STARTED | — | Phase 2+ (own adapter → canonical `agent.*` events). |

No integration uses credentials, API keys, webhooks or outbound network calls in Phase 1. There are no
integration environment variables (see `.env.example`).

## 3. Claude Code adapter (Phase 1)

### 3.1 Provider and documentation

| Item | Value |
|---|---|
| Provider | Anthropic Claude Code (CLI) |
| Official documentation consulted | **None in this task.** TASK-004 forbids network calls; the adapter implements the owner's §19 example only. |
| Provider API version | Not applicable — no provider endpoint or hook contract is used. |
| Endpoints used | None (no HTTP route uses the adapter; ADR-007). |
| Auth method / env vars | None. |
| Adapter version | `metadata.adapterVersion = 1` |

### 3.2 Exports (`@vo/shared`, API_CONTRACTS §5.3)

| Export | Purpose |
|---|---|
| `ProducerAdapter<TRaw>` (type) | `{ source, schema, toCanonical(raw): EventInputBody[] }` — pure, no I/O, clock or randomness |
| `AdapterError` | `code: 'UNSUPPORTED_EVENT' \| 'INVALID_PAYLOAD'`, `name: 'AdapterError'` |
| `claudeCodeEventSchema`, `ClaudeCodeEvent` | Loose Zod object for the §19 payload; unknown fields are kept |
| `mapClaudeToolToAction(tool, command?)` | ES §10.1 tool → action table |
| `claudeCodeAdapter` | `source: 'claude-code'` |
| `PRODUCER_ADAPTERS` | Frozen, null-prototype registry `{ 'claude-code': claudeCodeAdapter }` — for the Phase 2 route; unused in Phase 1 |

### 3.3 Accepted input (§19)

```json
{ "source": "claude-code", "agentId": "04-backend-engineer", "project": "Sellway", "taskId": "SW-123",
  "event": "tool.executed", "tool": "terminal", "command": "npm test", "result": "success" }
```

| Field | Rule |
|---|---|
| `source` | required, exactly `"claude-code"` |
| `agentId`, `event` | required strings |
| `project`, `taskId`, `tool`, `command`, `result` | optional strings; `null` = absent |
| any other key | allowed; copied into `metadata.raw` |
| `event` | only `"tool.executed"` (surrounding whitespace ignored, case-sensitive); anything else → `UNSUPPORTED_EVENT` |
| `tool` | required for `tool.executed` (non-blank) |

### 3.4 Mapping (EVENT_SYSTEM §10.1)

Output is always exactly one `agent.activity` event (tool use never moves the state machine):
`source`, `agentId`, `project`, `taskId` copied; `action` from the tool map (below); `message`
`"<tool>: <command>"` (just `"<tool>"` without a command) plus `" (failed)"` on failure; `severity`
`error` when `result` ∈ {`failure`, `failed`, `error`} (case-insensitive, trimmed), else `info`;
`metadata = { adapter: "claude-code", adapterVersion: 1, raw: { event, tool, command, result, …other fields } }`.

| tool (case-insensitive) | action |
|---|---|
| `read`, `read_file` | `read_file` |
| `write`, `write_file` | `write_file` |
| `edit`, `edit_file`, `multiedit` | `edit_file` |
| `grep`, `glob`, `search` | `search` |
| `browser`, `webfetch`, `web_fetch` | `browser` |
| `wait` | `wait` |
| `terminal`, `bash`, `shell` | by command (lowercased, whitespace collapsed): starts with `git status` → `git_status`, `git diff` → `git_diff`, `git commit` → `git_commit`; `(npm\|pnpm\|yarn) [run] test`, `vitest`, `jest`, `pytest` → `test`; `(npm\|pnpm\|yarn) [run] build`, `tsc`, `vite build` → `build`; otherwise (or no command) `run_command` |
| anything else | lowercased slug (`[a-z0-9._-]`, other runs → `_`), ≤ 100 chars |

The REQ-132 action `error` is not produced by the tool map; Claude error events are a Phase 2 mapping
(`system.error`).

### 3.5 Limits and truncation (interpretations, recorded here)

- Truncated strings end with `…` and the ellipsis counts toward the limit; surrogate pairs are never split.
- `message`: command ≤ 500 chars, tool ≤ 100 chars → message ≤ 611 chars (limit 2000).
- `metadata.raw`: `command` ≤ 1000 chars; `tool` and `result` ≤ 100 chars (ES §10.1 caps only `command`;
  capping `tool`/`result` guarantees the core always fits in 8 KB even with worst-case JSON escaping).
- Extra producer fields are added in input order while `metadata` stays ≤ 8 KB (64 bytes reserved for
  markers); fields that do not fit, non-JSON values and a `__proto__` key are dropped.
- When anything was shortened or dropped: `metadata.truncated = true`; when extra fields were dropped:
  `metadata.droppedRawFields = <count>`. Neither key is present for a normal payload (the §19 example
  output is exactly the ES §10.1 expected output).

### 3.6 Errors

| Situation | Error |
|---|---|
| Payload not an object, wrong/missing `source`, missing `agentId`/`event`, non-string field | `AdapterError('INVALID_PAYLOAD')` |
| `event` other than `tool.executed` | `AdapterError('UNSUPPORTED_EVENT')` (value echoed ≤ 100 chars) |
| `tool` missing or blank on `tool.executed` | `AdapterError('INVALID_PAYLOAD')` |
| Mapped event fails `producerEventInputSchema` (e.g. blank or > 64-char `agentId`, bad `taskId`, > 100-char `project`) | `AdapterError('INVALID_PAYLOAD')` naming the field |

Error messages are ≤ 500 chars and contain field paths and schema messages, never the full payload.
The adapter does not check that the agent, project or task exist — that remains `EventService`'s job
(an unknown agent → 404, `"All Projects"` → 422, etc. once wired).

### 3.7 Tests (MOCKED evidence only)

`packages/shared/src/adapters/claudeCode.test.ts` and `index.test.ts` (run with
`npm run test -w packages/shared`): §19 example → exact expected output; every output re-validated
against `producerEventInputSchema`; purity (deterministic, frozen input not mutated); every tool-map row
in four casings; 45 terminal commands (git status/diff/commit, npm/pnpm/yarn test/build, vitest, jest,
pytest, tsc, vite build, others); failure results; truncation (500 in message, 1000 in raw, surrogate
pairs); oversized raw payload ≤ 8 KB; worst-case escaping; non-JSON and `__proto__` extras; unknown tool
slugs; every §19 action name; unsupported events; 16 invalid payloads; registry shape and safe lookup.

These tests prove the mapping matches the documented design. **They do not prove that Claude Code
emits this format.**

### 3.8 What must be verified to reach VERIFIED (Phase 2)

1. Read the official Claude Code hooks documentation (current version) and record the URL, version and
   payload schema here.
2. Capture real hook payloads (e.g. a post-tool-use hook) from a local Claude Code session and add them as
   recorded fixtures. It is expected — but **UNVERIFIED** — that real hook payloads differ from §19
   (e.g. different field names for the tool name, tool input and session, and no `agentId`/`project`/
   `taskId`, which our hook script would have to add). Any difference is reported to the architect /
   tech lead as an ES §10 change, not silently patched in the adapter.
3. Decide how a hook knows its `agentId`, `project` and `taskId` (environment of the agent session or a
   wrapper script) — an owner/architect decision.
4. Wire the adapter behind the Phase 2 route (below) and run an end-to-end check: real hook → route →
   `EventService` → socket → office.
5. Only then mark the format and the adapter VERIFIED (or PARTIALLY_VERIFIED if only some tools/events
   were exercised).

## 4. Phase 2 plan (not implemented)

- **`POST /api/ingest/:source`** — looks up `PRODUCER_ADAPTERS[source]` (null-prototype registry: no
  inherited keys), unknown source → 404; `AdapterError('INVALID_PAYLOAD')` → 400 `VALIDATION_ERROR`;
  `AdapterError('UNSUPPORTED_EVENT')` → 400 or 202-ignored (decision pending); each canonical event goes
  through `EventService.ingest` exactly like `POST /api/events` (same validation, transaction, broadcast).
- **Adapter registry** — more adapters (GitHub Actions, Docker monitor, Telegram, browser/OpenAI agents)
  added to `PRODUCER_ADAPTERS`; mappings first designed in EVENT_SYSTEM §10.2.
- **More Claude events** — `session.started` → `agent.connected`, `session.ended` →
  `agent.disconnected`, error events → `system.error` (ES §10.1), after step 3.8.2.
- **Producer authentication** (roadmap Phase 8) — per-producer tokens from environment variables or a
  secret store, never in code; required before the server listens on anything but loopback. Until then
  the server stays local-only (ADR-019).
- **Idempotency** — an optional producer event key to make hook retries safe (ADR-005 consequence).
- **Rate limiting** for ingest routes once they are reachable by automated producers.

## 5. Change log

- 2026-10-04 integration-engineer (TASK-004): created; Claude Code format UNVERIFIED, adapter MOCKED,
  all other integrations NOT STARTED.
