// CR-5: error boundaries around the office card and the app root.
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@vo/shared';
import { makeSnapshot } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

const control = vi.hoisted(() => ({ fail: true }));

vi.mock('../office/OfficeCanvas', () => ({
  default: () => {
    if (control.fail) throw new Error('Phaser.Game constructor failed');
    return <div data-testid="office-canvas" />;
  },
}));

beforeEach(() => {
  control.fail = true;
  // React reports caught render errors on console.error; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  stopRuntimes();
  vi.restoreAllMocks();
});

describe('office error boundary (CR-5)', () => {
  it('a throwing office module shows a visible error with Retry; the rest of the dashboard keeps working', async () => {
    const { user } = await renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Office view could not be loaded.');
    // The dashboard is not blank: roster and feed still render.
    expect(
      within(screen.getByRole('region', { name: 'AGENTS' })).getAllByRole('button'),
    ).toHaveLength(15);
    expect(screen.getByRole('complementary', { name: 'Live activity' })).toBeInTheDocument();

    control.fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(await screen.findByTestId('office-canvas')).toBeInTheDocument();
    expect(screen.queryByText('Office view could not be loaded.')).toBeNull();
  });
});

describe('app error boundary (CR-5)', () => {
  it('an unexpected render error outside the office shows the app fallback with Retry and Reload', async () => {
    control.fail = false;
    const snapshot = makeSnapshot();
    // Corrupt data that makes the roster throw while rendering (unknown room → no department visuals).
    snapshot.agents = snapshot.agents.map((a, i) =>
      i === 0 ? ({ ...a, roomId: 'nowhere' } as unknown as Agent) : a,
    );
    await renderApp({ api: { getSnapshot: () => Promise.resolve(snapshot) } });
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });
});
