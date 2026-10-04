// Test fixtures for the database layer (used only by colocated *.test.ts files).
import { AGENT_REFERENCE, PROJECTS, type Agent } from '@vo/shared';
import { openDatabase, type OpenedDatabaseHandle } from './connection';
import type { NewEvent, NewTask } from './types';

export const T0 = '2026-10-04T10:00:00.000Z';
export const T1 = '2026-10-04T10:05:00.000Z';
export const T2 = '2026-10-04T10:10:00.000Z';

/** In-memory database with the 4 projects and 15 idle agents (no tasks, no events). */
export function openTestDatabase(options: { withReference?: boolean } = {}): OpenedDatabaseHandle {
  const handle = openDatabase({ path: ':memory:' });
  if (options.withReference !== false) {
    handle.transaction((repos) => {
      for (const project of PROJECTS) repos.projects.insert(project, T0);
      for (const ref of AGENT_REFERENCE)
        repos.agents.insert({ ...makeAgent(ref.id), sortOrder: ref.sortOrder }, T0);
    });
  }
  return handle;
}

export function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  const ref = AGENT_REFERENCE.find((a) => a.id === id);
  if (ref === undefined) throw new Error(`Unknown reference agent ${id}`);
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
    status: 'idle',
    currentProject: null,
    currentTask: null,
    taskId: null,
    progress: 0,
    startedAt: null,
    lastActivityAt: null,
    currentAction: null,
    lastMessage: null,
    online: true,
    metadata: {},
    version: 1,
    ...overrides,
  };
}

export function makeTask(id: string, overrides: Partial<NewTask> = {}): NewTask {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    project: 'sellway',
    assignedAgentId: null,
    status: 'todo',
    priority: 'normal',
    progress: 0,
    createdAt: T0,
    startedAt: null,
    completedAt: null,
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

let eventCounter = 0;

export function makeEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  eventCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(eventCounter).padStart(12, '0')}`,
    type: 'agent.activity',
    source: 'api',
    agentId: '04-backend-engineer',
    project: 'sellway',
    taskId: null,
    status: null,
    action: 'run_command',
    message: null,
    severity: 'info',
    progress: null,
    metadata: {},
    occurredAt: null,
    createdAt: T0,
    forced: false,
    ...overrides,
  };
}
