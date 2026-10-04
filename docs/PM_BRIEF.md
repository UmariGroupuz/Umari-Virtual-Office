# PM BRIEF — AI Virtual Office MVP (Phase 1)

Owner of this file: PM. Binding for every agent. Date: 2026-10-03.

## Hard rules (from the owner)

- Work only inside `C:\Users\User\Music\Claude agentlar\Virtual Office MVP` (the "project root").
  Never modify the parent folder or any other folder.
- No commits, no pushes, no deploys, no production systems, no real API keys.
- Monitoring only: no shell execution API, no filesystem exposure, no remote code execution.
- Build a runnable, verified MVP — not a mockup.
- Docs, prompts and task files are written in English.

## PM technical constraints (pre-decided, reversible, to be recorded as ADRs by the architect)

These were decided by the PM after probing the environment. Architect may refine details but must
not reverse them without a documented, strong reason.

1. **Monorepo with npm workspaces**: `apps/web`, `apps/server`, `packages/shared`.
   The owner's suggested `packages/types` is merged into `packages/shared` (types + Zod schemas +
   state machines + constants) to avoid two tiny packages ("do not over-engineer").
   `packages/shared` is consumed as TypeScript source (no build step) by Vite and by `tsx`.
2. **Database**: SQLite through Node's built-in `node:sqlite` (`DatabaseSync`, Node ≥ 22.13;
   environment has Node 24.12). Prisma rejected for Phase 1: generate step + engine binaries
   download + Windows friction; a thin repository layer with SQL migrations is simpler and keeps
   the DB swappable. DB file: `data/office.db` (gitignored). Tests use `:memory:`.
3. **Server**: Express 5 + Socket.IO 4 + Zod. Run with `tsx` in dev. Bind to `127.0.0.1` by default.
   Optional: in production mode the server serves the built web app (`apps/web/dist`) on one port.
4. **Web**: React 19 + Vite + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`) + Zustand +
   React Router + Phaser **3** (3.90.x — NOT Phaser 4) + lucide-react icons + Inter via
   `@fontsource-variable/inter` (no CDN). Vite dev server proxies `/api` and `/socket.io` to the server.
5. **Tooling**: TypeScript ~5.9 (NOT 7.x — typescript-eslint supports <6.1), ESLint 9 flat config
   with typescript-eslint, Prettier, Vitest (server + shared + web), Supertest, socket.io-client
   for socket propagation tests, @testing-library/react + jsdom for web.
6. **Ports**: server `4000`, web dev `5173`.
7. **All state changes flow through the backend event pipeline** (`POST /api/events` →
   EventService → DB → agent/task state → Socket.IO broadcast). The simulator and demo mode use
   the same pipeline. The frontend never mutates agent state locally as the primary mechanism.
8. **Projects**: 4 real projects are seeded (Sellway, Ishkun24, ERP, Ana Market). "All Projects"
   is the virtual "no filter" option in the selector (5 selector options total). Record this as
   an assumption.
9. **Producer-agnostic events**: canonical event envelope with a `source` field. Producer-specific
   formats (e.g. the future Claude Code format in §19 of the request) are handled by pure adapter
   functions that map to the canonical envelope. No real Claude integration in Phase 1.
10. **Demo mode** runs on the server, emits events through the same EventService with
    `source: "demo"`, snapshots state on start and restores it on stop (persisted so a crash
    during demo can be recovered), and never restores over agents/tasks that the user changed
    while demo was running.

## Source documents

- `docs/ORIGINAL_REQUEST.md` — the owner's verbatim request (binding).
- Organization rules: `C:\Users\User\Music\Claude agentlar\CLAUDE.md` (read-only).
- Role definitions: `C:\Users\User\Music\Claude agentlar\.claude\agents\NN-*.md` (read-only).
