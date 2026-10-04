// Unknown routes (ARCHITECTURE §7).
import { Link } from 'react-router';
import { FileQuestion } from 'lucide-react';
import { COPY } from '../copy';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex max-w-[480px] flex-col items-center rounded-lg border border-border-subtle bg-panel p-8 text-center">
        <FileQuestion
          aria-hidden="true"
          size={32}
          strokeWidth={1.75}
          className="mb-4 text-text-muted"
        />
        <h1 className="text-title-sm font-semibold text-text-primary">{COPY.notFoundPage.title}</h1>
        <p className="mt-2 text-sm text-text-secondary">{COPY.notFoundPage.body}</p>
        <Link
          to="/"
          className="mt-5 inline-flex h-8 items-center rounded-md bg-accent-strong px-3 text-sm font-medium text-white hover:bg-accent-strong-hover"
        >
          {COPY.notFoundPage.back}
        </Link>
      </div>
    </main>
  );
}
