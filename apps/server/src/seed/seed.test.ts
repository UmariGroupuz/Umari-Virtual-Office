import {
  ACTIVE_AGENT_STATUSES,
  ACTIVE_TASK_STATUSES,
  AGENT_IDS,
  AGENT_REFERENCE,
  AGENT_STATUSES,
  PROJECTS,
  canTransitionAgent,
  canTransitionTask,
  mapAgentStatusToTaskStatus,
  type Agent,
  type AgentStatus,
  type OfficeEvent,
  type Task,
  type TaskStatus,
} from '@vo/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection';
import { makeAgent, T0 } from '../db/testing';
import type { DatabaseHandle } from '../db/types';
import { buildSeedBaseline, seedIfEmpty } from './seed';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const MIN = 60_000;
const minutesAgo = (iso: string): number => (NOW_MS - Date.parse(iso)) / MIN;

function allEventsAscending(handle: DatabaseHandle): OfficeEvent[] {
  return handle.repos.events.list({ limit: 500 }).events.reverse();
}

describe('seedIfEmpty — idempotency and atomicity', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openDatabase({ path: ':memory:' });
  });
  afterEach(() => {
    handle.close();
  });

  it('seeds an empty database once; a second call (restart) changes nothing', () => {
    const first = seedIfEmpty(handle, NOW);
    expect(first).toEqual({ seeded: true, agents: 15, tasks: 11, events: 44 });

    const rowsBefore = {
      projects: handle.repos.projects.list(),
      agents: handle.repos.agents.list(),
      tasks: handle.repos.tasks.list(),
      events: allEventsAscending(handle),
    };

    const second = seedIfEmpty(handle, new Date(NOW_MS + 3_600_000));
    expect(second).toEqual({ seeded: false, agents: 15, tasks: 11, events: 44 });
    expect({
      projects: handle.repos.projects.list(),
      agents: handle.repos.agents.list(),
      tasks: handle.repos.tasks.list(),
      events: allEventsAscending(handle),
    }).toEqual(rowsBefore);
  });

  it('does nothing when agents already exist (even with other tables empty)', () => {
    handle.repos.projects.insert({ ...PROJECTS[0]!, sortOrder: 1 }, T0);
    handle.repos.agents.insert({ ...makeAgent('04-backend-engineer'), sortOrder: 4 }, T0);

    expect(seedIfEmpty(handle, NOW)).toEqual({ seeded: false, agents: 1, tasks: 0, events: 0 });
    expect(handle.repos.projects.list()).toHaveLength(1);
  });

  it('is all-or-nothing: a failure mid-seed leaves the database untouched', () => {
    // A conflicting project row makes the project insert fail inside the seed transaction.
    handle.repos.projects.insert({ id: 'other', name: 'ERP', taskPrefix: 'X', sortOrder: 9 }, T0);

    expect(() => seedIfEmpty(handle, NOW)).toThrow(/UNIQUE/);
    expect(handle.repos.agents.count()).toBe(0);
    expect(handle.repos.tasks.count()).toBe(0);
    expect(handle.repos.events.count()).toBe(0);
    expect(handle.repos.projects.list().map((p) => p.id)).toEqual(['other']);
  });

  it('rejects an invalid clock', () => {
    expect(() => buildSeedBaseline(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('seed baseline content (API_CONTRACTS §7)', () => {
  let handle: DatabaseHandle;
  let agents: Agent[];
  let tasks: Task[];
  let events: OfficeEvent[];
  const agentById = (id: string): Agent => {
    const agent = agents.find((a) => a.id === id);
    if (!agent) throw new Error(`missing agent ${id}`);
    return agent;
  };

  beforeEach(() => {
    handle = openDatabase({ path: ':memory:' });
    seedIfEmpty(handle, NOW);
    agents = handle.repos.agents.list();
    tasks = handle.repos.tasks.list();
    events = allEventsAscending(handle);
  });
  afterEach(() => {
    handle.close();
  });

  it('projects = PROJECTS in order', () => {
    expect(handle.repos.projects.list()).toEqual(
      PROJECTS.map(({ id, name, taskPrefix }) => ({ id, name, taskPrefix })),
    );
  });

  it('§7.1 tasks exactly (independent copy of the contract table)', () => {
    // prettier-ignore
    const expected: [string, string, string, string | null, TaskStatus, string, number, string[]][] = [
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
    const actual = [...tasks]
      .sort(
        (a, b) =>
          expected.findIndex((e) => e[0] === a.id) - expected.findIndex((e) => e[0] === b.id),
      )
      .map((t) => [
        t.id,
        t.title,
        t.project,
        t.assignedAgentId,
        t.status,
        t.priority,
        t.progress,
        t.blockedBy,
      ]);
    expect(actual).toEqual(expected);

    const passedInProgress = ['SW-124', 'IK-201', 'ERP-301', 'ERP-302', 'AM-401'];
    for (const task of tasks) {
      expect(task.description, task.id).toMatch(/^[A-Z][^.]*\.$/); // one sentence
      const age = minutesAgo(task.createdAt);
      expect(age, task.id).toBeGreaterThanOrEqual(60);
      expect(age, task.id).toBeLessThanOrEqual(180);
      expect(task.startedAt !== null, task.id).toBe(passedInProgress.includes(task.id));
      expect(task.completedAt !== null, task.id).toBe(task.id === 'IK-201');
      expect(task.version).toBe(1);
      expect(task.metadata).toEqual({});
      expect(Date.parse(task.updatedAt)).toBeGreaterThanOrEqual(Date.parse(task.createdAt));
      expect(Date.parse(task.updatedAt)).toBeLessThanOrEqual(NOW_MS);
      if (task.startedAt !== null)
        expect(Date.parse(task.startedAt)).toBeGreaterThan(Date.parse(task.createdAt));
    }
  });

  it('§7.2 agent states exactly (independent copy of the contract table)', () => {
    // prettier-ignore
    const expected: Record<string, [AgentStatus, string | null, string | null, number, boolean, string | null]> = {
      '01-pm-orchestrator':        ['working',   'erp',        null,      0,   true,  'assign_task'],
      '02-product-analyst':        ['idle',      'sellway',    null,      0,   false, null],
      '03-architect':              ['reviewing', 'erp',        'ERP-301', 70,  true,  'review'],
      '04-backend-engineer':       ['idle',      'sellway',    null,      0,   false, null],
      '05-frontend-engineer':      ['working',   'sellway',    'SW-124',  40,  true,  'edit_file'],
      '06-database-engineer':      ['waiting',   'ishkun24',   'IK-202',  20,  true,  'wait'],
      '07-devops-engineer':        ['offline',   'erp',        null,      0,   false, null],
      '08-security-engineer':      ['idle',      null,         null,      0,   false, null],
      '09-qa-engineer':            ['failed',    'erp',        'ERP-302', 55,  true,  null],
      '10-ui-ux-designer':         ['completed', 'ishkun24',   'IK-201',  100, true,  null],
      '11-mobile-engineer':        ['working',   'ana-market', 'AM-401',  65,  true,  'build'],
      '12-ai-engineer':            ['planning',  'ishkun24',   'IK-203',  10,  true,  null],
      '13-documentation-engineer': ['idle',      null,         null,      0,   false, null],
      '14-reviewer':               ['idle',      'sellway',    null,      0,   false, null],
      '15-product-auditor':        ['idle',      null,         null,      0,   false, null],
    };
    expect(agents.map((a) => a.id)).toEqual(AGENT_IDS);
    for (const agent of agents) {
      const [status, project, taskId, progress, hasStartedAt, action] = expected[agent.id]!;
      expect(
        [
          agent.status,
          agent.currentProject,
          agent.taskId,
          agent.progress,
          agent.startedAt !== null,
          agent.currentAction,
        ],
        agent.id,
      ).toEqual([status, project, taskId, progress, hasStartedAt, action]);
      expect(agent.currentTask, agent.id).toBe(
        taskId === null ? null : (tasks.find((t) => t.id === taskId)?.title ?? null),
      );
      expect(agent.online, agent.id).toBe(status !== 'offline');
      expect(agent.metadata).toEqual({});
      expect(agent.version).toBe(1);
      expect(agent.lastActivityAt, agent.id).not.toBeNull();
      expect(minutesAgo(agent.lastActivityAt!), agent.id).toBeLessThanOrEqual(120);
      expect(minutesAgo(agent.lastActivityAt!), agent.id).toBeGreaterThan(0);
      if (status !== 'idle') expect(agent.lastMessage, agent.id).toMatch(/\w{3,}/);
    }
    expect(minutesAgo(agentById('01-pm-orchestrator').startedAt!)).toBe(25); // "~25 min ago"
    // ERP-303 is assigned to Security but not bound (ADR-017)
    expect(agentById('08-security-engineer').taskId).toBeNull();
  });

  it('reference fields come from AGENT_REFERENCE', () => {
    for (const ref of AGENT_REFERENCE) {
      const { sortOrder: _sortOrder, ...fields } = ref;
      expect(agentById(ref.id)).toMatchObject(fields);
    }
  });

  it('All-Projects metrics of §7.2', () => {
    const count = (status: AgentStatus): number => agents.filter((a) => a.status === status).length;
    expect({
      online: agents.filter((a) => a.online).length,
      working: count('working'),
      planning: count('planning'),
      waiting: count('waiting'),
      reviewing: count('reviewing'),
      failed: count('failed'),
      activeTasks: tasks.filter((t) =>
        (ACTIVE_TASK_STATUSES as readonly string[]).includes(t.status),
      ).length,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
    }).toEqual({
      online: 14,
      working: 3,
      planning: 1,
      waiting: 1,
      reviewing: 1,
      failed: 1,
      activeTasks: 7,
      completedTasks: 1,
    });
  });

  it('every agent satisfies the ASM §4 invariants', () => {
    for (const a of agents) {
      expect(AGENT_STATUSES).toContain(a.status);
      expect(a.online, a.id).toBe(a.status !== 'offline');
      if (a.status === 'idle') {
        expect([a.taskId, a.currentTask, a.currentAction, a.startedAt, a.progress], a.id).toEqual([
          null,
          null,
          null,
          null,
          0,
        ]);
      }
      if ((ACTIVE_AGENT_STATUSES as readonly string[]).includes(a.status))
        expect(a.startedAt, a.id).not.toBeNull();
      expect(a.progress).toBeGreaterThanOrEqual(0);
      expect(a.progress).toBeLessThanOrEqual(100);
      expect(Number.isInteger(a.progress)).toBe(true);
    }
  });

  it('REQ-121: Backend Engineer idle, SW-123 assigned to Backend; next Sellway id is SW-126', () => {
    expect(agentById('04-backend-engineer').status).toBe('idle');
    const sw123 = handle.repos.tasks.getById('SW-123');
    expect(sw123?.assignedAgentId).toBe('04-backend-engineer');
    expect(['todo', 'assigned']).toContain(sw123?.status);
    expect(handle.repos.tasks.maxNumericSuffix('SW')).toBe(125);
    // §12 example precondition: idle → working and assigned → in_progress (owned) are legal
    expect(canTransitionAgent('idle', 'working')).toBe(true);
    expect(canTransitionTask(sw123!.status, 'in_progress', { owned: true })).toBe(true);
  });

  it('REQ-120 task mix: ≥1 completed, in_progress, waiting with blockedBy, todo', () => {
    expect(tasks.some((t) => t.status === 'completed')).toBe(true);
    expect(tasks.some((t) => t.status === 'in_progress')).toBe(true);
    expect(tasks.some((t) => t.status === 'waiting' && t.blockedBy.length > 0)).toBe(true);
    expect(tasks.some((t) => t.status === 'todo')).toBe(true);
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) for (const b of t.blockedBy) expect(ids.has(b) && b !== t.id).toBe(true);
  });

  describe('§7.3 history', () => {
    it('≥ 30 events over the past ~2 h; seq order = chronological order', () => {
      expect(events.length).toBeGreaterThanOrEqual(30);
      events.forEach((e, i) => {
        expect(e.seq).toBe(i + 1);
        expect(minutesAgo(e.createdAt)).toBeGreaterThan(0);
        expect(minutesAgo(e.createdAt)).toBeLessThanOrEqual(120);
        if (i > 0)
          expect(Date.parse(e.createdAt)).toBeGreaterThan(Date.parse(events[i - 1]!.createdAt));
      });
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      for (const e of events)
        expect(e.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it('covers all 4 projects and ≥ 6 types incl. the required ones', () => {
      expect(new Set(events.map((e) => e.project).filter((p) => p !== null))).toEqual(
        new Set(PROJECTS.map((p) => p.id)),
      );
      const types = new Set(events.map((e) => e.type));
      expect(types.size).toBeGreaterThanOrEqual(6);
      for (const t of [
        'agent.task.assigned',
        'agent.task.started',
        'agent.task.progress',
        'agent.task.completed',
        'agent.task.failed',
        'agent.activity',
        'agent.status.changed',
        'agent.disconnected',
        'system.warning',
      ] as const) {
        expect(types, t).toContain(t);
      }
      expect(
        events.some((e) => e.type === 'agent.disconnected' && e.agentId === '07-devops-engineer'),
      ).toBe(true);
      expect(events.some((e) => e.type === 'system.warning' && e.project === null)).toBe(true);
      expect(events.some((e) => e.type === 'agent.task.failed' && e.severity === 'error')).toBe(
        true,
      );
    });

    it('sources are api/simulator only (never demo); nothing forced; references exist', () => {
      const agentIds = new Set(AGENT_IDS);
      const projectIds = new Set(PROJECTS.map((p) => p.id));
      for (const e of events) {
        expect(['api', 'simulator'], `seq ${e.seq}`).toContain(e.source);
        expect(e.forced).toBe(false);
        if (e.agentId !== null) expect(agentIds.has(e.agentId), `seq ${e.seq}`).toBe(true);
        if (e.project !== null) expect(projectIds.has(e.project), `seq ${e.seq}`).toBe(true);
        if (e.taskId !== null) {
          const task = tasks.find((t) => t.id === e.taskId);
          expect(task, `seq ${e.seq}`).toBeDefined();
          expect(e.project, `seq ${e.seq}: event project = task project (ES §5.4)`).toBe(
            task!.project,
          );
        }
        if (e.type.startsWith('agent.')) expect(e.agentId).not.toBeNull();
        if (e.type.startsWith('system.') || e.type === 'agent.message')
          expect(e.message).not.toBeNull();
        if (e.type === 'agent.activity') expect(e.action).not.toBeNull();
        if (e.type === 'agent.task.progress') expect(e.progress).not.toBeNull();
        if (e.type === 'task.created')
          expect(e.message).toBe(`Task created: ${tasks.find((t) => t.id === e.taskId)!.title}`);
        if (e.type === 'task.updated')
          expect(e.message).toBe(`Task updated: ${tasks.find((t) => t.id === e.taskId)!.title}`);
      }
    });

    it('task.created events match the tasks they created', () => {
      for (const e of events.filter((x) => x.type === 'task.created')) {
        const task = tasks.find((t) => t.id === e.taskId)!;
        expect(e.createdAt).toBe(task.createdAt);
        expect(['todo', 'assigned']).toContain(e.status);
        expect(e.agentId === null).toBe(e.status === 'todo');
      }
    });

    it('is consistent with the seeded rows: an independent replay (ASM §4–§6, ES §2.3/§4/§5) reproduces them', () => {
      const sim = replayHistory(events, tasks);
      for (const agent of agents) {
        const s = sim.agents.get(agent.id)!;
        expect(
          {
            status: s.status,
            online: s.online,
            taskId: s.taskId,
            currentProject: s.currentProject,
            progress: s.progress,
            startedAt: s.startedAt,
            currentAction: s.currentAction,
            lastMessage: s.lastMessage,
            lastActivityAt: s.lastActivityAt,
          },
          agent.id,
        ).toEqual({
          status: agent.status,
          online: agent.online,
          taskId: agent.taskId,
          currentProject: agent.currentProject,
          progress: agent.progress,
          startedAt: agent.startedAt,
          currentAction: agent.currentAction,
          lastMessage: agent.lastMessage,
          lastActivityAt: agent.lastActivityAt,
        });
      }
      for (const task of tasks) {
        const s = sim.tasks.get(task.id)!;
        expect(
          {
            status: s.status,
            assignedAgentId: s.assignedAgentId,
            progress: s.progress,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
            updatedAt: s.updatedAt,
          },
          task.id,
        ).toEqual({
          status: task.status,
          assignedAgentId: task.assignedAgentId,
          progress: task.progress,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          updatedAt: task.updatedAt,
        });
      }
    });
  });

  it('timestamps are relative to the given clock', () => {
    const later = new Date(NOW_MS + 86_400_000);
    const a = buildSeedBaseline(NOW);
    const b = buildSeedBaseline(later);
    expect(Date.parse(b.events[0]!.createdAt) - Date.parse(a.events[0]!.createdAt)).toBe(
      86_400_000,
    );
    expect(Date.parse(b.tasks[0]!.task.createdAt) - Date.parse(a.tasks[0]!.task.createdAt)).toBe(
      86_400_000,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Test oracle: a deliberately small, independent re-implementation of the event effects that the
// seed history uses (ASM §4 steps 1–6, ASM §5.3/§6, ES §2.3, §4, §5.2). It throws on any illegal
// transition, so the seed can never encode a state the real pipeline would reject.
// ---------------------------------------------------------------------------------------------

interface SimAgent {
  status: AgentStatus;
  online: boolean;
  taskId: string | null;
  currentProject: string | null;
  progress: number;
  startedAt: string | null;
  currentAction: string | null;
  lastMessage: string | null;
  lastActivityAt: string | null;
}

interface SimTask {
  exists: boolean;
  project: string;
  status: TaskStatus;
  assignedAgentId: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

const isActive = (s: AgentStatus): boolean =>
  (ACTIVE_AGENT_STATUSES as readonly string[]).includes(s);

function impliedStatus(type: OfficeEvent['type'], current: AgentStatus): AgentStatus {
  switch (type) {
    case 'agent.connected':
      return current === 'offline' ? 'idle' : current;
    case 'agent.disconnected':
      return 'offline';
    case 'agent.task.started':
      return 'working';
    case 'agent.task.completed':
      return 'completed';
    case 'agent.task.failed':
      return 'failed';
    default:
      return current;
  }
}

function replayHistory(
  events: readonly OfficeEvent[],
  finalTasks: readonly Task[],
): { agents: Map<string, SimAgent>; tasks: Map<string, SimTask> } {
  const agents = new Map<string, SimAgent>(
    AGENT_IDS.map((id) => [
      id,
      {
        status: 'idle',
        online: true,
        taskId: null,
        currentProject: null,
        progress: 0,
        startedAt: null,
        currentAction: null,
        lastMessage: null,
        lastActivityAt: null,
      },
    ]),
  );
  const createdInWindow = new Set(
    events.filter((e) => e.type === 'task.created').map((e) => e.taskId),
  );
  const tasks = new Map<string, SimTask>(
    finalTasks.map((t) => {
      const first = events.find(
        (e) => e.taskId === t.id && e.type !== 'task.created' && !e.type.startsWith('system.'),
      );
      const startsUnassigned = first?.type === 'agent.task.assigned';
      return [
        t.id,
        {
          exists: !createdInWindow.has(t.id),
          project: t.project,
          status: startsUnassigned ? 'todo' : 'assigned',
          assignedAgentId: startsUnassigned ? null : t.assignedAgentId,
          progress: 0,
          startedAt: null,
          completedAt: null,
          updatedAt: t.createdAt,
        },
      ];
    }),
  );

  const moveTask = (task: SimTask, id: string, to: TaskStatus, at: string): void => {
    if (task.status === to) return;
    if (!canTransitionTask(task.status, to, { owned: task.assignedAgentId !== null })) {
      throw new Error(`illegal task transition ${id}: ${task.status} → ${to}`);
    }
    task.status = to;
    if (to === 'in_progress' && task.startedAt === null) task.startedAt = at;
    if (to === 'completed') {
      task.completedAt = at;
      task.progress = 100;
    }
  };

  for (const e of events) {
    const label = `seq ${e.seq} (${e.type})`;
    const task = e.taskId === null ? undefined : tasks.get(e.taskId);

    if (e.type === 'task.created') {
      if (!task || task.exists) throw new Error(`${label}: task must be new`);
      task.exists = true;
      task.status = e.status as TaskStatus;
      task.assignedAgentId = e.agentId;
      task.updatedAt = e.createdAt;
      continue;
    }
    if (e.type === 'task.updated') {
      if (!task?.exists) throw new Error(`${label}: unknown task`);
      if (e.status !== null) moveTask(task, e.taskId!, e.status as TaskStatus, e.createdAt);
      task.updatedAt = e.createdAt;
      continue;
    }
    if (e.type.startsWith('system.')) {
      const expectedSeverity =
        e.type === 'system.warning' ? 'warning' : e.type === 'system.error' ? 'error' : 'info';
      if (e.severity !== expectedSeverity) throw new Error(`${label}: severity ${e.severity}`);
      if (e.status !== null || e.progress !== null)
        throw new Error(`${label}: forbidden status/progress`);
      continue;
    }

    const agent = agents.get(e.agentId!);
    if (!agent) throw new Error(`${label}: unknown agent`);
    if (task !== undefined && !task.exists)
      throw new Error(`${label}: task referenced before creation`);
    const S = agent.status;
    const explicit = e.status as AgentStatus | null;
    if (explicit !== null && !(AGENT_STATUSES as readonly string[]).includes(explicit))
      throw new Error(`${label}: bad status`);
    if (explicit !== null && (e.type === 'agent.connected' || e.type === 'agent.disconnected')) {
      throw new Error(`${label}: status forbidden`);
    }
    const T = explicit ?? impliedStatus(e.type, S);
    if (S !== T && !canTransitionAgent(S, T))
      throw new Error(`${label}: illegal agent transition ${S} → ${T}`);

    const expectedSeverity = e.type === 'agent.task.failed' || T === 'failed' ? 'error' : 'info';
    if (e.severity !== expectedSeverity)
      throw new Error(`${label}: severity ${e.severity}, expected ${expectedSeverity}`);

    // Task effects (ES §4, §5.2 ownership/claiming, ASM §6 mapping).
    if (task !== undefined) {
      const before = JSON.stringify(task);
      const owner = task.assignedAgentId;
      const owns = owner === e.agentId;
      const lifecycle = [
        'agent.task.started',
        'agent.task.progress',
        'agent.task.completed',
        'agent.task.failed',
      ];
      if (e.type === 'agent.task.assigned') {
        task.assignedAgentId = e.agentId;
        if (task.status === 'todo' || task.status === 'failed')
          moveTask(task, e.taskId!, 'assigned', e.createdAt);
        else if (task.status !== 'assigned')
          throw new Error(`${label}: cannot assign a ${task.status} task`);
        if (explicit !== null && S !== T) {
          const mapped = mapAgentStatusToTaskStatus(T);
          if (mapped) moveTask(task, e.taskId!, mapped, e.createdAt);
        }
      } else if (lifecycle.includes(e.type)) {
        if (!owns && owner !== null)
          throw new Error(`${label}: lifecycle event by a non-assignee (seed must avoid)`);
        task.assignedAgentId = e.agentId;
        if (e.type === 'agent.task.started') moveTask(task, e.taskId!, 'in_progress', e.createdAt);
        if (e.type === 'agent.task.completed') moveTask(task, e.taskId!, 'completed', e.createdAt);
        if (e.type === 'agent.task.failed') moveTask(task, e.taskId!, 'failed', e.createdAt);
        if (e.type === 'agent.task.progress') task.progress = e.progress!;
      } else if (S !== T && (owns || owner === null)) {
        const mapped = mapAgentStatusToTaskStatus(T);
        if (mapped) {
          task.assignedAgentId = e.agentId;
          moveTask(task, e.taskId!, mapped, e.createdAt);
        }
      }
      if (JSON.stringify(task) !== before) task.updatedAt = e.createdAt;
    }

    // Agent effects (ASM §4 steps 2–6).
    const previousTaskId = agent.taskId;
    if (S !== T) {
      agent.status = T;
      agent.currentAction = e.action;
      if (isActive(T) && !isActive(S)) agent.startedAt = e.createdAt;
      if (T === 'idle') {
        agent.taskId = null;
        agent.currentAction = null;
        agent.progress = 0;
        agent.startedAt = null;
      }
      if (T === 'offline') {
        agent.online = false;
        agent.startedAt = null;
        agent.currentAction = null;
      }
      if (S === 'offline') agent.online = true;
    }
    if (
      T !== 'idle' &&
      T !== 'offline' &&
      !(e.type === 'agent.task.assigned' && explicit === null)
    ) {
      if (e.taskId !== null) {
        agent.taskId = e.taskId;
        agent.currentProject = task?.project ?? e.project;
      } else if (e.project !== null) {
        agent.currentProject = e.project;
      }
    }
    if (T !== 'idle') {
      if (e.progress !== null) agent.progress = e.progress;
      else if (agent.taskId !== previousTaskId) agent.progress = task?.progress ?? 0;
    }
    if (T === 'completed' && S !== 'completed' && agent.taskId !== null) agent.progress = 100;
    agent.lastActivityAt = e.createdAt;
    if (e.message !== null) agent.lastMessage = e.message;
    if (S === T && T !== 'idle' && T !== 'offline' && e.action !== null)
      agent.currentAction = e.action;

    // Stored project = explicit ?? task project ?? agent project after the event (ES §5.4).
    if (e.project === null && task === undefined && agent.currentProject !== null) {
      throw new Error(`${label}: project should have been derived as ${agent.currentProject}`);
    }
  }
  return { agents, tasks };
}
