import { PROJECTLESS_VISIBLE_TYPES, SOURCES, type OfficeEvent } from '@vo/shared';
import { readInteger, rowToEvent, toDbBoolean, toDbJson } from '../mappers';
import type {
  EventListQuery,
  EventListResult,
  EventRepository,
  NewEvent,
  TouchedEntities,
} from '../types';
import type { PrepareCached } from './statements';

const COLUMNS = `seq, id, type, source, agent_id, project_id, task_id, status, action, message, severity,
  progress, metadata, occurred_at, created_at, forced`;

/** Feed predicate (ES §8.3): the project's events plus project-less system.warning / system.error. */
const PROJECT_FEED_CLAUSE = `(project_id = :project_id OR (project_id IS NULL AND type IN (SELECT value FROM json_each(:projectless_types))))`;
const PROJECTLESS_TYPES_JSON = JSON.stringify(PROJECTLESS_VISIBLE_TYPES);

function assertListQuery(query: EventListQuery): void {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new RangeError(`Event list limit must be a positive integer, got ${String(query.limit)}`);
  }
  if (query.before !== undefined && !Number.isSafeInteger(query.before)) {
    throw new RangeError(`Event list cursor must be an integer, got ${String(query.before)}`);
  }
}

export function createEventRepository(prepare: PrepareCached): EventRepository {
  return {
    insert(event: NewEvent): OfficeEvent {
      const result = prepare(
        `INSERT INTO events (id, type, source, agent_id, project_id, task_id, status, action, message,
           severity, progress, metadata, occurred_at, created_at, forced)
         VALUES (:id, :type, :source, :agent_id, :project_id, :task_id, :status, :action, :message,
           :severity, :progress, :metadata, :occurred_at, :created_at, :forced)`,
      ).run({
        id: event.id,
        type: event.type,
        source: event.source,
        agent_id: event.agentId,
        project_id: event.project,
        task_id: event.taskId,
        status: event.status,
        action: event.action,
        message: event.message,
        severity: event.severity,
        progress: event.progress,
        metadata: toDbJson(event.metadata, '{}'),
        occurred_at: event.occurredAt,
        created_at: event.createdAt,
        forced: toDbBoolean(event.forced),
      });
      const row = prepare(`SELECT ${COLUMNS} FROM events WHERE seq = ?`).get(
        result.lastInsertRowid,
      );
      if (!row) throw new Error(`Inserted event ${event.id} could not be read back`);
      return rowToEvent(row);
    },

    list(query: EventListQuery): EventListResult {
      assertListQuery(query);
      // Fixed clause set (each combination is one cached SQL text); all values are bound. AND-combined.
      const where: string[] = [];
      const params: Record<string, string | number> = { limit: query.limit + 1 };
      if (query.projectId !== undefined) {
        where.push(PROJECT_FEED_CLAUSE);
        params['project_id'] = query.projectId;
        params['projectless_types'] = PROJECTLESS_TYPES_JSON;
      }
      if (query.agentId !== undefined) {
        where.push('agent_id = :agent_id');
        params['agent_id'] = query.agentId;
      }
      if (query.taskId !== undefined) {
        where.push('task_id = :task_id');
        params['task_id'] = query.taskId;
      }
      if (query.type !== undefined) {
        where.push('type = :type');
        params['type'] = query.type;
      }
      if (query.source !== undefined) {
        where.push('source = :source');
        params['source'] = query.source;
      }
      if (query.before !== undefined) {
        where.push('seq < :before');
        params['before'] = query.before;
      }
      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const rows = prepare(
        `SELECT ${COLUMNS} FROM events ${whereSql} ORDER BY seq DESC LIMIT :limit`,
      ).all(params);
      const hasOlder = rows.length > query.limit;
      const events = (hasOlder ? rows.slice(0, query.limit) : rows).map(rowToEvent);
      return { events, nextBefore: hasOlder ? (events.at(-1)?.seq ?? null) : null };
    },

    maxSeq(): number {
      const row = prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM events').get();
      return row ? readInteger(row, 'max_seq') : 0;
    },

    count(): number {
      return Number(prepare('SELECT COUNT(*) AS n FROM events').get()?.['n'] ?? 0);
    },

    touchedSince(startSeq: number): TouchedEntities {
      // ADR-011: user-touched = written by any non-demo source after the demo started.
      const agentRows = prepare(
        `SELECT DISTINCT agent_id FROM events
         WHERE seq > :start_seq AND source <> :demo AND substr(type, 1, 6) = 'agent.' AND agent_id IS NOT NULL`,
      ).all({ start_seq: startSeq, demo: SOURCES.DEMO });
      const taskRows = prepare(
        `SELECT DISTINCT task_id FROM events
         WHERE seq > :start_seq AND source <> :demo AND task_id IS NOT NULL`,
      ).all({ start_seq: startSeq, demo: SOURCES.DEMO });
      return {
        agentIds: new Set(agentRows.map((row) => String(row['agent_id']))),
        taskIds: new Set(taskRows.map((row) => String(row['task_id']))),
      };
    },
  };
}
