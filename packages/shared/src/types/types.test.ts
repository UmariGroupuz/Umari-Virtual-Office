// Compile-time contract checks (API_CONTRACTS §1): `npm run typecheck` fails if a shape drifts.
import { describe, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { ErrorCode } from '../constants/errorCodes';
import type { EventType, ProducerEventType, ServerEventType } from '../constants/eventTypes';
import type { RoomId } from '../constants/rooms';
import type { AgentStatus, Severity, TaskPriority, TaskStatus } from '../constants/statuses';
import type { agentStatusPatchSchema } from '../schemas/agent';
import type {
  agentIdSchema,
  metadataSchema,
  progressSchema,
  projectRefSchema,
  sourceSchema,
  taskIdSchema,
} from '../schemas/common';
import type { DemoStartInput } from '../schemas/demo';
import type { EventInputBody, eventInputSchema, producerEventInputSchema } from '../schemas/event';
import type {
  AgentsQueryInput,
  EventsQueryInput,
  SnapshotQueryInput,
  TasksQueryInput,
} from '../schemas/query';
import type { TaskCreateInput, TaskPatchInput } from '../schemas/task';
import type { Agent } from './agent';
import type { ApiErrorBody, OfficeEventPayload, WriteResult } from './api';
import type { EventInput, OfficeEvent } from './event';
import type { JsonObject, JsonValue } from './json';
import type { Task } from './task';

describe('enum types', () => {
  it('are the literal unions of §1.2', () => {
    expectTypeOf<AgentStatus>().toEqualTypeOf<
      'idle' | 'planning' | 'working' | 'waiting' | 'reviewing' | 'completed' | 'failed' | 'offline'
    >();
    expectTypeOf<TaskStatus>().toEqualTypeOf<
      | 'todo'
      | 'assigned'
      | 'planning'
      | 'in_progress'
      | 'waiting'
      | 'review'
      | 'completed'
      | 'failed'
      | 'cancelled'
    >();
    expectTypeOf<TaskPriority>().toEqualTypeOf<'low' | 'normal' | 'high' | 'critical'>();
    expectTypeOf<Severity>().toEqualTypeOf<'info' | 'warning' | 'error'>();
    expectTypeOf<ServerEventType>().toEqualTypeOf<'task.created' | 'task.updated'>();
    expectTypeOf<EventType>().toEqualTypeOf<ProducerEventType | ServerEventType>();
    expectTypeOf<RoomId>().toEqualTypeOf<
      | 'management'
      | 'development'
      | 'design'
      | 'infrastructure'
      | 'quality'
      | 'ai-lab'
      | 'documentation'
      | 'audit'
    >();
    expectTypeOf<ErrorCode>().toEqualTypeOf<
      | 'INVALID_JSON'
      | 'VALIDATION_ERROR'
      | 'HOST_NOT_ALLOWED'
      | 'ORIGIN_NOT_ALLOWED'
      | 'NOT_FOUND'
      | 'AGENT_NOT_FOUND'
      | 'TASK_NOT_FOUND'
      | 'ILLEGAL_TRANSITION'
      | 'TASK_EXISTS'
      | 'PAYLOAD_TOO_LARGE'
      | 'UNKNOWN_AGENT'
      | 'UNKNOWN_PROJECT'
      | 'UNKNOWN_TASK'
      | 'PROJECT_MISMATCH'
      | 'INTERNAL_ERROR'
      | 'SERVICE_UNAVAILABLE'
    >();
  });
});

describe('entities (§1.3, §1.4)', () => {
  it('Agent has exactly the contract fields', () => {
    expectTypeOf<keyof Agent>().toEqualTypeOf<
      | 'id'
      | 'code'
      | 'name'
      | 'role'
      | 'shortRole'
      | 'avatar'
      | 'department'
      | 'roomId'
      | 'deskId'
      | 'status'
      | 'currentProject'
      | 'currentTask'
      | 'taskId'
      | 'progress'
      | 'startedAt'
      | 'lastActivityAt'
      | 'currentAction'
      | 'lastMessage'
      | 'online'
      | 'metadata'
      | 'version'
    >();
    expectTypeOf<Agent['roomId']>().toEqualTypeOf<RoomId>();
    expectTypeOf<Agent['currentProject']>().toEqualTypeOf<string | null>();
    expectTypeOf<Agent['metadata']>().toEqualTypeOf<JsonObject>();
  });

  it('Task has exactly the contract fields', () => {
    expectTypeOf<keyof Task>().toEqualTypeOf<
      | 'id'
      | 'title'
      | 'description'
      | 'project'
      | 'assignedAgentId'
      | 'status'
      | 'priority'
      | 'progress'
      | 'createdAt'
      | 'startedAt'
      | 'completedAt'
      | 'blockedBy'
      | 'metadata'
      | 'version'
      | 'updatedAt'
    >();
    expectTypeOf<Task['blockedBy']>().toEqualTypeOf<string[]>();
  });

  it('OfficeEvent has exactly the contract fields', () => {
    expectTypeOf<keyof OfficeEvent>().toEqualTypeOf<
      | 'id'
      | 'seq'
      | 'type'
      | 'source'
      | 'agentId'
      | 'project'
      | 'taskId'
      | 'status'
      | 'action'
      | 'message'
      | 'severity'
      | 'progress'
      | 'metadata'
      | 'occurredAt'
      | 'createdAt'
      | 'forced'
    >();
    expectTypeOf<OfficeEvent['status']>().toEqualTypeOf<AgentStatus | TaskStatus | null>();
  });

  it('JsonValue accepts nested JSON', () => {
    expectTypeOf<{ a: [1, { b: null }] }>().toExtend<JsonValue>();
  });

  it('payloads', () => {
    expectTypeOf<WriteResult['event']>().toEqualTypeOf<OfficeEvent | null>();
    expectTypeOf<OfficeEventPayload>().toExtend<WriteResult>();
    expectTypeOf<ApiErrorBody['error']['code']>().toEqualTypeOf<ErrorCode>();
  });
});

describe('schema-inferred types (§1.4, §1.5, §5.2)', () => {
  it('z.output of both event schemas is structurally EventInput', () => {
    // expect-type cannot deep-compare a union of intersections directly, so: mutual assignability of
    // the whole union, plus exact equality of every member (flattened) per `type` group.
    type Out = z.output<typeof eventInputSchema>;
    type Flat<T> = { [K in keyof T]: T[K] };
    type Member<U, T extends EventInput['type']> = Flat<Extract<U, { type: T }>>;

    expectTypeOf<Out>().toExtend<EventInput>();
    expectTypeOf<EventInput>().toExtend<Out>();
    expectTypeOf<z.output<typeof producerEventInputSchema>>().toEqualTypeOf<Out>();

    type Groups = [
      'agent.connected' | 'agent.disconnected',
      'agent.status.changed',
      'agent.activity',
      'agent.message',
      'agent.task.assigned' | 'agent.task.started' | 'agent.task.completed' | 'agent.task.failed',
      'agent.task.progress',
      'system.info' | 'system.warning' | 'system.error',
    ];
    expectTypeOf<Member<Out, Groups[0]>>().toEqualTypeOf<Member<EventInput, Groups[0]>>();
    expectTypeOf<Member<Out, Groups[1]>>().toEqualTypeOf<Member<EventInput, Groups[1]>>();
    expectTypeOf<Member<Out, Groups[2]>>().toEqualTypeOf<Member<EventInput, Groups[2]>>();
    expectTypeOf<Member<Out, Groups[3]>>().toEqualTypeOf<Member<EventInput, Groups[3]>>();
    expectTypeOf<Member<Out, Groups[4]>>().toEqualTypeOf<Member<EventInput, Groups[4]>>();
    expectTypeOf<Member<Out, Groups[5]>>().toEqualTypeOf<Member<EventInput, Groups[5]>>();
    expectTypeOf<Member<Out, Groups[6]>>().toEqualTypeOf<Member<EventInput, Groups[6]>>();
    // the groups cover the whole union
    expectTypeOf<Groups[number]>().toEqualTypeOf<ProducerEventType>();
    expectTypeOf<Out['type']>().toEqualTypeOf<ProducerEventType>();
  });

  it('EventInputBody is the raw input (null allowed for optional fields)', () => {
    expectTypeOf<EventInputBody>().toEqualTypeOf<z.input<typeof producerEventInputSchema>>();
    expectTypeOf({
      type: 'agent.activity' as const,
      agentId: 'a',
      action: 'x',
      project: null,
      metadata: null,
      progress: null,
    }).toExtend<EventInputBody>();
    expectTypeOf({
      type: 'agent.task.progress' as const,
      agentId: 'a',
      taskId: 't',
    }).not.toExtend<EventInputBody>();
    // every parsed input is also a valid body (adapters may emit EventInput values)
    expectTypeOf<EventInput>().toExtend<EventInputBody>();
  });

  it('field schemas have the §5.2 signatures', () => {
    expectTypeOf<typeof agentIdSchema>().toExtend<z.ZodType<string>>();
    expectTypeOf<typeof projectRefSchema>().toExtend<z.ZodType<string>>();
    expectTypeOf<typeof taskIdSchema>().toExtend<z.ZodType<string>>();
    expectTypeOf<typeof sourceSchema>().toExtend<z.ZodType<string>>();
    expectTypeOf<typeof progressSchema>().toExtend<z.ZodType<number>>();
    expectTypeOf<typeof metadataSchema>().toExtend<z.ZodType<JsonObject>>();
  });

  it('parsed body and query types', () => {
    expectTypeOf<z.output<typeof agentStatusPatchSchema>>().toEqualTypeOf<{
      status: AgentStatus;
      source: string;
      project?: string;
      taskId?: string;
      action?: string;
      message?: string;
      force: boolean;
    }>();
    expectTypeOf<TaskCreateInput>().toEqualTypeOf<{
      id?: string;
      title: string;
      description: string | null;
      project: string;
      assignedAgentId: string | null;
      priority: TaskPriority;
      status: 'todo' | 'assigned';
      blockedBy: string[];
      metadata: JsonObject;
    }>();
    expectTypeOf<TaskPatchInput>().toEqualTypeOf<{
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      progress?: number;
      assignedAgentId?: string | null;
      blockedBy?: string[];
      metadata?: JsonObject;
      force: boolean;
    }>();
    expectTypeOf<DemoStartInput>().toEqualTypeOf<{ intervalMs?: number }>();
    expectTypeOf<AgentsQueryInput>().toEqualTypeOf<{ project?: string }>();
    expectTypeOf<EventsQueryInput>().toEqualTypeOf<{
      project?: string;
      agentId?: string;
      taskId?: string;
      type?: EventType;
      source?: string;
      before?: number;
      limit: number;
    }>();
    expectTypeOf<TasksQueryInput>().toEqualTypeOf<{
      project?: string;
      agentId?: string;
      status?: TaskStatus;
      limit: number;
    }>();
    expectTypeOf<SnapshotQueryInput>().toEqualTypeOf<{ project?: string; eventsLimit: number }>();
  });
});
