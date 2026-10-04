// Demo Mode engine (ADR-011, API_CONTRACTS §3.12–3.14, §9.6; REQ-110–113).
// - start: one transaction persists the `demo` setting (snapshot of all agents/tasks + startSeq) and writes a
//   `system.info` event; after commit: office:event, demo:state; then setTimeout-chained ticks.
// - tick: the pure storyline (`nextDemoBeat`) against the current DB state; every input goes through
//   EventService.ingest (origin internal, source "demo"); the first rejection is logged and ends the beat.
// - stop / graceful shutdown / boot recovery: `restoreDemoSnapshot` in one transaction — user-touched
//   entities (derived from the event log, ADR-011) are kept, the rest restored (version + 1), demo-created
//   tasks deleted; then office:event, demo:state, office:resync.
import {
  demoStartSchema,
  type Agent,
  type DemoRestoreSummary,
  type DemoState,
  type DemoStopResult,
  type JsonObject,
  type JsonValue,
  type Task,
} from '@vo/shared';
import type { DatabaseHandle, EventDraft, Repositories } from '../db/types';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import type { Broadcaster } from '../realtime/broadcaster';
import { INITIAL_DEMO_CURSOR, nextDemoBeat, type DemoCursor, type DemoWorld } from './demoScript';
import { insertEvent, parseInput, type EventService } from './eventService';
import type { ProjectResolver } from './projectResolver';
import { jsonEqual } from './taskRules';

export const DEMO_SETTING_KEY = 'demo';

export interface DemoService {
  getState(): DemoState;
  start(raw: unknown): DemoState;
  stop(reason: 'user' | 'shutdown'): DemoStopResult;
  recoverOnBoot(): DemoRestoreSummary | null;
  /** Stops the timer without restoring (the persisted setting stays for boot recovery). */
  dispose(): void;
  /** Runs the next beat immediately (the timer calls the same function; used by tests). */
  tick(): void;
}

export interface DemoServiceDeps {
  database: DatabaseHandle;
  events: EventService;
  broadcaster: Broadcaster;
  logger: Logger;
  clock: () => Date;
  projects: ProjectResolver;
  defaultIntervalMs: number;
}

/** Persisted value of the `demo` setting (API_CONTRACTS §9.6). */
export interface DemoSetting {
  active: true;
  intervalMs: number;
  startedAt: string;
  startSeq: number;
  snapshot: { agents: Agent[]; tasks: Task[] };
}

interface Session {
  intervalMs: number;
  startedAt: string;
  startSeq: number;
  cursor: DemoCursor;
  timer: ReturnType<typeof setTimeout> | null;
}

const AGENT_RESTORE_FIELDS = [
  'status',
  'currentProject',
  'currentTask',
  'taskId',
  'progress',
  'startedAt',
  'lastActivityAt',
  'currentAction',
  'lastMessage',
  'online',
  'metadata',
] as const satisfies readonly (keyof Agent)[];

const TASK_RESTORE_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'progress',
  'assignedAgentId',
  'startedAt',
  'completedAt',
  'blockedBy',
  'metadata',
] as const satisfies readonly (keyof Task)[];

function differs<T extends object>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  return fields.some((field) => !jsonEqual(a[field] as JsonValue, b[field] as JsonValue));
}

function isDemoSetting(value: JsonValue | null): value is JsonValue & DemoSetting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value.snapshot;
  return (
    typeof value.startSeq === 'number' &&
    typeof value.intervalMs === 'number' &&
    typeof value.startedAt === 'string' &&
    typeof snapshot === 'object' &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    Array.isArray(snapshot.agents) &&
    Array.isArray(snapshot.tasks)
  );
}

function allTasks(repos: Repositories): Task[] {
  return repos.tasks.list({ limit: Math.max(repos.tasks.count(), 1) });
}

function systemInfo(message: string, metadata: JsonObject): EventDraft {
  return {
    type: 'system.info',
    source: 'system',
    agentId: null,
    project: null,
    taskId: null,
    status: null,
    action: null,
    message,
    severity: 'info',
    progress: null,
    metadata,
    occurredAt: null,
    forced: false,
  };
}

/**
 * ADR-011 restore, inside the caller's transaction. User-touched = non-demo events after `startSeq`
 * (agents: `agent.*` events; tasks: any event type).
 */
export function restoreDemoSnapshot(
  repos: Repositories,
  setting: Pick<DemoSetting, 'startSeq' | 'snapshot'>,
  now: string,
  /** Receives the ids of demo tasks kept only because a surviving row references them (CR-9). */
  keptReferences: string[] = [],
): DemoRestoreSummary {
  const touched = repos.events.touchedSince(setting.startSeq);
  const summary: DemoRestoreSummary = {
    agentsRestored: 0,
    agentsKept: 0,
    tasksRestored: 0,
    tasksKept: 0,
    tasksDeleted: 0,
  };
  for (const saved of setting.snapshot.agents) {
    if (touched.agentIds.has(saved.id)) {
      summary.agentsKept += 1;
      continue;
    }
    const current = repos.agents.getById(saved.id);
    if (current !== null && differs(current, saved, AGENT_RESTORE_FIELDS)) {
      repos.agents.replace(saved, now);
      summary.agentsRestored += 1;
    }
  }
  const snapshotTaskIds = new Set(setting.snapshot.tasks.map((task) => task.id));
  for (const saved of setting.snapshot.tasks) {
    if (touched.taskIds.has(saved.id)) {
      summary.tasksKept += 1;
      continue;
    }
    const current = repos.tasks.getById(saved.id);
    if (current !== null && differs(current, saved, TASK_RESTORE_FIELDS)) {
      repos.tasks.replace(saved, now);
      summary.tasksRestored += 1;
    }
  }
  const deletable = new Map<string, Task>();
  for (const task of allTasks(repos)) {
    if (snapshotTaskIds.has(task.id)) continue;
    // Defence in depth: only rows the demo created (metadata.demo, set by decideEvent for source "demo")
    // are ever deleted; any other task absent from the snapshot is kept.
    if (touched.taskIds.has(task.id) || task.metadata.demo !== true) {
      summary.tasksKept += 1; // created or changed by the user during the demo
    } else {
      deletable.set(task.id, task);
    }
  }
  // CR-9 / ADR-035 §7: never leave a dangling reference. A demo task still referenced by a surviving agent's
  // `taskId` or a surviving task's `blockedBy` is kept (transitively through its own `blockedBy`).
  const pending: string[] = [];
  for (const agent of repos.agents.list()) if (agent.taskId !== null) pending.push(agent.taskId);
  for (const task of allTasks(repos)) if (!deletable.has(task.id)) pending.push(...task.blockedBy);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const task = deletable.get(id);
    if (task === undefined) continue;
    deletable.delete(id);
    keptReferences.push(id);
    summary.tasksKept += 1;
    pending.push(...task.blockedBy);
  }
  for (const id of deletable.keys()) {
    if (repos.tasks.delete(id)) summary.tasksDeleted += 1;
  }
  return summary;
}

/** `1 agent`, `2 agents`, `0 agents` (ADR-037, QA-3). */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** API_CONTRACTS §3.14 summary text, with singular/plural agreement. */
export function stoppedMessage(summary: DemoRestoreSummary): string {
  return `Demo mode stopped: ${countOf(summary.agentsRestored, 'agent')} and ${countOf(summary.tasksRestored, 'task')} restored, ${countOf(summary.tasksDeleted, 'demo task')} removed`;
}

export function createDemoService(deps: DemoServiceDeps): DemoService {
  const { database, events, broadcaster, logger, clock, projects } = deps;
  let session: Session | null = null;

  function getState(): DemoState {
    return session === null
      ? { active: false, intervalMs: deps.defaultIntervalMs, startedAt: null }
      : { active: true, intervalMs: session.intervalMs, startedAt: session.startedAt };
  }

  function safely(name: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      logger.error('broadcast_failed', { err: error, message: name });
    }
  }

  function clearTimer(): void {
    if (session?.timer != null) clearTimeout(session.timer);
    if (session !== null) session.timer = null;
  }

  function schedule(current: Session): void {
    current.timer = setTimeout(() => {
      current.timer = null;
      if (session !== current) return;
      tick();
      if (session === current) schedule(current);
    }, current.intervalMs);
    current.timer.unref();
  }

  function tick(): void {
    const current = session;
    if (current === null) return;
    let inputs;
    try {
      const repos = database.repos;
      const marker = `-D${current.startSeq}-`;
      const world: DemoWorld = {
        agents: repos.agents.list(),
        tasks: new Map(
          allTasks(repos)
            .filter((task) => task.id.includes(marker))
            .map((task) => [task.id, task]),
        ),
        touchedAgentIds: repos.events.touchedSince(current.startSeq).agentIds,
        projects: projects.projects,
        sessionKey: current.startSeq,
      };
      const beat = nextDemoBeat(world, current.cursor);
      current.cursor = beat.cursor;
      inputs = beat.inputs;
    } catch (error) {
      logger.error('demo_tick_failed', { err: error });
      return;
    }
    for (const input of inputs) {
      try {
        events.ingest(input, { origin: 'internal' });
      } catch (error) {
        if (error instanceof AppError) {
          logger.warn('demo_event_rejected', {
            code: error.code,
            type: input.type,
            agentId: input.agentId ?? null,
          });
        } else {
          logger.error('demo_tick_failed', { err: error });
        }
        break; // skip the rest of this beat (API_CONTRACTS §9.5)
      }
    }
  }

  /** Restore + delete the setting + summary event, in one transaction; broadcasts after commit. */
  function restore(setting: Pick<DemoSetting, 'startSeq' | 'snapshot'>): DemoRestoreSummary {
    const kept: string[] = [];
    const summary = events.commitAndBroadcast((repos) => {
      const now = clock().toISOString();
      kept.length = 0;
      const result = restoreDemoSnapshot(repos, setting, now, kept);
      repos.settings.delete(DEMO_SETTING_KEY);
      const event = insertEvent(repos, systemInfo(stoppedMessage(result), { ...result }), now);
      return { payloads: [{ event, agent: null, task: null }], result };
    });
    // Logged after COMMIT only.
    if (kept.length > 0)
      logger.info('demo_task_kept', { reason: 'referenced', taskIds: [...kept] });
    return summary;
  }

  return {
    getState,
    tick,

    start(raw) {
      const body = parseInput(demoStartSchema, raw);
      if (session !== null) return getState(); // idempotent: the requested interval is ignored
      const intervalMs = body.intervalMs ?? deps.defaultIntervalMs;
      const started = events.commitAndBroadcast((repos) => {
        const now = clock().toISOString();
        const startSeq = repos.events.maxSeq();
        const setting: DemoSetting = {
          active: true,
          intervalMs,
          startedAt: now,
          startSeq,
          snapshot: { agents: repos.agents.list(), tasks: allTasks(repos) },
        };
        repos.settings.set(DEMO_SETTING_KEY, setting as unknown as JsonValue, now);
        const event = insertEvent(repos, systemInfo('Demo mode started', {}), now);
        return {
          payloads: [{ event, agent: null, task: null }],
          result: { startSeq, startedAt: now },
        };
      });
      const current: Session = {
        intervalMs,
        startedAt: started.startedAt,
        startSeq: started.startSeq,
        cursor: INITIAL_DEMO_CURSOR,
        timer: null,
      };
      session = current;
      const state = getState();
      safely('demo:state', () => broadcaster.demoState(state));
      logger.info('demo_started', { intervalMs, startSeq: started.startSeq });
      schedule(current);
      return state;
    },

    stop(reason) {
      const current = session;
      if (current === null) return { demo: getState(), restored: null };
      clearTimer();
      let summary: DemoRestoreSummary;
      try {
        const stored = database.repos.settings.get(DEMO_SETTING_KEY);
        if (isDemoSetting(stored)) {
          summary = restore(stored);
        } else {
          // Without the persisted snapshot nothing can be restored safely: keep every row as it is.
          logger.warn('demo_setting_invalid', { key: DEMO_SETTING_KEY });
          summary = {
            agentsRestored: 0,
            agentsKept: 0,
            tasksRestored: 0,
            tasksKept: 0,
            tasksDeleted: 0,
          };
          events.commitAndBroadcast((repos) => {
            const now = clock().toISOString();
            repos.settings.delete(DEMO_SETTING_KEY);
            const event = insertEvent(
              repos,
              systemInfo(stoppedMessage(summary), { ...summary }),
              now,
            );
            return { payloads: [{ event, agent: null, task: null }], result: null };
          });
        }
      } catch (error) {
        schedule(current); // still active: keep ticking, let the caller see the error
        throw error;
      }
      session = null;
      const state = getState();
      safely('demo:state', () => broadcaster.demoState(state));
      safely('office:resync', () => broadcaster.resync({ reason: 'demo-restored' }));
      logger.info('demo_stopped', { reason, ...summary });
      return { demo: state, restored: summary };
    },

    recoverOnBoot() {
      const stored = database.repos.settings.get(DEMO_SETTING_KEY);
      if (stored === null) return null;
      if (!isDemoSetting(stored)) {
        database.transaction((repos) => repos.settings.delete(DEMO_SETTING_KEY));
        logger.warn('demo_setting_invalid', { key: DEMO_SETTING_KEY });
        return null;
      }
      const summary = restore(stored);
      logger.info('demo_recovered', { ...summary });
      safely('demo:state', () => broadcaster.demoState(getState()));
      return summary;
    },

    dispose() {
      clearTimer();
      session = null;
    },
  };
}
