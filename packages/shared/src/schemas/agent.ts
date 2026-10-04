// PATCH /api/agents/:id/status body (API_CONTRACTS §3.5, ADR-015/022).
import { z } from 'zod';
import { DEFAULT_SOURCE } from '../constants/eventTypes';
import {
  actionSchema,
  agentStatusSchema,
  messageSchema,
  projectRefSchema,
  taskIdSchema,
} from './common';
import {
  booleanDefaultFalse,
  optionalString,
  producerSourceSchema,
  stripUndefined,
} from './fields';

export const agentStatusPatchSchema = z
  .strictObject({
    status: agentStatusSchema,
    /** Default `"api"`; reserved sources rejected; the simulator sends `"simulator"`. */
    source: optionalString(producerSourceSchema).transform((value) => value ?? DEFAULT_SOURCE),
    project: optionalString(projectRefSchema),
    /** Unknown task ids are allowed (bound to the agent, no task created, ES §5.1). */
    taskId: optionalString(taskIdSchema),
    action: optionalString(actionSchema),
    message: optionalString(messageSchema),
    /** ADR-015: skips only transition legality. */
    force: booleanDefaultFalse,
  })
  .transform((value) => stripUndefined(value));

export type AgentStatusPatchBody = z.input<typeof agentStatusPatchSchema>;
export type AgentStatusPatchInput = z.output<typeof agentStatusPatchSchema>;
