// Project references (ADR-006): any `project` input is an id or a name, case-insensitive; stored as the id.
// Projects are immutable in Phase 1. They are loaded lazily and cached once present: with the listen-first
// boot (ADR-035 §2) the app is created before the database is seeded.
import { resolveProjectRef, type Project } from '@vo/shared';
import { appErrors } from '../errors';

export interface ProjectResolver {
  readonly projects: readonly Project[];
  /** Resolved project id; 422 `UNKNOWN_PROJECT` (with the value as sent) when nothing matches. */
  resolveId(ref: string): string;
  /** `null` for an absent reference, otherwise like `resolveId`. */
  resolveOptional(ref: string | undefined): string | null;
}

export function createProjectResolver(
  source: readonly Project[] | (() => readonly Project[]),
): ProjectResolver {
  let cache: readonly Project[] | null = null;
  const load = (): readonly Project[] => {
    if (cache !== null) return cache;
    const rows = typeof source === 'function' ? source() : source;
    const list = Object.freeze(
      rows.map((p) => ({ id: p.id, name: p.name, taskPrefix: p.taskPrefix })),
    );
    if (list.length > 0) cache = list; // an empty (not yet seeded) list is not cached
    return list;
  };
  const resolveId = (ref: string): string => {
    const project = resolveProjectRef(ref, load());
    if (project === null) throw appErrors.unknownProject(ref);
    return project.id;
  };
  return {
    get projects() {
      return load();
    },
    resolveId,
    resolveOptional: (ref) => (ref === undefined ? null : resolveId(ref)),
  };
}
