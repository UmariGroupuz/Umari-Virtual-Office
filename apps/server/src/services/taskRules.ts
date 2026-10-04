// Pure Tasks API rules (ADR-024, ASM §5.3, API_CONTRACTS §3.9–3.10). References (project, assignee,
// blockedBy existence, TASK_EXISTS) are checked by the service before these functions run.
import {
  canTransitionTask,
  isTerminalTaskStatus,
  type JsonValue,
  type Task,
  type TaskCreateInput,
  type TaskPatchInput,
  type TaskStatus,
} from '@vo/shared';
import type { EventDraft, NewTask, TaskPatch } from '../db/types';
import { appErrors, type AppError } from '../errors';
import type { ForcedTransition } from './eventEffects';

export const SELF_BLOCK_ISSUE = {
  path: 'blockedBy',
  message: 'A task cannot block itself',
} as const;

/**
 * 400 when `blockedBy` contains the task's own id (API_CONTRACTS §2.2, ADR-030 item 7). It needs only the
 * path id, so the service can run it right after schema validation (check order: 400 before 404/422).
 */
export function checkSelfBlock(
  taskId: string,
  body: { blockedBy?: readonly string[] },
): AppError | null {
  return body.blockedBy?.includes(taskId) === true
    ? appErrors.validation([{ ...SELF_BLOCK_ISSUE }], 'body')
    : null;
}

export function decideTaskCreate(input: {
  body: TaskCreateInput;
  projectId: string;
  id: string;
  now: string;
}): { kind: 'accept'; task: NewTask; event: EventDraft } | { kind: 'reject'; error: AppError } {
  const { body, projectId, id, now } = input;
  const selfBlock = checkSelfBlock(id, body);
  if (selfBlock !== null) return { kind: 'reject', error: selfBlock };

  const task: NewTask = {
    id,
    title: body.title,
    description: body.description,
    project: projectId,
    assignedAgentId: body.assignedAgentId,
    status: body.status,
    priority: body.priority,
    progress: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    blockedBy: [...body.blockedBy],
    metadata: body.metadata,
  };
  const event: EventDraft = {
    type: 'task.created',
    source: 'api',
    agentId: task.assignedAgentId,
    project: projectId,
    taskId: id,
    status: task.status,
    action: null,
    message: `Task created: ${task.title}`,
    severity: 'info',
    progress: null,
    metadata: {},
    occurredAt: null,
    forced: false,
  };
  return { kind: 'accept', task, event };
}

/** Structural equality for JSON values (arrays: order matters; objects: key order does not). */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

type PatchableField = Exclude<keyof TaskPatchInput, 'force'>;
const PATCHABLE_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'progress',
  'assignedAgentId',
  'blockedBy',
  'metadata',
] as const satisfies readonly PatchableField[];

/** Fields present in the body whose value differs from the stored task (ADR-024 no-op rule). */
function differingFields(task: Task, body: TaskPatchInput): PatchableField[] {
  return PATCHABLE_FIELDS.filter((field) => {
    const value = body[field];
    return value !== undefined && !jsonEqual(value, task[field]);
  });
}

/** ADR-024 auto-status, used only when the body has no `status`. */
function autoStatus(task: Task, body: TaskPatchInput): TaskStatus {
  if (body.assignedAgentId === undefined) return task.status;
  if (body.assignedAgentId !== null && task.status === 'todo') return 'assigned';
  if (body.assignedAgentId === null && task.status === 'assigned') return 'todo';
  return task.status;
}

/**
 * `PATCH /api/tasks/:id` rules (ADR-024, ASM §5.3): self-block 400 → no-op → status legality 409 →
 * terminal progress 409 (both skipped by `force`) → patch with side effects + `task.updated` draft.
 */
export function decideTaskPatch(input: {
  task: Task;
  body: TaskPatchInput;
  now: string;
}):
  | { kind: 'noop' }
  | { kind: 'accept'; patch: TaskPatch; event: EventDraft; forced: ForcedTransition | null }
  | { kind: 'reject'; error: AppError } {
  const { task, body, now } = input;
  const selfBlock = checkSelfBlock(task.id, body);
  if (selfBlock !== null) return { kind: 'reject', error: selfBlock };

  if (differingFields(task, body).length === 0) return { kind: 'noop' };

  const assigneeAfter =
    body.assignedAgentId === undefined ? task.assignedAgentId : body.assignedAgentId;
  const from = task.status;
  const to = body.status ?? autoStatus(task, body);
  let forced: ForcedTransition | null = null;

  if (to !== from && !canTransitionTask(from, to, { owned: assigneeAfter !== null })) {
    if (!body.force)
      return { kind: 'reject', error: appErrors.illegalTaskTransition(task.id, from, to) };
    forced = { entity: 'task', id: task.id, from, to };
  }

  const enteringCompleted = to === 'completed' && from !== 'completed';
  const progressChanges =
    body.progress !== undefined && body.progress !== task.progress && !enteringCompleted;
  if (progressChanges) {
    // 409 on a terminal task: the current status, or the resulting one when `status` is also given.
    const terminal = isTerminalTaskStatus(from) ? from : isTerminalTaskStatus(to) ? to : null;
    if (terminal !== null) {
      if (!body.force)
        return { kind: 'reject', error: appErrors.terminalTaskProgress(task.id, terminal) };
      forced ??= { entity: 'task', id: task.id, from: terminal, to: terminal };
    }
  }

  const patch: TaskPatch = {};
  if (body.title !== undefined && body.title !== task.title) patch.title = body.title;
  if (body.description !== undefined && body.description !== task.description) {
    patch.description = body.description;
  }
  if (body.priority !== undefined && body.priority !== task.priority)
    patch.priority = body.priority;
  if (body.assignedAgentId !== undefined && body.assignedAgentId !== task.assignedAgentId) {
    patch.assignedAgentId = body.assignedAgentId;
  }
  if (body.blockedBy !== undefined && !jsonEqual(body.blockedBy, task.blockedBy)) {
    patch.blockedBy = [...body.blockedBy];
  }
  if (body.metadata !== undefined && !jsonEqual(body.metadata, task.metadata)) {
    patch.metadata = body.metadata;
  }
  if (progressChanges) patch.progress = body.progress;
  if (to !== from) {
    // ASM §5.3 side effects: first entry into in_progress, entry into / exit from completed.
    patch.status = to;
    if (to === 'in_progress' && task.startedAt === null) patch.startedAt = now;
    if (to === 'completed') {
      patch.completedAt = now;
      if (task.progress !== 100) patch.progress = 100; // the body's progress is ignored here
    } else if (task.completedAt !== null) {
      patch.completedAt = null;
    }
  }

  const changes = Object.keys(patch).sort();
  const event: EventDraft = {
    type: 'task.updated',
    source: 'api',
    agentId: assigneeAfter,
    project: task.project,
    taskId: task.id,
    status: patch.status ?? null,
    action: null,
    message: `Task updated: ${patch.title ?? task.title}`,
    severity: 'info',
    progress: patch.progress ?? null,
    metadata: { changes },
    occurredAt: null,
    forced: forced !== null,
  };
  return { kind: 'accept', patch, event, forced };
}
