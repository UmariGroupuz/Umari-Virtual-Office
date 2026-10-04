// GET /api/demo (§3.12), POST /api/demo/start (§3.13), POST /api/demo/stop (§3.14).
import { Router } from 'express';
import { demoStopSchema } from '@vo/shared';
import { parseInput } from '../../services/eventService';
import { requireJson } from '../middleware/requireJson';
import type { ApiContext } from './context';

export function demoRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/demo', (_req, res) => {
    res.json({ data: ctx.demo.getState() });
  });

  router.post('/demo/start', requireJson, (req, res) => {
    res.json({ data: ctx.demo.start(req.body) });
  });

  router.post('/demo/stop', requireJson, (req, res) => {
    parseInput(demoStopSchema, req.body);
    res.json({ data: ctx.demo.stop('user') });
  });

  return router;
}
