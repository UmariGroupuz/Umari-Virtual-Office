// Project filter predicates (EVENT_SYSTEM §8.3, REQ-062, ADR-006). `null` filter = All Projects.
import { PROJECTLESS_VISIBLE_TYPES } from '../constants/eventTypes';
import type { Agent } from '../types/agent';
import type { OfficeEvent } from '../types/event';
import type { Task } from '../types/task';

/** Feed rule: events of the project, plus project-less `system.warning` / `system.error` (A-09). */
export function eventMatchesProject(
  event: Pick<OfficeEvent, 'project' | 'type'>,
  projectId: string | null,
): boolean {
  if (projectId === null) return true;
  if (event.project === projectId) return true;
  return (
    event.project === null && (PROJECTLESS_VISIBLE_TYPES as readonly string[]).includes(event.type)
  );
}

export function agentMatchesProject(
  agent: Pick<Agent, 'currentProject'>,
  projectId: string | null,
): boolean {
  return projectId === null || agent.currentProject === projectId;
}

export function taskMatchesProject(task: Pick<Task, 'project'>, projectId: string | null): boolean {
  return projectId === null || task.project === projectId;
}
