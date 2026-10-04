// System status pill (UX §11.1), connection pill (UX §11.2), clock and agents-online count (UX §3).
import { RefreshCw, Users, Wifi, WifiOff, type LucideIcon } from 'lucide-react';
import { COPY } from '../copy';
import { Tooltip } from '../components/Controls';
import { useNow } from '../hooks/useNow';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { cn } from '../lib/cn';
import { useOffice } from '../lib/runtime';
import { formatClock, formatClockTitle } from '../lib/time';
import { onlineCount, type SystemStatus } from '../store/selectors';
import type { SocketStatus } from '../socket/connection';

const SYSTEM: Record<SystemStatus, { label: string; tooltip: string; dot: string; text: string }> =
  {
    checking: {
      label: COPY.system.checking,
      tooltip: COPY.system.tooltipChecking,
      dot: 'bg-st-idle',
      text: 'text-text-secondary',
    },
    operational: {
      label: COPY.system.operational,
      tooltip: COPY.system.tooltipOperational,
      dot: 'bg-st-working',
      text: 'text-text-primary',
    },
    degraded: {
      label: COPY.system.degraded,
      tooltip: COPY.system.tooltipDegraded,
      dot: 'bg-st-waiting',
      text: 'text-text-primary',
    },
    unavailable: {
      label: COPY.system.unavailable,
      tooltip: COPY.system.tooltipUnavailable,
      dot: 'bg-st-failed',
      text: 'text-text-primary',
    },
  };

export function SystemPill({
  tooltipAlign = 'start',
}: {
  tooltipAlign?: 'start' | 'center' | 'end';
}) {
  const status = useSystemStatus();
  const meta = SYSTEM[status];
  return (
    <Tooltip content={meta.tooltip} align={tooltipAlign}>
      <span
        data-testid="system-pill"
        className={cn(
          'inline-flex h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-raised px-2.5 text-xs font-medium whitespace-nowrap',
          meta.text,
        )}
      >
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', meta.dot)} />
        <span className="sr-only">{COPY.topBar.systemStatusLabel}: </span>
        {meta.label}
      </span>
    </Tooltip>
  );
}

const CONNECTION: Record<
  SocketStatus,
  { label: string; icon: LucideIcon; color: string; spin: boolean }
> = {
  connecting: {
    label: COPY.connection.connecting,
    icon: RefreshCw,
    color: 'text-st-waiting',
    spin: false,
  },
  connected: {
    label: COPY.connection.connected,
    icon: Wifi,
    color: 'text-st-working',
    spin: false,
  },
  reconnecting: {
    label: COPY.connection.reconnecting,
    icon: RefreshCw,
    color: 'text-st-waiting',
    spin: true,
  },
  disconnected: {
    label: COPY.connection.disconnected,
    icon: WifiOff,
    color: 'text-st-failed',
    spin: false,
  },
};

/** `role="status"` pill announcing "Live updates: …" (UX §11.2). On mobile it shows the worse state. */
export function ConnectionPill({ worstOfSystem = false }: { worstOfSystem?: boolean }) {
  const socket = useOffice((s) => s.connection.socket);
  const system = useSystemStatus();
  const showUnavailable = worstOfSystem && system === 'unavailable';
  const meta = CONNECTION[socket];
  const Icon = showUnavailable ? WifiOff : meta.icon;
  const label = showUnavailable ? COPY.system.unavailable : meta.label;
  const color = showUnavailable ? 'text-st-failed' : meta.color;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="connection-pill"
      className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-raised px-2.5 text-xs font-medium whitespace-nowrap text-text-primary"
    >
      <Icon
        aria-hidden="true"
        size={14}
        strokeWidth={1.75}
        className={cn(color, meta.spin && !showUnavailable && 'animate-spin-slow')}
      />
      <span className="sr-only">{COPY.connection.announce('').trimEnd()} </span>
      <span>{label}</span>
    </span>
  );
}

export function Clock() {
  const now = useNow();
  return (
    <time
      dateTime={new Date(now).toISOString()}
      title={formatClockTitle(now)}
      className="vo-tabular text-sm font-medium whitespace-nowrap text-text-primary"
    >
      {formatClock(now)}
    </time>
  );
}

/** Global count, never filtered (REQ-060). */
export function AgentsOnline({ compact = false }: { compact?: boolean }) {
  const agents = useOffice((s) => s.agents);
  const loaded = useOffice((s) => s.loaded);
  const { online, total } = onlineCount(agents);
  const shownTotal = loaded ? total : 15;
  const text = loaded
    ? compact
      ? COPY.topBar.agentsOnlineCompact(online, shownTotal)
      : COPY.topBar.agentsOnline(online, shownTotal)
    : compact
      ? '—/15'
      : '—/15 online';
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-text-secondary">
      <Users aria-hidden="true" size={16} strokeWidth={1.75} />
      <span aria-hidden="true" className="vo-tabular">
        {text}
      </span>
      <span className="sr-only">
        {loaded ? COPY.topBar.agentsOnlineLabel(online, shownTotal) : text}
      </span>
    </span>
  );
}
