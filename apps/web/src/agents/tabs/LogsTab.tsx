// Logs tab (UX §7.3, REQ-082 v1.2): log lines derived from the agent's real stored events — never reads files
// or process output. Persistent notice explains the derivation.
import { Info } from 'lucide-react';
import { COPY } from '../../copy';
import { EmptyState, InlineError, Notice, SkeletonRows } from '../../components/Feedback';
import { cn } from '../../lib/cn';
import { logLine } from '../logLine';
import type { AgentEventsView } from '../useAgentData';

const LEVEL_CLASS = {
  info: 'text-text-muted',
  warning: 'text-st-waiting',
  error: 'text-st-failed',
} as const;

export function LogsTab({ data }: { data: AgentEventsView }) {
  let body;
  if (data.status === 'loading' && data.events.length === 0) {
    body = <SkeletonRows count={5} label={COPY.panel.tabs.logs} />;
  } else if (data.status === 'error' && data.events.length === 0) {
    body = (
      <InlineError title={COPY.panel.activityError} detail={data.error} onRetry={data.retry} />
    );
  } else if (data.events.length === 0) {
    body = <EmptyState title={COPY.panel.logsEmptyTitle} body={COPY.panel.logsEmptyBody} />;
  } else {
    body = (
      <ol aria-label={COPY.panel.tabs.logs} className="mt-2 font-mono text-xs leading-[18px]">
        {data.events.map((event) => (
          <li
            key={event.id}
            className={cn('break-words whitespace-pre-wrap', LEVEL_CLASS[event.severity])}
          >
            {logLine(event)}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Notice icon={Info}>{COPY.panel.logsNotice}</Notice>
      {body}
    </div>
  );
}
