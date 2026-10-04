// Any method on an unknown `/api/*` path → 404 NOT_FOUND JSON, never HTML and never 405 (REQ-028). Also used at
// app level for every other unmatched path (QA-4), so all 404s keep the framing/security headers.
import type { RequestHandler } from 'express';
import { appErrors } from '../../errors';

export const apiNotFound: RequestHandler = (req, _res, next) => {
  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
  next(appErrors.routeNotFound(req.method, path));
};
