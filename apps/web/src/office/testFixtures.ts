// Test-only fixtures for the office unit tests (not imported by application code).
import { AGENT_REFERENCE, type Agent } from '@vo/shared';

/** Builds a full `Agent` row from the reference data (idle, version 1) with optional overrides. */
export function makeAgent(index: number, overrides: Partial<Agent> = {}): Agent {
  const ref = AGENT_REFERENCE[index];
  if (!ref) throw new Error(`No reference agent at index ${index}`);
  const status = overrides.status ?? 'idle';
  return {
    id: ref.id,
    code: ref.code,
    name: ref.name,
    role: ref.role,
    shortRole: ref.shortRole,
    avatar: ref.avatar,
    department: ref.department,
    roomId: ref.roomId,
    deskId: ref.deskId,
    status,
    currentProject: null,
    currentTask: null,
    taskId: null,
    progress: 0,
    startedAt: null,
    lastActivityAt: null,
    currentAction: null,
    lastMessage: null,
    online: status !== 'offline',
    metadata: {},
    version: 1,
    ...overrides,
  };
}

/** All 15 reference agents as idle rows. */
export function makeAllAgents(): Agent[] {
  return AGENT_REFERENCE.map((_, i) => makeAgent(i));
}
