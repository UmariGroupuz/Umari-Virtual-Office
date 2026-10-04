// Log line derived from a stored event (Logs tab, UX §7.3).
import type { OfficeEvent } from '@vo/shared';
import { formatLogTime } from '../lib/time';

const LEVEL = { info: 'INFO', warning: 'WARN', error: 'ERROR' } as const;

/**
 * `22:41:07.123  INFO   agent.activity  run_command  "Running backend tests"  [simulator]`
 * Status-carrying events add the new status after the type (QA-1):
 * `22:41:07.123  INFO   agent.status.changed → working  [simulator]`.
 */
export function logLine(event: OfficeEvent): string {
  const type = event.status === null ? event.type : `${event.type} → ${event.status}`;
  const parts = [formatLogTime(event.createdAt), LEVEL[event.severity].padEnd(5), type];
  if (event.action) parts.push(event.action);
  if (event.message) parts.push(JSON.stringify(event.message));
  parts.push(`[${event.source}]`);
  return parts.join('  ');
}
