// Activity tab (UX §7.3, REQ-082): this agent's stored events, newest first, live prepend, "Load older".
import { COPY } from '../../copy';
import { Button } from '../../components/Button';
import { EmptyState, InlineError, SkeletonRows } from '../../components/Feedback';
import { ProjectTag } from '../../components/Tags';
import { EventLabelView } from '../../activity/EventLabelView';
import { cn } from '../../lib/cn';
import { useOffice } from '../../lib/runtime';
import { SEVERITY_VISUALS } from '../../lib/statusMeta';
import { formatClock, formatFullDateTime } from '../../lib/time';
import { projectName } from '../../store/selectors';
import type { AgentEventsView } from '../useAgentData';

export function ActivityTab({ data }: { data: AgentEventsView }) {
  const projects = useOffice((s) => s.projects);

  if (data.status === 'loading' && data.events.length === 0) {
    return <SkeletonRows count={5} label={COPY.panel.tabs.activity} />;
  }
  if (data.status === 'error' && data.events.length === 0) {
    return (
      <InlineError title={COPY.panel.activityError} detail={data.error} onRetry={data.retry} />
    );
  }
  if (data.events.length === 0) {
    return <EmptyState title={COPY.panel.activityEmptyTitle} body={COPY.panel.activityEmptyBody} />;
  }

  return (
    <div>
      <ul aria-label={COPY.panel.tabs.activity}>
        {data.events.map((event) => {
          const severity = SEVERITY_VISUALS[event.severity];
          const Icon = severity.icon;
          const project = projectName(projects, event.project);
          return (
            <li key={event.id} className="border-b border-border-subtle py-2">
              <div className="flex items-center gap-2">
                {Icon ? (
                  <span className={cn('shrink-0', severity.text)}>
                    <Icon aria-hidden="true" size={14} strokeWidth={1.75} />
                    <span className="sr-only">
                      {event.severity === 'error' ? COPY.feed.errorPrefix : COPY.feed.warningPrefix}
                    </span>
                  </span>
                ) : null}
                <time
                  dateTime={event.createdAt}
                  title={formatFullDateTime(event.createdAt)}
                  className="vo-tabular shrink-0 text-xs text-text-muted"
                >
                  {formatClock(event.createdAt)}
                </time>
                <span className="min-w-0 truncate">
                  <EventLabelView event={event} />
                </span>
                <span className="flex-1" />
                {project ? <ProjectTag name={project} /> : null}
              </div>
              {event.message ? (
                <p className="vo-clamp-2 mt-0.5 text-sm break-words text-text-primary">
                  {event.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col items-center gap-2 py-3">
        {data.hasOlder ? (
          <Button
            size="sm"
            onClick={data.loadOlder}
            disabled={data.olderStatus === 'loading'}
            pending={data.olderStatus === 'loading'}
          >
            {data.olderStatus === 'loading' ? COPY.panel.loadingOlder : COPY.panel.loadOlder}
          </Button>
        ) : data.status === 'ready' ? (
          <p className="text-xs text-text-muted">{COPY.panel.beginning}</p>
        ) : null}
        {data.olderStatus === 'error' ? (
          <p role="alert" className="text-xs text-st-failed">
            {COPY.panel.activityError} {data.olderError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
