// Claude Code producer adapter (API_CONTRACTS §5.3, EVENT_SYSTEM §10.1, ADR-007, REQ-131/132).
//
// Integration status: UNVERIFIED. The input format is the owner's example from ORIGINAL_REQUEST §19, not
// a documented Claude Code contract. The adapter is pure and NOT wired to any route or process in
// Phase 1 (see docs/INTEGRATIONS.md).
import { z } from 'zod';
import { LIMITS } from '../constants/limits';
import { jsonByteLength, metadataSchema } from '../schemas/common';
import { producerEventInputSchema, type EventInputBody } from '../schemas/event';
import { toValidationIssues } from '../schemas/issues';
import type { JsonObject, JsonValue } from '../types/json';
import { AdapterError, type ProducerAdapter } from './types';

const CLAUDE_CODE_SOURCE = 'claude-code';
const CLAUDE_CODE_ADAPTER_VERSION = 1;

const SUPPORTED_EVENT = 'tool.executed';
/** Command length inside `message` (ES §10.1). */
const MESSAGE_COMMAND_MAX = 500;
/** Command length inside `metadata.raw` (ES §10.1). */
const RAW_COMMAND_MAX = 1_000;
/** Tool and result lengths in `message`/`metadata.raw` (interpretation: keeps the core raw ≤ 8 KB). */
const RAW_SHORT_MAX = 100;
/** Bytes kept free for the truncation markers when extra raw fields are dropped. */
const MARKER_RESERVE_BYTES = 64;
const MAX_ERROR_MESSAGE = 500;

const FAILURE_RESULTS: ReadonlySet<string> = new Set(['failure', 'failed', 'error']);
/** Raw fields mapped to canonical fields; everything else is kept in `metadata.raw`. */
const COPIED_KEYS: ReadonlySet<string> = new Set(['source', 'agentId', 'project', 'taskId']);
const RAW_CORE_KEYS: ReadonlySet<string> = new Set(['event', 'tool', 'command', 'result']);

/** The §19 payload. Loose: unknown producer fields are kept and copied into `metadata.raw`. */
export const claudeCodeEventSchema = z.looseObject({
  source: z.literal(CLAUDE_CODE_SOURCE),
  agentId: z.string(),
  project: z.string().nullish(),
  taskId: z.string().nullish(),
  event: z.string(),
  tool: z.string().nullish(),
  command: z.string().nullish(),
  result: z.string().nullish(),
});

export type ClaudeCodeEvent = z.output<typeof claudeCodeEventSchema>;

/** Tool → action (ES §10.1, case-insensitive). Terminal tools are classified by command. */
const TOOL_ACTIONS: ReadonlyMap<string, string> = new Map([
  ['read', 'read_file'],
  ['read_file', 'read_file'],
  ['write', 'write_file'],
  ['write_file', 'write_file'],
  ['edit', 'edit_file'],
  ['edit_file', 'edit_file'],
  ['multiedit', 'edit_file'],
  ['grep', 'search'],
  ['glob', 'search'],
  ['search', 'search'],
  ['browser', 'browser'],
  ['webfetch', 'browser'],
  ['web_fetch', 'browser'],
  ['wait', 'wait'],
]);
const TERMINAL_TOOLS: ReadonlySet<string> = new Set(['terminal', 'bash', 'shell']);

const GIT_STATUS_PATTERN = /^git status\b/;
const GIT_DIFF_PATTERN = /^git diff\b/;
const GIT_COMMIT_PATTERN = /^git commit\b/;
const TEST_PATTERN = /\b(npm|pnpm|yarn)( run)? test\b|vitest|jest|pytest/;
const BUILD_PATTERN = /\b(npm|pnpm|yarn)( run)? build\b|\btsc\b|vite build/;

/** Shell command → action; the command is lowercased and whitespace-collapsed for matching only. */
function classifyCommand(command: string | undefined): string {
  const normalized = (command ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (GIT_STATUS_PATTERN.test(normalized)) return 'git_status';
  if (GIT_DIFF_PATTERN.test(normalized)) return 'git_diff';
  if (GIT_COMMIT_PATTERN.test(normalized)) return 'git_commit';
  if (TEST_PATTERN.test(normalized)) return 'test';
  if (BUILD_PATTERN.test(normalized)) return 'build';
  return 'run_command';
}

/** Unknown tool → lowercased slug (`[a-z0-9._-]`, other runs → `_`), at most 100 chars. */
function toolSlug(normalizedTool: string): string {
  const slug = normalizedTool.replace(/[^a-z0-9._-]+/g, '_').slice(0, LIMITS.ACTION_MAX);
  return slug === '' ? 'unknown_tool' : slug;
}

/** ES §10.1 tool → action table (REQ-132 vocabulary); `tool` is matched case-insensitively. */
export function mapClaudeToolToAction(tool: string, command?: string): string {
  const normalized = tool.trim().toLowerCase();
  if (TERMINAL_TOOLS.has(normalized)) return classifyCommand(command);
  return TOOL_ACTIONS.get(normalized) ?? toolSlug(normalized);
}

/** At most `max` UTF-16 units including the trailing `…`; never splits a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

function isFailure(result: string | null | undefined): boolean {
  return typeof result === 'string' && FAILURE_RESULTS.has(result.trim().toLowerCase());
}

function describeIssues(prefix: string, error: z.ZodError): string {
  const details = toValidationIssues(error)
    .map((issue) => `${issue.path === '' ? '(root)' : issue.path}: ${issue.message}`)
    .join('; ');
  return truncate(`${prefix}: ${details}`, MAX_ERROR_MESSAGE);
}

/** True when `value` is a JSON value that fits in metadata on its own. */
function isJsonValue(value: unknown): value is JsonValue {
  return metadataSchema.safeParse({ value }).success;
}

/**
 * `{ adapter, adapterVersion, raw }` (ES §10.1), ≤ 8 KB. Core raw fields are length-capped, so they
 * always fit; extra producer fields are added in order while they fit. When anything was shortened or
 * dropped, `truncated: true` is set (and `droppedRawFields` counts dropped extra fields).
 */
function buildMetadata(event: ClaudeCodeEvent, tool: string): JsonObject {
  const raw: Record<string, JsonValue> = {};
  let truncated = false;
  const keep = (key: string, value: string | null | undefined, max: number): void => {
    if (typeof value !== 'string') return;
    const kept = truncate(value, max);
    if (kept !== value) truncated = true;
    raw[key] = kept;
  };
  keep('event', event.event, RAW_SHORT_MAX);
  keep('tool', tool, RAW_SHORT_MAX);
  keep('command', event.command, RAW_COMMAND_MAX);
  keep('result', event.result, RAW_SHORT_MAX);

  const metadata: JsonObject = {
    adapter: CLAUDE_CODE_SOURCE,
    adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
    raw,
  };

  const budget = LIMITS.METADATA_BYTES - MARKER_RESERVE_BYTES;
  let size = jsonByteLength(metadata);
  let dropped = 0;
  for (const [key, value] of Object.entries(event)) {
    if (COPIED_KEYS.has(key) || RAW_CORE_KEYS.has(key) || value === undefined) continue;
    // `__proto__` cannot be stored as a plain own key safely; non-JSON values cannot be stored at all.
    if (key === '__proto__' || !isJsonValue(value)) {
      dropped += 1;
      continue;
    }
    // Adds `,"key":value` to a non-empty object (`raw` always holds `event` and `tool`).
    const added = jsonByteLength(key) + jsonByteLength(value) + 2;
    if (size + added > budget) {
      dropped += 1;
      continue;
    }
    raw[key] = value;
    size += added;
  }

  if (dropped > 0) {
    metadata.truncated = true;
    metadata.droppedRawFields = dropped;
  } else if (truncated) {
    metadata.truncated = true;
  }
  return metadata;
}

function toCanonical(input: ClaudeCodeEvent): EventInputBody[] {
  // Re-validated here: registry callers (Phase 2) hold `unknown` payloads.
  const parsed = claudeCodeEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdapterError(
      'INVALID_PAYLOAD',
      describeIssues('Invalid Claude Code payload', parsed.error),
    );
  }
  const event = parsed.data;

  if (event.event.trim() !== SUPPORTED_EVENT) {
    throw new AdapterError(
      'UNSUPPORTED_EVENT',
      `Unsupported Claude Code event: ${JSON.stringify(truncate(event.event, RAW_SHORT_MAX))}`,
    );
  }

  const tool = event.tool?.trim() ?? '';
  if (tool === '') {
    throw new AdapterError(
      'INVALID_PAYLOAD',
      'Invalid Claude Code payload: tool: Tool is required for tool.executed',
    );
  }

  const failed = isFailure(event.result);
  const command = event.command?.trim() ?? '';
  const label = truncate(tool, RAW_SHORT_MAX);
  const message =
    (command === '' ? label : `${label}: ${truncate(command, MESSAGE_COMMAND_MAX)}`) +
    (failed ? ' (failed)' : '');

  const body: EventInputBody = {
    type: 'agent.activity',
    source: event.source,
    agentId: event.agentId,
    project: event.project ?? undefined,
    taskId: event.taskId ?? undefined,
    action: mapClaudeToolToAction(tool, event.command ?? undefined),
    message,
    severity: failed ? 'error' : 'info',
    metadata: buildMetadata(event, event.tool ?? tool),
  };

  const canonical = producerEventInputSchema.safeParse(body);
  if (!canonical.success) {
    throw new AdapterError(
      'INVALID_PAYLOAD',
      describeIssues('Claude Code payload does not map to a valid event', canonical.error),
    );
  }
  return [canonical.data];
}

/** Pure Claude Code adapter (UNVERIFIED format; not wired to any route in Phase 1, ADR-007). */
export const claudeCodeAdapter: ProducerAdapter<ClaudeCodeEvent> = {
  source: CLAUDE_CODE_SOURCE,
  schema: claudeCodeEventSchema,
  toCanonical,
};
