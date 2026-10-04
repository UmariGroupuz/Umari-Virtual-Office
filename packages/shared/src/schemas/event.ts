// Canonical producer envelope (API_CONTRACTS §1.4, §3.7; EVENT_SYSTEM §2–§3; ADR-005; REQ-020/023).
import { z } from 'zod';
import { SERVER_EVENT_TYPES } from '../constants/eventTypes';
import {
  actionSchema,
  agentIdSchema,
  agentStatusSchema,
  isoDateTimeSchema,
  messageSchema,
  metadataSchema,
  progressSchema,
  projectRefSchema,
  severitySchema,
  sourceSchema,
  taskIdSchema,
} from './common';
import {
  optionalString,
  optionalValue,
  producerSourceSchema,
  requiredMessageSchema,
  stripUndefined,
} from './fields';

const MAX_ECHOED_VALUE = 100;

function describeValue(value: unknown): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else text = JSON.stringify(value) ?? String(value);
  return text.length > MAX_ECHOED_VALUE ? `${text.slice(0, MAX_ECHOED_VALUE)}…` : text;
}

/** Custom messages for a missing, unknown or server-only `type` (API_CONTRACTS §2.2). */
function typeIssueMessage(issue: { code?: string; input?: unknown }): string | undefined {
  if (issue.code !== 'invalid_union') return undefined;
  const input = issue.input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const type = (input as Record<string, unknown>).type;
  if (type === undefined || type === null || (typeof type === 'string' && type.trim() === '')) {
    return 'Event type is required';
  }
  if (typeof type === 'string' && (SERVER_EVENT_TYPES as readonly string[]).includes(type)) {
    return `Event type ${type} is server-only`;
  }
  return `Unknown event type: ${describeValue(type)}`;
}

/**
 * Discriminated union on `type` over the 13 producer types, one strict object per field group of
 * EVENT_SYSTEM §3 (forbidden fields are simply not keys → "Unrecognized key").
 */
function buildEventInputSchema(source: typeof sourceSchema) {
  const common = {
    source: optionalString(source),
    project: optionalString(projectRefSchema),
    action: optionalString(actionSchema),
    message: optionalString(messageSchema),
    severity: optionalValue(severitySchema),
    metadata: optionalValue(metadataSchema),
    occurredAt: optionalString(isoDateTimeSchema),
  };
  const optionalTaskId = optionalString(taskIdSchema);
  const optionalStatus = optionalValue(agentStatusSchema);
  const optionalProgress = optionalValue(progressSchema);

  return z
    .discriminatedUnion(
      'type',
      [
        z.strictObject({
          ...common,
          type: z.enum(['agent.connected', 'agent.disconnected']),
          agentId: agentIdSchema,
          taskId: optionalTaskId,
        }),
        z.strictObject({
          ...common,
          type: z.literal('agent.status.changed'),
          agentId: agentIdSchema,
          status: agentStatusSchema,
          taskId: optionalTaskId,
          progress: optionalProgress,
        }),
        z.strictObject({
          ...common,
          type: z.literal('agent.activity'),
          agentId: agentIdSchema,
          action: actionSchema,
          status: optionalStatus,
          taskId: optionalTaskId,
          progress: optionalProgress,
        }),
        z.strictObject({
          ...common,
          type: z.literal('agent.message'),
          agentId: agentIdSchema,
          message: requiredMessageSchema,
          status: optionalStatus,
          taskId: optionalTaskId,
          progress: optionalProgress,
        }),
        z.strictObject({
          ...common,
          type: z.enum([
            'agent.task.assigned',
            'agent.task.started',
            'agent.task.completed',
            'agent.task.failed',
          ]),
          agentId: agentIdSchema,
          taskId: taskIdSchema,
          status: optionalStatus,
          progress: optionalProgress,
        }),
        z.strictObject({
          ...common,
          type: z.literal('agent.task.progress'),
          agentId: agentIdSchema,
          taskId: taskIdSchema,
          progress: progressSchema,
          status: optionalStatus,
        }),
        z.strictObject({
          ...common,
          type: z.enum(['system.info', 'system.warning', 'system.error']),
          message: requiredMessageSchema,
          agentId: optionalString(agentIdSchema),
          taskId: optionalTaskId,
        }),
      ],
      { error: typeIssueMessage },
    )
    .transform((value) => stripUndefined(value));
}

/** Any valid source, including the reserved ones — for in-process producers (demo engine). */
export const eventInputSchema = buildEventInputSchema(sourceSchema);

/** HTTP input (`POST /api/events`, web simulator): reserved sources `demo`/`system` are rejected. */
export const producerEventInputSchema = buildEventInputSchema(producerSourceSchema);

/** Raw JSON a client sends (`null` allowed for optional fields). */
export type EventInputBody = z.input<typeof producerEventInputSchema>;
