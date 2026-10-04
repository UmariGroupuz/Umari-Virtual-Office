// Internal field wrappers implementing the body rules of API_CONTRACTS §0 (not re-exported by the
// package): strings are trimmed, an optional string that is empty after trim is absent, and `null` for an
// optional field is absent (ADR-027 §6) unless the field is documented as nullable.
import { z } from 'zod';
import { RESERVED_SOURCES } from '../constants/eventTypes';
import { LIMITS } from '../constants/limits';
import { sourceSchema } from './common';

const blankToUndefined = (value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : value;

/** Optional string: trimmed; `null`, absent or blank → absent; otherwise validated by `inner`. */
export function optionalString<O>(inner: z.ZodType<O, string>) {
  return z.string().trim().nullish().transform(blankToUndefined).pipe(inner.optional()).optional();
}

/** Optional non-string value: `null` or absent → absent; otherwise validated by `inner`. */
export function optionalValue<T extends z.ZodType>(inner: T) {
  return inner
    .nullish()
    .transform((value) => value ?? undefined)
    .optional();
}

/** Optional boolean that defaults to `false` (`null` → `false`). */
export const booleanDefaultFalse = z
  .boolean()
  .nullish()
  .transform((value) => value ?? false);

/** Same as `sourceSchema`, but `demo`/`system` are rejected (ADR-005, HTTP input only). */
export const producerSourceSchema = sourceSchema.superRefine((value, ctx) => {
  if ((RESERVED_SOURCES as readonly string[]).includes(value)) {
    ctx.addIssue({ code: 'custom', message: `Source "${value}" is reserved` });
  }
});

/** Required message (types whose message is mandatory): trimmed 1–2000. */
export const requiredMessageSchema = z
  .string({
    error: (iss) =>
      iss.input === undefined || iss.input === null ? 'Message is required.' : undefined,
  })
  .trim()
  .min(1, 'Message is required.')
  .max(LIMITS.MESSAGE_MAX, 'Message must be 2,000 characters or fewer.');

/** Returns a copy without keys whose value is `undefined` (absent fields are really absent). */
export function stripUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as T;
}

/** Removes duplicates, keeping the first occurrence order. */
export function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
