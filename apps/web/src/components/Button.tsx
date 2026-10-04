// Button variants and states (UX §12): primary, secondary, ghost, icon; sm 28 / md 32; pending spinner.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-strong text-white hover:bg-accent-strong-hover active:bg-[#2c52a6] border border-transparent',
  secondary:
    'bg-raised text-text-primary border border-border-strong hover:bg-raised-hover active:bg-panel',
  ghost:
    'bg-transparent text-text-secondary border border-transparent hover:bg-raised hover:text-text-primary active:bg-panel',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconClassName?: string;
  pending?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconClassName,
    pending = false,
    className,
    children,
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7' : 'h-8',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {pending ? (
        <LoaderCircle aria-hidden="true" size={14} strokeWidth={1.75} className="animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden="true" size={14} strokeWidth={1.75} className={iconClassName} />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
}

/** 32×32 ghost icon button with an accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors duration-[120ms] hover:bg-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'size-7' : 'size-8',
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.75} />
    </button>
  );
});
