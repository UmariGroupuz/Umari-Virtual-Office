import { describe, expect, it } from 'vitest';
import { KNOWN_ACTIONS } from '../constants/actions';
import { LIMITS } from '../constants/limits';
import { jsonByteLength } from '../schemas/common';
import { producerEventInputSchema, type EventInputBody } from '../schemas/event';
import {
  claudeCodeAdapter,
  claudeCodeEventSchema,
  mapClaudeToolToAction,
  type ClaudeCodeEvent,
} from './claudeCode';
import { AdapterError, type AdapterErrorCode } from './types';

/** ORIGINAL_REQUEST §19 example, verbatim. */
const EXAMPLE = {
  source: 'claude-code',
  agentId: '04-backend-engineer',
  project: 'Sellway',
  taskId: 'SW-123',
  event: 'tool.executed',
  tool: 'terminal',
  command: 'npm test',
  result: 'success',
} as const;

/** EVENT_SYSTEM §10.1 expected output for the example. */
const EXPECTED = {
  type: 'agent.activity',
  source: 'claude-code',
  agentId: '04-backend-engineer',
  project: 'Sellway',
  taskId: 'SW-123',
  action: 'test',
  message: 'terminal: npm test',
  severity: 'info',
  metadata: {
    adapter: 'claude-code',
    adapterVersion: 1,
    raw: { event: 'tool.executed', tool: 'terminal', command: 'npm test', result: 'success' },
  },
};

/** Calls the adapter with any value (the Phase 2 registry passes `unknown`). */
function run(raw: unknown): EventInputBody[] {
  return claudeCodeAdapter.toCanonical(raw as ClaudeCodeEvent);
}

type Mapped = EventInputBody & {
  action: string;
  message: string;
  severity: string;
  metadata: { raw: Record<string, unknown>; truncated?: boolean; droppedRawFields?: number };
};

/** Maps one payload, asserts exactly one output that validates (and is already normalized). */
function mapOne(overrides: Record<string, unknown> = {}): Mapped {
  const output = run({ ...EXAMPLE, ...overrides });
  expect(output).toHaveLength(1);
  const [event] = output;
  const parsed = producerEventInputSchema.safeParse(event);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data).toEqual(event);
  return event as Mapped;
}

function expectAdapterError(raw: unknown, code: AdapterErrorCode): AdapterError {
  let caught: unknown;
  try {
    run(raw);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AdapterError);
  const adapterError = caught as AdapterError;
  expect(adapterError).toBeInstanceOf(Error);
  expect(adapterError.name).toBe('AdapterError');
  expect(adapterError.code).toBe(code);
  expect(adapterError.message.length).toBeGreaterThan(0);
  return adapterError;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

describe('claudeCodeAdapter — §19 example', () => {
  it('produces exactly the EVENT_SYSTEM §10.1 output', () => {
    expect(run(EXAMPLE)).toEqual([EXPECTED]);
  });

  it('output passes producerEventInputSchema', () => {
    expect(producerEventInputSchema.safeParse(mapOne()).success).toBe(true);
  });

  it('declares source and schema', () => {
    expect(claudeCodeAdapter.source).toBe('claude-code');
    expect(claudeCodeAdapter.schema).toBe(claudeCodeEventSchema);
    expect(claudeCodeEventSchema.safeParse(EXAMPLE).success).toBe(true);
  });

  it('is pure: deterministic and does not mutate its input', () => {
    const input = deepFreeze({ ...EXAMPLE, extra: { nested: [1, 2, { a: 'b' }] } });
    const snapshot = JSON.stringify(input);
    const first = run(input);
    const second = run(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('project and taskId are optional; null means absent', () => {
    const withoutRefs = run({ ...EXAMPLE, project: undefined, taskId: undefined });
    expect(withoutRefs[0]).not.toHaveProperty('project');
    expect(withoutRefs[0]).not.toHaveProperty('taskId');
    const nulls = mapOne({ project: null, taskId: null });
    expect(nulls).not.toHaveProperty('project');
    expect(nulls).not.toHaveProperty('taskId');
  });

  it('keeps extra producer fields in metadata.raw after the core fields', () => {
    const event = mapOne({ sessionId: 'abc', durationMs: 1234, cwd: 'C:/repo' });
    expect(event.metadata.raw).toEqual({
      ...EXPECTED.metadata.raw,
      sessionId: 'abc',
      durationMs: 1234,
      cwd: 'C:/repo',
    });
    expect(Object.keys(event.metadata.raw)).toEqual([
      'event',
      'tool',
      'command',
      'result',
      'sessionId',
      'durationMs',
      'cwd',
    ]);
    expect(event.metadata).not.toHaveProperty('truncated');
  });

  it('never copies source/agentId/project/taskId into metadata.raw', () => {
    const { raw } = mapOne().metadata;
    for (const key of ['source', 'agentId', 'project', 'taskId'])
      expect(raw).not.toHaveProperty(key);
  });

  it('a tool without a command: message is the tool name, command absent from raw', () => {
    const event = mapOne({ tool: 'Read', command: undefined, result: undefined });
    expect(event.action).toBe('read_file');
    expect(event.message).toBe('Read');
    expect(event.metadata.raw).toEqual({ event: 'tool.executed', tool: 'Read' });
  });
});

describe('mapClaudeToolToAction — tool map (ES §10.1, case-insensitive)', () => {
  const ROWS: [string[], string][] = [
    [['read', 'read_file'], 'read_file'],
    [['write', 'write_file'], 'write_file'],
    [['edit', 'edit_file', 'multiedit'], 'edit_file'],
    [['grep', 'glob', 'search'], 'search'],
    [['browser', 'webfetch', 'web_fetch'], 'browser'],
    [['wait'], 'wait'],
  ];
  const variants = (tool: string): string[] => [
    tool,
    tool.toUpperCase(),
    tool.charAt(0).toUpperCase() + tool.slice(1),
    `  ${tool}  `,
  ];
  const cases = ROWS.flatMap(([tools, action]) =>
    tools.flatMap((tool) => variants(tool).map((variant) => ({ tool: variant, action }))),
  );

  it.each(cases)('$tool → $action', ({ tool, action }) => {
    expect(mapClaudeToolToAction(tool)).toBe(action);
    expect(mapClaudeToolToAction(tool, 'git status')).toBe(action);
    const event = mapOne({ tool, command: undefined });
    expect(event.action).toBe(action);
  });

  it.each(['MultiEdit', 'WebFetch', 'Grep', 'Glob', 'Bash'])(
    'Claude Code style casing %s is recognized',
    (tool) => {
      expect(KNOWN_ACTIONS as readonly string[]).toContain(mapClaudeToolToAction(tool));
    },
  );
});

describe('mapClaudeToolToAction — terminal command classification', () => {
  const COMMANDS: [string, string][] = [
    ['git status', 'git_status'],
    ['git status --short', 'git_status'],
    ['  GIT   Status  ', 'git_status'],
    ['git diff', 'git_diff'],
    ['git diff HEAD~1 -- src', 'git_diff'],
    ['git commit -m "feat: x"', 'git_commit'],
    ['git commit --amend', 'git_commit'],
    ['npm test', 'test'],
    ['npm run test', 'test'],
    ['pnpm test', 'test'],
    ['pnpm run test', 'test'],
    ['yarn test', 'test'],
    ['yarn run test', 'test'],
    ['npm test -w packages/shared', 'test'],
    ['npm run test:unit', 'test'],
    ['cd apps/server && npm test', 'test'],
    ['npx vitest run', 'test'],
    ['vitest', 'test'],
    ['jest --watch', 'test'],
    ['npx jest', 'test'],
    ['pytest -q tests/', 'test'],
    ['python -m pytest', 'test'],
    ['NPM  TEST', 'test'],
    ['npm run build', 'build'],
    ['npm build', 'build'],
    ['pnpm build', 'build'],
    ['pnpm run build', 'build'],
    ['yarn build', 'build'],
    ['yarn run build', 'build'],
    ['tsc', 'build'],
    ['npx tsc --noEmit', 'build'],
    ['tsc -p tsconfig.json', 'build'],
    ['vite build', 'build'],
    ['npx vite build --mode production', 'build'],
    ['ls -la', 'run_command'],
    ['echo hello', 'run_command'],
    ['npm install', 'run_command'],
    ['npm run lint', 'run_command'],
    ['git push origin main', 'run_command'],
    ['git log --oneline', 'run_command'],
    ['echo git status', 'run_command'],
    ['tscx', 'run_command'],
    ['npm testing', 'run_command'],
    ['', 'run_command'],
    ['   ', 'run_command'],
  ];
  const TERMINAL_TOOLS = ['terminal', 'bash', 'shell', 'Bash', 'TERMINAL', ' Shell '];

  it.each(COMMANDS.map(([command, action]) => ({ command, action })))(
    '"$command" → $action',
    ({ command, action }) => {
      for (const tool of TERMINAL_TOOLS) expect(mapClaudeToolToAction(tool, command)).toBe(action);
      expect(mapOne({ command }).action).toBe(action);
    },
  );

  it('a terminal tool without a command is run_command', () => {
    expect(mapClaudeToolToAction('bash')).toBe('run_command');
    expect(mapOne({ command: undefined }).action).toBe('run_command');
    expect(mapOne({ command: null }).action).toBe('run_command');
  });

  it('git classification takes precedence over test/build patterns', () => {
    expect(mapClaudeToolToAction('bash', 'git commit -m "npm test"')).toBe('git_commit');
    expect(mapClaudeToolToAction('bash', 'git diff -- vite build')).toBe('git_diff');
  });

  it('test takes precedence over build when both appear', () => {
    expect(mapClaudeToolToAction('bash', 'npm run build && npm test')).toBe('test');
  });
});

describe('mapClaudeToolToAction — unknown tools and the REQ-132 action list', () => {
  it.each([
    ['TodoWrite', 'todowrite'],
    ['WebSearch', 'websearch'],
    ['Web Search', 'web_search'],
    ['mcp__github__create_pr', 'mcp__github__create_pr'],
    ['  Notebook.Edit  ', 'notebook.edit'],
    ['tool/with:odd chars!', 'tool_with_odd_chars_'],
    ['!!!', '_'],
  ])('%s → %s', (tool, action) => {
    expect(mapClaudeToolToAction(tool)).toBe(action);
    expect(mapOne({ tool, command: undefined }).action).toBe(action);
  });

  it('a long unknown tool name is cut to 100 chars', () => {
    const tool = 'x'.repeat(250);
    expect(mapClaudeToolToAction(tool)).toBe('x'.repeat(LIMITS.ACTION_MAX));
    const event = mapOne({ tool, command: undefined });
    expect(event.action).toHaveLength(LIMITS.ACTION_MAX);
    expect(event.message).toBe(`${'x'.repeat(99)}…`);
    expect(event.metadata.raw.tool).toBe(`${'x'.repeat(99)}…`);
    expect(event.metadata.truncated).toBe(true);
  });

  it('every §19 action used as a tool name maps to itself', () => {
    for (const action of KNOWN_ACTIONS) expect(mapClaudeToolToAction(action)).toBe(action);
  });

  it('the tool map only produces REQ-132 actions, covering all of them except "error"', () => {
    const produced = new Set<string>();
    for (const tool of [
      'read',
      'write',
      'edit',
      'grep',
      'browser',
      'wait',
      'read_file',
      'write_file',
      'edit_file',
      'multiedit',
      'glob',
      'search',
      'webfetch',
      'web_fetch',
    ]) {
      produced.add(mapClaudeToolToAction(tool));
    }
    for (const command of ['git status', 'git diff', 'git commit', 'npm test', 'tsc', 'ls']) {
      produced.add(mapClaudeToolToAction('terminal', command));
    }
    for (const action of produced) expect(KNOWN_ACTIONS as readonly string[]).toContain(action);
    expect([...produced].sort()).toEqual(KNOWN_ACTIONS.filter((a) => a !== 'error').sort());
  });
});

describe('claudeCodeAdapter — result and severity', () => {
  it.each(['failure', 'failed', 'error', 'FAILED', ' Error ', 'Failure'])(
    'result %j → severity error and " (failed)"',
    (result) => {
      const event = mapOne({ result });
      expect(event.severity).toBe('error');
      expect(event.message).toBe('terminal: npm test (failed)');
      expect(event.metadata.raw.result).toBe(result);
    },
  );

  it.each(['success', 'ok', 'errors', 'failing', 'timeout', ''])(
    'result %j → severity info',
    (result) => {
      const event = mapOne({ result });
      expect(event.severity).toBe('info');
      expect(event.message).toBe('terminal: npm test');
    },
  );

  it('no result → info, result absent from raw', () => {
    const event = mapOne({ result: undefined });
    expect(event.severity).toBe('info');
    expect(event.metadata.raw).not.toHaveProperty('result');
  });

  it('" (failed)" is appended after a truncated command', () => {
    const event = mapOne({ command: 'a'.repeat(800), result: 'failed' });
    expect(event.message).toBe(`terminal: ${'a'.repeat(499)}… (failed)`);
  });
});

describe('claudeCodeAdapter — truncation and the 8 KB metadata limit', () => {
  it('a command of exactly 500 chars is not truncated in the message', () => {
    const command = 'b'.repeat(500);
    const event = mapOne({ command });
    expect(event.message).toBe(`terminal: ${command}`);
    expect(event.metadata.raw.command).toBe(command);
    expect(event.metadata).not.toHaveProperty('truncated');
  });

  it('command: 500 chars in message, 1000 chars in raw (ellipsis included)', () => {
    const command = 'c'.repeat(1500);
    const event = mapOne({ command });
    const shown = event.message.slice('terminal: '.length);
    expect(shown).toHaveLength(500);
    expect(shown).toBe(`${'c'.repeat(499)}…`);
    expect(event.metadata.raw.command).toHaveLength(1000);
    expect(event.metadata.raw.command).toBe(`${'c'.repeat(999)}…`);
    expect(event.metadata.truncated).toBe(true);
    expect(event.metadata).not.toHaveProperty('droppedRawFields');
  });

  it('a command of 1000 chars is kept whole in raw', () => {
    const command = 'd'.repeat(1000);
    expect(mapOne({ command }).metadata.raw.command).toBe(command);
  });

  it('truncation never splits a surrogate pair', () => {
    const command = `${'e'.repeat(498)}😀${'f'.repeat(10)}`;
    const event = mapOne({ command });
    expect(event.message).toBe(`terminal: ${'e'.repeat(498)}…`);
  });

  it('an oversized extra field is dropped; metadata stays ≤ 8 KB', () => {
    const event = mapOne({ stdout: 'x'.repeat(20_000), exitCode: 0 });
    expect(jsonByteLength(event.metadata)).toBeLessThanOrEqual(LIMITS.METADATA_BYTES);
    expect(event.metadata.raw).not.toHaveProperty('stdout');
    expect(event.metadata.raw.exitCode).toBe(0);
    expect(event.metadata.truncated).toBe(true);
    expect(event.metadata.droppedRawFields).toBe(1);
  });

  it('many medium extra fields: kept in order while they fit, the rest dropped', () => {
    const extras: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) extras[`field${String(i).padStart(2, '0')}`] = 'y'.repeat(500);
    const event = mapOne({ ...extras, command: 'z'.repeat(5000) });
    const size = jsonByteLength(event.metadata);
    expect(size).toBeLessThanOrEqual(LIMITS.METADATA_BYTES);
    expect(size).toBeGreaterThan(LIMITS.METADATA_BYTES - 600);
    const kept = Object.keys(event.metadata.raw).filter((key) => key.startsWith('field'));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept).toEqual(Object.keys(extras).slice(0, kept.length));
    expect(event.metadata.droppedRawFields).toBe(40 - kept.length);
  });

  it('worst-case core fields (6-byte JSON escapes everywhere) still fit in 8 KB', () => {
    const control = '\u0001';
    const event = mapOne({
      tool: `t${control.repeat(300)}`,
      command: control.repeat(3000),
      result: control.repeat(300),
      big: 'q'.repeat(9000),
    });
    expect(jsonByteLength(event.metadata)).toBeLessThanOrEqual(LIMITS.METADATA_BYTES);
    expect(event.metadata.truncated).toBe(true);
  });

  it('non-JSON extra values are dropped instead of failing', () => {
    const event = mapOne({ big: 10n, fn: () => 1, when: new Date(0), ok: true });
    expect(event.metadata.raw.ok).toBe(true);
    for (const key of ['big', 'fn', 'when']) expect(event.metadata.raw).not.toHaveProperty(key);
    expect(event.metadata.droppedRawFields).toBe(3);
  });

  it('a "__proto__" key from JSON.parse is dropped without prototype pollution', () => {
    const raw: unknown = JSON.parse(
      '{"source":"claude-code","agentId":"04-backend-engineer","event":"tool.executed","tool":"bash","command":"ls","__proto__":{"polluted":true}}',
    );
    const [event] = run(raw);
    const metadata = (event as Mapped).metadata;
    expect(Object.getPrototypeOf(metadata.raw)).toBe(Object.prototype);
    expect(Object.keys(metadata.raw)).toEqual(['event', 'tool', 'command']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('claudeCodeAdapter — errors', () => {
  it.each(['session.started', 'session.ended', 'error', 'TOOL.EXECUTED', 'tool.executed.v2', ''])(
    'event %j → UNSUPPORTED_EVENT',
    (event) => {
      const error = expectAdapterError({ ...EXAMPLE, event }, 'UNSUPPORTED_EVENT');
      expect(error.message).toContain('Unsupported Claude Code event');
    },
  );

  it('the unsupported event value is echoed at most 100 chars', () => {
    const error = expectAdapterError({ ...EXAMPLE, event: 'e'.repeat(5000) }, 'UNSUPPORTED_EVENT');
    expect(error.message.length).toBeLessThan(200);
  });

  it('accepts " tool.executed " with surrounding whitespace', () => {
    expect(mapOne({ event: ' tool.executed ' }).metadata.raw.event).toBe(' tool.executed ');
  });

  const INVALID: [string, unknown][] = [
    ['null', null],
    ['an array', [EXAMPLE]],
    ['a string', 'tool.executed'],
    ['missing source', { ...EXAMPLE, source: undefined }],
    ['another source', { ...EXAMPLE, source: 'github' }],
    ['missing agentId', { ...EXAMPLE, agentId: undefined }],
    ['numeric agentId', { ...EXAMPLE, agentId: 4 }],
    ['missing event', { ...EXAMPLE, event: undefined }],
    ['non-string command', { ...EXAMPLE, command: ['npm', 'test'] }],
    ['non-string result', { ...EXAMPLE, result: { ok: true } }],
    ['missing tool', { ...EXAMPLE, tool: undefined }],
    ['blank tool', { ...EXAMPLE, tool: '   ' }],
    ['blank agentId (canonical schema)', { ...EXAMPLE, agentId: '  ' }],
    ['agentId over 64 chars (canonical schema)', { ...EXAMPLE, agentId: 'a'.repeat(65) }],
    ['taskId with spaces (canonical schema)', { ...EXAMPLE, taskId: 'SW 123' }],
    ['project over 100 chars (canonical schema)', { ...EXAMPLE, project: 'p'.repeat(101) }],
  ];

  it.each(INVALID.map(([name, raw]) => ({ name, raw })))('$name → INVALID_PAYLOAD', ({ raw }) => {
    expectAdapterError(raw, 'INVALID_PAYLOAD');
  });

  it('INVALID_PAYLOAD messages name the failing field', () => {
    expect(
      expectAdapterError({ ...EXAMPLE, agentId: undefined }, 'INVALID_PAYLOAD').message,
    ).toMatch(/agentId/);
    expect(expectAdapterError({ ...EXAMPLE, taskId: 'SW 123' }, 'INVALID_PAYLOAD').message).toMatch(
      /taskId/,
    );
    expect(expectAdapterError({ ...EXAMPLE, tool: '' }, 'INVALID_PAYLOAD').message).toMatch(/tool/);
  });

  it('whitespace around canonical fields is normalized, not rejected', () => {
    const event = mapOne({
      agentId: ' 04-backend-engineer ',
      project: ' Sellway ',
      taskId: ' SW-123 ',
    });
    expect(event.agentId).toBe('04-backend-engineer');
    expect(event.project).toBe('Sellway');
    expect(event.taskId).toBe('SW-123');
  });
});
