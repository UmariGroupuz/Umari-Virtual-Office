// Prepared-statement cache per connection (ADR-004: statements are prepared once and reused).
// Only fixed SQL text is ever cached — every value is bound as a parameter.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

export type PrepareCached = (sql: string) => StatementSync;

export function createStatementCache(db: DatabaseSync): PrepareCached {
  const cache = new Map<string, StatementSync>();
  return (sql) => {
    let statement = cache.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
}

/** Copies the keys of `patch` whose value is not `undefined` onto `base` (null is a real value). */
export function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export function changesOf(result: { changes: number | bigint }): number {
  return Number(result.changes);
}
