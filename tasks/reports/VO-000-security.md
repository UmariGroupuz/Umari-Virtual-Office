# VO-000: Security gate, integrated Phase 1 MVP

Security: security-engineer (gate) · Date: 2026-10-04 · Scope: the whole Phase 1 app after code review PASS
(`VO-000-review.md`) and QA PASS (`VO-000-qa.md`). Binding inputs: ORIGINAL_REQUEST §26, REQUIREMENTS REQ-160–164,
NFR-004/008, A-12, A-15, ADR-019/027/035, API_CONTRACTS v1.1.

Environment: Windows 11, Node v24.12.0, express 5.2.1, socket.io 4.8.4 / engine.io 6.6.11, ws 8.21.3, vite 8.3.2.
I ran the server from source with a scratchpad `DB_PATH` (`data/office.db` was not touched): one instance on :4000,
one in one-port mode (`--serve-web`) on :4010, and the Vite dev server on :5173. I sent crafted requests with raw
sockets, `http.request`, `fetch` and curl. All three processes are stopped. Ports 4000/4010/5173 are free, and the
owner's Sellway servers on 5174/5188 were not touched. No application code was changed and nothing was committed.
`docs/SECURITY.md` was created.

## 1. Commands and results

| Check | Result |
|---|---|
| `npm audit --omit=dev` | **found 0 vulnerabilities** |
| `npm audit` (incl. dev) | **found 0 vulnerabilities** |
| grep `child_process`/`exec`/`spawn`/`eval`/`new Function`/dynamic `require`/fs writes in `apps/**/src`, `packages/shared/src` | none reachable from HTTP. Only `db.exec` with constant PRAGMA/transaction SQL, `readFileSync(.env)` at boot, `rmSync` in `db:reset` (CLI only) |
| grep `dangerouslySetInnerHTML`/`innerHTML`/`href={producer data}` in `apps/web/src` | none |
| secrets scan (repo + `apps/web/dist`), `git check-ignore` `.env`, `data/office.db` | no secrets; both ignored; `.env.example` has no secrets; web code uses no `import.meta.env` |

## 2. Live test matrix

| Area | Probe | Result |
|---|---|---|
| Host guard (HTTP) | `Host:` `evil.example`, `localhost.evil.example`, `127.0.0.1.nip.io`, `127.0.0.2`, `0.0.0.0`, `localhost.`, `[::ffff:127.0.0.1]`, `localhost@evil` | all **403 HOST_NOT_ALLOWED** |
| | `localhost:4000`, `[::1]:4000`, `127.0.0.1`, `LOCALHOST:1` | 200 (allowed by design) |
| | HTTP/1.0 without Host | 403 |
| | one-port static `/` with `Host: evil.example` | 403 |
| Host guard (Socket.IO) | polling `Host: evil.example` | 403 `{"code":4,"message":"Host not allowed"}`; WebSocket upgrade → **400**; refused in both (see SEC-6) |
| Origin rule (Socket.IO) | polling Origin `evil.example`, `null`, `file://`, `localhost:5174`, `localhost:4000` with Host `127.0.0.1:4000` | all 403 `Origin not allowed` |
| | WebSocket upgrade Origin `evil.example` | 400 refused; Origin `localhost:5173` → 101; no Origin → 101 (AR-4) |
| | through the Vite proxy: WS and polling with Origin `localhost:5174` | refused by the backend (400 / 403) |
| CSRF / simple requests | POST with `text/plain`, `x-www-form-urlencoded`, `multipart/form-data`, `application/vnd.api+json`, `application/json, text/plain`, no type | all **400 INVALID_JSON**, no state change |
| | `X-HTTP-Method-Override`, `?_method=` | ignored (400) |
| | GET on write routes, PUT, DELETE, TRACE | 404 JSON (no state-changing GET exists) |
| CORS (direct :4000) | GET/preflight with Origin `evil.example`, `null`, `localhost:5174` | **no `Access-Control-Allow-Origin`** |
| CORS (Vite :5173) | Origin `http://localhost:5174` and `http://foo.localhost:9999` | **ACAO reflected; PATCH status 200 and POST event 201 succeeded** (SEC-1) |
| Vite dev server | `Host: evil.example:5173` on `/` and `/api` | 403 (Vite `allowedHosts`) |
| | `/@fs/…/.env.example`, `/@fs/C:/Windows/win.ini` | 403 |
| Static files (one-port) | `/../package.json`, `%2e%2e`, `..%2f`, `..\`, `%5c..`, `/assets/../../..`, `/.env`, `/C:/Windows/win.ini`, `%00`, `/apps/server/src/index.ts`, `/node_modules/…`, raw-socket `..\..\` | **always the SPA `index.html` (612 B); no file content leaked**. `/api/../x` → JSON 404, `/socket.io/../x` → engine.io 400 |
| Body limits | 100 KB + 1 | 413 |
| | gzip bomb 51 KB → 50 MB, 204 KB → 200 MB | 413 within 5–51 ms (the limit applies after inflation); RSS stayed ~115 MB |
| | corrupt gzip body, invalid `br` body | **500 INTERNAL_ERROR + error log with stack** (SEC-3) |
| | metadata 8 KB+; 40 000-deep nested arrays in metadata (80 KB) | 400 `Metadata exceeds 8 KB`; no stack overflow; health OK afterwards |
| Prototype pollution | top-level `__proto__` / `constructor` in event, task create, task patch | 400 `Unrecognized key` |
| | `metadata: {"__proto__":{…},"constructor":{"prototype":{…}}}` | 201, stored as inert JSON text; `({}).polluted` stays undefined; health OK |
| | task id `__proto__` / `constructor` via POST /api/tasks | 201 accepted → client store issue (SEC-4) |
| Query validation | repeated key, `project[a]=b`, `__proto__=`, `limit` −1 / 1e3 / 2^66 / 501, `before=0`, bad `type`/`source`/`taskId` | all 400 (Zod strict); `limit=500` OK |
| SQL injection | `agentId=' OR 1=1 --`, `source=x' OR 1=1`, agent/task path ids with quotes | treated as literal values (422/404/400); all SQL is bound parameters (code reviewed) |
| Body edge cases | malformed JSON, `null`, `"x"`, `[1,2]`, invalid UTF-8 | 400 envelopes, no stack in responses |
| Error output | every error above | `{error:{code,message,details?}}`, no stack or SQL; JSON with `nosniff`; echoed ids are inert in JSON and rendered as React text |
| Logging | server log during the run | only `status/code/method/route`, truncated rejection context, socket ids; no bodies, metadata or query strings |
| Headers | `/api/*` | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, no `X-Powered-By` |
| | static HTML (`/`) and Vite `/` | no `X-Frame-Options` / CSP / `frame-ancestors` (SEC-5) |

## 3. Code review notes (no finding)

- **RCE/filesystem (REQ-160):** no API runs commands or touches files. `metadata.command` and similar fields are stored as text.
  `scripts/dev.mjs` uses `spawn(process.execPath, [...])` without a shell. Its PowerShell snippets use only the constant ports
  4000/5173 and PIDs from the OS, and it kills only its own process trees. `scripts/verify.mjs` uses `shell:true` with
  constant step names only. No injection path.
- **SQL:** `node:sqlite` prepared statements with named parameters. The dynamic WHERE in `eventRepository.list` /
  `taskRepository.list` comes from a fixed clause set, `LIMIT` is bound, `ORDER BY` is constant. The statement cache is
  bounded (fixed SQL texts only).
- **Metadata:** `metadataSchema` walks iteratively (no recursion), allows plain objects only, and is capped by value count and
  byte length. It is never merged into server objects; it is stored via `JSON.stringify`.
- **db:reset:** refuses `:memory:`, any path outside `<repo>/data/` (`path.relative` check, Windows case folded), and a
  listening server. Runs only on explicit `npm run db:reset`. Safe.
- **Config:** `HOST` charset-validated; `CORS_ORIGINS` parsed to `URL.origin`, http(s) only; `.env` read with Node's
  `parseEnv` (no code execution).
- **XSS:** React text nodes only; the `?agent=` id is `encodeURIComponent`-ed in API paths and shown as text; `?project=` is
  resolved against the fixed project list; Phaser renders only constants and counts as canvas text.
- **DoS (rate limiting BL-007 and retention BL-001 deferred):** for a 127.0.0.1-only Phase 1 I rate this **acceptable**.
  Abuse needs local code execution, which already has full access (AR-1). Per-request work is bounded: body ≤ 100 KB, lists
  ≤ 500, snapshot ≤ 500 tasks + referenced tasks, 15 agents, metadata walk ≤ 8 192 nodes. The worst case is disk growth of
  ~10 KB per event, not a crash. It is **not** acceptable once real producers run (Phase 2) or the bind is non-loopback.
  See `docs/SECURITY.md` §6.

## 4. Findings

```
[SEC-1] severity: medium
ROOT_CAUSE: infrastructure — the Vite dev (and preview) server applies its own default CORS policy
  (`defaultAllowedOrigins` = any http(s) origin on localhost / *.localhost / 127.0.0.1 / [::1], any port) in front
  of the `/api` proxy. That bypasses the backend's CORS allowlist (REQ-161 "CORS allows only the local web origin(s)").
OWNER: devops-engineer
AFFECTED_COMPONENTS: apps/web/vite.config.ts (server/preview), `npm run dev` (the documented way to run the app)
INVALIDATED_GATES: none (QA tested CORS on :4000 directly; config-only fix)
Evidence:
  curl -X OPTIONS http://localhost:5173/api/events -H "Origin: http://localhost:5174" -H "Access-Control-Request-Method: POST"
    -H "Access-Control-Request-Headers: content-type"  → 204, Access-Control-Allow-Origin: http://localhost:5174,
    Allow-Methods GET,HEAD,PUT,PATCH,POST,DELETE
  curl http://localhost:5173/api/agents -H "Origin: http://localhost:5174" → 200 with ACAO http://localhost:5174 (full data)
  curl -X PATCH http://localhost:5173/api/agents/04-backend-engineer/status -H "Origin: http://localhost:5174"
    -H "Content-Type: application/json" -d '{"status":"planning","source":"secprobe"}' → 200 (state changed)
  POST /api/events with Origin http://foo.localhost:9999 → 201
  Direct :4000 with the same Origin → no ACAO (correct). Socket.IO through the proxy is still refused (backend Origin rule).
  Scenario: any page served from another loopback origin while `npm run dev` runs can read the whole office state and
  inject events or status changes. Examples are the owner's other dev servers (Sellway on 5174/5188, their npm
  dependencies, an XSS in them) or any `*.localhost` site. Remote sites (evil.example) are not affected: Vite gives them no ACAO.
  Medium, not high: the attacker needs content on a loopback origin, the data is monitoring-only in Phase 1, and there is no RCE path.
  It becomes more serious in Phase 2, when events carry real Claude Code activity.
Fix: in vite.config.ts set `server.cors: false` and `preview.cors: false`. The app is same-origin through the proxy and
  needs no CORS on Vite. With that, preflights and reads fall through to the backend's allowlist. Add a test or a
  verify step: OPTIONS /api/events via :5173 with Origin http://localhost:5174 → no ACAO.
```

```
[SEC-2] severity: low
ROOT_CAUSE: architecture — the HTTP write path relies only on CORS + Content-Type. Any same-host proxy or misconfigured
  CORS layer (SEC-1) silently undoes it. The Socket.IO path already has an explicit Origin rule (ADR-035), HTTP does not.
OWNER: architect (ADR amendment to ADR-027/035) → backend-engineer (implementation)
AFFECTED_COMPONENTS: apps/server/src/api (new middleware next to hostGuard), API_CONTRACTS §0, ERROR_CODES
INVALIDATED_GATES: review + QA re-check of the new middleware only
Evidence: apps/server/src/api/router.ts:20-28 (CORS is the only Origin-based control); SEC-1 proves the gap is reachable.
Fix: defence in depth. On POST/PATCH (and any future write), when an `Origin` header is present it must be in
  CORS_ORIGINS or equal `http(s)://<Host>` (the same `isAllowedOrigin` as the socket rule). Otherwise 403 (`ORIGIN_NOT_ALLOWED`
  or `HOST_NOT_ALLOWED`, the contract decides). Requests without Origin (curl/producers) are unaffected. Browsers send
  Origin on every cross-origin and same-origin POST/PATCH, so the UI keeps working (Origin http://localhost:5173 through the proxy).
```

```
[SEC-3] severity: low
ROOT_CAUSE: backend — body-parser's zlib errors (corrupt gzip/deflate/br body) are not mapped. They become 500
  INTERNAL_ERROR with an `error` log line including a stack. API-C §0 says malformed bodies → 400.
OWNER: backend-engineer
AFFECTED_COMPONENTS: apps/server/src/api/middleware/requireJson.ts, errorHandler.ts
INVALIDATED_GATES: none
Evidence: POST /api/events, Content-Type application/json, Content-Encoding gzip, body "{}" → 500
  {"error":{"code":"INTERNAL_ERROR"}}. Log: {"level":"error","msg":"request_failed","status":500,
  "err":{"message":"incorrect header check","stack":"Error: incorrect header check\n at genericNodeError …"}}.
  Same with `Content-Encoding: br` + junk. Any local client can trigger error-level log noise. No crash, no leak in the response.
Fix: either `express.json({ inflate: false, … })` (compressed bodies → 415 `encoding.unsupported`, already mapped to 400
  INVALID_JSON; no client compresses bodies) or map zlib errors (`err.code` Z_DATA_ERROR / Z_BUF_ERROR, or status 400 from
  body-parser) to 400 INVALID_JSON "Request body is not valid JSON". Add a regression test for both encodings.
```

```
[SEC-4] severity: low
ROOT_CAUSE: frontend — the web store keys tasks (and agents) by producer-controlled ids in plain objects. The task id
  pattern `^[A-Za-z0-9._-]{1,64}$` allows `__proto__`.
OWNER: frontend-engineer (contract tightening optional: tech-lead)
AFFECTED_COMPONENTS: apps/web/src/store/reducer.ts:101-104 (hydrate), :147/:151 (applyOfficeEvent), selectors/consumers
  using Object.values(tasks)
INVALIDATED_GATES: none
Evidence: POST /api/tasks {"id":"__proto__","title":"proto task","project":"sellway"} → 201 (also "constructor").
  Running the real `hydrate()` (tsx) on the resulting snapshot: snapshot has 13 tasks, Object.values(store.tasks) has
  12; own `__proto__` false; Object.getPrototypeOf(store.tasks).id === "__proto__"; store.tasks["title"] === "proto task".
  No global pollution (({}).title is undefined). Effect: after a snapshot/resync, that task disappears from metrics and the
  simulator list, and lookups of ids like "title"/"status" return inherited strings. Live events (spread with computed key)
  behave differently from the snapshot. This is an integrity/display defect any producer can trigger, not code execution.
Fix: use `Object.create(null)` records or `Map` for `agents`/`tasks` in the store (and anywhere a producer id is a key).
  Add a reducer test with ids `__proto__`, `constructor`, `toString`. Optionally (tech-lead) reserve these ids in
  `taskIdSchema`.
```

```
[SEC-5] severity: low
ROOT_CAUSE: backend (static one-port mode) / infrastructure (Vite dev) — HTML responses send no framing protection or CSP.
OWNER: backend-engineer (apps/server/src/api/static.ts); devops-engineer for the vite.config.ts `server.headers` part
AFFECTED_COMPONENTS: apps/server/src/api/static.ts, apps/web/vite.config.ts
INVALIDATED_GATES: none (QA should smoke the one-port page after a CSP is added, as Phaser needs canvas/blob/data images)
Evidence: GET / on :4010 (--serve-web) headers: accept-ranges, cache-control, last-modified, etag, content-type only.
  Vite :5173 `/`: Vary, Content-Type, Cache-Control, Etag only. Any website can load the dashboard in an iframe and
  trick clicks on the simulator (status changes, Send Event) or the demo switch. Integrity only, user interaction required.
Fix: static mode: `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`
  (verify against the Phaser bundle), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Vite dev:
  `server.headers: { 'X-Frame-Options': 'DENY' }` (no CSP in dev because of HMR).
```

```
[SEC-6] severity: low
ROOT_CAUSE: contract — API-C §0 promises 403 `HOST_NOT_ALLOWED` for a refused Socket.IO handshake. engine.io answers with its
  own format (QA-2).
OWNER: tech-lead
AFFECTED_COMPONENTS: docs/API_CONTRACTS.md §0/§4, REQUIREMENTS §3.5 wording
INVALIDATED_GATES: none
Evidence: polling `Host: evil.example` → 403 {"code":4,"message":"Host not allowed"}; WebSocket upgrade with foreign Host or
  Origin → 400 "Host not allowed"/"Origin not allowed"; `socket_rejected {reason}` logged.
  Security assessment of QA-2: **the control is effective**. Both transports are refused before any Socket.IO session
  exists, so no data is sent. Only the status/body differ from the HTTP envelope. No security need to change the code.
Fix: document the engine.io refusal format (polling 403 `{code:4,message}`, WebSocket upgrade 400) in API-C §0/§4. A
  pre-engine.io `upgrade` listener that writes 403 is optional cosmetic work.
```

## 5. Accepted risks (rationale in `docs/SECURITY.md` §5)

AR-1 no authentication (A-12) · AR-2 no rate limiting (A-15/BL-007) · AR-3 unbounded events table (BL-001) · AR-4 Origin-less
socket clients · AR-5 slow-body connection holding (body-parser drains a declared Content-Length up to the 300 s
requestTimeout; memory unaffected) · AR-6 broadcast to all sockets (BL-006) · AR-7 `tsx` runtime transpile (BL-011).
All of these are acceptable **only** with the 127.0.0.1 bind and before Phase 2 producers. `docs/SECURITY.md` §6 lists the
requirements before Phase 2 producers (retention, SEC-1/2, producer token, ingest rate limit, redaction) and before any
non-loopback exposure (auth, rate limiting, TLS, headers, strict host/origin allowlists).

## 6. Not tested

- `vite preview` (:4173): not run. It has the same default CORS as dev, so SEC-1's fix covers `preview.cors` too.
- Browser-level clickjacking PoC (SEC-5) and a real browser exploit of SEC-1. Header and curl evidence only. Browsers
  honour the reflected ACAO shown.
- Non-loopback bind (`HOST=0.0.0.0`): checked in code only (startup `warn`, Host allowlist adds the configured host).
- Load/flood testing (rate limiting is deferred by decision).

## 7. Verdict

No critical or high findings. The local-only posture required by §26 / REQ-160–164 holds:
- no RCE, filesystem exposure or SQL injection;
- strict validation and size limits;
- DNS-rebinding and cross-site defences effective on the server itself.

SEC-1 (medium) is a dev-server configuration gap that weakens REQ-161 for other localhost origins. It should be fixed before
Phase 2 and is cheap (two config lines). SEC-2…SEC-6 are low. Route them to their owners or to BACKLOG at the PM's discretion.

Round 1 result: PASS (superseded by the Round 2 verdict below).

## 8. Round 2: re-verification of the ADR-037 fixes

Date: 2026-10-04. Inputs: ADR-037, API_CONTRACTS v1.2 *(ADR-037)* rows.

Changed code reviewed:
- `apps/server/src/api/middleware/originGuard.ts`, `requireJson.ts`, `errorHandler.ts`
- `apps/server/src/app.ts` (frameProtection, middleware order)
- `apps/web/vite.config.ts`
- `apps/web/src/store/reducer.ts` (`createIdRecord`/`setOwn`/`withEntry`)
- `packages/shared/src/constants/limits.ts` and `schemas/common.ts` (`RESERVED_TASK_IDS`)

Live setup (all from source, scratchpad `DB_PATH`, `data/office.db` not touched):
- API on :4000
- one-port `--serve-web` on :4010
- Vite dev on :5173
- `vite preview` on :4173 (round 1 did not test preview)

Probes were raw-socket HTTP with exact Host/Origin headers (scratchpad `r2.mjs`). All four processes are stopped. Ports
4000/4010/4173/5173 are free, and Sellway (5174/5188) was not touched.

Automated tests:
- server `vitest run`: 32 files / **678 passed** (includes `test/securityHardening.test.ts`)
- web `src/store`: 40 passed
- shared: 864 passed

`npm audit --omit=dev`: 0 vulnerabilities.

| Finding | Re-test (live) | Result |
|---|---|---|
| **SEC-1** medium | Through Vite dev :5173 with Origin `http://localhost:5174`: preflight → 204, **no ACAO**; GET `/api/agents` → 200, **no ACAO** (the browser cannot read it); PATCH status → **403 ORIGIN_NOT_ALLOWED**; POST event with Origin `foo.localhost:9999` → **403**. `vite preview` :4173: preflight has no ACAO, foreign-origin POST → 403. The UI path still works: POST through :5173 with Origin `http://localhost:5173` → 201 (ACAO 5173); socket WS with Origin 5173 → 101 | **FIXED** |
| **SEC-2** low | :4000 direct with Origin `evil.example`, `localhost:5174`, `null`, `file://`, `http://localhost:5173@evil.example`: POST events, POST tasks, PATCH agent status, PATCH task, demo start/stop, PUT, DELETE, unknown route, text/plain → all **403 ORIGIN_NOT_ALLOWED**. Allowed: no Origin (curl/producers) 201; `localhost:5173` / `127.0.0.1:5173` 201; same origin (`localhost:4000`; one-port `localhost:4010`, `127.0.0.1:4010`, `[::1]:4010`) 201. Cross-hostname (`Origin localhost:4010`, `Host 127.0.0.1:4010`) → 403, which is correct: browsers treat it as cross-origin too. GET with a foreign Origin → 200 without ACAO (read blocked by CORS, as designed). Foreign Host is still caught first (403 HOST_NOT_ALLOWED) | **FIXED** |
| **SEC-3** low | `Content-Encoding` corrupt gzip / corrupt br / corrupt deflate / valid gzip / `compress` / `gzip, identity` → all **400 INVALID_JSON "Content-Encoding is not supported"**, no 500, no error-level log. `identity` → 201 | **FIXED** |
| **SEC-4** low | POST task id `__proto__`, `constructor`, `prototype` → 400 `Task id "…" is reserved`; also as `taskId` in `agent.task.assigned` and in `GET /api/events?taskId=` → 400. `toString` / `__PROTO__` are accepted and harmless now. Client: the real `hydrate()` (tsx) on a snapshot with tasks `SW-1, __proto__, constructor, toString` → 4 values, prototype `null`, `__proto__` is an own key, `tasks.title` is undefined, `tasks.toString` is the task. Legacy rows created before the fix are handled safely by the null-prototype store | **FIXED** |
| **SEC-5** low | `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` present on one-port `/`, SPA fallback, `/api/health`, the 403 Host-guard response, :4000 API, Vite dev `/` and `/src/main.tsx`, and `vite preview` `/` | **FIXED** (see R2-1) |
| **SEC-6** low | Behaviour unchanged and now documented in API-C §0/§4 "Refusal response": polling foreign Host → 403 `{"code":4,"message":"Host not allowed"}`, foreign Origin → 403 `Origin not allowed`; WS upgrade foreign Host/Origin → 400; allowed Origin → 101 | **FIXED** (documentation) |

Regression spot checks (pass):
- Host guard 403
- `text/plain` 400
- 100 KB+ body → 413
- static traversal (`/../package.json`, `..%5c..%5c`, `/.env`) → SPA `index.html`, no leak
- health 200

New-surface review:
- `originGuard` runs after `hostGuard` and before the readiness gate and routes.
- It covers every `/api` write method, including unknown routes.
- It uses `URL` parsing, so `null`, non-http schemes and userinfo tricks are refused.
- An Origin with a path or upper-case letters normalizes to the same origin. Browsers never send those, and it is not exploitable.
- The `errorHandler` fallback that maps exposable 4xx body-parser errors to 400 is safe: it never hides 5xx.

Residual (not a finding, OPTIONAL, for `docs/SECURITY.md` §6 before non-loopback exposure):
- **R2-1**: static HTML still has no full CSP (only `frame-ancestors`), and no `X-Content-Type-Options`/`Referrer-Policy` on
  non-API responses. ADR-037 scoped SEC-5 to framing protection. That is enough for the clickjacking risk in a loopback-only
  Phase 1.

Round 2 result: all six findings are fixed and verified live. There are no open critical, high, medium or low findings.
`docs/SECURITY.md` is updated (threat model T2/T5/T6, controls, §6, §7).

VERDICT: PASS
