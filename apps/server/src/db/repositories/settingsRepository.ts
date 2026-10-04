import type { JsonValue } from '@vo/shared';
import { readJson } from '../mappers';
import type { SettingsRepository } from '../types';
import { changesOf, type PrepareCached } from './statements';

export function createSettingsRepository(prepare: PrepareCached): SettingsRepository {
  return {
    get(key: string): JsonValue | null {
      const row = prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? readJson(row, 'value') : null;
    },

    set(key: string, value: JsonValue, now: string): void {
      const serialized = JSON.stringify(value);
      if (typeof serialized !== 'string')
        throw new TypeError(`Setting "${key}" is not JSON-serializable`);
      prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updated_at)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run({ key, value: serialized, updated_at: now });
    },

    delete(key: string): boolean {
      return changesOf(prepare('DELETE FROM settings WHERE key = ?').run(key)) > 0;
    },
  };
}
