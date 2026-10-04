import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, type EventType } from '../constants/eventTypes';
import { agentMatchesProject, eventMatchesProject, taskMatchesProject } from './projectFilters';

describe('eventMatchesProject (ES §8.3, REQ-062)', () => {
  it('null filter (All Projects) matches every event', () => {
    for (const type of EVENT_TYPES) {
      expect(eventMatchesProject({ type, project: null }, null)).toBe(true);
      expect(eventMatchesProject({ type, project: 'erp' }, null)).toBe(true);
    }
  });

  it('events of the selected project match, other projects do not', () => {
    for (const type of EVENT_TYPES) {
      expect(eventMatchesProject({ type, project: 'sellway' }, 'sellway')).toBe(true);
      expect(eventMatchesProject({ type, project: 'erp' }, 'sellway')).toBe(false);
    }
  });

  it.each(EVENT_TYPES.map((type) => ({ type })))(
    'project-less $type is visible only for system.warning / system.error',
    ({ type }) => {
      const visible = type === 'system.warning' || type === 'system.error';
      expect(eventMatchesProject({ type, project: null }, 'sellway')).toBe(visible);
    },
  );

  it('a project-scoped warning of another project stays hidden', () => {
    const type: EventType = 'system.error';
    expect(eventMatchesProject({ type, project: 'erp' }, 'sellway')).toBe(false);
  });
});

describe('agentMatchesProject / taskMatchesProject', () => {
  it('null filter → true', () => {
    expect(agentMatchesProject({ currentProject: null }, null)).toBe(true);
    expect(agentMatchesProject({ currentProject: 'erp' }, null)).toBe(true);
    expect(taskMatchesProject({ project: 'erp' }, null)).toBe(true);
  });

  it('compares project ids exactly', () => {
    expect(agentMatchesProject({ currentProject: 'erp' }, 'erp')).toBe(true);
    expect(agentMatchesProject({ currentProject: 'erp' }, 'sellway')).toBe(false);
    expect(agentMatchesProject({ currentProject: null }, 'erp')).toBe(false);
    expect(taskMatchesProject({ project: 'erp' }, 'erp')).toBe(true);
    expect(taskMatchesProject({ project: 'erp' }, 'ana-market')).toBe(false);
  });
});
