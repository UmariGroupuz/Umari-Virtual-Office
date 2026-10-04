// Pure status → visual mapping for one workstation (UX §5.4–§5.6, ADR-012 "visuals.ts"). The Phaser desk object
// only executes what this module decides, so every rule here is unit-tested without a canvas.
import { AGENT_STATUS_LABELS, type AgentStatus } from '@vo/shared';
import type { Lod } from './officeLayout';
import { ART, SCREEN, STATUS, UI } from './palette';

/** Vector glyphs drawn by `textures.ts` (UX §1.2 "Canvas glyph" column + badge glyphs of §5.4). */
export type GlyphKind =
  | 'circle'
  | 'circle-dots'
  | 'pulse'
  | 'circle-pause'
  | 'magnifier'
  | 'circle-check'
  | 'triangle-alert'
  | 'power'
  | 'pause-bars'
  | 'check';

/** Animations the desk may run. Loops live as long as the status; entries play once. */
export type AnimationKey =
  | 'bubbleIn' // planning entry
  | 'thinkingDots' // planning loop
  | 'glowPulse' // working loop
  | 'typing' // working loop
  | 'badgeIn' // waiting entry
  | 'scanLine' // reviewing loop
  | 'completedPop' // completed, live transition only
  | 'failedPulse'; // failed loop

export type PlateKind = 'none' | 'hover' | 'selected';

export interface VisualInput {
  status: AgentStatus;
  /** Agent is not on the selected project (REQ-062). */
  dimmed: boolean;
  selected: boolean;
  hovered: boolean;
  /** A live transition into `completed` was just observed (never true on first render). */
  recentlyCompleted: boolean;
  /** The status was entered live (entry animations play); false on first render and on re-sync of the same status. */
  entering: boolean;
  reducedMotion: boolean;
  lod: Lod;
}

export interface ScreenSpec {
  fill: number;
  barCount: number;
  barColor: number;
  barAlpha: number;
  /** Resting bar widths (px); the typing loop animates them when `typing` runs. */
  barWidths: readonly number[];
  /** Completed screen check glyph (14 px, completed @ 60 %). */
  check: { color: number; alpha: number } | null;
  /** Completed screen tint overlay alpha (settled .08; the pop animates from .25). */
  tintAlpha: number;
  tintColor: number;
}

export interface VisualSpec {
  status: AgentStatus;
  screen: ScreenSpec;
  /** Monitor glow (working). `alpha` = resting alpha (the pulse runs .08 ↔ .22). */
  glow: { color: number; alpha: number } | null;
  /** Status badge at (88, 26) r 9. `scale` = resting scale. */
  badge: { fill: number; glyph: GlyphKind; glyphColor: number; scale: number } | null;
  /** Planning thought bubble; `dotsAlpha` = resting alpha of the 3 dots. */
  bubble: { fill: number; stroke: number; dotsAlpha: number } | null;
  /** Reviewing scan line; resting position = middle of the screen. */
  scanLine: { color: number; alpha: number } | null;
  /** Resting 1-px slot outline (failed only; completed's outline is part of the pop animation). */
  outline: { color: number; alpha: number } | null;
  character: { torso: 'department' | number; torsoAlpha: number; head: number; headStroke: number };
  /** Workstation container alpha: 1 · dimmed .40 · offline .35 · offline + dimmed .25. */
  alpha: number;
  plate: PlateKind;
  chip: { lod: Lod; label: string; color: number; tint: number; glyph: GlyphKind };
  animations: readonly AnimationKey[];
}

/** Chip / legend glyph per status (UX §1.2). */
export const STATUS_GLYPH: Readonly<Record<AgentStatus, GlyphKind>> = Object.freeze({
  idle: 'circle',
  planning: 'circle-dots',
  working: 'pulse',
  waiting: 'circle-pause',
  reviewing: 'magnifier',
  completed: 'circle-check',
  failed: 'triangle-alert',
  offline: 'power',
});

/** Badge glyph per status (UX §5.4 "Indicator / badge"); statuses without a badge are absent. */
const BADGE_GLYPH: Partial<Readonly<Record<AgentStatus, GlyphKind>>> = Object.freeze({
  waiting: 'pause-bars',
  reviewing: 'magnifier',
  completed: 'check',
  failed: 'triangle-alert',
});

export const ALPHA = Object.freeze({ normal: 1, dimmed: 0.4, offline: 0.35, offlineDimmed: 0.25 });
export const GLOW_ALPHA = Object.freeze({ min: 0.08, max: 0.22, reduced: 0.18 });
export const COMPLETED_BADGE = Object.freeze({ pop: 1.15, settled: 0.85 });
export const COMPLETED_TINT = Object.freeze({ from: 0.25, settled: 0.08 });
/** Static typing widths for reduced motion (UX §5.4). */
export const WORKING_STATIC_WIDTHS: readonly number[] = Object.freeze([44, 30, 38]);

const BAR_WIDTHS: Readonly<Record<AgentStatus, readonly number[]>> = Object.freeze({
  idle: [34, 22],
  planning: [40, 24],
  working: WORKING_STATIC_WIDTHS,
  waiting: [36, 20],
  reviewing: [46, 38, 30],
  completed: [],
  failed: [38, 24],
  offline: [],
});

function screenSpec(status: AgentStatus): ScreenSpec {
  const color = STATUS[status].color;
  const base = {
    fill: SCREEN[status],
    barWidths: BAR_WIDTHS[status],
    barCount: BAR_WIDTHS[status].length,
    check: null,
    tintAlpha: 0,
    tintColor: STATUS.completed.color,
  };
  switch (status) {
    case 'idle':
      return { ...base, barColor: ART.idleBar, barAlpha: 1 };
    case 'planning':
      return { ...base, barColor: color, barAlpha: 0.35 };
    case 'working':
      return { ...base, barColor: color, barAlpha: 0.85 };
    case 'waiting':
      return { ...base, barColor: color, barAlpha: 0.3 };
    case 'reviewing':
      return { ...base, barColor: color, barAlpha: 0.35 };
    case 'completed':
      return {
        ...base,
        barColor: color,
        barAlpha: 0,
        check: { color, alpha: 0.6 },
        tintAlpha: COMPLETED_TINT.settled,
      };
    case 'failed':
      return { ...base, barColor: color, barAlpha: 0.6 };
    case 'offline':
      return { ...base, barColor: color, barAlpha: 0 };
  }
}

export function containerAlpha(status: AgentStatus, dimmed: boolean): number {
  if (status === 'offline') return dimmed ? ALPHA.offlineDimmed : ALPHA.offline;
  return dimmed ? ALPHA.dimmed : ALPHA.normal;
}

export function plateKind(selected: boolean, hovered: boolean): PlateKind {
  if (selected) return 'selected';
  return hovered ? 'hover' : 'none';
}

function animationsFor(input: VisualInput): AnimationKey[] {
  if (input.reducedMotion) return [];
  switch (input.status) {
    case 'planning':
      return input.entering ? ['bubbleIn', 'thinkingDots'] : ['thinkingDots'];
    case 'working':
      return ['glowPulse', 'typing'];
    case 'waiting':
      return input.entering ? ['badgeIn'] : [];
    case 'reviewing':
      return ['scanLine'];
    case 'completed':
      return input.recentlyCompleted ? ['completedPop'] : [];
    case 'failed':
      return ['failedPulse'];
    case 'idle':
    case 'offline':
      return [];
  }
}

export function getVisualSpec(input: VisualInput): VisualSpec {
  const { status } = input;
  const color = STATUS[status].color;
  const badgeGlyph = BADGE_GLYPH[status];
  const offline = status === 'offline';
  return {
    status,
    screen: screenSpec(status),
    glow:
      status === 'working'
        ? { color, alpha: input.reducedMotion ? GLOW_ALPHA.reduced : GLOW_ALPHA.min }
        : null,
    badge: badgeGlyph
      ? {
          fill: color,
          glyph: badgeGlyph,
          glyphColor: ART.badgeGlyph,
          scale: status === 'completed' ? COMPLETED_BADGE.settled : 1,
        }
      : null,
    bubble: status === 'planning' ? { fill: UI.raisedHover, stroke: color, dotsAlpha: 1 } : null,
    scanLine: status === 'reviewing' ? { color, alpha: 0.7 } : null,
    outline: status === 'failed' ? { color, alpha: 0.5 } : null,
    character: {
      torso: offline ? ART.offlineTorso : 'department',
      torsoAlpha: offline ? 1 : 0.9,
      head: offline ? ART.offlineHead : ART.head,
      headStroke: ART.headStroke,
    },
    alpha: containerAlpha(status, input.dimmed),
    plate: plateKind(input.selected, input.hovered),
    chip: {
      lod: input.lod,
      label: AGENT_STATUS_LABELS[status],
      color,
      tint: STATUS[status].tint,
      glyph: STATUS_GLYPH[status],
    },
    animations: animationsFor(input),
  };
}

/** Name label rule of UX §5.3: max 12 characters, ellipsized beyond. */
export function ellipsize(text: string, max = 12): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max - 1).join('')}…`;
}

/** REQ-062: an agent is dimmed when a project is selected and the agent is not on it. */
export function isDimmed(currentProject: string | null, projectFilter: string | null): boolean {
  return projectFilter !== null && currentProject !== projectFilter;
}
