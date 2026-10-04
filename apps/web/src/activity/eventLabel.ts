// Event label mapping (UX §8.3). Pure; the status-changed label renders a status chip after "Status →".
import type { AgentStatus, OfficeEvent } from '@vo/shared';
import { AGENT_STATUSES } from '@vo/shared';
import { COPY } from '../copy';

export type EventLabel =
  | { kind: 'text'; text: string; mono: boolean }
  | { kind: 'status'; text: string; status: AgentStatus | null };

function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (AGENT_STATUSES as readonly string[]).includes(value);
}

export function eventLabel(
  event: Pick<OfficeEvent, 'type' | 'action' | 'taskId' | 'status' | 'progress'>,
): EventLabel {
  const L = COPY.eventLabels;
  const task = event.taskId ?? '—';
  switch (event.type) {
    case 'agent.activity':
      return { kind: 'text', text: event.action ?? event.type, mono: true };
    case 'agent.status.changed':
      return {
        kind: 'status',
        text: L.statusChanged,
        status: isAgentStatus(event.status) ? event.status : null,
      };
    case 'agent.task.assigned':
      return { kind: 'text', text: L.assigned(task), mono: true };
    case 'agent.task.started':
      return { kind: 'text', text: L.started(task), mono: true };
    case 'agent.task.completed':
      return { kind: 'text', text: L.completed(task), mono: true };
    case 'agent.task.failed':
      return { kind: 'text', text: L.failed(task), mono: true };
    case 'agent.task.progress':
      return { kind: 'text', text: L.progress(task, event.progress), mono: true };
    case 'agent.message':
      return { kind: 'text', text: L.message, mono: true };
    case 'agent.connected':
      return { kind: 'text', text: L.connected, mono: true };
    case 'agent.disconnected':
      return { kind: 'text', text: L.disconnected, mono: true };
    case 'system.info':
      return { kind: 'text', text: L.info, mono: true };
    case 'system.warning':
      return { kind: 'text', text: L.warning, mono: true };
    case 'system.error':
      return { kind: 'text', text: L.error, mono: true };
    case 'task.created':
      return { kind: 'text', text: L.taskCreated(task), mono: true };
    case 'task.updated':
      return { kind: 'text', text: L.taskUpdated(task), mono: true };
    default:
      // Unknown future type: the raw type string.
      return { kind: 'text', text: String((event as { type: string }).type), mono: true };
  }
}

/** Plain-text label (logs, accessible names). */
export function eventLabelText(event: Parameters<typeof eventLabel>[0]): string {
  const label = eventLabel(event);
  if (label.kind === 'status' && label.status) return `${label.text} ${label.status}`;
  return label.text;
}
