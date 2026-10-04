// Event types and sources (API_CONTRACTS §1.2, EVENT_SYSTEM §3, ADR-005).

export const PRODUCER_EVENT_TYPES = [
  'agent.connected',
  'agent.disconnected',
  'agent.status.changed',
  'agent.activity',
  'agent.message',
  'agent.task.assigned',
  'agent.task.started',
  'agent.task.progress',
  'agent.task.completed',
  'agent.task.failed',
  'system.info',
  'system.warning',
  'system.error',
] as const; // 13, accepted on POST /api/events
export type ProducerEventType = (typeof PRODUCER_EVENT_TYPES)[number];

/** Written by the Tasks API only; rejected on POST /api/events. */
export const SERVER_EVENT_TYPES = ['task.created', 'task.updated'] as const;
export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];

export const EVENT_TYPES = [...PRODUCER_EVENT_TYPES, ...SERVER_EVENT_TYPES] as const; // 15
export type EventType = ProducerEventType | ServerEventType;

export const SOURCES = {
  API: 'api',
  SIMULATOR: 'simulator',
  DEMO: 'demo',
  SYSTEM: 'system',
} as const;
export const DEFAULT_SOURCE = 'api';
/** Rejected on HTTP input (ADR-005); set only by in-process producers. */
export const RESERVED_SOURCES = ['demo', 'system'] as const;
/** Project-less events of these types stay visible under a project filter (ES §8.3, A-09). */
export const PROJECTLESS_VISIBLE_TYPES = ['system.warning', 'system.error'] as const;
