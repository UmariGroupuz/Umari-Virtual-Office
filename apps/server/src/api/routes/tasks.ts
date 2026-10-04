// GET /api/tasks (§3.8), POST /api/tasks (§3.9), PATCH /api/tasks/:id (§3.10).
import { Router } from 'express';
import { tasksQuerySchema } from '@vo/shared';
import { parseInput } from '../../services/eventService';
import { requireJson } from '../middleware/requireJson';
import type { ApiContext } from './context';

export function taskRoutes(ctx: ApiContext): Router {
  const router = Router();

  router.get('/tasks', (req, res) => {
    const query = parseInput(tasksQuerySchema, req.query, 'query');
    res.json({ data: ctx.tasks.listTasks(query) });
  });

  router.post('/tasks', requireJson, (req, res) => {
    res.status(201).json({ data: ctx.tasks.createTask(req.body) });
  });

  router.patch('/tasks/:id', requireJson, (req, res) => {
    res.json({ data: ctx.tasks.patchTask(String(req.params.id), req.body) });
  });

  return router;
}
