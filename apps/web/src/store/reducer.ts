// Pure domain reducer (ADR-010, API-C §4): wholesale hydrate, version-gated entity updates, id-deduped
// feed capped at the 200 newest events. No I/O, no clock reads (callers pass `receivedAt`).
import {
  LIMITS,
  eventMatchesProject,
  type Agent,
  type DemoState,
  type OfficeEvent,
  type Project,
  type Snapshot,
  type Task,
  type WriteResult,
} from '@vo/shared';

export type FeedStatus = 'loading' | 'ready' | 'error';

export interface DomainState {
  /** True once a snapshot has been applied. */
  loaded: boolean;
  agents: Readonly<Record<string, Agent>>;
  tasks: Readonly<Record<string, Task>>;
  projects: readonly Project[];
  demo: DemoState | null;
  /** Feed list for `feedProject`: newest first (seq DESC), ≤ FEED_CAP, unique ids. */
  feed: readonly OfficeEvent[];
  feedProject: string | null;
  /** Rows with a seq above this arrived live (they get the "new row" highlight). */
  feedBaselineSeq: number;
  feedStatus: FeedStatus;
  feedError: string | null;
  /** Unfiltered live events received since start (newest first, ≤ FEED_CAP) — agent Activity/Logs tabs. */
  recentEvents: readonly OfficeEvent[];
  /** Server time minus client time, from the last snapshot (durations use it). */
  serverTimeOffsetMs: number;
  /** Client time of the last applied server data (for "last known data from …"). */
  lastDataAt: number | null;
}

export const FEED_CAP = LIMITS.FEED_CAP;

/**
 * Entity records are keyed by producer-supplied ids, so they never inherit from Object.prototype (SEC-4):
 * an id like `__proto__`, `constructor` or `title` is stored as an ordinary own key and never resolves to an
 * inherited value.
 */
export function createIdRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Sets an own data property (works for `__proto__` too). Only for records being built. */
function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Copy of `record` (null prototype) with `key` set to `value`. */
export function withEntry<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T,
): Record<string, T> {
  const next = createIdRecord<T>();
  // defineProperty, not assignment, so even `__proto__` stays an own data property.
  for (const [k, v] of Object.entries(record)) setOwn(next, k, v);
  setOwn(next, key, value);
  return next;
}

export function createInitialDomainState(feedProject: string | null = null): DomainState {
  return {
    loaded: false,
    agents: createIdRecord<Agent>(),
    tasks: createIdRecord<Task>(),
    projects: [],
    demo: null,
    feed: [],
    feedProject,
    feedBaselineSeq: 0,
    feedStatus: 'loading',
    feedError: null,
    recentEvents: [],
    serverTimeOffsetMs: 0,
    lastDataAt: null,
  };
}

function bySeqDesc(a: OfficeEvent, b: OfficeEvent): number {
  return b.seq - a.seq;
}

/** Merges `incoming` into `list`: unique ids, seq DESC, capped. Returns `list` itself when nothing changed. */
export function mergeEvents(
  list: readonly OfficeEvent[],
  incoming: readonly OfficeEvent[],
  cap: number = FEED_CAP,
): readonly OfficeEvent[] {
  if (incoming.length === 0) return list;
  const ids = new Set(list.map((e) => e.id));
  const fresh: OfficeEvent[] = [];
  for (const event of incoming) {
    if (ids.has(event.id)) continue;
    ids.add(event.id);
    fresh.push(event);
  }
  if (fresh.length === 0) return list;
  const merged = [...list, ...fresh].sort(bySeqDesc);
  return merged.length > cap ? merged.slice(0, cap) : merged;
}

function maxSeq(events: readonly OfficeEvent[]): number {
  let max = 0;
  for (const event of events) if (event.seq > max) max = event.seq;
  return max;
}

function shouldReplace<T extends { version: number }>(stored: T | undefined, incoming: T): boolean {
  return stored === undefined || incoming.version > stored.version;
}

/**
 * Replaces agents, tasks, projects and demo wholesale (ADR-010 step 2). The feed is replaced only when
 * the snapshot was requested for the current feed project; otherwise the caller reloads the feed.
 */
export function hydrate(
  state: DomainState,
  snapshot: Snapshot,
  options: { project: string | null; receivedAt: number },
): DomainState {
  const agents = createIdRecord<Agent>();
  for (const agent of snapshot.agents) setOwn(agents, agent.id, agent);
  const tasks = createIdRecord<Task>();
  for (const task of snapshot.tasks) setOwn(tasks, task.id, task);
  const serverTime = Date.parse(snapshot.serverTime);

  const next: DomainState = {
    ...state,
    loaded: true,
    agents,
    tasks,
    projects: snapshot.projects,
    demo: snapshot.demo,
    serverTimeOffsetMs: Number.isNaN(serverTime) ? 0 : serverTime - options.receivedAt,
    lastDataAt: options.receivedAt,
  };
  if (options.project === state.feedProject) {
    const events = [...snapshot.events]
      .filter((e) => eventMatchesProject(e, state.feedProject))
      .sort(bySeqDesc);
    // Keep the newest FEED_CAP unique events of the snapshot.
    next.feed = mergeEvents([], events);
    next.feedBaselineSeq = Math.max(maxSeq(next.feed), state.feedBaselineSeq);
    next.feedStatus = 'ready';
    next.feedError = null;
  }
  return next;
}

/**
 * Applies an `office:event` payload or a write response (same shape). Entities are replaced only when
 * unknown or of a higher `version`; the event is added to the feed only when its id is new and it
 * matches the feed project. `event: null` (no-op write) touches nothing but the entity gate.
 */
export function applyOfficeEvent(
  state: DomainState,
  payload: WriteResult,
  options: { receivedAt?: number } = {},
): DomainState {
  let changed = false;
  let agents = state.agents;
  let tasks = state.tasks;
  let feed = state.feed;
  let recentEvents = state.recentEvents;

  if (payload.agent && shouldReplace(state.agents[payload.agent.id], payload.agent)) {
    agents = withEntry(state.agents, payload.agent.id, payload.agent);
    changed = true;
  }
  if (payload.task && shouldReplace(state.tasks[payload.task.id], payload.task)) {
    tasks = withEntry(state.tasks, payload.task.id, payload.task);
    changed = true;
  }
  const event = payload.event;
  if (event) {
    if (eventMatchesProject(event, state.feedProject)) {
      const merged = mergeEvents(state.feed, [event]);
      if (merged !== state.feed) {
        feed = merged;
        changed = true;
      }
    }
    const recent = mergeEvents(state.recentEvents, [event]);
    if (recent !== state.recentEvents) {
      recentEvents = recent;
      changed = true;
    }
  }
  if (!changed) return state;
  return {
    ...state,
    agents,
    tasks,
    feed,
    recentEvents,
    lastDataAt: options.receivedAt ?? state.lastDataAt,
  };
}

/** `demo:state` broadcast or a demo start/stop response. */
export function applyDemoState(state: DomainState, demo: DemoState): DomainState {
  const current = state.demo;
  if (
    current &&
    current.active === demo.active &&
    current.intervalMs === demo.intervalMs &&
    current.startedAt === demo.startedAt
  ) {
    return state;
  }
  return { ...state, demo };
}

/** Filter change: clear the list and mark it loading (UX §8.4). Live events for the new project still merge. */
export function setFeedProject(state: DomainState, project: string | null): DomainState {
  return {
    ...state,
    feedProject: project,
    feed: [],
    feedStatus: 'loading',
    feedError: null,
    feedBaselineSeq: 0,
  };
}

/** Result of `GET /api/events?project=…` for the current feed project (ARCHITECTURE §4.2 step 4). */
export function hydrateFeed(
  state: DomainState,
  events: readonly OfficeEvent[],
  project: string | null,
): DomainState {
  if (project !== state.feedProject) return state;
  const relevant = events.filter((e) => eventMatchesProject(e, project));
  const feed = mergeEvents(state.feed, relevant);
  return {
    ...state,
    feed,
    feedStatus: 'ready',
    feedError: null,
    feedBaselineSeq: Math.max(state.feedBaselineSeq, maxSeq(relevant)),
  };
}

export function feedFailed(
  state: DomainState,
  project: string | null,
  message: string,
): DomainState {
  if (project !== state.feedProject) return state;
  return { ...state, feedStatus: 'error', feedError: message };
}
