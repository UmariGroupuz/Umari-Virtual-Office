// Office card around the lazily loaded Phaser office (API-C §10.2, UX §5.1, §5.6, ADR-025): header + legend,
// host sizing, role="img" summary, Suspense placeholder, < 768 px gating, HTML hover tooltip.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AGENT_STATUSES,
  AGENT_STATUS_LABELS,
  OFFICE_ROOMS,
  OFFICE_WORLD,
  ROOMS,
  type Agent,
} from '@vo/shared';
import type { OfficeHoverInfo } from '../office/OfficeCanvas';
import { COPY } from '../copy';
import { Button } from '../components/Button';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { StatusChip, StatusInline } from '../components/StatusChip';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  useDebouncedValue,
  useViewportHeight,
  useViewportWidth,
  type LayoutMode,
} from '../hooks/useViewport';
import { ROSTER_ID } from '../layout/ids';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';
import { officeSummaryParts, orderAgents, projectName } from '../store/selectors';
import { OFFICE_HEADER_H, computeCanvasHeight } from './officeSizing';

// The lazy component is re-created on Retry: React.lazy caches a rejected import forever (CR-5).
const createOfficeCanvas = () => lazy(() => import('../office/OfficeCanvas'));
const officeCanvasHolder = { Component: createOfficeCanvas() };

const SUMMARY_DEBOUNCE_MS = 2_000;
const CANVAS_BREAKPOINT_DEBOUNCE_MS = 200;

/** Static floor plan drawn from OFFICE_ROOMS (Suspense fallback and loading state, UX §11.4). */
export function OfficePlaceholder({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="relative flex size-full items-center justify-center bg-bg-sunken">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${OFFICE_WORLD.width} ${OFFICE_WORLD.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full p-2"
      >
        {OFFICE_ROOMS.map((room) => (
          <rect
            key={room.roomId}
            x={room.x}
            y={room.y}
            width={room.width}
            height={room.height}
            rx={6}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
          />
        ))}
      </svg>
      <div className="relative flex flex-col items-center gap-3">
        {label ? <span className="text-sm text-text-muted">{label}</span> : null}
        {children}
      </div>
    </div>
  );
}

/** Error boundary fallback of the office host (CR-5): visible message + Retry, never a blank card. */
function OfficeError({ height, reset }: { height: number; reset: () => void }) {
  return (
    <div className="relative w-full" style={{ height }}>
      <OfficePlaceholder label="">
        <p role="alert" className="text-sm text-text-secondary">
          {COPY.office.loadFailed}
        </p>
        <Button size="sm" onClick={reset}>
          {COPY.office.retry}
        </Button>
      </OfficePlaceholder>
    </div>
  );
}

function Legend() {
  return (
    <ul
      aria-label={COPY.office.legendLabel}
      className="flex min-w-0 items-center gap-3 overflow-hidden"
    >
      {AGENT_STATUSES.map((status) => (
        <li key={status} title={AGENT_STATUS_LABELS[status]} className="shrink-0 text-xs">
          <StatusInline
            status={status}
            iconSize={12}
            className="[&>span]:text-text-muted @max-[1100px]:[&>span]:sr-only"
          />
        </li>
      ))}
    </ul>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function HoverTooltip({
  hover,
  agent,
  project,
  hostWidth,
}: {
  hover: OfficeHoverInfo;
  agent: Agent;
  project: string | null;
  hostWidth: number;
}) {
  const centerX = hover.x + hover.width / 2;
  const left =
    hostWidth > 0 ? Math.min(Math.max(centerX, 140), Math.max(140, hostWidth - 140)) : centerX;
  const below = hover.y < 112;
  const detail = [agent.currentAction, agent.lastMessage ? truncate(agent.lastMessage, 80) : null]
    .filter((part): part is string => Boolean(part))
    .join(' — ');
  return (
    <div
      role="tooltip"
      className="vo-tooltip-delay pointer-events-none absolute z-20 w-max max-w-[260px] rounded-md border border-border-subtle bg-raised-hover px-2.5 py-2 shadow-overlay"
      style={{
        left,
        top: below ? hover.y + hover.height + 8 : hover.y - 8,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      }}
    >
      <p className="text-sm font-semibold text-text-primary">{agent.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <StatusChip status={agent.status} />
        {project ? <span className="text-xs text-text-secondary">{project}</span> : null}
      </div>
      {detail ? (
        <p className="mt-1 font-mono text-xs break-words text-text-secondary">{detail}</p>
      ) : null}
      <p className="mt-1 text-xs text-text-muted">{COPY.office.tooltipHint}</p>
    </div>
  );
}

export function OfficeCard({
  mode,
  bannerHeight,
  className,
}: {
  mode: LayoutMode;
  bannerHeight: number;
  className?: string;
}) {
  const agentsById = useOffice((s) => s.agents);
  const projects = useOffice((s) => s.projects);
  const loaded = useOffice((s) => s.loaded);
  const projectFilter = useOffice((s) => s.ui.projectFilter);
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const simulatorOpen = useOffice((s) => s.ui.simulatorOpen);
  const unavailable = useBackendUnavailable();
  const reducedMotion = useReducedMotion();
  const actions = useActions();
  const viewportWidth = useViewportWidth();
  const innerHeight = useViewportHeight();
  const canvasAllowed = useDebouncedValue(viewportWidth >= 768, CANVAS_BREAKPOINT_DEBOUNCE_MS);

  const cardRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<OfficeHoverInfo | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => {
      // Debounced 100 ms (UX §2.2).
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(measure, 100);
    });
    observer.observe(el);
    const initial = setTimeout(measure, 0);
    return () => {
      observer.disconnect();
      clearTimeout(initial);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  const agents = useMemo(() => orderAgents(agentsById), [agentsById]);
  const canvasHeight = computeCanvasHeight({
    mode,
    mainWidth: width,
    innerHeight,
    simulatorOpen,
    bannerHeight,
  });

  const summaryNow = loaded
    ? COPY.office.summary(
        agents.length,
        ROOMS.length,
        officeSummaryParts(agents, AGENT_STATUS_LABELS),
      )
    : COPY.office.loading;
  const summary = useDebouncedValue(summaryNow, SUMMARY_DEBOUNCE_MS);

  const onAgentHover = useCallback((info: OfficeHoverInfo | null) => setHover(info), []);
  const onAgentSelect = useCallback((id: string) => actions.openAgent(id), [actions]);
  const onBackgroundClick = useCallback(() => actions.closeAgent(), [actions]);

  const hoveredAgent = hover ? agentsById[hover.agentId] : undefined;

  return (
    <section
      ref={cardRef}
      aria-labelledby="vo-office-title"
      className={cn(
        '@container overflow-hidden rounded-lg border border-border-subtle bg-panel',
        unavailable && loaded && 'vo-stale',
        className,
      )}
    >
      <div
        className="flex items-center justify-between gap-4 border-b border-border-subtle px-3"
        style={{ height: OFFICE_HEADER_H }}
      >
        <h2
          id="vo-office-title"
          className="text-caption font-semibold tracking-[.06em] text-text-secondary uppercase"
        >
          {COPY.office.eyebrow}
        </h2>
        <Legend />
      </div>
      <a
        href={`#${ROSTER_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:m-2 focus:rounded-md focus:bg-raised focus:px-3 focus:py-1.5 focus:text-sm focus:text-text-primary"
      >
        {COPY.skipToAgents}
      </a>
      <ErrorBoundary
        onReset={() => {
          officeCanvasHolder.Component = createOfficeCanvas();
        }}
        fallback={({ reset }) => <OfficeError height={canvasHeight} reset={reset} />}
      >
        <div
          role="img"
          aria-label={summary}
          data-panel-keep=""
          className="relative w-full bg-bg-sunken"
          style={{ height: canvasHeight }}
          onPointerLeave={() => setHover(null)}
        >
          {canvasAllowed && loaded ? (
            <Suspense fallback={<OfficePlaceholder label={COPY.office.loading} />}>
              <officeCanvasHolder.Component
                agents={agents}
                projectFilter={projectFilter}
                selectedAgentId={selectedAgentId}
                reducedMotion={reducedMotion}
                paused={unavailable}
                onAgentSelect={onAgentSelect}
                onBackgroundClick={onBackgroundClick}
                onAgentHover={onAgentHover}
                className="size-full"
              />
            </Suspense>
          ) : (
            <OfficePlaceholder label={COPY.office.loading} />
          )}
          {hover && hoveredAgent ? (
            <HoverTooltip
              hover={hover}
              agent={hoveredAgent}
              project={projectName(projects, hoveredAgent.currentProject)}
              hostWidth={width}
            />
          ) : null}
        </div>
      </ErrorBoundary>
    </section>
  );
}
