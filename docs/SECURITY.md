# SECURITY — AI Virtual Office, Phase 1

Owner: security-engineer · Last review: 2026-10-04, round 2 after ADR-037 fixes (VO-000 security gate,
`tasks/reports/VO-000-security.md`)
Inputs: ORIGINAL_REQUEST §26, REQUIREMENTS REQ-160–164 / NFR-004 / NFR-008 / A-12 / A-15, ADR-019, ADR-027,
ADR-035, ADR-037, API_CONTRACTS v1.2.

## 1. Security model in one paragraph

Phase 1 is a **single-operator, local-only monitoring app** with **no authentication**. The server binds
`127.0.0.1` and trusts every process on the machine. The defences are aimed at two outside threats: **other
machines** (blocked by the loopback bind) and **websites open in the owner's browser** (blocked by the
Host guard, CORS allowlist, JSON-only writes, the Origin rule on HTTP writes and Socket.IO, and framing headers). The app is monitoring only. It
runs no commands, reads or writes no files (other than its own SQLite DB and the static web build), and
evaluates no code.

## 2. Assets

| Asset | Sensitivity in Phase 1 | Notes |
|---|---|---|
| Office state (agents, tasks, events) in `data/office.db` | Low: simulator/demo/curl data | Becomes **medium** in Phase 2: real Claude Code activity (commands, file paths, messages) |
| Integrity of the dashboard | Low–medium | The owner makes decisions from it |
| Owner's machine (filesystem, shell) | High | Must never be reachable through this app (REQ-160) |

## 3. Trust boundaries and threat model (Phase 1)

| # | Actor / channel | Trusted? | What they can do today | Control |
|---|---|---|---|---|
| T1 | Another machine on the LAN/Internet | No | Nothing. The server is not reachable | `HOST=127.0.0.1` default; startup `warn non_loopback_host` if changed |
| T2 | Cross-site web page (`https://evil.example`) in the owner's browser | No | Can send "blind" GETs (responses unreadable) only | CORS allowlist (no ACAO), Origin rule on writes (403 `ORIGIN_NOT_ALLOWED`), `Content-Type: application/json` required on every write (forces preflight), no state-changing GET |
| T3 | DNS-rebinding page (`evil.example` → 127.0.0.1) | No | Nothing: requests carry `Host: evil.example` | Host guard (HTTP 403 `HOST_NOT_ALLOWED`, Socket.IO handshake refused); Vite dev server's own `allowedHosts` |
| T4 | Cross-site WebSocket / polling to Socket.IO | No | Nothing | `allowRequest` Origin rule (ADR-035); `null`/foreign origins refused on polling and WebSocket upgrade |
| T5 | Page served from **another localhost origin** (e.g. other dev servers on :5174/:5188, `*.localhost`) | No | Nothing (fixed in round 2: SEC-1/SEC-2) | Vite dev/preview `cors: false` (the backend allowlist is the only CORS authority); HTTP Origin rule on writes, also through the proxy |
| T6 | Framing site (clickjacking) | No | Nothing: the browser refuses to frame the UI | `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` on every server response and on Vite dev/preview (SEC-5) |
| T7 | Any local process (curl, scripts, malware) | **Yes (accepted)** | Full read/write of office data, unlimited event volume | None by design: A-12, ADR-019. See accepted risks |
| T8 | Producer-supplied text (messages, metadata, ids) | No | Stored and shown in the UI | Strict Zod schemas, size limits, React/Phaser text rendering, parameterized SQL |

## 4. Controls in place (verified 2026-10-04, live and in code)

| Area | Control | Where |
|---|---|---|
| Network bind | `127.0.0.1` default; non-loopback bind logs a `warn` that there is no auth | `config.ts`, `index.ts` |
| DNS rebinding | Host allowlist `localhost`, `127.0.0.1`, `[::1]`, configured `HOST` (any port), on HTTP (incl. static files) and Socket.IO; missing Host → 403 | `api/middleware/hostGuard.ts`, `realtime/socketServer.ts` |
| CSRF | No auth cookies exist. POST/PATCH/PUT/DELETE with a foreign `Origin` → 403 `ORIGIN_NOT_ALLOWED` (allowed: absent, `CORS_ORIGINS`, same origin). Every POST/PATCH requires `application/json` (text/plain, form and multipart → 400). No GET has side effects. PUT/DELETE/TRACE → 404 | `api/middleware/originGuard.ts`, `requireJson.ts`, routes |
| CORS | `cors({origin: CORS_ORIGINS, credentials:false})`; foreign and `null` origins get no `Access-Control-Allow-Origin`. The Vite dev/preview servers add no CORS layer of their own (`cors: false`) | `api/router.ts`, `apps/web/vite.config.ts` |
| Framing | `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` on every server response (API, errors, static) and on Vite dev/preview | `app.ts`, `apps/web/vite.config.ts` |
| Socket.IO | Server→client only, client emits ignored (REQ-051); Host + Origin + readiness check in `allowRequest` for polling and direct WebSocket | `realtime/socketServer.ts` |
| Input validation | Zod `strictObject` on every body and query (unknown keys → 400, repeated query keys → 400); typed enums; ids by regex; limits: body 100 KB (413); compressed bodies refused (`inflate:false` → 400 `Content-Encoding is not supported`, a corrupt body never yields 500); metadata 8 KB (iterative walk, no recursion), message 2 000, title 200, list ≤ 500 | `packages/shared/src/schemas/**`, `requireJson.ts` |
| Prototype pollution | `__proto__`/`constructor` keys rejected at top level (unrecognized key); metadata is stored as JSON text and never merged into objects; task ids `__proto__`/`constructor`/`prototype` reserved (`RESERVED_TASK_IDS`); the web store keys agents/tasks in null-prototype records written with `defineProperty` | schemas, `db/mappers.ts`, `apps/web/src/store/reducer.ts` |
| SQL injection | `node:sqlite` prepared statements with bound parameters only; dynamic WHERE is built from a fixed clause set; `LIMIT` bound | `db/repositories/**` |
| Filesystem | No upload, no file read/write API. Static mode serves only `apps/web/dist` (`express.static`, dotfiles ignored); traversal attempts return the SPA `index.html` | `api/static.ts` |
| RCE | No `child_process`, `eval`, `new Function` or dynamic `require` in server, web or shared code | — |
| Output safety | Errors are `{error:{code,message,details?}}`, never stack/SQL; JSON with `nosniff` + `no-store`; React text nodes only (no `dangerouslySetInnerHTML`); Phaser draws text to canvas | `errors.ts`, `errorHandler.ts`, `apps/web/**` |
| Logging | Structured JSON lines; request logs contain status/code/method/route only (no bodies, no query strings); rejection context truncated (100–200 chars); stacks only on `error` lines | `logger.ts`, `errorHandler.ts`, `eventService.ts` |
| Secrets | None needed. `.env`, `.env.*` (except `.env.example`) and `data/*` are gitignored; `.env.example` has no secrets; web bundle has no env values | `.gitignore`, `.env.example` |
| `db:reset` | Refuses `:memory:`, any path outside `<repo>/data/`, and a running server; never runs implicitly | `seed/reset.ts` |
| Dev tooling | `scripts/dev.mjs` spawns `node` with argument arrays (no shell); PowerShell helpers use constant ports only; it only kills processes it started. `scripts/verify.mjs` uses `shell:true` with constant step names only | `scripts/**` |
| Dependencies | `npm audit --omit=dev` and `npm audit`: **0 vulnerabilities** (2026-10-04, rounds 1 and 2) | `package-lock.json` |

## 5. Accepted risks (Phase 1)

| ID | Risk | Why accepted now | Must change when |
|---|---|---|---|
| AR-1 | **No authentication**: any local process can read and write all office data and broadcasts (A-12, ADR-019) | Single operator, loopback only, monitoring data with no secrets | Before any non-loopback bind (Phase 8/9) or before Phase 2 producers send sensitive content (see §6) |
| AR-2 | **No rate limiting** (A-15, BL-007) | Needs local code execution to abuse. Body ≤ 100 KB, lists ≤ 500, demo ≥ 2 s. Worst case is disk growth, not a crash | Before non-loopback exposure; before automated producers (Phase 2) a per-source limit is recommended |
| AR-3 | **Unbounded `events` table** (retention deferred, BL-001) | ~10 KB max per event; 30 min of demo ≈ 600 events | Before Phase 2 producers (BL-001 target) |
| AR-4 | Socket.IO accepts **Origin-less** clients | Browsers always send Origin; non-browser clients are local processes (AR-1) | With AR-1 |
| AR-5 | A client can hold a connection by declaring a large `Content-Length` and dripping the body; body-parser drains it before answering (up to Node's 300 s `requestTimeout`). Memory is not affected | Local only | With AR-2 |
| AR-6 | All monitoring data goes to every connected socket (no rooms/tenants, BL-006) | Single operator | Phase 8–10 |
| AR-7 | The server runs TypeScript through `tsx` at runtime (`npm start`) | Dev-grade runtime for a local app; audit clean | Phase 9 compiled build (BL-011) |

## 6. Required before Phase 2 producers or any non-loopback exposure

**Before Phase 2 real producers (Claude Code hooks etc.):**
1. Event retention (BL-001): a count/age cap with a tested prune.
2. (Done in ADR-037: SEC-1/SEC-2. Keep them: no Vite CORS layer, and the HTTP Origin rule on writes.)
3. A **producer token** (shared secret in `.env`, header `Authorization: Bearer …`, constant-time compare) for
   `POST /api/events` and `/api/ingest/:source`, recommended because real producer payloads may carry commands, paths and code
   snippets. Validate adapter payloads strictly (BL-008) and never execute or open anything named in them (REQ-160 still applies).
4. Per-source rate limit on ingest (BL-007 part 1), with a 429 envelope.
5. A review of what Phase 2 stores (redact secrets/tokens in captured commands before persisting).

**Before binding anything other than loopback (Phase 8/9):**
1. Authentication for operator endpoints (UI + PATCH/POST + Socket.IO handshake auth), and authorization roles.
2. Rate limiting and brute-force protection on auth.
3. TLS (directly or via a reverse proxy); `trust proxy` configured correctly; HSTS.
4. Full security headers on all HTML: a complete CSP for the bundle (framing protection already exists), `Referrer-Policy`, `nosniff` on static files (BL item R2-1).
5. Host allowlist extended to the real hostname only; CORS/Origin allowlist reviewed; the non-loopback `warn` turned into a hard
   refusal unless auth is configured.
6. Retention, backup and data-deletion policy for the DB.

## 7. Findings status (VO-000)

Round 1 raised SEC-1 (medium) and SEC-2…SEC-6 (low). All six were fixed in ADR-037 and **verified live in round 2**
(`tasks/reports/VO-000-security.md` §8). Residual OPTIONAL item R2-1: a full CSP plus `nosniff`/`Referrer-Policy` on static
HTML before any non-loopback exposure (§6). There are no open critical, high, medium or low findings.
