// TEST-ONLY fixtures: the API-C §7 seed baseline (agents §7.2, tasks §7.1) and builders. Never imported by
// application code.
import {
  AGENT_REFERENCE,
  PROJECTS,
  type Agent,
  type AgentStatus,
  type DemoState,
  type OfficeEvent,
  type Project,
  type Snapshot,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@vo/shared';

export const NOW = Date.parse('2026-10-03T22:41:07.000Z');
export const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

type AgentSeed = Partial<
  Pick<
    Agent,
    | 'status'
    | 'currentProject'
    | 'currentTask'
    | 'taskId'
    | 'progress'
    | 'startedAt'
    | 'currentAction'
    | 'lastMessage'
  >
>;

const AGENT_STATE: Record<string, AgentSeed> = {
  '01-pm-orchestrator': {
    status: 'working',
    currentProject: 'erp',
    startedAt: iso(25 * 60_000),
    currentAction: 'assign_task',
    lastMessage: 'Assigning ERP work',
  },
  '02-product-analyst': { status: 'idle', currentProject: 'sellway' },
  '03-architect': {
    status: 'reviewing',
    currentProject: 'erp',
    taskId: 'ERP-301',
    currentTask: 'Inventory architecture',
    progress: 70,
    startedAt: iso(50 * 60_000),
    currentAction: 'review',
    lastMessage: 'Reviewing inventory design',
  },
  '04-backend-engineer': { status: 'idle', currentProject: 'sellway' },
  '05-frontend-engineer': {
    status: 'working',
    currentProject: 'sellway',
    taskId: 'SW-124',
    currentTask: 'Dashboard performance optimization',
    progress: 40,
    startedAt: iso(3 * 60_000 + 12_000),
    currentAction: 'edit_file',
    lastMessage: 'Optimizing dashboard queries',
  },
  '06-database-engineer': {
    status: 'waiting',
    currentProject: 'ishkun24',
    taskId: 'IK-202',
    currentTask: 'Recruitment pipeline',
    progress: 20,
    startedAt: iso(40 * 60_000),
    currentAction: 'wait',
    lastMessage: 'Waiting for IK-203',
  },
  '07-devops-engineer': { status: 'offline', currentProject: 'erp' },
  '08-security-engineer': { status: 'idle' },
  '09-qa-engineer': {
    status: 'failed',
    currentProject: 'erp',
    taskId: 'ERP-302',
    currentTask: 'Order management module',
    progress: 55,
    startedAt: iso(70 * 60_000),
    lastMessage: 'Order tests failed',
  },
  '10-ui-ux-designer': {
    status: 'completed',
    currentProject: 'ishkun24',
    taskId: 'IK-201',
    currentTask: 'Vacancy posting workflow',
    progress: 100,
    startedAt: iso(90 * 60_000),
    lastMessage: 'Vacancy flow done',
  },
  '11-mobile-engineer': {
    status: 'working',
    currentProject: 'ana-market',
    taskId: 'AM-401',
    currentTask: 'Seller dashboard',
    progress: 65,
    startedAt: iso(30 * 60_000),
    currentAction: 'build',
    lastMessage: 'Building seller dashboard',
  },
  '12-ai-engineer': {
    status: 'planning',
    currentProject: 'ishkun24',
    taskId: 'IK-203',
    currentTask: 'Telegram bot integration',
    progress: 10,
    startedAt: iso(15 * 60_000),
    lastMessage: 'Planning bot flows',
  },
  '13-documentation-engineer': { status: 'idle' },
  '14-reviewer': { status: 'idle', currentProject: 'sellway' },
  '15-product-auditor': { status: 'idle' },
};

export function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  const ref = AGENT_REFERENCE.find((a) => a.id === id);
  if (!ref) throw new Error(`unknown agent ${id}`);
  const seed = AGENT_STATE[id] ?? {};
  const status: AgentStatus = overrides.status ?? seed.status ?? 'idle';
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
    currentProject: seed.currentProject ?? null,
    currentTask: seed.currentTask ?? null,
    taskId: seed.taskId ?? null,
    progress: seed.progress ?? 0,
    startedAt: seed.startedAt ?? null,
    lastActivityAt: iso(12_000),
    currentAction: seed.currentAction ?? null,
    lastMessage: seed.lastMessage ?? null,
    online: status !== 'offline',
    metadata: {},
    version: 1,
    ...overrides,
  };
}

export function baselineAgents(): Agent[] {
  return AGENT_REFERENCE.map((ref) => makeAgent(ref.id));
}

type TaskRow = [string, string, string, string | null, TaskStatus, TaskPriority, number, string[]];

const TASK_ROWS: TaskRow[] = [
  ['SW-123', 'Lost Goods API', 'sellway', '04-backend-engineer', 'assigned', 'high', 0, []],
  [
    'SW-124',
    'Dashboard performance optimization',
    'sellway',
    '05-frontend-engineer',
    'in_progress',
    'normal',
    40,
    [],
  ],
  ['SW-125', 'Campaign analytics', 'sellway', null, 'todo', 'low', 0, []],
  [
    'IK-201',
    'Vacancy posting workflow',
    'ishkun24',
    '10-ui-ux-designer',
    'completed',
    'normal',
    100,
    [],
  ],
  [
    'IK-202',
    'Recruitment pipeline',
    'ishkun24',
    '06-database-engineer',
    'waiting',
    'high',
    20,
    ['IK-203'],
  ],
  [
    'IK-203',
    'Telegram bot integration',
    'ishkun24',
    '12-ai-engineer',
    'planning',
    'normal',
    10,
    [],
  ],
  ['ERP-301', 'Inventory architecture', 'erp', '03-architect', 'review', 'high', 70, []],
  ['ERP-302', 'Order management module', 'erp', '09-qa-engineer', 'failed', 'critical', 55, []],
  ['ERP-303', 'CRM integration', 'erp', '08-security-engineer', 'assigned', 'normal', 0, []],
  ['AM-401', 'Seller dashboard', 'ana-market', '11-mobile-engineer', 'in_progress', 'high', 65, []],
  ['AM-402', 'Marketplace integration', 'ana-market', null, 'todo', 'critical', 0, []],
];

export function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const row = TASK_ROWS.find((r) => r[0] === id);
  const [taskId, title, project, assignee, status, priority, progress, blockedBy] = row ?? [
    id,
    `Task ${id}`,
    'sellway',
    null,
    'todo',
    'normal',
    0,
    [],
  ];
  return {
    id: taskId,
    title,
    description: `${title}.`,
    project,
    assignedAgentId: assignee,
    status,
    priority,
    progress,
    createdAt: iso(2 * 3_600_000),
    startedAt: null,
    completedAt: status === 'completed' ? iso(3_600_000) : null,
    blockedBy,
    metadata: {},
    version: 1,
    updatedAt: iso(3_600_000),
    ...overrides,
  };
}

export function baselineTasks(): Task[] {
  return TASK_ROWS.map((row) => makeTask(row[0]));
}

let seqCounter = 1000;

export function makeEvent(overrides: Partial<OfficeEvent> = {}): OfficeEvent {
  seqCounter += 1;
  const seq = overrides.seq ?? seqCounter;
  return {
    id: overrides.id ?? `evt-${seq}`,
    seq,
    type: 'agent.activity',
    source: 'api',
    agentId: '04-backend-engineer',
    project: 'sellway',
    taskId: null,
    status: null,
    action: 'run_command',
    message: 'Running backend tests',
    severity: 'info',
    progress: null,
    metadata: {},
    occurredAt: null,
    createdAt: new Date(NOW - 5_000).toISOString(),
    forced: false,
    ...overrides,
  };
}

export const DEMO_OFF: DemoState = { active: false, intervalMs: 3000, startedAt: null };

/** `lastSeq` defaults to the highest seq among the snapshot events (0 when none), like the server (ADR-035). */
export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const events = overrides.events ?? [];
  return {
    lastSeq: events.reduce((max, e) => Math.max(max, e.seq), 0),
    agents: baselineAgents(),
    tasks: baselineTasks(),
    projects: PROJECTS.map(({ id, name, taskPrefix }): Project => ({ id, name, taskPrefix })),
    events: [],
    eventsPage: { limit: 50, nextBefore: null },
    demo: DEMO_OFF,
    serverTime: new Date(NOW).toISOString(),
    ...overrides,
  };
}
