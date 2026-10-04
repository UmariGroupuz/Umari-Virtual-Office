import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficeCanvasProps } from '../office/OfficeCanvas';
import { ApiError } from '../api/client';
import { createRuntime, initialUi } from '../lib/runtime';
import { readUrlState } from '../lib/url';
import { createFakeApi, FakeSocket } from '../testing/fakes';
import { makeEvent, makeSnapshot } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

vi.mock('../office/OfficeCanvas', () => ({
  default: (props: OfficeCanvasProps) => (
    <div
      data-testid="office-canvas"
      data-agents={props.agents.length}
      data-filter={props.projectFilter ?? ''}
      data-selected={props.selectedAgentId ?? ''}
      data-paused={String(props.paused)}
    >
      <button type="button" onClick={() => props.onAgentSelect('05-frontend-engineer')}>
        desk FE
      </button>
      <button type="button" onClick={() => props.onBackgroundClick()}>
        floor
      </button>
    </div>
  ),
}));

afterEach(() => {
  stopRuntimes();
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

const unreachable = () => Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Network error'));

describe('top bar pills (UX §3, §11.1, §11.2)', () => {
  it('starts with Checking… / Connecting… and the product name', async () => {
    await renderApp({ connect: false, api: { getHealth: () => new Promise(() => undefined) } });
    expect(screen.getByText('AI Virtual Office')).toBeInTheDocument();
    expect(screen.getByTestId('system-pill')).toHaveTextContent('Checking…');
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Connecting…');
    expect(screen.getByTestId('connection-pill')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('connection-pill')).toHaveAttribute('aria-live', 'polite');
  });

  it('Operational when health OK and socket connected; Degraded + banner when the socket drops', async () => {
    const { socket } = await renderApp();
    expect(screen.getByTestId('system-pill')).toHaveTextContent('Operational');
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Live updates: Connected');

    act(() => socket.serverDrop());
    expect(screen.getByTestId('system-pill')).toHaveTextContent('Degraded');
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Reconnecting');
    expect(
      screen.getByText('Live updates paused — reconnecting to the server…'),
    ).toBeInTheDocument();
  });

  it('Backend unavailable after load: pill, banner with Retry, stale content, pause flag on the office', async () => {
    let healthy = true;
    const { runtime } = await renderApp({
      api: {
        getHealth: () =>
          healthy
            ? Promise.resolve({ status: 'ok', db: 'ok', uptimeSec: 1, version: '0.1.0', time: '' })
            : unreachable(),
      },
    });
    healthy = false;
    await act(async () => {
      await runtime.health.checkNow();
    });
    expect(screen.getByTestId('system-pill')).toHaveTextContent('Backend unavailable');
    const banner = screen.getByRole('alert', { name: '' });
    expect(banner).toHaveTextContent(
      /^Backend unavailable — showing last known data from \d\d:\d\d:\d\d\. Actions are paused\./,
    );
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Retrying automatically every 5 s')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toBeDisabled();
    expect(await screen.findByTestId('office-canvas')).toHaveAttribute('data-paused', 'true');
  });

  it('no data yet + backend down → state card with Retry and countdown; top bar stays live', async () => {
    await renderApp({ api: { getHealth: unreachable, getSnapshot: unreachable } });
    expect(
      screen.getByRole('heading', { name: "Can't reach the AI Virtual Office server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The backend isn't responding. Make sure it is running (npm run dev), then try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText(/^Retrying automatically in \d s$/)).toBeInTheDocument();
    expect(screen.getByTestId('system-pill')).toHaveTextContent('Backend unavailable');
  });

  it('Disconnected after 30 s shows the Reconnect banner action', async () => {
    vi.useFakeTimers();
    const { socket } = await renderApp();
    act(() => socket.serverDrop());
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Disconnected');
    expect(
      screen.getByText('Disconnected from live updates. The data on screen may be out of date.'),
    ).toBeInTheDocument();
    const reconnect = screen.getByRole('button', { name: 'Reconnect' });
    act(() => reconnect.click());
    expect(socket.disconnectCalls).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Reconnecting…' })).toBeDisabled();
  });

  it('agents online is global: 14/15 even with a project filter', async () => {
    await renderApp({ ui: { projectFilter: 'sellway' } });
    expect(screen.getByText('14 of 15 agents online')).toBeInTheDocument();
  });
});

describe('metrics and project filter (REQ-061/062/063)', () => {
  const metric = (key: string) =>
    within(screen.getByTestId(`metric-${key}`)).getByRole('definition');

  it('All Projects baseline and Sellway recount; URL ?project=; Clear restores', async () => {
    const { user, api } = await renderApp({ urlSync: true });
    expect(metric('online')).toHaveTextContent('14');
    expect(metric('working')).toHaveTextContent('3');
    expect(metric('failed')).toHaveTextContent('1');
    expect(metric('activeTasks')).toHaveTextContent('7');
    expect(metric('completedTasks')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Project filter: All Projects' }));
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All Projects', 'Sellway', 'Ishkun24', 'ERP', 'Ana Market']);
    await user.click(within(listbox).getByRole('option', { name: 'Sellway' }));
    await settle();

    expect(window.location.search).toBe('?project=sellway');
    expect(metric('online')).toHaveTextContent('4');
    expect(metric('working')).toHaveTextContent('1');
    expect(metric('activeTasks')).toHaveTextContent('2');
    expect(metric('completedTasks')).toHaveTextContent('0');
    expect(api.getEvents).toHaveBeenCalledWith(
      { project: 'sellway', limit: 50 },
      expect.any(AbortSignal),
    );
    expect(screen.getByText('Filtered: Sellway')).toBeInTheDocument();
    expect(screen.getByTestId('office-canvas')).toHaveAttribute('data-filter', 'sellway');

    await user.click(screen.getByRole('button', { name: 'Clear project filter' }));
    expect(window.location.search).toBe('');
    expect(metric('online')).toHaveTextContent('14');
  });

  it('keyboard: ArrowDown opens the listbox, Enter selects', async () => {
    const { user } = await renderApp();
    screen.getByRole('button', { name: 'Project filter: All Projects' }).focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByRole('button', { name: 'Project filter: Ishkun24' })).toBeInTheDocument();
  });

  it('invalid ?project= in the URL falls back to All Projects and cleans the URL', () => {
    window.history.replaceState(null, '', '/?project=nope&agent=04-backend-engineer');
    const url = readUrlState();
    expect(url.projectFilter).toBeNull();
    const runtime = createRuntime({
      api: createFakeApi(),
      socket: new FakeSocket(),
      ui: { projectFilter: url.projectFilter, selectedAgentId: url.selectedAgentId },
      urlSync: true,
    });
    runtime.start();
    expect(window.location.search).toBe('?agent=04-backend-engineer');
    runtime.stop();
  });

  it('"Show all projects" in the feed resets the filter', async () => {
    const { user } = await renderApp({ ui: { projectFilter: 'erp' } });
    await user.click(screen.getByRole('button', { name: 'Show all projects' }));
    expect(
      screen.getByRole('button', { name: 'Project filter: All Projects' }),
    ).toBeInTheDocument();
  });
});

describe('roster (UX §6)', () => {
  it('renders 15 cards in office reading order with accessible labels', async () => {
    await renderApp();
    const roster = screen.getByRole('region', { name: 'AGENTS' });
    const cards = within(roster).getAllByRole('button');
    expect(cards).toHaveLength(15);
    expect(cards[3]).toHaveAccessibleName('Backend Engineer, Idle, project Sellway. Open details.');
    expect(cards[4]).toHaveAccessibleName(
      'Frontend Engineer, Working, project Sellway, task SW-124 Dashboard performance optimization, 40 percent. Open details.',
    );
    expect(within(roster).getByText('· 14 online')).toBeInTheDocument();
    expect(within(cards[3]!).getByText('No active task')).toBeInTheDocument();
  });

  it('dims agents off the project and shows "No agents on <P>" when nobody is on it', async () => {
    const snapshot = makeSnapshot();
    snapshot.agents = snapshot.agents.map((a) =>
      a.currentProject === 'ana-market' ? { ...a, currentProject: null } : a,
    );
    await renderApp({
      ui: { projectFilter: 'ana-market' },
      api: { getSnapshot: () => Promise.resolve(snapshot) },
    });
    expect(screen.getByText('No agents on Ana Market')).toBeInTheDocument();
    const roster = screen.getByRole('region', { name: 'AGENTS' });
    for (const card of within(roster).getAllByRole('button'))
      expect(card).toHaveClass('opacity-45');
  });

  it('shows 15 skeletons while loading, then an inline error with Retry after the load fails (API up)', async () => {
    let fail = true;
    const { user } = await renderApp({
      api: {
        getSnapshot: () =>
          fail
            ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'))
            : Promise.resolve(makeSnapshot()),
      },
    });
    expect(screen.getByText("Couldn't load agents.")).toBeInTheDocument();
    expect(screen.getAllByText('Internal server error').length).toBeGreaterThan(0);
    fail = false;
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]!);
    await settle();
    expect(
      within(screen.getByRole('region', { name: 'AGENTS' })).getAllByRole('button'),
    ).toHaveLength(15);
  });
});

describe('office card seam (API-C §10.2)', () => {
  it('passes all agents, selection and filter to OfficeCanvas and maps callbacks', async () => {
    const { user } = await renderApp();
    const canvas = await screen.findByTestId('office-canvas');
    expect(canvas).toHaveAttribute('data-agents', '15');
    await user.click(within(canvas).getByRole('button', { name: 'desk FE' }));
    expect(screen.getByRole('dialog', { name: 'Frontend Engineer' })).toBeInTheDocument();
    expect(screen.getByTestId('office-canvas')).toHaveAttribute(
      'data-selected',
      '05-frontend-engineer',
    );
    await user.click(
      within(screen.getByTestId('office-canvas')).getByRole('button', { name: 'floor' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has the role="img" summary host, legend and skip link', async () => {
    await renderApp();
    expect(screen.getAllByRole('link', { name: 'Skip to agents list' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Status legend' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /^(Virtual office floor plan|Loading office…)/ }),
    ).toBeInTheDocument();
  });

  it('desktop: the open simulator dock sits outside the office/roster scroll area (roster stays reachable)', async () => {
    const { user } = await renderApp({ width: 1568, height: 772 });
    await user.click(screen.getByRole('button', { name: 'Simulator' }));
    const scroll = screen.getByTestId('main-scroll');
    const dock = screen.getByRole('region', { name: 'Developer Simulator' });
    expect(scroll).toContainElement(screen.getByRole('region', { name: 'AGENTS' }));
    expect(scroll).not.toContainElement(dock);
    expect(screen.getByTestId('main-column')).toContainElement(dock);
    expect(dock).not.toHaveClass('sticky');
  });

  it('mobile: a remembered "simulator open" preference does not open the full-screen sheet on load', async () => {
    const ui = initialUi({ search: '', viewportWidth: 390, readStored: () => true });
    await renderApp({ width: 390, ui });
    expect(screen.queryByRole('region', { name: 'Developer Simulator' })).toBeNull();
    expect(
      screen.getByText('Office view is available on screens 768 px and wider.'),
    ).toBeInTheDocument();
  });

  it('no office canvas below 768 px (mobile simplified view)', async () => {
    await renderApp({ width: 600 });
    expect(screen.queryByTestId('office-canvas')).not.toBeInTheDocument();
    expect(
      screen.getByText('Office view is available on screens 768 px and wider.'),
    ).toBeInTheDocument();
  });
});

describe('feed in the page', () => {
  it('a live office:event appears once in the feed', async () => {
    const { socket } = await renderApp();
    act(() =>
      socket.emit('office:event', {
        event: makeEvent({ id: 'live-1', seq: 5000, message: 'Live hello' }),
        agent: null,
        task: null,
      }),
    );
    expect(screen.getAllByText('Live hello')).toHaveLength(1);
  });
});

describe('routing', () => {
  it('unknown path renders the NotFound page', async () => {
    window.history.replaceState(null, '', '/nope');
    await renderApp();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the office' })).toHaveAttribute('href', '/');
  });
});
