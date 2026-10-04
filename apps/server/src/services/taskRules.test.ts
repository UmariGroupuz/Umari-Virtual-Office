import { taskCreateSchema, taskPatchSchema, type Task, type TaskStatus } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import { checkSelfBlock, decideTaskCreate, decideTaskPatch, jsonEqual } from './taskRules';
import { baselineTasks, deepFreeze, isoAt } from './testHarness';

const NOW = isoAt(0);
const tasks = new Map(baselineTasks().map((task) => [task.id, task]));

function taskOf(id: string, overrides: Partial<Task> = {}): Task {
  const task = tasks.get(id);
  if (task === undefined) throw new Error(`no task ${id}`);
  return deepFreeze({ ...task, ...overrides });
}

function patch(task: Task, body: Record<string, unknown>) {
  return decideTaskPatch({ task, body: deepFreeze(taskPatchSchema.parse(body)), now: NOW });
}

function acceptedPatch(task: Task, body: Record<string, unknown>) {
  const decision = patch(task, body);
  if (decision.kind !== 'accept') throw new Error(`expected accept, got ${decision.kind}`);
  return decision;
}

function rejectedPatch(task: Task, body: Record<string, unknown>) {
  const decision = patch(task, body);
  if (decision.kind !== 'reject') throw new Error(`expected reject, got ${decision.kind}`);
  return decision.error;
}

describe('decideTaskCreate (API_CONTRACTS §3.9, ADR-024)', () => {
  it('builds the task (version-less NewTask) and the task.created event', () => {
    const body = taskCreateSchema.parse({
      title: 'Refund flow',
      project: 'Sellway',
      assignedAgentId: '04-backend-engineer',
      priority: 'high',
      blockedBy: ['SW-123', 'SW-124', 'SW-123'],
      metadata: { epic: 'payments' },
      description: 'Refunds',
    });
    const decision = decideTaskCreate({ body, projectId: 'sellway', id: 'SW-126', now: NOW });
    expect(decision).toEqual({
      kind: 'accept',
      task: {
        id: 'SW-126',
        title: 'Refund flow',
        description: 'Refunds',
        project: 'sellway',
        assignedAgentId: '04-backend-engineer',
        status: 'assigned',
        priority: 'high',
        progress: 0,
        createdAt: NOW,
        startedAt: null,
        completedAt: null,
        blockedBy: ['SW-123', 'SW-124'],
        metadata: { epic: 'payments' },
      },
      event: {
        type: 'task.created',
        source: 'api',
        agentId: '04-backend-engineer',
        project: 'sellway',
        taskId: 'SW-126',
        status: 'assigned',
        action: null,
        message: 'Task created: Refund flow',
        severity: 'info',
        progress: null,
        metadata: {},
        occurredAt: null,
        forced: false,
      },
    });
  });

  it('defaults: todo, normal, no assignee, empty lists', () => {
    const body = taskCreateSchema.parse({ title: 'Docs', project: 'erp' });
    const decision = decideTaskCreate({ body, projectId: 'erp', id: 'ERP-304', now: NOW });
    expect(decision.kind === 'accept' && decision.task).toMatchObject({
      status: 'todo',
      priority: 'normal',
      assignedAgentId: null,
      description: null,
      blockedBy: [],
      metadata: {},
    });
    expect(decision.kind === 'accept' && decision.event.agentId).toBeNull();
  });

  it('rejects a generated id that appears in blockedBy (400)', () => {
    const body = taskCreateSchema.parse({ title: 'x', project: 'erp', blockedBy: ['ERP-304'] });
    const decision = decideTaskCreate({ body, projectId: 'erp', id: 'ERP-304', now: NOW });
    expect(decision.kind).toBe('reject');
    if (decision.kind === 'reject') {
      expect(decision.error.status).toBe(400);
      expect(decision.error.code).toBe('VALIDATION_ERROR');
      expect(decision.error.message).toBe(
        'Validation failed: blockedBy: A task cannot block itself',
      );
      expect(decision.error.details).toEqual([
        { path: 'blockedBy', message: 'A task cannot block itself' },
      ]);
    }
  });
});

describe('self-block check (TASK-002 REQUIRED, ADR-030 item 7)', () => {
  it('checkSelfBlock is null without blockedBy or without the own id', () => {
    expect(checkSelfBlock('SW-123', {})).toBeNull();
    expect(checkSelfBlock('SW-123', { blockedBy: ['SW-124'] })).toBeNull();
    expect(checkSelfBlock('SW-123', { blockedBy: ['sw-123'] })).toBeNull(); // ids are case-sensitive
  });

  it('PATCH with the own id in blockedBy → 400 with the contract issue', () => {
    const error = rejectedPatch(taskOf('SW-124'), { blockedBy: ['SW-123', 'SW-124'] });
    expect(error.status).toBe(400);
    expect(error.message).toBe('Validation failed: blockedBy: A task cannot block itself');
    expect(error.details).toEqual([{ path: 'blockedBy', message: 'A task cannot block itself' }]);
  });

  it('the self-block 400 wins over the no-op and over legality', () => {
    const task = taskOf('IK-202'); // blockedBy ['IK-203'], waiting
    expect(rejectedPatch(task, { blockedBy: ['IK-202'], status: 'completed' }).code).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('decideTaskPatch — no-op detection', () => {
  it.each([
    ['same title', { title: 'Lost Goods API' }],
    ['same title padded', { title: '  Lost Goods API  ' }],
    ['same status', { status: 'assigned' }],
    ['same assignee', { assignedAgentId: '04-backend-engineer' }],
    ['same priority + progress', { priority: 'high', progress: 0 }],
    ['same empty blockedBy', { blockedBy: [] }],
    ['same metadata', { metadata: {} }],
    ['force alone with same values', { status: 'assigned', force: true }],
  ])('%s → noop', (_name, body) => {
    expect(patch(taskOf('SW-123'), body)).toEqual({ kind: 'noop' });
  });

  it('deep equality for arrays and objects (key order irrelevant, array order relevant)', () => {
    const task = taskOf('IK-202', { metadata: { a: 1, nested: { b: [1, 2] } } });
    expect(patch(task, { metadata: { nested: { b: [1, 2] }, a: 1 } })).toEqual({ kind: 'noop' });
    expect(patch(task, { metadata: { a: 1, nested: { b: [2, 1] } } }).kind).toBe('accept');
    expect(patch(task, { blockedBy: ['IK-203', 'IK-203'] })).toEqual({ kind: 'noop' }); // deduplicated
  });

  it('clearing an already empty description is a no-op; clearing a set one is not', () => {
    const empty = taskOf('SW-125', { description: null });
    expect(patch(empty, { description: '' })).toEqual({ kind: 'noop' });
    expect(patch(empty, { description: null })).toEqual({ kind: 'noop' });
    const cleared = acceptedPatch(taskOf('SW-125'), { description: null });
    expect(cleared.patch).toEqual({ description: null });
  });

  it('progress on a terminal task equal to the stored value is a no-op (not 409)', () => {
    expect(patch(taskOf('IK-201'), { progress: 100 })).toEqual({ kind: 'noop' });
    expect(patch(taskOf('IK-201'), { status: 'completed' })).toEqual({ kind: 'noop' });
  });
});

describe('decideTaskPatch — auto-status (ADR-024)', () => {
  it('assignee set on a todo task → assigned', () => {
    const d = acceptedPatch(taskOf('SW-125'), { assignedAgentId: '02-product-analyst' });
    expect(d.patch).toEqual({ assignedAgentId: '02-product-analyst', status: 'assigned' });
    expect(d.event.status).toBe('assigned');
    expect(d.event.agentId).toBe('02-product-analyst');
  });

  it('assignee cleared on an assigned task → todo', () => {
    const d = acceptedPatch(taskOf('SW-123'), { assignedAgentId: null });
    expect(d.patch).toEqual({ assignedAgentId: null, status: 'todo' });
    expect(d.event.agentId).toBeNull();
  });

  it.each([
    ['SW-124', { assignedAgentId: '04-backend-engineer' }],
    ['SW-124', { assignedAgentId: null }],
    ['ERP-302', { assignedAgentId: null }],
  ] as const)('other combinations leave the status (%s)', (id, body) => {
    const d = acceptedPatch(taskOf(id), body);
    expect(d.patch).not.toHaveProperty('status');
    expect(d.event.status).toBeNull();
  });

  it('no auto-status when the body has a status', () => {
    const d = acceptedPatch(taskOf('SW-125'), {
      assignedAgentId: '02-product-analyst',
      status: 'planning',
    });
    expect(d.patch).toEqual({ assignedAgentId: '02-product-analyst', status: 'planning' });
  });
});

describe('decideTaskPatch — legality, implicit assignment and side effects', () => {
  it('illegal status → 409 with the task message', () => {
    const error = rejectedPatch(taskOf('SW-123'), { status: 'completed' });
    expect(error.status).toBe(409);
    expect(error.message).toBe('Illegal task transition: assigned → completed (task SW-123)');
    expect(error.details).toEqual({
      entity: 'task',
      id: 'SW-123',
      from: 'assigned',
      to: 'completed',
    });
  });

  it('todo → waiting is legal only with an assignee after the update (implicit assignment)', () => {
    const unowned = rejectedPatch(taskOf('SW-125'), { status: 'waiting' });
    expect(unowned.details).toEqual({ entity: 'task', id: 'SW-125', from: 'todo', to: 'waiting' });
    const owned = acceptedPatch(taskOf('SW-125'), {
      status: 'waiting',
      assignedAgentId: '04-backend-engineer',
    });
    expect(owned.patch).toEqual({ status: 'waiting', assignedAgentId: '04-backend-engineer' });
  });

  it('first entry into in_progress sets startedAt; a later entry keeps it', () => {
    expect(acceptedPatch(taskOf('SW-123'), { status: 'in_progress' }).patch).toEqual({
      status: 'in_progress',
      startedAt: NOW,
    });
    expect(acceptedPatch(taskOf('ERP-302'), { status: 'in_progress' }).patch).toEqual({
      status: 'in_progress',
    });
  });

  it('entering completed sets completedAt and progress 100, ignoring the body progress', () => {
    const d = acceptedPatch(taskOf('SW-124'), { status: 'completed', progress: 10 });
    expect(d.patch).toEqual({ status: 'completed', completedAt: NOW, progress: 100 });
    expect(d.event).toMatchObject({ status: 'completed', progress: 100 });
    expect(d.event.metadata).toEqual({ changes: ['completedAt', 'progress', 'status'] });
  });

  it.each(['completed', 'cancelled'] as const)(
    'every move out of %s is 409 without force',
    (from) => {
      const task = taskOf('SW-124', {
        status: from,
        completedAt: from === 'completed' ? NOW : null,
      });
      const targets: TaskStatus[] = [
        'todo',
        'assigned',
        'planning',
        'in_progress',
        'waiting',
        'review',
        'failed',
      ];
      for (const to of targets) {
        expect(rejectedPatch(task, { status: to }).code).toBe('ILLEGAL_TRANSITION');
      }
    },
  );

  it('terminal progress: 409 for the current terminal status', () => {
    const error = rejectedPatch(taskOf('IK-201'), { progress: 50 });
    expect(error.status).toBe(409);
    expect(error.message).toBe('Task IK-201 is completed; progress cannot change');
    expect(error.details).toEqual({
      entity: 'task',
      id: 'IK-201',
      from: 'completed',
      to: 'completed',
    });
  });

  it('terminal progress: 409 for the resulting terminal status', () => {
    const error = rejectedPatch(taskOf('SW-124'), { status: 'cancelled', progress: 50 });
    expect(error.message).toBe('Task SW-124 is cancelled; progress cannot change');
  });

  it('other fields stay editable on a terminal task', () => {
    const d = acceptedPatch(taskOf('IK-201'), { title: 'Vacancy posting v2', priority: 'high' });
    expect(d.patch).toEqual({ title: 'Vacancy posting v2', priority: 'high' });
    expect(d.event.message).toBe('Task updated: Vacancy posting v2');
    expect(d.event.metadata).toEqual({ changes: ['priority', 'title'] });
    expect(d.event).toMatchObject({ status: null, progress: null, forced: false });
  });
});

describe('decideTaskPatch — force (ADR-015)', () => {
  it('reopens a completed task: completedAt cleared, startedAt kept, forced entry', () => {
    const d = acceptedPatch(taskOf('IK-201'), { status: 'in_progress', force: true });
    expect(d.patch).toEqual({ status: 'in_progress', completedAt: null });
    expect(d.forced).toEqual({
      entity: 'task',
      id: 'IK-201',
      from: 'completed',
      to: 'in_progress',
    });
    expect(d.event.forced).toBe(true);
  });

  it('a legal transition with force is not forced', () => {
    const d = acceptedPatch(taskOf('SW-123'), { status: 'in_progress', force: true });
    expect(d.forced).toBeNull();
    expect(d.event.forced).toBe(false);
  });

  it('progress on a terminal task with force', () => {
    const d = acceptedPatch(taskOf('IK-201'), { progress: 60, force: true });
    expect(d.patch).toEqual({ progress: 60 });
    expect(d.forced).toEqual({ entity: 'task', id: 'IK-201', from: 'completed', to: 'completed' });
  });

  it('a forced status change keeps its own forced entry when progress is forced too', () => {
    const d = acceptedPatch(taskOf('IK-201'), { status: 'cancelled', progress: 10, force: true });
    expect(d.forced).toEqual({ entity: 'task', id: 'IK-201', from: 'completed', to: 'cancelled' });
    expect(d.patch).toEqual({ status: 'cancelled', progress: 10, completedAt: null });
  });
});

describe('decideTaskPatch — task.updated event', () => {
  it('has the contracted shape', () => {
    const d = acceptedPatch(taskOf('SW-124'), {
      status: 'review',
      progress: 90,
      blockedBy: ['SW-125'],
      metadata: { pr: 12 },
    });
    expect(d.event).toEqual({
      type: 'task.updated',
      source: 'api',
      agentId: '05-frontend-engineer',
      project: 'sellway',
      taskId: 'SW-124',
      status: 'review',
      action: null,
      message: 'Task updated: Dashboard performance optimization',
      severity: 'info',
      progress: 90,
      metadata: { changes: ['blockedBy', 'metadata', 'progress', 'status'] },
      occurredAt: null,
      forced: false,
    });
    expect(d.patch).toEqual({
      status: 'review',
      progress: 90,
      blockedBy: ['SW-125'],
      metadata: { pr: 12 },
    });
  });
});

describe('jsonEqual', () => {
  it.each([
    [1, 1, true],
    ['a', 'a', true],
    [null, null, true],
    [null, {}, false],
    [[1, 2], [1, 2], true],
    [[1, 2], [2, 1], false],
    [[1], { 0: 1 }, false],
    [{ a: 1, b: 2 }, { b: 2, a: 1 }, true],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [{ a: { b: [true] } }, { a: { b: [true] } }, true],
  ] as const)('%j vs %j → %s', (a, b, expected) => {
    expect(jsonEqual(a as never, b as never)).toBe(expected);
  });
});
