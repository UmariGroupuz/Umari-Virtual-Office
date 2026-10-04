// Row ↔ domain mapping (API_CONTRACTS §8): snake_case columns ↔ camelCase fields, booleans 0/1,
// JSON columns parsed/serialized, `project_id` ↔ `project`. `sort_order`/`created_at` of projects and
// `sort_order`/`updated_at` of agents are not exposed.
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type {
  Agent,
  AgentStatus,
  EventType,
  JsonObject,
  JsonValue,
  OfficeEvent,
  Project,
  RoomId,
  Severity,
  Task,
  TaskPriority,
  TaskStatus,
} from '@vo/shared';
import type { TaskMutableField } from './types';

export type Row = Record<string, SQLOutputValue>;
export type NamedParams = Record<string, SQLInputValue>;

function column(row: Row, key: string): SQLOutputValue {
  if (!(key in row)) throw new Error(`Column "${key}" missing from row`);
  return row[key] ?? null;
}

export function readString(row: Row, key: string): string {
  const value = column(row, key);
  if (typeof value !== 'string') throw new Error(`Column "${key}" is not TEXT`);
  return value;
}

export function readNullableString(row: Row, key: string): string | null {
  const value = column(row, key);
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Column "${key}" is not TEXT or NULL`);
  return value;
}

export function readInteger(row: Row, key: string): number {
  const value = column(row, key);
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Column "${key}" is not an INTEGER`);
  }
  return value;
}

export function readNullableInteger(row: Row, key: string): number | null {
  return column(row, key) === null ? null : readInteger(row, key);
}

export function readBoolean(row: Row, key: string): boolean {
  const value = readInteger(row, key);
  if (value !== 0 && value !== 1) throw new Error(`Column "${key}" is not a 0/1 boolean`);
  return value === 1;
}

function isPlainJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJson(row: Row, key: string): JsonValue {
  return JSON.parse(readString(row, key)) as JsonValue;
}

export function readJsonObject(row: Row, key: string): JsonObject {
  const value = readJson(row, key);
  if (!isPlainJsonObject(value)) throw new Error(`Column "${key}" is not a JSON object`);
  return value;
}

export function readStringArray(row: Row, key: string): string[] {
  const value = readJson(row, key);
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`Column "${key}" is not a JSON string array`);
  }
  return value;
}

export function toDbBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Serializes a JSON column; `undefined` (impossible by type, possible at runtime) becomes the default. */
export function toDbJson(value: JsonValue | undefined, fallback: '{}' | '[]'): string {
  return value === undefined ? fallback : JSON.stringify(value);
}

export function rowToProject(row: Row): Project {
  return {
    id: readString(row, 'id'),
    name: readString(row, 'name'),
    taskPrefix: readString(row, 'task_prefix'),
  };
}

export function rowToAgent(row: Row): Agent {
  return {
    id: readString(row, 'id'),
    code: readString(row, 'code'),
    name: readString(row, 'name'),
    role: readString(row, 'role'),
    shortRole: readString(row, 'short_role'),
    avatar: readString(row, 'avatar'),
    department: readString(row, 'department'),
    roomId: readString(row, 'room_id') as RoomId,
    deskId: readString(row, 'desk_id'),
    status: readString(row, 'status') as AgentStatus,
    currentProject: readNullableString(row, 'current_project'),
    currentTask: readNullableString(row, 'current_task'),
    taskId: readNullableString(row, 'task_id'),
    progress: readInteger(row, 'progress'),
    startedAt: readNullableString(row, 'started_at'),
    lastActivityAt: readNullableString(row, 'last_activity_at'),
    currentAction: readNullableString(row, 'current_action'),
    lastMessage: readNullableString(row, 'last_message'),
    online: readBoolean(row, 'online'),
    metadata: readJsonObject(row, 'metadata'),
    version: readInteger(row, 'version'),
  };
}

/** Parameters of the mutable agent columns (shared by insert, update and replace). */
export function agentMutableParams(agent: Agent): NamedParams {
  return {
    status: agent.status,
    current_project: agent.currentProject,
    current_task: agent.currentTask,
    task_id: agent.taskId,
    progress: agent.progress,
    started_at: agent.startedAt,
    last_activity_at: agent.lastActivityAt,
    current_action: agent.currentAction,
    last_message: agent.lastMessage,
    online: toDbBoolean(agent.online),
    metadata: toDbJson(agent.metadata, '{}'),
  };
}

export function rowToTask(row: Row): Task {
  return {
    id: readString(row, 'id'),
    title: readString(row, 'title'),
    description: readNullableString(row, 'description'),
    project: readString(row, 'project_id'),
    assignedAgentId: readNullableString(row, 'assigned_agent_id'),
    status: readString(row, 'status') as TaskStatus,
    priority: readString(row, 'priority') as TaskPriority,
    progress: readInteger(row, 'progress'),
    createdAt: readString(row, 'created_at'),
    startedAt: readNullableString(row, 'started_at'),
    completedAt: readNullableString(row, 'completed_at'),
    blockedBy: readStringArray(row, 'blocked_by'),
    metadata: readJsonObject(row, 'metadata'),
    version: readInteger(row, 'version'),
    updatedAt: readString(row, 'updated_at'),
  };
}

/** Parameters of the mutable task columns (shared by insert, update and replace). */
export function taskMutableParams(task: Pick<Task, TaskMutableField>): NamedParams {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    progress: task.progress,
    assigned_agent_id: task.assignedAgentId,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    blocked_by: toDbJson(task.blockedBy, '[]'),
    metadata: toDbJson(task.metadata, '{}'),
  };
}

export function rowToEvent(row: Row): OfficeEvent {
  return {
    id: readString(row, 'id'),
    seq: readInteger(row, 'seq'),
    type: readString(row, 'type') as EventType,
    source: readString(row, 'source'),
    agentId: readNullableString(row, 'agent_id'),
    project: readNullableString(row, 'project_id'),
    taskId: readNullableString(row, 'task_id'),
    status: readNullableString(row, 'status') as OfficeEvent['status'],
    action: readNullableString(row, 'action'),
    message: readNullableString(row, 'message'),
    severity: readString(row, 'severity') as Severity,
    progress: readNullableInteger(row, 'progress'),
    metadata: readJsonObject(row, 'metadata'),
    occurredAt: readNullableString(row, 'occurred_at'),
    createdAt: readString(row, 'created_at'),
    forced: readBoolean(row, 'forced'),
  };
}
