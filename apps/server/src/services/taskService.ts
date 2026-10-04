// Tasks API service (API_CONTRACTS §3.8–3.10, ADR-024). Writes go through EventService.commitAndBroadcast.
// Check order: schema (+ self-block) 400 → path id 404 → project / assignee / blockedBy 422 →
// TASK_EXISTS 409 (explicit id) → no-op → legality 409.
import {
  taskCreateSchema,
  taskPatchSchema,
  type OfficeEventPayload,
  type Task,
  type TasksQueryInput,
  type WriteResult,
} from '@vo/shared';
import type { DatabaseHandle, Repositories } from '../db/types';
import { appErrors } from '../errors';
import type { Logger } from '../logger';
import type { ForcedTransition } from './eventEffects';
import { insertEvent, parseInput, type EventService } from './eventService';
import type { ProjectResolver } from './projectResolver';
import { checkSelfBlock, decideTaskCreate, decideTaskPatch } from './taskRules';

export interface TaskService {
  listTasks(query: TasksQueryInput): Task[];
  createTask(raw: unknown): OfficeEventPayload;
  patchTask(id: string, raw: unknown): WriteResult;
}

export interface TaskServiceDeps {
  database: DatabaseHandle;
  events: EventService;
  projects: ProjectResolver;
  logger: Logger;
  clock: () => Date;
}

function assertAgentExists(repos: Repositories, agentId: string | null | undefined): void {
  if (typeof agentId === 'string' && repos.agents.getById(agentId) === null) {
    throw appErrors.unknownAgent(agentId);
  }
}

function assertTasksExist(repos: Repositories, ids: readonly string[] | undefined): void {
  if (ids === undefined || ids.length === 0) return;
  const existing = repos.tasks.existingIds(ids);
  const missing = ids.find((id) => !existing.has(id));
  if (missing !== undefined) throw appErrors.unknownTask(missing);
}

/** `<taskPrefix>-<n>` with n = 1 + the highest numeric suffix of that prefix (ADR-024). */
function generateTaskId(repos: Repositories, prefix: string): string {
  let n = (repos.tasks.maxNumericSuffix(prefix) ?? 0) + 1;
  // Defensive: never collide with an id like `SW-0007` that has the same numeric value.
  while (repos.tasks.getById(`${prefix}-${n}`) !== null) n += 1;
  return `${prefix}-${n}`;
}

export function createTaskService(deps: TaskServiceDeps): TaskService {
  const { database, events, projects, logger, clock } = deps;

  const logForced = (forced: ForcedTransition | null): void => {
    if (forced !== null) logger.warn('forced_transition', { ...forced });
  };

  return {
    listTasks(query) {
      const repos = database.repos;
      const projectId = projects.resolveOptional(query.project);
      assertAgentExists(repos, query.agentId);
      return repos.tasks.list({
        ...(projectId === null ? {} : { projectId }),
        ...(query.agentId === undefined ? {} : { agentId: query.agentId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        limit: query.limit,
      });
    },

    createTask(raw) {
      const body = parseInput(taskCreateSchema, raw);
      return events.commitAndBroadcast((repos) => {
        const now = clock().toISOString();
        const projectId = projects.resolveId(body.project);
        assertAgentExists(repos, body.assignedAgentId);
        assertTasksExist(repos, body.blockedBy);
        let id: string;
        if (body.id === undefined) {
          const prefix = projects.projects.find((p) => p.id === projectId)?.taskPrefix ?? projectId;
          id = generateTaskId(repos, prefix);
        } else {
          if (repos.tasks.getById(body.id) !== null) throw appErrors.taskExists(body.id);
          id = body.id;
        }
        const decision = decideTaskCreate({ body, projectId, id, now });
        if (decision.kind === 'reject') throw decision.error;
        const task = repos.tasks.insert(decision.task, now);
        const event = insertEvent(repos, decision.event, now);
        const payload: OfficeEventPayload = { event, agent: null, task };
        return { payloads: [payload], result: payload };
      });
    },

    patchTask(id, raw) {
      const body = parseInput(taskPatchSchema, raw);
      // The self-block rule needs only the path id: a 400 before 404/422 (ADR-030 item 7, ADR-032).
      const selfBlock = checkSelfBlock(id, body);
      if (selfBlock !== null) throw selfBlock;
      const outcome = events.commitAndBroadcast<{
        write: WriteResult;
        forced: ForcedTransition | null;
      }>((repos) => {
        const now = clock().toISOString();
        const task = repos.tasks.getById(id);
        if (task === null) throw appErrors.taskNotFound(id);
        assertAgentExists(repos, body.assignedAgentId);
        assertTasksExist(repos, body.blockedBy);
        const decision = decideTaskPatch({ task, body, now });
        if (decision.kind === 'reject') throw decision.error;
        if (decision.kind === 'noop') {
          const noop: WriteResult = { event: null, agent: null, task };
          return { payloads: [], result: { write: noop, forced: null } };
        }
        const updated = repos.tasks.update(id, decision.patch, now);
        const event = insertEvent(repos, decision.event, now);
        const payload: OfficeEventPayload = { event, agent: null, task: updated };
        return {
          payloads: [payload],
          result: { write: payload, forced: decision.forced },
        };
      });
      logForced(outcome.forced);
      return outcome.write;
    },
  };
}
