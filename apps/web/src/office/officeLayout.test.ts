import { AGENT_REFERENCE, OFFICE_ROOMS, ROOM_IDS } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import {
  ALL_DESKS,
  MIN_ZOOM,
  computeViewport,
  countActiveByRoom,
  lodForZoom,
  resolveDesk,
  textResolution,
  worldRectToScreen,
} from './officeLayout';
import { makeAgent } from './testFixtures';

describe('layout adapter', () => {
  it('exposes the 15 desks of the shared floor plan', () => {
    expect(ALL_DESKS).toHaveLength(15);
    expect(new Set(ALL_DESKS.map((d) => d.deskId)).size).toBe(15);
  });

  it.each(AGENT_REFERENCE.map((a) => [a.id, a.deskId, a.roomId] as const))(
    'resolves the seed desk of %s',
    (_id, deskId, roomId) => {
      const desk = resolveDesk(deskId);
      expect(desk).not.toBeNull();
      expect(desk?.roomId).toBe(roomId);
      const room = OFFICE_ROOMS.find((r) => r.roomId === roomId);
      const source = room?.desks.find((d) => d.deskId === deskId);
      expect(desk?.x).toBe(source?.x);
      expect(desk?.y).toBe(source?.y);
      expect(desk?.width).toBe(116);
      expect(desk?.height).toBe(200);
    },
  );

  it('matches the UX §5.2 slot table (no drift)', () => {
    expect(resolveDesk('management-1')).toMatchObject({ x: 36, y: 56 });
    expect(resolveDesk('development-4')).toMatchObject({ x: 832, y: 56 });
    expect(resolveDesk('audit-1')).toMatchObject({ x: 984, y: 316 });
  });

  it.each(['unknown-1', '', 'management-9', 'MANAGEMENT-1'])(
    'returns null for unknown deskId %j without throwing',
    (deskId) => {
      expect(resolveDesk(deskId)).toBeNull();
    },
  );
});

describe('computeViewport (UX §2.2 zoom-to-fit)', () => {
  it.each([
    // [width, height, zoom, lod]
    [1140, 540, 1, 'full'],
    [1036, 462, 462 / 540, 'full'], // UX §2.3 example (zoom .86)
    [1104, 523, 1104 / 1140, 'full'], // UX §2.4 example (zoom .97, width-bound)
    [2280, 1080, 1.6, 'full'], // capped
    [5000, 5000, 1.6, 'full'],
    [741, 351, 0.65, 'compact'], // 768 tablet (zoom .65 compact)
    [798, 2000, 0.7, 'full'], // exactly the threshold → full
    [547, 260, 547 / 1140, 'compact'],
  ] as const)('%d × %d → zoom %f (%s)', (w, h, zoom, lod) => {
    const v = computeViewport(w, h);
    expect(v.zoom).toBeCloseTo(zoom, 6);
    expect(v.lod).toBe(lod);
    expect(v.width).toBe(w);
    expect(v.height).toBe(h);
  });

  it('never produces zoom 0, NaN or Infinity for an empty host', () => {
    for (const [w, h] of [
      [0, 0],
      [0, 500],
      [-10, 300],
      [Number.NaN, 200],
    ]) {
      const v = computeViewport(w ?? 0, h ?? 0);
      expect(v.zoom).toBe(MIN_ZOOM);
      expect(Number.isFinite(v.zoom)).toBe(true);
      expect(v.lod).toBe('compact');
    }
  });

  it('switches LOD at 0.70', () => {
    expect(lodForZoom(0.6999)).toBe('compact');
    expect(lodForZoom(0.7)).toBe('full');
    expect(lodForZoom(1.6)).toBe('full');
  });
});

describe('worldRectToScreen', () => {
  it('maps a slot to CSS px relative to the canvas with the world centered', () => {
    const v = computeViewport(1140, 540); // zoom 1, no letterbox
    expect(worldRectToScreen({ x: 36, y: 56, width: 116, height: 200 }, v)).toEqual({
      x: 36,
      y: 56,
      width: 116,
      height: 200,
    });
  });

  it('accounts for zoom and letterboxing', () => {
    const v = computeViewport(1140, 1080); // zoom 1 (width-bound), 270 px letterbox top and bottom
    expect(worldRectToScreen({ x: 0, y: 0, width: 116, height: 200 }, v)).toEqual({
      x: 0,
      y: 270,
      width: 116,
      height: 200,
    });
    const half = computeViewport(570, 270); // zoom .5
    expect(worldRectToScreen({ x: 448, y: 56, width: 116, height: 200 }, half)).toEqual({
      x: 224,
      y: 28,
      width: 58,
      height: 100,
    });
  });
});

describe('textResolution (UX §5.1 crisp text)', () => {
  it.each([
    [1, 0.5, 1],
    [1, 1, 1],
    [1, 1.6, 1.5], // 1.6 quantized to .25 steps
    [2, 1, 2],
    [2, 1.6, 3.25],
    [3, 1, 2], // dpr capped at 2
    [1.25, 1, 1.25],
    [0, 1, 1],
    [Number.NaN, 1, 1],
  ])('dpr %f, zoom %f → %f', (dpr, zoom, expected) => {
    expect(textResolution(dpr, zoom)).toBe(expected);
  });
});

describe('countActiveByRoom', () => {
  it('counts planning/working/waiting/reviewing agents per room', () => {
    const agents = [
      makeAgent(3, { status: 'working' }), // BE development
      makeAgent(4, { status: 'planning' }), // FE development
      makeAgent(5, { status: 'completed' }), // DBE development (not active)
      makeAgent(0, { status: 'reviewing' }), // PM management
      makeAgent(8, { status: 'offline' }), // QA quality
      makeAgent(13, { status: 'waiting' }), // REV quality
    ];
    const counts = countActiveByRoom(agents, null);
    expect(counts.development).toBe(2);
    expect(counts.management).toBe(1);
    expect(counts.quality).toBe(1);
    expect(counts.audit).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...ROOM_IDS].sort());
  });

  it('respects the project filter', () => {
    const agents = [
      makeAgent(3, { status: 'working', currentProject: 'sellway' }),
      makeAgent(4, { status: 'working', currentProject: 'erp' }),
      makeAgent(5, { status: 'working', currentProject: null }),
    ];
    expect(countActiveByRoom(agents, 'sellway').development).toBe(1);
    expect(countActiveByRoom(agents, 'ana-market').development).toBe(0);
    expect(countActiveByRoom(agents, null).development).toBe(3);
  });
});
