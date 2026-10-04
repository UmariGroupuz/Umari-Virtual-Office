// App-level error boundary fallback (CR-5): visible error text, Retry (remount) and Reload.
import { TriangleAlert } from 'lucide-react';
import { COPY } from './copy';
import { Button } from './components/Button';

export function AppErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div
        role="alert"
        className="flex w-full max-w-[480px] flex-col items-center rounded-lg border border-border-subtle bg-panel p-8 text-center"
      >
        <TriangleAlert
          aria-hidden="true"
          size={32}
          strokeWidth={1.75}
          className="mb-4 text-st-failed"
        />
        <h1 className="text-title-sm font-semibold text-text-primary">{COPY.appError.title}</h1>
        <p className="mt-2 text-sm text-text-secondary">{COPY.appError.body}</p>
        <p className="mt-2 font-mono text-xs break-words text-text-muted">{error.message}</p>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={reset}>
            {COPY.appError.retry}
          </Button>
          <Button onClick={() => window.location.reload()}>{COPY.appError.reload}</Button>
        </div>
      </div>
    </main>
  );
}
