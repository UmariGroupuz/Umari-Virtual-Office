import { describe, expect, it } from 'vitest';
import {
  ACTIVE_AGENT_STATUSES,
  AGENT_STATUSES,
  type AgentStatus,
  type TaskStatus,
} from '../constants/statuses';
import { canTransitionAgent } from './agentStateMachine';
import { AGENT_TO_TASK_STATUS, mapAgentStatusToTaskStatus } from './statusMapping';
import { canTransitionTask } from './taskStateMachine';

describe('AGENT_TO_TASK_STATUS (ASM §6)', () => {
  it.each([
    ['planning', 'planning'],
    ['working', 'in_progress'],
    ['waiting', 'waiting'],
    ['reviewing', 'review'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['idle', null],
    ['offline', null],
  ] as [AgentStatus, TaskStatus | null][])('%s → %s', (agent, task) => {
    expect(mapAgentStatusToTaskStatus(agent)).toBe(task);
    expect(AGENT_TO_TASK_STATUS[agent] ?? null).toBe(task);
  });

  it('has exactly 6 entries (idle and offline leave the task unchanged)', () => {
    expect(Object.keys(AGENT_TO_TASK_STATUS).sort()).toEqual(
      ['completed', 'failed', 'planning', 'reviewing', 'waiting', 'working'].sort(),
    );
  });
});

/**
 * Mirror task statuses of an agent status (ASM §6): map(S) for active S; `assigned` for resting S
 * (a newly assigned task), plus `failed` for S = failed (retrying the failed task). `todo` is added for
 * resting S because an owned `todo` task is validated from `assigned` (implicit assignment).
 * Not defined for `offline` (the agent must reconnect first; it owns no running work).
 */
function mirrors(s: AgentStatus): TaskStatus[] {
  const mapped = mapAgentStatusToTaskStatus(s);
  if ((ACTIVE_AGENT_STATUSES as readonly string[]).includes(s) && mapped) return [mapped];
  if (s === 'failed') return ['assigned', 'todo', 'failed'];
  if (s === 'idle' || s === 'completed') return ['assigned', 'todo'];
  return [];
}

describe('consistency property (ASM §6, ADR-016): agent legal ⇔ mirrored task legal', () => {
  const cases = AGENT_STATUSES.filter((s) => s !== 'offline').flatMap((from) =>
    AGENT_STATUSES.filter((to) => to !== from && mapAgentStatusToTaskStatus(to) !== null).flatMap(
      (to) => mirrors(from).map((mirror) => ({ from, to, mirror })),
    ),
  );

  it('enumerates every online source, mapped target and mirror', () => {
    // 7 online sources; per source the mapped targets minus itself; × mirrors.
    expect(cases.length).toBeGreaterThan(40);
    expect(new Set(cases.map((c) => c.from)).size).toBe(7);
  });

  it.each(cases)('agent $from → $to vs task $mirror', ({ from, to, mirror }) => {
    const taskTarget = mapAgentStatusToTaskStatus(to);
    expect(taskTarget).not.toBeNull();
    expect(canTransitionTask(mirror, taskTarget as TaskStatus, { owned: true })).toBe(
      canTransitionAgent(from, to),
    );
  });

  it('the only exception is a completed (terminal) task, which cannot be restarted', () => {
    // A completed agent may start new work, but not on its completed task.
    expect(canTransitionAgent('completed', 'working')).toBe(true);
    expect(canTransitionTask('completed', 'in_progress', { owned: true })).toBe(false);
  });
});
