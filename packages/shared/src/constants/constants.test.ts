import { describe, expect, it } from 'vitest';
import { KNOWN_ACTIONS, SIMULATOR_ACTION_SUGGESTIONS } from './actions';
import {
  API_PREFIX,
  APP_NAME,
  APP_VERSION,
  DEFAULT_SERVER_PORT,
  DEFAULT_WEB_PORT,
  SOCKET_EVENTS,
  SOCKET_PATH,
} from './app';
import { ERROR_CODES, ERROR_HTTP_STATUS } from './errorCodes';
import {
  DEFAULT_SOURCE,
  EVENT_TYPES,
  PRODUCER_EVENT_TYPES,
  PROJECTLESS_VISIBLE_TYPES,
  RESERVED_SOURCES,
  SERVER_EVENT_TYPES,
  SOURCES,
} from './eventTypes';
import {
  AGENT_STATUS_LABELS,
  SEVERITY_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from './labels';
import { LIMITS, SOURCE_PATTERN, TASK_ID_PATTERN } from './limits';
import {
  DEPARTMENT_COLORS,
  PRIORITY_COLORS,
  STATUS_COLORS,
  TASK_STATUS_COLOR_KEY,
  UI_COLORS,
} from './palette';
import { ROOM_IDS } from './rooms';
import {
  ACTIVE_AGENT_STATUSES,
  ACTIVE_TASK_STATUSES,
  AGENT_STATUSES,
  RESTING_AGENT_STATUSES,
  SEVERITIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
} from './statuses';

const HEX = /^#[0-9A-F]{6}$/;

describe('enumerations (§1.2)', () => {
  it('statuses, priorities, severities', () => {
    expect(AGENT_STATUSES).toEqual([
      'idle',
      'planning',
      'working',
      'waiting',
      'reviewing',
      'completed',
      'failed',
      'offline',
    ]);
    expect(ACTIVE_AGENT_STATUSES).toEqual(['planning', 'working', 'waiting', 'reviewing']);
    expect(RESTING_AGENT_STATUSES).toEqual(['idle', 'completed', 'failed']);
    expect(TASK_STATUSES).toEqual([
      'todo',
      'assigned',
      'planning',
      'in_progress',
      'waiting',
      'review',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(ACTIVE_TASK_STATUSES).toEqual([
      'assigned',
      'planning',
      'in_progress',
      'waiting',
      'review',
    ]);
    expect(TERMINAL_TASK_STATUSES).toEqual(['completed', 'cancelled']);
    expect(TASK_PRIORITIES).toEqual(['low', 'normal', 'high', 'critical']);
    expect(SEVERITIES).toEqual(['info', 'warning', 'error']);
  });

  it('13 producer + 2 server event types = 15, all unique', () => {
    expect(PRODUCER_EVENT_TYPES).toHaveLength(13);
    expect(SERVER_EVENT_TYPES).toEqual(['task.created', 'task.updated']);
    expect(EVENT_TYPES).toHaveLength(15);
    expect(new Set(EVENT_TYPES).size).toBe(15);
    expect(EVENT_TYPES).toEqual([...PRODUCER_EVENT_TYPES, ...SERVER_EVENT_TYPES]);
  });

  it('sources', () => {
    expect(SOURCES).toEqual({ API: 'api', SIMULATOR: 'simulator', DEMO: 'demo', SYSTEM: 'system' });
    expect(DEFAULT_SOURCE).toBe('api');
    expect(RESERVED_SOURCES).toEqual(['demo', 'system']);
    expect(PROJECTLESS_VISIBLE_TYPES).toEqual(['system.warning', 'system.error']);
    for (const s of Object.values(SOURCES)) expect(SOURCE_PATTERN.test(s)).toBe(true);
  });

  it('8 room ids', () => {
    expect(ROOM_IDS).toEqual([
      'management',
      'development',
      'design',
      'infrastructure',
      'quality',
      'ai-lab',
      'documentation',
      'audit',
    ]);
  });
});

describe('limits and patterns (§5.2)', () => {
  it('LIMITS values', () => {
    expect(LIMITS).toEqual({
      BODY_BYTES: 102_400,
      METADATA_BYTES: 8_192,
      ACTION_MAX: 100,
      MESSAGE_MAX: 2_000,
      SOURCE_MAX: 50,
      AGENT_ID_MAX: 64,
      PROJECT_REF_MAX: 100,
      TASK_ID_MAX: 64,
      TITLE_MAX: 200,
      DESCRIPTION_MAX: 5_000,
      BLOCKED_BY_MAX: 20,
      LIST_MAX: 500,
      EVENTS_DEFAULT_LIMIT: 50,
      TASKS_DEFAULT_LIMIT: 500,
      FEED_CAP: 200,
      DEMO_INTERVAL_MIN_MS: 2_000,
      DEMO_INTERVAL_MAX_MS: 10_000,
      DEMO_INTERVAL_DEFAULT_MS: 3_000,
      REQUEST_TIMEOUT_MS: 10_000,
      HEALTH_TIMEOUT_MS: 5_000,
    });
  });

  it('TASK_ID_PATTERN and SOURCE_PATTERN', () => {
    expect(TASK_ID_PATTERN.source).toBe('^[A-Za-z0-9._-]{1,64}$');
    expect(SOURCE_PATTERN.source).toBe('^[a-z0-9._-]{1,50}$');
    expect(TASK_ID_PATTERN.test('SW-D57-1a')).toBe(true);
    expect(SOURCE_PATTERN.test('claude-code')).toBe(true);
    expect(TASK_ID_PATTERN.flags).toBe(''); // no `g`: .test() is stateless
    expect(SOURCE_PATTERN.flags).toBe('');
  });
});

describe('actions (REQ-132, UX §9.3)', () => {
  it('known actions and simulator suggestions in UX order', () => {
    expect(KNOWN_ACTIONS).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'search',
      'run_command',
      'git_status',
      'git_diff',
      'git_commit',
      'test',
      'build',
      'browser',
      'wait',
      'error',
    ]);
    expect(SIMULATOR_ACTION_SUGGESTIONS).toEqual([
      'run_tests',
      'read_file',
      'write_file',
      'edit_file',
      'search',
      'run_command',
      'git_status',
      'git_diff',
      'git_commit',
      'test',
      'build',
      'browser',
      'wait',
      'error',
    ]);
  });
});

describe('error codes (§2.1)', () => {
  it('codes equal their keys and map to the documented HTTP statuses', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) expect(value).toBe(key);
    expect(ERROR_HTTP_STATUS).toEqual({
      INVALID_JSON: 400,
      VALIDATION_ERROR: 400,
      HOST_NOT_ALLOWED: 403,
      ORIGIN_NOT_ALLOWED: 403,
      NOT_FOUND: 404,
      AGENT_NOT_FOUND: 404,
      TASK_NOT_FOUND: 404,
      ILLEGAL_TRANSITION: 409,
      TASK_EXISTS: 409,
      PAYLOAD_TOO_LARGE: 413,
      UNKNOWN_AGENT: 422,
      UNKNOWN_PROJECT: 422,
      UNKNOWN_TASK: 422,
      PROJECT_MISMATCH: 422,
      INTERNAL_ERROR: 500,
      SERVICE_UNAVAILABLE: 503,
    });
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });
});

describe('app constants (§5.2)', () => {
  it('values', () => {
    expect(APP_NAME).toBe('AI Virtual Office');
    expect(APP_VERSION).toBe('0.1.0');
    expect(API_PREFIX).toBe('/api');
    expect(SOCKET_PATH).toBe('/socket.io');
    expect(SOCKET_EVENTS).toEqual({
      OFFICE_EVENT: 'office:event',
      DEMO_STATE: 'demo:state',
      OFFICE_RESYNC: 'office:resync',
    });
    expect(DEFAULT_SERVER_PORT).toBe(4000);
    expect(DEFAULT_WEB_PORT).toBe(5173);
  });
});

describe('labels (UX §1.2/§1.3) cover every enum value', () => {
  it('exact copy', () => {
    expect(AGENT_STATUS_LABELS).toEqual({
      idle: 'Idle',
      planning: 'Planning',
      working: 'Working',
      waiting: 'Waiting',
      reviewing: 'Reviewing',
      completed: 'Completed',
      failed: 'Failed',
      offline: 'Offline',
    });
    expect(TASK_STATUS_LABELS).toEqual({
      todo: 'To do',
      assigned: 'Assigned',
      planning: 'Planning',
      in_progress: 'In progress',
      waiting: 'Waiting',
      review: 'In review',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    });
    expect(TASK_PRIORITY_LABELS).toEqual({
      low: 'Low',
      normal: 'Normal',
      high: 'High',
      critical: 'Critical',
    });
    expect(SEVERITY_LABELS).toEqual({ info: 'Info', warning: 'Warning', error: 'Error' });
  });

  it('key sets equal the enums', () => {
    expect(Object.keys(AGENT_STATUS_LABELS)).toEqual([...AGENT_STATUSES]);
    expect(Object.keys(TASK_STATUS_LABELS)).toEqual([...TASK_STATUSES]);
    expect(Object.keys(TASK_PRIORITY_LABELS)).toEqual([...TASK_PRIORITIES]);
    expect(Object.keys(SEVERITY_LABELS)).toEqual([...SEVERITIES]);
  });
});

describe('palette (UX §1.1–1.4, ADR-025)', () => {
  it('UI_COLORS exact values', () => {
    expect(UI_COLORS).toEqual({
      bg: '#0B0D10',
      bgSunken: '#0E1014',
      panel: '#13161B',
      raised: '#1A1E24',
      raisedHover: '#222730',
      borderSubtle: '#262B33',
      borderStrong: '#3A414C',
      textPrimary: '#E6E8EB',
      textSecondary: '#A3AAB5',
      textMuted: '#8B939E',
      accent: '#5B8DEF',
      accentText: '#8AB0FF',
      accentStrong: '#3B6FD9',
      accentTint: '#1A2230',
      roomFloor: '#15181D',
    });
  });

  it('STATUS_COLORS exact values for every agent status', () => {
    expect(STATUS_COLORS).toEqual({
      idle: { color: '#9AA3AE', chipTint: '#292D33' },
      planning: { color: '#4FB6E0', chipTint: '#1D303B' },
      working: { color: '#3FB950', chipTint: '#1A3023' },
      waiting: { color: '#D9A13B', chipTint: '#332C20' },
      reviewing: { color: '#A98AF5', chipTint: '#2B293E' },
      completed: { color: '#4CC38A', chipTint: '#1C322D' },
      failed: { color: '#F2645A', chipTint: '#372225' },
      offline: { color: '#8A929D', chipTint: '#262A30' },
    });
    expect(Object.keys(STATUS_COLORS)).toEqual([...AGENT_STATUSES]);
  });

  it('DEPARTMENT_COLORS exact values for every room', () => {
    expect(DEPARTMENT_COLORS).toEqual({
      management: { color: '#7C8BC9', avatarBg: '#30374C' },
      development: { color: '#5E9E94', avatarBg: '#283C3D' },
      design: { color: '#B57F9F', avatarBg: '#403340' },
      infrastructure: { color: '#8A9A5B', avatarBg: '#343B2D' },
      quality: { color: '#B98B63', avatarBg: '#41372F' },
      'ai-lab': { color: '#9583C9', avatarBg: '#37354C' },
      documentation: { color: '#7F97A8', avatarBg: '#313A42' },
      audit: { color: '#A39580', avatarBg: '#3B3A37' },
    });
    expect(Object.keys(DEPARTMENT_COLORS)).toEqual([...ROOM_IDS]);
  });

  it('TASK_STATUS_COLOR_KEY and PRIORITY_COLORS', () => {
    expect(TASK_STATUS_COLOR_KEY).toEqual({
      todo: 'idle',
      assigned: 'planning',
      planning: 'planning',
      in_progress: 'working',
      waiting: 'waiting',
      review: 'reviewing',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'offline',
    });
    expect(Object.keys(TASK_STATUS_COLOR_KEY)).toEqual([...TASK_STATUSES]);
    expect(PRIORITY_COLORS).toEqual({
      low: '#8B939E',
      normal: '#A3AAB5',
      high: '#E08A4F',
      critical: '#F2645A',
    });
  });

  it('every color is an upper-case #RRGGBB hex string', () => {
    const all = [
      ...Object.values(UI_COLORS),
      ...Object.values(STATUS_COLORS).flatMap((c) => [c.color, c.chipTint]),
      ...Object.values(DEPARTMENT_COLORS).flatMap((c) => [c.color, c.avatarBg]),
      ...Object.values(PRIORITY_COLORS),
    ];
    for (const hex of all) expect(hex).toMatch(HEX);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(UI_COLORS)).toBe(true);
    expect(Object.isFrozen(STATUS_COLORS.working)).toBe(true);
    expect(Object.isFrozen(DEPARTMENT_COLORS.audit)).toBe(true);
  });
});
