// Agent state machine — AGENT_STATE_MACHINE §2.1 exactly (ADR-016): 43 legal, 13 illegal transitions.
import { ACTIVE_AGENT_STATUSES, type AgentStatus } from '../constants/statuses';

/**
 * Legal targets per status. Rules: R1 any → offline, offline → idle only; R2 any online → idle;
 * R3 resting (idle, completed, failed) → any active; R4 directed flow between active statuses;
 * R5 completed only from working/reviewing; R6 failed from every online status.
 */
export const AGENT_TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> =
  Object.freeze({
    idle: Object.freeze(['planning', 'working', 'waiting', 'reviewing', 'failed', 'offline']),
    planning: Object.freeze(['idle', 'working', 'waiting', 'failed', 'offline']),
    working: Object.freeze(['idle', 'waiting', 'reviewing', 'completed', 'failed', 'offline']),
    waiting: Object.freeze(['idle', 'planning', 'working', 'reviewing', 'failed', 'offline']),
    reviewing: Object.freeze(['idle', 'working', 'waiting', 'completed', 'failed', 'offline']),
    completed: Object.freeze([
      'idle',
      'planning',
      'working',
      'waiting',
      'reviewing',
      'failed',
      'offline',
    ]),
    failed: Object.freeze(['idle', 'planning', 'working', 'waiting', 'reviewing', 'offline']),
    offline: Object.freeze(['idle']),
  } satisfies Record<AgentStatus, readonly AgentStatus[]>);

/** `false` when `from === to` (same status is not a transition, ASM §2). */
export function canTransitionAgent(from: AgentStatus, to: AgentStatus): boolean {
  if (from === to) return false;
  return AGENT_TRANSITIONS[from].includes(to);
}

export function getAllowedAgentTargets(from: AgentStatus): readonly AgentStatus[] {
  return AGENT_TRANSITIONS[from];
}

export function isActiveAgentStatus(status: AgentStatus): boolean {
  return (ACTIVE_AGENT_STATUSES as readonly AgentStatus[]).includes(status);
}
