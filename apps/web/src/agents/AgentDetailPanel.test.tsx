import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { makeAgent, makeEvent, makeTask, NOW } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

vi.mock('../office/OfficeCanvas', () => ({
  default: () => <div data-testid="office-canvas" />,
}));

afterEach(() => {
  stopRuntimes();
  vi.useRealTimers();
});

function field(dialog: HTMLElement, label: string): HTMLElement {
  const dt = within(dialog).getByText(label, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return dd;
}

async function openFromRoster(user: Awaited<ReturnType<typeof renderApp>>['user'], name: string) {
  const roster = screen.getByRole('region', { name: 'AGENTS' });
  await user.click(within(roster).getByRole('button', { name: new RegExp(`^${name},`) }));
  await settle();
  return screen.getByRole('dialog', { name });
}

describe('detail panel fields (UX §7.2, REQ-081)', () => {
  it('opens from the roster with every field; nulls render as —', async () => {
    const { user } = await renderApp();
    const dialog = await openFromRoster(user, 'Backend Engineer');
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(within(dialog).getByText('Senior Backend Engineer · Development')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Idle').length).toBeGreaterThan(0);
    expect(field(dialog, 'Current project')).toHaveTextContent('Sellway');
    expect(field(dialog, 'Current task')).toHaveTextContent('—');
    expect(field(dialog, 'Task ID')).toHaveTextContent('—');
    expect(field(dialog, 'Progress')).toHaveTextContent('—');
    expect(field(dialog, 'Started at')).toHaveTextContent('—');
    expect(field(dialog, 'Running duration')).toHaveTextContent('—');
    expect(field(dialog, 'Current action')).toHaveTextContent('—');
    expect(field(dialog, 'Last activity')).toHaveTextContent(/ago · \d\d:\d\d:\d\d$/);
    expect(field(dialog, 'Last message')).toHaveTextContent('—');
    // Focus moves to the name heading.
    expect(within(dialog).getByRole('heading', { name: 'Backend Engineer' })).toHaveFocus();
  });

  it('working agent: task, progress bar, started at and a ticking running duration', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(NOW);
    await renderApp({ ui: { selectedAgentId: '05-frontend-engineer' } });
    const dialog = screen.getByRole('dialog', { name: 'Frontend Engineer' });
    expect(field(dialog, 'Current task')).toHaveTextContent('Dashboard performance optimization');
    expect(field(dialog, 'Task ID')).toHaveTextContent('SW-124');
    expect(within(field(dialog, 'Progress')).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(field(dialog, 'Progress')).toHaveTextContent('40%');
    expect(field(dialog, 'Current action')).toHaveTextContent('edit_file');
    expect(field(dialog, 'Last message')).toHaveTextContent('Optimizing dashboard queries');
    expect(field(dialog, 'Running duration')).toHaveTextContent('00:03:12');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(field(dialog, 'Running duration')).toHaveTextContent('00:03:13');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(field(dialog, 'Running duration')).toHaveTextContent('00:03:15');
  });

  it('fields update live from broadcasts while open', async () => {
    const { socket } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    act(() =>
      socket.emit('office:event', {
        event: makeEvent({ id: 'w1', seq: 3000, type: 'agent.status.changed', status: 'working' }),
        agent: makeAgent('04-backend-engineer', {
          status: 'working',
          version: 2,
          currentAction: 'run_tests',
          taskId: 'SW-123',
          currentTask: 'Lost Goods API',
          startedAt: new Date(NOW - 5_000).toISOString(),
        }),
        task: null,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(field(dialog, 'Current action')).toHaveTextContent('run_tests');
    expect(field(dialog, 'Task ID')).toHaveTextContent('SW-123');
    expect(field(dialog, 'Running duration')).toHaveTextContent(/^00:00:0\d$/);
  });
});

describe('tabs (UX §7.3, REQ-082)', () => {
  it('Activity default; arrow keys switch tabs; Tasks shows the count and rows', async () => {
    const { user } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    const tablist = within(dialog).getByRole('tablist');
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Activity', 'Tasks 1', 'Logs', 'Files', 'Git']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tablist).getByRole('tab', { name: 'Tasks 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tablist).getByRole('tab', { name: 'Tasks 1' })).toHaveFocus();
    const panel = within(dialog).getByRole('tabpanel');
    expect(within(panel).getByText('SW-123')).toBeInTheDocument();
    expect(within(panel).getByText('Lost Goods API')).toBeInTheDocument();
    expect(within(panel).getByText('Assigned')).toBeInTheDocument();
    expect(within(panel).getByText('High')).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(within(tablist).getByRole('tab', { name: 'Git' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Home}');
    expect(within(tablist).getByRole('tab', { name: 'Activity' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Tasks tab empty state and count hidden when 0', async () => {
    const { user } = await renderApp({ ui: { selectedAgentId: '13-documentation-engineer' } });
    const dialog = screen.getByRole('dialog', { name: 'Documentation Engineer' });
    await user.click(within(dialog).getByRole('tab', { name: 'Tasks' }));
    expect(within(dialog).getByText('No tasks assigned')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Tasks assigned to this agent will appear here.'),
    ).toBeInTheDocument();
  });

  it('Logs, Files and Git show their exact notices', async () => {
    const { user } = await renderApp({
      ui: { selectedAgentId: '04-backend-engineer' },
      api: {
        getEvents: () =>
          Promise.resolve({
            events: [makeEvent({ id: 'l1', seq: 10, severity: 'error', message: 'Boom' })],
            page: { limit: 50, nextBefore: null },
          }),
      },
    });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    await user.click(within(dialog).getByRole('tab', { name: 'Logs' }));
    expect(
      within(dialog).getByText(
        'Derived from stored events — live log streaming arrives in Phase 2',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/ERROR +agent\.activity +run_command +"Boom" +\[api\]$/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('tab', { name: 'Files' }));
    expect(within(dialog).getByText('Sample data — not connected (Phase 1)')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    await user.click(within(dialog).getByRole('tab', { name: 'Git' }));
    expect(within(dialog).getByText('Sample data — not connected (Phase 1)')).toBeInTheDocument();
    expect(within(dialog).getByText('Branch')).toBeInTheDocument();
    expect(within(dialog).getByText('Working tree')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /commit|push|open/i })).toBeNull();
  });
});

describe('Logs tab status lines (QA-1)', () => {
  it('two status changes are distinguishable by the new status', async () => {
    const { user } = await renderApp({
      ui: { selectedAgentId: '04-backend-engineer' },
      api: {
        getEvents: () =>
          Promise.resolve({
            events: [
              makeEvent({
                id: 's2',
                seq: 21,
                type: 'agent.status.changed',
                status: 'idle',
                action: null,
                message: null,
                source: 'simulator',
              }),
              makeEvent({
                id: 's1',
                seq: 20,
                type: 'agent.status.changed',
                status: 'working',
                action: null,
                message: null,
                source: 'simulator',
              }),
            ],
            page: { limit: 50, nextBefore: null },
          }),
      },
    });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    await user.click(within(dialog).getByRole('tab', { name: 'Logs' }));
    const lines = within(within(dialog).getByRole('list', { name: 'Logs' })).getAllByRole(
      'listitem',
    );
    expect(lines[0]).toHaveTextContent(/agent\.status\.changed → idle +\[simulator\]$/);
    expect(lines[1]).toHaveTextContent(/agent\.status\.changed → working +\[simulator\]$/);
  });
});

describe('Activity tab states', () => {
  it('empty state', async () => {
    await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(within(dialog).getByText('No activity yet')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Events from this agent will appear here in real time.'),
    ).toBeInTheDocument();
  });

  it('error with Retry, then rows, Load older and "Beginning of activity"', async () => {
    let calls = 0;
    const getEvents = vi.fn(({ before }: { before?: number }) => {
      calls += 1;
      if (calls === 1)
        return Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
      if (before === undefined) {
        return Promise.resolve({
          events: [
            makeEvent({ id: 'n2', seq: 20, message: 'Newest' }),
            makeEvent({ id: 'n1', seq: 19, message: 'Second' }),
          ],
          page: { limit: 50, nextBefore: 19 },
        });
      }
      return Promise.resolve({
        events: [makeEvent({ id: 'o1', seq: 5, message: 'Oldest' })],
        page: { limit: 50, nextBefore: null },
      });
    });
    const { user } = await renderApp({
      ui: { selectedAgentId: '04-backend-engineer' },
      api: { getEvents },
    });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(within(dialog).getByText("Couldn't load activity.")).toBeInTheDocument();
    expect(within(dialog).getByText('Internal server error')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await settle();
    expect(within(dialog).getByText('Newest')).toBeInTheDocument();
    expect(within(dialog).getByText('Second')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Load older' }));
    await settle();
    expect(getEvents).toHaveBeenLastCalledWith({
      agentId: '04-backend-engineer',
      before: 19,
      limit: 50,
    });
    expect(within(dialog).getByText('Oldest')).toBeInTheDocument();
    expect(within(dialog).getByText('Beginning of activity')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Load older' })).toBeNull();
  });

  it('live events of this agent are prepended (ignores the project filter)', async () => {
    const { socket } = await renderApp({
      ui: { selectedAgentId: '04-backend-engineer', projectFilter: 'erp' },
    });
    act(() =>
      socket.emit('office:event', {
        event: makeEvent({ id: 'live-a', seq: 7000, project: 'sellway', message: 'Live for BE' }),
        agent: null,
        task: null,
      }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(within(dialog).getByText('Live for BE')).toBeInTheDocument();
  });
});

describe('panel states, swap, close and focus (UX §7.4–7.6, REQ-080/083)', () => {
  it('Agent not found for an unknown id', async () => {
    const { user, runtime } = await renderApp({
      ui: { selectedAgentId: '99-nobody' },
      api: {
        getAgent: () =>
          Promise.reject(new ApiError(404, 'AGENT_NOT_FOUND', 'Agent not found: 99-nobody')),
      },
    });
    const dialog = screen.getByRole('dialog', { name: 'Agent not found' });
    expect(within(dialog).getByText('No agent with ID “99-nobody” exists.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runtime.store.getState().ui.selectedAgentId).toBeNull();
  });

  it('Esc closes and focus returns to the roster card; swap keeps focus and announces', async () => {
    const { user } = await renderApp();
    const roster = screen.getByRole('region', { name: 'AGENTS' });
    const beCard = within(roster).getByRole('button', { name: /^Backend Engineer,/ });
    await user.click(beCard);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Backend Engineer' })).toBeInTheDocument();

    // Swap: another agent replaces the panel content.
    const feCard = within(roster).getByRole('button', { name: /^Frontend Engineer,/ });
    await user.click(feCard);
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Frontend Engineer' });
    expect(feCard).toHaveFocus();
    expect(feCard).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByText('Showing Frontend Engineer')).toBeInTheDocument();

    within(dialog).getByRole('heading', { name: 'Frontend Engineer' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beCard).toHaveFocus();
  });

  it('X closes the panel', async () => {
    const { user } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.click(screen.getByRole('button', { name: 'Close agent details' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc closes the simulator first when focus is inside it (most recent layer wins)', async () => {
    const { user } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.click(screen.getByRole('button', { name: 'Simulator' }));
    expect(screen.getByRole('region', { name: 'Developer Simulator' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Developer Simulator' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Backend Engineer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simulator' })).toHaveFocus();
  });

  it('pointerdown on the metrics row closes the panel; on a control it does not', async () => {
    const { user } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.click(screen.getByRole('switch', { name: 'Demo mode' }));
    expect(screen.getByRole('dialog', { name: 'Backend Engineer' })).toBeInTheDocument();
    await user.click(screen.getByTestId('metric-working'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tablet: modal sheet with scrim (aria-modal=true); scrim click closes', async () => {
    const { user } = await renderApp({
      width: 900,
      ui: { selectedAgentId: '04-backend-engineer' },
    });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const scrim = dialog.previousElementSibling as HTMLElement;
    await user.click(scrim);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mobile: full-screen sheet with Back', async () => {
    const { user } = await renderApp({
      width: 500,
      ui: { selectedAgentId: '04-backend-engineer' },
    });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('task list follows live reassignment', async () => {
    const { socket, user } = await renderApp({ ui: { selectedAgentId: '04-backend-engineer' } });
    const dialog = screen.getByRole('dialog', { name: 'Backend Engineer' });
    await user.click(within(dialog).getByRole('tab', { name: 'Tasks 1' }));
    act(() =>
      socket.emit('office:event', {
        event: makeEvent({ id: 't-up', seq: 8000, type: 'task.updated', taskId: 'SW-125' }),
        agent: null,
        task: makeTask('SW-125', {
          assignedAgentId: '04-backend-engineer',
          status: 'assigned',
          version: 2,
        }),
      }),
    );
    expect(within(dialog).getByRole('tab', { name: 'Tasks 2' })).toBeInTheDocument();
    expect(within(dialog).getByText('Campaign analytics')).toBeInTheDocument();
  });
});
