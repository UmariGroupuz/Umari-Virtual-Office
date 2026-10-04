// `/api` router (API_CONTRACTS §0, §3): CORS allowlist, every endpoint, JSON 404. The no-store/nosniff headers
// are set at app level (`apiHeaders` in app.ts) so that guard refusals carry them too (CR-19).
import cors from 'cors';
import { Router } from 'express';
import { errorHandler } from './middleware/errorHandler';
import { apiNotFound } from './middleware/notFound';
import { agentRoutes } from './routes/agents';
import type { ApiContext } from './routes/context';
import { demoRoutes } from './routes/demo';
import { eventRoutes } from './routes/events';
import { systemRoutes } from './routes/system';
import { taskRoutes } from './routes/tasks';

export type { ApiContext } from './routes/context';

export function createApiRouter(ctx: ApiContext, corsOrigins: readonly string[]): Router {
  const router = Router();
  router.use(
    cors({
      origin: [...corsOrigins],
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      credentials: false,
    }),
  );
  router.use(systemRoutes(ctx));
  router.use(agentRoutes(ctx));
  router.use(eventRoutes(ctx));
  router.use(taskRoutes(ctx));
  router.use(demoRoutes(ctx));
  router.use(apiNotFound);
  // Handled here (not only at app level) so `request_failed.route` keeps the `/api` prefix.
  router.use(errorHandler(ctx.logger));
  return router;
}
