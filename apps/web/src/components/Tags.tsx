// ProjectTag and DemoTag (UX §8.2).
import { COPY } from '../copy';

export function ProjectTag({ name }: { name: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-border-subtle bg-raised px-1.5 text-xs whitespace-nowrap text-text-secondary">
      {name}
    </span>
  );
}

export function DemoTag() {
  return (
    <span className="inline-flex h-4 shrink-0 items-center rounded-sm border border-dashed border-border-strong px-1 text-[10px] leading-none font-semibold tracking-[.06em] text-text-muted">
      {COPY.feed.demoTag}
    </span>
  );
}
