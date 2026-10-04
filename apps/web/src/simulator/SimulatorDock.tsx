// Developer Simulator (UX §9, REQ-100–104): target selects, 8 status buttons with legality hints, Send Activity
// form, inline feedback. Writes go through the backend only; responses pass through the reducer (no optimism).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, Info, LoaderCircle, X } from 'lucide-react';
import {
  AGENT_STATUS_LABELS,
  LIMITS,
  PROJECTS,
  SEVERITIES,
  SEVERITY_LABELS,
  SIMULATOR_ACTION_SUGGESTIONS,
  TASK_STATUS_LABELS,
  type Agent,
  type AgentStatus,
  type Severity,
} from '@vo/shared';
import { COPY } from '../copy';
import { Button, IconButton } from '../components/Button';
import { useBackendUnavailable } from '../hooks/useSystemStatus';
import { SIMULATOR_AGENT_SELECT_ID, SIMULATOR_TOGGLE_ID } from '../layout/ids';
import { cn } from '../lib/cn';
import { useActions, useOffice, useRuntime } from '../lib/runtime';
import { STATUS_BORDER_SOLID, STATUS_VISUALS } from '../lib/statusMeta';
import { formatClock } from '../lib/time';
import {
  STATUS_BUTTON_ORDER,
  buildActivityBody,
  buildStatusPatch,
  buttonLegality,
  describeWriteError,
  validateActivity,
  type Feedback,
  type FieldErrors,
} from './simulatorLogic';

export type SimulatorVariant = 'dock' | 'sheet' | 'fullscreen';

const SUCCESS_CLEAR_MS = 4_000;
const COUNTER_FROM = 1_800;

const inputClass =
  'h-8 w-full min-w-0 rounded-md border bg-bg-sunken px-2.5 text-sm text-text-primary placeholder:text-text-muted hover:border-border-hover focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50';

type Pending = { kind: 'status'; status: AgentStatus } | { kind: 'activity' } | null;

function initialTarget(agent: Agent | undefined, tasks: Record<string, { project: string }>) {
  const projectId = agent?.currentProject ?? '';
  const taskId =
    agent?.taskId && projectId && tasks[agent.taskId]?.project === projectId ? agent.taskId : '';
  return { agentId: agent?.id ?? '', projectId, taskId };
}

export function SimulatorDock({ variant }: { variant: SimulatorVariant }) {
  const { api } = useRuntime();
  const actions = useActions();
  const agentsById = useOffice((s) => s.agents);
  const tasksById = useOffice((s) => s.tasks);
  const selectedAgentId = useOffice((s) => s.ui.selectedAgentId);
  const socket = useOffice((s) => s.connection.socket);
  const unavailable = useBackendUnavailable();
  const titleId = useId();
  const actionErrorId = useId();
  const messageErrorId = useId();
  const counterId = useId();
  const illegalHintId = useId();
  const agentSelectRef = useRef<HTMLSelectElement>(null);

  const [target, setTarget] = useState(() =>
    initialTarget(selectedAgentId ? agentsById[selectedAgentId] : undefined, tasksById),
  );
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<Severity>('info');
  const [pending, setPending] = useState<Pending>(null);
  const [feedback, setFeedback] = useState<(Feedback & { id: number }) | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const agents = useMemo(
    () => Object.values(agentsById).sort((a, b) => a.id.localeCompare(b.id)),
    [agentsById],
  );
  const agent = target.agentId ? agentsById[target.agentId] : undefined;
  const projectTasks = useMemo(
    () =>
      target.projectId
        ? Object.values(tasksById)
            .filter((t) => t.project === target.projectId)
            .sort((a, b) => a.id.localeCompare(b.id))
        : [],
    [tasksById, target.projectId],
  );
  const projectLabel = PROJECTS.find((p) => p.id === target.projectId)?.name ?? '';

  // Focus → Agent select on open; on close focus returns to the top-bar toggle (UX §9.1).
  useEffect(() => {
    agentSelectRef.current?.focus();
    return () => {
      document.getElementById(SIMULATOR_TOGGLE_ID)?.focus();
    };
  }, []);

  useEffect(() => {
    if (!feedback || feedback.kind === 'error') return;
    const timer = setTimeout(() => setFeedback(null), SUCCESS_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const feedbackSeq = useRef(0);
  const show = (next: Feedback) => {
    feedbackSeq.current += 1;
    setFeedback({ ...next, id: feedbackSeq.current });
  };
  const clearErrors = () => {
    setFieldErrors({});
    if (feedback?.kind === 'error') setFeedback(null);
  };

  const busy = pending !== null;
  const actionsDisabled = !agent || busy || unavailable;
  const livePaused = !unavailable && (socket === 'reconnecting' || socket === 'disconnected');

  const onAgentChange = (id: string) => {
    clearErrors();
    setTarget(initialTarget(agentsById[id], tasksById));
  };

  const sendStatus = async (status: AgentStatus) => {
    if (!agent) return;
    setPending({ kind: 'status', status });
    setFeedback(null);
    setFieldErrors({});
    const current = agent.status;
    try {
      const result = await api.patchAgentStatus(
        agent.id,
        buildStatusPatch(status, target.projectId || null, target.taskId || null),
      );
      actions.applyWriteResult(result);
      if (result.event === null) {
        show({
          kind: 'info',
          message: COPY.simulator.noChange(agent.name, AGENT_STATUS_LABELS[status]),
        });
      } else {
        const resulting = result.agent?.status ?? status;
        show({
          kind: 'success',
          message: COPY.simulator.accepted(
            agent.name,
            AGENT_STATUS_LABELS[resulting],
            formatClock(result.event.createdAt),
          ),
        });
      }
    } catch (error) {
      show(describeWriteError(error, current));
    } finally {
      setPending(null);
    }
  };

  const sendActivity = async (event: FormEvent) => {
    event.preventDefault();
    if (!agent || busy || unavailable) return;
    const body = buildActivityBody({
      agentId: agent.id,
      action,
      message,
      severity,
      projectId: target.projectId || null,
      taskId: target.taskId || null,
    });
    const errors = validateActivity(body);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFeedback(null);
      return;
    }
    setFieldErrors({});
    setFeedback(null);
    setPending({ kind: 'activity' });
    try {
      const result = await api.postEvent(body);
      actions.applyWriteResult(result);
      show({
        kind: 'success',
        message: COPY.simulator.eventSent(action.trim(), formatClock(result.event.createdAt)),
      });
    } catch (error) {
      show(describeWriteError(error, agent.status));
    } finally {
      setPending(null);
    }
  };

  const stacked = variant !== 'dock';
  const FeedbackIcon =
    feedback?.kind === 'error' ? CircleX : feedback?.kind === 'success' ? CircleCheck : Info;

  const sectionTitle = (text: string) => (
    <h3 className="mb-1.5 text-caption font-semibold tracking-[.06em] text-text-muted uppercase">
      {text}
    </h3>
  );

  const labelClass = cn(
    'shrink-0 text-xs font-medium text-text-secondary',
    stacked ? 'w-16' : 'w-14',
  );

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      data-layer="simulator"
      data-panel-keep=""
      className={cn(
        'flex flex-col border-border-subtle bg-panel shadow-overlay',
        variant === 'dock' && 'h-[200px] shrink-0 rounded-lg border',
        variant === 'sheet' &&
          'vo-sheet-enter fixed inset-x-0 bottom-0 z-30 h-[min(50vh,420px)] rounded-t-lg border-t',
        variant === 'fullscreen' && 'vo-sheet-enter fixed inset-0 z-50',
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-subtle pr-1.5 pl-3">
        <h2
          id={titleId}
          className="text-title-sm font-semibold whitespace-nowrap text-text-primary"
        >
          {COPY.simulator.title}
        </h2>
        <p className="min-w-0 flex-1 truncate text-xs text-text-muted">{COPY.simulator.hint}</p>
        <IconButton
          icon={X}
          label={COPY.simulator.close}
          size="sm"
          onClick={() => actions.setSimulatorOpen(false)}
        />
      </div>

      <div
        className={cn(
          'vo-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2',
          stacked
            ? 'flex flex-col gap-4'
            : 'grid grid-cols-[minmax(0,30fr)_minmax(0,37fr)_minmax(0,33fr)] gap-4',
        )}
      >
        {/* TARGET */}
        <div className="min-w-0">
          {sectionTitle(COPY.simulator.target)}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <span className={labelClass}>{COPY.simulator.agent}</span>
              <select
                id={SIMULATOR_AGENT_SELECT_ID}
                ref={agentSelectRef}
                value={target.agentId}
                onChange={(e) => onAgentChange(e.target.value)}
                className={cn('vo-select', inputClass, 'border-border-strong')}
              >
                <option value="">{COPY.simulator.agentPlaceholder}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {`${a.name} (${AGENT_STATUS_LABELS[a.status]})`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className={labelClass}>{COPY.simulator.project}</span>
              <select
                value={target.projectId}
                onChange={(e) => {
                  clearErrors();
                  setTarget((t) => ({ ...t, projectId: e.target.value, taskId: '' }));
                }}
                className={cn('vo-select', inputClass, 'border-border-strong')}
              >
                <option value="">{COPY.simulator.none}</option>
                {PROJECTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className={labelClass}>{COPY.simulator.task}</span>
              <select
                value={target.taskId}
                disabled={!target.projectId}
                onChange={(e) => {
                  clearErrors();
                  setTarget((t) => ({ ...t, taskId: e.target.value }));
                }}
                className={cn('vo-select', inputClass, 'border-border-strong')}
              >
                {!target.projectId ? (
                  <option value="">{COPY.simulator.taskNeedsProject}</option>
                ) : (
                  <>
                    <option value="">{COPY.simulator.none}</option>
                    {projectTasks.length === 0 ? (
                      <option value="__none" disabled>
                        {COPY.simulator.noTasksIn(projectLabel)}
                      </option>
                    ) : (
                      projectTasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {`${t.id} · ${t.title} (${TASK_STATUS_LABELS[t.status]})`}
                        </option>
                      ))
                    )}
                  </>
                )}
              </select>
            </label>
          </div>
        </div>

        {/* STATUS */}
        <div className="min-w-0">
          {sectionTitle(COPY.simulator.status)}
          <div className={cn('grid gap-1.5', stacked ? 'grid-cols-2' : 'grid-cols-3')}>
            {STATUS_BUTTON_ORDER.map((status) => {
              const legality = agent ? buttonLegality(agent.status, status) : 'legal';
              const visual = STATUS_VISUALS[status];
              const Icon = visual.icon;
              const isPending = pending?.kind === 'status' && pending.status === status;
              const illegal = legality === 'illegal';
              const hint =
                illegal && agent
                  ? COPY.simulator.illegalHint(AGENT_STATUS_LABELS[agent.status])
                  : undefined;
              return (
                <button
                  key={status}
                  type="button"
                  disabled={actionsDisabled}
                  aria-pressed={agent ? legality === 'current' : undefined}
                  aria-busy={isPending || undefined}
                  aria-describedby={illegal ? `${illegalHintId}-${status}` : undefined}
                  title={hint}
                  onClick={() => void sendStatus(status)}
                  className={cn(
                    'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-sm whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-45',
                    legality === 'current'
                      ? cn('bg-raised-hover text-text-primary', STATUS_BORDER_SOLID[status])
                      : illegal
                        ? 'border-dashed border-border-strong bg-raised text-text-muted hover:bg-raised-hover'
                        : 'border-border-strong bg-raised text-text-primary hover:bg-raised-hover',
                  )}
                >
                  {isPending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      size={14}
                      strokeWidth={1.75}
                      className="shrink-0 animate-spin"
                    />
                  ) : (
                    <Icon
                      aria-hidden="true"
                      size={14}
                      strokeWidth={1.75}
                      className={cn('shrink-0', visual.text, illegal && 'opacity-50')}
                    />
                  )}
                  <span className="truncate">{COPY.simulator.buttons[status]}</span>
                  {legality === 'current' && agent ? (
                    <>
                      {' '}
                      <span className="sr-only">{COPY.simulator.current}</span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
          {agent ? (
            <div hidden>
              {STATUS_BUTTON_ORDER.filter(
                (status) => buttonLegality(agent.status, status) === 'illegal',
              ).map((status) => (
                <span key={status} id={`${illegalHintId}-${status}`}>
                  {COPY.simulator.illegalHint(AGENT_STATUS_LABELS[agent.status])}
                </span>
              ))}
            </div>
          ) : null}
          {!agent ? (
            <p className="mt-1.5 text-xs text-text-muted">{COPY.simulator.selectAgentHint}</p>
          ) : null}
        </div>

        {/* SEND ACTIVITY */}
        <form className="min-w-0" onSubmit={(e) => void sendActivity(e)} noValidate>
          {sectionTitle(COPY.simulator.sendActivity)}
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <label htmlFor={`${titleId}-action`} className={cn(labelClass, 'pt-2')}>
                {COPY.simulator.action}
              </label>
              <div className="min-w-0 flex-1">
                <input
                  id={`${titleId}-action`}
                  list="vo-actions"
                  value={action}
                  placeholder={COPY.simulator.actionPlaceholder}
                  aria-invalid={fieldErrors.action ? true : undefined}
                  aria-describedby={fieldErrors.action ? actionErrorId : undefined}
                  onChange={(e) => {
                    clearErrors();
                    setAction(e.target.value);
                  }}
                  className={cn(
                    inputClass,
                    'font-mono',
                    fieldErrors.action ? 'border-st-failed' : 'border-border-strong',
                  )}
                />
                <datalist id="vo-actions">
                  {SIMULATOR_ACTION_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
                {fieldErrors.action ? (
                  <p id={actionErrorId} role="alert" className="mt-0.5 text-xs text-st-failed">
                    {fieldErrors.action}
                  </p>
                ) : null}
              </div>
              <select
                aria-label={COPY.simulator.severity}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className={cn(
                  'vo-select',
                  inputClass.replace('w-full ', ''),
                  'w-24 shrink-0 border-border-strong',
                )}
              >
                {SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {SEVERITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-start gap-2">
              <label htmlFor={`${titleId}-message`} className={cn(labelClass, 'pt-2')}>
                {COPY.simulator.message}
              </label>
              <div className="min-w-0 flex-1">
                <input
                  id={`${titleId}-message`}
                  value={message}
                  placeholder={COPY.simulator.messagePlaceholder}
                  aria-invalid={fieldErrors.message ? true : undefined}
                  aria-describedby={
                    cn(
                      fieldErrors.message && messageErrorId,
                      message.length >= COUNTER_FROM && counterId,
                    ) || undefined
                  }
                  onChange={(e) => {
                    clearErrors();
                    setMessage(e.target.value);
                  }}
                  className={cn(
                    inputClass,
                    fieldErrors.message ? 'border-st-failed' : 'border-border-strong',
                  )}
                />
                {fieldErrors.message ? (
                  <p id={messageErrorId} role="alert" className="mt-0.5 text-xs text-st-failed">
                    {fieldErrors.message}
                  </p>
                ) : null}
                {message.length >= COUNTER_FROM ? (
                  <p
                    id={counterId}
                    className={cn(
                      'vo-tabular mt-0.5 text-right text-xs',
                      message.length > LIMITS.MESSAGE_MAX ? 'text-st-failed' : 'text-text-muted',
                    )}
                  >
                    {COPY.simulator.counter(message.length, LIMITS.MESSAGE_MAX)}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={actionsDisabled}
                pending={pending?.kind === 'activity'}
              >
                {COPY.simulator.sendEvent}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <div className="flex min-h-[22px] shrink-0 items-center gap-3 border-t border-border-subtle px-3 py-0.5 text-xs">
        {unavailable ? (
          <p role="status" className="flex items-center gap-1.5 text-text-secondary">
            <Info aria-hidden="true" size={14} strokeWidth={1.75} />
            {COPY.simulator.unavailable}
          </p>
        ) : feedback ? (
          <p
            key={feedback.id}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            className="flex min-w-0 items-center gap-1.5"
          >
            <FeedbackIcon
              aria-hidden="true"
              size={14}
              strokeWidth={1.75}
              className={cn(
                'shrink-0',
                feedback.kind === 'error'
                  ? 'text-st-failed'
                  : feedback.kind === 'success'
                    ? 'text-st-completed'
                    : 'text-text-secondary',
              )}
            />
            <span className="text-text-primary">{feedback.message}</span>
            {feedback.hint ? <span className="text-text-muted">· {feedback.hint}</span> : null}
          </p>
        ) : (
          <p role="status" className="sr-only" />
        )}
        {livePaused ? <p className="ml-auto text-text-muted">{COPY.simulator.livePaused}</p> : null}
      </div>
    </section>
  );
}
