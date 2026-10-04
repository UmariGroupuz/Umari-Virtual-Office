// RECOMMENDED (PM, TASK-008): replay the seed history (TASK-003) through the real pure rules (TASK-005).
// Every stored agent/system event must be accepted by `decideEvent` with exactly the stored derived fields
// (severity, project, status, progress, …), and the replay must end in the seeded agent and task rows.
import { eventInputSchema, type Agent, type EventInput, type Task } from '@vo/shared';
import { describe, expect, it } from 'vitest';
import type { NewEvent } from '../src/db/types';
import { buildSeedBaseline } from '../src/seed/seed';
import { decideEvent } from '../src/services/eventEffects';

const NOW = new Date('2026-10-04T12:00:00.000Z');

function toInput(event: Omit<NewEvent, 'id'>): EventInput {
  const raw: Record<string, unknown> = { type: event.type, source: event.source };
  for (const key of [
    'agentId',
    'taskId',
    'project',
    'status',
    'action',
    'message',
    'progress',
  ] as const) {
    if (event[key] !== null) raw[key] = event[key];
  }
  if (Object.keys(event.metadata).length > 0) raw.metadata = event.metadata;
  return eventInputSchema.parse(raw);
}

describe('seed history ↔ decideEvent (cross-check of TASK-003 and TASK-005)', () => {
  it('replays to exactly the seeded agents and tasks', () => {
    const baseline = buildSeedBaseline(NOW);
    const events = baseline.events;
    const finalTasks = new Map(baseline.tasks.map(({ task }) => [task.id, task]));
    const createdInWindow = new Set(
      events.filter((e) => e.type === 'task.created').map((e) => e.taskId),
    );

    const agents = new Map<string, Agent>(
      baseline.agents.map(({ agent }) => [
        agent.id,
        {
          ...agent,
          status: 'idle',
          online: true,
          currentProject: null,
          currentTask: null,
          taskId: null,
          progress: 0,
          startedAt: null,
          lastActivityAt: null,
          currentAction: null,
          lastMessage: null,
        },
      ]),
    );
    const tasks = new Map<string, Task>();
    for (const task of finalTasks.values()) {
      if (createdInWindow.has(task.id)) continue;
      const first = events.find((e) => e.taskId === task.id && e.type.startsWith('agent.'));
      const unassigned = first?.type === 'agent.task.assigned';
      tasks.set(task.id, {
        ...task,
        status: unassigned ? 'todo' : 'assigned',
        assignedAgentId: unassigned ? null : task.assignedAgentId,
        progress: 0,
        startedAt: null,
        completedAt: null,
        version: 1,
        updatedAt: task.createdAt,
      });
    }

    for (const [index, event] of events.entries()) {
      const label = `#${index} ${event.type} ${event.agentId ?? ''} ${event.taskId ?? ''}`;
      if (event.type === 'task.created') {
        const task = finalTasks.get(event.taskId ?? '') as Task;
        tasks.set(task.id, {
          ...task,
          status: 'todo',
          assignedAgentId: event.agentId,
          progress: 0,
          startedAt: null,
          completedAt: null,
          version: 1,
          updatedAt: event.createdAt,
        });
        continue;
      }
      if (event.type === 'task.updated') continue; // priority-only edit in the seed

      const input = toInput(event);
      const agent = event.agentId === null ? null : (agents.get(event.agentId) ?? null);
      const task = event.taskId === null ? null : (tasks.get(event.taskId) ?? null);
      const decision = decideEvent({
        input,
        source: event.source,
        agent,
        task,
        projectId: event.project,
        now: event.createdAt,
        force: false,
      });
      if (decision.kind === 'reject')
        throw new Error(`${label}: rejected ${decision.error.message}`);
      const { id: _id, createdAt: _createdAt, ...stored } = { id: '', ...event };
      expect(decision.event, label).toEqual(stored);
      if (agent !== null && decision.agentPatch !== null) {
        agents.set(agent.id, { ...agent, ...decision.agentPatch });
      }
      const effect = decision.taskEffect;
      if (effect?.op === 'create') {
        tasks.set(effect.task.id, { ...effect.task, version: 1, updatedAt: event.createdAt });
      } else if (effect?.op === 'update') {
        const current = tasks.get(effect.id) as Task;
        tasks.set(effect.id, { ...current, ...effect.patch, updatedAt: event.createdAt });
      }
    }

    for (const { agent } of baseline.agents) {
      const replayed = agents.get(agent.id) as Agent;
      const pick = (a: Agent) => ({
        status: a.status,
        online: a.online,
        currentProject: a.currentProject,
        currentTask: a.currentTask,
        taskId: a.taskId,
        progress: a.progress,
        startedAt: a.startedAt,
        lastActivityAt: a.lastActivityAt,
        currentAction: a.currentAction,
        lastMessage: a.lastMessage,
      });
      expect(pick(replayed), agent.id).toEqual(pick(agent));
    }
    for (const task of finalTasks.values()) {
      const replayed = tasks.get(task.id) as Task;
      const pick = (
        x: Pick<Task, 'status' | 'assignedAgentId' | 'progress' | 'startedAt' | 'completedAt'>,
      ) => ({
        status: x.status,
        assignedAgentId: x.assignedAgentId,
        progress: x.progress,
        startedAt: x.startedAt,
        completedAt: x.completedAt,
      });
      expect(pick(replayed), task.id).toEqual(pick(task));
    }
  });
});
