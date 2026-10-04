import {
  ACTIVE_AGENT_STATUSES,
  AGENT_IDS,
  AGENT_STATUSES,
  PRODUCER_EVENT_TYPES,
  PROJECT_IDS,
  canTransitionAgent,
  canTransitionTask,
  eventInputSchema,
  producerEventInputSchema,
  type Agent,
  type AgentStatus,
  type Task,
} from '@vo/shared';
import { describe, expect, it } from 'vitest';
import {
  decideEvent,
  defaultSeverity,
  type EventDecision,
  type EventDecisionInput,
} from './eventEffects';
import {
  agentInvariantViolations,
  baselineAgents,
  baselineTasks,
  createBaselineState,
  deepFreeze,
  ingest,
  isoAt,
  taskInvariantViolations,
  type OfficeState,
} from './testHarness';

const NOW = isoAt(0);
const BE = '04-backend-engineer';
const FE = '05-frontend-engineer';
const QA = '09-qa-engineer';
const UX = '10-ui-ux-designer';
const OPS = '07-devops-engineer';
const REV = '14-reviewer';
const AIE = '12-ai-engineer';

const agentsById = new Map(baselineAgents().map((a) => [a.id, a]));
const tasksById = new Map(baselineTasks().map((t) => [t.id, t]));

function agentOf(id: string): Agent {
  const agent = agentsById.get(id);
  if (agent === undefined) throw new Error(`no agent ${id}`);
  return agent;
}
function taskOf(id: string): Task {
  const task = tasksById.get(id);
  if (task === undefined) throw new Error(`no task ${id}`);
  return task;
}

/** A consistent agent (ASM §4 invariants) in `status`, based on the Backend Engineer. */
function agentIn(status: AgentStatus, overrides: Partial<Agent> = {}): Agent {
  const base = agentOf(BE);
  const active = (ACTIVE_AGENT_STATUSES as readonly AgentStatus[]).includes(status);
  const bound = status !== 'idle' && status !== 'offline';
  return {
    ...base,
    status,
    online: status !== 'offline',
    startedAt: active || status === 'completed' || status === 'failed' ? isoAt(-600_000) : null,
    taskId: bound ? 'SW-123' : null,
    currentTask: bound ? 'Lost Goods API' : null,
    progress: bound ? 30 : 0,
    currentAction: active ? 'edit_file' : null,
    ...overrides,
  };
}

/** Parses a raw body like EventService (internal origin: any source) and decides it. */
function decide(
  raw: Record<string, unknown>,
  ctx: Partial<Omit<EventDecisionInput, 'input'>> = {},
): EventDecision {
  const input = eventInputSchema.parse(raw);
  const agentId = input.agentId;
  const taskId = input.taskId;
  return decideEvent({
    input: deepFreeze(input),
    source: input.source ?? 'api',
    agent: deepFreeze(
      ctx.agent !== undefined ? ctx.agent : agentId === undefined ? null : agentOf(agentId),
    ),
    task: deepFreeze(
      ctx.task !== undefined
        ? ctx.task
        : taskId === undefined
          ? null
          : (tasksById.get(taskId) ?? null),
    ),
    projectId: ctx.projectId ?? (typeof raw.project === 'string' ? raw.project : null),
    now: NOW,
    force: ctx.force ?? false,
  });
}

function accepted(decision: EventDecision) {
  if (decision.kind !== 'accept') {
    throw new Error(`expected accept, got ${decision.error.code}: ${decision.error.message}`);
  }
  return decision;
}
function rejected(decision: EventDecision) {
  if (decision.kind !== 'reject') throw new Error('expected reject');
  return decision.error;
}

describe('defaultSeverity (ES §2.3)', () => {
  it.each([
    ['system.warning', null, 'warning'],
    ['system.error', null, 'error'],
    ['system.info', null, 'info'],
    ['agent.task.failed', null, 'error'],
    ['agent.task.failed', 'working', 'error'],
    ['agent.status.changed', 'failed', 'error'],
    ['agent.activity', 'failed', 'error'],
    ['agent.status.changed', 'working', 'info'],
    ['agent.activity', null, 'info'],
    ['agent.task.completed', 'completed', 'info'],
    ['task.created', null, 'info'],
    ['task.updated', null, 'info'],
  ] as const)('%s with status %s → %s', (type, status, expected) => {
    expect(defaultSeverity(type, status)).toBe(expected);
  });

  it('explicit severity always wins', () => {
    const d = accepted(
      decide({ type: 'agent.task.failed', agentId: FE, taskId: 'SW-124', severity: 'warning' }),
    );
    expect(d.event.severity).toBe('warning');
  });

  it('an event that leaves an already-failed agent failed without setting a status is info', () => {
    expect(
      accepted(decide({ type: 'agent.message', agentId: QA, message: 'Looking into it' })).event
        .severity,
    ).toBe('info');
    expect(
      accepted(decide({ type: 'agent.status.changed', agentId: QA, status: 'failed' })).event
        .severity,
    ).toBe('error');
  });
});

describe('ES §11 example (REQ-022) on the seed baseline', () => {
  it('produces exactly the documented agent patch, task patch and event', () => {
    const input = producerEventInputSchema.parse({
      type: 'agent.activity',
      agentId: BE,
      project: 'Sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'run_command',
      message: 'Running backend tests',
      metadata: { command: 'npm test' },
    });
    const d = accepted(
      decideEvent({
        input,
        source: 'api',
        agent: agentOf(BE),
        task: taskOf('SW-123'),
        projectId: 'sellway',
        now: NOW,
        force: false,
      }),
    );
    expect(d.agentPatch).toEqual({
      status: 'working',
      currentAction: 'run_command',
      startedAt: NOW,
      taskId: 'SW-123',
      currentTask: 'Lost Goods API',
      lastActivityAt: NOW,
      lastMessage: 'Running backend tests',
    });
    expect(d.taskEffect).toEqual({
      op: 'update',
      id: 'SW-123',
      patch: { status: 'in_progress', startedAt: NOW },
    });
    expect(d.event).toEqual({
      type: 'agent.activity',
      source: 'api',
      agentId: BE,
      project: 'sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'run_command',
      message: 'Running backend tests',
      severity: 'info',
      progress: null,
      metadata: { command: 'npm test' },
      occurredAt: null,
      forced: false,
    });
    expect(d.forced).toEqual([]);
  });

  it('is deterministic and does not mutate its (frozen) inputs', () => {
    const raw = { type: 'agent.task.started', agentId: FE, taskId: 'SW-124', project: 'sellway' };
    expect(decide(raw)).toEqual(decide(raw));
  });
});

describe('agent.status.changed — every cell of the 8×8 table (ASM §2.1)', () => {
  const cells = AGENT_STATUSES.flatMap((from) => AGENT_STATUSES.map((to) => [from, to] as const));

  it.each(cells)('%s → %s', (from, to) => {
    const agent = agentIn(from);
    const d = decide({ type: 'agent.status.changed', agentId: BE, status: to }, { agent });
    if (from === to) {
      const ok = accepted(d);
      expect(ok.agentPatch).toEqual({ lastActivityAt: NOW });
      expect(ok.taskEffect).toBeNull();
    } else if (canTransitionAgent(from, to)) {
      const ok = accepted(d);
      expect(ok.agentPatch?.status).toBe(to);
      const next = { ...agent, ...ok.agentPatch };
      expect(agentInvariantViolations(next)).toEqual([]);
    } else {
      const error = rejected(d);
      expect(error.status).toBe(409);
      expect(error.code).toBe('ILLEGAL_TRANSITION');
      expect(error.message).toBe(`Illegal transition: ${from} → ${to}`);
      expect(error.details).toEqual({ entity: 'agent', id: BE, from, to });
    }
  });

  it('owner examples and idle → working are accepted', () => {
    const examples: [AgentStatus, AgentStatus][] = [
      ['idle', 'planning'],
      ['planning', 'working'],
      ['working', 'waiting'],
      ['waiting', 'working'],
      ['working', 'reviewing'],
      ['reviewing', 'completed'],
      ['working', 'failed'],
      ['failed', 'planning'],
      ['completed', 'idle'],
      ['idle', 'working'],
    ];
    for (const [from, to] of examples) {
      expect(
        decide({ type: 'agent.status.changed', agentId: BE, status: to }, { agent: agentIn(from) })
          .kind,
      ).toBe('accept');
    }
  });
});

describe('agent.connected / agent.disconnected from every status (REQ-012)', () => {
  it.each(AGENT_STATUSES)('agent.connected from %s', (from) => {
    const agent = agentIn(from, { lastMessage: 'old' });
    const d = accepted(decide({ type: 'agent.connected', agentId: BE }, { agent }));
    if (from === 'offline') {
      expect(d.agentPatch).toEqual({
        status: 'idle',
        online: true,
        lastActivityAt: NOW,
      });
    } else {
      expect(d.agentPatch).toEqual({ lastActivityAt: NOW });
    }
    expect(d.taskEffect).toBeNull();
    expect(agentInvariantViolations({ ...agent, ...d.agentPatch })).toEqual([]);
  });

  it('agent.connected on an offline agent clears its last-known task context (→ idle)', () => {
    const agent = agentIn('offline', {
      taskId: 'SW-123',
      currentTask: 'Lost Goods API',
      progress: 30,
    });
    const d = accepted(decide({ type: 'agent.connected', agentId: BE }, { agent }));
    expect(d.agentPatch).toEqual({
      status: 'idle',
      online: true,
      taskId: null,
      currentTask: null,
      progress: 0,
      lastActivityAt: NOW,
    });
  });

  it.each(AGENT_STATUSES)('agent.disconnected from %s', (from) => {
    const agent = agentIn(from);
    const d = accepted(decide({ type: 'agent.disconnected', agentId: BE }, { agent }));
    const next = { ...agent, ...d.agentPatch };
    expect(next.status).toBe('offline');
    expect(next.online).toBe(false);
    expect(next.startedAt).toBeNull();
    expect(next.currentAction).toBeNull();
    // Task, project and progress are kept as last-known context.
    expect(next.taskId).toBe(agent.taskId);
    expect(next.currentProject).toBe(agent.currentProject);
    expect(next.progress).toBe(agent.progress);
    if (from === 'offline') expect(d.agentPatch).toEqual({ lastActivityAt: NOW });
    expect(d.taskEffect).toBeNull();
  });

  it('agent.connected with a taskId binds an online, busy agent (ASM §4 step 3)', () => {
    const d = accepted(decide({ type: 'agent.connected', agentId: FE, taskId: 'SW-125' }));
    expect(d.agentPatch).toMatchObject({
      taskId: 'SW-125',
      currentTask: 'Campaign analytics',
      progress: 0,
    });
    expect(d.taskEffect).toBeNull(); // connected never changes tasks
  });
});

describe('ASM §4 step by step', () => {
  it('step 2: resting → active sets startedAt; active → active keeps it', () => {
    const fromIdle = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'planning' }),
    );
    expect(fromIdle.agentPatch?.startedAt).toBe(NOW);
    const waiting = agentIn('waiting');
    const between = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'working' }, { agent: waiting }),
    );
    expect(between.agentPatch).not.toHaveProperty('startedAt');
    const fromCompleted = accepted(
      decide(
        { type: 'agent.status.changed', agentId: BE, status: 'working' },
        { agent: agentIn('completed') },
      ),
    );
    expect(fromCompleted.agentPatch?.startedAt).toBe(NOW);
  });

  it('step 2: a status change sets currentAction to the event action or null', () => {
    const withAction = accepted(
      decide({ type: 'agent.activity', agentId: FE, action: 'test', status: 'waiting' }),
    );
    expect(withAction.agentPatch?.currentAction).toBe('test');
    const withoutAction = accepted(
      decide({ type: 'agent.status.changed', agentId: FE, status: 'waiting' }),
    );
    expect(withoutAction.agentPatch?.currentAction).toBeNull();
  });

  it('step 2: → idle clears task, action, progress and startedAt but keeps currentProject', () => {
    const d = accepted(
      decide({
        type: 'agent.status.changed',
        agentId: FE,
        status: 'idle',
        action: 'x',
        project: 'erp',
      }),
    );
    expect(d.agentPatch).toEqual({
      status: 'idle',
      taskId: null,
      currentTask: null,
      currentAction: null,
      progress: 0,
      startedAt: null,
      lastActivityAt: NOW,
    });
    expect(d.event.project).toBe('erp'); // explicit project is stored on the event, not bound
  });

  it('step 2: → completed / failed keep startedAt', () => {
    for (const status of ['completed', 'failed'] as const) {
      const d = accepted(decide({ type: 'agent.status.changed', agentId: FE, status }));
      expect(d.agentPatch).not.toHaveProperty('startedAt');
    }
  });

  it('step 3: unknown taskId is bound with currentTask = taskId and does not create a task', () => {
    const d = accepted(
      decide({
        type: 'agent.status.changed',
        agentId: FE,
        status: 'waiting',
        taskId: 'X-1',
        project: 'erp',
      }),
    );
    expect(d.agentPatch).toMatchObject({
      taskId: 'X-1',
      currentTask: 'X-1',
      currentProject: 'erp',
      progress: 0,
    });
    expect(d.taskEffect).toBeNull();
    expect(d.event.project).toBe('erp');
  });

  it('step 3: an unknown taskId without project keeps the current project', () => {
    const d = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'working', taskId: 'X-1' }),
    );
    expect(d.agentPatch).not.toHaveProperty('currentProject');
    expect(d.event.project).toBe('sellway'); // derived from the agent after the event
  });

  it('step 3: a project without taskId sets currentProject; idle/offline never bind', () => {
    const busy = accepted(
      decide({ type: 'agent.activity', agentId: FE, action: 'search', project: 'erp' }),
    );
    expect(busy.agentPatch?.currentProject).toBe('erp');
    const idle = accepted(
      decide({
        type: 'agent.activity',
        agentId: BE,
        action: 'search',
        project: 'sellway',
        taskId: 'SW-125',
      }),
    );
    expect(idle.agentPatch).toEqual({ lastActivityAt: NOW }); // idle: no binding, no action
    const offline = accepted(
      decide({ type: 'agent.message', agentId: OPS, message: 'hi', taskId: 'ERP-303' }),
    );
    expect(offline.agentPatch).toEqual({ lastActivityAt: NOW, lastMessage: 'hi' });
  });

  it('step 3: a non-assignee binds to the task (Reviewer reviewing Backend’s task)', () => {
    const d = accepted(
      decide({
        type: 'agent.status.changed',
        agentId: REV,
        status: 'reviewing',
        taskId: 'SW-123',
        action: 'git_diff',
      }),
    );
    expect(d.agentPatch).toMatchObject({
      status: 'reviewing',
      taskId: 'SW-123',
      currentTask: 'Lost Goods API',
      currentAction: 'git_diff',
    });
    expect(d.taskEffect).toBeNull();
  });

  it('step 3: binding to a task of another project moves currentProject', () => {
    const d = accepted(
      decide({
        type: 'agent.status.changed',
        agentId: REV,
        status: 'reviewing',
        taskId: 'ERP-301',
      }),
    );
    expect(d.agentPatch).toMatchObject({ currentProject: 'erp', progress: 70 });
    expect(d.event.project).toBe('erp');
  });

  it('step 4: event progress wins; a newly bound task brings its progress; same binding keeps progress', () => {
    const explicit = accepted(
      decide({ type: 'agent.activity', agentId: FE, action: 'build', progress: 55 }),
    );
    expect(explicit.agentPatch?.progress).toBe(55);
    const rebound = accepted(
      decide({ type: 'agent.activity', agentId: FE, action: 'build', taskId: 'AM-401' }),
    );
    expect(rebound.agentPatch).toMatchObject({ taskId: 'AM-401', progress: 65 });
    const same = accepted(
      decide({ type: 'agent.activity', agentId: FE, action: 'build', taskId: 'SW-124' }),
    );
    expect(same.agentPatch).toEqual({ currentAction: 'build', lastActivityAt: NOW });
  });

  it('step 5: completing with a bound task sets progress 100; without a task it does not', () => {
    const withTask = accepted(
      decide({ type: 'agent.status.changed', agentId: FE, status: 'completed', progress: 50 }),
    );
    expect(withTask.agentPatch?.progress).toBe(100);
    const noTask = agentIn('working', { taskId: null, currentTask: null, progress: 20 });
    const without = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'completed' }, { agent: noTask }),
    );
    expect(without.agentPatch).not.toHaveProperty('progress');
  });

  it('step 6: lastActivityAt always, message → lastMessage, action only without a status change', () => {
    const d = accepted(decide({ type: 'agent.message', agentId: FE, message: 'Almost done' }));
    expect(d.agentPatch).toEqual({ lastActivityAt: NOW, lastMessage: 'Almost done' });
    const act = accepted(decide({ type: 'agent.activity', agentId: FE, action: 'git_commit' }));
    expect(act.agentPatch).toEqual({ lastActivityAt: NOW, currentAction: 'git_commit' });
  });
});

describe('per event type', () => {
  it('agent.activity / agent.message with a status change move an owned task (ASM §6)', () => {
    const d = accepted(
      decide({
        type: 'agent.message',
        agentId: FE,
        message: 'blocked',
        status: 'waiting',
        taskId: 'SW-124',
      }),
    );
    expect(d.taskEffect).toEqual({ op: 'update', id: 'SW-124', patch: { status: 'waiting' } });
  });

  it('generic events without a status change never touch the task', () => {
    const d = accepted(
      decide({
        type: 'agent.activity',
        agentId: FE,
        action: 'build',
        taskId: 'SW-124',
        progress: 90,
      }),
    );
    expect(d.taskEffect).toBeNull();
  });

  it('agent.status.changed → idle / offline leaves the task unchanged', () => {
    for (const status of ['idle', 'offline'] as const) {
      expect(
        accepted(decide({ type: 'agent.status.changed', agentId: FE, status, taskId: 'SW-124' }))
          .taskEffect,
      ).toBeNull();
    }
  });

  it('ASM §6 mapping for every mapped status from a mirror task', () => {
    const mapping = [
      ['planning', 'planning'],
      ['working', 'in_progress'],
      ['waiting', 'waiting'],
      ['reviewing', 'review'],
      ['failed', 'failed'],
    ] as const;
    for (const [agentStatus, taskStatus] of mapping) {
      const task: Task = { ...taskOf('SW-123'), status: 'assigned' };
      const d = accepted(
        decide(
          { type: 'agent.status.changed', agentId: BE, status: agentStatus, taskId: 'SW-123' },
          { task },
        ),
      );
      expect(d.taskEffect?.op === 'update' && d.taskEffect.patch.status).toBe(taskStatus);
    }
    const working: Task = { ...taskOf('SW-123'), status: 'in_progress', startedAt: isoAt(-1) };
    const done = accepted(
      decide(
        { type: 'agent.status.changed', agentId: BE, status: 'completed', taskId: 'SW-123' },
        { agent: agentIn('working'), task: working },
      ),
    );
    expect(done.taskEffect).toEqual({
      op: 'update',
      id: 'SW-123',
      patch: { status: 'completed', completedAt: NOW, progress: 100 },
    });
  });

  describe('agent.task.assigned', () => {
    it('creates an unknown task (title = metadata.title ?? message ?? taskId) without binding the agent', () => {
      const d = accepted(
        decide({
          type: 'agent.task.assigned',
          agentId: BE,
          taskId: 'SW-900',
          project: 'sellway',
          message: 'From message',
          metadata: { title: '  Title from metadata  ' },
        }),
      );
      expect(d.taskEffect).toEqual({
        op: 'create',
        task: {
          id: 'SW-900',
          title: 'Title from metadata',
          description: null,
          project: 'sellway',
          assignedAgentId: BE,
          status: 'assigned',
          priority: 'normal',
          progress: 0,
          createdAt: NOW,
          startedAt: null,
          completedAt: null,
          blockedBy: [],
          metadata: {},
        },
      });
      expect(d.agentPatch).toEqual({ lastActivityAt: NOW, lastMessage: 'From message' });
      expect(d.event.project).toBe('sellway');
      const fromMessage = accepted(
        decide({
          type: 'agent.task.assigned',
          agentId: BE,
          taskId: 'SW-901',
          project: 'sellway',
          message: 'Msg title',
          metadata: { title: 42 },
        }),
      );
      expect(fromMessage.taskEffect?.op === 'create' && fromMessage.taskEffect.task.title).toBe(
        'Msg title',
      );
      const fromId = accepted(
        decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-902', project: 'sellway' }),
      );
      expect(fromId.taskEffect?.op === 'create' && fromId.taskEffect.task.title).toBe('SW-902');
    });

    it('truncates a long title to 200 characters', () => {
      const d = accepted(
        decide({
          type: 'agent.task.assigned',
          agentId: BE,
          taskId: 'SW-903',
          project: 'sellway',
          message: 'x'.repeat(500),
        }),
      );
      expect(d.taskEffect?.op === 'create' && d.taskEffect.task.title).toBe('x'.repeat(200));
    });

    it('demo-created tasks carry metadata.demo = true', () => {
      const d = accepted(
        decide({
          type: 'agent.task.assigned',
          source: 'demo',
          agentId: BE,
          taskId: 'SW-D5-1b',
          project: 'sellway',
          metadata: { demo: true, title: 'Demo' },
        }),
      );
      expect(d.taskEffect?.op === 'create' && d.taskEffect.task.metadata).toEqual({ demo: true });
      expect(d.event.source).toBe('demo');
    });

    it('unknown task without project → 422 UNKNOWN_TASK (create message)', () => {
      const error = rejected(
        decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-904' }),
      );
      expect(error.status).toBe(422);
      expect(error.code).toBe('UNKNOWN_TASK');
      expect(error.message).toBe('Task SW-904 does not exist; include project to create it');
      expect(error.details).toEqual({ taskId: 'SW-904' });
    });

    it('existing todo task: assignee set and status → assigned; already assigned = no task change', () => {
      const d = accepted(decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-125' }));
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'SW-125',
        patch: { assignedAgentId: BE, status: 'assigned' },
      });
      expect(d.event.project).toBe('sellway');
      const again = accepted(
        decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-123' }),
      );
      expect(again.taskEffect).toBeNull();
    });

    it('always takes the assignee — also from another agent (failed → assigned)', () => {
      const d = accepted(decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'ERP-302' }));
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'ERP-302',
        patch: { assignedAgentId: BE, status: 'assigned' },
      });
      const reassign = accepted(
        decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'ERP-303' }),
      );
      expect(reassign.taskEffect).toEqual({
        op: 'update',
        id: 'ERP-303',
        patch: { assignedAgentId: BE },
      });
    });

    it.each(['in_progress', 'planning', 'waiting', 'review', 'completed', 'cancelled'] as const)(
      'existing %s task → 409 task',
      (status) => {
        const task: Task = {
          ...taskOf('SW-124'),
          status,
          completedAt: status === 'completed' ? NOW : null,
        };
        const error = rejected(
          decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-124' }, { task }),
        );
        expect(error.code).toBe('ILLEGAL_TRANSITION');
        expect(error.message).toBe(`Illegal task transition: ${status} → assigned (task SW-124)`);
        expect(error.details).toEqual({
          entity: 'task',
          id: 'SW-124',
          from: status,
          to: 'assigned',
        });
      },
    );

    it('with an explicit status: binds the agent and maps the task (todo → assigned → in_progress)', () => {
      const d = accepted(
        decide({ type: 'agent.task.assigned', agentId: BE, taskId: 'SW-125', status: 'working' }),
      );
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'SW-125',
        patch: { assignedAgentId: BE, status: 'in_progress', startedAt: NOW },
      });
      expect(d.agentPatch).toMatchObject({
        status: 'working',
        taskId: 'SW-125',
        currentTask: 'Campaign analytics',
      });
    });

    it('with an explicit status on a new task: created directly in the mapped status', () => {
      const d = accepted(
        decide({
          type: 'agent.task.assigned',
          agentId: BE,
          taskId: 'ERP-905',
          project: 'erp',
          status: 'waiting',
          message: 'Blocked task',
        }),
      );
      expect(d.taskEffect?.op === 'create' && d.taskEffect.task.status).toBe('waiting');
      expect(d.agentPatch).toMatchObject({
        status: 'waiting',
        taskId: 'ERP-905',
        currentTask: 'Blocked task',
        currentProject: 'erp',
      });
    });

    it('with an explicit status whose mapped task transition is illegal → 409 task', () => {
      const error = rejected(
        decide({
          type: 'agent.task.assigned',
          agentId: FE,
          taskId: 'SW-906',
          project: 'sellway',
          status: 'completed',
        }),
      );
      expect(error.details).toEqual({
        entity: 'task',
        id: 'SW-906',
        from: 'assigned',
        to: 'completed',
      });
      const existing = rejected(
        decide({ type: 'agent.task.assigned', agentId: FE, taskId: 'SW-125', status: 'completed' }),
      );
      expect(existing.details).toEqual({
        entity: 'task',
        id: 'SW-125',
        from: 'todo',
        to: 'completed',
      });
    });
  });

  describe('agent.task.started', () => {
    it('owned: agent → working, task → in_progress with startedAt', () => {
      const d = accepted(decide({ type: 'agent.task.started', agentId: BE, taskId: 'SW-123' }));
      expect(d.agentPatch).toMatchObject({ status: 'working', taskId: 'SW-123', startedAt: NOW });
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'SW-123',
        patch: { status: 'in_progress', startedAt: NOW },
      });
    });

    it('keeps an existing task startedAt (only the first entry sets it)', () => {
      const task: Task = { ...taskOf('ERP-302'), assignedAgentId: QA };
      const d = accepted(
        decide({ type: 'agent.task.started', agentId: QA, taskId: 'ERP-302' }, { task }),
      );
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'ERP-302',
        patch: { status: 'in_progress' },
      });
    });

    it('claims an unassigned task (todo → in_progress)', () => {
      const d = accepted(decide({ type: 'agent.task.started', agentId: BE, taskId: 'AM-402' }));
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'AM-402',
        patch: { assignedAgentId: BE, status: 'in_progress', startedAt: NOW },
      });
      expect(d.event.project).toBe('ana-market');
      expect(d.agentPatch?.currentProject).toBe('ana-market');
    });

    it('explicit status overrides the agent status; the task still follows the type', () => {
      const d = accepted(
        decide({ type: 'agent.task.started', agentId: BE, taskId: 'SW-123', status: 'planning' }),
      );
      expect(d.agentPatch?.status).toBe('planning');
      expect(d.taskEffect?.op === 'update' && d.taskEffect.patch.status).toBe('in_progress');
    });

    it('non-assignee: agent binds and works, task unchanged', () => {
      const d = accepted(decide({ type: 'agent.task.started', agentId: BE, taskId: 'SW-124' }));
      expect(d.agentPatch).toMatchObject({ status: 'working', taskId: 'SW-124', progress: 40 });
      expect(d.taskEffect).toBeNull();
    });

    it('already in_progress: no task change', () => {
      expect(
        accepted(decide({ type: 'agent.task.started', agentId: FE, taskId: 'SW-124' })).taskEffect,
      ).toBeNull();
    });
  });

  describe('agent.task.progress', () => {
    it('owned: agent and task progress = value; agent status unchanged', () => {
      const d = accepted(
        decide({ type: 'agent.task.progress', agentId: FE, taskId: 'SW-124', progress: 75 }),
      );
      expect(d.agentPatch).toEqual({ progress: 75, lastActivityAt: NOW });
      expect(d.taskEffect).toEqual({ op: 'update', id: 'SW-124', patch: { progress: 75 } });
      expect(d.event.progress).toBe(75);
    });

    it('same progress: no task row change', () => {
      expect(
        accepted(
          decide({ type: 'agent.task.progress', agentId: FE, taskId: 'SW-124', progress: 40 }),
        ).taskEffect,
      ).toBeNull();
    });

    it('claims an unassigned task', () => {
      const d = accepted(
        decide({ type: 'agent.task.progress', agentId: FE, taskId: 'SW-125', progress: 10 }),
      );
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'SW-125',
        patch: { assignedAgentId: FE, progress: 10 },
      });
    });

    it.each(['completed', 'cancelled'] as const)(
      'owned %s task → 409 terminal progress',
      (status) => {
        const task: Task = {
          ...taskOf('IK-201'),
          status,
          completedAt: status === 'completed' ? NOW : null,
        };
        const error = rejected(
          decide(
            { type: 'agent.task.progress', agentId: UX, taskId: 'IK-201', progress: 50 },
            { task },
          ),
        );
        expect(error.status).toBe(409);
        expect(error.message).toBe(`Task IK-201 is ${status}; progress cannot change`);
        expect(error.details).toEqual({ entity: 'task', id: 'IK-201', from: status, to: status });
      },
    );

    it('non-assignee on a terminal task: accepted, task unchanged', () => {
      const d = accepted(
        decide({ type: 'agent.task.progress', agentId: FE, taskId: 'IK-201', progress: 50 }),
      );
      expect(d.taskEffect).toBeNull();
      expect(d.agentPatch?.progress).toBe(50);
    });
  });

  describe('agent.task.completed / agent.task.failed', () => {
    it('completed: agent → completed (progress 100), task → completed with completedAt', () => {
      const d = accepted(decide({ type: 'agent.task.completed', agentId: FE, taskId: 'SW-124' }));
      expect(d.agentPatch).toEqual({
        status: 'completed',
        currentAction: null,
        progress: 100,
        lastActivityAt: NOW,
      });
      expect(d.taskEffect).toEqual({
        op: 'update',
        id: 'SW-124',
        patch: { status: 'completed', completedAt: NOW, progress: 100 },
      });
      expect(d.event.severity).toBe('info');
    });

    it('failed: agent → failed, task → failed, severity error', () => {
      const d = accepted(
        decide({
          type: 'agent.task.failed',
          agentId: FE,
          taskId: 'SW-124',
          message: 'Build broke',
        }),
      );
      expect(d.agentPatch).toMatchObject({ status: 'failed', lastMessage: 'Build broke' });
      expect(d.taskEffect).toEqual({ op: 'update', id: 'SW-124', patch: { status: 'failed' } });
      expect(d.event.severity).toBe('error');
    });

    it('the agent is checked before the task (idle → completed fails on the agent)', () => {
      const error = rejected(
        decide({ type: 'agent.task.completed', agentId: BE, taskId: 'SW-123' }),
      );
      expect(error.details).toEqual({ entity: 'agent', id: BE, from: 'idle', to: 'completed' });
    });

    it('a legal agent transition with an illegal task transition → 409 task', () => {
      const error = rejected(
        decide({ type: 'agent.task.completed', agentId: AIE, taskId: 'IK-203', status: 'failed' }),
      );
      expect(error.message).toBe('Illegal task transition: planning → completed (task IK-203)');
    });
  });

  describe('system.*', () => {
    it.each(['system.info', 'system.warning', 'system.error'] as const)(
      '%s never patches agents or tasks',
      (type) => {
        const d = accepted(
          decide({ type, message: 'Disk almost full', agentId: FE, taskId: 'SW-124' }),
        );
        expect(d.agentPatch).toBeNull();
        expect(d.taskEffect).toBeNull();
        expect(d.forced).toEqual([]);
        expect(d.event).toMatchObject({
          type,
          agentId: FE,
          taskId: 'SW-124',
          project: 'sellway',
          status: null,
          progress: null,
        });
      },
    );

    it('project-less system event stays project-less', () => {
      const d = accepted(decide({ type: 'system.warning', message: 'Queue lag' }));
      expect(d.event).toMatchObject({
        project: null,
        agentId: null,
        severity: 'warning',
        source: 'api',
      });
    });

    it('derives the project from the agent when no task/project is given', () => {
      expect(
        accepted(decide({ type: 'system.info', message: 'x', agentId: QA })).event.project,
      ).toBe('erp');
    });

    it('PROJECT_MISMATCH applies to system events too', () => {
      expect(
        rejected(decide({ type: 'system.error', message: 'x', taskId: 'SW-124', project: 'erp' }))
          .code,
      ).toBe('PROJECT_MISMATCH');
    });

    it('never rejects for an unknown task id', () => {
      expect(
        accepted(decide({ type: 'system.error', message: 'x', taskId: 'NOPE-1' })).event.taskId,
      ).toBe('NOPE-1');
    });
  });
});

describe('rejections (422 before 409)', () => {
  it.each(['agent.task.started', 'agent.task.completed', 'agent.task.failed'] as const)(
    '%s with an unknown task → 422 UNKNOWN_TASK',
    (type) => {
      const error = rejected(decide({ type, agentId: BE, taskId: 'SW-999' }));
      expect(error.status).toBe(422);
      expect(error.message).toBe('Unknown task: SW-999');
      expect(error.details).toEqual({ taskId: 'SW-999' });
    },
  );

  it('agent.task.progress with an unknown task → 422 even if the agent transition is illegal', () => {
    const error = rejected(
      decide({
        type: 'agent.task.progress',
        agentId: OPS,
        taskId: 'SW-999',
        progress: 5,
        status: 'working',
      }),
    );
    expect(error.code).toBe('UNKNOWN_TASK');
  });

  it('PROJECT_MISMATCH: explicit project ≠ existing task project (before agent legality)', () => {
    const error = rejected(
      decide({
        type: 'agent.status.changed',
        agentId: BE,
        status: 'completed',
        taskId: 'SW-123',
        project: 'erp',
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe('PROJECT_MISMATCH');
    expect(error.message).toBe('Task SW-123 belongs to project sellway, not erp');
    expect(error.details).toEqual({
      taskId: 'SW-123',
      taskProject: 'sellway',
      eventProject: 'erp',
    });
  });

  it('offline agent cannot work (REQ-011)', () => {
    const error = rejected(
      decide({ type: 'agent.status.changed', agentId: OPS, status: 'working' }),
    );
    expect(error.message).toBe('Illegal transition: offline → working');
  });

  it('a missing agent for an agent event is UNKNOWN_AGENT (defensive)', () => {
    expect(
      rejected(
        decide({ type: 'agent.activity', agentId: '99-ghost', action: 'x' }, { agent: null }),
      ).code,
    ).toBe('UNKNOWN_AGENT');
  });

  it('a task that does not match input.taskId is a programming error', () => {
    expect(() =>
      decide(
        { type: 'agent.activity', agentId: BE, action: 'x', taskId: 'SW-124' },
        { task: taskOf('SW-123') },
      ),
    ).toThrow();
  });
});

describe('ownership, claiming and implicit assignment (ADR-017)', () => {
  it('Reviewer reviewing Backend’s task leaves the task unchanged', () => {
    const d = accepted(
      decide({ type: 'agent.status.changed', agentId: REV, status: 'reviewing', taskId: 'SW-123' }),
    );
    expect(d.taskEffect).toBeNull();
    expect(d.event.project).toBe('sellway');
  });

  it('a generic event with a status change claims an unassigned todo task validated from assigned', () => {
    const d = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'waiting', taskId: 'SW-125' }),
    );
    expect(d.taskEffect).toEqual({
      op: 'update',
      id: 'SW-125',
      patch: { assignedAgentId: BE, status: 'waiting' },
    });
    const review = accepted(
      decide({ type: 'agent.status.changed', agentId: BE, status: 'reviewing', taskId: 'AM-402' }),
    );
    expect(review.taskEffect).toEqual({
      op: 'update',
      id: 'AM-402',
      patch: { assignedAgentId: BE, status: 'review' },
    });
  });

  it('a generic event without a status change does not claim', () => {
    expect(
      accepted(
        decide({ type: 'agent.activity', agentId: BE, action: 'read_file', taskId: 'SW-125' }),
      ).taskEffect,
    ).toBeNull();
  });

  it('409 for a claimed todo task reports the stored status', () => {
    const error = rejected(decide({ type: 'agent.task.completed', agentId: FE, taskId: 'SW-125' }));
    expect(error.details).toEqual({ entity: 'task', id: 'SW-125', from: 'todo', to: 'completed' });
  });

  it('a completed task cannot be restarted by its owner (ASM §6 exception)', () => {
    const error = rejected(
      decide({ type: 'agent.status.changed', agentId: UX, status: 'working', taskId: 'IK-201' }),
    );
    expect(error.details).toEqual({
      entity: 'task',
      id: 'IK-201',
      from: 'completed',
      to: 'in_progress',
    });
  });
});

describe('force (ADR-015)', () => {
  it('forces both an illegal agent and an illegal task transition, with side effects', () => {
    const d = accepted(
      decide(
        { type: 'agent.status.changed', agentId: BE, status: 'completed', taskId: 'SW-123' },
        { force: true },
      ),
    );
    expect(d.forced).toEqual([
      { entity: 'agent', id: BE, from: 'idle', to: 'completed' },
      { entity: 'task', id: 'SW-123', from: 'assigned', to: 'completed' },
    ]);
    expect(d.event.forced).toBe(true);
    expect(d.agentPatch).toMatchObject({ status: 'completed', progress: 100 });
    expect(d.taskEffect).toEqual({
      op: 'update',
      id: 'SW-123',
      patch: { status: 'completed', completedAt: NOW, progress: 100 },
    });
  });

  it('forced: false when the transition was legal anyway', () => {
    const d = accepted(
      decide(
        { type: 'agent.status.changed', agentId: BE, status: 'working', taskId: 'SW-123' },
        { force: true },
      ),
    );
    expect(d.forced).toEqual([]);
    expect(d.event.forced).toBe(false);
  });

  it('reopens a terminal task (completed → in_progress clears completedAt, keeps startedAt)', () => {
    const d = accepted(
      decide(
        { type: 'agent.status.changed', agentId: UX, status: 'working', taskId: 'IK-201' },
        { force: true },
      ),
    );
    expect(d.forced).toEqual([
      { entity: 'task', id: 'IK-201', from: 'completed', to: 'in_progress' },
    ]);
    expect(d.taskEffect).toEqual({
      op: 'update',
      id: 'IK-201',
      patch: { status: 'in_progress', completedAt: null },
    });
  });

  it('offline → working with force sets online and startedAt', () => {
    const d = accepted(
      decide({ type: 'agent.status.changed', agentId: OPS, status: 'working' }, { force: true }),
    );
    expect(d.agentPatch).toMatchObject({ status: 'working', online: true, startedAt: NOW });
    expect(agentInvariantViolations({ ...agentOf(OPS), ...d.agentPatch })).toEqual([]);
  });

  it('does not bypass existence or project checks', () => {
    expect(
      rejected(
        decide({ type: 'agent.task.started', agentId: BE, taskId: 'SW-999' }, { force: true }),
      ).code,
    ).toBe('UNKNOWN_TASK');
    expect(
      rejected(
        decide(
          {
            type: 'agent.status.changed',
            agentId: BE,
            status: 'working',
            taskId: 'SW-123',
            project: 'erp',
          },
          { force: true },
        ),
      ).code,
    ).toBe('PROJECT_MISMATCH');
  });

  it('does not bypass ownership: a forced non-assignee leaves the task alone', () => {
    const d = accepted(
      decide(
        { type: 'agent.status.changed', agentId: REV, status: 'completed', taskId: 'IK-201' },
        { force: true },
      ),
    );
    expect(d.taskEffect).toBeNull();
    expect(d.forced).toEqual([{ entity: 'agent', id: REV, from: 'idle', to: 'completed' }]);
  });

  it('force on terminal progress records a forced task entry', () => {
    const d = accepted(
      decide(
        { type: 'agent.task.progress', agentId: UX, taskId: 'IK-201', progress: 90 },
        { force: true },
      ),
    );
    expect(d.forced).toEqual([
      { entity: 'task', id: 'IK-201', from: 'completed', to: 'completed' },
    ]);
    expect(d.taskEffect).toEqual({ op: 'update', id: 'IK-201', patch: { progress: 90 } });
  });
});

describe('sequences through the service emulation', () => {
  it('REQ-191 steps: idle → working → idle → working again', () => {
    const state = createBaselineState();
    const first = ingest(state, {
      type: 'agent.activity',
      agentId: BE,
      project: 'sellway',
      taskId: 'SW-123',
      status: 'working',
      action: 'run_command',
    });
    expect(first.kind).toBe('accept');
    expect(state.agents.get(BE)?.version).toBe(2);
    expect(state.tasks.get('SW-123')?.status).toBe('in_progress');
    expect(ingest(state, { type: 'agent.status.changed', agentId: BE, status: 'idle' }).kind).toBe(
      'accept',
    );
    expect(state.agents.get(BE)).toMatchObject({ status: 'idle', taskId: null, progress: 0 });
    expect(state.tasks.get('SW-123')?.status).toBe('in_progress'); // idle leaves the task
    expect(
      ingest(state, {
        type: 'agent.activity',
        agentId: BE,
        taskId: 'SW-123',
        status: 'working',
        action: 'test',
      }).kind,
    ).toBe('accept');
    expect(state.agents.get(BE)).toMatchObject({
      status: 'working',
      taskId: 'SW-123',
      currentAction: 'test',
    });
  });

  it('every baseline agent and task satisfies the invariants', () => {
    const state = createBaselineState();
    expect([...state.agents.values()].flatMap(agentInvariantViolations)).toEqual([]);
    expect([...state.tasks.values()].flatMap(taskInvariantViolations)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Property test: ≥ 1 000 random sequences from a seeded PRNG starting at the API_CONTRACTS §7 baseline.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFrom<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('empty pick');
  return item;
}

const STATUS_TYPES = new Set([
  'agent.status.changed',
  'agent.activity',
  'agent.message',
  'agent.task.assigned',
  'agent.task.started',
  'agent.task.progress',
  'agent.task.completed',
  'agent.task.failed',
]);
const TASK_REQUIRED = new Set([
  'agent.task.assigned',
  'agent.task.started',
  'agent.task.progress',
  'agent.task.completed',
  'agent.task.failed',
]);

function randomInput(rand: () => number, state: OfficeState): Record<string, unknown> {
  const type = pickFrom(rand, PRODUCER_EVENT_TYPES);
  const raw: Record<string, unknown> = {
    type,
    source: pickFrom(rand, ['api', 'simulator', 'demo']),
  };
  const isSystem = type.startsWith('system.');
  if (!isSystem || rand() < 0.5) raw.agentId = pickFrom(rand, AGENT_IDS);
  const taskIds = [...state.tasks.keys(), 'RND-1', 'RND-2', 'RND-3'];
  if (TASK_REQUIRED.has(type) || rand() < 0.4) raw.taskId = pickFrom(rand, taskIds);
  if (type === 'agent.status.changed' || (STATUS_TYPES.has(type) && rand() < 0.4)) {
    raw.status = pickFrom(rand, AGENT_STATUSES);
  }
  if (type === 'agent.task.progress' || (STATUS_TYPES.has(type) && rand() < 0.25)) {
    raw.progress = Math.floor(rand() * 101);
  }
  if (type === 'agent.activity' || rand() < 0.3)
    raw.action = pickFrom(rand, ['read_file', 'test', 'build']);
  if (type === 'agent.message' || isSystem || rand() < 0.3) raw.message = 'random message';
  if (rand() < 0.5) {
    const task = typeof raw.taskId === 'string' ? state.tasks.get(raw.taskId) : undefined;
    raw.project = task !== undefined && rand() < 0.8 ? task.project : pickFrom(rand, PROJECT_IDS);
  }
  if (rand() < 0.1) raw.severity = pickFrom(rand, ['info', 'warning', 'error']);
  return raw;
}

describe('property: ASM §4 invariants over random event sequences', () => {
  it('1 000 seeded sequences × 30 events keep every invariant and every rule', () => {
    const SEQUENCES = 1_000;
    const LENGTH = 30;
    const violations: string[] = [];
    let acceptedCount = 0;
    let rejectedCount = 0;
    let forcedCount = 0;
    let taskWrites = 0;

    for (let seq = 0; seq < SEQUENCES && violations.length < 20; seq += 1) {
      const rand = mulberry32(0x5eed + seq);
      const state = createBaselineState();
      for (let step = 0; step < LENGTH; step += 1) {
        const raw = randomInput(rand, state);
        const parsed = eventInputSchema.safeParse(raw);
        if (!parsed.success) {
          violations.push(`generator produced an invalid input: ${JSON.stringify(raw)}`);
          continue;
        }
        const input = parsed.data;
        const force = input.type === 'agent.status.changed' && rand() < 0.1;
        const before = {
          agent: input.agentId === undefined ? undefined : state.agents.get(input.agentId),
          task: input.taskId === undefined ? undefined : state.tasks.get(input.taskId),
        };
        const where = `seq ${seq} step ${step} ${JSON.stringify(raw)}`;
        const decision = ingest(state, input, { force });
        if (decision.kind === 'reject') {
          rejectedCount += 1;
          if (
            !['ILLEGAL_TRANSITION', 'UNKNOWN_TASK', 'PROJECT_MISMATCH'].includes(
              decision.error.code,
            )
          ) {
            violations.push(`${where}: unexpected rejection ${decision.error.code}`);
          }
          continue;
        }
        acceptedCount += 1;
        if (decision.forced.length > 0) forcedCount += 1;
        if (decision.event.forced !== decision.forced.length > 0)
          violations.push(`${where}: forced flag`);
        if (!force && decision.forced.length > 0) violations.push(`${where}: forced without force`);
        if (decision.event.project !== null && !PROJECT_IDS.includes(decision.event.project)) {
          violations.push(`${where}: event project ${decision.event.project}`);
        }
        if (input.type.startsWith('system.')) {
          if (decision.agentPatch !== null || decision.taskEffect !== null)
            violations.push(`${where}: system patched`);
          continue;
        }
        const agentAfter = state.agents.get(input.agentId ?? '');
        if (before.agent === undefined || agentAfter === undefined) {
          violations.push(`${where}: agent missing`);
          continue;
        }
        violations.push(...agentInvariantViolations(agentAfter).map((v) => `${where}: ${v}`));
        if (agentAfter.lastActivityAt === before.agent.lastActivityAt)
          violations.push(`${where}: lastActivityAt`);
        const agentForced = decision.forced.some((f) => f.entity === 'agent');
        if (
          agentAfter.status !== before.agent.status &&
          !agentForced &&
          !canTransitionAgent(before.agent.status, agentAfter.status)
        ) {
          violations.push(`${where}: illegal agent transition accepted`);
        }
        const effect = decision.taskEffect;
        if (effect !== null) {
          taskWrites += 1;
          const taskAfter = state.tasks.get(effect.op === 'create' ? effect.task.id : effect.id);
          if (taskAfter === undefined) {
            violations.push(`${where}: task missing`);
            continue;
          }
          violations.push(...taskInvariantViolations(taskAfter).map((v) => `${where}: ${v}`));
          if (taskAfter.assignedAgentId !== input.agentId)
            violations.push(`${where}: task changed for a non-owner`);
          const taskForced = decision.forced.some((f) => f.entity === 'task');
          if (
            before.task !== undefined &&
            before.task.assignedAgentId !== null &&
            before.task.assignedAgentId !== input.agentId &&
            input.type !== 'agent.task.assigned'
          ) {
            violations.push(`${where}: non-assignee changed the task`);
          }
          if (
            before.task !== undefined &&
            taskAfter.status !== before.task.status &&
            !taskForced &&
            !canTransitionTask(before.task.status, taskAfter.status, { owned: true })
          ) {
            violations.push(`${where}: illegal task transition accepted`);
          }
        }
      }
    }

    expect(violations.slice(0, 20)).toEqual([]);
    // The generator must exercise both outcomes and the interesting paths.
    expect(acceptedCount).toBeGreaterThan(5_000);
    expect(rejectedCount).toBeGreaterThan(1_000);
    expect(forcedCount).toBeGreaterThan(50);
    expect(taskWrites).toBeGreaterThan(1_000);
  });
});
