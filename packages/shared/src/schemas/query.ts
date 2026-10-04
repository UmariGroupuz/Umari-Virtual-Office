// Query-string schemas (API_CONTRACTS §0 "Numbers in query", §3.3, §3.6, §3.8, §3.11; ADR-030).
// Input: the parsed query object (string values; a repeated key arrives as an array and is rejected).
// Empty values are rejected (400), unlike optional body strings — see ADR-030.
import { z } from 'zod';
import { EVENT_TYPES } from '../constants/eventTypes';
import { LIMITS } from '../constants/limits';
import { TASK_STATUSES } from '../constants/statuses';
import { agentIdSchema, projectRefSchema, sourceSchema, taskIdSchema } from './common';

/** Decimal digits only (`^\d+$`), then range-checked. */
function queryInteger(min: number, max: number) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, 'Expected a whole number (digits only)')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
}

const listLimit = (defaultValue: number) => queryInteger(1, LIMITS.LIST_MAX).default(defaultValue);

export const agentsQuerySchema = z.strictObject({
  project: projectRefSchema.optional(),
});

export const eventsQuerySchema = z.strictObject({
  project: projectRefSchema.optional(),
  agentId: agentIdSchema.optional(),
  taskId: taskIdSchema.optional(),
  type: z.enum(EVENT_TYPES).optional(),
  /** Exact match; reserved sources are allowed here. */
  source: sourceSchema.optional(),
  before: queryInteger(1, Number.MAX_SAFE_INTEGER).optional(),
  limit: listLimit(LIMITS.EVENTS_DEFAULT_LIMIT),
});

export const tasksQuerySchema = z.strictObject({
  project: projectRefSchema.optional(),
  agentId: agentIdSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  limit: listLimit(LIMITS.TASKS_DEFAULT_LIMIT),
});

export const snapshotQuerySchema = z.strictObject({
  /** Applies only to `events` (feed predicate). */
  project: projectRefSchema.optional(),
  eventsLimit: listLimit(LIMITS.EVENTS_DEFAULT_LIMIT),
});

export type AgentsQuery = z.input<typeof agentsQuerySchema>;
export type EventsQuery = z.input<typeof eventsQuerySchema>;
export type TasksQuery = z.input<typeof tasksQuerySchema>;
export type SnapshotQuery = z.input<typeof snapshotQuerySchema>;
export type AgentsQueryInput = z.output<typeof agentsQuerySchema>;
export type EventsQueryInput = z.output<typeof eventsQuerySchema>;
export type TasksQueryInput = z.output<typeof tasksQuerySchema>;
export type SnapshotQueryInput = z.output<typeof snapshotQuerySchema>;
