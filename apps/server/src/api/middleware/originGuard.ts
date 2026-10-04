// Browser Origin rule (ADR-035 §1 for Socket.IO, ADR-037 SEC-2 for state-changing HTTP requests).
// Allowed: no Origin (non-browser producers, curl, tests), an origin listed in CORS_ORIGINS, or the server's
// own origin (`http(s)://<Host>`, one-port mode). Everything else is refused.
import type { RequestHandler } from 'express';
import { appErrors } from '../../errors';

export function isAllowedOrigin(
  origin: string,
  hostHeader: string | undefined,
  corsOrigins: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(origin); // "null" (sandboxed/opaque origins) does not parse → refused
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (corsOrigins.includes(url.origin)) return true;
  return hostHeader !== undefined && url.host.toLowerCase() === hostHeader.trim().toLowerCase();
}

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 403 `ORIGIN_NOT_ALLOWED` for a state-changing request whose `Origin` fails the rule. Reads (GET/HEAD) and
 * CORS preflights (OPTIONS) are not affected: CORS already keeps foreign pages from reading responses.
 */
export function originGuard(corsOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.headers.origin;
    if (
      !STATE_CHANGING.has(req.method) ||
      origin === undefined ||
      isAllowedOrigin(origin, req.headers.host, corsOrigins)
    ) {
      next();
      return;
    }
    next(appErrors.originNotAllowed());
  };
}
