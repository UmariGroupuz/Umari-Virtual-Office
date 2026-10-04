import { LIMITS, type Task, type TaskStatus } from '@vo/shared';
import { rowToTask, taskMutableParams } from '../mappers';
import type { NewTask, TaskPatch, TaskRepository } from '../types';
import { applyPatch, changesOf, type PrepareCached } from './statements';

const COLUMNS = `id, title, description, project_id, assigned_agent_id, status, priority, progress,
  created_at, started_at, completed_at, blocked_by, metadata, version, updated_at`;

const SELECT_BY_ID = `SELECT ${COLUMNS} FROM tasks WHERE id = ?`;

/** Writes every mutable column; `version` is always the stored value + 1 (ADR-010). */
const UPDATE_MUTABLE = `UPDATE tasks SET
  title = :title, description = :description, status = :status, priority = :priority,
  progress = :progress, assigned_agent_id = :assigned_agent_id, started_at = :started_at,
  completed_at = :completed_at, blocked_by = :blocked_by, metadata = :metadata,
  version = version + 1, updated_at = :updated_at
  WHERE id = :id`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`Task list limit must be a positive integer, got ${String(limit)}`);
  }
}

export function createTaskRepository(prepare: PrepareCached): TaskRepository {
  function getById(id: string): Task | null {
    const row = prepare(SELECT_BY_ID).get(id);
    return row ? rowToTask(row) : null;
  }

  function requireTask(id: string): Task {
    const task = getById(id);
    if (task === null) throw new Error(`Task not found: ${id}`);
    return task;
  }

  function writeMutable(id: string, next: Task, now: string): Task {
    const result = prepare(UPDATE_MUTABLE).run({ ...taskMutableParams(next), updated_at: now, id });
    if (changesOf(result) !== 1) throw new Error(`Task not found: ${id}`);
    return requireTask(id);
  }

  return {
    list(filter = {}): Task[] {
      const limit = filter.limit ?? LIMITS.TASKS_DEFAULT_LIMIT;
      assertLimit(limit);
      // Fixed clause set (≤ 8 distinct SQL texts, each cached); values are always bound.
      const where: string[] = [];
      const params: Record<string, string | number> = { limit };
      if (filter.projectId !== undefined) {
        where.push('project_id = :project_id');
        params['project_id'] = filter.projectId;
      }
      if (filter.agentId !== undefined) {
        where.push('assigned_agent_id = :agent_id');
        params['agent_id'] = filter.agentId;
      }
      if (filter.status !== undefined) {
        where.push('status = :status');
        params['status'] = filter.status satisfies TaskStatus;
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      return prepare(
        `SELECT ${COLUMNS} FROM tasks ${whereSql} ORDER BY created_at, id LIMIT :limit`,
      )
        .all(params)
        .map(rowToTask);
    },

    getById,

    existingIds(ids: readonly string[]): Set<string> {
      if (ids.length === 0) return new Set();
      const rows = prepare('SELECT id FROM tasks WHERE id IN (SELECT value FROM json_each(?))').all(
        JSON.stringify(ids),
      );
      return new Set(rows.map((row) => String(row['id'])));
    },

    count(): number {
      return Number(prepare('SELECT COUNT(*) AS n FROM tasks').get()?.['n'] ?? 0);
    },

    maxNumericSuffix(prefix: string): number | null {
      // Case-sensitive prefix match in SQL (substr, not LIKE), exact pattern check in JS:
      // demo ids such as `SW-D57-1a` never match ^SW-\d+$ (ADR-027).
      const head = `${prefix}-`;
      const rows = prepare('SELECT id FROM tasks WHERE substr(id, 1, ?) = ?').all(
        head.length,
        head,
      );
      const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
      let max: number | null = null;
      for (const row of rows) {
        const match = pattern.exec(String(row['id']));
        if (match?.[1] === undefined) continue;
        const n = Number.parseInt(match[1], 10);
        if (max === null || n > max) max = n;
      }
      return max;
    },

    insert(task: NewTask, now: string): Task {
      prepare(
        `INSERT INTO tasks (id, title, description, project_id, assigned_agent_id, status, priority,
           progress, created_at, started_at, completed_at, blocked_by, metadata, version, updated_at)
         VALUES (:id, :title, :description, :project_id, :assigned_agent_id, :status, :priority,
           :progress, :created_at, :started_at, :completed_at, :blocked_by, :metadata, 1, :updated_at)`,
      ).run({
        ...taskMutableParams(task),
        id: task.id,
        project_id: task.project,
        created_at: task.createdAt,
        updated_at: now,
      });
      return requireTask(task.id);
    },

    update(id: string, patch: TaskPatch, now: string): Task {
      return writeMutable(id, applyPatch<Task>(requireTask(id), patch), now);
    },

    replace(task: Task, now: string): Task {
      requireTask(task.id);
      return writeMutable(task.id, task, now);
    },

    delete(id: string): boolean {
      return changesOf(prepare('DELETE FROM tasks WHERE id = ?').run(id)) > 0;
    },
  };
}
