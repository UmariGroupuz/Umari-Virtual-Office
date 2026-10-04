import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { agentStatusPatchSchema } from './agent';
import { demoStartSchema, demoStopSchema } from './demo';
import { toValidationIssues } from './issues';
import { taskCreateSchema, taskPatchSchema } from './task';

function issuesOf(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  if (result.success) throw new Error(`expected failure, got ${JSON.stringify(result.data)}`);
  return toValidationIssues(result.error);
}

describe('agentStatusPatchSchema (§3.5)', () => {
  it('applies defaults: source "api", force false', () => {
    expect(agentStatusPatchSchema.parse({ status: 'working' })).toStrictEqual({
      status: 'working',
      source: 'api',
      force: false,
    });
    expect(
      agentStatusPatchSchema.parse({ status: 'idle', source: null, force: null }),
    ).toStrictEqual({
      status: 'idle',
      source: 'api',
      force: false,
    });
    expect(agentStatusPatchSchema.parse({ status: 'idle', source: '  ' })).toMatchObject({
      source: 'api',
    });
  });

  it('accepts the simulator payload and every optional field', () => {
    const body = {
      status: 'completed',
      source: 'simulator',
      project: 'Sellway',
      taskId: 'SW-123',
      action: 'test',
      message: 'Done',
      force: true,
    };
    expect(agentStatusPatchSchema.parse(body)).toStrictEqual(body);
  });

  it('trims strings and drops blank/null optional fields', () => {
    expect(
      agentStatusPatchSchema.parse({
        status: 'working',
        source: ' simulator ',
        project: ' ',
        taskId: null,
        action: '',
        message: null,
      }),
    ).toStrictEqual({ status: 'working', source: 'simulator', force: false });
  });

  it.each(['demo', 'system'])('reserved source %s → 400', (source) => {
    expect(issuesOf(agentStatusPatchSchema, { status: 'idle', source })).toEqual([
      { path: 'source', message: `Source "${source}" is reserved` },
    ]);
  });

  it('status is required and must be an agent status', () => {
    expect(issuesOf(agentStatusPatchSchema, {}).map((i) => i.path)).toEqual(['status']);
    expect(issuesOf(agentStatusPatchSchema, { status: 'in_progress' }).map((i) => i.path)).toEqual([
      'status',
    ]);
  });

  it('limits: action 101, message 2001, taskId pattern, force type, unknown key', () => {
    const issues = issuesOf(agentStatusPatchSchema, {
      status: 'idle',
      action: 'a'.repeat(101),
      message: 'm'.repeat(2001),
      taskId: 'bad id',
      force: 'yes',
      foo: 1,
    });
    expect(issues.map((i) => i.path).sort()).toEqual(
      ['action', 'force', 'foo', 'message', 'taskId'].sort(),
    );
    expect(issues).toContainEqual({ path: 'foo', message: 'Unrecognized key' });
  });
});

describe('taskCreateSchema (§3.9, ADR-024)', () => {
  it('applies defaults (status todo without assignee)', () => {
    expect(taskCreateSchema.parse({ title: ' Lost Goods API ', project: 'Sellway' })).toStrictEqual(
      {
        title: 'Lost Goods API',
        description: null,
        project: 'Sellway',
        assignedAgentId: null,
        priority: 'normal',
        status: 'todo',
        blockedBy: [],
        metadata: {},
      },
    );
  });

  it('defaults status to assigned when an assignee is given', () => {
    expect(
      taskCreateSchema.parse({
        title: 'T',
        project: 'erp',
        assignedAgentId: '04-backend-engineer',
      }),
    ).toMatchObject({ status: 'assigned', assignedAgentId: '04-backend-engineer' });
  });

  it('keeps every provided field and dedupes blockedBy in order', () => {
    expect(
      taskCreateSchema.parse({
        id: 'SW-200',
        title: 'T',
        description: 'D',
        project: 'sellway',
        assignedAgentId: 'a',
        priority: 'critical',
        status: 'assigned',
        blockedBy: ['SW-2', 'SW-1', 'SW-2', ' SW-1 '],
        metadata: { k: 1 },
      }),
    ).toStrictEqual({
      id: 'SW-200',
      title: 'T',
      description: 'D',
      project: 'sellway',
      assignedAgentId: 'a',
      priority: 'critical',
      status: 'assigned',
      blockedBy: ['SW-2', 'SW-1'],
      metadata: { k: 1 },
    });
  });

  it('null/blank optionals are defaults', () => {
    expect(
      taskCreateSchema.parse({
        id: null,
        title: 'T',
        project: 'erp',
        description: '  ',
        assignedAgentId: null,
        priority: null,
        status: null,
        blockedBy: null,
        metadata: null,
      }),
    ).toStrictEqual({
      title: 'T',
      description: null,
      project: 'erp',
      assignedAgentId: null,
      priority: 'normal',
      status: 'todo',
      blockedBy: [],
      metadata: {},
    });
  });

  it('status "assigned" without assignee → 400 at status', () => {
    expect(issuesOf(taskCreateSchema, { title: 'T', project: 'erp', status: 'assigned' })).toEqual([
      { path: 'status', message: 'Status "assigned" requires assignedAgentId' },
    ]);
  });

  it('status "todo" with an assignee → 400 at status', () => {
    expect(
      issuesOf(taskCreateSchema, {
        title: 'T',
        project: 'erp',
        status: 'todo',
        assignedAgentId: 'a',
      }),
    ).toEqual([{ path: 'status', message: 'A task with an assignee must start as "assigned"' }]);
  });

  it('only todo/assigned may be created', () => {
    expect(
      issuesOf(taskCreateSchema, { title: 'T', project: 'erp', status: 'in_progress' }).map(
        (i) => i.path,
      ),
    ).toEqual(['status']);
  });

  it('blockedBy containing the explicit id → "A task cannot block itself"', () => {
    expect(
      issuesOf(taskCreateSchema, { id: 'SW-9', title: 'T', project: 'erp', blockedBy: ['SW-9'] }),
    ).toEqual([{ path: 'blockedBy', message: 'A task cannot block itself' }]);
    // without an explicit id the generated id cannot collide with existing ids
    expect(
      taskCreateSchema.safeParse({ title: 'T', project: 'erp', blockedBy: ['SW-9'] }).success,
    ).toBe(true);
  });

  it('blockedBy: ≤ 20 entries, each a task id', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `T-${i}`);
    expect(
      taskCreateSchema.safeParse({ title: 'T', project: 'erp', blockedBy: ids(20) }).success,
    ).toBe(true);
    expect(
      issuesOf(taskCreateSchema, { title: 'T', project: 'erp', blockedBy: ids(21) }).map(
        (i) => i.path,
      ),
    ).toEqual(['blockedBy']);
    expect(
      issuesOf(taskCreateSchema, { title: 'T', project: 'erp', blockedBy: ['ok', 'bad id'] }).map(
        (i) => i.path,
      ),
    ).toEqual(['blockedBy.1']);
  });

  it('title 1–200, description ≤ 5000, required project', () => {
    expect(taskCreateSchema.safeParse({ title: 't'.repeat(200), project: 'erp' }).success).toBe(
      true,
    );
    expect(
      issuesOf(taskCreateSchema, { title: 't'.repeat(201), project: 'erp' }).map((i) => i.path),
    ).toEqual(['title']);
    expect(issuesOf(taskCreateSchema, { title: '  ', project: 'erp' }).map((i) => i.path)).toEqual([
      'title',
    ]);
    expect(
      taskCreateSchema.safeParse({ title: 'T', project: 'erp', description: 'd'.repeat(5000) })
        .success,
    ).toBe(true);
    expect(
      issuesOf(taskCreateSchema, { title: 'T', project: 'erp', description: 'd'.repeat(5001) }).map(
        (i) => i.path,
      ),
    ).toEqual(['description']);
    expect(issuesOf(taskCreateSchema, { title: 'T' }).map((i) => i.path)).toEqual(['project']);
  });

  it('unknown keys (incl. server fields) → Unrecognized key', () => {
    expect(
      issuesOf(taskCreateSchema, { title: 'T', project: 'erp', version: 2, progress: 5 }),
    ).toEqual([
      { path: 'version', message: 'Unrecognized key' },
      { path: 'progress', message: 'Unrecognized key' },
    ]);
  });
});

describe('taskPatchSchema (§3.10, ADR-024)', () => {
  it('empty body or only force → "At least one field is required" at the root', () => {
    for (const body of [{}, { force: true }, { force: false }, { title: '  ' }, { title: null }]) {
      expect(issuesOf(taskPatchSchema, body)).toEqual([
        { path: '', message: 'At least one field is required' },
      ]);
    }
  });

  it('outputs only the provided fields plus force', () => {
    expect(taskPatchSchema.parse({ status: 'in_progress' })).toStrictEqual({
      status: 'in_progress',
      force: false,
    });
    expect(taskPatchSchema.parse({ progress: 40, force: true })).toStrictEqual({
      progress: 40,
      force: true,
    });
  });

  it('description: null or blank clears (null); text is trimmed', () => {
    expect(taskPatchSchema.parse({ description: null })).toStrictEqual({
      description: null,
      force: false,
    });
    expect(taskPatchSchema.parse({ description: '   ' })).toStrictEqual({
      description: null,
      force: false,
    });
    expect(taskPatchSchema.parse({ description: ' New ' })).toMatchObject({ description: 'New' });
    expect(issuesOf(taskPatchSchema, { description: 'd'.repeat(5001) }).map((i) => i.path)).toEqual(
      ['description'],
    );
  });

  it('assignedAgentId: null unassigns, blank is absent, otherwise 1–64', () => {
    expect(taskPatchSchema.parse({ assignedAgentId: null })).toStrictEqual({
      assignedAgentId: null,
      force: false,
    });
    expect(issuesOf(taskPatchSchema, { assignedAgentId: '' })).toEqual([
      { path: '', message: 'At least one field is required' },
    ]);
    expect(taskPatchSchema.parse({ assignedAgentId: ' 04-backend-engineer ' })).toMatchObject({
      assignedAgentId: '04-backend-engineer',
    });
    expect(
      issuesOf(taskPatchSchema, { assignedAgentId: 'a'.repeat(65) }).map((i) => i.path),
    ).toEqual(['assignedAgentId']);
  });

  it('accepts every field and dedupes blockedBy', () => {
    expect(
      taskPatchSchema.parse({
        title: 'T',
        description: 'D',
        status: 'review',
        priority: 'low',
        progress: 0,
        assignedAgentId: 'a',
        blockedBy: ['A', 'A'],
        metadata: {},
        force: true,
      }),
    ).toStrictEqual({
      title: 'T',
      description: 'D',
      status: 'review',
      priority: 'low',
      progress: 0,
      assignedAgentId: 'a',
      blockedBy: ['A'],
      metadata: {},
      force: true,
    });
  });

  it('blockedBy: [] is a provided field (clears the list)', () => {
    expect(taskPatchSchema.parse({ blockedBy: [] })).toStrictEqual({ blockedBy: [], force: false });
  });

  it('rejects invalid values and unknown keys', () => {
    expect(issuesOf(taskPatchSchema, { status: 'done' }).map((i) => i.path)).toEqual(['status']);
    expect(issuesOf(taskPatchSchema, { progress: 101 }).map((i) => i.path)).toEqual(['progress']);
    expect(issuesOf(taskPatchSchema, { progress: 1.5 }).map((i) => i.path)).toEqual(['progress']);
    expect(issuesOf(taskPatchSchema, { priority: 'urgent' }).map((i) => i.path)).toEqual([
      'priority',
    ]);
    expect(issuesOf(taskPatchSchema, { metadata: [] }).map((i) => i.path)).toEqual(['metadata']);
    expect(issuesOf(taskPatchSchema, { id: 'X', title: 'T' })).toEqual([
      { path: 'id', message: 'Unrecognized key' },
    ]);
  });
});

describe('demo bodies (§3.13, §3.14)', () => {
  it.each([
    [{}, {}],
    [{ intervalMs: null }, {}],
    [{ intervalMs: 2000 }, { intervalMs: 2000 }],
    [{ intervalMs: 10000 }, { intervalMs: 10000 }],
  ])('start %j → %j (no default: the server applies its configured interval)', (body, out) => {
    expect(demoStartSchema.parse(body)).toStrictEqual(out);
  });

  it.each([1999, 10001, 2500.5, '3000'])('start intervalMs %j → 400', (intervalMs) => {
    expect(issuesOf(demoStartSchema, { intervalMs }).map((i) => i.path)).toEqual(['intervalMs']);
  });

  it('start and stop are strict', () => {
    expect(issuesOf(demoStartSchema, { speed: 1 })).toEqual([
      { path: 'speed', message: 'Unrecognized key' },
    ]);
    expect(demoStopSchema.parse({})).toStrictEqual({});
    expect(issuesOf(demoStopSchema, { reason: 'x' })).toEqual([
      { path: 'reason', message: 'Unrecognized key' },
    ]);
  });
});
