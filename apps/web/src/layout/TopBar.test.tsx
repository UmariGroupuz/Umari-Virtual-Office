import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { DEMO_OFF } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

vi.mock('../office/OfficeCanvas', () => ({
  default: () => <div data-testid="office-canvas" />,
}));

afterEach(() => {
  stopRuntimes();
  vi.useRealTimers();
});

const RUNNING = { active: true, intervalMs: 3000, startedAt: '2026-10-03T22:00:00.000Z' };

describe('demo mode (UX §10, REQ-110)', () => {
  it('off by default; start calls the API, shows "Starting…" while pending, then the DEMO badge', async () => {
    let resolve!: (state: typeof RUNNING) => void;
    const { user, api } = await renderApp({
      api: { startDemo: () => new Promise((r) => (resolve = r)) },
    });
    const sw = screen.getByRole('switch', { name: 'Demo mode' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('img', { name: 'Demo mode is running' })).toBeNull();

    await user.click(sw);
    expect(api.startDemo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch', { name: 'Starting…' })).toBeDisabled();

    await act(async () => {
      resolve(RUNNING);
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('img', { name: 'Demo mode is running' })).toBeInTheDocument();
  });

  it('reflects demo:state broadcasts (every tab agrees)', async () => {
    const { socket } = await renderApp();
    act(() => socket.emit('demo:state', RUNNING));
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    act(() => socket.emit('demo:state', DEMO_OFF));
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByRole('img', { name: 'Demo mode is running' })).toBeNull();
  });

  it('stop → toast with restore counts', async () => {
    const { user, socket, api } = await renderApp({
      api: {
        stopDemo: () =>
          Promise.resolve({
            demo: DEMO_OFF,
            restored: {
              agentsRestored: 9,
              agentsKept: 1,
              tasksRestored: 6,
              tasksKept: 0,
              tasksDeleted: 4,
            },
          }),
      },
    });
    act(() => socket.emit('demo:state', RUNNING));
    await user.click(screen.getByRole('switch', { name: 'Demo mode' }));
    await settle();
    expect(api.stopDemo).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Demo mode stopped. Demo changes were rolled back. · 9 agents and 6 tasks restored',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('start failure → error toast with the server message; switch returns to the server state', async () => {
    const { user } = await renderApp({
      api: {
        startDemo: () =>
          Promise.reject(
            new ApiError(400, 'VALIDATION_ERROR', 'Validation failed: intervalMs: Too small'),
          ),
      },
    });
    await user.click(screen.getByRole('switch', { name: 'Demo mode' }));
    await settle();
    const region = screen.getByLabelText('Notifications');
    expect(
      within(region).getByText(
        "Couldn't start demo mode. Validation failed: intervalMs: Too small",
      ),
    ).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Demo mode' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('demo-tagged rows', async () => {
    const { socket } = await renderApp();
    act(() =>
      socket.emit('office:event', {
        event: {
          id: 'demo-1',
          seq: 1,
          type: 'agent.activity',
          source: 'demo',
          agentId: '04-backend-engineer',
          project: 'sellway',
          taskId: null,
          status: null,
          action: 'build',
          message: 'Demo build',
          severity: 'info',
          progress: null,
          metadata: {},
          occurredAt: null,
          createdAt: new Date().toISOString(),
          forced: false,
        },
        agent: null,
        task: null,
      }),
    );
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
});

describe('top bar layout per breakpoint (UX §2.6, §3)', () => {
  it('desktop: all 10 elements in one row', async () => {
    await renderApp({ width: 1440 });
    const header = screen.getByRole('banner');
    expect(within(header).getByText('AI Virtual Office')).toBeInTheDocument();
    expect(within(header).getByTestId('system-pill')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /^Project filter/ })).toBeInTheDocument();
    expect(within(header).getByRole('switch', { name: 'Demo mode' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Simulator' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(header).getByText('14/15 online')).toBeInTheDocument();
    expect(within(header).getByTestId('connection-pill')).toBeInTheDocument();
    expect(within(header).getByText(/^\d\d:\d\d:\d\d$/).tagName).toBe('TIME');
  });

  it('laptop: compact labels ("Demo", icon-only simulator, 14/15)', async () => {
    await renderApp({ width: 1100 });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('switch', { name: 'Demo' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Developer Simulator' })).toBeInTheDocument();
    expect(within(header).getByText('14/15')).toBeInTheDocument();
  });

  it('mobile: ⋯ menu holds demo, simulator, agents online, system status and clock; pill shows the worse state', async () => {
    const { user } = await renderApp({
      width: 500,
      api: { getHealth: () => Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Network error')) },
    });
    const header = screen.getByRole('banner');
    expect(within(header).getByTestId('connection-pill')).toHaveTextContent('Backend unavailable');
    await user.click(within(header).getByRole('button', { name: 'More' }));
    expect(within(header).getByRole('switch', { name: 'Demo mode' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Developer Simulator' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(header).queryByRole('switch', { name: 'Demo mode' })).toBeNull();
  });

  it('clock ticks every second', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(new Date(2026, 9, 3, 22, 41, 7, 0));
    await renderApp();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('22:41:07')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(within(header).getByText('22:41:08')).toBeInTheDocument();
  });
});
