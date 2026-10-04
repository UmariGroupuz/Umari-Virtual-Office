// Pure event rules (ADR-008): AGENT_STATE_MACHINE §4–§8 and EVENT_SYSTEM §2.3, §4, §5.
// No DB, no clock (`now` is a parameter), no sockets. Inputs are never mutated.
//
// Check order inside `decideEvent` (API_CONTRACTS §0 steps 4 and 6):
//   422 UNKNOWN_TASK → 422 PROJECT_MISMATCH → 409 agent legality → 409 task legality / terminal progress.
// Existence of the agent and resolution of `project` are the caller's job (EventService).
import {
  LIMITS,
  canTransitionAgent,
  canTransitionTask,
  isActiveAgentStatus,
  isTerminalTaskStatus,
  mapAgentStatusToTaskStatus,
  type Agent,
  type AgentStatus,
  type EventInput,
  type EventType,
  type JsonObject,
  type Severity,
  type Task,
  type TaskStatus,
} from '@vo/shared';
import type { AgentPatch, EventDraft, NewTask, TaskPatch } from '../db/types';
import { appErrors, type AppError } from '../errors';

export interface EventDecisionInput {
  input: EventInput; // parsed (eventInputSchema / producerEventInputSchema)
  source: string; // input.source ?? 'api'
  agent: Agent | null; // loaded by input.agentId (existence already checked by the service → 422 otherwise)
  task: Task | null; // existing task with id input.taskId, or null
  projectId: string | null; // resolved explicit project id, or null if input.project absent
  now: string;
  force: boolean; // true only from PATCH /api/agents/:id/status with force
}
export interface ForcedTransition {
  entity: 'agent' | 'task';
  id: string;
  from: string;
  to: string;
}
export type TaskEffect =
  { op: 'create'; task: NewTask } | { op: 'update'; id: string; patch: TaskPatch };
export type EventDecision =
  | {
      kind: 'accept';
      event: EventDraft;
      agentPatch: AgentPatch | null;
      taskEffect: TaskEffect | null;
      forced: ForcedTransition[];
    }
  | { kind: 'reject'; error: AppError }; // UNKNOWN_TASK, PROJECT_MISMATCH, ILLEGAL_TRANSITION

/** Every optional field of every `EventInput` member, for uniform read access. */
interface InputView {
  type: EventInput['type'];
  agentId?: string;
  taskId?: string;
  status?: AgentStatus;
  progress?: number;
  action?: string;
  message?: string;
  severity?: Severity;
  metadata?: JsonObject;
  occurredAt?: string;
}

type SystemEventType = 'system.info' | 'system.warning' | 'system.error';
type LifecycleEventType = 'agent.task.started' | 'agent.task.completed' | 'agent.task.failed';

const SYSTEM_TYPES: ReadonlySet<EventType> = new Set<SystemEventType>([
  'system.info',
  'system.warning',
  'system.error',
]);

/** Task status set by a lifecycle event's type (ASM §7), independent of an explicit agent status. */
const LIFECYCLE_TASK_STATUS: Readonly<Record<LifecycleEventType, TaskStatus>> = {
  'agent.task.started': 'in_progress',
  'agent.task.completed': 'completed',
  'agent.task.failed': 'failed',
};

/** Agent status implied by a lifecycle event when no explicit `status` is given (ASM §7). */
const LIFECYCLE_AGENT_STATUS: Readonly<Record<LifecycleEventType, AgentStatus>> = {
  'agent.task.started': 'working',
  'agent.task.completed': 'completed',
  'agent.task.failed': 'failed',
};

/** Types whose `taskId` must reference an existing task (ES §5.1). */
const REQUIRES_EXISTING_TASK: ReadonlySet<EventType> = new Set<EventType>([
  'agent.task.started',
  'agent.task.progress',
  'agent.task.completed',
  'agent.task.failed',
]);

const GENERIC_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  'agent.status.changed',
  'agent.activity',
  'agent.message',
]);

const AGENT_PATCH_FIELDS = [
  'status',
  'currentProject',
  'currentTask',
  'taskId',
  'progress',
  'startedAt',
  'lastActivityAt',
  'currentAction',
  'lastMessage',
  'online',
] as const satisfies readonly (keyof AgentPatch)[];

/** Severity default (ES §2.3); an explicit `severity` on the input always wins. */
export function defaultSeverity(type: EventType, resultingStatus: AgentStatus | null): Severity {
  if (type === 'system.warning') return 'warning';
  if (type === 'system.error' || type === 'agent.task.failed' || resultingStatus === 'failed') {
    return 'error';
  }
  return 'info';
}

function isLifecycleType(type: EventType): type is LifecycleEventType {
  return Object.hasOwn(LIFECYCLE_TASK_STATUS, type);
}

function reject(error: AppError): EventDecision {
  return { kind: 'reject', error };
}

/** Resulting agent status T = explicit `status` ?? implied by the type ?? current (ASM §4, §7). */
function targetAgentStatus(view: InputView, current: AgentStatus): AgentStatus {
  if (view.type === 'agent.connected') return current === 'offline' ? 'idle' : current;
  if (view.type === 'agent.disconnected') return 'offline';
  if (view.status !== undefined) return view.status;
  if (isLifecycleType(view.type)) return LIFECYCLE_AGENT_STATUS[view.type];
  return current;
}

/** Task side effects of a status change (ASM §5.3). Only fields that change are returned. */
function taskStatusPatch(
  task: Pick<Task, 'status' | 'startedAt' | 'completedAt' | 'progress'>,
  to: TaskStatus,
  now: string,
): TaskPatch {
  const patch: TaskPatch = { status: to };
  if (to === 'in_progress' && task.startedAt === null) patch.startedAt = now;
  if (to === 'completed') {
    patch.completedAt = now;
    if (task.progress !== 100) patch.progress = 100;
  } else if (task.completedAt !== null) {
    patch.completedAt = null; // leaving `completed` (force only)
  }
  return patch;
}

/** Title of a task created by `agent.task.assigned`: metadata.title ?? message ?? taskId (ES §4). */
function newTaskTitle(view: InputView, taskId: string): string {
  const fromMetadata = view.metadata?.title;
  const candidates = [typeof fromMetadata === 'string' ? fromMetadata : undefined, view.message];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value !== undefined && value !== '') return truncate(value, LIMITS.TITLE_MAX);
  }
  return taskId;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  // Never end on a lone high surrogate.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** The task as seen by the agent effects: the created row, the updated row, or the unchanged row. */
type TaskView = Pick<Task, 'id' | 'title' | 'project' | 'progress'>;

type TaskPlan =
  | {
      kind: 'ok';
      effect: TaskEffect | null;
      view: TaskView | null;
      forced: ForcedTransition | null;
    }
  | { kind: 'reject'; error: AppError };

interface TaskPlanContext {
  view: InputView;
  taskId: string | undefined;
  agentId: string;
  agentStatusChanged: boolean;
  target: AgentStatus;
  task: Task | null;
  projectId: string | null;
  source: string;
  now: string;
  force: boolean;
}

/** `agent.task.assigned`: create an unknown task or (re)assign an existing one, then ASM §6 mapping. */
function planAssignment(ctx: TaskPlanContext, taskId: string): TaskPlan {
  const { view, task, now, force } = ctx;
  // ASM §6: mapping applies only when an explicit status changed the agent.
  const mapped =
    view.status !== undefined && ctx.agentStatusChanged
      ? mapAgentStatusToTaskStatus(ctx.target)
      : null;
  const finalStatus: TaskStatus = mapped ?? 'assigned';

  if (task === null) {
    // `projectId` is non-null here: the caller rejected a create without a project.
    const project = ctx.projectId ?? '';
    let forced: ForcedTransition | null = null;
    if (finalStatus !== 'assigned' && !canTransitionTask('assigned', finalStatus)) {
      if (!force)
        return {
          kind: 'reject',
          error: appErrors.illegalTaskTransition(taskId, 'assigned', finalStatus),
        };
      forced = { entity: 'task', id: taskId, from: 'assigned', to: finalStatus };
    }
    const base: NewTask = {
      id: taskId,
      title: newTaskTitle(view, taskId),
      description: null,
      project,
      assignedAgentId: ctx.agentId,
      status: 'assigned',
      priority: 'normal',
      progress: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      blockedBy: [],
      metadata: ctx.source === 'demo' ? { demo: true } : {},
    };
    const created: NewTask =
      finalStatus === 'assigned' ? base : { ...base, ...taskStatusPatch(base, finalStatus, now) };
    return { kind: 'ok', effect: { op: 'create', task: created }, view: created, forced };
  }

  // Existing task: always takes the assignee (ES §5.2 exception); status → assigned from todo/failed
  // (already assigned = no-op, anything else → 409), then the mapped status if any.
  const from = task.status;
  const assignable = from === 'assigned' || canTransitionTask(from, 'assigned');
  const mappable = finalStatus === 'assigned' || canTransitionTask('assigned', finalStatus);
  let forced: ForcedTransition | null = null;
  if (!assignable || !mappable) {
    if (!force) {
      return {
        kind: 'reject',
        error: appErrors.illegalTaskTransition(
          task.id,
          from,
          assignable ? finalStatus : 'assigned',
        ),
      };
    }
    forced = { entity: 'task', id: task.id, from, to: finalStatus };
  }
  const patch: TaskPatch = {};
  if (task.assignedAgentId !== ctx.agentId) patch.assignedAgentId = ctx.agentId;
  if (finalStatus !== from) Object.assign(patch, taskStatusPatch(task, finalStatus, now));
  return finish(task, patch, forced);
}

function finish(task: Task, patch: TaskPatch, forced: ForcedTransition | null): TaskPlan {
  const changed = Object.keys(patch).length > 0;
  return {
    kind: 'ok',
    effect: changed ? { op: 'update', id: task.id, patch } : null,
    view: { ...task, ...patch },
    forced,
  };
}

/** Task effects of an agent event (ES §4, §5): ownership/claiming, implicit assignment, legality. */
function planTask(ctx: TaskPlanContext): TaskPlan {
  const { view, task, taskId, now, force } = ctx;
  if (view.type === 'agent.task.assigned' && taskId !== undefined) {
    return planAssignment(ctx, taskId);
  }
  if (task === null) return { kind: 'ok', effect: null, view: null, forced: null };

  const owned = task.assignedAgentId === ctx.agentId;
  const claimable = task.assignedAgentId === null;
  const unchanged: TaskPlan = { kind: 'ok', effect: null, view: task, forced: null };
  if (!owned && !claimable) return unchanged; // non-assignee: event stored, task untouched (ES §5.2)

  let targetStatus: TaskStatus | null = null;
  let progress: number | undefined;
  if (isLifecycleType(view.type)) {
    targetStatus = LIFECYCLE_TASK_STATUS[view.type];
  } else if (view.type === 'agent.task.progress') {
    progress = view.progress;
  } else if (GENERIC_TYPES.has(view.type)) {
    // Generic events touch a task only when they change the agent's status (REQ-042).
    const mapped = ctx.agentStatusChanged ? mapAgentStatusToTaskStatus(ctx.target) : null;
    if (mapped === null) return unchanged;
    targetStatus = mapped;
  } else {
    return unchanged; // agent.connected / agent.disconnected
  }

  const patch: TaskPatch = {};
  let forced: ForcedTransition | null = null;
  if (claimable) patch.assignedAgentId = ctx.agentId;

  if (targetStatus !== null && targetStatus !== task.status) {
    // The task is owned or claimed here, so a `todo` task is validated from `assigned` (ADR-017).
    if (!canTransitionTask(task.status, targetStatus, { owned: true })) {
      if (!force) {
        return {
          kind: 'reject',
          error: appErrors.illegalTaskTransition(task.id, task.status, targetStatus),
        };
      }
      forced = { entity: 'task', id: task.id, from: task.status, to: targetStatus };
    }
    Object.assign(patch, taskStatusPatch(task, targetStatus, now));
  }

  if (progress !== undefined) {
    if (isTerminalTaskStatus(task.status)) {
      if (!force) {
        return { kind: 'reject', error: appErrors.terminalTaskProgress(task.id, task.status) };
      }
      forced = { entity: 'task', id: task.id, from: task.status, to: task.status };
    }
    if (progress !== task.progress) patch.progress = progress;
  }
  return finish(task, patch, forced);
}

/** ASM §4 steps 2–6 (step 1, legality, is checked by the caller). Returns only changed fields. */
function planAgent(
  agent: Agent,
  view: InputView,
  target: AgentStatus,
  taskView: TaskView | null,
  projectId: string | null,
  now: string,
): { patch: AgentPatch; next: Agent } {
  const current = agent.status;
  const next: Agent = { ...agent };

  // Step 2 — status effects.
  if (current !== target) {
    next.status = target;
    next.currentAction = view.action ?? null; // a status change never keeps a stale action
    if (isActiveAgentStatus(target) && !isActiveAgentStatus(current)) next.startedAt = now;
    if (target === 'idle') {
      next.taskId = null;
      next.currentTask = null;
      next.currentAction = null;
      next.progress = 0;
      next.startedAt = null;
    }
    if (target === 'offline') {
      next.online = false;
      next.startedAt = null;
      next.currentAction = null;
    }
    if (current === 'offline') next.online = true;
  }

  // Step 3 — task binding (ADR-017).
  const binds =
    target !== 'idle' &&
    target !== 'offline' &&
    !(view.type === 'agent.task.assigned' && view.status === undefined);
  if (binds) {
    if (view.taskId !== undefined) {
      next.taskId = view.taskId;
      next.currentTask = taskView?.title ?? view.taskId;
      const project = taskView?.project ?? projectId;
      if (project !== null) next.currentProject = project;
    } else if (projectId !== null) {
      next.currentProject = projectId;
    }
  }

  // Step 4 — progress.
  if (target !== 'idle') {
    if (view.progress !== undefined) next.progress = view.progress;
    else if (next.taskId !== agent.taskId) next.progress = taskView?.progress ?? 0;
  }

  // Step 5 — completion.
  if (target === 'completed' && current !== 'completed' && next.taskId !== null)
    next.progress = 100;

  // Step 6 — common.
  next.lastActivityAt = now;
  if (view.message !== undefined) next.lastMessage = view.message;
  if (
    view.action !== undefined &&
    current === target &&
    target !== 'idle' &&
    target !== 'offline'
  ) {
    next.currentAction = view.action;
  }

  const patch: AgentPatch = { lastActivityAt: now };
  const patchRecord = patch as Record<string, unknown>;
  for (const field of AGENT_PATCH_FIELDS) {
    if (next[field] !== agent[field]) patchRecord[field] = next[field];
  }
  return { patch, next };
}

function draft(
  view: InputView,
  source: string,
  project: string | null,
  severityStatus: AgentStatus | null,
  forced: boolean,
): EventDraft {
  return {
    type: view.type,
    source,
    agentId: view.agentId ?? null,
    project,
    taskId: view.taskId ?? null,
    status: view.status ?? null,
    action: view.action ?? null,
    message: view.message ?? null,
    severity: view.severity ?? defaultSeverity(view.type, severityStatus),
    progress: view.progress ?? null,
    metadata: view.metadata ?? {},
    occurredAt: view.occurredAt ?? null,
    forced,
  };
}

/**
 * Decides the effects of one producer event (ASM §4, ES §4–§5). Pure: same input → same decision.
 * Rejections: 422 UNKNOWN_TASK / PROJECT_MISMATCH, 409 ILLEGAL_TRANSITION (agent checked first).
 */
export function decideEvent(decisionInput: EventDecisionInput): EventDecision {
  const { input, source, agent, task, projectId, now, force } = decisionInput;
  const view: InputView = input;
  const taskId = view.taskId;
  if (task !== null && task.id !== taskId) {
    throw new Error(`decideEvent: task ${task.id} does not match input.taskId ${String(taskId)}`);
  }
  const mismatch =
    task !== null && projectId !== null && projectId !== task.project
      ? appErrors.projectMismatch(task.id, task.project, projectId)
      : null;

  // system.* — stored, never changes agents or tasks (ASM §4).
  if (SYSTEM_TYPES.has(view.type)) {
    if (mismatch !== null) return reject(mismatch);
    const project = projectId ?? task?.project ?? agent?.currentProject ?? null;
    return {
      kind: 'accept',
      event: draft(view, source, project, null, false),
      agentPatch: null,
      taskEffect: null,
      forced: [],
    };
  }

  if (agent === null) return reject(appErrors.unknownAgent(view.agentId ?? ''));
  if (agent.id !== view.agentId) {
    throw new Error(`decideEvent: agent ${agent.id} does not match input.agentId`);
  }

  // 422 — task existence (ES §5.1), then project consistency (ES §5.4).
  if (taskId !== undefined && task === null) {
    if (REQUIRES_EXISTING_TASK.has(view.type)) return reject(appErrors.unknownTask(taskId));
    if (view.type === 'agent.task.assigned' && projectId === null) {
      return reject(appErrors.unknownTaskForCreate(taskId));
    }
  }
  if (mismatch !== null) return reject(mismatch);

  // 409 — agent legality first (ES §4).
  const current = agent.status;
  const target = targetAgentStatus(view, current);
  const forced: ForcedTransition[] = [];
  if (current !== target && !canTransitionAgent(current, target)) {
    if (!force) return reject(appErrors.illegalAgentTransition(agent.id, current, target));
    forced.push({ entity: 'agent', id: agent.id, from: current, to: target });
  }

  // 409 — task effects and legality.
  const taskPlan = planTask({
    view,
    taskId,
    agentId: agent.id,
    agentStatusChanged: current !== target,
    target,
    task,
    projectId,
    source,
    now,
    force,
  });
  if (taskPlan.kind === 'reject') return taskPlan;
  if (taskPlan.forced !== null) forced.push(taskPlan.forced);

  const { patch, next } = planAgent(agent, view, target, taskPlan.view, projectId, now);
  const project = projectId ?? taskPlan.view?.project ?? next.currentProject ?? null;
  // Severity follows the status the event sets (explicit, or implied and different from the current one).
  const severityStatus = view.status !== undefined || current !== target ? target : null;
  return {
    kind: 'accept',
    event: draft(view, source, project, severityStatus, forced.length > 0),
    agentPatch: patch,
    taskEffect: taskPlan.effect,
    forced,
  };
}
