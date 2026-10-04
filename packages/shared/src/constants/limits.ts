// Input and list limits (API_CONTRACTS §5.2, REQ-023, NFR-004).

export const LIMITS = {
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
} as const;

export const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** Ids that would collide with JavaScript object internals when used as keys (ADR-037, SEC-4). */
export const RESERVED_TASK_IDS = ['__proto__', 'constructor', 'prototype'] as const;
export const SOURCE_PATTERN = /^[a-z0-9._-]{1,50}$/;
