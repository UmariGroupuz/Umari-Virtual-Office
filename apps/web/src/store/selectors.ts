// Pure derived data (ARCHITECTURE §7): metrics per filter, roster ordering/dimming, feed visibility,
// system status. Components select raw slices from the store and memoize these.
import {
  ACTIVE_TASK_STATUSES,
  AGENT_DISPLAY_ORDER,
  PROJECTS,
  agentMatchesProject,
  isActiveAgentStatus,
  taskMatchesProject,
  type Agent,
  type AgentStatus,
  type OfficeEvent,
  type Project,
  type Task,
} from '@vo/shared';
import type { HealthStatus } from '../api/health';
import type { SocketStatus } from '../socket/connection';
import type { SeverityFilter } from './store';

export interface Metrics {
  online: number;
  working: number;
  planning: number;
  waiting: number;
  reviewing: number;
  failed: number;
  activeTasks: number;
  completedTasks: number;
}

/** REQ-062/063: agents with currentProject = P, tasks with project = P; null = All Projects. */
export function computeMetrics(
  agents: readonly Agent[],
  tasks: readonly Task[],
  projectFilter: string | null,
): Metrics {
  const metrics: Metrics = {
    online: 0,
    working: 0,
    planning: 0,
    waiting: 0,
    reviewing: 0,
    failed: 0,
    activeTasks: 0,
    completedTasks: 0,
  };
  for (const agent of agents) {
    if (!agentMatchesProject(agent, projectFilter)) continue;
    if (agent.online) metrics.online += 1;
    switch (agent.status) {
      case 'working':
      case 'planning':
      case 'waiting':
      case 'reviewing':
      case 'failed':
        metrics[agent.status] += 1;
        break;
      default:
        break;
    }
  }
  const active = ACTIVE_TASK_STATUSES as readonly string[];
  for (const task of tasks) {
    if (!taskMatchesProject(task, projectFilter)) continue;
    if (active.includes(task.status)) metrics.activeTasks += 1;
    if (task.status === 'completed') metrics.completedTasks += 1;
  }
  return metrics;
}

/** Agents in office reading order (UX §6); unknown ids (future agents) are appended in id order. */
export function orderAgents(agents: Readonly<Record<string, Agent>>): Agent[] {
  const ordered: Agent[] = [];
  const seen = new Set<string>();
  for (const id of AGENT_DISPLAY_ORDER) {
    const agent = agents[id];
    if (agent) {
      ordered.push(agent);
      seen.add(id);
    }
  }
  const rest = Object.values(agents)
    .filter((a) => !seen.has(a.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...ordered, ...rest];
}

export interface RosterEntry {
  agent: Agent;
  dimmed: boolean;
}

/** UX §6 / REQ-062: with a filter, agents on P first (same relative order), the rest dimmed. */
export function selectRoster(
  agents: Readonly<Record<string, Agent>>,
  projectFilter: string | null,
): { entries: RosterEntry[]; noneOnProject: boolean } {
  const ordered = orderAgents(agents);
  if (projectFilter === null) {
    return { entries: ordered.map((agent) => ({ agent, dimmed: false })), noneOnProject: false };
  }
  const on = ordered.filter((a) => agentMatchesProject(a, projectFilter));
  const off = ordered.filter((a) => !agentMatchesProject(a, projectFilter));
  return {
    entries: [
      ...on.map((agent) => ({ agent, dimmed: false })),
      ...off.map((agent) => ({ agent, dimmed: true })),
    ],
    noneOnProject: on.length === 0 && ordered.length > 0,
  };
}

/** Client-side feed filters (UX §8.1): "Hide demo" and severity. */
export function filterFeed(
  events: readonly OfficeEvent[],
  options: { hideDemo: boolean; severity: SeverityFilter },
): OfficeEvent[] {
  return events.filter((event) => {
    if (options.hideDemo && event.source === 'demo') return false;
    if (options.severity === 'warnings') return event.severity !== 'info';
    if (options.severity === 'errors') return event.severity === 'error';
    return true;
  });
}

export type SystemStatus = 'checking' | 'operational' | 'degraded' | 'unavailable';

/** UX §11.1 (and I-5): Degraded = health OK but the socket is not connected after a first connect. */
export function selectSystemStatus(health: HealthStatus, socket: SocketStatus): SystemStatus {
  if (health === 'failing') return 'unavailable';
  if (health === 'checking') return 'checking';
  if (socket === 'connected') return 'operational';
  if (socket === 'connecting') return 'checking';
  return 'degraded';
}

export type BannerKind = 'unavailable' | 'disconnected' | 'reconnecting' | 'reconnected' | null;

/** UX §11.2: one banner at a time; Backend unavailable > Disconnected > Reconnecting. */
export function selectBanner(input: {
  health: HealthStatus;
  socket: SocketStatus;
  loaded: boolean;
  recentlyRecovered: boolean;
}): BannerKind {
  if (input.health === 'failing') return input.loaded ? 'unavailable' : null;
  if (input.socket === 'disconnected') return 'disconnected';
  if (input.socket === 'reconnecting') return 'reconnecting';
  if (input.socket === 'connected' && input.recentlyRecovered) return 'reconnected';
  return null;
}

/** Project display name for an id (store projects first, reference data as fallback). */
export function projectName(projects: readonly Project[], id: string | null): string | null {
  if (id === null) return null;
  return projects.find((p) => p.id === id)?.name ?? PROJECTS.find((p) => p.id === id)?.name ?? id;
}

export function onlineCount(agents: Readonly<Record<string, Agent>>): {
  online: number;
  total: number;
} {
  const list = Object.values(agents);
  return { online: list.filter((a) => a.online).length, total: list.length };
}

/** Roster progress bar: only with a task, progress > 0 and an active or completed status (UX §6). */
export function showsProgress(agent: Pick<Agent, 'status' | 'progress' | 'taskId'>): boolean {
  return (
    agent.taskId !== null &&
    agent.progress > 0 &&
    (isActiveAgentStatus(agent.status) || agent.status === 'completed')
  );
}

/** Running duration applies only while the status is active (UX §7.2). */
export function runningSince(agent: Pick<Agent, 'status' | 'startedAt'>): string | null {
  return isActiveAgentStatus(agent.status) && agent.startedAt !== null ? agent.startedAt : null;
}

const PRIORITY_RANK: Record<Task['priority'], number> = { critical: 0, high: 1, normal: 2, low: 3 };

function taskGroup(status: Task['status']): number {
  if ((ACTIVE_TASK_STATUSES as readonly string[]).includes(status)) return 0;
  if (status === 'todo') return 1;
  return 2;
}

/** UX §7.3 Tasks tab: active (priority critical→low), then todo, then completed/failed/cancelled (newest first). */
export function sortAgentTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const group = taskGroup(a.status) - taskGroup(b.status);
    if (group !== 0) return group;
    if (taskGroup(a.status) === 2) {
      const at = a.completedAt ?? a.updatedAt;
      const bt = b.completedAt ?? b.updatedAt;
      return bt.localeCompare(at);
    }
    const prio = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (prio !== 0) return prio;
    return a.id.localeCompare(b.id);
  });
}

/** Status counts for the office `role="img"` summary (UX §5.1), excluding idle. */
export function officeSummaryParts(
  agents: readonly Agent[],
  labels: Readonly<Record<AgentStatus, string>>,
): string[] {
  const order: AgentStatus[] = [
    'working',
    'planning',
    'waiting',
    'reviewing',
    'completed',
    'failed',
    'offline',
  ];
  const counts = new Map<AgentStatus, number>();
  for (const agent of agents) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
  return order
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${counts.get(status) ?? 0} ${labels[status].toLowerCase()}`);
}
