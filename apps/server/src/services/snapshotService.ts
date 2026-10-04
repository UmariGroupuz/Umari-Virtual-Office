// GET /api/snapshot (API_CONTRACTS §3.11, ADR-010, ADR-035 §3–§4): one synchronous read of the office state.
// DatabaseSync is synchronous and Node is single-threaded, so no write can interleave with this function:
// `lastSeq` (the resync watermark) is consistent with every row returned.
import {
  LIMITS,
  type Agent,
  type DemoState,
  type Snapshot,
  type SnapshotQueryInput,
  type Task,
} from '@vo/shared';
import type { DatabaseHandle, Repositories } from '../db/types';
import type { ProjectResolver } from './projectResolver';

export interface SnapshotService {
  getSnapshot(query: SnapshotQueryInput): Snapshot;
}

const byCreatedThenId = (a: Task, b: Task): number =>
  a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

/**
 * ADR-035 §4: the newest `cap` tasks (createdAt desc, then id) plus every task referenced by an agent's
 * `taskId`, returned in the GET /api/tasks order (createdAt asc, then id).
 */
export function selectSnapshotTasks(
  repos: Repositories,
  agents: readonly Agent[],
  cap: number = LIMITS.LIST_MAX,
): Task[] {
  const total = repos.tasks.count();
  const all = repos.tasks.list({ limit: Math.max(total, 1) }); // ascending
  const selected = all.length > cap ? all.slice(all.length - cap) : all;
  const ids = new Set(selected.map((task) => task.id));
  const extra: Task[] = [];
  for (const agent of agents) {
    if (agent.taskId === null || ids.has(agent.taskId)) continue;
    const task = repos.tasks.getById(agent.taskId); // null for dangling ids (allowed, REQ-021)
    if (task !== null) {
      ids.add(task.id);
      extra.push(task);
    }
  }
  return extra.length === 0 ? selected : [...selected, ...extra].sort(byCreatedThenId);
}

export function createSnapshotService(deps: {
  database: DatabaseHandle;
  projects: ProjectResolver;
  demoState: () => DemoState;
  clock: () => Date;
}): SnapshotService {
  return {
    getSnapshot(query) {
      const projectId = deps.projects.resolveOptional(query.project);
      const repos = deps.database.repos;
      const lastSeq = repos.events.maxSeq(); // global watermark, before any project filter
      const events = repos.events.list({
        ...(projectId === null ? {} : { projectId }),
        limit: query.eventsLimit,
      });
      const agents = repos.agents.list();
      return {
        agents,
        tasks: selectSnapshotTasks(repos, agents),
        projects: repos.projects.list(),
        events: events.events,
        eventsPage: { limit: query.eventsLimit, nextBefore: events.nextBefore },
        demo: deps.demoState(),
        serverTime: deps.clock().toISOString(),
        lastSeq,
      };
    },
  };
}
