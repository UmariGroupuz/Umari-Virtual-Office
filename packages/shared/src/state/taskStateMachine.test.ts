import { describe, expect, it } from 'vitest';
import { TASK_STATUSES, type TaskStatus } from '../constants/statuses';
import {
  TASK_TRANSITIONS,
  canTransitionTask,
  isActiveTaskStatus,
  isTerminalTaskStatus,
} from './taskStateMachine';

// Verbatim copy of docs/AGENT_STATE_MACHINE.md §5.2 ("from | legal targets"; annotations removed).
const DOC_TABLE: Record<TaskStatus, string> = {
  todo: 'assigned, planning, in_progress, cancelled',
  assigned: 'todo, planning, in_progress, waiting, review, failed, cancelled',
  planning: 'in_progress, waiting, failed, cancelled',
  in_progress: 'waiting, review, completed, failed, cancelled',
  waiting: 'planning, in_progress, review, failed, cancelled',
  review: 'in_progress, waiting, completed, failed, cancelled',
  failed: 'assigned, planning, in_progress, waiting, review, cancelled',
  completed: '',
  cancelled: '',
};

const docTargets = (from: TaskStatus): TaskStatus[] =>
  DOC_TABLE[from] === '' ? [] : (DOC_TABLE[from].split(', ') as TaskStatus[]);

const CELLS = TASK_STATUSES.flatMap((from) =>
  TASK_STATUSES.map((to) => ({ from, to, legal: docTargets(from).includes(to) })),
);

describe('TASK_TRANSITIONS (ASM §5.2)', () => {
  it('covers all 81 cells', () => {
    expect(CELLS).toHaveLength(81);
  });

  it.each(CELLS)('$from → $to legal=$legal', ({ from, to, legal }) => {
    expect(canTransitionTask(from, to)).toBe(legal);
    expect(canTransitionTask(from, to, { owned: false })).toBe(legal);
    expect(TASK_TRANSITIONS[from].includes(to)).toBe(legal);
  });

  it('has 36 legal transitions and a false diagonal', () => {
    expect(CELLS.filter((c) => c.legal)).toHaveLength(36);
    for (const s of TASK_STATUSES) {
      expect(canTransitionTask(s, s)).toBe(false);
      expect(canTransitionTask(s, s, { owned: true })).toBe(false);
    }
  });

  it.each([
    ['todo', 'completed'],
    ['planning', 'review'],
    ['in_progress', 'planning'],
    ['waiting', 'completed'],
    ['failed', 'completed'],
  ] as [TaskStatus, TaskStatus][])('documented illegal example %s → %s', (from, to) => {
    expect(canTransitionTask(from, to)).toBe(false);
  });

  it('terminal statuses have no exits (only force, handled by the server)', () => {
    for (const to of TASK_STATUSES) {
      expect(canTransitionTask('completed', to)).toBe(false);
      expect(canTransitionTask('cancelled', to)).toBe(false);
      expect(canTransitionTask('completed', to, { owned: true })).toBe(false);
    }
  });

  it('every non-terminal status can be cancelled', () => {
    for (const s of TASK_STATUSES) {
      if (!isTerminalTaskStatus(s)) expect(canTransitionTask(s, 'cancelled')).toBe(true);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(TASK_TRANSITIONS)).toBe(true);
    for (const s of TASK_STATUSES) expect(Object.isFrozen(TASK_TRANSITIONS[s])).toBe(true);
  });
});

describe('implicit assignment (ASM §5.2, ADR-017)', () => {
  it.each(TASK_STATUSES.map((to) => ({ to })))('owned todo → $to', ({ to }) => {
    const expected = to === 'assigned' || docTargets('assigned').includes(to);
    expect(canTransitionTask('todo', to, { owned: true })).toBe(expected && to !== 'todo');
  });

  it('a claimed todo task may go to waiting or review; an unowned one may not', () => {
    expect(canTransitionTask('todo', 'waiting', { owned: true })).toBe(true);
    expect(canTransitionTask('todo', 'review', { owned: true })).toBe(true);
    expect(canTransitionTask('todo', 'failed', { owned: true })).toBe(true);
    expect(canTransitionTask('todo', 'waiting')).toBe(false);
    expect(canTransitionTask('todo', 'review')).toBe(false);
    expect(canTransitionTask('todo', 'failed')).toBe(false);
    expect(canTransitionTask('todo', 'completed', { owned: true })).toBe(false);
  });

  it('owned has no effect on statuses other than todo', () => {
    for (const from of TASK_STATUSES) {
      if (from === 'todo') continue;
      for (const to of TASK_STATUSES) {
        expect(canTransitionTask(from, to, { owned: true })).toBe(canTransitionTask(from, to));
      }
    }
  });
});

describe('task status groups', () => {
  it('terminal = completed, cancelled', () => {
    expect(TASK_STATUSES.filter(isTerminalTaskStatus)).toEqual(['completed', 'cancelled']);
  });
  it('active = assigned, planning, in_progress, waiting, review (A-06)', () => {
    expect(TASK_STATUSES.filter(isActiveTaskStatus)).toEqual([
      'assigned',
      'planning',
      'in_progress',
      'waiting',
      'review',
    ]);
  });
});
