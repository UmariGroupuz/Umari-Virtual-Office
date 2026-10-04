// Task entity (API_CONTRACTS §1.3, REQUIREMENTS §3.4).
import type { TaskPriority, TaskStatus } from '../constants/statuses';
import type { JsonObject } from './json';

export interface Task {
  id: string; // 'SW-123'; matches TASK_ID_PATTERN
  title: string;
  description: string | null;
  project: string; // project id (required)
  assignedAgentId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number; // integer 0–100
  createdAt: string;
  startedAt: string | null; // first entry into in_progress
  completedAt: string | null; // entry into completed; null when it leaves completed (force)
  blockedBy: string[]; // task ids, ≤ 20, unique, never contains `id`
  metadata: JsonObject;
  version: number; // ≥ 1, +1 on every row write
  updatedAt: string;
}
