import type { DatabaseSync } from 'node:sqlite';
import type { Repositories } from '../types';
import { createAgentRepository } from './agentRepository';
import { createEventRepository } from './eventRepository';
import { createProjectRepository } from './projectRepository';
import { createSettingsRepository } from './settingsRepository';
import { createStatementCache } from './statements';
import { createTaskRepository } from './taskRepository';

/** Builds the repositories of one connection; they share one prepared-statement cache. */
export function createRepositories(db: DatabaseSync): Repositories {
  const prepare = createStatementCache(db);
  return Object.freeze({
    projects: createProjectRepository(prepare),
    agents: createAgentRepository(prepare),
    tasks: createTaskRepository(prepare),
    events: createEventRepository(prepare),
    settings: createSettingsRepository(prepare),
  });
}
