import { afterEach, describe, expect, it } from 'vitest';
import { eventLabel, eventLabelText } from '../activity/eventLabel';
import { logLine } from '../agents/logLine';
import { COPY } from '../copy';
import { initialUi } from './runtime';
import { computeCanvasHeight, officeZoom } from '../dashboard/officeSizing';
import { sampleWorkspace } from '../mocks/sampleWorkspace';
import { makeEvent } from '../testing/fixtures';
import {
  formatAbsolute,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatRelative,
} from './time';
import { buildSearch, parseUrlState, writeUrlState } from './url';

const local = (y: number, m: number, d: number, hh: number, mm: number, ss: number) =>
  new Date(y, m - 1, d, hh, mm, ss).getTime();

describe('time formats (UX §15)', () => {
  const now = local(2026, 10, 3, 22, 41, 19);
  it('clock HH:mm:ss 24 h', () => {
    expect(formatClock(local(2026, 10, 3, 22, 41, 7))).toBe('22:41:07');
    expect(formatClock(local(2026, 10, 3, 0, 5, 9))).toBe('00:05:09');
  });
  it('relative', () => {
    expect(formatRelative(now - 5_000, now)).toBe('just now');
    expect(formatRelative(now - 12_000, now)).toBe('12s ago');
    expect(formatRelative(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatRelative(local(2026, 10, 1, 14, 5, 0), now)).toBe('Oct 1, 14:05');
  });
  it('absolute: today HH:mm:ss, else MMM D, HH:mm', () => {
    expect(formatAbsolute(local(2026, 10, 3, 22, 37, 55), now)).toBe('22:37:55');
    expect(formatAbsolute(local(2026, 10, 2, 14, 5, 0), now)).toBe('Oct 2, 14:05');
  });
  it('duration HH:MM:SS and Dd HH:MM:SS', () => {
    expect(formatDuration(192_000)).toBe('00:03:12');
    expect(formatDuration(((24 + 2) * 3600 + 4 * 60 + 12) * 1000)).toBe('1d 02:04:12');
    expect(formatDuration(-5)).toBe('00:00:00');
  });
  it('day labels', () => {
    const labels = { today: 'Today', yesterday: 'Yesterday' };
    expect(formatDayLabel(local(2026, 10, 3, 1, 0, 0), now, labels)).toBe('Today');
    expect(formatDayLabel(local(2026, 10, 2, 23, 0, 0), now, labels)).toBe('Yesterday');
    expect(formatDayLabel(local(2026, 10, 1, 9, 0, 0), now, labels)).toBe('Oct 1');
  });
});

describe('URL state (REQ-061, REQ-083)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('parses project by id or name; invalid project → All Projects', () => {
    expect(parseUrlState('?project=sellway')).toMatchObject({
      projectFilter: 'sellway',
      invalidProject: false,
    });
    expect(parseUrlState('?project=Ana%20Market')).toMatchObject({ projectFilter: 'ana-market' });
    expect(parseUrlState('?project=nope')).toMatchObject({
      projectFilter: null,
      invalidProject: true,
    });
    expect(parseUrlState('?project=All%20Projects')).toMatchObject({ projectFilter: null });
    expect(parseUrlState('?agent=99-nobody')).toMatchObject({ selectedAgentId: '99-nobody' });
    expect(parseUrlState('')).toMatchObject({ projectFilter: null, selectedAgentId: null });
  });

  it('builds the search string and keeps unrelated params', () => {
    expect(
      buildSearch('?x=1', { projectFilter: 'erp', selectedAgentId: '04-backend-engineer' }),
    ).toBe('?x=1&project=erp&agent=04-backend-engineer');
    expect(buildSearch('?project=erp', { projectFilter: null, selectedAgentId: null })).toBe('');
  });

  it('writes with replaceState (no new history entry)', () => {
    const length = window.history.length;
    writeUrlState({ projectFilter: 'sellway', selectedAgentId: null });
    expect(window.location.search).toBe('?project=sellway');
    expect(window.history.length).toBe(length);
  });
});

describe('office sizing (UX §2.2 table)', () => {
  const zoom = (mainWidth: number, innerHeight: number, simulatorOpen: boolean) => {
    const h = computeCanvasHeight({ mode: 'desktop', mainWidth, innerHeight, simulatorOpen });
    return Math.round(officeZoom(mainWidth, h) * 100) / 100;
  };
  it('matches the reference viewports (simulator closed: UX §2.2 table)', () => {
    expect(zoom(1036, 790, false)).toBe(0.86);
    expect(zoom(1476, 970, false)).toBe(1.19);
    expect(zoom(1104, 970, false)).toBe(0.97);
    expect(zoom(1002, 657, false)).toBe(0.75);
    expect(zoom(2116, 1330, false)).toBe(1.6);
  });
  it('simulator open uses the UX §2.2 values; the office fits the scroll area above the dock', () => {
    expect(zoom(1036, 790, true)).toBe(0.72);
    expect(zoom(1476, 970, true)).toBe(1.06);
    for (let innerHeight = 720; innerHeight <= 1330; innerHeight += 10) {
      for (const mainWidth of [1002, 1036, 1104, 1476, 2116]) {
        const rowH = innerHeight - 156;
        const canvas = computeCanvasHeight({
          mode: 'desktop',
          mainWidth,
          innerHeight,
          simulatorOpen: true,
        });
        const scrollArea = rowH - 12 - 200; // the dock and its gap sit below the scroll area
        // The office card (header + canvas) never exceeds the scroll area; the roster follows it (scrollable).
        expect(32 + canvas).toBeLessThanOrEqual(scrollArea);
      }
    }
  });
  it('tablet/laptop: height = width × 540/1140 (min 220)', () => {
    expect(
      computeCanvasHeight({
        mode: 'laptop',
        mainWidth: 1140,
        innerHeight: 800,
        simulatorOpen: true,
      }),
    ).toBe(540);
    expect(
      computeCanvasHeight({
        mode: 'tablet',
        mainWidth: 100,
        innerHeight: 800,
        simulatorOpen: false,
      }),
    ).toBe(220);
  });
});

describe('event labels (UX §8.3)', () => {
  it.each([
    [{ type: 'agent.activity', action: 'run_command' }, 'run_command'],
    [{ type: 'agent.task.assigned', taskId: 'SW-123' }, 'Assigned SW-123'],
    [{ type: 'agent.task.started', taskId: 'SW-123' }, 'Started SW-123'],
    [{ type: 'agent.task.completed', taskId: 'SW-123' }, 'Completed SW-123'],
    [{ type: 'agent.task.failed', taskId: 'SW-123' }, 'Failed SW-123'],
    [{ type: 'agent.task.progress', taskId: 'SW-123', progress: 40 }, 'Progress SW-123 · 40%'],
    [{ type: 'agent.message' }, 'Message'],
    [{ type: 'agent.connected' }, 'Connected'],
    [{ type: 'agent.disconnected' }, 'Disconnected'],
    [{ type: 'system.info' }, 'Info'],
    [{ type: 'system.warning' }, 'Warning'],
    [{ type: 'system.error' }, 'Error'],
    [{ type: 'task.created', taskId: 'SW-130' }, 'Task created SW-130'],
    [{ type: 'task.updated', taskId: 'SW-123' }, 'Task updated SW-123'],
    [{ type: 'future.type' }, 'future.type'],
  ])('%j → %s', (partial, text) => {
    const event = makeEvent(partial as never);
    expect(eventLabelText(event)).toBe(text);
  });

  it('status changed renders "Status →" with a status chip', () => {
    expect(eventLabel(makeEvent({ type: 'agent.status.changed', status: 'working' }))).toEqual({
      kind: 'status',
      text: 'Status →',
      status: 'working',
    });
  });
});

describe('log lines (UX §7.3)', () => {
  it('formats time, level, type, action, quoted message and source', () => {
    const line = logLine(
      makeEvent({
        createdAt: new Date(local(2026, 10, 3, 22, 41, 7) + 123).toISOString(),
        severity: 'warning',
        source: 'simulator',
      }),
    );
    expect(line).toBe(
      '22:41:07.123  WARN   agent.activity  run_command  "Running backend tests"  [simulator]',
    );
  });
});

describe('log lines include the new status (QA-1)', () => {
  it('agent and task status events show "→ <status>"', () => {
    const at = new Date(local(2026, 10, 3, 22, 41, 7) + 5).toISOString();
    expect(
      logLine(
        makeEvent({
          createdAt: at,
          type: 'agent.status.changed',
          status: 'working',
          action: null,
          message: null,
          source: 'simulator',
        }),
      ),
    ).toBe('22:41:07.005  INFO   agent.status.changed → working  [simulator]');
    expect(
      logLine(
        makeEvent({
          createdAt: at,
          type: 'task.updated',
          status: 'review',
          action: null,
          message: 'Task updated: X',
        }),
      ),
    ).toBe('22:41:07.005  INFO   task.updated → review  "Task updated: X"  [api]');
  });
});

describe('demo stop toast pluralization (QA-3)', () => {
  it('uses singular and plural forms', () => {
    expect(COPY.demo.restoredCounts(1, 0)).toBe(' · 1 agent and 0 tasks restored');
    expect(COPY.demo.restoredCounts(2, 1)).toBe(' · 2 agents and 1 task restored');
    expect(COPY.demo.restoredCounts(1_200, 3)).toBe(' · 1,200 agents and 3 tasks restored');
  });
});

describe('initial UI on load (ADR-037 §8: no auto-open simulator on mobile)', () => {
  const stored = (key: string) => key === 'vo.simulator.open' || key === 'vo.feed.hideDemo';
  it('mobile ignores the remembered "simulator open" preference', () => {
    expect(initialUi({ search: '?project=erp', viewportWidth: 390, readStored: stored })).toEqual({
      projectFilter: 'erp',
      selectedAgentId: null,
      hideDemo: true,
      simulatorOpen: false,
    });
  });
  it('tablet/desktop restore it', () => {
    expect(initialUi({ search: '', viewportWidth: 768, readStored: stored }).simulatorOpen).toBe(
      true,
    );
    expect(
      initialUi({ search: '', viewportWidth: 1440, readStored: () => false }).simulatorOpen,
    ).toBe(false);
  });
});

describe('sample workspace (REQ-082: deterministic per agent id)', () => {
  it('is stable across calls and differs between agents', () => {
    const a1 = sampleWorkspace('04-backend-engineer', 'development');
    const a2 = sampleWorkspace('04-backend-engineer', 'development');
    expect(a1).toEqual(a2);
    expect(sampleWorkspace('05-frontend-engineer', 'development')).not.toEqual(a1);
  });
  it('has 5–6 files, 3–5 commits and matching counts', () => {
    for (const id of ['01-pm-orchestrator', '04-backend-engineer', '15-product-auditor']) {
      const sample = sampleWorkspace(
        id,
        id.startsWith('04') ? 'development' : id.startsWith('01') ? 'management' : 'audit',
      );
      expect(sample.files.length).toBeGreaterThanOrEqual(5);
      expect(sample.files.length).toBeLessThanOrEqual(6);
      expect(sample.commits.length).toBeGreaterThanOrEqual(3);
      expect(sample.commits.length).toBeLessThanOrEqual(5);
      expect(sample.counts.modified + sample.counts.added + sample.counts.deleted).toBe(
        sample.files.length,
      );
      for (const commit of sample.commits) expect(commit.hash).toMatch(/^[0-9a-f]{7}$/);
    }
  });
});
