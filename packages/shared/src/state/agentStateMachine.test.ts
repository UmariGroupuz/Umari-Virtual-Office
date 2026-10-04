import { describe, expect, it } from 'vitest';
import { ACTIVE_AGENT_STATUSES, AGENT_STATUSES, type AgentStatus } from '../constants/statuses';
import {
  AGENT_TRANSITIONS,
  canTransitionAgent,
  getAllowedAgentTargets,
  isActiveAgentStatus,
} from './agentStateMachine';

// Verbatim copy of the table in docs/AGENT_STATE_MACHINE.md §2.1 (rule tags removed).
// ✔ legal · ✘ illegal · – same status (not a transition).
const DOC_TABLE = `
| from \\ to | idle | planning | working | waiting | reviewing | completed | failed | offline |
| **idle** | – | ✔ | ✔ | ✔ | ✔ | ✘ | ✔ | ✔ |
| **planning** | ✔ | – | ✔ | ✔ | ✘ | ✘ | ✔ | ✔ |
| **working** | ✔ | ✘ | – | ✔ | ✔ | ✔ | ✔ | ✔ |
| **waiting** | ✔ | ✔ | ✔ | – | ✔ | ✘ | ✔ | ✔ |
| **reviewing** | ✔ | ✘ | ✔ | ✔ | – | ✔ | ✔ | ✔ |
| **completed** | ✔ | ✔ | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| **failed** | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | – | ✔ |
| **offline** | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | – |
`;

type Cell = '✔' | '✘' | '–';

function parseTable(markdown: string): { from: AgentStatus; to: AgentStatus; cell: Cell }[] {
  const rows = markdown
    .trim()
    .split('\n')
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim().replaceAll('*', '')),
    );
  const [header, ...body] = rows;
  const targets = (header ?? []).slice(1) as AgentStatus[];
  return body.flatMap((cells) => {
    const from = cells[0] as AgentStatus;
    return targets.map((to, i) => ({ from, to, cell: cells[i + 1] as Cell }));
  });
}

const CELLS = parseTable(DOC_TABLE);

describe('AGENT_TRANSITIONS (ASM §2.1)', () => {
  it('the transcribed doc table covers all 64 cells in enum order', () => {
    expect(CELLS).toHaveLength(64);
    expect([...new Set(CELLS.map((c) => c.from))]).toEqual([...AGENT_STATUSES]);
    expect([...new Set(CELLS.map((c) => c.to))]).toEqual([...AGENT_STATUSES]);
  });

  it.each(CELLS)('$from → $to is $cell', ({ from, to, cell }) => {
    expect(canTransitionAgent(from, to)).toBe(cell === '✔');
    expect(AGENT_TRANSITIONS[from].includes(to)).toBe(cell === '✔');
    if (from === to) expect(cell).toBe('–');
  });

  it('has 43 legal and 13 illegal transitions, and 8 same-status cells', () => {
    const legal = CELLS.filter((c) => canTransitionAgent(c.from, c.to));
    const illegal = CELLS.filter((c) => c.from !== c.to && !canTransitionAgent(c.from, c.to));
    expect(legal).toHaveLength(43);
    expect(illegal).toHaveLength(13);
    expect(CELLS.filter((c) => c.cell === '–')).toHaveLength(8);
    const tableCount = Object.values(AGENT_TRANSITIONS).reduce((n, list) => n + list.length, 0);
    expect(tableCount).toBe(43);
  });

  it('lists the 13 illegal transitions of ASM §2.2', () => {
    const illegal = CELLS.filter((c) => c.from !== c.to && !canTransitionAgent(c.from, c.to)).map(
      (c) => `${c.from}→${c.to}`,
    );
    expect(illegal.sort()).toEqual(
      [
        'idle→completed',
        'planning→reviewing',
        'planning→completed',
        'working→planning',
        'waiting→completed',
        'reviewing→planning',
        'failed→completed',
        'offline→planning',
        'offline→working',
        'offline→waiting',
        'offline→reviewing',
        'offline→completed',
        'offline→failed',
      ].sort(),
    );
  });

  it.each([
    ['idle', 'planning'],
    ['planning', 'working'],
    ['working', 'waiting'],
    ['waiting', 'working'],
    ['working', 'reviewing'],
    ['reviewing', 'completed'],
    ['working', 'failed'],
    ['failed', 'planning'],
    ['completed', 'idle'],
    ['idle', 'working'], // §32 key scenario
  ] as [AgentStatus, AgentStatus][])('owner example %s → %s is legal', (from, to) => {
    expect(canTransitionAgent(from, to)).toBe(true);
  });

  it('REQ-011 examples are illegal', () => {
    expect(canTransitionAgent('idle', 'completed')).toBe(false);
    expect(canTransitionAgent('offline', 'working')).toBe(false);
  });

  it('same status is never a transition', () => {
    for (const s of AGENT_STATUSES) expect(canTransitionAgent(s, s)).toBe(false);
  });

  it('follows rules R1/R2/R6 for every online status', () => {
    for (const s of AGENT_STATUSES) {
      if (s !== 'offline') expect(canTransitionAgent(s, 'offline')).toBe(true); // R1
      if (s !== 'offline' && s !== 'idle') expect(canTransitionAgent(s, 'idle')).toBe(true); // R2
      if (s !== 'offline' && s !== 'failed') expect(canTransitionAgent(s, 'failed')).toBe(true); // R6
    }
    expect(getAllowedAgentTargets('offline')).toEqual(['idle']);
  });

  it('getAllowedAgentTargets returns the table row, in enum order, without the source', () => {
    for (const s of AGENT_STATUSES) {
      const targets = getAllowedAgentTargets(s);
      expect(targets).toBe(AGENT_TRANSITIONS[s]);
      expect(targets).not.toContain(s);
      expect([...targets]).toEqual(AGENT_STATUSES.filter((t) => targets.includes(t)));
    }
  });

  it('is frozen (consumers cannot mutate the shared table)', () => {
    expect(Object.isFrozen(AGENT_TRANSITIONS)).toBe(true);
    for (const s of AGENT_STATUSES) expect(Object.isFrozen(AGENT_TRANSITIONS[s])).toBe(true);
  });

  it('isActiveAgentStatus matches ACTIVE_AGENT_STATUSES', () => {
    for (const s of AGENT_STATUSES) {
      expect(isActiveAgentStatus(s)).toBe((ACTIVE_AGENT_STATUSES as readonly string[]).includes(s));
    }
    expect(AGENT_STATUSES.filter(isActiveAgentStatus)).toEqual([
      'planning',
      'working',
      'waiting',
      'reviewing',
    ]);
  });
});
