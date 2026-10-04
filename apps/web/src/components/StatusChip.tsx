// StatusChip, TaskStatusChip, PriorityLabel (UX §1.2, §1.3, §12). Status is always icon + text.
import {
  AGENT_STATUS_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_COLOR_KEY,
  TASK_STATUS_LABELS,
  type AgentStatus,
  type TaskPriority,
  type TaskStatus,
} from '@vo/shared';
import { cn } from '../lib/cn';
import { PRIORITY_VISUALS, STATUS_VISUALS, TASK_STATUS_ICONS } from '../lib/statusMeta';

const SIZES = {
  sm: { box: 'h-5 gap-1 px-2 text-xs', icon: 12 },
  md: { box: 'h-6 gap-1.5 px-2.5 text-sm', icon: 14 },
} as const;

export function StatusChip({
  status,
  size = 'sm',
  className,
}: {
  status: AgentStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const visual = STATUS_VISUALS[status];
  const Icon = visual.icon;
  const s = SIZES[size];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border font-semibold whitespace-nowrap',
        s.box,
        visual.tint,
        visual.border,
        visual.text,
        className,
      )}
    >
      <Icon aria-hidden="true" size={s.icon} strokeWidth={1.75} />
      {AGENT_STATUS_LABELS[status]}
    </span>
  );
}

export function TaskStatusChip({
  status,
  size = 'sm',
}: {
  status: TaskStatus;
  size?: 'sm' | 'md';
}) {
  const visual = STATUS_VISUALS[TASK_STATUS_COLOR_KEY[status]];
  const Icon = TASK_STATUS_ICONS[status];
  const s = SIZES[size];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border font-semibold whitespace-nowrap',
        s.box,
        visual.tint,
        visual.border,
        visual.text,
      )}
    >
      <Icon aria-hidden="true" size={s.icon} strokeWidth={1.75} />
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityLabel({ priority }: { priority: TaskPriority }) {
  const visual = PRIORITY_VISUALS[priority];
  const Icon = visual.icon;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', visual.text)}>
      <Icon aria-hidden="true" size={12} strokeWidth={1.75} />
      {TASK_PRIORITY_LABELS[priority]}
    </span>
  );
}

/** Icon + label in status color without a chip (roster cards, legend). */
export function StatusInline({
  status,
  iconSize = 14,
  className,
  labelHidden = false,
}: {
  status: AgentStatus;
  iconSize?: number;
  className?: string;
  labelHidden?: boolean;
}) {
  const visual = STATUS_VISUALS[status];
  const Icon = visual.icon;
  return (
    <span className={cn('inline-flex items-center gap-1', visual.text, className)}>
      <Icon aria-hidden="true" size={iconSize} strokeWidth={1.75} />
      <span className={labelHidden ? 'sr-only' : undefined}>{AGENT_STATUS_LABELS[status]}</span>
    </span>
  );
}
