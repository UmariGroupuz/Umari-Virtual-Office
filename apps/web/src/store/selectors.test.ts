import { describe, expect, it } from 'vitest';
import { AGENT_DISPLAY_ORDER, AGENT_STATUS_LABELS, type Agent } from '@vo/shared';
import { baselineAgents, baselineTasks, makeAgent, makeEvent, makeTask } from '../testing/fixtures';
import {
  computeMetrics,
  filterFeed,
  officeSummaryParts,
  onlineCount,
  orderAgents,
  runningSince,
  selectBanner,
  selectRoster,
  selectSystemStatus,
  showsProgress,
  sortAgentTasks,
} from './selectors';

function byId(agents: Agent[]): Record<string, Agent> {
  return Object.fromEntries(agents.map((a) => [a.id, a]));
}

describe('computeMetrics (REQ-062/063) with the API-C §7.2 baseline', () => {
  it('All Projects: Online 14, Working 3, Planning 1, Waiting 1, Reviewing 1, Failed 1, Active 7, Completed 1', () => {
    expect(computeMetrics(baselineAgents(), baselineTasks(), null)).toEqual({
      online: 14,
      working: 3,
      planning: 1,
      waiting: 1,
      reviewing: 1,
      failed: 1,
      activeTasks: 7,
      completedTasks: 1,
    });
  });

  it('Sellway: agents with currentProject = sellway, tasks with project = sellway', () => {
    expect(computeMetrics(baselineAgents(), baselineTasks(), 'sellway')).toEqual({
      online: 4,
      working: 1,
      planning: 0,
      waiting: 0,
      reviewing: 0,
      failed: 0,
      activeTasks: 2,
      completedTasks: 0,
    });
  });

  it('ERP and Ishkun24 counts', () => {
    const erp = computeMetrics(baselineAgents(), baselineTasks(), 'erp');
    expect(erp).toMatchObject({ online: 3, working: 1, reviewing: 1, failed: 1, activeTasks: 2 });
    const ik = computeMetrics(baselineAgents(), baselineTasks(), 'ishkun24');
    expect(ik).toMatchObject({
      online: 3,
      planning: 1,
      waiting: 1,
      activeTasks: 2,
      completedTasks: 1,
    });
  });
});

describe('roster ordering and dimming (UX §6, REQ-062)', () => {
  it('uses the office reading order', () => {
    expect(orderAgents(byId(baselineAgents())).map((a) => a.id)).toEqual([...AGENT_DISPLAY_ORDER]);
  });

  it('with a filter: agents on P first in the same relative order, the rest dimmed', () => {
    const { entries, noneOnProject } = selectRoster(byId(baselineAgents()), 'sellway');
    expect(noneOnProject).toBe(false);
    const on = entries.filter((e) => !e.dimmed).map((e) => e.agent.id);
    expect(on).toEqual([
      '02-product-analyst',
      '04-backend-engineer',
      '05-frontend-engineer',
      '14-reviewer',
    ]);
    expect(entries.slice(0, 4).every((e) => !e.dimmed)).toBe(true);
    expect(entries.slice(4).every((e) => e.dimmed)).toBe(true);
    expect(entries).toHaveLength(15);
  });

  it('flags "No agents on <P>" when nobody works on the project', () => {
    const agents = baselineAgents().map((a) =>
      a.currentProject === 'ana-market' ? { ...a, currentProject: null } : a,
    );
    const { entries, noneOnProject } = selectRoster(byId(agents), 'ana-market');
    expect(noneOnProject).toBe(true);
    expect(entries.every((e) => e.dimmed)).toBe(true);
  });

  it('no filter: nothing dimmed', () => {
    expect(selectRoster(byId(baselineAgents()), null).entries.some((e) => e.dimmed)).toBe(false);
  });
});

describe('feed filters (UX §8.1)', () => {
  const events = [
    makeEvent({ id: 'i', severity: 'info' }),
    makeEvent({ id: 'w', severity: 'warning' }),
    makeEvent({ id: 'e', severity: 'error' }),
    makeEvent({ id: 'd', severity: 'info', source: 'demo' }),
  ];
  it('hide demo', () => {
    expect(filterFeed(events, { hideDemo: true, severity: 'all' }).map((e) => e.id)).toEqual([
      'i',
      'w',
      'e',
    ]);
  });
  it('warnings and errors / errors only', () => {
    expect(filterFeed(events, { hideDemo: false, severity: 'warnings' }).map((e) => e.id)).toEqual([
      'w',
      'e',
    ]);
    expect(filterFeed(events, { hideDemo: false, severity: 'errors' }).map((e) => e.id)).toEqual([
      'e',
    ]);
  });
});

describe('system status and banners (UX §11.1, §11.2)', () => {
  it.each([
    ['checking', 'connecting', 'checking'],
    ['checking', 'connected', 'checking'],
    ['ok', 'connecting', 'checking'],
    ['ok', 'connected', 'operational'],
    ['ok', 'reconnecting', 'degraded'],
    ['ok', 'disconnected', 'degraded'],
    ['failing', 'connected', 'unavailable'],
    ['failing', 'disconnected', 'unavailable'],
  ] as const)('health %s + socket %s → %s', (health, socket, expected) => {
    expect(selectSystemStatus(health, socket)).toBe(expected);
  });

  it('banner priority: Backend unavailable > Disconnected > Reconnecting', () => {
    expect(
      selectBanner({
        health: 'failing',
        socket: 'disconnected',
        loaded: true,
        recentlyRecovered: false,
      }),
    ).toBe('unavailable');
    expect(
      selectBanner({
        health: 'failing',
        socket: 'disconnected',
        loaded: false,
        recentlyRecovered: false,
      }),
    ).toBe(null);
    expect(
      selectBanner({
        health: 'ok',
        socket: 'disconnected',
        loaded: true,
        recentlyRecovered: false,
      }),
    ).toBe('disconnected');
    expect(
      selectBanner({
        health: 'ok',
        socket: 'reconnecting',
        loaded: true,
        recentlyRecovered: false,
      }),
    ).toBe('reconnecting');
    expect(
      selectBanner({ health: 'ok', socket: 'connected', loaded: true, recentlyRecovered: true }),
    ).toBe('reconnected');
    expect(
      selectBanner({ health: 'ok', socket: 'connected', loaded: true, recentlyRecovered: false }),
    ).toBe(null);
  });
});

describe('misc selectors', () => {
  it('onlineCount is global', () => {
    expect(onlineCount(byId(baselineAgents()))).toEqual({ online: 14, total: 15 });
  });

  it('runningSince only for active statuses', () => {
    expect(runningSince(makeAgent('05-frontend-engineer'))).not.toBeNull();
    expect(runningSince(makeAgent('10-ui-ux-designer'))).toBeNull();
    expect(runningSince(makeAgent('04-backend-engineer'))).toBeNull();
  });

  it('showsProgress needs a task, progress > 0 and an active/completed status', () => {
    expect(showsProgress(makeAgent('05-frontend-engineer'))).toBe(true);
    expect(showsProgress(makeAgent('10-ui-ux-designer'))).toBe(true);
    expect(showsProgress(makeAgent('09-qa-engineer'))).toBe(false);
    expect(showsProgress(makeAgent('04-backend-engineer'))).toBe(false);
  });

  it('sortAgentTasks: active by priority, then todo, then finished newest first', () => {
    const tasks = [
      makeTask('A', { status: 'completed', completedAt: '2026-10-01T00:00:00.000Z' }),
      makeTask('B', { status: 'todo' }),
      makeTask('C', { status: 'in_progress', priority: 'low' }),
      makeTask('D', { status: 'assigned', priority: 'critical' }),
      makeTask('E', {
        status: 'cancelled',
        updatedAt: '2026-10-02T00:00:00.000Z',
        completedAt: null,
      }),
    ];
    expect(sortAgentTasks(tasks).map((t) => t.id)).toEqual(['D', 'C', 'B', 'E', 'A']);
  });

  it('office summary parts list non-idle statuses with counts', () => {
    expect(officeSummaryParts(baselineAgents(), AGENT_STATUS_LABELS)).toEqual([
      '3 working',
      '1 planning',
      '1 waiting',
      '1 reviewing',
      '1 completed',
      '1 failed',
      '1 offline',
    ]);
  });
});
