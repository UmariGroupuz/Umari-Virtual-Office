import type { Agent } from '@vo/shared';
import { agentMutableParams, rowToAgent } from '../mappers';
import type { AgentPatch, AgentRepository } from '../types';
import { applyPatch, changesOf, type PrepareCached } from './statements';

const COLUMNS = `id, code, name, role, short_role, avatar, department, room_id, desk_id, status,
  current_project, current_task, task_id, progress, started_at, last_activity_at, current_action,
  last_message, online, metadata, version`;

const SELECT_BY_ID = `SELECT ${COLUMNS} FROM agents WHERE id = ?`;

/** Writes every mutable column; `version` is always the stored value + 1 (ADR-010). */
const UPDATE_MUTABLE = `UPDATE agents SET
  status = :status, current_project = :current_project, current_task = :current_task,
  task_id = :task_id, progress = :progress, started_at = :started_at,
  last_activity_at = :last_activity_at, current_action = :current_action,
  last_message = :last_message, online = :online, metadata = :metadata,
  version = version + 1, updated_at = :updated_at
  WHERE id = :id`;

export function createAgentRepository(prepare: PrepareCached): AgentRepository {
  function getById(id: string): Agent | null {
    const row = prepare(SELECT_BY_ID).get(id);
    return row ? rowToAgent(row) : null;
  }

  function requireAgent(id: string): Agent {
    const agent = getById(id);
    if (agent === null) throw new Error(`Agent not found: ${id}`);
    return agent;
  }

  function writeMutable(id: string, next: Agent, now: string): Agent {
    const result = prepare(UPDATE_MUTABLE).run({
      ...agentMutableParams(next),
      updated_at: now,
      id,
    });
    if (changesOf(result) !== 1) throw new Error(`Agent not found: ${id}`);
    return requireAgent(id);
  }

  return {
    list(filter?: { projectId?: string }): Agent[] {
      if (filter?.projectId !== undefined) {
        return prepare(
          `SELECT ${COLUMNS} FROM agents WHERE current_project = ? ORDER BY sort_order, id`,
        )
          .all(filter.projectId)
          .map(rowToAgent);
      }
      return prepare(`SELECT ${COLUMNS} FROM agents ORDER BY sort_order, id`).all().map(rowToAgent);
    },

    getById,

    count(): number {
      return Number(prepare('SELECT COUNT(*) AS n FROM agents').get()?.['n'] ?? 0);
    },

    insert(agent: Agent & { sortOrder: number }, now: string): void {
      prepare(
        `INSERT INTO agents (id, code, name, role, short_role, avatar, department, room_id, desk_id,
           sort_order, status, current_project, current_task, task_id, progress, started_at,
           last_activity_at, current_action, last_message, online, metadata, version, updated_at)
         VALUES (:id, :code, :name, :role, :short_role, :avatar, :department, :room_id, :desk_id,
           :sort_order, :status, :current_project, :current_task, :task_id, :progress, :started_at,
           :last_activity_at, :current_action, :last_message, :online, :metadata, :version, :updated_at)`,
      ).run({
        ...agentMutableParams(agent),
        id: agent.id,
        code: agent.code,
        name: agent.name,
        role: agent.role,
        short_role: agent.shortRole,
        avatar: agent.avatar,
        department: agent.department,
        room_id: agent.roomId,
        desk_id: agent.deskId,
        sort_order: agent.sortOrder,
        version: agent.version,
        updated_at: now,
      });
    },

    update(id: string, patch: AgentPatch, now: string): Agent {
      return writeMutable(id, applyPatch<Agent>(requireAgent(id), patch), now);
    },

    replace(agent: Agent, now: string): Agent {
      requireAgent(agent.id);
      return writeMutable(agent.id, agent, now);
    },
  };
}
