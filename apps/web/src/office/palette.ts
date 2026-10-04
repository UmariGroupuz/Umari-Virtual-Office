// Phaser colors for the office (UX §1, §5.2–§5.4). Token colors come from the `@vo/shared` palette (single
// source, ADR-025) and are only converted to `0xRRGGBB` numbers here. The few workstation art colors that the
// UX spec defines only for the canvas (§5.3/§5.4: bezel, desk, chair, screens…) live in `ART`/`SCREEN` below.
// Pure module: no Phaser import (unit-tested in jsdom).
import {
  AGENT_STATUSES,
  DEPARTMENT_COLORS,
  ROOM_IDS,
  STATUS_COLORS,
  UI_COLORS,
  type AgentStatus,
  type RoomId,
} from '@vo/shared';

const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

/** `'#RRGGBB'` → `0xRRGGBB`. Throws on anything else (palette values are static, so a bad one is a bug). */
export function hexToNumber(hex: string): number {
  const match = HEX_PATTERN.exec(hex);
  if (!match?.[1]) throw new Error(`Invalid palette color "${hex}" (expected #RRGGBB)`);
  return Number.parseInt(match[1], 16);
}

type UiColorKey = keyof typeof UI_COLORS;

/** UX §1.1 surfaces/borders/text/accent as numbers. */
export const UI = Object.freeze(
  Object.fromEntries(
    (Object.keys(UI_COLORS) as UiColorKey[]).map((key) => [key, hexToNumber(UI_COLORS[key])]),
  ) as Record<UiColorKey, number>,
);

/** UX §1.2 status color + chip tint as numbers. */
export const STATUS: Readonly<Record<AgentStatus, { color: number; tint: number }>> = Object.freeze(
  Object.fromEntries(
    AGENT_STATUSES.map((status) => [
      status,
      Object.freeze({
        color: hexToNumber(STATUS_COLORS[status].color),
        tint: hexToNumber(STATUS_COLORS[status].chipTint),
      }),
    ]),
  ) as Record<AgentStatus, { color: number; tint: number }>,
);

/** UX §1.4 department identity colors (room header bar, character torso). */
export const DEPT: Readonly<Record<RoomId, number>> = Object.freeze(
  Object.fromEntries(
    ROOM_IDS.map((roomId) => [roomId, hexToNumber(DEPARTMENT_COLORS[roomId].color)]),
  ) as Record<RoomId, number>,
);

/** Workstation art colors (UX §5.3, §5.4 offline row). Canvas-only values not present in the UI tokens. */
export const ART = Object.freeze({
  monitorBezel: 0x1f232a,
  monitorBorder: UI.borderStrong,
  stand: 0x2a2f37,
  deskTop: 0x2a2f37,
  deskFront: 0x20242b,
  head: 0x3a3f48,
  headStroke: 0x4a505a,
  chair: 0x1c2026,
  chairStroke: 0x2a2f37,
  offlineTorso: 0x3a3f47,
  offlineHead: 0x2a2e35,
  /** Dark glyphs on status badges (`#0B0D10` = `--bg`). */
  badgeGlyph: UI.bg,
  /** Idle screen bars (UX §5.4). */
  idleBar: 0x2a313b,
  white: 0xffffff,
});

/** Screen fill per status (UX §5.4 "Screen" column). */
export const SCREEN: Readonly<Record<AgentStatus, number>> = Object.freeze({
  idle: 0x161b22,
  planning: 0x121c24,
  working: 0x0f1f16,
  waiting: 0x1f1a0f,
  reviewing: 0x1a1526,
  completed: 0x10201a,
  failed: 0x2a1214,
  offline: 0x08090b,
});

/** Font stack of UX §1.5 (Inter is loaded by the shell; canvas text refreshes once it is ready). */
export const FONT_FAMILY = '"Inter Variable", system-ui, sans-serif';

/** `0xRRGGBB` → `'#RRGGBB'` for Phaser text styles. */
export function numberToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
