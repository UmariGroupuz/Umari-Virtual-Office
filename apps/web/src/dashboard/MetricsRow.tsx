// Metrics row (UX §4, REQ-063): 8 non-interactive cards in one <dl>; filter-aware counts.
import { useMemo } from 'react';
import {
  Activity,
  CircleCheck,
  CircleEllipsis,
  CirclePause,
  ListTodo,
  Search,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { COPY } from '../copy';
import { Skeleton } from '../components/Feedback';
import { useChangeFlash } from '../hooks/useChangeFlash';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { BANNER_ID } from '../layout/ids';
import { cn } from '../lib/cn';
import { useOffice } from '../lib/runtime';
import { computeMetrics, type Metrics } from '../store/selectors';

interface CardSpec {
  key: keyof Metrics;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  iconClass: string;
}

const CARDS: readonly CardSpec[] = [
  {
    key: 'online',
    label: COPY.metrics.agentsOnline,
    shortLabel: COPY.metrics.short.agentsOnline,
    icon: Users,
    iconClass: 'text-text-secondary',
  },
  { key: 'working', label: COPY.metrics.working, icon: Activity, iconClass: 'text-st-working' },
  {
    key: 'planning',
    label: COPY.metrics.planning,
    icon: CircleEllipsis,
    iconClass: 'text-st-planning',
  },
  { key: 'waiting', label: COPY.metrics.waiting, icon: CirclePause, iconClass: 'text-st-waiting' },
  {
    key: 'reviewing',
    label: COPY.metrics.reviewing,
    shortLabel: COPY.metrics.short.reviewing,
    icon: Search,
    iconClass: 'text-st-reviewing',
  },
  { key: 'failed', label: COPY.metrics.failed, icon: TriangleAlert, iconClass: 'text-st-failed' },
  {
    key: 'activeTasks',
    label: COPY.metrics.activeTasks,
    shortLabel: COPY.metrics.short.activeTasks,
    icon: ListTodo,
    iconClass: 'text-text-secondary',
  },
  {
    key: 'completedTasks',
    label: COPY.metrics.completedTasks,
    shortLabel: COPY.metrics.short.completedTasks,
    icon: CircleCheck,
    iconClass: 'text-st-completed',
  },
];

function MetricCard({
  spec,
  value,
  loading,
  stale,
  compact,
}: {
  spec: CardSpec;
  value: number;
  loading: boolean;
  stale: boolean;
  compact: boolean;
}) {
  const flash = useChangeFlash(loading ? null : value);
  const Icon = spec.icon;
  const label = compact && spec.shortLabel ? spec.shortLabel : spec.label;
  return (
    <div
      data-testid={`metric-${spec.key}`}
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-lg border border-border-subtle bg-panel',
        compact ? 'h-14 px-2.5 py-1.5' : 'h-16 px-3.5 py-2.5',
        flash > 0 && (flash % 2 === 1 ? 'vo-flash-border' : 'vo-flash-border-alt'),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <dt
          className={cn(
            'min-w-0 truncate font-medium text-text-secondary',
            compact ? 'text-caption' : 'text-xs',
          )}
        >
          {label}
        </dt>
        <Icon
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className={cn('shrink-0', spec.iconClass)}
        />
      </div>
      <dd
        className={cn(
          'vo-tabular leading-7 font-semibold',
          compact ? 'text-[20px]' : 'text-metric',
          stale
            ? 'text-text-muted'
            : spec.key === 'failed' && value > 0
              ? 'text-st-failed'
              : 'text-text-primary',
        )}
      >
        {loading ? <Skeleton className="mt-1 h-[22px] w-10" /> : value}
      </dd>
    </div>
  );
}

export function MetricsRow({ columns, compact = false }: { columns: 4 | 8; compact?: boolean }) {
  const agents = useOffice((s) => s.agents);
  const tasks = useOffice((s) => s.tasks);
  const projectFilter = useOffice((s) => s.ui.projectFilter);
  const loaded = useOffice((s) => s.loaded);
  const stale = useBackendUnavailable() && loaded;
  const metrics = useMemo(
    () => computeMetrics(Object.values(agents), Object.values(tasks), projectFilter),
    [agents, tasks, projectFilter],
  );
  return (
    <dl
      aria-label={COPY.metrics.label}
      aria-describedby={stale ? BANNER_ID : undefined}
      data-dismiss-panel=""
      className={cn(
        'grid gap-3',
        columns === 8 ? 'grid-cols-8' : 'grid-cols-4',
        compact && 'gap-2',
        stale && 'vo-stale',
      )}
    >
      {CARDS.map((spec) => (
        <MetricCard
          key={spec.key}
          spec={spec}
          value={metrics[spec.key]}
          loading={!loaded}
          stale={stale}
          compact={compact}
        />
      ))}
    </dl>
  );
}
