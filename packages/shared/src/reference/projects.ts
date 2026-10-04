// Project reference data (API_CONTRACTS §6.2, REQUIREMENTS §3.2) and resolution (ADR-006).
import type { Project } from '../types/project';

export const PROJECTS: readonly (Project & { sortOrder: number })[] = Object.freeze([
  Object.freeze({ id: 'sellway', name: 'Sellway', taskPrefix: 'SW', sortOrder: 1 }),
  Object.freeze({ id: 'ishkun24', name: 'Ishkun24', taskPrefix: 'IK', sortOrder: 2 }),
  Object.freeze({ id: 'erp', name: 'ERP', taskPrefix: 'ERP', sortOrder: 3 }),
  Object.freeze({ id: 'ana-market', name: 'Ana Market', taskPrefix: 'AM', sortOrder: 4 }),
]);

export const PROJECT_IDS: readonly string[] = Object.freeze(PROJECTS.map((p) => p.id));

/** Virtual "no filter" option of the project selector — never a stored project (A-01). */
export const ALL_PROJECTS_LABEL = 'All Projects';

/**
 * Resolves a project reference (id or name, case-insensitive, trimmed) against `projects`.
 * Returns `null` when nothing matches — including "All Projects"/"all", which are not projects.
 */
export function resolveProjectRef(ref: string, projects: readonly Project[]): Project | null {
  const needle = ref.trim().toLowerCase();
  if (needle === '') return null;
  return (
    projects.find((p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle) ?? null
  );
}
