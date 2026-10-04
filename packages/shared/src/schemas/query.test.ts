import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { EVENT_TYPES } from '../constants/eventTypes';
import { TASK_STATUSES } from '../constants/statuses';
import { toValidationIssues } from './issues';
import {
  agentsQuerySchema,
  eventsQuerySchema,
  snapshotQuerySchema,
  tasksQuerySchema,
} from './query';

function issuesOf(schema: z.ZodType, query: unknown) {
  const result = schema.safeParse(query);
  if (result.success) throw new Error(`expected failure, got ${JSON.stringify(result.data)}`);
  return toValidationIssues(result.error);
}

describe('agentsQuerySchema (§3.3)', () => {
  it('project is optional, trimmed, 1–100', () => {
    expect(agentsQuerySchema.parse({})).toStrictEqual({});
    expect(agentsQuerySchema.parse({ project: ' Sellway ' })).toStrictEqual({ project: 'Sellway' });
    expect(agentsQuerySchema.safeParse({ project: 'p'.repeat(100) }).success).toBe(true);
    expect(issuesOf(agentsQuerySchema, { project: 'p'.repeat(101) }).map((i) => i.path)).toEqual([
      'project',
    ]);
  });

  it('empty project → 400 (ADR-030)', () => {
    expect(issuesOf(agentsQuerySchema, { project: '' }).map((i) => i.path)).toEqual(['project']);
    expect(issuesOf(agentsQuerySchema, { project: '   ' }).map((i) => i.path)).toEqual(['project']);
  });

  it('unknown and repeated keys → 400', () => {
    expect(issuesOf(agentsQuerySchema, { status: 'idle' })).toEqual([
      { path: 'status', message: 'Unrecognized key' },
    ]);
    expect(issuesOf(agentsQuerySchema, { project: ['erp', 'sellway'] }).map((i) => i.path)).toEqual(
      ['project'],
    );
  });
});

describe('eventsQuerySchema (§3.6)', () => {
  it('defaults limit to 50', () => {
    expect(eventsQuerySchema.parse({})).toStrictEqual({ limit: 50 });
  });

  it('parses every filter', () => {
    expect(
      eventsQuerySchema.parse({
        project: 'erp',
        agentId: '04-backend-engineer',
        taskId: 'SW-123',
        type: 'agent.activity',
        source: 'demo',
        before: '812',
        limit: '20',
      }),
    ).toStrictEqual({
      project: 'erp',
      agentId: '04-backend-engineer',
      taskId: 'SW-123',
      type: 'agent.activity',
      source: 'demo', // reserved sources are allowed as a filter
      before: 812,
      limit: 20,
    });
  });

  it.each(EVENT_TYPES.map((type) => ({ type })))(
    'type $type is accepted (15 types)',
    ({ type }) => {
      expect(eventsQuerySchema.parse({ type })).toMatchObject({ type });
    },
  );

  it('unknown type → 400', () => {
    expect(issuesOf(eventsQuerySchema, { type: 'agent.unknown' }).map((i) => i.path)).toEqual([
      'type',
    ]);
  });

  it.each([
    ['1', 1],
    ['500', 500],
    ['007', 7],
  ])('limit %j → %d', (limit, value) => {
    expect(eventsQuerySchema.parse({ limit })).toMatchObject({ limit: value });
  });

  it.each(['0', '501', '-1', '+5', '5.0', '1e2', 'abc', '', ' ', '0x10'])(
    'limit %j → 400 (digits only, 1–500)',
    (limit) => {
      expect(issuesOf(eventsQuerySchema, { limit }).map((i) => i.path)).toEqual(['limit']);
    },
  );

  it.each([
    ['1', true],
    ['9007199254740991', true],
    ['9007199254740992', false],
    ['0', false],
    ['-5', false],
    ['1.5', false],
  ])('before %j → valid=%s', (before, valid) => {
    expect(eventsQuerySchema.safeParse({ before }).success).toBe(valid);
  });

  it('agentId 1–64, taskId pattern, source pattern', () => {
    expect(issuesOf(eventsQuerySchema, { agentId: 'a'.repeat(65) }).map((i) => i.path)).toEqual([
      'agentId',
    ]);
    expect(issuesOf(eventsQuerySchema, { taskId: 'bad id' }).map((i) => i.path)).toEqual([
      'taskId',
    ]);
    expect(issuesOf(eventsQuerySchema, { source: 'Bad' }).map((i) => i.path)).toEqual(['source']);
  });

  it('unknown key → one "Unrecognized key" issue per key', () => {
    expect(issuesOf(eventsQuerySchema, { foo: '1', bar: '2' })).toEqual([
      { path: 'foo', message: 'Unrecognized key' },
      { path: 'bar', message: 'Unrecognized key' },
    ]);
  });

  it('repeated key (array value) → 400', () => {
    expect(issuesOf(eventsQuerySchema, { limit: ['1', '2'] }).map((i) => i.path)).toEqual([
      'limit',
    ]);
  });
});

describe('tasksQuerySchema (§3.8)', () => {
  it('defaults limit to 500 and accepts every task status', () => {
    expect(tasksQuerySchema.parse({})).toStrictEqual({ limit: 500 });
    for (const status of TASK_STATUSES) {
      expect(tasksQuerySchema.parse({ status })).toStrictEqual({ status, limit: 500 });
    }
  });

  it('parses project/agentId/limit and rejects invalid status and range', () => {
    expect(tasksQuerySchema.parse({ project: 'erp', agentId: 'x', limit: '10' })).toStrictEqual({
      project: 'erp',
      agentId: 'x',
      limit: 10,
    });
    expect(issuesOf(tasksQuerySchema, { status: 'working' }).map((i) => i.path)).toEqual([
      'status',
    ]);
    expect(issuesOf(tasksQuerySchema, { limit: '501' }).map((i) => i.path)).toEqual(['limit']);
    expect(issuesOf(tasksQuerySchema, { type: 'x' }).map((i) => i.path)).toEqual(['type']);
  });
});

describe('snapshotQuerySchema (§3.11)', () => {
  it('defaults eventsLimit to 50; accepts project and eventsLimit 1–500', () => {
    expect(snapshotQuerySchema.parse({})).toStrictEqual({ eventsLimit: 50 });
    expect(snapshotQuerySchema.parse({ project: 'Sellway', eventsLimit: '500' })).toStrictEqual({
      project: 'Sellway',
      eventsLimit: 500,
    });
    expect(issuesOf(snapshotQuerySchema, { eventsLimit: '0' }).map((i) => i.path)).toEqual([
      'eventsLimit',
    ]);
    expect(issuesOf(snapshotQuerySchema, { limit: '5' })).toEqual([
      { path: 'limit', message: 'Unrecognized key' },
    ]);
  });
});
