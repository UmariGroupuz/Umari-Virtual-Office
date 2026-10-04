import { PROJECTS } from '@vo/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDatabase, T0 } from '../testing';
import type { DatabaseHandle } from '../types';

describe('ProjectRepository', () => {
  let handle: DatabaseHandle;

  beforeEach(() => {
    handle = openTestDatabase({ withReference: false });
  });
  afterEach(() => {
    handle.close();
  });

  it('inserts projects and lists them by sort_order without internal columns', () => {
    // insert in reverse to prove ORDER BY sort_order
    for (const p of [...PROJECTS].reverse()) handle.repos.projects.insert(p, T0);

    expect(handle.repos.projects.list()).toEqual([
      { id: 'sellway', name: 'Sellway', taskPrefix: 'SW' },
      { id: 'ishkun24', name: 'Ishkun24', taskPrefix: 'IK' },
      { id: 'erp', name: 'ERP', taskPrefix: 'ERP' },
      { id: 'ana-market', name: 'Ana Market', taskPrefix: 'AM' },
    ]);
    expect(
      handle.db.prepare("SELECT created_at FROM projects WHERE id = 'erp'").get()?.['created_at'],
    ).toBe(T0);
  });

  it('getById returns the project or null', () => {
    for (const p of PROJECTS) handle.repos.projects.insert(p, T0);
    expect(handle.repos.projects.getById('erp')).toEqual({
      id: 'erp',
      name: 'ERP',
      taskPrefix: 'ERP',
    });
    expect(handle.repos.projects.getById('ERP')).toBeNull(); // ids are exact; name resolution is ADR-006's job
    expect(handle.repos.projects.getById('nope')).toBeNull();
  });

  it('enforces unique name and task prefix', () => {
    handle.repos.projects.insert({ id: 'a', name: 'A', taskPrefix: 'A', sortOrder: 1 }, T0);
    expect(() =>
      handle.repos.projects.insert({ id: 'b', name: 'A', taskPrefix: 'B', sortOrder: 2 }, T0),
    ).toThrow(/UNIQUE/);
    expect(() =>
      handle.repos.projects.insert({ id: 'c', name: 'C', taskPrefix: 'A', sortOrder: 3 }, T0),
    ).toThrow(/UNIQUE/);
  });
});
