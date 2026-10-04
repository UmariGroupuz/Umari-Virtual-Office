// URL state `?project=<id>&agent=<id>` (REQ-061, REQ-083, UX I-8). Written with history.replaceState.
import { PROJECTS, resolveProjectRef } from '@vo/shared';

export interface UrlState {
  projectFilter: string | null;
  selectedAgentId: string | null;
}

/** Reads the filter and agent from a search string. Invalid project → All Projects (null). */
export function parseUrlState(search: string): UrlState & { invalidProject: boolean } {
  const params = new URLSearchParams(search);
  const projectRaw = params.get('project');
  const agentRaw = params.get('agent');
  const project = projectRaw === null ? null : resolveProjectRef(projectRaw, PROJECTS);
  const agent = agentRaw?.trim() ?? '';
  return {
    projectFilter: project?.id ?? null,
    selectedAgentId: agent === '' ? null : agent,
    invalidProject: projectRaw !== null && project === null,
  };
}

/** Returns `search` with `project` and `agent` set or removed; other parameters are preserved. */
export function buildSearch(search: string, state: UrlState): string {
  const params = new URLSearchParams(search);
  params.delete('project');
  params.delete('agent');
  if (state.projectFilter !== null) params.set('project', state.projectFilter);
  if (state.selectedAgentId !== null) params.set('agent', state.selectedAgentId);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export function readUrlState(): UrlState & { invalidProject: boolean } {
  return parseUrlState(window.location.search);
}

/** Mirrors the state into the address bar without adding history entries. */
export function writeUrlState(state: UrlState): void {
  const { pathname, search, hash } = window.location;
  const next = buildSearch(search, state);
  if (next === search) return;
  window.history.replaceState(window.history.state, '', `${pathname}${next}${hash}`);
}
