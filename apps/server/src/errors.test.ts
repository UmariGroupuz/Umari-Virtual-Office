import { ERROR_HTTP_STATUS, type HealthErrorDetails } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import { AppError, appErrors, toErrorBody } from './errors';

const health: HealthErrorDetails = {
  status: 'error',
  db: 'error',
  uptimeSec: 3,
  version: '0.1.0',
  time: '2026-10-04T10:00:00.000Z',
};

// Every factory with the exact API_CONTRACTS §2.2 message, HTTP status and details.
const CASES: [string, AppError, number, string, string, unknown][] = [
  [
    'invalidJson content-type',
    appErrors.invalidJson('content-type'),
    400,
    'INVALID_JSON',
    'Content-Type must be application/json',
    undefined,
  ],
  [
    'invalidJson parse',
    appErrors.invalidJson('parse'),
    400,
    'INVALID_JSON',
    'Request body is not valid JSON',
    undefined,
  ],
  [
    'invalidJson encoding',
    appErrors.invalidJson('encoding'),
    400,
    'INVALID_JSON',
    'Content-Encoding is not supported',
    undefined,
  ],
  [
    'originNotAllowed',
    appErrors.originNotAllowed(),
    403,
    'ORIGIN_NOT_ALLOWED',
    'Origin not allowed',
    undefined,
  ],
  [
    'hostNotAllowed',
    appErrors.hostNotAllowed('evil.example:4000'),
    403,
    'HOST_NOT_ALLOWED',
    'Host not allowed: evil.example:4000',
    undefined,
  ],
  [
    'routeNotFound',
    appErrors.routeNotFound('delete', '/api/nope'),
    404,
    'NOT_FOUND',
    'Route not found: DELETE /api/nope',
    undefined,
  ],
  [
    'agentNotFound',
    appErrors.agentNotFound('99-nobody'),
    404,
    'AGENT_NOT_FOUND',
    'Agent not found: 99-nobody',
    undefined,
  ],
  [
    'taskNotFound',
    appErrors.taskNotFound('SW-999'),
    404,
    'TASK_NOT_FOUND',
    'Task not found: SW-999',
    undefined,
  ],
  [
    'illegalAgentTransition',
    appErrors.illegalAgentTransition('04-backend-engineer', 'idle', 'completed'),
    409,
    'ILLEGAL_TRANSITION',
    'Illegal transition: idle → completed',
    { entity: 'agent', id: '04-backend-engineer', from: 'idle', to: 'completed' },
  ],
  [
    'illegalTaskTransition',
    appErrors.illegalTaskTransition('SW-123', 'todo', 'completed'),
    409,
    'ILLEGAL_TRANSITION',
    'Illegal task transition: todo → completed (task SW-123)',
    { entity: 'task', id: 'SW-123', from: 'todo', to: 'completed' },
  ],
  [
    'terminalTaskProgress',
    appErrors.terminalTaskProgress('IK-201', 'completed'),
    409,
    'ILLEGAL_TRANSITION',
    'Task IK-201 is completed; progress cannot change',
    { entity: 'task', id: 'IK-201', from: 'completed', to: 'completed' },
  ],
  [
    'taskExists',
    appErrors.taskExists('SW-123'),
    409,
    'TASK_EXISTS',
    'Task already exists: SW-123',
    { id: 'SW-123' },
  ],
  [
    'payloadTooLarge',
    appErrors.payloadTooLarge(),
    413,
    'PAYLOAD_TOO_LARGE',
    'Request body exceeds 100 KB',
    undefined,
  ],
  [
    'unknownAgent',
    appErrors.unknownAgent('99-ghost'),
    422,
    'UNKNOWN_AGENT',
    'Unknown agent: 99-ghost',
    { agentId: '99-ghost' },
  ],
  [
    'unknownProject',
    appErrors.unknownProject('All Projects'),
    422,
    'UNKNOWN_PROJECT',
    'Unknown project: All Projects',
    { project: 'All Projects' },
  ],
  [
    'unknownTask',
    appErrors.unknownTask('SW-999'),
    422,
    'UNKNOWN_TASK',
    'Unknown task: SW-999',
    { taskId: 'SW-999' },
  ],
  [
    'unknownTaskForCreate',
    appErrors.unknownTaskForCreate('SW-130'),
    422,
    'UNKNOWN_TASK',
    'Task SW-130 does not exist; include project to create it',
    { taskId: 'SW-130' },
  ],
  [
    'projectMismatch',
    appErrors.projectMismatch('SW-123', 'sellway', 'erp'),
    422,
    'PROJECT_MISMATCH',
    'Task SW-123 belongs to project sellway, not erp',
    { taskId: 'SW-123', taskProject: 'sellway', eventProject: 'erp' },
  ],
  ['internal', appErrors.internal(), 500, 'INTERNAL_ERROR', 'Internal server error', undefined],
  [
    'serviceUnavailable',
    appErrors.serviceUnavailable(health),
    503,
    'SERVICE_UNAVAILABLE',
    'Database is not available',
    health,
  ],
];

describe('appErrors (API_CONTRACTS §2.2)', () => {
  it.each(CASES)('%s', (_name, error, status, code, message, details) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.status).toBe(status);
    expect(error.status).toBe(ERROR_HTTP_STATUS[error.code]);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.details).toEqual(details);
  });

  it('covers every error code at least once', () => {
    const codes = new Set(CASES.map(([, error]) => error.code));
    codes.add(appErrors.validation([]).code);
    expect([...codes].sort()).toEqual(Object.keys(ERROR_HTTP_STATUS).sort());
  });

  it('uses U+2192 in transition messages', () => {
    expect(appErrors.illegalAgentTransition('x', 'offline', 'working').message).toContain('→');
  });
});

describe('appErrors.starting (ADR-035)', () => {
  it('is a 503 SERVICE_UNAVAILABLE with the starting details', () => {
    const details = {
      status: 'starting' as const,
      uptimeSec: 0,
      version: '0.1.0',
      time: health.time,
    };
    const error = appErrors.starting(details);
    expect(error.status).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.message).toBe('Server is starting');
    expect(toErrorBody(error)).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Server is starting', details },
    });
  });
});

describe('appErrors.validation', () => {
  it('one issue', () => {
    const error = appErrors.validation([{ path: 'progress', message: 'Too big' }]);
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Validation failed: progress: Too big');
    expect(error.details).toEqual([{ path: 'progress', message: 'Too big' }]);
  });

  it('several issues → (+n more), all issues in details', () => {
    const issues = [
      { path: 'foo', message: 'Unrecognized key' },
      { path: 'bar', message: 'Unrecognized key' },
      { path: 'type', message: 'Event type is required' },
    ];
    const error = appErrors.validation(issues);
    expect(error.message).toBe('Validation failed: foo: Unrecognized key (+2 more)');
    expect(error.details).toEqual(issues);
  });

  it('root path is shown as body (default) or query', () => {
    const root = [{ path: '', message: 'At least one field is required' }];
    expect(appErrors.validation(root).message).toBe(
      'Validation failed: body: At least one field is required',
    );
    expect(appErrors.validation(root, 'query').message).toBe(
      'Validation failed: query: At least one field is required',
    );
  });

  it('no issues still yields a readable message', () => {
    expect(appErrors.validation([]).message).toBe('Validation failed');
  });
});

describe('toErrorBody', () => {
  it('wraps code, message and details', () => {
    expect(toErrorBody(appErrors.unknownAgent('99-ghost'))).toEqual({
      error: {
        code: 'UNKNOWN_AGENT',
        message: 'Unknown agent: 99-ghost',
        details: { agentId: '99-ghost' },
      },
    });
  });

  it('omits details when there are none (never a stack)', () => {
    const body = toErrorBody(appErrors.internal());
    expect(body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(Object.keys(body.error)).toEqual(['code', 'message']);
    expect(JSON.stringify(body)).not.toContain('stack');
  });

  it('matches the REQ-102 / §3.5 example body', () => {
    expect(
      JSON.stringify(
        toErrorBody(appErrors.illegalAgentTransition('04-backend-engineer', 'idle', 'completed')),
      ),
    ).toBe(
      '{"error":{"code":"ILLEGAL_TRANSITION","message":"Illegal transition: idle → completed","details":{"entity":"agent","id":"04-backend-engineer","from":"idle","to":"completed"}}}',
    );
  });
});
