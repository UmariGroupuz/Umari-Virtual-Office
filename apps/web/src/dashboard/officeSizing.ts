// Office canvas host height (UX §2.2 desktop formula, §2.6 tablet/laptop). Pure and unit-tested.
import { OFFICE_WORLD, OFFICE_ZOOM } from '@vo/shared';
import type { LayoutMode } from '../hooks/useViewport';

export const OFFICE_HEADER_H = 32;
const MIN_CANVAS_H = 220;
const DOCK_H = 200;

export interface OfficeSizingInput {
  mode: LayoutMode;
  /** Width of the canvas host (the office card's inner width). */
  mainWidth: number;
  innerHeight: number;
  simulatorOpen: boolean;
  /** Height of a banner currently shown under the top bar (0 when none). */
  bannerHeight?: number;
}

/**
 * Simulator open: UX §2.2 values (the office is the hero). The dock sits below the office+roster scroll area
 * (OfficePage), so the roster is always reachable by scrolling; when the office is width-limited the roster
 * header shows as a cue below it, but the office is never shrunk for it (PM review round 1).
 */
export function computeCanvasHeight(input: OfficeSizingInput): number {
  const aspectH = (input.mainWidth * OFFICE_WORLD.height) / OFFICE_WORLD.width;
  if (input.mode !== 'desktop' && input.mode !== 'wide' && input.mode !== 'ultra') {
    // Tablet / laptop: full-width card, height = width × 540/1140 (page scrolls).
    return Math.max(MIN_CANVAS_H, Math.round(aspectH));
  }
  const rowH = Math.max(input.innerHeight, 640) - 156 - (input.bannerHeight ?? 0);
  const peek = rowH >= 600 ? 140 : 64;
  const canvasMaxH = input.simulatorOpen
    ? rowH - OFFICE_HEADER_H - 12 - DOCK_H
    : rowH - OFFICE_HEADER_H - peek;
  return Math.round(
    Math.max(MIN_CANVAS_H, Math.min(aspectH, canvasMaxH, OFFICE_WORLD.height * OFFICE_ZOOM.max)),
  );
}

/** Camera zoom the office will use for a host of this size (UX §2.2) — informational for the shell. */
export function officeZoom(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.min(width / OFFICE_WORLD.width, height / OFFICE_WORLD.height, OFFICE_ZOOM.max);
}
