// Migration 1 / init — the Phase 1 schema, exactly API_CONTRACTS §8 (ADR-003/004).
// Forward-only. Never edit this migration once a database outside a developer machine has applied it;
// add `002_*.ts` instead.
import type { Migration } from './index';

export const migration001Init: Migration = {
  version: 1,
  name: 'init',
  sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, task_prefix TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
  short_role TEXT NOT NULL, avatar TEXT NOT NULL, department TEXT NOT NULL, room_id TEXT NOT NULL,
  desk_id TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('idle','planning','working','waiting','reviewing','completed','failed','offline')),
  current_project TEXT NULL REFERENCES projects(id), current_task TEXT NULL, task_id TEXT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  started_at TEXT NULL, last_activity_at TEXT NULL, current_action TEXT NULL, last_message TEXT NULL,
  online INTEGER NOT NULL CHECK (online IN (0,1)), metadata TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id), assigned_agent_id TEXT NULL REFERENCES agents(id),
  status TEXT NOT NULL CHECK (status IN ('todo','assigned','planning','in_progress','waiting','review','completed','failed','cancelled')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_at TEXT NOT NULL, started_at TEXT NULL, completed_at TEXT NULL,
  blocked_by TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
-- GET /api/tasks?project=&status= and the Active/Completed task metrics.
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
-- GET /api/tasks?agentId= and the detail panel Tasks tab.
CREATE INDEX idx_tasks_assignee ON tasks(assigned_agent_id);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, source TEXT NOT NULL,
  agent_id TEXT NULL REFERENCES agents(id), project_id TEXT NULL REFERENCES projects(id), task_id TEXT NULL,
  status TEXT NULL, action TEXT NULL, message TEXT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error')),
  progress INTEGER NULL CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  metadata TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NULL, created_at TEXT NOT NULL,
  forced INTEGER NOT NULL DEFAULT 0 CHECK (forced IN (0,1))
);
-- Feed filtered by project (GET /api/events?project=, snapshot events), newest first by seq.
CREATE INDEX idx_events_project_seq ON events(project_id, seq);
-- Detail panel Activity tab (GET /api/events?agentId=), demo touched-agent detection.
CREATE INDEX idx_events_agent_seq ON events(agent_id, seq);
-- GET /api/events?type= and the 'agent.%' / project-less system rows of the feed predicate.
CREATE INDEX idx_events_type_seq ON events(type, seq);
-- GET /api/events?taskId= and demo touched-task detection.
CREATE INDEX idx_events_task_seq ON events(task_id, seq);
CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL );
`,
};
