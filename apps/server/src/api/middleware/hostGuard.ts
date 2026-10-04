// Host-header guard (ADR-027 §1, API_CONTRACTS §0): DNS-rebinding protection for an unauthenticated local
// server. Used by the HTTP middleware and by Socket.IO `allowRequest`.
import type { RequestHandler } from 'express';
import { appErrors } from '../../errors';

const ALWAYS_ALLOWED = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Hostname part of a Host header (`[::1]:4000` → `[::1]`, `LocalHost:5173` → `localhost`). */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/** `localhost`, `127.0.0.1`, `[::1]` and the configured HOST are allowed (any port). */
export function isAllowedHost(hostHeader: string | undefined, configuredHost: string): boolean {
  if (hostHeader === undefined || hostHeader.trim() === '') return false;
  const hostname = hostnameOf(hostHeader);
  if (ALWAYS_ALLOWED.has(hostname)) return true;
  const configured = configuredHost.trim().toLowerCase();
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return bare === configured || hostname === configured;
}

export function hostGuard(configuredHost: string): RequestHandler {
  return (req, _res, next) => {
    const host = req.headers.host;
    if (isAllowedHost(host, configuredHost)) {
      next();
      return;
    }
    next(appErrors.hostNotAllowed(host ?? ''));
  };
}
