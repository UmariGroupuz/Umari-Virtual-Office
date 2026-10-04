// Typed REST client (API-C §0, §10.3, ADR-021): unwraps `{ data }`, maps error envelopes to ApiError,
// adds client-only codes for network failures and timeouts.
import { API_PREFIX, LIMITS, type ApiPage, type ErrorCode } from '@vo/shared';

/** Client-only codes in addition to the server's ErrorCode (API-C §10.3). */
export type ClientErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'ABORTED' | 'BAD_RESPONSE';
export type ApiErrorCode = ErrorCode | ClientErrorCode;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH';

export interface RequestOptions {
  /** Default 10 s (LIMITS.REQUEST_TIMEOUT_MS); health checks use 5 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Envelope<T> {
  data: T;
  page?: ApiPage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseErrorEnvelope(
  body: unknown,
): { code: ErrorCode; message: string; details?: unknown } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const { code, message, details } = body.error;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { code: code as ErrorCode, message, details };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Full envelope (for paged lists). Throws ApiError for every failure. */
export async function apiRequestEnvelope<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  const timeoutMs = options.timeoutMs ?? LIMITS.REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  const init: RequestInit = {
    method,
    headers:
      body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  try {
    let response: Response;
    try {
      response = await fetch(`${API_PREFIX}${path}`, init);
    } catch {
      if (timedOut) throw new ApiError(0, 'TIMEOUT', 'Request timed out');
      if (external?.aborted) throw new ApiError(0, 'ABORTED', 'Request aborted');
      throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
    }

    let parsed: unknown;
    try {
      parsed = await readJson(response);
    } catch {
      if (timedOut) throw new ApiError(0, 'TIMEOUT', 'Request timed out');
      if (external?.aborted) throw new ApiError(0, 'ABORTED', 'Request aborted');
      throw new ApiError(response.status, 'NETWORK_ERROR', 'Network error');
    }

    if (!response.ok) {
      const envelope = parseErrorEnvelope(parsed);
      if (envelope) {
        throw new ApiError(response.status, envelope.code, envelope.message, envelope.details);
      }
      throw new ApiError(
        response.status,
        'BAD_RESPONSE',
        `Unexpected response from the server (HTTP ${response.status})`,
      );
    }
    if (!isRecord(parsed) || !('data' in parsed)) {
      throw new ApiError(response.status, 'BAD_RESPONSE', 'Unexpected response from the server');
    }
    const envelope: Envelope<T> = { data: parsed.data as T };
    if (isRecord(parsed.page)) envelope.page = parsed.page as unknown as ApiPage;
    return envelope;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/** API-C §10.3: returns `data`. */
export async function apiRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const envelope = await apiRequestEnvelope<T>(method, path, body, options);
  return envelope.data;
}

/** True when the failure means "the backend cannot be reached" rather than "the request was refused". */
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return true;
  // A dev proxy answers 5xx without our envelope when the API process is down.
  return error.code === 'BAD_RESPONSE' && error.status >= 500;
}

export function isAborted(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'ABORTED';
}

/** Readable detail line for inline errors (UX §11.4): server message or "Network error". */
export function errorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') return 'Network error';
    return error.message;
  }
  return 'Network error';
}

export function toQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
