// GET /api/agents (§3.3), GET /api/agents/:id (§3.4), PATCH /api/agents/:id/status (§3.5).
import { Router } from 'express';
import { agentsQuerySchema } from '@vo/shared';
import { appErrors } from '../../errors';
import { parseInput } from '../../services/eventService';
import { requireJson } from '../middleware/requireJson';
import type { ApiContext } from './context';

export function agentRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/agents', (req, res) => {
    const query = parseInput(agentsQuerySchema, req.query, 'query');
    const projectId = ctx.projects.resolveOptional(query.project);
    res.json({ data: ctx.database.repos.agents.list(projectId === null ? {} : { projectId }) });
  });

  router.get('/agents/:id', (req, res) => {
    const agent = ctx.database.repos.agents.getById(String(req.params.id));
    if (agent === null) throw appErrors.agentNotFound(String(req.params.id));
    res.json({ data: agent });
  });

  router.patch('/agents/:id/status', requireJson, (req, res) => {
    res.json({ data: ctx.events.patchAgentStatus(String(req.params.id), req.body) });
  });

  return router;
}
