// Field-level schema primitives (API_CONTRACTS §5.2, §0 "Strings", REQ-023).
import { z } from 'zod';
import { LIMITS, RESERVED_TASK_IDS, SOURCE_PATTERN, TASK_ID_PATTERN } from '../constants/limits';
import { AGENT_STATUSES, SEVERITIES, TASK_PRIORITIES, TASK_STATUSES } from '../constants/statuses';
import type { JsonObject } from '../types/json';

/** Trimmed, 1–64 chars. */
export const agentIdSchema = z.string().trim().min(1).max(LIMITS.AGENT_ID_MAX);

/** Trimmed, 1–100 chars: a project id or name, unresolved (ADR-006). */
export const projectRefSchema = z.string().trim().min(1).max(LIMITS.PROJECT_REF_MAX);

/** Trimmed, `TASK_ID_PATTERN`. */
export const taskIdSchema = z
  .string()
  .trim()
  .regex(TASK_ID_PATTERN, 'Task id must be 1–64 characters: letters, digits, ".", "_" or "-"')
  .refine((id) => !(RESERVED_TASK_IDS as readonly string[]).includes(id), {
    error: (issue) => `Task id "${String(issue.input)}" is reserved`,
  });

/** Trimmed, `SOURCE_PATTERN` (reserved sources are allowed here; see `producerSourceSchema`). */
export const sourceSchema = z
  .string()
  .trim()
  .regex(SOURCE_PATTERN, 'Source must be 1–50 characters: a-z, 0-9, ".", "_" or "-"');

export const agentStatusSchema = z.enum(AGENT_STATUSES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const severitySchema = z.enum(SEVERITIES);

/** Integer 0–100. */
export const progressSchema = z.number().int().min(0).max(100);

/** Trimmed, 1–100 chars. Messages are the Developer Simulator copy (UX §9.5). */
export const actionSchema = z
  .string({
    error: (iss) =>
      iss.input === undefined || iss.input === null ? 'Action is required.' : undefined,
  })
  .trim()
  .min(1, 'Action is required.')
  .max(LIMITS.ACTION_MAX, 'Action must be 100 characters or fewer.');

/** Trimmed, 0–2000 chars (types that require a message additionally need ≥ 1 char). */
export const messageSchema = z
  .string()
  .trim()
  .max(LIMITS.MESSAGE_MAX, 'Message must be 2,000 characters or fewer.');

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Walks a value iteratively (no recursion, so hostile nesting cannot overflow the stack) and checks
 * that it only contains JSON values. Every JSON value needs at least one byte, so more than
 * `METADATA_BYTES` values (or a cycle) means the serialized form is certainly too large.
 */
function inspectJson(root: unknown): 'ok' | 'invalid' | 'too-large' {
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    visited += 1;
    if (visited > LIMITS.METADATA_BYTES) return 'too-large';
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'invalid';
      continue;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const item: unknown = value[i];
        if (item === undefined) return 'invalid';
        stack.push(item);
      }
      continue;
    }
    if (isPlainObject(value)) {
      // `undefined` property values are skipped, exactly like JSON.stringify does.
      for (const item of Object.values(value)) if (item !== undefined) stack.push(item);
      continue;
    }
    return 'invalid';
  }
  return 'ok';
}

const utf8 = new TextEncoder();

/** UTF-8 byte length of `JSON.stringify(value)`; `Infinity` if it cannot be serialized. */
export function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : utf8.encode(json).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** A plain JSON object (not an array or null) whose `JSON.stringify` is ≤ 8192 UTF-8 bytes. */
export const metadataSchema = z.custom<JsonObject>().superRefine((value: unknown, ctx) => {
  if (!isPlainObject(value)) {
    ctx.addIssue({ code: 'custom', message: 'Metadata must be a JSON object' });
    return;
  }
  const verdict = inspectJson(value);
  if (verdict === 'invalid') {
    ctx.addIssue({ code: 'custom', message: 'Metadata must contain only JSON values' });
  } else if (verdict === 'too-large' || jsonByteLength(value) > LIMITS.METADATA_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Metadata exceeds 8 KB' });
  }
});

/** ISO-8601 datetime with `Z` or an offset. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
