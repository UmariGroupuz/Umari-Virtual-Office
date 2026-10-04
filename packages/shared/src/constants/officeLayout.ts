// Office floor plan (API_CONTRACTS §6.4, copied from UX §5.2 — canonical; numbers must not drift).
import type { RoomId } from './rooms';

export const OFFICE_WORLD = { width: 1140, height: 540 } as const;
export const DESK_SLOT = { width: 116, height: 200 } as const;
/** UX §2.2 / §5.5: maximum camera zoom; below `compactBelow` the canvas uses the compact LOD. */
export const OFFICE_ZOOM = { max: 1.6, compactBelow: 0.7 } as const;

/** Slot top-left corner in world px. */
export interface OfficeDesk {
  deskId: string;
  x: number;
  y: number;
}
export interface OfficeRoom {
  roomId: RoomId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  desks: readonly OfficeDesk[];
}

function room(
  roomId: RoomId,
  label: string,
  rect: [x: number, y: number, width: number, height: number],
  desks: readonly [x: number, y: number][],
): OfficeRoom {
  const [x, y, width, height] = rect;
  return Object.freeze({
    roomId,
    label,
    x,
    y,
    width,
    height,
    desks: Object.freeze(
      desks.map(([dx, dy], i) => Object.freeze({ deskId: `${roomId}-${i + 1}`, x: dx, y: dy })),
    ),
  });
}

export const OFFICE_ROOMS: readonly OfficeRoom[] = Object.freeze([
  room(
    'management',
    'Management',
    [16, 16, 412, 248],
    [
      [36, 56],
      [164, 56],
      [292, 56],
    ],
  ),
  room(
    'development',
    'Development',
    [440, 16, 516, 248],
    [
      [448, 56],
      [576, 56],
      [704, 56],
      [832, 56],
    ],
  ),
  room('design', 'Design', [968, 16, 156, 248], [[988, 56]]),
  room(
    'infrastructure',
    'Infrastructure',
    [16, 276, 280, 248],
    [
      [34, 316],
      [162, 316],
    ],
  ),
  room(
    'quality',
    'Quality',
    [308, 276, 280, 248],
    [
      [326, 316],
      [454, 316],
    ],
  ),
  room('ai-lab', 'AI Lab', [600, 276, 168, 248], [[626, 316]]),
  room('documentation', 'Documentation', [780, 276, 168, 248], [[806, 316]]),
  room('audit', 'Audit', [960, 276, 164, 248], [[984, 316]]),
]);

/** Office reading order (UX §6), used by the roster: 01,02,03,04,05,06,11,10,07,08,09,14,12,13,15. */
export const AGENT_DISPLAY_ORDER: readonly string[] = Object.freeze([
  '01-pm-orchestrator',
  '02-product-analyst',
  '03-architect',
  '04-backend-engineer',
  '05-frontend-engineer',
  '06-database-engineer',
  '11-mobile-engineer',
  '10-ui-ux-designer',
  '07-devops-engineer',
  '08-security-engineer',
  '09-qa-engineer',
  '14-reviewer',
  '12-ai-engineer',
  '13-documentation-engineer',
  '15-product-auditor',
]);
