// One-port mode (ADR-013): serve `apps/web/dist` with an SPA fallback for GET/HEAD requests outside `/api`
// and `/socket.io`. A missing build logs `warn` and the server keeps serving the API only.
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { Logger } from '../logger';

/** Returns true when the web build was mounted. */
export function mountWebApp(
  app: Express,
  options: { webDistPath: string; logger: Logger },
): boolean {
  const indexHtml = path.join(options.webDistPath, 'index.html');
  if (!existsSync(indexHtml)) {
    options.logger.warn('web_dist_missing', { webDistPath: options.webDistPath });
    return false;
  }
  app.use(express.static(options.webDistPath, { index: 'index.html' }));
  app.use((req, res, next) => {
    const isPage =
      (req.method === 'GET' || req.method === 'HEAD') &&
      !/^\/(api|socket\.io)(\/|$)/.test(req.path);
    if (!isPage) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
  return true;
}
