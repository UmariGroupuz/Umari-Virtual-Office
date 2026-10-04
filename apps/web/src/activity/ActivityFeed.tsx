// Live activity feed column (UX §8): header controls, filter sub-header, day dividers, live insertion with
// reading-position preservation and a "N new events" pill, cap footer, all states of §8.5.
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { LIMITS, type OfficeEvent } from '@vo/shared';
import { COPY } from '../copy';
import { Button } from '../components/Button';
import { ToggleChip } from '../components/Controls';
import { EmptyState, InlineError, SkeletonRows } from '../components/Feedback';
import { useNow } from '../hooks/useNow';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';
import { formatDayLabel, localDayKey } from '../lib/time';
import { filterFeed, projectName } from '../store/selectors';
import type { SeverityFilter } from '../store/store';
import { FeedRow } from './FeedRow';

const AT_TOP_PX = 24;

/**
 * Day divider label ("Today", "Yesterday", "Oct 1"). It owns the clock subscription so the 1 s tick re-renders
 * only these labels, never the feed list and its rows (CR-11).
 */
function DayLabel({ createdAt }: { createdAt: string }) {
  const now = useNow();
  return (
    <>
      {formatDayLabel(createdAt, now, { today: COPY.feed.today, yesterday: COPY.feed.yesterday })}
    </>
  );
}

function groupByDay(
  events: readonly OfficeEvent[],
): { key: string; first: OfficeEvent; rows: OfficeEvent[] }[] {
  const groups: { key: string; first: OfficeEvent; rows: OfficeEvent[] }[] = [];
  for (const event of events) {
    const key = localDayKey(event.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(event);
    else groups.push({ key, first: event, rows: [event] });
  }
  return groups;
}

export function ActivityFeed({
  className,
  showHeader = true,
}: {
  className?: string;
  showHeader?: boolean;
}) {
  const feed = useOffice((s) => s.feed);
  const feedStatus = useOffice((s) => s.feedStatus);
  const feedError = useOffice((s) => s.feedError);
  const baseline = useOffice((s) => s.feedBaselineSeq);
  const agents = useOffice((s) => s.agents);
  const projects = useOffice((s) => s.projects);
  const projectFilter = useOffice((s) => s.ui.projectFilter);
  const hideDemo = useOffice((s) => s.ui.hideDemo);
  const severity = useOffice((s) => s.ui.severityFilter);
  const loaded = useOffice((s) => s.loaded);
  const loadTimedOut = useOffice((s) => s.connection.loadTimedOut);
  const syncError = useOffice((s) => s.connection.syncError);
  const retryPending = useOffice((s) => s.connection.retryPending);
  const unavailable = useBackendUnavailable();
  const reducedMotion = useReducedMotion();
  const actions = useActions();

  const visible = useMemo(
    () => filterFeed(feed, { hideDemo, severity }),
    [feed, hideDemo, severity],
  );
  const groups = useMemo(() => groupByDay(visible), [visible]);
  const filterName = projectName(projects, projectFilter);

  // Reading position (UX §8.4): at top → pinned to newest; scrolled → compensate inserted height.
  const listRef = useRef<HTMLDivElement>(null);
  const atTopRef = useRef(true);
  const prevHeightRef = useRef(0);
  const [atTop, setAtTop] = useState(true);
  const [anchorSeq, setAnchorSeq] = useState(0);
  const topSeq = visible[0]?.seq ?? 0;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const delta = el.scrollHeight - prevHeightRef.current;
    if (!atTopRef.current && delta > 0 && prevHeightRef.current > 0) el.scrollTop += delta;
    prevHeightRef.current = el.scrollHeight;
  }, [visible]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop <= AT_TOP_PX;
    if (top !== atTopRef.current) {
      atTopRef.current = top;
      setAtTop(top);
      if (!top) setAnchorSeq(topSeq);
    }
  };

  const newCount = atTop ? 0 : visible.filter((e) => e.seq > anchorSeq).length;

  const scrollToTop = () => {
    listRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const initialError = !loaded && (loadTimedOut || syncError !== null) && !unavailable;
  const showSkeleton = feedStatus === 'loading' && feed.length === 0 && !initialError;

  let body;
  if (initialError || (feedStatus === 'error' && feed.length === 0)) {
    body = (
      <InlineError
        title={COPY.feed.error}
        detail={feedStatus === 'error' ? feedError : syncError}
        onRetry={feedStatus === 'error' ? actions.reloadFeed : actions.retryNow}
        retryPending={feedStatus !== 'error' && retryPending}
      />
    );
  } else if (showSkeleton) {
    body = <SkeletonRows count={6} label={COPY.feed.label} />;
  } else if (feed.length === 0) {
    body =
      filterName === null ? (
        <EmptyState title={COPY.feed.emptyAllTitle} body={COPY.feed.emptyAllBody} />
      ) : (
        <EmptyState
          title={COPY.feed.emptyProjectTitle(filterName)}
          body={COPY.feed.emptyProjectBody}
        />
      );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        title={COPY.feed.emptyFilteredTitle}
        body={COPY.feed.emptyFilteredBody}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              actions.setHideDemo(false);
              actions.setSeverityFilter('all');
            }}
          >
            {COPY.feed.resetFilters}
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul aria-label={COPY.feed.label}>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <li
              aria-hidden="true"
              className="sticky top-0 z-[1] border-b border-border-subtle bg-panel/95 px-3 py-1 text-caption font-semibold tracking-[.06em] text-text-muted uppercase backdrop-blur-sm"
            >
              <DayLabel createdAt={group.first.createdAt} />
            </li>
            {group.rows.map((event) => (
              <FeedRow
                key={event.id}
                event={event}
                agent={event.agentId ? agents[event.agentId] : undefined}
                projectName={projectName(projects, event.project)}
                isNew={event.seq > baseline}
                onOpenAgent={actions.openAgent}
              />
            ))}
          </Fragment>
        ))}
        {feed.length >= LIMITS.FEED_CAP ? (
          <li className="px-3 py-4 text-center text-xs text-text-muted">
            {COPY.feed.capped(LIMITS.FEED_CAP)}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby={showHeader ? 'vo-feed-title' : undefined}
      aria-label={showHeader ? undefined : COPY.feed.label}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel',
        unavailable && loaded && 'vo-stale',
        className,
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        {showHeader ? (
          <h2
            id="vo-feed-title"
            className="text-caption font-semibold tracking-[.06em] whitespace-nowrap text-text-secondary uppercase"
          >
            {COPY.feed.eyebrow}
          </h2>
        ) : null}
        <span className="flex-1" />
        <ToggleChip pressed={hideDemo} onChange={actions.setHideDemo}>
          {COPY.feed.hideDemo}
        </ToggleChip>
        <select
          aria-label={COPY.feed.severityLabel}
          value={severity}
          onChange={(e) => actions.setSeverityFilter(e.target.value as SeverityFilter)}
          className="vo-select h-6 max-w-[150px] rounded-md border border-border-strong text-xs text-text-primary hover:border-border-hover"
        >
          <option value="all">{COPY.feed.severity.all}</option>
          <option value="warnings">{COPY.feed.severity.warnings}</option>
          <option value="errors">{COPY.feed.severity.errors}</option>
        </select>
      </div>
      {filterName !== null ? (
        <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-xs">
          <span className="text-text-secondary">{COPY.feed.filtered(filterName)}</span>
          <button
            type="button"
            onClick={() => actions.setProjectFilter(null)}
            className="text-accent-text hover:underline"
          >
            {COPY.feed.showAll}
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {newCount > 0 ? (
          <button
            type="button"
            onClick={scrollToTop}
            className="absolute top-2 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 items-center gap-1 rounded-full bg-accent-strong px-3 text-xs font-semibold text-white shadow-overlay hover:bg-accent-strong-hover"
          >
            <ArrowUp aria-hidden="true" size={12} strokeWidth={2} />
            {COPY.feed.newEvents(newCount)}
          </button>
        ) : null}
        <div ref={listRef} onScroll={onScroll} className="vo-scroll h-full overflow-y-auto">
          {body}
        </div>
      </div>
    </section>
  );
}
