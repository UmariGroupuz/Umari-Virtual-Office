// Main route `/` (ARCHITECTURE §7): composes the responsive layouts of UX §2 — viewport-locked control-room
// shell (≥ 1280), page-scroll tablet/laptop (768–1279) and the simplified mobile view (< 768, no Phaser).
// Also owns the global Esc layering (UX §7.6) and the click-outside rule of the detail panel.
import { useEffect, useState, type PointerEvent } from 'react';
import { Info, X } from 'lucide-react';
import { COPY } from '../copy';
import { ActivityFeed } from '../activity/ActivityFeed';
import { AgentDetailPanel } from '../agents/AgentDetailPanel';
import { AgentRoster } from '../agents/AgentRoster';
import { MetricsRow } from '../dashboard/MetricsRow';
import { OfficeCard } from '../dashboard/OfficeCard';
import {
  getLayoutMode,
  isShellMode,
  rightColumnWidth,
  useDebouncedValue,
  useViewportHeight,
  useViewportWidth,
  type LayoutMode,
} from '../hooks/useViewport';
import { ROSTER_ID } from '../layout/ids';
import { BackendUnavailableState, SystemBanners } from '../layout/SystemBanners';
import { Toasts } from '../layout/Toasts';
import { TopBar } from '../layout/TopBar';
import { cn } from '../lib/cn';
import { useActions, useOffice, useRuntime } from '../lib/runtime';
import { SimulatorDock } from '../simulator/SimulatorDock';

const MOBILE_DEBOUNCE_MS = 200;
const BANNER_H = 40;

/** Elements whose pointerdown must not close the panel (UX §7.6). */
const KEEP_PANEL_SELECTOR = [
  '[data-panel-keep]',
  'header',
  'aside',
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="option"]',
  '[role="listbox"]',
  '[role="tab"]',
  '[role="switch"]',
].join(',');

function useEscapeLayers() {
  const { store } = useRuntime();
  const actions = useActions();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = document.activeElement;
      const inSimulator = active?.closest('[data-layer="simulator"]');
      const inPanel = active?.closest('[data-layer="panel"]');
      const layers = store.getState().ui.layers;
      const layer = inSimulator ? 'simulator' : inPanel ? 'panel' : layers[layers.length - 1];
      if (!layer) return;
      event.preventDefault();
      if (layer === 'simulator') actions.setSimulatorOpen(false);
      else actions.closeAgent();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, actions]);
}

function SkipLink() {
  return (
    <a
      href={`#${ROSTER_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-raised focus:px-3 focus:py-1.5 focus:text-sm focus:text-text-primary"
    >
      {COPY.skipToAgents}
    </a>
  );
}

function useBannerVisible(): boolean {
  const health = useOffice((s) => s.connection.health);
  const socket = useOffice((s) => s.connection.socket);
  const loaded = useOffice((s) => s.loaded);
  return (health === 'failing' && loaded) || socket === 'reconnecting' || socket === 'disconnected';
}

function DesktopShell({ mode, width }: { mode: LayoutMode; width: number }) {
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const simulatorOpen = useOffice((s) => s.ui.simulatorOpen);
  const loaded = useOffice((s) => s.loaded);
  const unavailable = useOffice((s) => s.connection.health === 'failing');
  const bannerVisible = useBannerVisible();
  const actions = useActions();
  const docked = mode === 'ultra' && selectedAgentId !== null;
  const rightW = rightColumnWidth(width);
  const columns = docked ? `minmax(0,1fr) 400px ${rightW}px` : `minmax(0,1fr) ${rightW}px`;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (selectedAgentId === null) return;
    const target = event.target as Element;
    if (target.closest(KEEP_PANEL_SELECTOR)) return;
    actions.closeAgent();
  };

  return (
    <div
      className="grid h-screen min-h-[640px] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden"
      onPointerDown={onPointerDown}
    >
      <SkipLink />
      <TopBar mode={mode} />
      <SystemBanners />
      {unavailable && !loaded ? (
        <BackendUnavailableState />
      ) : (
        <div
          className="grid min-h-0 gap-3 px-4 pt-3 pb-3"
          style={{ gridTemplateColumns: columns, gridTemplateRows: 'auto minmax(0,1fr)' }}
        >
          <main className="contents">
            <div style={{ gridColumn: '1 / -1', gridRow: 1 }}>
              <MetricsRow columns={8} />
            </div>
            <div
              data-testid="main-column"
              className="flex min-h-0 flex-col gap-3"
              style={{ gridColumn: 1, gridRow: 2 }}
            >
              {/* Office + roster scroll together; the dock sits below the scroll area so it never covers
                  the roster (PM review round 1). */}
              <div
                data-testid="main-scroll"
                className="vo-scroll relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
              >
                <OfficeCard
                  mode={mode}
                  bannerHeight={bannerVisible ? BANNER_H : 0}
                  className="shrink-0"
                />
                <AgentRoster className="shrink-0 pb-3" />
              </div>
              {simulatorOpen ? <SimulatorDock variant="dock" /> : null}
            </div>
          </main>
          <aside
            aria-label={COPY.feed.label}
            className="flex min-h-0"
            style={{ gridColumn: docked ? 3 : 2, gridRow: 2 }}
          >
            <ActivityFeed className="flex-1" />
          </aside>
          {selectedAgentId !== null && docked ? (
            <div className="min-h-0" style={{ gridColumn: 2, gridRow: 2 }}>
              <AgentDetailPanel agentId={selectedAgentId} variant="docked" />
            </div>
          ) : null}
          {selectedAgentId !== null && !docked ? (
            <div
              className="pointer-events-none relative z-20 min-h-0"
              style={{ gridColumn: 2, gridRow: 2 }}
            >
              <div
                className="pointer-events-auto absolute inset-y-0 right-0"
                style={{ width: Math.max(rightW, 360) }}
              >
                <AgentDetailPanel agentId={selectedAgentId} variant="overlay" />
              </div>
            </div>
          ) : null}
        </div>
      )}
      <Toasts bottomOffset={0} />
    </div>
  );
}

function ScrollLayout({ mode, width }: { mode: LayoutMode; width: number }) {
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const simulatorOpen = useOffice((s) => s.ui.simulatorOpen);
  const loaded = useOffice((s) => s.loaded);
  const unavailable = useOffice((s) => s.connection.health === 'failing');
  const bannerVisible = useBannerVisible();
  const innerHeight = useViewportHeight();
  const sheetHeight = simulatorOpen ? Math.min(Math.round(innerHeight * 0.5), 420) : 0;

  return (
    <div className="min-h-screen" style={{ paddingBottom: sheetHeight }}>
      <SkipLink />
      <TopBar mode={mode} />
      <SystemBanners />
      {unavailable && !loaded ? (
        <BackendUnavailableState />
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4">
          <main className="contents">
            <div className="col-span-2">
              <MetricsRow columns={4} />
            </div>
            <OfficeCard
              mode={mode}
              bannerHeight={bannerVisible ? BANNER_H : 0}
              className="col-span-2"
            />
            <AgentRoster
              className="vo-scroll max-h-[640px] min-w-0 overflow-y-auto"
              singleColumn={width < 900}
            />
          </main>
          <aside aria-label={COPY.feed.label} className="flex h-[640px] min-w-0">
            <ActivityFeed className="flex-1" />
          </aside>
        </div>
      )}
      {simulatorOpen ? <SimulatorDock variant="sheet" /> : null}
      {selectedAgentId !== null ? (
        <AgentDetailPanel agentId={selectedAgentId} variant="sheet" />
      ) : null}
      <Toasts bottomOffset={sheetHeight} />
    </div>
  );
}

function MobileLayout() {
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const simulatorOpen = useOffice((s) => s.ui.simulatorOpen);
  const loaded = useOffice((s) => s.loaded);
  const unavailable = useOffice((s) => s.connection.health === 'failing');
  const agentCount = useOffice((s) => Object.keys(s.agents).length);
  const [tab, setTab] = useState<'agents' | 'activity'>('agents');
  const [noteDismissed, setNoteDismissed] = useState(false);

  return (
    <div className="min-h-screen">
      <SkipLink />
      <TopBar mode="mobile" />
      <SystemBanners />
      {unavailable && !loaded ? (
        <BackendUnavailableState />
      ) : (
        <main className="flex flex-col gap-3 p-4">
          <MetricsRow columns={4} compact />
          <div
            role="group"
            aria-label={COPY.mobile.viewSwitch}
            className="grid grid-cols-2 rounded-md border border-border-subtle bg-panel p-0.5"
          >
            {(['agents', 'activity'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'h-8 rounded-[5px] text-sm font-medium',
                  tab === key ? 'bg-raised text-text-primary' : 'text-text-secondary',
                )}
              >
                {key === 'agents'
                  ? COPY.mobile.agentsTab(loaded ? agentCount : null)
                  : COPY.mobile.activityTab}
              </button>
            ))}
          </div>
          {tab === 'agents' ? (
            <>
              {!noteDismissed ? (
                <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-panel px-3 py-2 text-sm text-text-secondary">
                  <Info aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0" />
                  <span className="flex-1">{COPY.office.mobileNote}</span>
                  <button
                    type="button"
                    aria-label={COPY.office.dismissNote}
                    onClick={() => setNoteDismissed(true)}
                    className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-raised"
                  >
                    <X aria-hidden="true" size={14} strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
              <AgentRoster singleColumn showHeader={false} />
            </>
          ) : (
            <aside
              aria-label={COPY.feed.label}
              className="flex h-[calc(100vh-240px)] min-h-[420px]"
            >
              <ActivityFeed className="flex-1" />
            </aside>
          )}
        </main>
      )}
      {simulatorOpen ? <SimulatorDock variant="fullscreen" /> : null}
      {selectedAgentId !== null ? (
        <AgentDetailPanel agentId={selectedAgentId} variant="fullscreen" />
      ) : null}
      <Toasts bottomOffset={0} />
    </div>
  );
}

export function OfficePage() {
  useEscapeLayers();
  const width = useViewportWidth();
  const isMobile = useDebouncedValue(width < 768, MOBILE_DEBOUNCE_MS);
  const mode: LayoutMode = isMobile ? 'mobile' : getLayoutMode(Math.max(width, 768));

  if (mode === 'mobile') return <MobileLayout />;
  if (isShellMode(mode)) return <DesktopShell mode={mode} width={width} />;
  return <ScrollLayout mode={mode} width={width} />;
}
