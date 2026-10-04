import { AGENT_STATUSES, AGENT_STATUS_LABELS, type AgentStatus } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import type { Lod } from './officeLayout';
import { ART, SCREEN, STATUS, UI } from './palette';
import {
  ALPHA,
  COMPLETED_BADGE,
  GLOW_ALPHA,
  STATUS_GLYPH,
  WORKING_STATIC_WIDTHS,
  containerAlpha,
  ellipsize,
  getVisualSpec,
  isDimmed,
  type VisualInput,
} from './visuals';

function input(status: AgentStatus, overrides: Partial<VisualInput> = {}): VisualInput {
  return {
    status,
    dimmed: false,
    selected: false,
    hovered: false,
    recentlyCompleted: false,
    entering: false,
    reducedMotion: false,
    lod: 'full',
    ...overrides,
  };
}

const BOOLS = [false, true] as const;
const LODS: readonly Lod[] = ['full', 'compact'];

/** Every status × {dimmed, selected, recentlyCompleted, reducedMotion, lod} (+ hovered, entering). */
const MATRIX: VisualInput[] = AGENT_STATUSES.flatMap((status) =>
  BOOLS.flatMap((dimmed) =>
    BOOLS.flatMap((selected) =>
      BOOLS.flatMap((recentlyCompleted) =>
        BOOLS.flatMap((reducedMotion) =>
          LODS.flatMap((lod) =>
            BOOLS.flatMap((hovered) =>
              BOOLS.map((entering) =>
                input(status, {
                  dimmed,
                  selected,
                  recentlyCompleted,
                  reducedMotion,
                  lod,
                  hovered,
                  entering,
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

describe('getVisualSpec — invariants over the full matrix', () => {
  it(`covers ${AGENT_STATUSES.length} statuses × 128 flag combinations`, () => {
    expect(MATRIX).toHaveLength(AGENT_STATUSES.length * 128);
  });

  it.each(MATRIX.map((m) => [m.status, JSON.stringify(m), m] as const))(
    '%s %s',
    (_status, _label, m) => {
      const spec = getVisualSpec(m);
      expect(spec.status).toBe(m.status);

      // Chip: label + glyph + status colors (never color alone, NFR-006).
      expect(spec.chip.label).toBe(AGENT_STATUS_LABELS[m.status]);
      expect(spec.chip.glyph).toBe(STATUS_GLYPH[m.status]);
      expect(spec.chip.color).toBe(STATUS[m.status].color);
      expect(spec.chip.tint).toBe(STATUS[m.status].tint);
      expect(spec.chip.lod).toBe(m.lod);

      // Screen fill per status.
      expect(spec.screen.fill).toBe(SCREEN[m.status]);

      // Alpha: dimming .40, offline .35, offline + dimmed .25 — selection/hover never change it.
      expect(spec.alpha).toBe(containerAlpha(m.status, m.dimmed));

      // Plate: selected overrides hover.
      expect(spec.plate).toBe(m.selected ? 'selected' : m.hovered ? 'hover' : 'none');

      // Reduced motion: no tweens at all.
      if (m.reducedMotion) expect(spec.animations).toEqual([]);

      // Success emphasis only for a live transition into completed, never under reduced motion.
      expect(spec.animations.includes('completedPop')).toBe(
        m.status === 'completed' && m.recentlyCompleted && !m.reducedMotion,
      );

      // Entry animations only when entering live.
      if (!m.entering) {
        expect(spec.animations).not.toContain('bubbleIn');
        expect(spec.animations).not.toContain('badgeIn');
      }
    },
  );
});

describe('getVisualSpec — per status (UX §5.4)', () => {
  it('idle: two static bars, nothing else', () => {
    const spec = getVisualSpec(input('idle'));
    expect(spec.screen.barCount).toBe(2);
    expect(spec.screen.barColor).toBe(ART.idleBar);
    expect(spec.glow).toBeNull();
    expect(spec.badge).toBeNull();
    expect(spec.bubble).toBeNull();
    expect(spec.animations).toEqual([]);
    expect(spec.character.torso).toBe('department');
    expect(spec.character.torsoAlpha).toBe(0.9);
  });

  it('planning: thought bubble with pulsing dots; static dots under reduced motion', () => {
    expect(getVisualSpec(input('planning', { entering: true })).animations).toEqual([
      'bubbleIn',
      'thinkingDots',
    ]);
    expect(getVisualSpec(input('planning')).animations).toEqual(['thinkingDots']);
    const reduced = getVisualSpec(input('planning', { reducedMotion: true, entering: true }));
    expect(reduced.bubble).toEqual({
      fill: UI.raisedHover,
      stroke: STATUS.planning.color,
      dotsAlpha: 1,
    });
    expect(reduced.animations).toEqual([]);
    expect(reduced.screen.barAlpha).toBe(0.35);
  });

  it('working: monitor glow + typing; static glow .18 and widths 44/30/38 under reduced motion', () => {
    const spec = getVisualSpec(input('working'));
    expect(spec.glow).toEqual({ color: STATUS.working.color, alpha: GLOW_ALPHA.min });
    expect(spec.animations).toEqual(['glowPulse', 'typing']);
    expect(spec.screen.barCount).toBe(3);
    expect(spec.screen.barAlpha).toBe(0.85);
    expect(spec.badge).toBeNull(); // chip only
    const reduced = getVisualSpec(input('working', { reducedMotion: true }));
    expect(reduced.glow?.alpha).toBe(0.18);
    expect(reduced.screen.barWidths).toEqual(WORKING_STATIC_WIDTHS);
    expect(WORKING_STATIC_WIDTHS).toEqual([44, 30, 38]);
  });

  it('waiting: amber pause badge, scale-in only when entering, no loop', () => {
    const spec = getVisualSpec(input('waiting', { entering: true }));
    expect(spec.badge).toEqual({
      fill: STATUS.waiting.color,
      glyph: 'pause-bars',
      glyphColor: ART.badgeGlyph,
      scale: 1,
    });
    expect(spec.animations).toEqual(['badgeIn']);
    expect(getVisualSpec(input('waiting')).animations).toEqual([]);
    expect(
      getVisualSpec(input('waiting', { entering: true, reducedMotion: true })).animations,
    ).toEqual([]);
  });

  it('reviewing: purple magnifier badge + scan line loop', () => {
    const spec = getVisualSpec(input('reviewing'));
    expect(spec.badge?.glyph).toBe('magnifier');
    expect(spec.badge?.fill).toBe(STATUS.reviewing.color);
    expect(spec.scanLine).toEqual({ color: STATUS.reviewing.color, alpha: 0.7 });
    expect(spec.animations).toEqual(['scanLine']);
    expect(spec.screen.barCount).toBe(3);
  });

  it('completed: settled state on first render, pop only on a live transition', () => {
    const settled = getVisualSpec(input('completed'));
    expect(settled.badge?.glyph).toBe('check');
    expect(settled.badge?.scale).toBe(COMPLETED_BADGE.settled);
    expect(settled.screen.check).toEqual({ color: STATUS.completed.color, alpha: 0.6 });
    expect(settled.screen.tintAlpha).toBe(0.08);
    expect(settled.screen.barCount).toBe(0);
    expect(settled.outline).toBeNull();
    expect(settled.animations).toEqual([]);
    expect(getVisualSpec(input('completed', { recentlyCompleted: true })).animations).toEqual([
      'completedPop',
    ]);
  });

  it('failed: red alert badge pulsing, static 50 % outline', () => {
    const spec = getVisualSpec(input('failed'));
    expect(spec.badge?.glyph).toBe('triangle-alert');
    expect(spec.badge?.fill).toBe(STATUS.failed.color);
    expect(spec.outline).toEqual({ color: STATUS.failed.color, alpha: 0.5 });
    expect(spec.animations).toEqual(['failedPulse']);
    expect(getVisualSpec(input('failed', { reducedMotion: true })).animations).toEqual([]);
  });

  it('offline: monitor off, gray character, faded workstation', () => {
    const spec = getVisualSpec(input('offline'));
    expect(spec.screen.fill).toBe(0x08090b);
    expect(spec.screen.barCount).toBe(0);
    expect(spec.glow).toBeNull();
    expect(spec.badge).toBeNull();
    expect(spec.character).toEqual({
      torso: ART.offlineTorso,
      torsoAlpha: 1,
      head: ART.offlineHead,
      headStroke: ART.headStroke,
    });
    expect(spec.alpha).toBe(0.35);
    expect(getVisualSpec(input('offline', { dimmed: true })).alpha).toBe(0.25);
  });

  it('only one status has each badge glyph and every status has a distinct chip glyph', () => {
    expect(new Set(Object.values(STATUS_GLYPH)).size).toBe(AGENT_STATUSES.length);
  });
});

describe('containerAlpha / isDimmed / ellipsize', () => {
  it('applies REQ-062 dimming values', () => {
    expect(containerAlpha('working', false)).toBe(ALPHA.normal);
    expect(containerAlpha('working', true)).toBe(0.4);
    expect(containerAlpha('offline', false)).toBe(0.35);
    expect(containerAlpha('offline', true)).toBe(0.25);
  });

  it('dims only when a project is selected and the agent is not on it', () => {
    expect(isDimmed('sellway', null)).toBe(false);
    expect(isDimmed(null, null)).toBe(false);
    expect(isDimmed('sellway', 'sellway')).toBe(false);
    expect(isDimmed('erp', 'sellway')).toBe(true);
    expect(isDimmed(null, 'sellway')).toBe(true);
  });

  it('ellipsizes name labels beyond 12 characters', () => {
    expect(ellipsize('Backend')).toBe('Backend');
    expect(ellipsize('Twelve Chars')).toBe('Twelve Chars');
    expect(ellipsize('Thirteen Char')).toBe('Thirteen Ch…');
    expect(ellipsize('  Docs  ')).toBe('Docs');
    expect(ellipsize('<img src=x>')).toBe('<img src=x>'); // plain text, never markup
  });
});
