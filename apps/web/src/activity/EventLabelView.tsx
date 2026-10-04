import type { OfficeEvent } from '@vo/shared';
import { StatusChip } from '../components/StatusChip';
import { eventLabel } from './eventLabel';

/** Line-2 label of a feed/activity row (UX §8.3). */
export function EventLabelView({ event }: { event: OfficeEvent }) {
  const label = eventLabel(event);
  if (label.kind === 'status') {
    return (
      <span className="inline-flex items-center gap-1 align-middle font-mono text-xs text-text-secondary">
        {label.text}
        {label.status ? <StatusChip status={label.status} /> : null}
      </span>
    );
  }
  return <span className="font-mono text-xs text-text-secondary">{label.text}</span>;
}
