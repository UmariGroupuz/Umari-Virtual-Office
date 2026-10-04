// GET /api/events (§3.6, paged by `seq`) and POST /api/events (§3.7).
import { Router } from 'express';
import { eventsQuerySchema } from '@vo/shared';
import { appErrors } from '../../errors';
import { parseInput } from '../../services/eventService';
import { requireJson } from '../middleware/requireJson';
import type { ApiContext } from './context';

export function eventRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/events', (req, res) => {
    const query = parseInput(eventsQuerySchema, req.query, 'query');
    const repos = ctx.database.repos;
    const projectId = ctx.projects.resolveOptional(query.project);
    if (query.agentId !== undefined && repos.agents.getById(query.agentId) === null) {
      throw appErrors.unknownAgent(query.agentId);
    }
    const result = repos.events.list({
      ...(projectId === null ? {} : { projectId }),
      ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
      ...(query.taskId === undefined ? {} : { taskId: query.taskId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.before === undefined ? {} : { before: query.before }),
      limit: query.limit,
    });
    res.json({ data: result.events, page: { limit: query.limit, nextBefore: result.nextBefore } });
  });

  router.post('/events', requireJson, (req, res) => {
    res.status(201).json({ data: ctx.events.ingest(req.body, { origin: 'http' }) });
  });

  return router;
}
