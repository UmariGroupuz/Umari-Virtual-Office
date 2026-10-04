// Demo mode switch (UX §10) and DEMO badge (UX §3 #3). The switch reflects the server state.
import { useState } from 'react';
import { COPY } from '../copy';
import { Switch } from '../components/Controls';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { useActions, useOffice } from '../lib/runtime';

export function DemoSwitch({ compact = false }: { compact?: boolean }) {
  const demo = useOffice((s) => s.demo);
  const unavailable = useBackendUnavailable();
  const actions = useActions();
  const [pending, setPending] = useState<'starting' | 'stopping' | null>(null);

  const active = demo?.active ?? false;
  const label =
    pending === 'starting'
      ? COPY.demo.starting
      : pending === 'stopping'
        ? COPY.demo.stopping
        : compact
          ? COPY.demo.labelCompact
          : COPY.demo.label;

  const toggle = async (next: boolean) => {
    setPending(next ? 'starting' : 'stopping');
    try {
      await actions.setDemoActive(next);
    } finally {
      setPending(null);
    }
  };

  return (
    <Switch
      checked={active}
      label={label}
      pending={pending !== null}
      disabled={unavailable || demo === null}
      title={unavailable ? COPY.demo.unavailable : COPY.demo.tooltip}
      onChange={(next) => void toggle(next)}
    />
  );
}

export function DemoBadge() {
  const active = useOffice((s) => s.demo?.active ?? false);
  if (!active) return null;
  return (
    <span
      role="img"
      aria-label={COPY.topBar.demoBadgeLabel}
      className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-accent bg-accent-tint px-2 text-caption font-semibold tracking-[.06em] text-accent-text"
    >
      <span aria-hidden="true" className="vo-pulse-dot size-1.5 rounded-full bg-accent-text" />
      <span aria-hidden="true">{COPY.topBar.demoBadge}</span>
    </span>
  );
}
