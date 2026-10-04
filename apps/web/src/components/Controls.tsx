// Switch, ToggleChip and Tooltip (UX §12).
import { useId, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

export function Switch({
  checked,
  onChange,
  label,
  pending = false,
  disabled = false,
  title,
  labelClassName,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  pending?: boolean;
  disabled?: boolean;
  title?: string;
  labelClassName?: string;
}) {
  const labelId = useId();
  const off = disabled || pending;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span
        id={labelId}
        className={cn('text-sm whitespace-nowrap text-text-secondary', labelClassName)}
      >
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-busy={pending || undefined}
        disabled={off}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-[180ms] disabled:cursor-not-allowed disabled:opacity-45',
          checked
            ? 'bg-accent-strong hover:bg-accent-strong-hover'
            : 'bg-border-strong hover:bg-border-hover',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 flex size-3.5 items-center justify-center rounded-full bg-text-primary transition-[left] duration-[180ms]',
            checked ? 'left-4' : 'left-0.5',
          )}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              size={10}
              strokeWidth={2.25}
              className="animate-spin text-bg"
            />
          ) : null}
        </span>
      </button>
    </span>
  );
}

export function ToggleChip({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors duration-[120ms]',
        pressed
          ? 'border-accent bg-accent-tint text-accent-text'
          : 'border-border-subtle bg-raised text-text-secondary hover:bg-raised-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/** CSS-only tooltip shown on hover and keyboard focus after 250 ms (UX §12). */
export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
}: {
  content: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute z-50 w-max max-w-[260px] rounded-md border border-border-subtle bg-raised-hover px-2.5 py-2 text-xs font-normal whitespace-normal text-text-primary opacity-0 shadow-overlay transition-opacity duration-[120ms]',
          'group-hover/tt:visible group-hover/tt:opacity-100 group-hover/tt:delay-[250ms] group-focus-within/tt:visible group-focus-within/tt:opacity-100 group-focus-within/tt:delay-[250ms]',
          side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'start' && 'left-0',
          align === 'end' && 'right-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
