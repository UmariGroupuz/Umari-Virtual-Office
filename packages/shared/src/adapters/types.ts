// Producer adapter contract (API_CONTRACTS §5.3, EVENT_SYSTEM §10, ADR-007).
import type { z } from 'zod';
import type { EventInputBody } from '../schemas/event';

/**
 * Maps a producer's native payload to canonical event input. Adapters are pure: no I/O, no clock, no
 * randomness, no database. Their output still goes through the normal `EventService` validation.
 */
export interface ProducerAdapter<TRaw> {
  /** Canonical `source` the adapter emits, e.g. `"claude-code"`. */
  source: string;
  /** Validates the producer's native payload. */
  schema: z.ZodType<TRaw>;
  /** Pure; every returned item passes `producerEventInputSchema`. Throws `AdapterError`. */
  toCanonical(raw: TRaw): EventInputBody[];
}

export type AdapterErrorCode = 'UNSUPPORTED_EVENT' | 'INVALID_PAYLOAD';

/** Thrown by `toCanonical` for an unsupported producer event or a payload that fails validation. */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;

  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
  }
}
