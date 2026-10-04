// Data hooks of the detail panel: Activity/Logs events (`GET /api/events?agentId=…` + live), Tasks
// (`GET /api/tasks?agentId=…` + live), and the silent agent refresh (UX §7.3, §7.4).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIMITS, type Agent, type OfficeEvent, type Task } from '@vo/shared';
import { ApiError, errorDetail, isAborted } from '../api/client';
import { useOffice, useRuntime } from '../lib/runtime';
import { mergeEvents } from '../store/reducer';
import { sortAgentTasks } from '../store/selectors';

const PAGE = LIMITS.EVENTS_DEFAULT_LIMIT;

interface EventsState {
  key: string;
  agentId: string;
  status: 'ready' | 'error';
  events: readonly OfficeEvent[];
  nextBefore: number | null;
  error: string | null;
}

export interface AgentEventsView {
  status: 'loading' | 'ready' | 'error';
  events: readonly OfficeEvent[];
  error: string | null;
  hasOlder: boolean;
  olderStatus: 'idle' | 'loading' | 'error';
  olderError: string | null;
  loadOlder: () => void;
  retry: () => void;
}

/** Activity tab data (also used by Logs): first page + live prepend + "Load older" (`before` cursor). */
export function useAgentEvents(agentId: string): AgentEventsView {
  const { api } = useRuntime();
  const syncGeneration = useOffice((s) => s.syncGeneration);
  const recentEvents = useOffice((s) => s.recentEvents);
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<EventsState | null>(null);
  const [older, setOlder] = useState<{
    key: string;
    status: 'idle' | 'loading' | 'error';
    error: string | null;
  }>({ key: '', status: 'idle', error: null });

  const key = `${agentId}|${syncGeneration}|${retryToken}`;

  useEffect(() => {
    const controller = new AbortController();
    api
      .getEvents({ agentId, limit: PAGE }, controller.signal)
      .then((page) => {
        setState({
          key,
          agentId,
          status: 'ready',
          events: mergeEvents([], page.events, Number.MAX_SAFE_INTEGER),
          nextBefore: page.page.nextBefore,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (isAborted(error) && controller.signal.aborted) return;
        setState({
          key,
          agentId,
          status: 'error',
          events: [],
          nextBefore: null,
          error: errorDetail(error),
        });
      });
    return () => controller.abort();
  }, [api, agentId, key]);

  const sameAgent = state !== null && state.agentId === agentId;
  // A refetch after a resync keeps showing the previous list for the same agent (no skeleton flash).
  const status: AgentEventsView['status'] =
    state === null || !sameAgent
      ? 'loading'
      : state.key === key || state.status === 'ready'
        ? state.status
        : 'loading';
  const fetched = useMemo(() => (sameAgent && state ? state.events : []), [sameAgent, state]);
  const events = useMemo(() => {
    const live = recentEvents.filter((e) => e.agentId === agentId);
    return mergeEvents(fetched, live, Number.MAX_SAFE_INTEGER);
  }, [fetched, recentEvents, agentId]);

  const nextBefore = sameAgent && state ? state.nextBefore : null;
  const olderState = older.key === key ? older : { status: 'idle' as const, error: null };

  const loadOlder = useCallback(() => {
    if (nextBefore === null) return;
    setOlder({ key, status: 'loading', error: null });
    api
      .getEvents({ agentId, before: nextBefore, limit: PAGE })
      .then((page) => {
        setState((prev) =>
          prev && prev.agentId === agentId
            ? {
                ...prev,
                events: mergeEvents(prev.events, page.events, Number.MAX_SAFE_INTEGER),
                nextBefore: page.page.nextBefore,
              }
            : prev,
        );
        setOlder({ key, status: 'idle', error: null });
      })
      .catch((error: unknown) => setOlder({ key, status: 'error', error: errorDetail(error) }));
  }, [api, agentId, key, nextBefore]);

  return {
    status,
    events,
    error: sameAgent && state ? state.error : null,
    hasOlder: nextBefore !== null,
    olderStatus: olderState.status,
    olderError: olderState.error,
    loadOlder,
    retry: () => setRetryToken((t) => t + 1),
  };
}

interface TasksState {
  key: string;
  agentId: string;
  status: 'ready' | 'error';
  tasks: readonly Task[];
  error: string | null;
}

export interface AgentTasksView {
  status: 'loading' | 'ready' | 'error';
  tasks: Task[];
  error: string | null;
  retry: () => void;
}

/** Tasks tab: fetched list merged with live store tasks (higher `version` wins; assignee must still match). */
export function useAgentTasks(agentId: string): AgentTasksView {
  const { api } = useRuntime();
  const syncGeneration = useOffice((s) => s.syncGeneration);
  const storeTasks = useOffice((s) => s.tasks);
  const loaded = useOffice((s) => s.loaded);
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<TasksState | null>(null);
  const key = `${agentId}|${syncGeneration}|${retryToken}`;

  useEffect(() => {
    const controller = new AbortController();
    api
      .getTasks({ agentId }, controller.signal)
      .then((tasks) => setState({ key, agentId, status: 'ready', tasks, error: null }))
      .catch((error: unknown) => {
        if (isAborted(error) && controller.signal.aborted) return;
        setState({ key, agentId, status: 'error', tasks: [], error: errorDetail(error) });
      });
    return () => controller.abort();
  }, [api, agentId, key]);

  const sameAgent = state !== null && state.agentId === agentId;
  const status: AgentTasksView['status'] =
    state === null || !sameAgent
      ? 'loading'
      : state.key === key || state.status === 'ready'
        ? state.status
        : 'loading';

  const tasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const task of Object.values(storeTasks)) {
      if (task.assignedAgentId === agentId) byId.set(task.id, task);
    }
    if (sameAgent && state) {
      for (const task of state.tasks) {
        const stored = storeTasks[task.id];
        if (stored) {
          // The store is live; it wins unless the fetched row is newer.
          if (task.version > stored.version && task.assignedAgentId === agentId)
            byId.set(task.id, task);
        } else if (!loaded) {
          byId.set(task.id, task);
        }
      }
    }
    return sortAgentTasks([...byId.values()]);
  }, [storeTasks, state, sameAgent, agentId, loaded]);

  return {
    status,
    tasks,
    error: sameAgent && state ? state.error : null,
    retry: () => setRetryToken((t) => t + 1),
  };
}

export type AgentLookup =
  { kind: 'found'; agent: Agent } | { kind: 'loading' } | { kind: 'not-found' };

/**
 * Resolves the panel's agent: store data immediately (refreshed silently with `GET /api/agents/:id`);
 * before the store is loaded the fetch decides; unknown id → not found (REQ-083).
 */
export function useAgentLookup(agentId: string): AgentLookup {
  const { api } = useRuntime();
  const stored = useOffice((s) => s.agents[agentId]);
  const loaded = useOffice((s) => s.loaded);
  const [fetched, setFetched] = useState<{ id: string; agent: Agent | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getAgent(agentId, controller.signal)
      .then((agent) => setFetched({ id: agentId, agent }))
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          (error.code === 'AGENT_NOT_FOUND' || error.status === 404)
        ) {
          setFetched({ id: agentId, agent: null });
        }
      });
    return () => controller.abort();
  }, [api, agentId]);

  const fresh = fetched && fetched.id === agentId ? fetched : null;
  if (stored) {
    const remote = fresh?.agent;
    return { kind: 'found', agent: remote && remote.version > stored.version ? remote : stored };
  }
  if (fresh?.agent) return { kind: 'found', agent: fresh.agent };
  if (loaded || (fresh && fresh.agent === null)) return { kind: 'not-found' };
  return { kind: 'loading' };
}
