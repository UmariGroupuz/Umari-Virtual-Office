import type { DatabaseSync } from 'node:sqlite';
import type {
  Agent,
  EventType,
  JsonValue,
  OfficeEvent,
  Project,
  Task,
  TaskStatus,
} from '@vo/shared';

export type AgentMutableField =
  | 'status'
  | 'currentProject'
  | 'currentTask'
  | 'taskId'
  | 'progress'
  | 'startedAt'
  | 'lastActivityAt'
  | 'currentAction'
  | 'lastMessage'
  | 'online'
  | 'metadata';
export type AgentPatch = Partial<Pick<Agent, AgentMutableField>>;
export type TaskMutableField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'progress'
  | 'assignedAgentId'
  | 'startedAt'
  | 'completedAt'
  | 'blockedBy'
  | 'metadata';
export type TaskPatch = Partial<Pick<Task, TaskMutableField>>;
export type NewTask = Omit<Task, 'version' | 'updatedAt'>;
export type NewEvent = Omit<OfficeEvent, 'seq'>; // id + createdAt assigned by EventService
export type EventDraft = Omit<OfficeEvent, 'seq' | 'id' | 'createdAt'>; // produced by pure rules

export interface EventListQuery {
  projectId?: string; // feed predicate (ES §8.3)
  agentId?: string;
  taskId?: string;
  type?: EventType;
  source?: string;
  before?: number; // seq < before
  limit: number; // 1–500
}
export interface EventListResult {
  events: OfficeEvent[];
  nextBefore: number | null;
}
export interface TouchedEntities {
  agentIds: Set<string>;
  taskIds: Set<string>;
}

export interface ProjectRepository {
  list(): Project[]; // ORDER BY sort_order
  getById(id: string): Project | null;
  insert(project: Project & { sortOrder: number }, now: string): void;
}
export interface AgentRepository {
  list(filter?: { projectId?: string }): Agent[]; // ORDER BY sort_order
  getById(id: string): Agent | null;
  count(): number;
  insert(agent: Agent & { sortOrder: number }, now: string): void; // seed only; stores agent.version as given
  update(id: string, patch: AgentPatch, now: string): Agent; // applies patch, version = version + 1, updated_at = now; throws if id unknown
  replace(agent: Agent, now: string): Agent; // demo restore: writes all mutable fields of `agent`, version = current + 1 (ignores agent.version)
}
export interface TaskRepository {
  list(filter?: {
    projectId?: string;
    agentId?: string;
    status?: TaskStatus;
    limit?: number;
  }): Task[]; // ORDER BY created_at, id; default limit 500
  getById(id: string): Task | null;
  existingIds(ids: readonly string[]): Set<string>;
  count(): number;
  maxNumericSuffix(prefix: string): number | null; // max n over ids matching ^<prefix>-(\d+)$; null if none
  insert(task: NewTask, now: string): Task; // version 1, updated_at = now
  update(id: string, patch: TaskPatch, now: string): Task; // version + 1; throws if id unknown
  replace(task: Task, now: string): Task; // demo restore: all mutable fields, version = current + 1
  delete(id: string): boolean; // demo restore only
}
export interface EventRepository {
  insert(event: NewEvent): OfficeEvent; // assigns seq
  list(query: EventListQuery): EventListResult; // seq DESC; fetches limit + 1 to compute nextBefore
  maxSeq(): number; // 0 when empty
  count(): number;
  touchedSince(startSeq: number): TouchedEntities; // ADR-011: agents = agent_id of type 'agent.%' events, tasks = task_id of any type; seq > startSeq AND source <> 'demo'
}
export interface SettingsRepository {
  get(key: string): JsonValue | null;
  set(key: string, value: JsonValue, now: string): void; // upsert
  delete(key: string): boolean;
}
export interface Repositories {
  projects: ProjectRepository;
  agents: AgentRepository;
  tasks: TaskRepository;
  events: EventRepository;
  settings: SettingsRepository;
}
export interface DatabaseHandle {
  readonly db: DatabaseSync;
  readonly path: string; // ':memory:' or absolute file path
  readonly repos: Repositories;
  readonly schemaVersion: number;
  /** BEGIN IMMEDIATE … COMMIT; ROLLBACK and rethrow on throw. `fn` must be synchronous: a returned thenable
   *  causes ROLLBACK and an Error('Transaction callback must be synchronous'). Nested calls throw. */
  transaction<T>(fn: (repos: Repositories) => T): T;
  ping(): boolean; // SELECT 1; false on error (never throws)
  close(): void; // idempotent
}
