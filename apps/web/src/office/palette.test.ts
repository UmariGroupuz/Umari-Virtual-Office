import { AGENT_STATUSES, DEPARTMENT_COLORS, ROOM_IDS, STATUS_COLORS, UI_COLORS } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import { DEPT, SCREEN, STATUS, UI, hexToNumber, numberToCss } from './palette';

describe('office palette', () => {
  it('converts #RRGGBB to 0xRRGGBB', () => {
    expect(hexToNumber('#0B0D10')).toBe(0x0b0d10);
    expect(hexToNumber('#ffffff')).toBe(0xffffff);
    expect(hexToNumber('#000000')).toBe(0);
    expect(hexToNumber('#5B8DEF')).toBe(0x5b8def);
  });

  it.each(['0B0D10', '#FFF', '#GGGGGG', '#0B0D10 ', '', 'rgb(0,0,0)'])(
    'rejects invalid color %j',
    (value) => {
      expect(() => hexToNumber(value)).toThrow(/Invalid palette color/);
    },
  );

  it('round-trips numbers back to CSS hex', () => {
    expect(numberToCss(0x0b0d10)).toBe('#0b0d10');
    expect(numberToCss(hexToNumber('#E6E8EB'))).toBe('#e6e8eb');
  });

  it('mirrors every shared UI token', () => {
    for (const [key, hex] of Object.entries(UI_COLORS)) {
      expect(UI[key as keyof typeof UI]).toBe(hexToNumber(hex));
    }
  });

  it('has a color and chip tint for every agent status, taken from @vo/shared', () => {
    for (const status of AGENT_STATUSES) {
      expect(STATUS[status].color).toBe(hexToNumber(STATUS_COLORS[status].color));
      expect(STATUS[status].tint).toBe(hexToNumber(STATUS_COLORS[status].chipTint));
      expect(typeof SCREEN[status]).toBe('number');
    }
  });

  it('has a department color for every room', () => {
    for (const roomId of ROOM_IDS) {
      expect(DEPT[roomId]).toBe(hexToNumber(DEPARTMENT_COLORS[roomId].color));
    }
  });

  it('uses the UX §5.4 screen fills', () => {
    expect(SCREEN.idle).toBe(0x161b22);
    expect(SCREEN.working).toBe(0x0f1f16);
    expect(SCREEN.offline).toBe(0x08090b);
  });
});
