import { describe, expect, it } from 'vitest';
import {
  actionSchema,
  agentIdSchema,
  agentStatusSchema,
  isoDateTimeSchema,
  jsonByteLength,
  messageSchema,
  metadataSchema,
  progressSchema,
  projectRefSchema,
  severitySchema,
  sourceSchema,
  taskIdSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from './common';
import { producerEventInputSchema } from './event';
import { toValidationIssues } from './issues';
import { eventsQuerySchema } from './query';
import { taskCreateSchema, taskPatchSchema } from './task';

describe('common field schemas (§5.2)', () => {
  it('agentIdSchema: trimmed 1–64', () => {
    expect(agentIdSchema.parse('  a  ')).toBe('a');
    expect(agentIdSchema.safeParse('').success).toBe(false);
    expect(agentIdSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(agentIdSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('projectRefSchema: trimmed 1–100', () => {
    expect(projectRefSchema.parse(' Ana Market ')).toBe('Ana Market');
    expect(projectRefSchema.safeParse(' ').success).toBe(false);
    expect(projectRefSchema.safeParse('p'.repeat(101)).success).toBe(false);
  });

  it('taskIdSchema and sourceSchema: trimmed then pattern-checked', () => {
    expect(taskIdSchema.parse(' SW-1 ')).toBe('SW-1');
    expect(taskIdSchema.safeParse('').success).toBe(false);
    expect(sourceSchema.parse(' demo ')).toBe('demo'); // reserved allowed at this level
    expect(sourceSchema.safeParse('').success).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'taskIdSchema rejects the reserved id %s (ADR-037, SEC-4)',
    (id) => {
      const result = taskIdSchema.safeParse(id);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(`Task id "${id}" is reserved`);
      expect(taskIdSchema.safeParse(` ${id} `).success).toBe(false); // also after trimming
    },
  );

  it.each(['__PROTO__', 'Constructor', 'prototype2', 'toString', '_proto_'])(
    'taskIdSchema still accepts the look-alike %s',
    (id) => {
      expect(taskIdSchema.parse(id)).toBe(id);
    },
  );

  it('reserved ids are rejected wherever a task id is accepted', () => {
    const event = producerEventInputSchema.safeParse({
      type: 'agent.task.assigned',
      agentId: '04-backend-engineer',
      taskId: '__proto__',
      project: 'sellway',
    });
    expect(event.success).toBe(false);
    expect(toValidationIssues(event.error as NonNullable<typeof event.error>)).toEqual([
      { path: 'taskId', message: 'Task id "__proto__" is reserved' },
    ]);
    expect(
      taskCreateSchema.safeParse({ id: 'constructor', title: 'x', project: 'erp' }).success,
    ).toBe(false);
    expect(taskPatchSchema.safeParse({ blockedBy: ['prototype'] }).success).toBe(false);
    expect(eventsQuerySchema.safeParse({ taskId: '__proto__' }).success).toBe(false);
  });

  it('enums', () => {
    expect(agentStatusSchema.options).toHaveLength(8);
    expect(taskStatusSchema.options).toHaveLength(9);
    expect(taskPrioritySchema.options).toEqual(['low', 'normal', 'high', 'critical']);
    expect(severitySchema.options).toEqual(['info', 'warning', 'error']);
  });

  it('progressSchema: integer 0–100', () => {
    expect(progressSchema.safeParse(0).success).toBe(true);
    expect(progressSchema.safeParse(100).success).toBe(true);
    expect(progressSchema.safeParse(-1).success).toBe(false);
    expect(progressSchema.safeParse(101).success).toBe(false);
    expect(progressSchema.safeParse(1.5).success).toBe(false);
  });

  it('actionSchema / messageSchema use the simulator copy (UX §9.5)', () => {
    expect(actionSchema.safeParse('').error?.issues[0]?.message).toBe('Action is required.');
    expect(actionSchema.safeParse(undefined).error?.issues[0]?.message).toBe('Action is required.');
    expect(actionSchema.safeParse('a'.repeat(101)).error?.issues[0]?.message).toBe(
      'Action must be 100 characters or fewer.',
    );
    expect(messageSchema.parse('')).toBe('');
    expect(messageSchema.safeParse('m'.repeat(2001)).error?.issues[0]?.message).toBe(
      'Message must be 2,000 characters or fewer.',
    );
  });

  it('isoDateTimeSchema requires Z or an offset', () => {
    expect(isoDateTimeSchema.safeParse('2026-10-03T22:41:07.123Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-10-03T22:41:07+02:00').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-10-03T22:41:07').success).toBe(false);
  });

  it('metadataSchema accepts plain JSON objects incl. null-prototype objects', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(metadataSchema.safeParse(bare).success).toBe(true);
    expect(metadataSchema.safeParse({ a: [1, { b: null }], c: 'x', d: false }).success).toBe(true);
    expect(metadataSchema.safeParse({ skipped: undefined }).success).toBe(true);
    expect(metadataSchema.safeParse(null).success).toBe(false);
  });

  it('jsonByteLength counts UTF-8 bytes and never throws', () => {
    expect(jsonByteLength({})).toBe(2);
    expect(jsonByteLength({ k: 'é' })).toBe(10);
    expect(jsonByteLength(undefined)).toBe(0);
    expect(jsonByteLength(10n)).toBe(Number.POSITIVE_INFINITY);
  });
});
