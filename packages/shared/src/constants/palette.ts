// Color tokens as '#RRGGBB' strings copied from UX §1 — single source for React and Phaser (ADR-025).
import type { RoomId } from './rooms';
import type { AgentStatus, TaskPriority, TaskStatus } from './statuses';

/** UX §1.1 surfaces, borders, text and accent. */
export const UI_COLORS = Object.freeze({
  bg: '#0B0D10',
  bgSunken: '#0E1014',
  panel: '#13161B',
  raised: '#1A1E24',
  raisedHover: '#222730',
  borderSubtle: '#262B33',
  borderStrong: '#3A414C',
  textPrimary: '#E6E8EB',
  textSecondary: '#A3AAB5',
  textMuted: '#8B939E',
  accent: '#5B8DEF',
  accentText: '#8AB0FF',
  accentStrong: '#3B6FD9',
  accentTint: '#1A2230',
  roomFloor: '#15181D',
} as const);

/** UX §1.2 status color and chip tint (status color 16 % over panel). */
export const STATUS_COLORS: Readonly<Record<AgentStatus, { color: string; chipTint: string }>> =
  Object.freeze({
    idle: Object.freeze({ color: '#9AA3AE', chipTint: '#292D33' }),
    planning: Object.freeze({ color: '#4FB6E0', chipTint: '#1D303B' }),
    working: Object.freeze({ color: '#3FB950', chipTint: '#1A3023' }),
    waiting: Object.freeze({ color: '#D9A13B', chipTint: '#332C20' }),
    reviewing: Object.freeze({ color: '#A98AF5', chipTint: '#2B293E' }),
    completed: Object.freeze({ color: '#4CC38A', chipTint: '#1C322D' }),
    failed: Object.freeze({ color: '#F2645A', chipTint: '#372225' }),
    offline: Object.freeze({ color: '#8A929D', chipTint: '#262A30' }),
  });

/** UX §1.4 department identity colors (never a status signal). */
export const DEPARTMENT_COLORS: Readonly<Record<RoomId, { color: string; avatarBg: string }>> =
  Object.freeze({
    management: Object.freeze({ color: '#7C8BC9', avatarBg: '#30374C' }),
    development: Object.freeze({ color: '#5E9E94', avatarBg: '#283C3D' }),
    design: Object.freeze({ color: '#B57F9F', avatarBg: '#403340' }),
    infrastructure: Object.freeze({ color: '#8A9A5B', avatarBg: '#343B2D' }),
    quality: Object.freeze({ color: '#B98B63', avatarBg: '#41372F' }),
    'ai-lab': Object.freeze({ color: '#9583C9', avatarBg: '#37354C' }),
    documentation: Object.freeze({ color: '#7F97A8', avatarBg: '#313A42' }),
    audit: Object.freeze({ color: '#A39580', avatarBg: '#3B3A37' }),
  });

/** UX §1.3: which agent-status color a task status uses. */
export const TASK_STATUS_COLOR_KEY: Readonly<Record<TaskStatus, AgentStatus>> = Object.freeze({
  todo: 'idle',
  assigned: 'planning',
  planning: 'planning',
  in_progress: 'working',
  waiting: 'waiting',
  review: 'reviewing',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'offline',
});

/** UX §1.3 priority colors. */
export const PRIORITY_COLORS: Readonly<Record<TaskPriority, string>> = Object.freeze({
  low: UI_COLORS.textMuted,
  normal: UI_COLORS.textSecondary,
  high: '#E08A4F',
  critical: STATUS_COLORS.failed.color,
});
