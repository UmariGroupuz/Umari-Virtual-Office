// Toasts (UX §11.5): bottom-right, max 3, width 320; info/success 4 s, errors 8 s with Dismiss.
import { useEffect } from 'react';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';
import { COPY } from '../copy';
import { cn } from '../lib/cn';
import { useOffice, useRuntime } from '../lib/runtime';
import type { Toast } from '../store/store';

const DURATION = { info: 4_000, success: 4_000, error: 8_000 } as const;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DURATION[toast.kind]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, onDismiss]);
  const Icon = toast.kind === 'error' ? CircleX : toast.kind === 'success' ? CircleCheck : Info;
  return (
    <div className="vo-fade-in flex w-[320px] max-w-[calc(100vw-32px)] items-start gap-2 rounded-lg border border-border-subtle bg-raised p-3 shadow-overlay">
      <Icon
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className={cn(
          'mt-0.5 shrink-0',
          toast.kind === 'error'
            ? 'text-st-failed'
            : toast.kind === 'success'
              ? 'text-st-completed'
              : 'text-text-secondary',
        )}
      />
      <p className="min-w-0 flex-1 text-sm text-text-primary">{toast.message}</p>
      {toast.kind === 'error' ? (
        <button
          type="button"
          aria-label={COPY.toasts.dismiss}
          onClick={() => onDismiss(toast.id)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-raised-hover hover:text-text-primary"
        >
          <X aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

export function Toasts({ bottomOffset }: { bottomOffset: number }) {
  const toasts = useOffice((s) => s.ui.toasts);
  const dismiss = useRuntime().store.getState().dismissToast;
  return (
    <div
      aria-live="polite"
      aria-label={COPY.toasts.region}
      className="pointer-events-none fixed right-4 z-[60] flex flex-col items-end gap-2"
      style={{ bottom: bottomOffset + 16 }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
