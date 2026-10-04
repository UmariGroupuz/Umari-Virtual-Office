// Internal Phaser ↔ React bridge (ADR-012 refined by ADR-025): a tiny observable fed from the OfficeCanvas
// props, plus the version diff the scene uses to update only changed workstations. Pure module: no Phaser,
// no React, no shell imports.
import type { Agent, AgentStatus } from '@vo/shared';
import type { OfficeHoverInfo } from './OfficeCanvas';

export interface OfficeViewState {
  agents: readonly Agent[];
  projectFilter: string | null;
  selectedAgentId: string | null;
  reducedMotion: boolean;
  paused: boolean;
}

export interface OfficeCallbacks {
  onAgentSelect: (agentId: string) => void;
  onBackgroundClick: () => void;
  onAgentHover: (hover: OfficeHoverInfo | null) => void;
}

export type OfficeStateListener = (state: OfficeViewState, previous: OfficeViewState) => void;

export interface OfficeBridge {
  getState(): OfficeViewState;
  /** Replaces the state; listeners run synchronously only when a field actually changed (by reference). */
  setState(next: OfficeViewState): void;
  subscribe(listener: OfficeStateListener): () => void;
  /** `null` detaches the React callbacks (unmounted component); events are then dropped. */
  setCallbacks(callbacks: OfficeCallbacks | null): void;
  selectAgent(agentId: string): void;
  clickBackground(): void;
  /** Forwards hover changes; repeated `null`s are collapsed into one call. */
  hoverAgent(hover: OfficeHoverInfo | null): void;
}

export const EMPTY_VIEW_STATE: OfficeViewState = Object.freeze({
  agents: Object.freeze([]),
  projectFilter: null,
  selectedAgentId: null,
  reducedMotion: false,
  paused: false,
});

function sameState(a: OfficeViewState, b: OfficeViewState): boolean {
  return (
    a.agents === b.agents &&
    a.projectFilter === b.projectFilter &&
    a.selectedAgentId === b.selectedAgentId &&
    a.reducedMotion === b.reducedMotion &&
    a.paused === b.paused
  );
}

export function createOfficeBridge(initial: OfficeViewState = EMPTY_VIEW_STATE): OfficeBridge {
  let state = initial;
  let callbacks: OfficeCallbacks | null = null;
  let hoverActive = false;
  const listeners = new Set<OfficeStateListener>();

  return {
    getState: () => state,
    setState(next) {
      if (sameState(state, next)) return;
      const previous = state;
      state = next;
      for (const listener of [...listeners]) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCallbacks(next) {
      callbacks = next;
    },
    selectAgent(agentId) {
      callbacks?.onAgentSelect(agentId);
    },
    clickBackground() {
      callbacks?.onBackgroundClick();
    },
    hoverAgent(hover) {
      if (hover === null && !hoverActive) return;
      hoverActive = hover !== null;
      callbacks?.onAgentHover(hover);
    },
  };
}

/** What the scene last applied for an agent. */
export interface KnownAgent {
  version: number;
  status: AgentStatus;
}

export interface AgentUpdate {
  agent: Agent;
  /** Status before this update; `null` when the agent is new to the scene. */
  previousStatus: AgentStatus | null;
  /** Status changed live (entry animations may play). */
  statusChanged: boolean;
  /** Live transition into `completed` → the success emphasis plays (never on the first render). */
  liveCompleted: boolean;
}

export interface AgentUpdatePlan {
  updates: AgentUpdate[];
  /** Agents the scene knows that are no longer in the list. */
  removedIds: string[];
}

/**
 * Diffs the incoming agents against what the scene has applied (ADR-012: by `version`). An agent whose
 * `version` is unchanged produces no update. `initial` marks the first sync of a scene (or a re-created game):
 * nothing counts as a live transition then, so `completed` renders in its settled state.
 */
export function planAgentUpdates(
  known: ReadonlyMap<string, KnownAgent>,
  agents: readonly Agent[],
  initial: boolean,
): AgentUpdatePlan {
  const updates: AgentUpdate[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    if (seen.has(agent.id)) continue; // duplicate ids: first one wins
    seen.add(agent.id);
    const previous = known.get(agent.id);
    if (previous && previous.version === agent.version) continue;
    const previousStatus = previous?.status ?? null;
    const live = !initial && previousStatus !== null;
    const statusChanged = live && previousStatus !== agent.status;
    updates.push({
      agent,
      previousStatus,
      statusChanged,
      liveCompleted: statusChanged && agent.status === 'completed',
    });
  }
  const removedIds: string[] = [];
  for (const id of known.keys()) if (!seen.has(id)) removedIds.push(id);
  return { updates, removedIds };
}
