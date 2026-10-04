import type { JsonValue } from '@vo/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, T0, T1 } from '../testing';
import type { DatabaseHandle } from '../types';

describe('SettingsRepository', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase({ withReference: false });
  });
  afterEach(() => {
    handle.close();
  });

  it('get returns null for a missing key', () => {
    expect(handle.repos.settings.get('demo')).toBeNull();
  });

  it('set stores JSON values and upserts', () => {
    const demo = {
      active: true,
      intervalMs: 3000,
      startedAt: T0,
      startSeq: 57,
      snapshot: { agents: [{ id: 'a', metadata: {} }], tasks: [] },
    };
    handle.repos.settings.set('demo', demo, T0);
    expect(handle.repos.settings.get('demo')).toEqual(demo);

    handle.repos.settings.set('demo', { active: false }, T1);
    expect(handle.repos.settings.get('demo')).toEqual({ active: false });
    const row = handle.db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM settings').get();
    expect(row).toEqual({ n: 1, u: T1 });
  });

  it('round-trips JSON primitives and arrays', () => {
    const cases: [string, JsonValue][] = [
      ['s', 'text'],
      ['n', 42],
      ['b', false],
      ['nul', null],
      ['arr', [1, 'a', { b: null }]],
    ];
    for (const [key, value] of cases) {
      handle.repos.settings.set(key, value, T0);
      expect(handle.repos.settings.get(key)).toEqual(value);
    }
  });

  it('delete reports whether the key existed', () => {
    handle.repos.settings.set('demo', { active: true }, T0);
    expect(handle.repos.settings.delete('demo')).toBe(true);
    expect(handle.repos.settings.get('demo')).toBeNull();
    expect(handle.repos.settings.delete('demo')).toBe(false);
  });
});
