// ProgressBar (UX §12): h 3 / 6, track border-subtle, status-colored fill, role=progressbar.
import { cn } from '../lib/cn';

export function ProgressBar({
  value,
  fillClassName,
  height = 3,
  label,
  className,
}: {
  value: number;
  fillClassName: string;
  height?: 3 | 6;
  label: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn(
        'w-full overflow-hidden rounded-sm bg-border-subtle',
        height === 3 ? 'h-[3px]' : 'h-1.5',
        className,
      )}
    >
      <div
        className={cn('h-full rounded-sm transition-[width] duration-[240ms]', fillClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
