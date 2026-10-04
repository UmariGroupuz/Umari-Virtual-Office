// The error envelope (ADR-020/023, API_CONTRACTS §0, §2): AppError → its status/body; body-parser errors →
// 400 INVALID_JSON / 413 PAYLOAD_TOO_LARGE; anything else → 500 INTERNAL_ERROR (never a stack or SQL).
// Logs `request_failed {status, code, method, route}`: 4xx warn, 5xx error with the error (stack).
import type { ErrorRequestHandler, Request } from 'express';
import { ZodError } from 'zod';
import { toValidationIssues } from '@vo/shared';
import { AppError, appErrors, toErrorBody } from '../../errors';
import type { Logger } from '../../logger';

interface BodyParserError {
  type?: unknown;
  status?: unknown;
  code?: unknown;
  expose?: unknown;
}

/** zlib (`Z_DATA_ERROR`, …) and brotli (`ERR__ERROR_…`) stream errors — reachable only if inflation is enabled. */
const DECOMPRESSION_ERROR_CODE = /^(Z_[A-Z_]+|ERR__ERROR_[A-Z0-9_]+|ERR_BROTLI_[A-Z_]+)$/;

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return appErrors.validation(toValidationIssues(error));
  const parserError = (typeof error === 'object' && error !== null ? error : {}) as BodyParserError;
  switch (parserError.type) {
    case 'entity.too.large':
      return appErrors.payloadTooLarge();
    case 'charset.unsupported':
      return appErrors.invalidJson('content-type');
    case 'encoding.unsupported':
      return appErrors.invalidJson('encoding');
    case 'entity.parse.failed':
    case 'entity.verify.failed':
    case 'request.aborted':
    case 'request.size.invalid':
    case 'stream.encoding.set':
      return appErrors.invalidJson('parse');
    default:
      break;
  }
  // A malformed request body must never become a 500 (ADR-037, SEC-3): zlib errors and any client error that
  // body-parser marks as exposable (`http-errors` 4xx) are a bad body.
  if (typeof parserError.code === 'string' && DECOMPRESSION_ERROR_CODE.test(parserError.code)) {
    return appErrors.invalidJson('parse');
  }
  const status = typeof parserError.status === 'number' ? parserError.status : 0;
  if (parserError.expose === true && status >= 400 && status < 500)
    return appErrors.invalidJson('parse');
  return appErrors.internal();
}

/** Route pattern when Express matched one (`/api/agents/:id`), else the path without the query. */
export function routeOf(req: Request): string {
  const pattern = (req.route as { path?: unknown } | undefined)?.path;
  return typeof pattern === 'string'
    ? `${req.baseUrl}${pattern}`
    : (req.originalUrl.split('?')[0] ?? '');
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const appError = toAppError(error);
    const context = {
      status: appError.status,
      code: appError.code,
      method: req.method,
      route: routeOf(req),
    };
    if (appError.status >= 500) logger.error('request_failed', { ...context, err: error });
    else logger.warn('request_failed', context);
    // Error envelopes are never cached or sniffed, on any path (CR-19).
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.status(appError.status).json(toErrorBody(appError));
  };
}
