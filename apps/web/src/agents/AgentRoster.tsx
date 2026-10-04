// Agent roster (UX §6, REQ-062, REQ-064): office reading order, filter-first ordering with dimming,
// "No agents on <P>" note, loading skeletons and error state.
import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { COPY } from '../copy';
import { InlineError, Skeleton } from '../components/Feedback';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { ROSTER_ID } from '../layout/ids';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';
import { onlineCount, projectName, selectRoster } from '../store/selectors';
import { AgentCard } from './AgentCard';

const GRID =
  'grid gap-3 grid-cols-1 @min-[360px]:grid-cols-2 @min-[560px]:grid-cols-3 @min-[760px]:grid-cols-4 @min-[1000px]:grid-cols-5';

export function AgentRoster({
  className,
  singleColumn = false,
  showHeader = true,
}: {
  className?: string;
  singleColumn?: boolean;
  showHeader?: boolean;
}) {
  const agents = useOffice((s) => s.agents);
  const projects = useOffice((s) => s.projects);
  const projectFilter = useOffice((s) => s.ui.projectFilter);
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const loaded = useOffice((s) => s.loaded);
  const loadTimedOut = useOffice((s) => s.connection.loadTimedOut);
  const syncError = useOffice((s) => s.connection.syncError);
  const retryPending = useOffice((s) => s.connection.retryPending);
  const unavailable = useBackendUnavailable();
  const actions = useActions();

  const { entries, noneOnProject } = useMemo(
    () => selectRoster(agents, projectFilter),
    [agents, projectFilter],
  );
  const { online, total } = onlineCount(agents);
  const filterName = projectName(projects, projectFilter);
  const grid = singleColumn ? 'grid gap-3 grid-cols-1' : GRID;

  let body;
  if (!loaded && (loadTimedOut || syncError !== null) && !unavailable) {
    body = (
      <InlineError
        title={COPY.roster.loadError}
        detail={syncError}
        onRetry={actions.retryNow}
        retryPending={retryPending}
      />
    );
  } else if (!loaded) {
    body = (
      <div className={grid} aria-hidden="true">
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            className="flex h-[88px] flex-col gap-2 rounded-lg border border-border-subtle bg-panel p-3"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="ml-9 h-3 w-2/5" />
            <Skeleton className="ml-9 h-3 w-3/5" />
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <>
        {noneOnProject && filterName ? (
          <p className="mb-3 flex items-center gap-2 text-sm text-text-secondary">
            <Info aria-hidden="true" size={16} strokeWidth={1.75} />
            {COPY.roster.noAgentsOn(filterName)}
          </p>
        ) : null}
        <ul className={grid}>
          {entries.map(({ agent, dimmed }) => (
            <li key={agent.id} className="min-w-0">
              <AgentCard
                agent={agent}
                projectName={projectName(projects, agent.currentProject)}
                selected={agent.id === selectedAgentId}
                dimmed={dimmed}
                onOpen={actions.openAgent}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section
      id={ROSTER_ID}
      tabIndex={-1}
      aria-labelledby={showHeader ? 'vo-roster-title' : undefined}
      aria-label={showHeader ? undefined : COPY.roster.eyebrow}
      className={cn('@container', unavailable && loaded && 'vo-stale', className)}
    >
      {showHeader ? (
        <div className="flex h-8 items-center gap-2">
          <h2
            id="vo-roster-title"
            className="text-caption font-semibold tracking-[.06em] text-text-secondary uppercase"
          >
            {COPY.roster.eyebrow}
          </h2>
          {loaded ? (
            <>
              <span className="vo-tabular text-xs text-text-primary">{total}</span>
              <span className="vo-tabular text-xs text-text-muted">
                {COPY.roster.online(online)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {body}
    </section>
  );
}
