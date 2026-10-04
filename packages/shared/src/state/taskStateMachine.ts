// Task state machine — AGENT_STATE_MACHINE §5.2 exactly (ADR-016/017).
import {
  ACTIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  type TaskStatus,
} from '../constants/statuses';

/** Legal targets per status; `completed` and `cancelled` are terminal (only `force`, ADR-015). */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = Object.freeze({
  todo: Object.freeze(['assigned', 'planning', 'in_progress', 'cancelled']),
  assigned: Object.freeze([
    'todo',
    'planning',
    'in_progress',
    'waiting',
    'review',
    'failed',
    'cancelled',
  ]),
  planning: Object.freeze(['in_progress', 'waiting', 'failed', 'cancelled']),
  in_progress: Object.freeze(['waiting', 'review', 'completed', 'failed', 'cancelled']),
  waiting: Object.freeze(['planning', 'in_progress', 'review', 'failed', 'cancelled']),
  review: Object.freeze(['in_progress', 'waiting', 'completed', 'failed', 'cancelled']),
  completed: Object.freeze([]),
  failed: Object.freeze(['assigned', 'planning', 'in_progress', 'waiting', 'review', 'cancelled']),
  cancelled: Object.freeze([]),
} satisfies Record<TaskStatus, readonly TaskStatus[]>);

/**
 * `false` when `from === to`. Implicit assignment (ASM §5.2, ADR-017): a `todo` task that is (or becomes
 * in the same operation) owned is validated from `assigned` — legal iff `to === 'assigned'` or
 * `assigned → to` is legal.
 */
export function canTransitionTask(
  from: TaskStatus,
  to: TaskStatus,
  options?: { owned?: boolean },
): boolean {
  if (from === to) return false;
  if (from === 'todo' && options?.owned === true) {
    return to === 'assigned' || TASK_TRANSITIONS.assigned.includes(to);
  }
  return TASK_TRANSITIONS[from].includes(to);
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return (ACTIVE_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}
