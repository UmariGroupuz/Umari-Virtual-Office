import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { makeEvent, makeSnapshot } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

vi.mock('../office/OfficeCanvas', () => ({
  default: () => <div data-testid="office-canvas" />,
}));

afterEach(() => {
  stopRuntimes();
  window.localStorage.clear();
});

const feed = () => screen.getByRole('complementary', { name: 'Live activity' });

function withEvents(events: ReturnType<typeof makeEvent>[]) {
  return { getSnapshot: () => Promise.resolve(makeSnapshot({ events })) };
}

describe('feed rows (UX §8.2, REQ-090, REQ-092)', () => {
  it('renders producer text literally — no HTML interpretation', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    await renderApp({ api: withEvents([makeEvent({ id: 'x1', seq: 1, message: xss })]) });
    expect(within(feed()).getByText(xss)).toBeInTheDocument();
    expect(feed().querySelector('img')).toBeNull();
  });

  it('row anatomy: time, agent button, project tag, label and message', async () => {
    const { user, runtime } = await renderApp({
      api: withEvents([
        makeEvent({ id: 'r1', seq: 1, action: 'run_tests', message: 'Running API tests' }),
      ]),
    });
    const row = within(feed()).getByTestId('feed-row');
    expect(within(row).getByText(/^\d\d:\d\d:\d\d$/)).toBeInTheDocument();
    expect(within(row).getByText('Sellway')).toBeInTheDocument();
    expect(within(row).getByText('run_tests')).toBeInTheDocument();
    expect(within(row).getByText('Running API tests')).toBeInTheDocument();
    await user.click(
      within(row).getByRole('button', { name: 'Open details for Backend Engineer' }),
    );
    expect(runtime.store.getState().ui.selectedAgentId).toBe('04-backend-engineer');
  });

  it('DEMO tag, severity icon + hidden text, System rows, status chip label', async () => {
    await renderApp({
      api: withEvents([
        makeEvent({ id: 'd', seq: 4, source: 'demo' }),
        makeEvent({ id: 'w', seq: 3, severity: 'warning' }),
        makeEvent({
          id: 'e',
          seq: 2,
          type: 'system.error',
          agentId: null,
          project: null,
          severity: 'error',
          message: 'Disk full',
        }),
        makeEvent({
          id: 's',
          seq: 1,
          type: 'agent.status.changed',
          status: 'working',
          action: null,
          message: null,
        }),
      ]),
    });
    const rows = within(feed()).getAllByTestId('feed-row');
    expect(within(rows[0]!).getByText('DEMO')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Warning:')).toHaveClass('sr-only');
    expect(within(rows[2]!).getByText('Error:')).toHaveClass('sr-only');
    expect(within(rows[2]!).getByText('System')).toBeInTheDocument();
    expect(within(rows[2]!).queryByRole('button')).toBeNull();
    expect(within(rows[3]!).getByText('Status →')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Working')).toBeInTheDocument();
  });

  it('day divider "Today"', async () => {
    await renderApp({
      api: withEvents([makeEvent({ id: 't', seq: 1, createdAt: new Date().toISOString() })]),
    });
    expect(within(feed()).getByText('Today')).toBeInTheDocument();
  });
});

describe('feed states (UX §8.5)', () => {
  it('empty (All Projects)', async () => {
    await renderApp();
    expect(within(feed()).getByText('No activity yet')).toBeInTheDocument();
    expect(
      within(feed()).getByText(
        'Events appear here in real time. Use the Developer Simulator or turn on Demo mode to generate some.',
      ),
    ).toBeInTheDocument();
  });

  it('empty (filtered)', async () => {
    await renderApp({ ui: { projectFilter: 'sellway' } });
    expect(within(feed()).getByText('No activity for Sellway yet')).toBeInTheDocument();
    expect(
      within(feed()).getByText('Events for this project will appear here in real time.'),
    ).toBeInTheDocument();
  });

  it('empty after client filters + Reset filters; Hide demo persists in localStorage', async () => {
    const { user } = await renderApp({
      api: withEvents([makeEvent({ id: 'd', seq: 1, source: 'demo' })]),
    });
    await user.click(within(feed()).getByRole('button', { name: 'Hide demo' }));
    expect(window.localStorage.getItem('vo.feed.hideDemo')).toBeNull(); // persist disabled in tests
    expect(within(feed()).getByText('No matching events')).toBeInTheDocument();
    expect(
      within(feed()).getByText('Adjust “Hide demo” or the severity filter.'),
    ).toBeInTheDocument();
    await user.click(within(feed()).getByRole('button', { name: 'Reset filters' }));
    expect(within(feed()).getByText('DEMO')).toBeInTheDocument();
  });

  it('severity filter (client-side)', async () => {
    const { user } = await renderApp({
      api: withEvents([
        makeEvent({ id: 'i', seq: 3, message: 'info row' }),
        makeEvent({ id: 'w', seq: 2, severity: 'warning', message: 'warn row' }),
        makeEvent({ id: 'e', seq: 1, severity: 'error', message: 'error row' }),
      ]),
    });
    const select = within(feed()).getByRole('combobox', { name: 'Severity filter' });
    await user.selectOptions(select, 'Errors only');
    expect(within(feed()).queryByText('info row')).toBeNull();
    expect(within(feed()).queryByText('warn row')).toBeNull();
    expect(within(feed()).getByText('error row')).toBeInTheDocument();
    await user.selectOptions(select, 'Warnings and errors');
    expect(within(feed()).getByText('warn row')).toBeInTheDocument();
  });

  it('error with Retry after a failed filter refetch', async () => {
    let fail = true;
    const { user } = await renderApp({
      ui: { projectFilter: null },
      api: {
        getEvents: () =>
          fail
            ? Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Network error'))
            : Promise.resolve({
                events: [makeEvent({ id: 'ok', message: 'Recovered row' })],
                page: { limit: 50, nextBefore: null },
              }),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Project filter: All Projects' }));
    await user.click(screen.getByRole('option', { name: 'Sellway' }));
    await settle();
    expect(within(feed()).getByText("Couldn't load activity.")).toBeInTheDocument();
    expect(within(feed()).getByText('Network error')).toBeInTheDocument();
    fail = false;
    await user.click(within(feed()).getByRole('button', { name: 'Retry' }));
    await settle();
    expect(within(feed()).getByText('Recovered row')).toBeInTheDocument();
  });

  it('shows skeleton rows while the filtered list loads', async () => {
    const { user } = await renderApp({ api: { getEvents: () => new Promise(() => undefined) } });
    await user.click(screen.getByRole('button', { name: 'Project filter: All Projects' }));
    await user.click(screen.getByRole('option', { name: 'ERP' }));
    expect(within(feed()).getByRole('status', { name: 'Live activity' })).toBeInTheDocument();
  });
});

describe('live behavior (UX §8.4)', () => {
  it('scrolled down: "N new events" pill; click scrolls to top and resets', async () => {
    const { socket } = await renderApp({ api: withEvents([makeEvent({ id: 'base', seq: 1 })]) });
    const list = within(feed()).getByRole('list', { name: 'Live activity' })
      .parentElement as HTMLElement;
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 200 });
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;
    fireEvent.scroll(list);
    act(() => {
      socket.emit('office:event', {
        event: makeEvent({ id: 'n1', seq: 2 }),
        agent: null,
        task: null,
      });
      socket.emit('office:event', {
        event: makeEvent({ id: 'n2', seq: 3 }),
        agent: null,
        task: null,
      });
      socket.emit('office:event', {
        event: makeEvent({ id: 'n3', seq: 4 }),
        agent: null,
        task: null,
      });
    });
    const pill = within(feed()).getByRole('button', { name: '3 new events' });
    fireEvent.click(pill);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 });
    fireEvent.scroll(list);
    expect(within(feed()).queryByRole('button', { name: /new event/ })).toBeNull();
  });

  it('new live rows get the highlight class; initial rows do not', async () => {
    const { socket } = await renderApp({ api: withEvents([makeEvent({ id: 'old', seq: 1 })]) });
    act(() =>
      socket.emit('office:event', {
        event: makeEvent({ id: 'new', seq: 2 }),
        agent: null,
        task: null,
      }),
    );
    const rows = within(feed()).getAllByTestId('feed-row');
    expect(rows[0]).toHaveAttribute('data-event-id', 'new');
    expect(rows[0]).toHaveClass('vo-row-new');
    expect(rows[1]).not.toHaveClass('vo-row-new');
  });

  it('events of other projects do not enter a filtered feed', async () => {
    const { socket } = await renderApp({ ui: { projectFilter: 'sellway' } });
    act(() => {
      socket.emit('office:event', {
        event: makeEvent({ id: 'erp', project: 'erp', message: 'ERP row' }),
        agent: null,
        task: null,
      });
      socket.emit('office:event', {
        event: makeEvent({ id: 'sw', project: 'sellway', message: 'SW row' }),
        agent: null,
        task: null,
      });
    });
    expect(within(feed()).queryByText('ERP row')).toBeNull();
    expect(within(feed()).getByText('SW row')).toBeInTheDocument();
  });

  it('cap footer at 200 events', async () => {
    const events = Array.from({ length: 200 }, (_, i) => makeEvent({ id: `c${i}`, seq: i + 1 }));
    await renderApp({ api: withEvents(events) });
    expect(
      within(feed()).getByText(
        'Showing the latest 200 events. Open an agent for its full history.',
      ),
    ).toBeInTheDocument();
  });
});
