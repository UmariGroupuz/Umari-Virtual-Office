// Agent status → task status mapping (AGENT_STATE_MACHINE §6, REQ-042).
import type { AgentStatus, TaskStatus } from '../constants/statuses';

/** `idle` and `offline` leave the task unchanged (no entry). */
export const AGENT_TO_TASK_STATUS: Readonly<Partial<Record<AgentStatus, TaskStatus>>> =
  Object.freeze({
    planning: 'planning',
    working: 'in_progress',
    waiting: 'waiting',
    reviewing: 'review',
    completed: 'completed',
    failed: 'failed',
  });

export function mapAgentStatusToTaskStatus(status: AgentStatus): TaskStatus | null {
  return AGENT_TO_TASK_STATUS[status] ?? null;
}
