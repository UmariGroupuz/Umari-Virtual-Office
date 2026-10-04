import {
  TASK_ID_PATTERN,
  eventInputSchema,
  producerEventInputSchema,
  type EventInput,
  type Task,
} from '@vo/shared';
import { describe, expect, it } from 'vitest';
import {
  DEMO_BEATS_PER_CYCLE,
  DEMO_CAST,
  INITIAL_DEMO_CURSOR,
  demoTaskId,
  nextDemoBeat,
  type DemoCursor,
  type DemoWorld,
} from './demoScript';
import type { EventDecision } from './eventEffects';
import {
  agentInvariantViolations,
  baselineTasks,
  createBaselineState,
  ingest,
  taskInvariantViolations,
  type OfficeState,
} from './testHarness';

const CAST_IDS: readonly string[] = Object.values(DEMO_CAST);
const SEED_TASK_IDS = new Set(baselineTasks().map((task) => task.id));

/** Builds the DemoWorld exactly as the demo engine is contracted to (API_CONTRACTS §9.5, ADR-011). */
function demoWorld(state: OfficeState, sessionKey: number, startSeq: number): DemoWorld {
  const marker = `-D${sessionKey}-`;
  const touched = new Set<string>();
  for (const event of state.events) {
    if (
      event.seq > startSeq &&
      event.source !== 'demo' &&
      event.type.startsWith('agent.') &&
      event.agentId !== null
    ) {
      touched.add(event.agentId);
    }
  }
  return {
    agents: [...state.agents.values()],
    tasks: new Map([...state.tasks].filter(([id]) => id.includes(marker))),
    touchedAgentIds: touched,
    projects: state.projects,
    sessionKey,
  };
}

interface DemoRun {
  inputs: EventInput[];
  beats: { cursor: DemoCursor; inputs: EventInput[] }[];
  rejections: string[];
  invariantViolations: string[];
  cursor: DemoCursor;
}

/** Runs `beats` beats through the service emulation, one beat's inputs ingested sequentially. */
function runDemo(
  state: OfficeState,
  options: {
    sessionKey: number;
    startSeq: number;
    beats: number;
    cursor?: DemoCursor;
    between?: (beat: number) => void;
  },
): DemoRun {
  const run: DemoRun = {
    inputs: [],
    beats: [],
    rejections: [],
    invariantViolations: [],
    cursor: options.cursor ?? INITIAL_DEMO_CURSOR,
  };
  for (let i = 0; i < options.beats; i += 1) {
    options.between?.(i);
    const at = run.cursor;
    const { inputs, cursor } = nextDemoBeat(
      demoWorld(state, options.sessionKey, options.startSeq),
      at,
    );
    run.beats.push({ cursor: at, inputs });
    for (const input of inputs) {
      run.inputs.push(input);
      const decision: EventDecision = ingest(state, input);
      if (decision.kind === 'reject') {
        run.rejections.push(
          `cycle ${at.cycle} beat ${at.beat} ${input.type} ${input.agentId ?? ''}: ${decision.error.message}`,
        );
        break; // the service skips the rest of the beat on the first rejection
      }
      const agent = input.agentId === undefined ? undefined : state.agents.get(input.agentId);
      if (agent !== undefined) run.invariantViolations.push(...agentInvariantViolations(agent));
      for (const task of state.tasks.values())
        run.invariantViolations.push(...taskInvariantViolations(task));
    }
    run.cursor = cursor;
  }
  return run;
}

describe('demoTaskId (ADR-027)', () => {
  it('formats <prefix>-D<sessionKey>-<cycle><letter>', () => {
    expect(demoTaskId('SW', 57, 1, 'a')).toBe('SW-D57-1a');
    expect(demoTaskId('ERP', 1203, 12, 'd')).toBe('ERP-D1203-12d');
  });

  it('matches TASK_ID_PATTERN and never the generated-id pattern ^<prefix>-\\d+$', () => {
    for (const prefix of ['SW', 'IK', 'ERP', 'AM']) {
      const id = demoTaskId(prefix, 57, 3, 'b');
      expect(id).toMatch(TASK_ID_PATTERN);
      expect(id).not.toMatch(new RegExp(`^${prefix}-\\d+$`));
    }
  });
});

describe('nextDemoBeat — cursor', () => {
  it('starts at cycle 1 beat 1 and wraps after beat 13', () => {
    const world = demoWorld(createBaselineState(), 1, 0);
    expect(INITIAL_DEMO_CURSOR).toEqual({ cycle: 1, beat: 1 });
    expect(nextDemoBeat(world, { cycle: 1, beat: 1 }).cursor).toEqual({ cycle: 1, beat: 2 });
    expect(nextDemoBeat(world, { cycle: 2, beat: DEMO_BEATS_PER_CYCLE }).cursor).toEqual({
      cycle: 3,
      beat: 1,
    });
  });

  it.each([
    { cycle: 0, beat: 1 },
    { cycle: 1, beat: 0 },
    { cycle: 1, beat: 14 },
    { cycle: 1.5, beat: 1 },
    { cycle: 1, beat: Number.NaN },
  ])('rejects an invalid cursor %j', (cursor) => {
    expect(() => nextDemoBeat(demoWorld(createBaselineState(), 1, 0), cursor)).toThrow(RangeError);
  });

  it('is deterministic for the same world and cursor', () => {
    const world = demoWorld(createBaselineState(), 9, 0);
    expect(nextDemoBeat(world, { cycle: 1, beat: 3 })).toEqual(
      nextDemoBeat(world, { cycle: 1, beat: 3 }),
    );
  });

  it('produces nothing without projects', () => {
    const world = { ...demoWorld(createBaselineState(), 1, 0), projects: [] };
    expect(nextDemoBeat(world, INITIAL_DEMO_CURSOR)).toEqual({
      inputs: [],
      cursor: { cycle: 1, beat: 2 },
    });
  });
});

describe('demo simulation from the seed baseline (TASK-005 REQUIRED)', () => {
  const SESSION = 57;
  const CYCLES = 8; // every project twice
  const state = createBaselineState();
  const run = runDemo(state, {
    sessionKey: SESSION,
    startSeq: 0,
    beats: CYCLES * DEMO_BEATS_PER_CYCLE,
  });

  it(`runs ${CYCLES} full cycles with zero rejections and consistent state`, () => {
    expect(run.rejections).toEqual([]);
    expect(run.invariantViolations).toEqual([]);
    expect(run.cursor).toEqual({ cycle: CYCLES + 1, beat: 1 });
    expect(run.inputs.length).toBeGreaterThan(CYCLES * 25);
  });

  it('emits only schema-valid inputs with source "demo" (in-process schema; reserved on HTTP)', () => {
    for (const input of run.inputs) {
      expect(input.source).toBe('demo');
      expect(eventInputSchema.parse(input)).toEqual(input);
    }
    expect(producerEventInputSchema.safeParse(run.inputs[0]).success).toBe(false);
  });

  it('only the storyline cast acts', () => {
    expect(new Set(run.inputs.map((input) => input.agentId))).toEqual(new Set(CAST_IDS));
  });

  it('never references a non-demo task and leaves every seed task untouched', () => {
    for (const input of run.inputs) {
      if (input.taskId !== undefined) {
        expect(input.taskId).toContain(`-D${SESSION}-`);
        expect(SEED_TASK_IDS.has(input.taskId)).toBe(false);
      }
    }
    for (const seedTask of baselineTasks()) expect(state.tasks.get(seedTask.id)).toEqual(seedTask);
  });

  it('creates 4 demo tasks per cycle with unique ids, metadata.demo and the rotating project', () => {
    const demoTasks = [...state.tasks.values()].filter((task) => !SEED_TASK_IDS.has(task.id));
    expect(demoTasks).toHaveLength(CYCLES * 4);
    expect(new Set(demoTasks.map((task) => task.id)).size).toBe(CYCLES * 4);
    const rotation = ['sellway', 'ishkun24', 'erp', 'ana-market'];
    const prefixes: Record<string, string> = {
      sellway: 'SW',
      ishkun24: 'IK',
      erp: 'ERP',
      'ana-market': 'AM',
    };
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      const project = rotation[(cycle - 1) % 4] ?? '';
      for (const letter of ['a', 'b', 'c', 'd'] as const) {
        const task = state.tasks.get(demoTaskId(prefixes[project] ?? '', SESSION, cycle, letter));
        expect(task).toMatchObject({
          project,
          status: 'completed',
          progress: 100,
          metadata: { demo: true },
        });
      }
    }
  });

  it('follows the ES §9 storyline in cycle 1 (incl. the bridging inputs)', () => {
    const cycle1 = run.beats.filter((beat) => beat.cursor.cycle === 1);
    const summary = cycle1.map((beat) =>
      beat.inputs.map((input) => {
        const status = 'status' in input && input.status !== undefined ? `:${input.status}` : '';
        return `${input.agentId ?? ''} ${input.type}${status}${input.taskId === undefined ? '' : ` ${input.taskId}`}`;
      }),
    );
    expect(summary).toEqual([
      // 1 — the seeded PM is "working": working → planning is illegal, so it is bridged through idle.
      [
        '01-pm-orchestrator agent.status.changed:idle',
        '01-pm-orchestrator agent.activity:planning',
      ],
      // 2 — the seeded Architect is "reviewing": reviewing → planning is bridged through idle as well.
      [
        '03-architect agent.task.assigned SW-D57-1a',
        '03-architect agent.status.changed:idle',
        '03-architect agent.status.changed:planning SW-D57-1a',
      ],
      [
        '04-backend-engineer agent.task.assigned SW-D57-1b',
        '05-frontend-engineer agent.task.assigned SW-D57-1c',
        '01-pm-orchestrator agent.activity:working',
      ],
      ['03-architect agent.task.started SW-D57-1a', '03-architect agent.task.completed SW-D57-1a'],
      [
        '04-backend-engineer agent.task.started SW-D57-1b',
        '04-backend-engineer agent.activity SW-D57-1b',
      ],
      [
        '05-frontend-engineer agent.task.started SW-D57-1c',
        '05-frontend-engineer agent.task.progress SW-D57-1c',
      ],
      [
        '09-qa-engineer agent.task.assigned SW-D57-1d',
        '09-qa-engineer agent.status.changed:waiting SW-D57-1d',
      ],
      [
        '04-backend-engineer agent.task.progress SW-D57-1b',
        '04-backend-engineer agent.task.completed SW-D57-1b',
        '05-frontend-engineer agent.task.progress SW-D57-1c',
        '05-frontend-engineer agent.task.completed SW-D57-1c',
      ],
      ['09-qa-engineer agent.status.changed:reviewing SW-D57-1d'],
      ['14-reviewer agent.status.changed:reviewing SW-D57-1b'],
      [
        '14-reviewer agent.status.changed:completed',
        '09-qa-engineer agent.task.completed SW-D57-1d',
      ],
      [
        '15-product-auditor agent.status.changed:reviewing',
        '15-product-auditor agent.status.changed:completed',
      ],
      CAST_IDS.map((id) => `${id} agent.status.changed:idle`),
    ]);
  });

  it('later cycles need no bridges (everyone is idle after beat 13)', () => {
    const bridges = run.beats
      .filter((beat) => beat.cursor.cycle > 1 && beat.cursor.beat !== DEMO_BEATS_PER_CYCLE)
      .flatMap((beat) => beat.inputs)
      .filter(
        (input) =>
          input.type === 'agent.connected' ||
          (input.type === 'agent.status.changed' && input.status === 'idle'),
      );
    expect(bridges).toEqual([]);
  });

  it('ends every cycle with the whole cast idle', () => {
    for (const id of CAST_IDS)
      expect(state.agents.get(id)).toMatchObject({ status: 'idle', taskId: null });
  });

  it('Reviewer reviewing Backend’s task leaves that task to its assignee', () => {
    const reviewerInputs = run.inputs.filter(
      (input) => input.agentId === DEMO_CAST.reviewer && input.taskId !== undefined,
    );
    expect(reviewerInputs.length).toBe(CYCLES);
    for (const input of reviewerInputs) {
      expect(state.tasks.get(input.taskId ?? '')?.assignedAgentId).toBe(DEMO_CAST.backend);
    }
  });
});

describe('demo with user-touched agents (ADR-011: the user wins)', () => {
  it('skips touched agents entirely, still with zero rejections', () => {
    const state = createBaselineState();
    const startSeq = state.events.length;
    // User activity after the demo started: Backend disconnected, QA working on its own task.
    expect(ingest(state, { type: 'agent.disconnected', agentId: DEMO_CAST.backend }).kind).toBe(
      'accept',
    );
    expect(
      ingest(state, { type: 'agent.task.started', agentId: DEMO_CAST.qa, taskId: 'ERP-302' }).kind,
    ).toBe('accept');
    const qaBefore = state.agents.get(DEMO_CAST.qa);
    const beBefore = state.agents.get(DEMO_CAST.backend);

    const run = runDemo(state, { sessionKey: 3, startSeq, beats: 3 * DEMO_BEATS_PER_CYCLE });
    expect(run.rejections).toEqual([]);
    expect(run.invariantViolations).toEqual([]);
    const actors = new Set(run.inputs.map((input) => input.agentId));
    expect(actors.has(DEMO_CAST.backend)).toBe(false);
    expect(actors.has(DEMO_CAST.qa)).toBe(false);
    expect(state.agents.get(DEMO_CAST.qa)).toEqual(qaBefore);
    expect(state.agents.get(DEMO_CAST.backend)).toEqual(beBefore);
    // Backend's task is never created, so the Reviewer reviews without a task id.
    expect(state.tasks.has(demoTaskId('SW', 3, 1, 'b'))).toBe(false);
    const review = run.inputs.find(
      (input) => input.agentId === DEMO_CAST.reviewer && input.type === 'agent.status.changed',
    );
    expect(review?.taskId).toBeUndefined();
  });

  it('an agent touched in the middle of a cycle is skipped from then on', () => {
    const state = createBaselineState();
    const run = runDemo(state, {
      sessionKey: 4,
      startSeq: 0,
      beats: 2 * DEMO_BEATS_PER_CYCLE,
      between: (beat) => {
        if (beat === 4)
          ingest(state, {
            type: 'agent.status.changed',
            agentId: DEMO_CAST.frontend,
            status: 'failed',
          });
      },
    });
    expect(run.rejections).toEqual([]);
    expect(
      run.beats
        .slice(4)
        .flatMap((b) => b.inputs)
        .some((input) => input.agentId === DEMO_CAST.frontend),
    ).toBe(false);
    expect(state.agents.get(DEMO_CAST.frontend)?.status).toBe('failed');
  });
});

describe('demo bridging and robustness', () => {
  it('bridges an offline (untouched) agent with agent.connected', () => {
    const state = createBaselineState();
    ingest(state, { type: 'agent.disconnected', agentId: DEMO_CAST.architect }); // before the demo started
    const startSeq = state.events.length;
    const run = runDemo(state, { sessionKey: 8, startSeq, beats: DEMO_BEATS_PER_CYCLE });
    expect(run.rejections).toEqual([]);
    const beat2 = run.beats[1]?.inputs.map(
      (input) =>
        `${input.type}${'status' in input && input.status !== undefined ? `:${input.status}` : ''}`,
    );
    expect(beat2).toEqual([
      'agent.task.assigned',
      'agent.connected',
      'agent.status.changed:planning',
    ]);
  });

  it('skips (never emits) a step that would be rejected — e.g. a demo task cancelled by the user', () => {
    const state = createBaselineState();
    const id = demoTaskId('SW', 11, 1, 'b');
    const run = runDemo(state, {
      sessionKey: 11,
      startSeq: 0,
      beats: 2 * DEMO_BEATS_PER_CYCLE,
      between: (beat) => {
        if (beat === 4) {
          // As PATCH /api/tasks/:id {status:"cancelled"} would do (a task.updated event, agent not touched).
          const task = state.tasks.get(id) as Task;
          state.tasks.set(id, { ...task, status: 'cancelled', version: task.version + 1 });
        }
      },
    });
    expect(run.rejections).toEqual([]);
    expect(state.tasks.get(id)?.status).toBe('cancelled');
    const startedB = run.inputs.filter(
      (input) => input.type === 'agent.task.started' && input.taskId === id,
    );
    expect(startedB).toEqual([]);
  });

  it('different sessions produce different task ids', () => {
    const a = runDemo(createBaselineState(), { sessionKey: 100, startSeq: 0, beats: 2 });
    const b = runDemo(createBaselineState(), { sessionKey: 200, startSeq: 0, beats: 2 });
    const ids = (run: DemoRun) =>
      run.inputs.flatMap((input) => (input.taskId === undefined ? [] : [input.taskId]));
    expect(ids(a)).toEqual(['SW-D100-1a', 'SW-D100-1a']);
    expect(ids(b)).toEqual(['SW-D200-1a', 'SW-D200-1a']);
  });

  it('does not mutate the world it is given', () => {
    const state = createBaselineState();
    const world = demoWorld(state, 1, 0);
    const before = structuredClone({ agents: world.agents, tasks: [...world.tasks] });
    nextDemoBeat(world, { cycle: 1, beat: 2 });
    expect({ agents: world.agents, tasks: [...world.tasks] }).toEqual(before);
  });
});
