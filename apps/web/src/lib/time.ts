// The one formatting module for times and durations (UX §15, NFR-011). Local time zone, 24 h.
// Times use en-GB with hourCycle h23; month names use en-US ("Oct 2").

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const hourMinuteFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const monthDayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const longDateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** `HH:mm:ss` 24 h local (clock, feed rows, list times). */
export function formatClock(value: string | number | Date): string {
  const date = toDate(value);
  return isValid(date) ? timeFormat.format(date) : '—';
}

/** `HH:mm:ss.SSS` local (log lines). */
export function formatLogTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!isValid(date)) return '—';
  return `${timeFormat.format(date)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/** Panel absolute time: today `HH:mm:ss`, otherwise `MMM D, HH:mm` ("Oct 2, 14:05"). */
export function formatAbsolute(value: string | number | Date, now: number): string {
  const date = toDate(value);
  if (!isValid(date)) return '—';
  if (sameLocalDay(date, new Date(now))) return timeFormat.format(date);
  return `${monthDayFormat.format(date)}, ${hourMinuteFormat.format(date)}`;
}

/** "just now" (< 10 s), "12s ago", "3m ago", "2h ago", else absolute. */
export function formatRelative(value: string | number | Date, now: number): string {
  const date = toDate(value);
  if (!isValid(date)) return '—';
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatAbsolute(date, now);
}

/** `HH:MM:SS`; at ≥ 24 h `Dd HH:MM:SS` ("1d 02:04:12"). Negative durations clamp to 0. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const hms = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${hms}` : hms;
}

/** Feed day divider: "Today", "Yesterday" or "Oct 1". */
export function formatDayLabel(
  value: string | number | Date,
  now: number,
  labels: { today: string; yesterday: string },
): string {
  const date = toDate(value);
  if (!isValid(date)) return '—';
  const today = new Date(now);
  if (sameLocalDay(date, today)) return labels.today;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return labels.yesterday;
  return monthDayFormat.format(date);
}

/** Stable key of the local calendar day (for grouping rows under dividers). */
export function localDayKey(value: string | number | Date): string {
  const date = toDate(value);
  if (!isValid(date)) return 'invalid';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Full local date-time for `title` attributes: "Saturday, 3 October 2026, 22:41:07". */
export function formatFullDateTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!isValid(date)) return '';
  return `${longDateFormat.format(date)}, ${timeFormat.format(date)}`;
}

/** Clock `title`: "Saturday, 3 October 2026 · Asia/Tashkent". */
export function formatClockTitle(now: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${longDateFormat.format(new Date(now))} · ${zone}`;
}
