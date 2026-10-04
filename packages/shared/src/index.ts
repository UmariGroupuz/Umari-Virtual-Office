// @vo/shared — the shared domain contract (API_CONTRACTS §5). Platform-neutral; only runtime dependency: zod.

export * from './constants/statuses';
export * from './constants/eventTypes';
export * from './constants/rooms';
export * from './constants/officeLayout';
export * from './constants/actions';
export * from './constants/limits';
export * from './constants/errorCodes';
export * from './constants/labels';
export * from './constants/palette';
export * from './constants/app';

export * from './types/json';
export * from './types/project';
export * from './types/agent';
export * from './types/task';
export * from './types/event';
export * from './types/demo';
export * from './types/api';
export * from './types/socket';

export * from './schemas/common';
export * from './schemas/event';
export * from './schemas/agent';
export * from './schemas/task';
export * from './schemas/demo';
export * from './schemas/query';
export * from './schemas/issues';

export * from './state/agentStateMachine';
export * from './state/taskStateMachine';
export * from './state/statusMapping';

export * from './filters/projectFilters';

export * from './reference/projects';
export * from './reference/agents';

export * from './adapters';
