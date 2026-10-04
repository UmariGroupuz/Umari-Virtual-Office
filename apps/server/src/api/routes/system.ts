// GET /api/health (§3.1), GET /api/projects (§3.2), GET /api/snapshot (§3.11).
import { Router } from 'express';
import { APP_VERSION, snapshotQuerySchema } from '@vo/shared';
import { appErrors } from '../../errors';
import { parseInput } from '../../services/eventService';
import type { ApiContext } from './context';

export function systemRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const details = {
      uptimeSec: Math.floor(process.uptime()),
      version: APP_VERSION,
      time: ctx.clock().toISOString(),
    };
    if (!ctx.database.ping()) {
      ctx.logger.error('db_error', { check: 'health' });
      throw appErrors.serviceUnavailable({ status: 'error', db: 'error', ...details });
    }
    res.json({ data: { status: 'ok', db: 'ok', ...details } });
  });

  router.get('/projects', (_req, res) => {
    res.json({ data: ctx.database.repos.projects.list() });
  });

  router.get('/snapshot', (req, res) => {
    const query = parseInput(snapshotQuerySchema, req.query, 'query');
    res.json({ data: ctx.snapshot.getSnapshot(query) });
  });

  return router;
}
