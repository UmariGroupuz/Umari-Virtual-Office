// Thin adapter over the canonical floor plan in `@vo/shared` (OFFICE_ROOMS, UX §5.2 / API-C §6.4) plus the pure
// viewport math of UX §2.2/§5.1. No numbers are copied here except the slot-local drawing anchors that belong
// to the workstation art. Pure module: no Phaser import (unit-tested in jsdom).
import {
  ACTIVE_AGENT_STATUSES,
  DESK_SLOT,
  OFFICE_ROOMS,
  OFFICE_WORLD,
  OFFICE_ZOOM,
  ROOM_IDS,
  agentMatchesProject,
  type Agent,
  type AgentStatus,
  type OfficeRoom,
  type RoomId,
} from '@vo/shared';

export type Lod = 'full' | 'compact';

/** A desk slot resolved from the floor plan, with its room. */
export interface ResolvedDesk {
  deskId: string;
  roomId: RoomId;
  /** Slot top-left corner in world px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const DESKS: ReadonlyMap<string, ResolvedDesk> = new Map(
  OFFICE_ROOMS.flatMap((room) =>
    room.desks.map(
      (desk) =>
        [
          desk.deskId,
          Object.freeze({
            deskId: desk.deskId,
            roomId: room.roomId,
            x: desk.x,
            y: desk.y,
            width: DESK_SLOT.width,
            height: DESK_SLOT.height,
          }),
        ] as const,
    ),
  ),
);

/** Every desk of the floor plan (15 in Phase 1), in room order. */
export const ALL_DESKS: readonly ResolvedDesk[] = Object.freeze([...DESKS.values()]);

export const ROOMS: readonly OfficeRoom[] = OFFICE_ROOMS;

/** Resolves a `deskId` to its slot; `null` for an unknown id (the agent is then not drawn — never a crash). */
export function resolveDesk(deskId: string): ResolvedDesk | null {
  return DESKS.get(deskId) ?? null;
}

export const WORLD = OFFICE_WORLD;
export const WORLD_CENTER = Object.freeze({
  x: OFFICE_WORLD.width / 2,
  y: OFFICE_WORLD.height / 2,
});

/** Camera state derived from the canvas size (CSS px = game px with `Scale.RESIZE`). */
export interface Viewport {
  width: number;
  height: number;
  zoom: number;
  lod: Lod;
}

/** Smallest zoom we ever apply (a 0-px host during layout must not produce zoom 0 / Infinity). */
export const MIN_ZOOM = 0.05;

/** UX §2.2: `zoom = min(w / 1140, h / 540, 1.6)`; LOD compact below 0.70. */
export function computeViewport(width: number, height: number): Viewport {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const raw = Math.min(w / OFFICE_WORLD.width, h / OFFICE_WORLD.height, OFFICE_ZOOM.max);
  const zoom = Math.max(MIN_ZOOM, raw);
  return { width: w, height: h, zoom, lod: lodForZoom(zoom) };
}

export function lodForZoom(zoom: number): Lod {
  return zoom < OFFICE_ZOOM.compactBelow ? 'compact' : 'full';
}

/** Screen rect (CSS px relative to the canvas/root top-left) of a world rect, camera centered on the world. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function worldRectToScreen(
  rect: { x: number; y: number; width: number; height: number },
  viewport: Viewport,
): ScreenRect {
  const x = (rect.x - WORLD_CENTER.x) * viewport.zoom + viewport.width / 2;
  const y = (rect.y - WORLD_CENTER.y) * viewport.zoom + viewport.height / 2;
  return {
    x: round2(x),
    y: round2(y),
    width: round2(rect.width * viewport.zoom),
    height: round2(rect.height * viewport.zoom),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * UX §5.1: `Text.setResolution(min(2, dpr) × max(1, zoom))`, quantized to 0.25 so a continuous resize does not
 * re-render every label on every frame.
 */
export function textResolution(devicePixelRatio: number, zoom: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const value = Math.min(2, dpr) * Math.max(1, zoom);
  return Math.max(1, Math.round(value * 4) / 4);
}

const ACTIVE: ReadonlySet<AgentStatus> = new Set(ACTIVE_AGENT_STATUSES);

/** UX §5.2 "N active": agents in planning/working/waiting/reviewing per room, respecting the project filter. */
export function countActiveByRoom(
  agents: readonly Pick<Agent, 'roomId' | 'status' | 'currentProject'>[],
  projectFilter: string | null,
): Record<RoomId, number> {
  const counts = Object.fromEntries(ROOM_IDS.map((id) => [id, 0])) as Record<RoomId, number>;
  for (const agent of agents) {
    if (!ACTIVE.has(agent.status)) continue;
    if (!agentMatchesProject(agent, projectFilter)) continue;
    if (agent.roomId in counts) counts[agent.roomId] += 1;
  }
  return counts;
}

/** Slot-local anchors of the workstation drawing (UX §5.3, slot 116 × 200). */
export const SLOT = Object.freeze({
  width: DESK_SLOT.width,
  height: DESK_SLOT.height,
  centerX: DESK_SLOT.width / 2,
  monitor: { x: 24, y: 26, width: 68, height: 46, radius: 3 },
  screen: { x: 27, y: 29, width: 62, height: 40 },
  stand: { x: 54, y: 72, width: 8, height: 8 },
  standBase: { x: 46, y: 79, width: 24, height: 3 },
  deskTop: { x: 8, y: 82, width: 100, height: 18, radius: 3 },
  deskFront: { x: 8, y: 100, width: 100, height: 4 },
  head: { x: 58, y: 98, radius: 11 },
  torso: { x: 38, y: 106, width: 40, height: 24, radius: 6 },
  chair: { x: 35, y: 118, width: 46, height: 28, radius: 6 },
  badge: { x: 88, y: 26, radius: 9 },
  bubble: { x: 84, y: 92, width: 30, height: 18, radius: 9 },
  nameY: 158,
  chipY: 188,
});
