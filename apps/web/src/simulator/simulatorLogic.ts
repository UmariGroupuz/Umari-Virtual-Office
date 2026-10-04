// Developer Simulator rules (UX §9, API-C §10.3, ADR-022): request bodies, client validation with the shared
// schema, legality hints from the shared state machine, and feedback copy. Pure and unit-tested.
import {
  AGENT_STATUS_LABELS,
  canTransitionAgent,
  producerEventInputSchema,
  toValidationIssues,
  type AgentStatus,
  type AgentStatusPatchBody,
  type EventInputBody,
  type IllegalTransitionDetails,
  type Severity,
  type ValidationIssue,
} from '@vo/shared';
import { ApiError, isUnreachable } from '../api/client';
import { COPY } from '../copy';

/** Fixed button order (UX §9.4). */
export const STATUS_BUTTON_ORDER: readonly AgentStatus[] = [
  'idle',
  'planning',
  'working',
  'waiting',
  'reviewing',
  'completed',
  'failed',
  'offline',
];

export type ButtonLegality = 'current' | 'legal' | 'illegal';

export function buttonLegality(current: AgentStatus, target: AgentStatus): ButtonLegality {
  if (current === target) return 'current';
  return canTransitionAgent(current, target) ? 'legal' : 'illegal';
}

/** Labels of the buttons that are legal from `from`, in button order ("Allowed from Idle: …"). */
export function allowedButtonLabels(from: AgentStatus): string[] {
  return STATUS_BUTTON_ORDER.filter((target) => canTransitionAgent(from, target)).map(
    (target) => COPY.simulator.buttons[target],
  );
}

/** `PATCH /api/agents/:id/status` body: project/task omitted when "None"; never `force` (ADR-022). */
export function buildStatusPatch(
  status: AgentStatus,
  projectId: string | null,
  taskId: string | null,
): AgentStatusPatchBody {
  const body: AgentStatusPatchBody = { status, source: 'simulator' };
  if (projectId) body.project = projectId;
  if (taskId) body.taskId = taskId;
  return body;
}

export interface ActivityInput {
  agentId: string;
  action: string;
  message: string;
  severity: Severity;
  projectId: string | null;
  taskId: string | null;
}

/** `POST /api/events` body: `agent.activity`, source simulator; severity omitted when Info; empty message omitted. */
export function buildActivityBody(input: ActivityInput): EventInputBody {
  const body: Record<string, unknown> = {
    type: 'agent.activity',
    source: 'simulator',
    agentId: input.agentId,
    action: input.action.trim(),
  };
  const message = input.message.trim();
  if (message !== '') body.message = message;
  if (input.severity !== 'info') body.severity = input.severity;
  if (input.projectId) body.project = input.projectId;
  if (input.taskId) body.taskId = input.taskId;
  return body as EventInputBody;
}

export type FieldErrors = Partial<Record<'action' | 'message', string>>;

/** Validates with the shared producer schema (REQ-023); first issue per field (UX §9.5). */
export function validateActivity(body: EventInputBody): FieldErrors {
  const result = producerEventInputSchema.safeParse(body);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of toValidationIssues(result.error)) {
    const field = issue.path.split('.')[0];
    if ((field === 'action' || field === 'message') && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  if (Object.keys(errors).length === 0) {
    // Any other issue (should not happen with UI-built bodies) is reported on the action field.
    errors.action = toValidationIssues(result.error)[0]?.message ?? 'Invalid input';
  }
  return errors;
}

export interface Feedback {
  kind: 'success' | 'info' | 'error';
  message: string;
  /** Muted second part (409 "Allowed from …"). */
  hint?: string;
}

function isIllegalAgentDetails(details: unknown): details is IllegalTransitionDetails {
  if (typeof details !== 'object' || details === null) return false;
  const d = details as Record<string, unknown>;
  return d.entity === 'agent' && typeof d.from === 'string';
}

function firstIssue(details: unknown): ValidationIssue | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const first: unknown = details[0];
  if (typeof first !== 'object' || first === null) return null;
  const { path, message } = first as Record<string, unknown>;
  if (typeof path !== 'string' || typeof message !== 'string') return null;
  return { path, message };
}

/** UX §9.5 feedback for a failed write. `currentStatus` is the live status used for the hint fallback. */
export function describeWriteError(error: unknown, currentStatus: AgentStatus | null): Feedback {
  if (isUnreachable(error) || !(error instanceof ApiError)) {
    return { kind: 'error', message: COPY.simulator.unreachable };
  }
  if (error.code === 'ILLEGAL_TRANSITION') {
    const from = isIllegalAgentDetails(error.details)
      ? (error.details.from as AgentStatus)
      : currentStatus;
    const hint =
      from && from in AGENT_STATUS_LABELS
        ? COPY.simulator.allowedFrom(AGENT_STATUS_LABELS[from], allowedButtonLabels(from))
        : undefined;
    return { kind: 'error', message: error.message, hint };
  }
  if (error.status === 400 || error.status === 422 || error.status === 413) {
    const issue = firstIssue(error.details);
    const suffix = issue ? ` (${issue.path === '' ? 'body' : issue.path}: ${issue.message})` : '';
    return { kind: 'error', message: `${error.message}${suffix}` };
  }
  return { kind: 'error', message: error.message };
}
