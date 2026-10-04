// One function per REST endpoint the web app uses (API-C §3). Bodies follow §10.3 exactly.
import {
  LIMITS,
  type Agent,
  type AgentStatusPatchBody,
  type ApiPage,
  type DemoState,
  type DemoStopResult,
  type EventInputBody,
  type HealthData,
  type OfficeEvent,
  type OfficeEventPayload,
  type Snapshot,
  type Task,
  type WriteResult,
} from '@vo/shared';
import { apiRequest, apiRequestEnvelope, toQuery } from './client';

export interface EventsPage {
  events: OfficeEvent[];
  page: ApiPage;
}

export interface EventsQueryParams {
  project?: string | null;
  agentId?: string;
  before?: number;
  limit?: number;
}

export interface OfficeApi {
  getHealth: (signal?: AbortSignal) => Promise<HealthData>;
  getSnapshot: (project: string | null, signal?: AbortSignal) => Promise<Snapshot>;
  getEvents: (query: EventsQueryParams, signal?: AbortSignal) => Promise<EventsPage>;
  getTasks: (query: { agentId?: string }, signal?: AbortSignal) => Promise<Task[]>;
  getAgent: (id: string, signal?: AbortSignal) => Promise<Agent>;
  patchAgentStatus: (id: string, body: AgentStatusPatchBody) => Promise<WriteResult>;
  postEvent: (body: EventInputBody) => Promise<OfficeEventPayload>;
  getDemo: (signal?: AbortSignal) => Promise<DemoState>;
  startDemo: () => Promise<DemoState>;
  stopDemo: () => Promise<DemoStopResult>;
}

export function createOfficeApi(): OfficeApi {
  return {
    getHealth: (signal) =>
      apiRequest<HealthData>('GET', '/health', undefined, {
        timeoutMs: LIMITS.HEALTH_TIMEOUT_MS,
        signal,
      }),
    getSnapshot: (project, signal) =>
      apiRequest<Snapshot>('GET', `/snapshot${toQuery({ project })}`, undefined, { signal }),
    getEvents: async (query, signal) => {
      const envelope = await apiRequestEnvelope<OfficeEvent[]>(
        'GET',
        `/events${toQuery({
          project: query.project,
          agentId: query.agentId,
          before: query.before,
          limit: query.limit ?? LIMITS.EVENTS_DEFAULT_LIMIT,
        })}`,
        undefined,
        { signal },
      );
      return {
        events: envelope.data,
        page: envelope.page ?? {
          limit: query.limit ?? LIMITS.EVENTS_DEFAULT_LIMIT,
          nextBefore: null,
        },
      };
    },
    getTasks: (query, signal) =>
      apiRequest<Task[]>('GET', `/tasks${toQuery({ agentId: query.agentId })}`, undefined, {
        signal,
      }),
    getAgent: (id, signal) =>
      apiRequest<Agent>('GET', `/agents/${encodeURIComponent(id)}`, undefined, { signal }),
    patchAgentStatus: (id, body) =>
      apiRequest<WriteResult>('PATCH', `/agents/${encodeURIComponent(id)}/status`, body),
    postEvent: (body) => apiRequest<OfficeEventPayload>('POST', '/events', body),
    getDemo: (signal) => apiRequest<DemoState>('GET', '/demo', undefined, { signal }),
    startDemo: () => apiRequest<DemoState>('POST', '/demo/start', {}),
    stopDemo: () => apiRequest<DemoStopResult>('POST', '/demo/stop', {}),
  };
}
