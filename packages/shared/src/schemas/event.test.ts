import { describe, expect, it } from 'vitest';
import { PRODUCER_EVENT_TYPES, SERVER_EVENT_TYPES } from '../constants/eventTypes';
import { AGENT_STATUSES } from '../constants/statuses';
import { eventInputSchema, producerEventInputSchema, type EventInputBody } from './event';
import { toValidationIssues } from './issues';

const AGENT = '04-backend-engineer';

/** Minimal valid body per producer type (only required fields). */
const MINIMAL: Record<(typeof PRODUCER_EVENT_TYPES)[number], Record<string, unknown>> = {
  'agent.connected': { agentId: AGENT },
  'agent.disconnected': { agentId: AGENT },
  'agent.status.changed': { agentId: AGENT, status: 'working' },
  'agent.activity': { agentId: AGENT, action: 'run_command' },
  'agent.message': { agentId: AGENT, message: 'Hello' },
  'agent.task.assigned': { agentId: AGENT, taskId: 'SW-123' },
  'agent.task.started': { agentId: AGENT, taskId: 'SW-123' },
  'agent.task.progress': { agentId: AGENT, taskId: 'SW-123', progress: 50 },
  'agent.task.completed': { agentId: AGENT, taskId: 'SW-123' },
  'agent.task.failed': { agentId: AGENT, taskId: 'SW-123' },
  'system.info': { message: 'Hello' },
  'system.warning': { message: 'Hello' },
  'system.error': { message: 'Hello' },
};

/** Required fields per type (besides `type`), ES §3. */
const REQUIRED: Record<(typeof PRODUCER_EVENT_TYPES)[number], string[]> = {
  'agent.connected': ['agentId'],
  'agent.disconnected': ['agentId'],
  'agent.status.changed': ['agentId', 'status'],
  'agent.activity': ['agentId', 'action'],
  'agent.message': ['agentId', 'message'],
  'agent.task.assigned': ['agentId', 'taskId'],
  'agent.task.started': ['agentId', 'taskId'],
  'agent.task.progress': ['agentId', 'taskId', 'progress'],
  'agent.task.completed': ['agentId', 'taskId'],
  'agent.task.failed': ['agentId', 'taskId'],
  'system.info': ['message'],
  'system.warning': ['message'],
  'system.error': ['message'],
};

const NO_STATUS_TYPES = [
  'agent.connected',
  'agent.disconnected',
  'system.info',
  'system.warning',
  'system.error',
] as const;

function issuesOf(body: unknown, schema = producerEventInputSchema) {
  const result = schema.safeParse(body);
  if (result.success) throw new Error(`expected failure, got ${JSON.stringify(result.data)}`);
  return toValidationIssues(result.error);
}

function activity(extra: Record<string, unknown>) {
  return { type: 'agent.activity', agentId: AGENT, action: 'run_command', ...extra };
}

describe('producerEventInputSchema — the ORIGINAL_REQUEST §12 example (ES §11)', () => {
  const example = {
    type: 'agent.activity',
    agentId: '04-backend-engineer',
    project: 'Sellway',
    taskId: 'SW-123',
    status: 'working',
    action: 'run_command',
    message: 'Running backend tests',
    metadata: { command: 'npm test' },
  } satisfies EventInputBody;

  it('parses to exactly the input (project stays unresolved, source is not defaulted)', () => {
    expect(producerEventInputSchema.parse(example)).toStrictEqual(example);
    expect(eventInputSchema.parse(example)).toStrictEqual(example);
  });
});

describe('per-type required and forbidden fields (ES §3)', () => {
  it.each(PRODUCER_EVENT_TYPES.map((type) => ({ type })))('minimal $type parses', ({ type }) => {
    const body = { type, ...MINIMAL[type] };
    expect(producerEventInputSchema.parse(body)).toStrictEqual(body);
  });

  it.each(PRODUCER_EVENT_TYPES.flatMap((type) => REQUIRED[type].map((field) => ({ type, field }))))(
    '$type without $field → 400 at $field',
    ({ type, field }) => {
      const body: Record<string, unknown> = { type, ...MINIMAL[type] };
      delete body[field];
      expect(issuesOf(body).map((i) => i.path)).toEqual([field]);
      // null for a required field is the same as missing
      expect(issuesOf({ ...body, [field]: null }).map((i) => i.path)).toEqual([field]);
    },
  );

  it.each(
    NO_STATUS_TYPES.flatMap((type) => ['status', 'progress'].map((field) => ({ type, field }))),
  )('$field on $type → Unrecognized key', ({ type, field }) => {
    const value = field === 'status' ? 'idle' : 10;
    expect(issuesOf({ type, ...MINIMAL[type], [field]: value })).toEqual([
      { path: field, message: 'Unrecognized key' },
    ]);
  });

  it('optional status/progress/taskId are accepted where ES §3 allows them', () => {
    const withAll = { status: 'working', progress: 10, taskId: 'SW-1' };
    for (const type of ['agent.activity', 'agent.message'] as const) {
      expect(
        producerEventInputSchema.safeParse({ type, ...MINIMAL[type], ...withAll }).success,
      ).toBe(true);
    }
    expect(
      producerEventInputSchema.safeParse({
        type: 'agent.status.changed',
        ...MINIMAL['agent.status.changed'],
        progress: 10,
        taskId: 'SW-1',
      }).success,
    ).toBe(true);
    expect(
      producerEventInputSchema.safeParse({
        type: 'system.error',
        message: 'Down',
        agentId: AGENT,
        taskId: 'SW-1',
      }).success,
    ).toBe(true);
  });

  it('every common optional field is accepted on every type', () => {
    const common = {
      source: 'my-script',
      project: 'erp',
      action: 'build',
      message: 'text',
      severity: 'warning',
      metadata: { a: 1 },
      occurredAt: '2026-10-03T22:41:07.123Z',
    };
    for (const type of PRODUCER_EVENT_TYPES) {
      const body = { type, ...common, ...MINIMAL[type] };
      expect(producerEventInputSchema.parse(body)).toStrictEqual(body);
    }
  });

  it.each(['force', 'id', 'seq', 'createdAt', 'forced', 'foo'])(
    'unknown key %s → {path, "Unrecognized key"}',
    (key) => {
      expect(issuesOf(activity({ [key]: 1 }))).toEqual([
        { path: key, message: 'Unrecognized key' },
      ]);
    },
  );

  it('reports one issue per unknown key', () => {
    expect(issuesOf(activity({ foo: 1, bar: 2 }))).toEqual([
      { path: 'foo', message: 'Unrecognized key' },
      { path: 'bar', message: 'Unrecognized key' },
    ]);
  });

  it('ES §11 rejected example: activity with foo → exactly [{path:"foo"}]', () => {
    expect(
      issuesOf({ type: 'agent.activity', agentId: '04-backend-engineer', action: 'x', foo: 1 }),
    ).toEqual([{ path: 'foo', message: 'Unrecognized key' }]);
  });
});

describe('type discriminator messages (API_CONTRACTS §2.2)', () => {
  it.each([{}, { type: null }, { type: '' }, { type: '   ' }])('missing type %j', (body) => {
    expect(issuesOf({ ...body, agentId: AGENT })).toEqual([
      { path: 'type', message: 'Event type is required' },
    ]);
  });

  it.each(['foo.bar', 'agent.unknown', 'AGENT.ACTIVITY', 'agent.activity '])(
    'unknown type %j',
    (type) => {
      expect(issuesOf({ type, agentId: AGENT })).toEqual([
        { path: 'type', message: `Unknown event type: ${type}` },
      ]);
    },
  );

  it('non-string type values are described', () => {
    expect(issuesOf({ type: 42 })).toEqual([{ path: 'type', message: 'Unknown event type: 42' }]);
  });

  it('very long unknown types are truncated in the message', () => {
    const [issue] = issuesOf({ type: 'x'.repeat(5000) });
    expect(issue?.message).toBe(`Unknown event type: ${'x'.repeat(100)}…`);
  });

  it.each([...SERVER_EVENT_TYPES])('server-only type %s', (type) => {
    const expected = [{ path: 'type', message: `Event type ${type} is server-only` }];
    expect(issuesOf({ type, taskId: 'SW-1' })).toEqual(expected);
    expect(issuesOf({ type, taskId: 'SW-1' }, eventInputSchema)).toEqual(expected);
  });

  it('a non-object body is rejected at the root', () => {
    for (const body of [null, 'x', 1, [], [activity({})]]) {
      const issues = issuesOf(body);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.path).toBe('');
    }
  });
});

describe('source (ADR-005)', () => {
  it.each(['demo', 'system', '  demo  '])(
    'reserved source %j is rejected by the producer schema',
    (source) => {
      expect(issuesOf(activity({ source }))).toEqual([
        { path: 'source', message: 'Source "demo" is reserved'.replace('demo', source.trim()) },
      ]);
    },
  );

  it('reserved sources are allowed for in-process producers (eventInputSchema)', () => {
    expect(eventInputSchema.parse(activity({ source: 'demo' }))).toMatchObject({ source: 'demo' });
    expect(
      eventInputSchema.parse({ type: 'system.info', source: 'system', message: 'x' }),
    ).toMatchObject({ source: 'system' });
  });

  it.each(['simulator', 'api', 'claude-code', 'a', 'ci.github_actions-1', 'x'.repeat(50)])(
    'valid source %s',
    (source) => {
      expect(producerEventInputSchema.parse(activity({ source }))).toMatchObject({ source });
    },
  );

  it.each(['Simulator', 'my source', 'src/1', 'é', 'x'.repeat(51)])(
    'invalid source %j',
    (source) => {
      expect(issuesOf(activity({ source })).map((i) => i.path)).toEqual(['source']);
    },
  );

  it('is not defaulted by the schema (the server resolves `api`)', () => {
    expect(producerEventInputSchema.parse(activity({}))).not.toHaveProperty('source');
  });
});

describe('field limits (REQ-023 boundary values)', () => {
  it('action 100 ok / 101 rejected, trimmed, required on agent.activity', () => {
    expect(producerEventInputSchema.parse(activity({ action: 'a'.repeat(100) }))).toMatchObject({
      action: 'a'.repeat(100),
    });
    expect(issuesOf(activity({ action: 'a'.repeat(101) }))).toEqual([
      { path: 'action', message: 'Action must be 100 characters or fewer.' },
    ]);
    expect(
      producerEventInputSchema.parse(activity({ action: `  ${'a'.repeat(100)}  ` })),
    ).toMatchObject({
      action: 'a'.repeat(100),
    });
    expect(issuesOf(activity({ action: '   ' }))).toEqual([
      { path: 'action', message: 'Action is required.' },
    ]);
    expect(issuesOf({ type: 'agent.activity', agentId: AGENT })).toEqual([
      { path: 'action', message: 'Action is required.' },
    ]);
  });

  it('optional action on other types: empty → absent, 101 → rejected', () => {
    const body = { type: 'agent.message', agentId: AGENT, message: 'm' };
    expect(producerEventInputSchema.parse({ ...body, action: '  ' })).toStrictEqual(body);
    expect(issuesOf({ ...body, action: 'a'.repeat(101) }).map((i) => i.path)).toEqual(['action']);
  });

  it('message 2000 ok / 2001 rejected (optional and required)', () => {
    expect(producerEventInputSchema.parse(activity({ message: 'm'.repeat(2000) }))).toMatchObject({
      message: 'm'.repeat(2000),
    });
    expect(issuesOf(activity({ message: 'm'.repeat(2001) }))).toEqual([
      { path: 'message', message: 'Message must be 2,000 characters or fewer.' },
    ]);
    expect(
      producerEventInputSchema.safeParse({ type: 'system.info', message: 'm'.repeat(2000) })
        .success,
    ).toBe(true);
    expect(issuesOf({ type: 'system.info', message: 'm'.repeat(2001) })).toEqual([
      { path: 'message', message: 'Message must be 2,000 characters or fewer.' },
    ]);
  });

  it('required message empty after trim → 400; optional message empty → absent', () => {
    expect(issuesOf({ type: 'agent.message', agentId: AGENT, message: '  ' })).toEqual([
      { path: 'message', message: 'Message is required.' },
    ]);
    expect(issuesOf({ type: 'system.error' })).toEqual([
      { path: 'message', message: 'Message is required.' },
    ]);
    expect(producerEventInputSchema.parse(activity({ message: '   ' }))).not.toHaveProperty(
      'message',
    );
  });

  it.each([
    [-1, false],
    [0, true],
    [100, true],
    [101, false],
    [1.5, false],
    ['50', false],
    [Number.NaN, false],
  ])('progress %s → valid=%s', (progress, valid) => {
    const body = { type: 'agent.task.progress', agentId: AGENT, taskId: 'SW-1', progress };
    expect(producerEventInputSchema.safeParse(body).success).toBe(valid);
    expect(producerEventInputSchema.safeParse(activity({ progress })).success).toBe(valid);
    if (!valid) expect(issuesOf(body).map((i) => i.path)).toEqual(['progress']);
  });

  it.each([
    ['SW-123', true],
    ['a', true],
    ['A.b_c-9', true],
    ['x'.repeat(64), true],
    ['x'.repeat(65), false],
    ['SW 123', false],
    ['SW/123', false],
    ['ü', false],
  ])('taskId %j → valid=%s', (taskId, valid) => {
    const body = { type: 'agent.task.started', agentId: AGENT, taskId };
    expect(producerEventInputSchema.safeParse(body).success).toBe(valid);
    if (!valid) expect(issuesOf(body).map((i) => i.path)).toEqual(['taskId']);
  });

  it('taskId is trimmed; required taskId empty → 400; optional empty → absent', () => {
    expect(
      producerEventInputSchema.parse({
        type: 'agent.task.started',
        agentId: AGENT,
        taskId: ' SW-1 ',
      }),
    ).toMatchObject({ taskId: 'SW-1' });
    expect(
      issuesOf({ type: 'agent.task.started', agentId: AGENT, taskId: '  ' }).map((i) => i.path),
    ).toEqual(['taskId']);
    expect(producerEventInputSchema.parse(activity({ taskId: '' }))).not.toHaveProperty('taskId');
  });

  it('agentId: trimmed, 1–64', () => {
    expect(producerEventInputSchema.parse(activity({ agentId: `  ${AGENT}  ` }))).toMatchObject({
      agentId: AGENT,
    });
    expect(producerEventInputSchema.safeParse(activity({ agentId: 'a'.repeat(64) })).success).toBe(
      true,
    );
    expect(issuesOf(activity({ agentId: 'a'.repeat(65) })).map((i) => i.path)).toEqual(['agentId']);
    expect(issuesOf(activity({ agentId: ' ' })).map((i) => i.path)).toEqual(['agentId']);
  });

  it('project: id or name kept unresolved; 1–100; empty → absent', () => {
    expect(producerEventInputSchema.parse(activity({ project: ' All Projects ' }))).toMatchObject({
      project: 'All Projects', // resolution (→ 422) is the server's job
    });
    expect(producerEventInputSchema.safeParse(activity({ project: 'p'.repeat(100) })).success).toBe(
      true,
    );
    expect(issuesOf(activity({ project: 'p'.repeat(101) })).map((i) => i.path)).toEqual([
      'project',
    ]);
    expect(producerEventInputSchema.parse(activity({ project: '' }))).not.toHaveProperty('project');
  });

  it.each(AGENT_STATUSES.map((status) => ({ status })))('status $status is valid', ({ status }) => {
    expect(producerEventInputSchema.safeParse(activity({ status })).success).toBe(true);
  });

  it.each(['busy', 'Working', 'in_progress', 1])('invalid status %j → 400 at status', (status) => {
    expect(issuesOf(activity({ status })).map((i) => i.path)).toEqual(['status']);
    expect(
      issuesOf({ type: 'agent.status.changed', agentId: AGENT, status }).map((i) => i.path),
    ).toEqual(['status']);
  });

  it.each(['info', 'warning', 'error'])('severity %s is valid', (severity) => {
    expect(producerEventInputSchema.parse(activity({ severity }))).toMatchObject({ severity });
  });

  it.each(['critical', 'INFO', 3])('invalid severity %j', (severity) => {
    expect(issuesOf(activity({ severity })).map((i) => i.path)).toEqual(['severity']);
  });

  it.each([
    '2026-10-03T22:41:07.123Z',
    '2026-10-03T22:41:07Z',
    '2026-10-03T22:41:07+05:00',
    '2026-10-03T22:41:07.5-03:30',
  ])('occurredAt %s is valid', (occurredAt) => {
    expect(producerEventInputSchema.safeParse(activity({ occurredAt })).success).toBe(true);
  });

  it.each(['2026-10-03', '2026-10-03T22:41:07', 'yesterday', 'x', 1_700_000_000_000])(
    'occurredAt %j is invalid',
    (occurredAt) => {
      expect(issuesOf(activity({ occurredAt })).map((i) => i.path)).toEqual(['occurredAt']);
    },
  );
});

describe('metadata (ADR-005, REQ-023)', () => {
  /** A metadata object whose JSON.stringify is exactly `bytes` UTF-8 bytes. */
  const metadataOfBytes = (bytes: number) => ({ k: 'x'.repeat(bytes - '{"k":""}'.length) });

  it('8192 bytes ok / 8193 bytes → "Metadata exceeds 8 KB"', () => {
    expect(JSON.stringify(metadataOfBytes(8192))).toHaveLength(8192);
    expect(
      producerEventInputSchema.safeParse(activity({ metadata: metadataOfBytes(8192) })).success,
    ).toBe(true);
    expect(issuesOf(activity({ metadata: metadataOfBytes(8193) }))).toEqual([
      { path: 'metadata', message: 'Metadata exceeds 8 KB' },
    ]);
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 'é' is 2 bytes: 4096 of them + '{"k":""}' (8 bytes) = 8200 bytes > 8192, but only 4104 chars.
    expect(issuesOf(activity({ metadata: { k: 'é'.repeat(4096) } }))).toEqual([
      { path: 'metadata', message: 'Metadata exceeds 8 KB' },
    ]);
    expect(
      producerEventInputSchema.safeParse(activity({ metadata: { k: 'é'.repeat(4000) } })).success,
    ).toBe(true);
  });

  it.each([[[1, 2]], ['text'], [5], [true]])('non-object metadata %j → 400', (metadata) => {
    expect(issuesOf(activity({ metadata }))).toEqual([
      { path: 'metadata', message: 'Metadata must be a JSON object' },
    ]);
  });

  it('null metadata means absent; {} is kept', () => {
    expect(producerEventInputSchema.parse(activity({ metadata: null }))).not.toHaveProperty(
      'metadata',
    );
    expect(producerEventInputSchema.parse(activity({ metadata: {} }))).toMatchObject({
      metadata: {},
    });
  });

  it('is stored verbatim (same object, nested values untouched)', () => {
    const metadata = { nested: { list: [1, 'two', null, { deep: true }] }, title: 'T' };
    const parsed = producerEventInputSchema.parse(activity({ metadata }));
    expect(parsed.metadata).toBe(metadata);
  });

  it('rejects non-JSON values from in-process producers', () => {
    for (const metadata of [
      { d: new Date(0) },
      { f: () => 1 },
      { n: Number.POSITIVE_INFINITY },
      { a: [undefined] },
      new Map(),
    ]) {
      expect(issuesOf(activity({ metadata }), eventInputSchema).map((i) => i.path)).toEqual([
        'metadata',
      ]);
    }
  });

  it('a cyclic or hostile deeply nested object is rejected as too large without throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(issuesOf(activity({ metadata: cyclic }), eventInputSchema)).toEqual([
      { path: 'metadata', message: 'Metadata exceeds 8 KB' },
    ]);
    const deep = JSON.parse(`{"a":${'['.repeat(50_000)}${']'.repeat(50_000)}}`) as unknown;
    expect(issuesOf(activity({ metadata: deep }))).toEqual([
      { path: 'metadata', message: 'Metadata exceeds 8 KB' },
    ]);
  });

  it('a "__proto__" key from JSON.parse does not alter the result prototype', () => {
    const metadata = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
    const parsed = producerEventInputSchema.parse(activity({ metadata }));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});

describe('null-as-absent and empty-as-absent (API_CONTRACTS §0)', () => {
  it('optional fields sent as null or blank are removed from the output', () => {
    const parsed = producerEventInputSchema.parse(
      activity({
        source: null,
        project: '   ',
        taskId: null,
        message: '',
        severity: null,
        progress: null,
        status: null,
        metadata: null,
        occurredAt: ' ',
      }),
    );
    expect(parsed).toStrictEqual({ type: 'agent.activity', agentId: AGENT, action: 'run_command' });
  });

  it('system events: agentId null → absent', () => {
    expect(
      producerEventInputSchema.parse({ type: 'system.info', message: 'x', agentId: null }),
    ).toStrictEqual({ type: 'system.info', message: 'x' });
  });
});

describe('validation reports all schema issues together', () => {
  it('several invalid fields → one issue each', () => {
    const paths = issuesOf(
      activity({ action: 'a'.repeat(101), progress: 101, severity: 'x', taskId: 'bad id' }),
    ).map((i) => i.path);
    expect(paths.sort()).toEqual(['action', 'progress', 'severity', 'taskId']);
  });
});
