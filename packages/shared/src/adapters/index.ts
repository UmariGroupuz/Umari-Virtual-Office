// Producer adapters (API_CONTRACTS §5.3, EVENT_SYSTEM §10, ADR-007). Owned by TASK-004.
// Phase 1: the registry exists for tests and the Phase 2 `POST /api/ingest/:source` route only — no
// route, script or process uses it yet.
import { claudeCodeAdapter } from './claudeCode';
import type { ProducerAdapter } from './types';

/** Adapter registry by producer source. Null prototype: `PRODUCER_ADAPTERS['constructor']` is undefined. */
export const PRODUCER_ADAPTERS: Readonly<Record<string, ProducerAdapter<unknown>>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ProducerAdapter<unknown>>, {
    'claude-code': claudeCodeAdapter,
  }),
);

export * from './types';
export * from './claudeCode';
