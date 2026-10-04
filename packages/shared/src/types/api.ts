// REST payloads and envelopes (API_CONTRACTS §0, §1.5, ADR-021).
import type { ErrorCode } from '../constants/errorCodes';
import type { Agent } from './agent';
import type { DemoState } from './demo';
import type { OfficeEvent } from './event';
import type { Project } from './project';
import type { Task } from './task';

export interface ApiSuccess<T> {
  data: T;
}
/** nextBefore = `before` value for the next older page, null = no older items. */
export interface ApiPage {
  limit: number;
  nextBefore: number | null;
}
export interface ApiPagedList<T> {
  data: T[];
  page: ApiPage;
}
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/** path: dot-joined, '' = root. */
export interface ValidationIssue {
  path: string;
  message: string;
}
export interface IllegalTransitionDetails {
  entity: 'agent' | 'task';
  id: string;
  from: string;
  to: string;
}
export interface ProjectMismatchDetails {
  taskId: string;
  taskProject: string;
  eventProject: string;
}

/** Result of every accepted write; identical to the `office:event` socket payload. */
export interface OfficeEventPayload {
  event: OfficeEvent;
  agent: Agent | null;
  task: Task | null;
}
/** Write result that may be a no-op (event === null: nothing stored or broadcast). */
export type WriteResult =
  OfficeEventPayload | { event: null; agent: Agent | null; task: Task | null };

export interface HealthData {
  status: 'ok';
  db: 'ok';
  uptimeSec: number;
  version: string;
  time: string;
}
export interface HealthErrorDetails {
  status: 'error';
  db: 'error';
  uptimeSec: number;
  version: string;
  time: string;
}

export interface Snapshot {
  agents: Agent[]; // all 15, ordered by agent number
  tasks: Task[]; // newest ≤ 500 tasks + every task referenced by an agent's taskId (ADR-035)
  projects: Project[]; // 4
  events: OfficeEvent[]; // newest first, feed predicate for `project`
  eventsPage: ApiPage;
  demo: DemoState;
  serverTime: string; // for client clock-offset (RECOMMENDED use)
  lastSeq: number; // highest stored event seq at read time, 0 if none — resync watermark (ADR-035)
}
