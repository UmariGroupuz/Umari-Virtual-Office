// ADR-025: the Tailwind @theme repeats the @vo/shared palette (CSS cannot import TS) — they must match.
import { describe, expect, it } from 'vitest';
import {
  AGENT_STATUSES,
  DEPARTMENT_COLORS,
  PRIORITY_COLORS,
  ROOM_IDS,
  STATUS_COLORS,
  UI_COLORS,
} from '@vo/shared';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest stubs CSS imports (even `?raw`), so the stylesheet is read from disk.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

function token(name: string): string | undefined {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  return match?.[1]?.toUpperCase();
}

const UI_TOKEN: Record<keyof typeof UI_COLORS, string> = {
  bg: 'bg',
  bgSunken: 'bg-sunken',
  panel: 'panel',
  raised: 'raised',
  raisedHover: 'raised-hover',
  borderSubtle: 'border-subtle',
  borderStrong: 'border-strong',
  textPrimary: 'text-primary',
  textSecondary: 'text-secondary',
  textMuted: 'text-muted',
  accent: 'accent',
  accentText: 'accent-text',
  accentStrong: 'accent-strong',
  accentTint: 'accent-tint',
  roomFloor: 'room-floor',
};

describe('palette CSS ↔ @vo/shared', () => {
  it('UI colors', () => {
    for (const [key, name] of Object.entries(UI_TOKEN)) {
      expect(token(name), name).toBe(UI_COLORS[key as keyof typeof UI_COLORS].toUpperCase());
    }
  });

  it('status colors and chip tints', () => {
    for (const status of AGENT_STATUSES) {
      expect(token(`st-${status}`), status).toBe(STATUS_COLORS[status].color.toUpperCase());
      expect(token(`st-${status}-tint`), status).toBe(STATUS_COLORS[status].chipTint.toUpperCase());
    }
  });

  it('department colors and avatar backgrounds', () => {
    for (const room of ROOM_IDS) {
      expect(token(`dept-${room}`), room).toBe(DEPARTMENT_COLORS[room].color.toUpperCase());
      expect(token(`dept-${room}-bg`), room).toBe(DEPARTMENT_COLORS[room].avatarBg.toUpperCase());
    }
  });

  it('priority high color', () => {
    expect(token('prio-high')).toBe(PRIORITY_COLORS.high.toUpperCase());
  });
});
