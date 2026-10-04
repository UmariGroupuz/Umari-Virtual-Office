// Statuses, priorities and severities (API_CONTRACTS §1.2, AGENT_STATE_MACHINE §1/§5.1).

export const AGENT_STATUSES = [
  'idle',
  'planning',
  'working',
  'waiting',
  'reviewing',
  'completed',
  'failed',
  'offline',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
/** ASM §1: statuses in which the agent is doing work. */
export const ACTIVE_AGENT_STATUSES = ['planning', 'working', 'waiting', 'reviewing'] as const;
export const RESTING_AGENT_STATUSES = ['idle', 'completed', 'failed'] as const;

export const TASK_STATUSES = [
  'todo',
  'assigned',
  'planning',
  'in_progress',
  'waiting',
  'review',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** A-06: statuses counted by the "Active Tasks" metric. */
export const ACTIVE_TASK_STATUSES = [
  'assigned',
  'planning',
  'in_progress',
  'waiting',
  'review',
] as const;
export const TERMINAL_TASK_STATUSES = ['completed', 'cancelled'] as const;

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const SEVERITIES = ['info', 'warning', 'error'] as const;
export type Severity = (typeof SEVERITIES)[number];
