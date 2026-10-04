// Banner, EmptyState, InlineError, Notice, Skeleton (UX §11.4, §12, §7.3).
import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { COPY } from '../copy';
import { cn } from '../lib/cn';
import { Button } from './Button';

const BANNER_STYLES = {
  warning: { bg: 'bg-banner-warning', icon: TriangleAlert, iconClass: 'text-st-waiting' },
  error: { bg: 'bg-banner-error', icon: CircleX, iconClass: 'text-st-failed' },
  success: { bg: 'bg-banner-success', icon: CircleCheck, iconClass: 'text-st-completed' },
} as const;

export function Banner({
  kind,
  children,
  action,
  id,
}: {
  kind: keyof typeof BANNER_STYLES;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  const style = BANNER_STYLES[kind];
  const Icon = style.icon;
  return (
    <div
      id={id}
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-1.5 text-sm text-text-primary',
        style.bg,
      )}
    >
      <Icon
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className={cn('shrink-0', style.iconClass)}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-3">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      {Icon ? (
        <Icon aria-hidden="true" size={24} strokeWidth={1.75} className="mb-3 text-text-muted" />
      ) : null}
      <p className="text-title-sm font-semibold text-text-primary">{title}</p>
      {body ? <p className="mt-1 max-w-80 text-sm text-text-secondary">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function InlineError({
  title,
  detail,
  onRetry,
  retryPending = false,
  className,
}: {
  title: string;
  detail: string | null;
  onRetry?: () => void;
  retryPending?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex items-start gap-2 p-4', className)}>
      <CircleX
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-st-failed"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        <p className="mt-0.5 text-xs break-words text-text-secondary">
          {detail ?? COPY.errors.network}
        </p>
        {onRetry ? (
          <Button
            size="sm"
            className="mt-3"
            onClick={onRetry}
            pending={retryPending}
            disabled={retryPending}
          >
            {COPY.banners.retry}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({
  icon: Icon = Info,
  children,
}: {
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border-strong bg-raised px-2.5 py-1.5 text-xs text-text-secondary">
      <Icon aria-hidden="true" size={14} strokeWidth={1.75} className="shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('vo-skeleton block', className)} />;
}

/** N skeleton rows for lists (UX §7.3, §8.5). */
export function SkeletonRows({ count, label }: { count: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 border-b border-border-subtle px-3 py-3">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}
