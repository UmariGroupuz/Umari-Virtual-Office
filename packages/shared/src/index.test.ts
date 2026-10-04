import { describe, expect, it } from 'vitest';
import * as shared from './index';

/** Every runtime export named in API_CONTRACTS §1.2, §2.1, §5.2 and §6. */
const CONTRACT_RUNTIME_EXPORTS = [
  // constants/statuses.ts, eventTypes.ts, rooms.ts
  'AGENT_STATUSES',
  'ACTIVE_AGENT_STATUSES',
  'RESTING_AGENT_STATUSES',
  'TASK_STATUSES',
  'ACTIVE_TASK_STATUSES',
  'TERMINAL_TASK_STATUSES',
  'TASK_PRIORITIES',
  'SEVERITIES',
  'PRODUCER_EVENT_TYPES',
  'SERVER_EVENT_TYPES',
  'EVENT_TYPES',
  'SOURCES',
  'DEFAULT_SOURCE',
  'RESERVED_SOURCES',
  'PROJECTLESS_VISIBLE_TYPES',
  'ROOM_IDS',
  'ROOMS',
  // officeLayout.ts, actions.ts, limits.ts, errorCodes.ts
  'OFFICE_WORLD',
  'DESK_SLOT',
  'OFFICE_ROOMS',
  'OFFICE_ZOOM',
  'AGENT_DISPLAY_ORDER',
  'KNOWN_ACTIONS',
  'SIMULATOR_ACTION_SUGGESTIONS',
  'LIMITS',
  'TASK_ID_PATTERN',
  'RESERVED_TASK_IDS',
  'SOURCE_PATTERN',
  'ERROR_CODES',
  'ERROR_HTTP_STATUS',
  // labels.ts, palette.ts, app.ts
  'AGENT_STATUS_LABELS',
  'TASK_STATUS_LABELS',
  'TASK_PRIORITY_LABELS',
  'SEVERITY_LABELS',
  'UI_COLORS',
  'STATUS_COLORS',
  'DEPARTMENT_COLORS',
  'TASK_STATUS_COLOR_KEY',
  'PRIORITY_COLORS',
  'APP_NAME',
  'APP_VERSION',
  'API_PREFIX',
  'SOCKET_PATH',
  'SOCKET_EVENTS',
  'DEFAULT_SERVER_PORT',
  'DEFAULT_WEB_PORT',
  // schemas
  'agentIdSchema',
  'projectRefSchema',
  'taskIdSchema',
  'sourceSchema',
  'agentStatusSchema',
  'taskStatusSchema',
  'taskPrioritySchema',
  'severitySchema',
  'progressSchema',
  'actionSchema',
  'messageSchema',
  'metadataSchema',
  'isoDateTimeSchema',
  'eventInputSchema',
  'producerEventInputSchema',
  'agentStatusPatchSchema',
  'taskCreateSchema',
  'taskPatchSchema',
  'demoStartSchema',
  'demoStopSchema',
  'agentsQuerySchema',
  'eventsQuerySchema',
  'tasksQuerySchema',
  'snapshotQuerySchema',
  'toValidationIssues',
  // state, filters, reference
  'AGENT_TRANSITIONS',
  'canTransitionAgent',
  'getAllowedAgentTargets',
  'isActiveAgentStatus',
  'TASK_TRANSITIONS',
  'canTransitionTask',
  'isTerminalTaskStatus',
  'isActiveTaskStatus',
  'AGENT_TO_TASK_STATUS',
  'mapAgentStatusToTaskStatus',
  'eventMatchesProject',
  'agentMatchesProject',
  'taskMatchesProject',
  'PROJECTS',
  'PROJECT_IDS',
  'ALL_PROJECTS_LABEL',
  'resolveProjectRef',
  'AGENT_REFERENCE',
  'AGENT_IDS',
] as const;

describe('@vo/shared public surface (§5.2)', () => {
  it.each(CONTRACT_RUNTIME_EXPORTS.map((name) => ({ name })))('exports $name', ({ name }) => {
    expect(shared[name]).toBeDefined();
  });

  it('does not leak internal helpers', () => {
    const names = Object.keys(shared);
    for (const internal of [
      'optionalString',
      'optionalValue',
      'stripUndefined',
      'producerSourceSchema',
    ]) {
      expect(names).not.toContain(internal);
    }
  });
});
