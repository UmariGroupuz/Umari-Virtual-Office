// CR-11: the 1 s clock tick re-renders only the day-divider labels, not the feed component and its list.
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEvent, makeSnapshot, NOW } from '../testing/fixtures';
import { renderApp, stopRuntimes } from '../testing/renderApp';

const counter = vi.hoisted(() => ({ feedRenders: 0 }));

vi.mock('../office/OfficeCanvas', () => ({ default: () => <div /> }));

// ToggleChip ("Hide demo") is used only in the feed header and is not memoized: every ActivityFeed render
// renders it once, so its render count is the feed's render count.
vi.mock('../components/Controls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/Controls')>();
  const Inner = actual.ToggleChip;
  return {
    ...actual,
    ToggleChip: (props: Parameters<typeof Inner>[0]) => {
      counter.feedRenders += 1;
      return <Inner {...props} />;
    },
  };
});

afterEach(() => {
  stopRuntimes();
  vi.useRealTimers();
});

describe('feed render cost (CR-11)', () => {
  it('clock ticks do not re-render the feed; day labels stay correct', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    vi.setSystemTime(NOW);
    const events = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ id: `r${i}`, seq: i + 1, createdAt: new Date(NOW - i * 1000).toISOString() }),
    );
    await renderApp({ api: { getSnapshot: () => Promise.resolve(makeSnapshot({ events })) } });
    const feed = screen.getByRole('complementary', { name: 'Live activity' });
    expect(within(feed).getAllByTestId('feed-row')).toHaveLength(30);
    const before = counter.feedRenders;
    expect(before).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(counter.feedRenders).toBe(before);
    expect(within(feed).getByText('Today')).toBeInTheDocument();
  });
});
