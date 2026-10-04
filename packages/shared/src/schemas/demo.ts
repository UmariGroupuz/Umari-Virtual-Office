// Demo endpoint bodies (API_CONTRACTS §3.13, §3.14).
import { z } from 'zod';
import { LIMITS } from '../constants/limits';
import { optionalValue, stripUndefined } from './fields';

/** `{ intervalMs?: int 2000–10000 }`; when absent the server uses its configured default. */
export const demoStartSchema = z
  .strictObject({
    intervalMs: optionalValue(
      z.number().int().min(LIMITS.DEMO_INTERVAL_MIN_MS).max(LIMITS.DEMO_INTERVAL_MAX_MS),
    ),
  })
  .transform((value) => stripUndefined(value));

/** Strict `{}`. */
export const demoStopSchema = z.strictObject({});

export type DemoStartBody = z.input<typeof demoStartSchema>;
export type DemoStartInput = z.output<typeof demoStartSchema>;
