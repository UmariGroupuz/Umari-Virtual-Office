// DOM ids shared between components (skip link targets, focus return, aria-describedby).
export const SIMULATOR_TOGGLE_ID = 'vo-simulator-toggle';
export const BANNER_ID = 'vo-system-banner';
export const ROSTER_ID = 'agents-roster';
export const SIMULATOR_AGENT_SELECT_ID = 'vo-sim-agent';

export function agentCardId(agentId: string): string {
  return `agent-card-${agentId}`;
}
