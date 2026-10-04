// REQ-029 helper: a full picture of the persisted state, to prove that a rejected request changed nothing.
import { expect } from 'vitest';
import type { DatabaseHandle } from '../../src/db/types';
import type { RecordingBroadcaster } from '../../src/realtime/broadcaster';

export interface StateSnapshot {
  counts: { agents: number; tasks: number; events: number };
  maxSeq: number;
  agents: unknown[];
  tasks: unknown[];
  demoSetting: unknown;
}

export function captureState(database: DatabaseHandle): StateSnapshot {
  const repos = database.repos;
  return {
    counts: {
      agents: repos.agents.count(),
      tasks: repos.tasks.count(),
      events: repos.events.count(),
    },
    maxSeq: repos.events.maxSeq(),
    agents: repos.agents.list(),
    tasks: repos.tasks.list({ limit: Math.max(repos.tasks.count(), 1) }),
    demoSetting: repos.settings.get('demo'),
  };
}

/**
 * Runs `action` (expected to be rejected) and asserts REQ-029: no new event, no agent/task field changed,
 * nothing broadcast.
 */
export async function expectNoTrace(
  database: DatabaseHandle,
  recorder: RecordingBroadcaster,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = captureState(database);
  recorder.clear();
  await action();
  expect(captureState(database)).toEqual(before);
  expect(recorder.messages).toEqual([]);
}
