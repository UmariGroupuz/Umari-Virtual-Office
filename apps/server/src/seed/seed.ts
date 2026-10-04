// Seed baseline (API_CONTRACTS §7, §9.2; REQ-120–122). Runs only on an empty `agents` table, in one
// transaction; restarts never duplicate. The seed is the only writer that bypasses `decideEvent`
// (ARCHITECTURE §5) — seed.test.ts proves the result is consistent with the state machines.
import { randomUUID } from 'node:crypto';
import { AGENT_REFERENCE, PROJECTS, type Agent, type Project } from '@vo/shared';
import type { DatabaseHandle, NewEvent, NewTask } from '../db/types';
import { SEED_AGENT_STATES, SEED_HISTORY, SEED_TASKS } from './seedData';

export interface SeedResult {
  seeded: boolean;
  agents: number;
  tasks: number;
  events: number;
}

export interface SeedBaseline {
  projects: (Project & { sortOrder: number })[];
  /** `updatedAt` = row write time used for `updated_at`. */
  agents: { agent: Agent & { sortOrder: number }; updatedAt: string }[];
  tasks: { task: NewTask; updatedAt: string }[];
  /** Chronological (ascending `createdAt`) — inserted in this order so `seq` follows time. */
  events: Omit<NewEvent, 'id'>[];
}

function isAgentEventType(type: string): boolean {
  return type.startsWith('agent.');
}

/** Pure: the full baseline relative to `now` (no ids, no I/O). Exported for tests. */
export function buildSeedBaseline(now: Date): SeedBaseline {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('Seed clock is not a valid date');
  const ago = (minutes: number): string => new Date(nowMs - minutes * 60_000).toISOString();
  const agoOrNull = (minutes: number | null): string | null =>
    minutes === null ? null : ago(minutes);
  const seedTime = now.toISOString();

  const history = [...SEED_HISTORY].sort((a, b) => b.minutesAgo - a.minutesAgo);
  const events: Omit<NewEvent, 'id'>[] = history.map((entry) => ({
    type: entry.type,
    source: entry.source,
    agentId: entry.agentId,
    project: entry.project,
    taskId: entry.taskId,
    status: entry.status,
    action: entry.action,
    message: entry.message,
    severity: entry.severity ?? 'info',
    progress: entry.progress,
    metadata: entry.metadata ?? {},
    occurredAt: null,
    createdAt: ago(entry.minutesAgo),
    forced: false,
  }));

  const titles = new Map(SEED_TASKS.map((t) => [t.id, t.title]));

  const agents = AGENT_REFERENCE.map((ref) => {
    const state = SEED_AGENT_STATES[ref.id];
    if (state === undefined) throw new Error(`Seed state missing for agent ${ref.id}`);
    const own = events.filter((e) => e.agentId === ref.id && isAgentEventType(e.type));
    const lastActivityAt = own.at(-1)?.createdAt ?? null;
    const lastMessage = own.findLast((e) => e.message !== null)?.message ?? null;
    const agent: Agent & { sortOrder: number } = {
      id: ref.id,
      code: ref.code,
      name: ref.name,
      role: ref.role,
      shortRole: ref.shortRole,
      avatar: ref.avatar,
      department: ref.department,
      roomId: ref.roomId,
      deskId: ref.deskId,
      sortOrder: ref.sortOrder,
      status: state.status,
      currentProject: state.currentProject,
      currentTask: state.taskId === null ? null : (titles.get(state.taskId) ?? state.taskId),
      taskId: state.taskId,
      progress: state.progress,
      startedAt: agoOrNull(state.startedMinutesAgo),
      lastActivityAt,
      currentAction: state.currentAction,
      lastMessage,
      online: state.status !== 'offline',
      metadata: {},
      version: 1,
    };
    return { agent, updatedAt: lastActivityAt ?? seedTime };
  });

  const tasks = SEED_TASKS.map((seed) => ({
    task: {
      id: seed.id,
      title: seed.title,
      description: seed.description,
      project: seed.project,
      assignedAgentId: seed.assignedAgentId,
      status: seed.status,
      priority: seed.priority,
      progress: seed.progress,
      createdAt: ago(seed.createdMinutesAgo),
      startedAt: agoOrNull(seed.startedMinutesAgo),
      completedAt: agoOrNull(seed.completedMinutesAgo),
      blockedBy: [...seed.blockedBy],
      metadata: {},
    } satisfies NewTask,
    updatedAt: ago(seed.updatedMinutesAgo),
  }));

  return {
    projects: PROJECTS.map((p) => ({ ...p })),
    agents,
    tasks,
    events,
  };
}

/**
 * Writes the §7 baseline in one transaction when the `agents` table is empty; otherwise does nothing.
 * Returns the row counts after the call (inserted counts when `seeded`).
 */
export function seedIfEmpty(handle: DatabaseHandle, now: Date = new Date()): SeedResult {
  const baseline = buildSeedBaseline(now);
  const seedTime = now.toISOString();
  return handle.transaction((repos) => {
    if (repos.agents.count() !== 0) {
      return {
        seeded: false,
        agents: repos.agents.count(),
        tasks: repos.tasks.count(),
        events: repos.events.count(),
      };
    }
    for (const project of baseline.projects) repos.projects.insert(project, seedTime);
    for (const { agent, updatedAt } of baseline.agents) repos.agents.insert(agent, updatedAt);
    // Tasks in creation order so `blockedBy` targets exist before their dependents (no FK, but tidy).
    const tasksByAge = [...baseline.tasks].sort((a, b) =>
      a.task.createdAt.localeCompare(b.task.createdAt),
    );
    for (const { task, updatedAt } of tasksByAge) repos.tasks.insert(task, updatedAt);
    for (const event of baseline.events) repos.events.insert({ ...event, id: randomUUID() });
    return {
      seeded: true,
      agents: baseline.agents.length,
      tasks: baseline.tasks.length,
      events: baseline.events.length,
    };
  });
}
