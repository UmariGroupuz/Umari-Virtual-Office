// EventService (ADR-008, API_CONTRACTS §9.8, ES §6): the single validate → transaction → broadcast path.
// Every state change of the server goes through `commitAndBroadcast`: the work runs synchronously inside
// one `BEGIN IMMEDIATE … COMMIT` (no `await` inside), and `office:event` is broadcast strictly after COMMIT.
// A thrown error rolls everything back and nothing is broadcast (REQ-029).
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_SOURCE,
  agentStatusPatchSchema,
  eventInputSchema,
  producerEventInputSchema,
  toValidationIssues,
  type Agent,
  type EventInput,
  type OfficeEvent,
  type OfficeEventPayload,
  type Task,
  type WriteResult,
} from '@vo/shared';
import type { DatabaseHandle, EventDraft, Repositories } from '../db/types';
import { AppError, appErrors } from '../errors';
import type { Logger } from '../logger';
import type { Broadcaster } from '../realtime/broadcaster';
import { decideEvent, type ForcedTransition } from './eventEffects';
import type { ProjectResolver } from './projectResolver';

export interface IngestContext {
  origin: 'http' | 'internal'; // http → producerEventInputSchema; internal → eventInputSchema
  force?: boolean;
}

export interface EventService {
  ingest(raw: unknown, ctx: IngestContext): OfficeEventPayload; // throws AppError
  patchAgentStatus(agentId: string, raw: unknown): WriteResult; // PATCH /api/agents/:id/status
  /** The only commit + broadcast path (ADR-008). `work` must be synchronous. */
  commitAndBroadcast<T>(
    work: (repos: Repositories) => { payloads: OfficeEventPayload[]; result: T },
  ): T;
}

export interface EventServiceDeps {
  database: DatabaseHandle;
  broadcaster: Broadcaster;
  logger: Logger;
  clock: () => Date;
  projects: ProjectResolver;
}

/** Zod parse → 400 `VALIDATION_ERROR` with every issue (API_CONTRACTS §2.2). */
export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  scope: 'body' | 'query' = 'body',
): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw appErrors.validation(toValidationIssues(result.error), scope);
  return result.data;
}

/** Stores an event draft with a fresh UUID and the server time. */
export function insertEvent(repos: Repositories, draft: EventDraft, now: string): OfficeEvent {
  return repos.events.insert({ ...draft, id: randomUUID(), createdAt: now });
}

/** Loggable identifiers of a rejected input — never the payload (ADR-018). */
function rejectionContext(raw: unknown): {
  type: string | null;
  agentId: string | null;
  source: string | null;
} {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const field = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' ? value.slice(0, 100) : null;
  };
  return {
    type: field('type'),
    agentId: field('agentId'),
    source: field('source') ?? DEFAULT_SOURCE,
  };
}

interface Applied {
  payload: OfficeEventPayload;
  forced: ForcedTransition[];
}

export function createEventService(deps: EventServiceDeps): EventService {
  const { database, broadcaster, logger, clock, projects } = deps;

  function commitAndBroadcast<T>(
    work: (repos: Repositories) => { payloads: OfficeEventPayload[]; result: T },
  ): T {
    let outcome: { payloads: OfficeEventPayload[]; result: T };
    try {
      outcome = database.transaction(work);
    } catch (error) {
      if (!(error instanceof AppError)) logger.error('db_error', { err: error });
      throw error;
    }
    for (const payload of outcome.payloads) {
      try {
        broadcaster.officeEvent(payload);
      } catch (error) {
        // The write is committed; a broadcast failure must not turn it into an error response.
        logger.error('broadcast_failed', { err: error, eventId: payload.event.id });
      }
    }
    return outcome.result;
  }

  function logForced(forced: readonly ForcedTransition[]): void {
    for (const transition of forced) logger.warn('forced_transition', { ...transition });
  }

  function decideAndApply(
    repos: Repositories,
    input: EventInput,
    agent: Agent | null,
    force: boolean,
    now: string,
  ): Applied {
    const projectId = projects.resolveOptional(input.project);
    const task: Task | null = input.taskId === undefined ? null : repos.tasks.getById(input.taskId);
    const decision = decideEvent({
      input,
      source: input.source ?? DEFAULT_SOURCE,
      agent,
      task,
      projectId,
      now,
      force,
    });
    if (decision.kind === 'reject') throw decision.error;

    const updatedAgent =
      agent !== null && decision.agentPatch !== null
        ? repos.agents.update(agent.id, decision.agentPatch, now)
        : null;
    let updatedTask: Task | null = null;
    const effect = decision.taskEffect;
    if (effect?.op === 'create') updatedTask = repos.tasks.insert(effect.task, now);
    else if (effect?.op === 'update')
      updatedTask = repos.tasks.update(effect.id, effect.patch, now);
    const event = insertEvent(repos, decision.event, now);
    return { payload: { event, agent: updatedAgent, task: updatedTask }, forced: decision.forced };
  }

  function loadAgent(repos: Repositories, agentId: string | undefined): Agent | null {
    if (agentId === undefined) return null;
    const agent = repos.agents.getById(agentId);
    if (agent === null) throw appErrors.unknownAgent(agentId);
    return agent;
  }

  return {
    commitAndBroadcast,

    ingest(raw, ctx) {
      try {
        const schema = ctx.origin === 'http' ? producerEventInputSchema : eventInputSchema;
        const input: EventInput = parseInput(schema, raw);
        const applied = commitAndBroadcast((repos) => {
          const now = clock().toISOString();
          // Check order (ES §6 step 5): agent → project → task → decision (422 before 409).
          const agent = loadAgent(repos, input.agentId);
          const result = decideAndApply(repos, input, agent, ctx.force ?? false, now);
          return { payloads: [result.payload], result };
        });
        logForced(applied.forced);
        return applied.payload;
      } catch (error) {
        if (error instanceof AppError && ctx.origin === 'http') {
          logger.warn('event_rejected', { code: error.code, ...rejectionContext(raw) });
        }
        throw error;
      }
    },

    patchAgentStatus(agentId, raw) {
      try {
        const body = parseInput(agentStatusPatchSchema, raw);
        const applied = commitAndBroadcast<{ write: WriteResult; forced: ForcedTransition[] }>(
          (repos) => {
            const now = clock().toISOString();
            const agent = repos.agents.getById(agentId);
            if (agent === null) throw appErrors.agentNotFound(agentId);
            const input: EventInput = {
              type: 'agent.status.changed',
              source: body.source,
              agentId,
              status: body.status,
              ...(body.project === undefined ? {} : { project: body.project }),
              ...(body.taskId === undefined ? {} : { taskId: body.taskId }),
              ...(body.action === undefined ? {} : { action: body.action }),
              ...(body.message === undefined ? {} : { message: body.message }),
            };
            if (body.status === agent.status) {
              // Same status: rejections (422 / 409) still apply, then the decision is discarded (REQ-004).
              const projectId = projects.resolveOptional(body.project);
              const task = body.taskId === undefined ? null : repos.tasks.getById(body.taskId);
              const decision = decideEvent({
                input,
                source: body.source,
                agent,
                task,
                projectId,
                now,
                force: body.force,
              });
              if (decision.kind === 'reject') throw decision.error;
              const noop: WriteResult = { event: null, agent, task: null };
              return { payloads: [], result: { write: noop, forced: [] } };
            }
            const result = decideAndApply(repos, input, agent, body.force, now);
            return {
              payloads: [result.payload],
              result: { write: result.payload, forced: result.forced },
            };
          },
        );
        logForced(applied.forced);
        return applied.write;
      } catch (error) {
        if (error instanceof AppError) {
          logger.warn('event_rejected', {
            code: error.code,
            type: 'agent.status.changed',
            agentId,
            source: rejectionContext(raw).source,
          });
        }
        throw error;
      }
    },
  };
}
