// English UI copy for enum values (UX §1.2 / §1.3, API_CONTRACTS §5.2, ADR-025).
import type { AgentStatus, Severity, TaskPriority, TaskStatus } from './statuses';

export const AGENT_STATUS_LABELS: Readonly<Record<AgentStatus, string>> = Object.freeze({
  idle: 'Idle',
  planning: 'Planning',
  working: 'Working',
  waiting: 'Waiting',
  reviewing: 'Reviewing',
  completed: 'Completed',
  failed: 'Failed',
  offline: 'Offline',
});

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = Object.freeze({
  todo: 'To do',
  assigned: 'Assigned',
  planning: 'Planning',
  in_progress: 'In progress',
  waiting: 'Waiting',
  review: 'In review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
});

export const TASK_PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = Object.freeze({
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
});

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = Object.freeze({
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
});
