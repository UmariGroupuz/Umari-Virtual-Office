// Feed row (UX §8.2): severity bar + icon, time, agent button (or System), project tag, DEMO tag,
// event label and plain-text message (REQ-090, REQ-092).
import { memo } from 'react';
import { Server } from 'lucide-react';
import type { Agent, OfficeEvent } from '@vo/shared';
import { COPY } from '../copy';
import { Avatar } from '../components/Avatar';
import { DemoTag, ProjectTag } from '../components/Tags';
import { cn } from '../lib/cn';
import { SEVERITY_VISUALS } from '../lib/statusMeta';
import { formatClock, formatFullDateTime } from '../lib/time';
import { EventLabelView } from './EventLabelView';

export const FeedRow = memo(function FeedRow({
  event,
  agent,
  projectName,
  isNew,
  onOpenAgent,
}: {
  event: OfficeEvent;
  agent: Agent | undefined;
  projectName: string | null;
  isNew: boolean;
  onOpenAgent: (agentId: string) => void;
}) {
  const severity = SEVERITY_VISUALS[event.severity];
  const SeverityIcon = severity.icon;
  const agentName = agent?.name ?? event.agentId;
  return (
    <li
      data-testid="feed-row"
      data-event-id={event.id}
      className={cn(
        'relative min-h-14 border-b border-border-subtle px-3 py-2',
        isNew && 'vo-row-new',
      )}
    >
      {severity.bar ? (
        <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-0.5', severity.bar)} />
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex w-3.5 shrink-0 justify-center', severity.text)}>
          {SeverityIcon ? (
            <>
              <SeverityIcon aria-hidden="true" size={14} strokeWidth={1.75} />
              <span className="sr-only">
                {event.severity === 'error' ? COPY.feed.errorPrefix : COPY.feed.warningPrefix}
              </span>
            </>
          ) : null}
        </span>
        <time
          dateTime={event.createdAt}
          title={formatFullDateTime(event.createdAt)}
          className="vo-tabular w-[62px] shrink-0 text-xs text-text-muted"
        >
          {formatClock(event.createdAt)}
        </time>
        {event.agentId !== null ? (
          <button
            type="button"
            onClick={() => onOpenAgent(event.agentId ?? '')}
            aria-label={COPY.feed.openAgent(agentName ?? '')}
            className="flex min-w-0 items-center gap-1.5 rounded-sm text-left hover:underline"
          >
            {agent ? (
              <Avatar code={agent.code} roomId={agent.roomId} size={18} offline={!agent.online} />
            ) : null}
            <span className="truncate text-sm font-medium text-text-primary">{agentName}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-raised text-text-secondary">
              <Server aria-hidden="true" size={11} strokeWidth={1.75} />
            </span>
            <span className="truncate text-sm font-medium text-text-primary">
              {COPY.feed.system}
            </span>
          </span>
        )}
        <span className="flex-1" />
        {projectName ? <ProjectTag name={projectName} /> : null}
        {event.source === 'demo' ? <DemoTag /> : null}
      </div>
      <p className="vo-clamp-2 mt-0.5 pl-[92px] text-sm break-words text-text-primary">
        <EventLabelView event={event} />
        {event.message ? (
          <>
            <span className="text-text-muted"> — </span>
            {event.message}
          </>
        ) : null}
      </p>
    </li>
  );
});
