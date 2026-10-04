import type { Project } from '@vo/shared';
import { rowToProject } from '../mappers';
import type { ProjectRepository } from '../types';
import type { PrepareCached } from './statements';

const COLUMNS = 'id, name, task_prefix';

export function createProjectRepository(prepare: PrepareCached): ProjectRepository {
  return {
    list(): Project[] {
      return prepare(`SELECT ${COLUMNS} FROM projects ORDER BY sort_order, id`)
        .all()
        .map(rowToProject);
    },

    getById(id: string): Project | null {
      const row = prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ?`).get(id);
      return row ? rowToProject(row) : null;
    },

    insert(project: Project & { sortOrder: number }, now: string): void {
      prepare(
        `INSERT INTO projects (id, name, task_prefix, sort_order, created_at)
         VALUES (:id, :name, :task_prefix, :sort_order, :created_at)`,
      ).run({
        id: project.id,
        name: project.name,
        task_prefix: project.taskPrefix,
        sort_order: project.sortOrder,
        created_at: now,
      });
    },
  };
}
