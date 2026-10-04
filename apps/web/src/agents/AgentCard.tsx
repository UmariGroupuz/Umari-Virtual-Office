// Roster card (UX §6, REQ-064): the accessible equivalent of a canvas desk.
import { memo } from 'react';
import { AGENT_STATUS_LABELS, type Agent } from '@vo/shared';
import { COPY } from '../copy';
import { Avatar } from '../components/Avatar';
import { ProgressBar } from '../components/ProgressBar';
import { StatusInline } from '../components/StatusChip';
import { useChangeFlash } from '../hooks/useChangeFlash';
import { agentCardId } from '../layout/ids';
import { cn } from '../lib/cn';
import { STATUS_VISUALS } from '../lib/statusMeta';
import { showsProgress } from '../store/selectors';

export const AgentCard = memo(function AgentCard({
  agent,
  projectName,
  selected,
  dimmed,
  onOpen,
}: {
  agent: Agent;
  projectName: string | null;
  selected: boolean;
  dimmed: boolean;
  onOpen: (agentId: string) => void;
}) {
  const flash = useChangeFlash(agent.version);
  const offline = !agent.online;
  const progress = showsProgress(agent);
  const taskTitle =
    agent.currentTask && agent.currentTask !== agent.taskId ? agent.currentTask : null;
  const label = COPY.roster.cardLabel({
    name: agent.name,
    status: AGENT_STATUS_LABELS[agent.status],
    project: projectName,
    taskId: agent.taskId,
    taskTitle: agent.currentTask,
    progress: progress ? agent.progress : null,
  });

  return (
    <button
      id={agentCardId(agent.id)}
      type="button"
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onOpen(agent.id)}
      className={cn(
        'flex h-[88px] w-full min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,opacity] duration-[120ms]',
        selected
          ? 'border-accent bg-accent-tint'
          : 'border-border-subtle bg-panel hover:border-border-strong hover:bg-raised',
        dimmed && 'opacity-45',
        flash > 0 && !selected && (flash % 2 === 1 ? 'vo-flash-border' : 'vo-flash-border-alt'),
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Avatar code={agent.code} roomId={agent.roomId} size={28} offline={offline} />
        <span className="flex min-w-0 flex-col">
          <span
            className={cn(
              'truncate text-sm font-semibold',
              offline ? 'text-text-secondary' : 'text-text-primary',
            )}
          >
            {agent.name}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs">
            <StatusInline status={agent.status} className="shrink-0 font-semibold" />
            <span aria-hidden="true" className="text-text-muted">
              ·
            </span>
            <span className="truncate text-text-secondary">
              {projectName ?? COPY.roster.noProject}
            </span>
          </span>
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 pl-9 text-xs text-text-muted">
        {agent.taskId ? (
          <>
            <span className="shrink-0 font-mono">{agent.taskId}</span>
            {taskTitle ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 flex-1 truncate">{taskTitle}</span>
              </>
            ) : (
              <span className="flex-1" />
            )}
            {progress ? <span className="vo-tabular shrink-0">{agent.progress}%</span> : null}
          </>
        ) : (
          <span>{COPY.roster.noTask}</span>
        )}
      </span>
      {progress ? (
        <span className="mt-auto block">
          <ProgressBar
            value={agent.progress}
            fillClassName={STATUS_VISUALS[agent.status].fill}
            label={`${agent.name} progress`}
          />
        </span>
      ) : null}
    </button>
  );
});
