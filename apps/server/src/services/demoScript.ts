// Demo storyline (EVENT_SYSTEM §9, ADR-011/027, API_CONTRACTS §9.5): a pure function that produces the
// canonical inputs of one beat. Every input has `source: "demo"`, references only this session's demo
// tasks, and is legal when the inputs are applied in order against `world`. Legality is guaranteed by
// simulating each input with the same pure `decideEvent` the EventService uses: an illegal agent
// transition gets a bridging input first (`agent.connected` for an offline agent, `→ idle` otherwise);
// an input that would still be rejected is skipped (never emitted).
import {
  resolveProjectRef,
  type Agent,
  type EventInput,
  type IllegalTransitionDetails,
  type Project,
  type Task,
} from '@vo/shared';
import { decideEvent } from './eventEffects';

export interface DemoWorld {
  agents: readonly Agent[];
  tasks: ReadonlyMap<string, Task>; // current rows of demo tasks (ids from this session)
  touchedAgentIds: ReadonlySet<string>; // skip these agents (user wins)
  projects: readonly Project[];
  sessionKey: number; // demo startSeq; makes task ids unique per session
}
/** cycle ≥ 1, beat 1–13 (ES §9). */
export interface DemoCursor {
  cycle: number;
  beat: number;
}

export const DEMO_SOURCE = 'demo';
export const DEMO_BEATS_PER_CYCLE = 13;
export const INITIAL_DEMO_CURSOR: DemoCursor = Object.freeze({ cycle: 1, beat: 1 });

/** The storyline cast (ES §9). */
export const DEMO_CAST = Object.freeze({
  pm: '01-pm-orchestrator',
  architect: '03-architect',
  backend: '04-backend-engineer',
  frontend: '05-frontend-engineer',
  qa: '09-qa-engineer',
  reviewer: '14-reviewer',
  auditor: '15-product-auditor',
} as const);

/** One feature per cycle; the project rotates Sellway → Ishkun24 → ERP → Ana Market (world order). */
export const DEMO_FEATURES: readonly string[] = Object.freeze([
  'Checkout flow',
  'Candidate matching',
  'Stock forecasting',
  'Seller payouts',
  'Order tracking',
  'Interview scheduling',
  'Invoice export',
  'Product reviews',
]);

type TaskLetter = 'a' | 'b' | 'c' | 'd';

/** `<prefix>-D<sessionKey>-<cycle><letter>`, e.g. `SW-D57-1a` (ADR-027); never matches `^<prefix>-\d+$`. */
export function demoTaskId(
  prefix: string,
  sessionKey: number,
  cycle: number,
  letter: TaskLetter,
): string {
  return `${prefix}-D${sessionKey}-${cycle}${letter}`;
}

/** Timestamps do not influence legality; the simulation uses a fixed instant. */
const SIMULATION_NOW = '1970-01-01T00:00:00.000Z';

interface Story {
  project: Project;
  feature: string;
  ids: Readonly<Record<TaskLetter, string>>;
}

/** Simulates one beat on private copies of the world and collects the inputs that are legal. */
class BeatBuilder {
  readonly inputs: EventInput[] = [];
  private agents: Map<string, Agent>;
  private tasks: Map<string, Task>;

  constructor(private readonly world: DemoWorld) {
    this.agents = new Map(world.agents.map((agent) => [agent.id, agent]));
    this.tasks = new Map(world.tasks);
  }

  agent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  hasTask(id: string): boolean {
    return this.tasks.has(id);
  }

  /** Emits `input` (plus a bridging input when needed) if it is legal; otherwise emits nothing. */
  step(input: EventInput): void {
    const agentId = input.agentId;
    if (agentId === undefined || this.world.touchedAgentIds.has(agentId)) return;
    const agent = this.agents.get(agentId);
    if (agent === undefined) return;

    const first = this.tryApply(input);
    // An idle agent cannot be helped by a bridge (the only illegal move from idle is → completed).
    if (first === 'accepted' || first === 'rejected' || agent.status === 'idle') return;

    // Illegal agent transition: bridge first, then retry; roll back the bridge if the retry fails.
    const savedAgents = new Map(this.agents);
    const savedTasks = new Map(this.tasks);
    const savedLength = this.inputs.length;
    const bridge: EventInput =
      agent.status === 'offline'
        ? { type: 'agent.connected', source: DEMO_SOURCE, agentId }
        : { type: 'agent.status.changed', source: DEMO_SOURCE, agentId, status: 'idle' };
    if (this.tryApply(bridge) === 'accepted' && this.tryApply(input) === 'accepted') return;
    this.agents = savedAgents;
    this.tasks = savedTasks;
    this.inputs.length = savedLength;
  }

  private tryApply(input: EventInput): 'accepted' | 'illegal-agent' | 'rejected' {
    const agent = input.agentId === undefined ? null : (this.agents.get(input.agentId) ?? null);
    let projectId: string | null = null;
    if (input.project !== undefined) {
      projectId = resolveProjectRef(input.project, this.world.projects)?.id ?? null;
      if (projectId === null) return 'rejected'; // the service would answer 422 UNKNOWN_PROJECT
    }
    const task = input.taskId === undefined ? null : (this.tasks.get(input.taskId) ?? null);
    const decision = decideEvent({
      input,
      source: DEMO_SOURCE,
      agent,
      task,
      projectId,
      now: SIMULATION_NOW,
      force: false,
    });
    if (decision.kind === 'reject') {
      const details = decision.error.details as Partial<IllegalTransitionDetails> | undefined;
      return decision.error.code === 'ILLEGAL_TRANSITION' && details?.entity === 'agent'
        ? 'illegal-agent'
        : 'rejected';
    }
    if (agent !== null && decision.agentPatch !== null) {
      this.agents.set(agent.id, { ...agent, ...decision.agentPatch, version: agent.version + 1 });
    }
    const effect = decision.taskEffect;
    if (effect?.op === 'create') {
      this.tasks.set(effect.task.id, { ...effect.task, version: 1, updatedAt: SIMULATION_NOW });
    } else if (effect?.op === 'update') {
      const current = this.tasks.get(effect.id);
      if (current !== undefined) {
        this.tasks.set(effect.id, { ...current, ...effect.patch, version: current.version + 1 });
      }
    }
    this.inputs.push(input);
    return 'accepted';
  }
}

function assign(
  b: BeatBuilder,
  s: Story,
  agentId: string,
  letter: TaskLetter,
  title: string,
  message: string,
): void {
  b.step({
    type: 'agent.task.assigned',
    source: DEMO_SOURCE,
    agentId,
    taskId: s.ids[letter],
    project: s.project.id,
    message,
    metadata: { demo: true, title },
  });
}

/** `{ taskId }` only when the demo task exists (generic events must not bind dangling demo ids). */
function taskRef(b: BeatBuilder, id: string): { taskId?: string } {
  return b.hasTask(id) ? { taskId: id } : {};
}

const { pm, architect, backend, frontend, qa, reviewer, auditor } = DEMO_CAST;

/** The 13 beats of ES §9 (index 0 = beat 1). */
const BEATS: readonly ((b: BeatBuilder, s: Story) => void)[] = [
  // 1 — PM plans the feature.
  (b, s) => {
    b.step({
      type: 'agent.activity',
      source: DEMO_SOURCE,
      agentId: pm,
      project: s.project.id,
      status: 'planning',
      action: 'assign_task',
      message: `Planning ${s.feature}`,
    });
  },
  // 2 — Architect gets the design task and starts planning it.
  (b, s) => {
    assign(b, s, architect, 'a', `Design ${s.feature}`, `Design ${s.feature}`);
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: architect,
      project: s.project.id,
      status: 'planning',
      ...taskRef(b, s.ids.a),
      message: `Planning the design of ${s.feature}`,
    });
  },
  // 3 — PM assigns Backend and Frontend (the agentId of an assignment is the assignee), then works.
  (b, s) => {
    assign(b, s, backend, 'b', `Implement ${s.feature} API`, 'Assigned by PM');
    assign(b, s, frontend, 'c', `Build ${s.feature} UI`, 'Assigned by PM');
    b.step({
      type: 'agent.activity',
      source: DEMO_SOURCE,
      agentId: pm,
      project: s.project.id,
      status: 'working',
      action: 'assign_task',
      message: `Assigned ${s.feature} to Backend and Frontend`,
    });
  },
  // 4 — Architect delivers the design.
  (b, s) => {
    b.step({
      type: 'agent.task.started',
      source: DEMO_SOURCE,
      agentId: architect,
      taskId: s.ids.a,
      project: s.project.id,
      message: `Designing ${s.feature}`,
    });
    b.step({
      type: 'agent.task.completed',
      source: DEMO_SOURCE,
      agentId: architect,
      taskId: s.ids.a,
      project: s.project.id,
      message: `Design of ${s.feature} completed`,
    });
  },
  // 5 — Backend starts and runs tests.
  (b, s) => {
    b.step({
      type: 'agent.task.started',
      source: DEMO_SOURCE,
      agentId: backend,
      taskId: s.ids.b,
      project: s.project.id,
      message: `Implementing ${s.feature} API`,
    });
    b.step({
      type: 'agent.activity',
      source: DEMO_SOURCE,
      agentId: backend,
      project: s.project.id,
      ...taskRef(b, s.ids.b),
      action: 'run_command',
      message: 'Running backend tests',
    });
  },
  // 6 — Frontend starts and reports progress.
  (b, s) => {
    b.step({
      type: 'agent.task.started',
      source: DEMO_SOURCE,
      agentId: frontend,
      taskId: s.ids.c,
      project: s.project.id,
      message: `Building ${s.feature} UI`,
    });
    b.step({
      type: 'agent.task.progress',
      source: DEMO_SOURCE,
      agentId: frontend,
      taskId: s.ids.c,
      project: s.project.id,
      progress: 40,
    });
  },
  // 7 — QA gets the test task and waits for Backend.
  (b, s) => {
    assign(b, s, qa, 'd', `Test ${s.feature}`, `Test ${s.feature}`);
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: qa,
      project: s.project.id,
      status: 'waiting',
      ...taskRef(b, s.ids.d),
      message: 'Waiting for Backend',
    });
  },
  // 8 — Backend and Frontend finish.
  (b, s) => {
    for (const [agentId, letter] of [
      [backend, 'b'],
      [frontend, 'c'],
    ] as const) {
      b.step({
        type: 'agent.task.progress',
        source: DEMO_SOURCE,
        agentId,
        taskId: s.ids[letter],
        project: s.project.id,
        progress: 80,
      });
      b.step({
        type: 'agent.task.completed',
        source: DEMO_SOURCE,
        agentId,
        taskId: s.ids[letter],
        project: s.project.id,
      });
    }
  },
  // 9 — QA tests (its task moves to review).
  (b, s) => {
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: qa,
      project: s.project.id,
      status: 'reviewing',
      ...taskRef(b, s.ids.d),
      action: 'test',
      message: `Testing ${s.feature}`,
    });
  },
  // 10 — Reviewer reviews Backend's task (non-assignee: the task is not changed).
  (b, s) => {
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: reviewer,
      project: s.project.id,
      status: 'reviewing',
      ...taskRef(b, s.ids.b),
      action: 'git_diff',
      message: `Reviewing ${s.feature} API`,
    });
  },
  // 11 — Reviewer approves, QA completes its task.
  (b, s) => {
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: reviewer,
      project: s.project.id,
      status: 'completed',
      message: 'Review approved',
    });
    b.step({
      type: 'agent.task.completed',
      source: DEMO_SOURCE,
      agentId: qa,
      taskId: s.ids.d,
      project: s.project.id,
      message: `Tests for ${s.feature} passed`,
    });
  },
  // 12 — Product Auditor audits.
  (b, s) => {
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: auditor,
      project: s.project.id,
      status: 'reviewing',
      message: `Auditing ${s.feature}`,
    });
    b.step({
      type: 'agent.status.changed',
      source: DEMO_SOURCE,
      agentId: auditor,
      project: s.project.id,
      status: 'completed',
      message: `Audit of ${s.feature} passed`,
    });
  },
  // 13 — every cast member back to idle; the next cycle starts.
  (b) => {
    for (const agentId of Object.values(DEMO_CAST)) {
      if (b.agent(agentId)?.status !== 'idle') {
        b.step({ type: 'agent.status.changed', source: DEMO_SOURCE, agentId, status: 'idle' });
      }
    }
  },
];

function assertCursor(cursor: DemoCursor): void {
  const valid =
    Number.isSafeInteger(cursor.cycle) &&
    cursor.cycle >= 1 &&
    Number.isInteger(cursor.beat) &&
    cursor.beat >= 1 &&
    cursor.beat <= DEMO_BEATS_PER_CYCLE;
  if (!valid) throw new RangeError(`Invalid demo cursor: ${JSON.stringify(cursor)}`);
}

function advance(cursor: DemoCursor): DemoCursor {
  return cursor.beat >= DEMO_BEATS_PER_CYCLE
    ? { cycle: cursor.cycle + 1, beat: 1 }
    : { cycle: cursor.cycle, beat: cursor.beat + 1 };
}

/** Inputs of the beat at `cursor` (possibly none: touched agents are skipped) and the next cursor. */
export function nextDemoBeat(
  world: DemoWorld,
  cursor: DemoCursor,
): { inputs: EventInput[]; cursor: DemoCursor } {
  assertCursor(cursor);
  const next = advance(cursor);
  const project = world.projects[(cursor.cycle - 1) % Math.max(world.projects.length, 1)];
  const beat = BEATS[cursor.beat - 1];
  if (project === undefined || beat === undefined) return { inputs: [], cursor: next };

  const letters: readonly TaskLetter[] = ['a', 'b', 'c', 'd'];
  const ids = Object.fromEntries(
    letters.map((letter) => [
      letter,
      demoTaskId(project.taskPrefix, world.sessionKey, cursor.cycle, letter),
    ]),
  ) as Record<TaskLetter, string>;
  const story: Story = {
    project,
    feature: DEMO_FEATURES[(cursor.cycle - 1) % DEMO_FEATURES.length] ?? 'New feature',
    ids,
  };
  const builder = new BeatBuilder(world);
  beat(builder, story);
  return { inputs: builder.inputs, cursor: next };
}
