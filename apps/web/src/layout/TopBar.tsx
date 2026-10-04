// Top bar (UX §3, §2.6, §2.7): 10 elements; single row ≥ 1024, two rows on tablet, compact on mobile.
import { useEffect, useRef, useState } from 'react';
import { Ellipsis, FlaskConical } from 'lucide-react';
import { COPY } from '../copy';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';
import type { LayoutMode } from '../hooks/useViewport';
import { DemoBadge, DemoSwitch } from './DemoControls';
import { SIMULATOR_TOGGLE_ID } from './ids';
import { ProjectSelector } from './ProjectSelector';
import { AgentsOnline, Clock, ConnectionPill, SystemPill } from './StatusPills';

function LogoMark() {
  return (
    <span aria-hidden="true" className="grid size-5 shrink-0 grid-cols-2 gap-[3px]">
      <span className="rounded-[2px] bg-accent" />
      <span className="rounded-[2px] bg-border-strong" />
      <span className="rounded-[2px] bg-border-strong" />
      <span className="rounded-[2px] bg-accent" />
    </span>
  );
}

function Brand() {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      <span className="truncate text-brand font-semibold tracking-[-.01em] text-text-primary">
        {COPY.appName}
      </span>
    </span>
  );
}

function SimulatorToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const open = useOffice((s) => s.ui.simulatorOpen);
  const actions = useActions();
  return (
    <button
      id={SIMULATOR_TOGGLE_ID}
      type="button"
      aria-pressed={open}
      aria-label={iconOnly ? COPY.topBar.simulatorLabel : undefined}
      title={iconOnly ? COPY.topBar.simulatorLabel : undefined}
      onClick={() => actions.setSimulatorOpen(!open)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border text-sm font-medium transition-colors duration-[120ms]',
        iconOnly ? 'w-8 justify-center' : 'px-3',
        open
          ? 'border-accent bg-accent-tint text-accent-text'
          : 'border-border-strong bg-raised text-text-primary hover:bg-raised-hover',
      )}
    >
      <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
      {iconOnly ? null : COPY.topBar.simulator}
    </button>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const actions = useActions();
  const simulatorOpen = useOffice((s) => s.ui.simulatorOpen);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        id={SIMULATOR_TOGGLE_ID}
        type="button"
        aria-expanded={open}
        aria-label={COPY.topBar.moreMenu}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-8 items-center justify-center rounded-md text-text-secondary hover:bg-raised hover:text-text-primary"
      >
        <Ellipsis aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-50 mt-1 flex w-64 flex-col gap-3 rounded-lg border border-border-subtle bg-raised p-3 shadow-overlay">
          <DemoSwitch />
          <button
            type="button"
            aria-pressed={simulatorOpen}
            onClick={() => {
              setOpen(false);
              actions.setSimulatorOpen(!simulatorOpen);
            }}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border-strong bg-panel px-3 text-sm text-text-primary hover:bg-raised-hover"
          >
            <FlaskConical aria-hidden="true" size={16} strokeWidth={1.75} />
            {COPY.topBar.simulatorLabel}
          </button>
          <AgentsOnline />
          <SystemPill />
          <Clock />
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({ mode }: { mode: LayoutMode }) {
  if (mode === 'mobile') {
    return (
      <header className="border-b border-border-subtle bg-panel">
        <div className="flex h-[52px] items-center gap-2 px-4">
          <Brand />
          <DemoBadge />
          <span className="flex-1" />
          <ConnectionPill worstOfSystem />
          <MobileMenu />
        </div>
        <div className="flex h-11 items-center px-4 pb-2">
          <ProjectSelector fullWidth />
        </div>
      </header>
    );
  }

  if (mode === 'tablet') {
    return (
      <header className="border-b border-border-subtle bg-panel">
        <div className="flex h-14 items-center gap-3 px-4">
          <Brand />
          <DemoBadge />
          <SystemPill />
          <span className="flex-1" />
          <ConnectionPill />
          <Clock />
        </div>
        <div className="flex h-11 items-center gap-3 px-4 pb-2">
          <ProjectSelector />
          <span className="flex-1" />
          <DemoSwitch />
          <SimulatorToggle />
          <AgentsOnline />
        </div>
      </header>
    );
  }

  const compact = mode === 'laptop';
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border-subtle bg-panel px-4">
      <Brand />
      <DemoBadge />
      <SystemPill />
      <ProjectSelector />
      <span className="flex-1" />
      <DemoSwitch compact={compact} />
      <SimulatorToggle iconOnly={compact} />
      <AgentsOnline compact={compact} />
      <ConnectionPill />
      <Clock />
    </header>
  );
}
