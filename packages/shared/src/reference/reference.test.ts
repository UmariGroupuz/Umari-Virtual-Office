import { describe, expect, it } from 'vitest';
import {
  AGENT_DISPLAY_ORDER,
  DESK_SLOT,
  OFFICE_ROOMS,
  OFFICE_WORLD,
  OFFICE_ZOOM,
} from '../constants/officeLayout';
import { ROOMS, ROOM_IDS } from '../constants/rooms';
import { AGENT_IDS, AGENT_REFERENCE } from './agents';
import { ALL_PROJECTS_LABEL, PROJECTS, PROJECT_IDS, resolveProjectRef } from './projects';

// API_CONTRACTS §6.1, transcribed: sortOrder | id | code | name | role | shortRole | roomId | department | deskId
const DOC_AGENTS = `
| 1 | 01-pm-orchestrator | PM | PM / Orchestrator | Project Manager / Orchestrator | PM | management | Management | management-1 |
| 2 | 02-product-analyst | PA | Product Analyst | Product Analyst | Analyst | management | Management | management-2 |
| 3 | 03-architect | ARC | Architect | System Architect | Architect | management | Management | management-3 |
| 4 | 04-backend-engineer | BE | Backend Engineer | Senior Backend Engineer | Backend | development | Development | development-1 |
| 5 | 05-frontend-engineer | FE | Frontend Engineer | Senior Frontend Engineer | Frontend | development | Development | development-2 |
| 6 | 06-database-engineer | DBE | Database Engineer | Database Engineer | Database | development | Development | development-3 |
| 7 | 07-devops-engineer | OPS | DevOps Engineer | DevOps Engineer | DevOps | infrastructure | Infrastructure | infrastructure-1 |
| 8 | 08-security-engineer | SEC | Security Engineer | Security Engineer | Security | infrastructure | Infrastructure | infrastructure-2 |
| 9 | 09-qa-engineer | QA | QA Engineer | QA Engineer | QA | quality | Quality | quality-1 |
| 10 | 10-ui-ux-designer | UX | UI/UX Designer | UI/UX Designer | UI/UX | design | Design | design-1 |
| 11 | 11-mobile-engineer | MOB | Mobile Engineer | Mobile Engineer | Mobile | development | Development | development-4 |
| 12 | 12-ai-engineer | AIE | AI Engineer | AI Engineer | AI | ai-lab | AI Lab | ai-lab-1 |
| 13 | 13-documentation-engineer | DOC | Documentation Engineer | Documentation Engineer | Docs | documentation | Documentation | documentation-1 |
| 14 | 14-reviewer | REV | Reviewer | Code Reviewer | Reviewer | quality | Quality | quality-2 |
| 15 | 15-product-auditor | AUD | Product Auditor | Product Auditor | Auditor | audit | Audit | audit-1 |
`
  .trim()
  .split('\n')
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim()),
  );

// API_CONTRACTS §6.4 / UX §5.2: roomId | x | y | width | height | desks
const DOC_ROOMS: [string, number, number, number, number, [number, number][]][] = [
  [
    'management',
    16,
    16,
    412,
    248,
    [
      [36, 56],
      [164, 56],
      [292, 56],
    ],
  ],
  [
    'development',
    440,
    16,
    516,
    248,
    [
      [448, 56],
      [576, 56],
      [704, 56],
      [832, 56],
    ],
  ],
  ['design', 968, 16, 156, 248, [[988, 56]]],
  [
    'infrastructure',
    16,
    276,
    280,
    248,
    [
      [34, 316],
      [162, 316],
    ],
  ],
  [
    'quality',
    308,
    276,
    280,
    248,
    [
      [326, 316],
      [454, 316],
    ],
  ],
  ['ai-lab', 600, 276, 168, 248, [[626, 316]]],
  ['documentation', 780, 276, 168, 248, [[806, 316]]],
  ['audit', 960, 276, 164, 248, [[984, 316]]],
];

describe('AGENT_REFERENCE (§6.1, REQ-001)', () => {
  it('has exactly the 15 rows of the contract table', () => {
    expect(AGENT_REFERENCE).toHaveLength(15);
    expect(
      AGENT_REFERENCE.map((a) => [
        String(a.sortOrder),
        a.id,
        a.code,
        a.name,
        a.role,
        a.shortRole,
        a.roomId,
        a.department,
        a.deskId,
      ]),
    ).toEqual(DOC_AGENTS);
  });

  it('avatar = monogram:<code>', () => {
    for (const a of AGENT_REFERENCE) expect(a.avatar).toBe(`monogram:${a.code}`);
  });

  it('ids, codes and deskIds are unique; codes ≤ 3 chars; shortRole ≤ 12 chars', () => {
    expect(new Set(AGENT_REFERENCE.map((a) => a.id)).size).toBe(15);
    expect(new Set(AGENT_REFERENCE.map((a) => a.code)).size).toBe(15);
    expect(new Set(AGENT_REFERENCE.map((a) => a.deskId)).size).toBe(15);
    for (const a of AGENT_REFERENCE) {
      expect(a.code.length).toBeLessThanOrEqual(3);
      expect(a.shortRole.length).toBeLessThanOrEqual(12);
      expect(a.id.length).toBeLessThanOrEqual(64);
    }
  });

  it('sortOrder is 1–15 in agent-number order and AGENT_IDS follows it', () => {
    expect(AGENT_REFERENCE.map((a) => a.sortOrder)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(AGENT_IDS).toEqual(AGENT_REFERENCE.map((a) => a.id));
    for (const a of AGENT_REFERENCE)
      expect(a.id.startsWith(String(a.sortOrder).padStart(2, '0'))).toBe(true);
  });

  it('department equals the room label; deskId is <roomId>-<n>', () => {
    for (const a of AGENT_REFERENCE) {
      expect(ROOMS.find((r) => r.id === a.roomId)?.label).toBe(a.department);
      expect(a.deskId).toMatch(new RegExp(`^${a.roomId}-\\d+$`));
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(AGENT_REFERENCE)).toBe(true);
    expect(Object.isFrozen(AGENT_REFERENCE[0])).toBe(true);
  });
});

describe('ROOMS (§6.3)', () => {
  it('8 rooms in ROOM_IDS order with the contract labels', () => {
    expect(ROOMS.map((r) => r.id)).toEqual([...ROOM_IDS]);
    expect(ROOMS.map((r) => r.label)).toEqual([
      'Management',
      'Development',
      'Design',
      'Infrastructure',
      'Quality',
      'AI Lab',
      'Documentation',
      'Audit',
    ]);
  });
});

describe('office layout (§6.4, UX §5.2)', () => {
  it('world, slot and zoom constants', () => {
    expect(OFFICE_WORLD).toEqual({ width: 1140, height: 540 });
    expect(DESK_SLOT).toEqual({ width: 116, height: 200 });
    expect(OFFICE_ZOOM).toEqual({ max: 1.6, compactBelow: 0.7 });
  });

  it('rooms and desks equal the contract table exactly', () => {
    expect(
      OFFICE_ROOMS.map((r) => [
        r.roomId,
        r.x,
        r.y,
        r.width,
        r.height,
        r.desks.map((d) => [d.x, d.y]),
      ]),
    ).toEqual(DOC_ROOMS);
    for (const r of OFFICE_ROOMS) {
      expect(r.desks.map((d) => d.deskId)).toEqual(r.desks.map((_, i) => `${r.roomId}-${i + 1}`));
      expect(r.label).toBe(ROOMS.find((room) => room.id === r.roomId)?.label);
    }
  });

  it('every AGENT_REFERENCE.deskId exists exactly once in OFFICE_ROOMS, in the agent’s room', () => {
    const desks = OFFICE_ROOMS.flatMap((r) => r.desks.map((d) => ({ roomId: r.roomId, ...d })));
    expect(desks).toHaveLength(15);
    for (const a of AGENT_REFERENCE) {
      const matches = desks.filter((d) => d.deskId === a.deskId);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.roomId).toBe(a.roomId);
    }
  });

  it('desks lie inside their room rectangle; rooms inside the world; rooms do not overlap', () => {
    for (const r of OFFICE_ROOMS) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(OFFICE_WORLD.width);
      expect(r.y + r.height).toBeLessThanOrEqual(OFFICE_WORLD.height);
      for (const d of r.desks) {
        expect(d.x).toBeGreaterThanOrEqual(r.x);
        expect(d.y).toBeGreaterThanOrEqual(r.y);
        expect(d.x + DESK_SLOT.width).toBeLessThanOrEqual(r.x + r.width);
        expect(d.y + DESK_SLOT.height).toBeLessThanOrEqual(r.y + r.height);
      }
    }
    for (const a of OFFICE_ROOMS) {
      for (const b of OFFICE_ROOMS) {
        if (a === b) continue;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('slots follow the UX §5.2 centering formula (numbers did not drift)', () => {
    for (const r of OFFICE_ROOMS) {
      const n = r.desks.length;
      const startX = r.x + (r.width - (n * DESK_SLOT.width + (n - 1) * 12)) / 2;
      r.desks.forEach((d, i) => {
        expect(d.x).toBe(startX + i * (DESK_SLOT.width + 12));
        expect(d.y).toBe(r.y + 40);
      });
    }
  });

  it('AGENT_DISPLAY_ORDER is the UX §6 reading order and a permutation of AGENT_IDS', () => {
    expect(AGENT_DISPLAY_ORDER.map((id) => id.slice(0, 2))).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '11',
      '10',
      '07',
      '08',
      '09',
      '14',
      '12',
      '13',
      '15',
    ]);
    expect([...AGENT_DISPLAY_ORDER].sort()).toEqual([...AGENT_IDS].sort());
    expect(new Set(AGENT_DISPLAY_ORDER).size).toBe(15);
  });
});

describe('PROJECTS (§6.2) and resolveProjectRef (ADR-006)', () => {
  it('4 projects in sort order with unique ids, names and prefixes', () => {
    expect(PROJECTS.map((p) => [p.sortOrder, p.id, p.name, p.taskPrefix])).toEqual([
      [1, 'sellway', 'Sellway', 'SW'],
      [2, 'ishkun24', 'Ishkun24', 'IK'],
      [3, 'erp', 'ERP', 'ERP'],
      [4, 'ana-market', 'Ana Market', 'AM'],
    ]);
    expect(PROJECT_IDS).toEqual(['sellway', 'ishkun24', 'erp', 'ana-market']);
    expect(ALL_PROJECTS_LABEL).toBe('All Projects');
  });

  it.each([
    ['sellway', 'sellway'],
    ['Sellway', 'sellway'],
    ['SELLWAY', 'sellway'],
    ['  sellway  ', 'sellway'],
    ['ana-market', 'ana-market'],
    ['Ana Market', 'ana-market'],
    ['ana market', 'ana-market'],
    ['ERP', 'erp'],
    ['ishkun24', 'ishkun24'],
  ])('resolves %j → %s', (ref, id) => {
    expect(resolveProjectRef(ref, PROJECTS)?.id).toBe(id);
  });

  it.each(['All Projects', 'all', 'ALL', '', '   ', 'sell way', 'Ana  Market', 'unknown'])(
    '%j does not resolve',
    (ref) => {
      expect(resolveProjectRef(ref, PROJECTS)).toBeNull();
    },
  );

  it('returns the element of the given list (works with DB-loaded projects)', () => {
    const fromDb = [{ id: 'erp', name: 'ERP', taskPrefix: 'ERP' }];
    expect(resolveProjectRef('erp', fromDb)).toBe(fromDb[0]);
    expect(resolveProjectRef('sellway', fromDb)).toBeNull();
  });
});
