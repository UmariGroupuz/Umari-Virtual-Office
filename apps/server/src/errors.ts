// Application errors (ADR-020/023). Messages are part of the contract: API_CONTRACTS §2.2, shown verbatim
// by the UI. Never put stack traces, SQL or payload content beyond the offending identifier in a message.
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  type AgentStatus,
  type ApiErrorBody,
  type ErrorCode,
  type HealthErrorDetails,
  type IllegalTransitionDetails,
  type ProjectMismatchDetails,
  type TaskStatus,
  type ValidationIssue,
} from '@vo/shared';

/** `details` of the 503 returned while the server is starting (ADR-035 §2). */
export interface StartingDetails {
  status: 'starting';
  uptimeSec: number;
  version: string;
  time: string;
}

export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function create(code: ErrorCode, message: string, details?: unknown): AppError {
  return new AppError(ERROR_HTTP_STATUS[code], code, message, details);
}

/** `Validation failed: <path>: <message>` for the first issue, `(+n more)` for the rest (§2.2). */
function validationMessage(issues: readonly ValidationIssue[], scope: 'body' | 'query'): string {
  const [first] = issues;
  if (first === undefined) return 'Validation failed';
  const path = first.path === '' ? scope : first.path;
  const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
  return `Validation failed: ${path}: ${first.message}${more}`;
}

function transitionDetails(
  entity: IllegalTransitionDetails['entity'],
  id: string,
  from: string,
  to: string,
): IllegalTransitionDetails {
  return { entity, id, from, to };
}

export const appErrors = {
  invalidJson(kind: 'content-type' | 'parse' | 'encoding'): AppError {
    const messages = {
      'content-type': 'Content-Type must be application/json',
      parse: 'Request body is not valid JSON',
      encoding: 'Content-Encoding is not supported', // compressed bodies (ADR-037, SEC-3)
    } as const;
    return create(ERROR_CODES.INVALID_JSON, messages[kind]);
  },
  validation(issues: ValidationIssue[], scope: 'body' | 'query' = 'body'): AppError {
    return create(ERROR_CODES.VALIDATION_ERROR, validationMessage(issues, scope), issues);
  },
  hostNotAllowed(host: string): AppError {
    return create(ERROR_CODES.HOST_NOT_ALLOWED, `Host not allowed: ${host}`);
  },
  /** State-changing `/api` request from a foreign browser origin (ADR-037, SEC-2). */
  originNotAllowed(): AppError {
    return create(ERROR_CODES.ORIGIN_NOT_ALLOWED, 'Origin not allowed');
  },
  routeNotFound(method: string, path: string): AppError {
    return create(ERROR_CODES.NOT_FOUND, `Route not found: ${method.toUpperCase()} ${path}`);
  },
  agentNotFound(id: string): AppError {
    return create(ERROR_CODES.AGENT_NOT_FOUND, `Agent not found: ${id}`);
  },
  taskNotFound(id: string): AppError {
    return create(ERROR_CODES.TASK_NOT_FOUND, `Task not found: ${id}`);
  },
  illegalAgentTransition(id: string, from: AgentStatus, to: AgentStatus): AppError {
    return create(
      ERROR_CODES.ILLEGAL_TRANSITION,
      `Illegal transition: ${from} → ${to}`,
      transitionDetails('agent', id, from, to),
    );
  },
  illegalTaskTransition(id: string, from: TaskStatus, to: TaskStatus): AppError {
    return create(
      ERROR_CODES.ILLEGAL_TRANSITION,
      `Illegal task transition: ${from} → ${to} (task ${id})`,
      transitionDetails('task', id, from, to),
    );
  },
  terminalTaskProgress(id: string, status: TaskStatus): AppError {
    return create(
      ERROR_CODES.ILLEGAL_TRANSITION,
      `Task ${id} is ${status}; progress cannot change`,
      transitionDetails('task', id, status, status),
    );
  },
  taskExists(id: string): AppError {
    return create(ERROR_CODES.TASK_EXISTS, `Task already exists: ${id}`, { id });
  },
  payloadTooLarge(): AppError {
    return create(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body exceeds 100 KB');
  },
  unknownAgent(id: string): AppError {
    return create(ERROR_CODES.UNKNOWN_AGENT, `Unknown agent: ${id}`, { agentId: id });
  },
  unknownProject(ref: string): AppError {
    return create(ERROR_CODES.UNKNOWN_PROJECT, `Unknown project: ${ref}`, { project: ref });
  },
  unknownTask(id: string): AppError {
    return create(ERROR_CODES.UNKNOWN_TASK, `Unknown task: ${id}`, { taskId: id });
  },
  unknownTaskForCreate(id: string): AppError {
    return create(
      ERROR_CODES.UNKNOWN_TASK,
      `Task ${id} does not exist; include project to create it`,
      { taskId: id },
    );
  },
  projectMismatch(taskId: string, taskProject: string, eventProject: string): AppError {
    const details: ProjectMismatchDetails = { taskId, taskProject, eventProject };
    return create(
      ERROR_CODES.PROJECT_MISMATCH,
      `Task ${taskId} belongs to project ${taskProject}, not ${eventProject}`,
      details,
    );
  },
  internal(): AppError {
    return create(ERROR_CODES.INTERNAL_ERROR, 'Internal server error');
  },
  serviceUnavailable(details: HealthErrorDetails): AppError {
    return create(ERROR_CODES.SERVICE_UNAVAILABLE, 'Database is not available', details);
  },
  /** Listen-first boot (ADR-035 §2): the port is bound but seeding / demo recovery has not finished. */
  starting(details: StartingDetails): AppError {
    return create(ERROR_CODES.SERVICE_UNAVAILABLE, 'Server is starting', details);
  },
};

/** Error envelope `{ error: { code, message, details? } }` (API_CONTRACTS §0); `details` omitted when absent. */
export function toErrorBody(error: AppError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
