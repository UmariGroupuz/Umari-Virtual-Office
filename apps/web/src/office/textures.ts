// Procedural art for the office (REQ-074: everything generated in code, no image/CDN assets). The art is drawn
// as vector `Graphics` commands instead of baked bitmaps so it stays crisp at every camera zoom (0.48–1.6) and
// device pixel ratio; each Graphics object is redrawn only when its state changes, never per frame.
import type * as Phaser from 'phaser';
import { SLOT } from './officeLayout';
import { ART } from './palette';
import type { GlyphKind } from './visuals';

type Graphics = Phaser.GameObjects.Graphics;

const DEG = Math.PI / 180;

/**
 * Draws a status glyph centered on (cx, cy) inside a `size` × `size` box (UX §1.2 canvas glyphs, §5.4 badges).
 * Appends to `g` (callers clear it first when redrawing).
 */
export function drawGlyph(
  g: Graphics,
  kind: GlyphKind,
  cx: number,
  cy: number,
  size: number,
  color: number,
  alpha = 1,
): void {
  const s = size;
  const stroke = Math.max(1.25, s * 0.15);
  const r = s * 0.4;
  g.lineStyle(stroke, color, alpha);
  g.fillStyle(color, alpha);
  switch (kind) {
    case 'circle':
      g.strokeCircle(cx, cy, r);
      return;
    case 'circle-dots':
      g.strokeCircle(cx, cy, r);
      for (const dx of [-0.17, 0, 0.17]) g.fillCircle(cx + dx * s, cy, s * 0.06);
      return;
    case 'pulse':
      polyline(g, cx, cy, s, [
        [-0.48, 0.02],
        [-0.22, 0.02],
        [-0.1, -0.3],
        [0.06, 0.32],
        [0.18, 0.02],
        [0.48, 0.02],
      ]);
      return;
    case 'circle-pause':
      g.strokeCircle(cx, cy, r);
      g.fillRect(cx - s * 0.16, cy - s * 0.17, s * 0.1, s * 0.34);
      g.fillRect(cx + s * 0.06, cy - s * 0.17, s * 0.1, s * 0.34);
      return;
    case 'pause-bars':
      // UX §5.4 waiting badge: two 2 × 8 bars (for a 10-px glyph box).
      g.fillRect(cx - s * 0.3, cy - s * 0.4, s * 0.2, s * 0.8);
      g.fillRect(cx + s * 0.1, cy - s * 0.4, s * 0.2, s * 0.8);
      return;
    case 'magnifier':
      g.strokeCircle(cx - s * 0.08, cy - s * 0.08, s * 0.27);
      polyline(g, cx, cy, s, [
        [0.12, 0.12],
        [0.42, 0.42],
      ]);
      return;
    case 'circle-check':
      g.strokeCircle(cx, cy, r);
      polyline(g, cx, cy, s, [
        [-0.19, 0.01],
        [-0.05, 0.15],
        [0.2, -0.13],
      ]);
      return;
    case 'check':
      polyline(g, cx, cy, s, [
        [-0.34, 0.02],
        [-0.1, 0.26],
        [0.36, -0.24],
      ]);
      return;
    case 'triangle-alert': {
      g.strokeTriangle(
        cx,
        cy - s * 0.42,
        cx + s * 0.46,
        cy + s * 0.38,
        cx - s * 0.46,
        cy + s * 0.38,
      );
      g.fillRect(cx - s * 0.05, cy - s * 0.14, s * 0.1, s * 0.27);
      g.fillCircle(cx, cy + s * 0.24, s * 0.055);
      return;
    }
    case 'power':
      g.beginPath();
      g.arc(cx, cy + s * 0.04, r * 0.95, -55 * DEG, 235 * DEG, false);
      g.strokePath();
      polyline(g, cx, cy, s, [
        [0, -0.46],
        [0, -0.04],
      ]);
      return;
  }
}

function polyline(
  g: Graphics,
  cx: number,
  cy: number,
  s: number,
  points: readonly (readonly [number, number])[],
): void {
  g.beginPath();
  points.forEach(([px, py], i) => {
    const x = cx + px * s;
    const y = cy + py * s;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.strokePath();
}

/** Monitor bezel, stand and base (UX §5.3). The screen itself is drawn per status on top of the bezel. */
export function drawMonitor(g: Graphics): void {
  const { monitor, stand, standBase } = SLOT;
  g.fillStyle(ART.stand, 1);
  g.fillRect(stand.x, stand.y, stand.width, stand.height);
  g.fillRect(standBase.x, standBase.y, standBase.width, standBase.height);
  g.fillStyle(ART.monitorBezel, 1);
  g.fillRoundedRect(monitor.x, monitor.y, monitor.width, monitor.height, monitor.radius);
  g.lineStyle(1, ART.monitorBorder, 1);
  g.strokeRoundedRect(
    monitor.x + 0.5,
    monitor.y + 0.5,
    monitor.width - 1,
    monitor.height - 1,
    monitor.radius,
  );
}

/** Desk top and front edge (UX §5.3). */
export function drawDesk(g: Graphics): void {
  const { deskTop, deskFront } = SLOT;
  g.fillStyle(ART.deskTop, 1);
  g.fillRoundedRect(deskTop.x, deskTop.y, deskTop.width, deskTop.height, deskTop.radius);
  g.fillStyle(ART.deskFront, 1);
  g.fillRect(deskFront.x, deskFront.y, deskFront.width, deskFront.height);
}

/** Chair back, drawn in front of the character so it covers the lower torso (UX §5.3). */
export function drawChair(g: Graphics): void {
  const { chair } = SLOT;
  g.fillStyle(ART.chair, 1);
  g.fillRoundedRect(chair.x, chair.y, chair.width, chair.height, chair.radius);
  g.lineStyle(1, ART.chairStroke, 1);
  g.strokeRoundedRect(
    chair.x + 0.5,
    chair.y + 0.5,
    chair.width - 1,
    chair.height - 1,
    chair.radius,
  );
}

/** Character seen from behind: head + torso (UX §5.3). */
export function drawCharacter(
  g: Graphics,
  torsoColor: number,
  torsoAlpha: number,
  headColor: number,
  headStroke: number,
): void {
  const { head, torso } = SLOT;
  g.fillStyle(torsoColor, torsoAlpha);
  g.fillRoundedRect(torso.x, torso.y, torso.width, torso.height, torso.radius);
  g.fillStyle(headColor, 1);
  g.fillCircle(head.x, head.y, head.radius);
  g.lineStyle(1, headStroke, 1);
  g.strokeCircle(head.x, head.y, head.radius - 0.5);
}
