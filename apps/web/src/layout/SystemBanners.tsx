// Banners under the top bar (UX §11.2/11.3): one at a time, Backend unavailable > Disconnected > Reconnecting,
// plus the 3 s "Reconnected — data refreshed." success banner.
import { useEffect, useState } from 'react';
import { ServerOff } from 'lucide-react';
import { COPY } from '../copy';
import { Button } from '../components/Button';
import { Banner } from '../components/Feedback';
import { useNow } from '../hooks/useNow';
import { useActions, useOffice } from '../lib/runtime';
import { formatClock } from '../lib/time';
import { selectBanner } from '../store/selectors';
import { BANNER_ID } from './ids';

const RECOVERED_BANNER_MS = 3_000;

export function SystemBanners() {
  const health = useOffice((s) => s.connection.health);
  const socket = useOffice((s) => s.connection.socket);
  const loaded = useOffice((s) => s.loaded);
  const recoveredAt = useOffice((s) => s.connection.recoveredAt);
  const reconnectPending = useOffice((s) => s.connection.reconnectPending);
  const retryPending = useOffice((s) => s.connection.retryPending);
  const lastDataAt = useOffice((s) => s.lastDataAt);
  const actions = useActions();
  const [hiddenRecovery, setHiddenRecovery] = useState<number | null>(null);

  useEffect(() => {
    if (recoveredAt === null) return;
    const timer = setTimeout(() => setHiddenRecovery(recoveredAt), RECOVERED_BANNER_MS);
    return () => clearTimeout(timer);
  }, [recoveredAt]);

  const banner = selectBanner({
    health,
    socket,
    loaded,
    recentlyRecovered: recoveredAt !== null && hiddenRecovery !== recoveredAt,
  });

  switch (banner) {
    case 'unavailable':
      return (
        <Banner
          kind="error"
          id={BANNER_ID}
          action={
            <>
              <span className="text-xs text-text-muted">{COPY.banners.retryingEvery}</span>
              <Button
                size="sm"
                onClick={actions.retryNow}
                pending={retryPending}
                disabled={retryPending}
              >
                {retryPending ? COPY.banners.retryPending : COPY.banners.retry}
              </Button>
            </>
          }
        >
          {COPY.banners.unavailable(lastDataAt === null ? '—' : formatClock(lastDataAt))}
        </Banner>
      );
    case 'disconnected':
      return (
        <Banner
          kind="error"
          id={BANNER_ID}
          action={
            <Button
              size="sm"
              onClick={actions.reconnect}
              pending={reconnectPending}
              disabled={reconnectPending}
            >
              {reconnectPending ? COPY.banners.reconnectPending : COPY.banners.reconnect}
            </Button>
          }
        >
          {COPY.banners.disconnected}
        </Banner>
      );
    case 'reconnecting':
      return (
        <Banner kind="warning" id={BANNER_ID}>
          {COPY.banners.reconnecting}
        </Banner>
      );
    case 'reconnected':
      return (
        <Banner kind="success" id={BANNER_ID}>
          {COPY.banners.reconnected}
        </Banner>
      );
    default:
      return null;
  }
}

/** UX §11.3 "No data yet": centered state card with Retry and a countdown. */
export function BackendUnavailableState() {
  const next = useOffice((s) => s.connection.healthNextCheckAt);
  const retryPending = useOffice((s) => s.connection.retryPending);
  const actions = useActions();
  const now = useNow();
  const seconds = next === null ? 5 : Math.max(0, Math.ceil((next - now) / 1000));
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-[480px] flex-col items-center rounded-lg border border-border-subtle bg-panel p-8 text-center">
        <ServerOff
          aria-hidden="true"
          size={32}
          strokeWidth={1.75}
          className="mb-4 text-st-failed"
        />
        <h2 className="text-title-sm font-semibold text-text-primary">{COPY.noData.title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{COPY.noData.body}</p>
        <Button
          variant="primary"
          className="mt-5"
          onClick={actions.retryNow}
          pending={retryPending}
          disabled={retryPending}
        >
          {retryPending ? COPY.noData.retryPending : COPY.noData.retry}
        </Button>
        <p className="vo-tabular mt-3 text-xs text-text-muted">{COPY.noData.countdown(seconds)}</p>
      </div>
    </div>
  );
}
