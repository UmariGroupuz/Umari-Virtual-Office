// TEST-ONLY helper for the pure-rule tests of TASK-005 (never imported by production code).
// - The API_CONTRACTS §7 seed baseline (11 tasks, 15 agent states) as plain objects, so rule tests do not
//   depend on the database layer.
// - `ingest`: an in-memory emulation of EventService (resolve project, load agent/task, `decideEvent`,
//   apply the accepted decision with version + 1) used for sequence, property and demo simulations.
import {
  ACTIVE_AGENT_STATUSES,
  AGENT_REFERENCE,
  PROJECTS,
  resolveProjectRef,
  type Agent,
  type AgentStatus,
  type EventInput,
  type OfficeEvent,
  type Project,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@vo/shared';
import { decideEvent, type EventDecision } from './eventEffects';

export const BASE_TIME = Date.parse('2026-10-04T10:00:00.000Z');

export function isoAt(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}
const minutesAgo = (minutes: number): string => isoAt(-minutes * 60_000);

export const PROJECT_LIST: readonly Project[] = PROJECTS.map(({ id, name, taskPrefix }) => ({
  id,
  name,
  taskPrefix,
}));

type TaskRow = [
  id: string,
  title: string,
  project: string,
  assignee: string | null,
  status: TaskStatus,
  priority: TaskPriority,
  progress: number,
  blockedBy: string[],
];

// API_CONTRACTS §7.1, row by row.
// prettier-ignore
const TASK_ROWS: readonly TaskRow[] = [
  ['SW-123', 'Lost Goods API', 'sellway', '04-backend-engineer', 'assigned', 'high', 0, []],
  ['SW-124', 'Dashboard performance optimization', 'sellway', '05-frontend-engineer', 'in_progress', 'normal', 40, []],
  ['SW-125', 'Campaign analytics', 'sellway', null, 'todo', 'low', 0, []],
  ['IK-201', 'Vacancy posting workflow', 'ishkun24', '10-ui-ux-designer', 'completed', 'normal', 100, []],
  ['IK-202', 'Recruitment pipeline', 'ishkun24', '06-database-engineer', 'waiting', 'high', 20, ['IK-203']],
  ['IK-203', 'Telegram bot integration', 'ishkun24', '12-ai-engineer', 'planning', 'normal', 10, []],
  ['ERP-301', 'Inventory architecture', 'erp', '03-architect', 'review', 'high', 70, []],
  ['ERP-302', 'Order management module', 'erp', '09-qa-engineer', 'failed', 'critical', 55, []],
  ['ERP-303', 'CRM integration', 'erp', '08-security-engineer', 'assigned', 'normal', 0, []],
  ['AM-401', 'Seller dashboard', 'ana-market', '11-mobile-engineer', 'in_progress', 'high', 65, []],
  ['AM-402', 'Marketplace integration', 'ana-market', null, 'todo', 'critical', 0, []],
];
const STARTED = new Set(['SW-124', 'IK-201', 'ERP-301', 'ERP-302', 'AM-401']);

export function baselineTasks(): Task[] {
  return TASK_ROWS.map(
    ([id, title, project, assignee, status, priority, progress, blockedBy], i) => ({
      id,
      title,
      description: `${title} for ${project}.`,
      project,
      assignedAgentId: assignee,
      status,
      priority,
      progress,
      createdAt: minutesAgo(180 - i * 5),
      startedAt: STARTED.has(id) ? minutesAgo(90 - i) : null,
      completedAt: status === 'completed' ? minutesAgo(30) : null,
      blockedBy,
      metadata: {},
      version: 1,
      updatedAt: minutesAgo(20),
    }),
  );
}

type AgentState = [
  status: AgentStatus,
  currentProject: string | null,
  taskId: string | null,
  progress: number,
  currentAction: string | null,
];

// API_CONTRACTS §7.2, keyed by agent number.
// prettier-ignore
const AGENT_STATES: Readonly<Record<string, AgentState>> = {
  '01-pm-orchestrator': ['working', 'erp', null, 0, 'assign_task'],
  '02-product-analyst': ['idle', 'sellway', null, 0, null],
  '03-architect': ['reviewing', 'erp', 'ERP-301', 70, 'review'],
  '04-backend-engineer': ['idle', 'sellway', null, 0, null],
  '05-frontend-engineer': ['working', 'sellway', 'SW-124', 40, 'edit_file'],
  '06-database-engineer': ['waiting', 'ishkun24', 'IK-202', 20, 'wait'],
  '07-devops-engineer': ['offline', 'erp', null, 0, null],
  '08-security-engineer': ['idle', null, null, 0, null],
  '09-qa-engineer': ['failed', 'erp', 'ERP-302', 55, null],
  '10-ui-ux-designer': ['completed', 'ishkun24', 'IK-201', 100, null],
  '11-mobile-engineer': ['working', 'ana-market', 'AM-401', 65, 'build'],
  '12-ai-engineer': ['planning', 'ishkun24', 'IK-203', 10, null],
  '13-documentation-engineer': ['idle', null, null, 0, null],
  '14-reviewer': ['idle', 'sellway', null, 0, null],
  '15-product-auditor': ['idle', null, null, 0, null],
};

export function baselineAgents(): Agent[] {
  const titles = new Map(TASK_ROWS.map(([id, title]) => [id, title]));
  return AGENT_REFERENCE.map((ref) => {
    const state = AGENT_STATES[ref.id];
    if (state === undefined) throw new Error(`No baseline state for ${ref.id}`);
    const [status, currentProject, taskId, progress, currentAction] = state;
    const busy = status !== 'idle' && status !== 'offline';
    return {
      id: ref.id,
      code: ref.code,
      name: ref.name,
      role: ref.role,
      shortRole: ref.shortRole,
      avatar: ref.avatar,
      department: ref.department,
      roomId: ref.roomId,
      deskId: ref.deskId,
      status,
      currentProject,
      currentTask: taskId === null ? null : (titles.get(taskId) ?? taskId),
      taskId,
      progress,
      startedAt: busy ? minutesAgo(25) : null,
      lastActivityAt: minutesAgo(10 + ref.sortOrder),
      currentAction,
      lastMessage: busy ? `${ref.name} is ${status}` : null,
      online: status !== 'offline',
      metadata: {},
      version: 1,
    };
  });
}

/** ASM §4 invariants; returns one message per violation (empty = consistent). */
export function agentInvariantViolations(agent: Agent): string[] {
  const issues: string[] = [];
  if (agent.online !== (agent.status !== 'offline')) issues.push('online !== (status !== offline)');
  if (agent.status === 'idle') {
    if (agent.taskId !== null) issues.push('idle with taskId');
    if (agent.currentTask !== null) issues.push('idle with currentTask');
    if (agent.currentAction !== null) issues.push('idle with currentAction');
    if (agent.startedAt !== null) issues.push('idle with startedAt');
    if (agent.progress !== 0) issues.push('idle with progress');
  }
  if (
    (ACTIVE_AGENT_STATUSES as readonly AgentStatus[]).includes(agent.status) &&
    agent.startedAt === null
  ) {
    issues.push('active without startedAt');
  }
  if (!Number.isInteger(agent.progress) || agent.progress < 0 || agent.progress > 100) {
    issues.push('progress out of range');
  }
  return issues.map((issue) => `${agent.id}: ${issue}`);
}

/** Task invariants of ASM §5.3 that hold for every reachable state (also with force). */
export function taskInvariantViolations(task: Task): string[] {
  const issues: string[] = [];
  if ((task.completedAt !== null) !== (task.status === 'completed')) {
    issues.push('completedAt set ⇔ status completed');
  }
  if (task.status === 'completed' && task.progress !== 100) issues.push('completed without 100%');
  if (task.status === 'in_progress' && task.startedAt === null)
    issues.push('in_progress without startedAt');
  if (!Number.isInteger(task.progress) || task.progress < 0 || task.progress > 100) {
    issues.push('progress out of range');
  }
  return issues.map((issue) => `${task.id}: ${issue}`);
}

export interface OfficeState {
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  projects: readonly Project[];
  events: OfficeEvent[];
  clock: number; // ms offset from BASE_TIME of the next write
}

export function createBaselineState(): OfficeState {
  return {
    agents: new Map(baselineAgents().map((agent) => [agent.id, agent])),
    tasks: new Map(baselineTasks().map((task) => [task.id, task])),
    projects: PROJECT_LIST,
    events: [],
    clock: 0,
  };
}

export function cloneState(state: OfficeState): OfficeState {
  return {
    agents: new Map(state.agents),
    tasks: new Map(state.tasks),
    projects: state.projects,
    events: [...state.events],
    clock: state.clock,
  };
}

/** Recursively freezes a value so that any mutation by the code under test throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/**
 * EventService emulation: resolves the project, loads agent/task, calls `decideEvent` with frozen state,
 * and applies an accepted decision (agent/task `version + 1`, event appended with the next `seq`).
 */
export function ingest(
  state: OfficeState,
  input: EventInput,
  options: { force?: boolean } = {},
): EventDecision {
  const now = isoAt(state.clock);
  state.clock += 1000;
  const agent = input.agentId === undefined ? null : (state.agents.get(input.agentId) ?? null);
  if (input.agentId !== undefined && agent === null)
    throw new Error(`Unknown agent ${input.agentId}`);
  let projectId: string | null = null;
  if (input.project !== undefined) {
    projectId = resolveProjectRef(input.project, state.projects)?.id ?? null;
    if (projectId === null) throw new Error(`Unknown project ${input.project}`);
  }
  const task = input.taskId === undefined ? null : (state.tasks.get(input.taskId) ?? null);
  const decision = decideEvent({
    input: deepFreeze(input),
    source: input.source ?? 'api',
    agent: deepFreeze(agent),
    task: deepFreeze(task),
    projectId,
    now,
    force: options.force ?? false,
  });
  if (decision.kind === 'accept') {
    if (agent !== null && decision.agentPatch !== null) {
      state.agents.set(agent.id, { ...agent, ...decision.agentPatch, version: agent.version + 1 });
    }
    const effect = decision.taskEffect;
    if (effect?.op === 'create') {
      if (state.tasks.has(effect.task.id)) throw new Error(`Duplicate task ${effect.task.id}`);
      state.tasks.set(effect.task.id, { ...effect.task, version: 1, updatedAt: now });
    } else if (effect?.op === 'update') {
      const current = state.tasks.get(effect.id);
      if (current === undefined) throw new Error(`Update of unknown task ${effect.id}`);
      state.tasks.set(effect.id, {
        ...current,
        ...effect.patch,
        version: current.version + 1,
        updatedAt: now,
      });
    }
    state.events.push({
      ...decision.event,
      id: `evt-${state.events.length + 1}`,
      seq: state.events.length + 1,
      createdAt: now,
    });
  }
  return decision;
}
