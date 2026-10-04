// Events (API_CONTRACTS §1.4, EVENT_SYSTEM §2–§3).
import type { EventType } from '../constants/eventTypes';
import type { AgentStatus, Severity, TaskStatus } from '../constants/statuses';
import type { JsonObject } from './json';

/** Stored event: returned by the API and pushed over the socket (ES §2.2). */
export interface OfficeEvent {
  id: string; // UUID v4
  seq: number; // strictly increasing integer; total order and paging cursor
  type: EventType;
  source: string; // resolved; 'api' when the producer omitted it
  agentId: string | null;
  project: string | null; // resolved/derived project id (ES §5.4)
  taskId: string | null;
  status: AgentStatus | TaskStatus | null; // TaskStatus only for type 'task.updated' / 'task.created'
  action: string | null;
  message: string | null;
  severity: Severity; // resolved (ES §2.3)
  progress: number | null;
  metadata: JsonObject;
  occurredAt: string | null; // producer clock, informational
  createdAt: string; // server time
  forced: boolean; // ADR-015
}

/** Fields every producer event type accepts (ES §3). */
interface EventInputCommon {
  source?: string;
  project?: string; // id or name, unresolved
  action?: string;
  message?: string;
  severity?: Severity;
  metadata?: JsonObject;
  occurredAt?: string;
}

/** Producer input after parsing (= z.output<typeof eventInputSchema>). */
export type EventInput =
  | (EventInputCommon & {
      type: 'agent.connected' | 'agent.disconnected';
      agentId: string;
      taskId?: string;
    })
  | (EventInputCommon & {
      type: 'agent.status.changed';
      agentId: string;
      status: AgentStatus;
      taskId?: string;
      progress?: number;
    })
  | (EventInputCommon & {
      type: 'agent.activity';
      agentId: string;
      action: string;
      status?: AgentStatus;
      taskId?: string;
      progress?: number;
    })
  | (EventInputCommon & {
      type: 'agent.message';
      agentId: string;
      message: string;
      status?: AgentStatus;
      taskId?: string;
      progress?: number;
    })
  | (EventInputCommon & {
      type:
        'agent.task.assigned' | 'agent.task.started' | 'agent.task.completed' | 'agent.task.failed';
      agentId: string;
      taskId: string;
      status?: AgentStatus;
      progress?: number;
    })
  | (EventInputCommon & {
      type: 'agent.task.progress';
      agentId: string;
      taskId: string;
      progress: number;
      status?: AgentStatus;
    })
  | (EventInputCommon & {
      type: 'system.info' | 'system.warning' | 'system.error';
      message: string;
      agentId?: string;
      taskId?: string;
    });
