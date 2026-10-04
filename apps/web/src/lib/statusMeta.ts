// Status / task / priority / department visuals (UX §1.2–1.4). Labels come from @vo/shared; class names are
// literal strings so Tailwind can see them.
import {
  Activity,
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Circle,
  CircleCheck,
  CircleDot,
  CircleEllipsis,
  CirclePause,
  CircleX,
  Minus,
  PowerOff,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { AgentStatus, RoomId, Severity, TaskPriority, TaskStatus } from '@vo/shared';

export interface StatusVisual {
  icon: LucideIcon;
  /** Text / icon color. */
  text: string;
  /** Chip background (status 16 % over panel). */
  tint: string;
  /** Chip border (status @ 40 %). */
  border: string;
  /** Progress fill. */
  fill: string;
}

export const STATUS_VISUALS: Readonly<Record<AgentStatus, StatusVisual>> = {
  idle: {
    icon: Circle,
    text: 'text-st-idle',
    tint: 'bg-st-idle-tint',
    border: 'border-st-idle/40',
    fill: 'bg-st-idle',
  },
  planning: {
    icon: CircleEllipsis,
    text: 'text-st-planning',
    tint: 'bg-st-planning-tint',
    border: 'border-st-planning/40',
    fill: 'bg-st-planning',
  },
  working: {
    icon: Activity,
    text: 'text-st-working',
    tint: 'bg-st-working-tint',
    border: 'border-st-working/40',
    fill: 'bg-st-working',
  },
  waiting: {
    icon: CirclePause,
    text: 'text-st-waiting',
    tint: 'bg-st-waiting-tint',
    border: 'border-st-waiting/40',
    fill: 'bg-st-waiting',
  },
  reviewing: {
    icon: Search,
    text: 'text-st-reviewing',
    tint: 'bg-st-reviewing-tint',
    border: 'border-st-reviewing/40',
    fill: 'bg-st-reviewing',
  },
  completed: {
    icon: CircleCheck,
    text: 'text-st-completed',
    tint: 'bg-st-completed-tint',
    border: 'border-st-completed/40',
    fill: 'bg-st-completed',
  },
  failed: {
    icon: TriangleAlert,
    text: 'text-st-failed',
    tint: 'bg-st-failed-tint',
    border: 'border-st-failed/40',
    fill: 'bg-st-failed',
  },
  offline: {
    icon: PowerOff,
    text: 'text-st-offline',
    tint: 'bg-st-offline-tint',
    border: 'border-st-offline/40',
    fill: 'bg-st-offline',
  },
};

/** Current-status button border in the simulator (1 px status color). */
export const STATUS_BORDER_SOLID: Readonly<Record<AgentStatus, string>> = {
  idle: 'border-st-idle',
  planning: 'border-st-planning',
  working: 'border-st-working',
  waiting: 'border-st-waiting',
  reviewing: 'border-st-reviewing',
  completed: 'border-st-completed',
  failed: 'border-st-failed',
  offline: 'border-st-offline',
};

/** UX §1.3 task status icons (colors via TASK_STATUS_COLOR_KEY → STATUS_VISUALS). */
export const TASK_STATUS_ICONS: Readonly<Record<TaskStatus, LucideIcon>> = {
  todo: Circle,
  assigned: CircleDot,
  planning: CircleEllipsis,
  in_progress: Activity,
  waiting: CirclePause,
  review: Search,
  completed: CircleCheck,
  failed: TriangleAlert,
  cancelled: CircleX,
};

export const PRIORITY_VISUALS: Readonly<Record<TaskPriority, { icon: LucideIcon; text: string }>> =
  {
    low: { icon: ChevronDown, text: 'text-text-muted' },
    normal: { icon: Minus, text: 'text-text-secondary' },
    high: { icon: ChevronUp, text: 'text-prio-high' },
    critical: { icon: ChevronsUp, text: 'text-st-failed' },
  };

export const DEPARTMENT_VISUALS: Readonly<
  Record<RoomId, { bg: string; ring: string; bar: string }>
> = {
  management: {
    bg: 'bg-dept-management-bg',
    ring: 'border-dept-management',
    bar: 'bg-dept-management',
  },
  development: {
    bg: 'bg-dept-development-bg',
    ring: 'border-dept-development',
    bar: 'bg-dept-development',
  },
  design: { bg: 'bg-dept-design-bg', ring: 'border-dept-design', bar: 'bg-dept-design' },
  infrastructure: {
    bg: 'bg-dept-infrastructure-bg',
    ring: 'border-dept-infrastructure',
    bar: 'bg-dept-infrastructure',
  },
  quality: { bg: 'bg-dept-quality-bg', ring: 'border-dept-quality', bar: 'bg-dept-quality' },
  'ai-lab': { bg: 'bg-dept-ai-lab-bg', ring: 'border-dept-ai-lab', bar: 'bg-dept-ai-lab' },
  documentation: {
    bg: 'bg-dept-documentation-bg',
    ring: 'border-dept-documentation',
    bar: 'bg-dept-documentation',
  },
  audit: { bg: 'bg-dept-audit-bg', ring: 'border-dept-audit', bar: 'bg-dept-audit' },
};

export const SEVERITY_VISUALS: Readonly<
  Record<Severity, { icon: LucideIcon | null; text: string; bar: string }>
> = {
  info: { icon: null, text: 'text-text-muted', bar: '' },
  warning: { icon: TriangleAlert, text: 'text-st-waiting', bar: 'bg-st-waiting' },
  error: { icon: CircleX, text: 'text-st-failed', bar: 'bg-st-failed' },
};
