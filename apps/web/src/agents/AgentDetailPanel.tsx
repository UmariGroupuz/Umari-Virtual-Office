// Agent detail panel (UX §7, REQ-080–083): header, live fields with ticking duration, 5 tabs, focus
// management, swap announcement, not-found state; overlay/docked (desktop), modal sheet (tablet), full screen.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, UserX, X } from 'lucide-react';
import type { Agent } from '@vo/shared';
import { COPY } from '../copy';
import { Avatar } from '../components/Avatar';
import { Button, IconButton } from '../components/Button';
import { EmptyState, Skeleton } from '../components/Feedback';
import { ProgressBar } from '../components/ProgressBar';
import { StatusChip } from '../components/StatusChip';
import { useChangeFlash } from '../hooks/useChangeFlash';
import { useServerNow } from '../hooks/useNow';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { agentCardId } from '../layout/ids';
import { cn } from '../lib/cn';
import { useActions, useOffice } from '../lib/runtime';
import { STATUS_VISUALS } from '../lib/statusMeta';
import { formatAbsolute, formatClock, formatDuration, formatRelative } from '../lib/time';
import { projectName, runningSince } from '../store/selectors';
import { ActivityTab } from './tabs/ActivityTab';
import { LogsTab } from './tabs/LogsTab';
import { FilesTab, GitTab } from './tabs/SampleTabs';
import { TasksTab } from './tabs/TasksTab';
import { useAgentEvents, useAgentLookup, useAgentTasks } from './useAgentData';

export type PanelVariant = 'overlay' | 'docked' | 'sheet' | 'fullscreen';

const TABS = ['activity', 'tasks', 'logs', 'files', 'git'] as const;
type TabKey = (typeof TABS)[number];

function FieldValue({
  value,
  children,
  className,
}: {
  value: unknown;
  children: ReactNode;
  className?: string;
}) {
  const flash = useChangeFlash(value);
  return (
    <dd
      className={cn(
        'mt-0.5 min-w-0 rounded-sm text-base break-words text-text-primary',
        flash > 0 && (flash % 2 === 1 ? 'vo-flash-bg' : 'vo-flash-bg-alt'),
        className,
      )}
    >
      {children}
    </dd>
  );
}

function Field({
  label,
  value,
  children,
  full = false,
  valueClassName,
}: {
  label: string;
  value: unknown;
  children: ReactNode;
  full?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={cn('min-w-0', full && 'col-span-2')}>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <FieldValue value={value} className={valueClassName}>
        {children}
      </FieldValue>
    </div>
  );
}

const DASH = COPY.panel.empty;

function LastMessage({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <>{DASH}</>;
  const long = text.length > 280 || text.split('\n').length > 6;
  return (
    <>
      <span className={cn('block whitespace-pre-wrap', !expanded && long && 'vo-clamp-6')}>
        {text}
      </span>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-accent-text hover:underline"
        >
          {expanded ? COPY.panel.showLess : COPY.panel.showMore}
        </button>
      ) : null}
    </>
  );
}

function Fields({ agent }: { agent: Agent }) {
  const projects = useOffice((s) => s.projects);
  const now = useServerNow();
  const since = runningSince(agent);
  const project = projectName(projects, agent.currentProject);
  const hasTask = agent.taskId !== null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4">
      <Field label={COPY.panel.fields.currentProject} value={project}>
        {project ?? DASH}
      </Field>
      <Field label={COPY.panel.fields.currentTask} value={agent.currentTask}>
        <span className="vo-clamp-2">{agent.currentTask ?? DASH}</span>
      </Field>
      <Field
        label={COPY.panel.fields.taskId}
        value={agent.taskId}
        valueClassName="font-mono text-sm"
      >
        {agent.taskId ?? DASH}
      </Field>
      <Field label={COPY.panel.fields.progress} value={hasTask ? agent.progress : null}>
        {hasTask ? (
          <span className="flex items-center gap-2">
            <ProgressBar
              value={agent.progress}
              height={6}
              fillClassName={STATUS_VISUALS[agent.status].fill}
              label={COPY.panel.fields.progress}
              className="flex-1"
            />
            <span className="vo-tabular text-sm">{agent.progress}%</span>
          </span>
        ) : (
          DASH
        )}
      </Field>
      <Field
        label={COPY.panel.fields.startedAt}
        value={agent.startedAt}
        valueClassName="vo-tabular"
      >
        {agent.startedAt ? formatAbsolute(agent.startedAt, now) : DASH}
      </Field>
      <Field
        label={COPY.panel.fields.runningDuration}
        value={since === null}
        valueClassName="vo-tabular"
      >
        {since ? formatDuration(now - Date.parse(since)) : DASH}
      </Field>
      <Field
        label={COPY.panel.fields.currentAction}
        value={agent.currentAction}
        full
        valueClassName="font-mono text-sm"
      >
        {agent.currentAction ?? DASH}
      </Field>
      <Field
        label={COPY.panel.fields.lastActivity}
        value={agent.lastActivityAt}
        full
        valueClassName="vo-tabular"
      >
        {agent.lastActivityAt
          ? `${formatRelative(agent.lastActivityAt, now)} · ${formatClock(agent.lastActivityAt)}`
          : DASH}
      </Field>
      <Field label={COPY.panel.fields.lastMessage} value={agent.lastMessage} full>
        <LastMessage key={agent.id} text={agent.lastMessage} />
      </Field>
    </dl>
  );
}

function Tabs({ agent }: { agent: Agent }) {
  const [active, setActive] = useState<TabKey>('activity');
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const events = useAgentEvents(agent.id);
  const tasks = useAgentTasks(agent.id);

  const labels: Record<TabKey, string> = {
    activity: COPY.panel.tabs.activity,
    tasks:
      tasks.tasks.length > 0
        ? `${COPY.panel.tabs.tasks} ${tasks.tasks.length}`
        : COPY.panel.tabs.tasks,
    logs: COPY.panel.tabs.logs,
    files: COPY.panel.tabs.files,
    git: COPY.panel.tabs.git,
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(active);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const key = TABS[next] ?? 'activity';
    setActive(key);
    tabRefs.current[key]?.focus();
  };

  let panel: ReactNode;
  switch (active) {
    case 'activity':
      panel = <ActivityTab data={events} />;
      break;
    case 'tasks':
      panel = <TasksTab data={tasks} />;
      break;
    case 'logs':
      panel = <LogsTab data={events} />;
      break;
    case 'files':
      panel = <FilesTab agentId={agent.id} roomId={agent.roomId} />;
      break;
    case 'git':
      panel = <GitTab agentId={agent.id} roomId={agent.roomId} />;
      break;
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={COPY.panel.tabs.label}
        onKeyDown={onKeyDown}
        className="sticky top-[72px] z-[2] flex gap-4 border-b border-border-subtle bg-panel px-4"
      >
        {TABS.map((key) => {
          const selected = key === active;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(key)}
              className={cn(
                '-mb-px h-10 border-b-2 text-sm font-medium whitespace-nowrap',
                selected
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {labels[key]}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${active}`}
        aria-labelledby={`${baseId}-tab-${active}`}
        tabIndex={0}
        className="px-4 py-3"
      >
        {panel}
      </div>
    </div>
  );
}

function PanelHeader({
  agent,
  headingId,
  headingRef,
  variant,
  onClose,
}: {
  agent: Agent | null;
  headingId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  variant: PanelVariant;
  onClose: () => void;
}) {
  return (
    <div className="sticky top-0 z-[3] flex min-h-[72px] items-start gap-3 border-b border-border-subtle bg-panel px-4 py-3">
      {variant === 'fullscreen' ? (
        <IconButton icon={ArrowLeft} label={COPY.panel.back} onClick={onClose} className="-ml-1" />
      ) : null}
      {agent ? (
        <Avatar code={agent.code} roomId={agent.roomId} size={40} offline={!agent.online} />
      ) : (
        <Skeleton className="size-10 rounded-full" />
      )}
      <div className="min-w-0 flex-1">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="truncate text-title font-semibold text-text-primary"
        >
          {agent ? agent.name : COPY.panel.notFoundTitle}
        </h2>
        {agent ? (
          <>
            <p className="truncate text-sm text-text-secondary">
              {agent.role} · {agent.department}
            </p>
            <StatusChip status={agent.status} size="md" className="mt-1.5" />
          </>
        ) : null}
      </div>
      <IconButton icon={X} label={COPY.panel.close} onClick={onClose} />
    </div>
  );
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

export function AgentDetailPanel({ agentId, variant }: { agentId: string; variant: PanelVariant }) {
  const lookup = useAgentLookup(agentId);
  const actions = useActions();
  const unavailable = useBackendUnavailable();
  const loaded = useOffice((s) => s.loaded);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const agentIdRef = useRef(agentId);
  const modal = variant === 'sheet' || variant === 'fullscreen';

  // Swap announcement (UX §7.5): polite live region updated when another agent replaces the current one.
  const agentName = lookup.kind === 'found' ? lookup.agent.name : null;
  const [shown, setShown] = useState<{ id: string; announce: string }>({
    id: agentId,
    announce: '',
  });
  if (shown.id !== agentId && agentName !== null) {
    setShown({ id: agentId, announce: COPY.panel.showing(agentName) });
  }

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    // Open: remember the trigger, move focus to the name heading. A swap keeps focus where the user
    // clicked (this effect runs only on open/close).
    returnFocusRef.current = document.activeElement;
    headingRef.current?.focus();
    const idRef = agentIdRef;
    return () => {
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && document.contains(target) && target !== document.body) {
        target.focus();
      } else {
        document.getElementById(agentCardId(idRef.current))?.focus();
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!modal || event.key !== 'Tab' || !panelRef.current) return;
    const items = focusables(panelRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const close = () => actions.closeAgent();

  let content: ReactNode;
  if (lookup.kind === 'found') {
    content = (
      <>
        <Fields agent={lookup.agent} />
        <Tabs agent={lookup.agent} />
      </>
    );
  } else if (lookup.kind === 'not-found') {
    content = (
      <EmptyState
        icon={UserX}
        title={COPY.panel.notFoundTitle}
        body={COPY.panel.notFoundBody(agentId)}
        action={
          <Button variant="primary" onClick={close}>
            {COPY.panel.notFoundClose}
          </Button>
        }
      />
    );
  } else {
    content = (
      <div className="grid grid-cols-2 gap-4 p-4" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  const agent = lookup.kind === 'found' ? lookup.agent : null;
  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={modal}
      aria-labelledby={headingId}
      data-layer="panel"
      data-panel-keep=""
      onKeyDown={onKeyDown}
      className={cn(
        'vo-scroll flex flex-col overflow-y-auto border-border-subtle bg-panel',
        variant === 'overlay' && 'vo-panel-enter h-full w-full rounded-lg border shadow-overlay',
        variant === 'docked' && 'h-full rounded-lg border',
        variant === 'sheet' &&
          'vo-panel-enter fixed inset-y-0 right-0 z-50 w-[min(440px,calc(100vw-48px))] border-l shadow-overlay',
        variant === 'fullscreen' && 'vo-sheet-enter fixed inset-0 z-50',
        unavailable && loaded && 'vo-stale',
      )}
    >
      <PanelHeader
        agent={agent}
        headingId={headingId}
        headingRef={headingRef}
        variant={variant}
        onClose={close}
      />
      {content}
      <p aria-live="polite" className="sr-only">
        {shown.announce}
      </p>
    </div>
  );

  if (variant === 'sheet') {
    return (
      <>
        <div
          aria-hidden="true"
          onClick={close}
          className="vo-fade-in fixed inset-0 z-40"
          style={{ background: 'var(--overlay-scrim)' }}
        />
        {panel}
      </>
    );
  }
  return panel;
}
