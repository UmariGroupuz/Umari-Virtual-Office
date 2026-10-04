import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import {
  allowedButtonLabels,
  buildActivityBody,
  buildStatusPatch,
  buttonLegality,
  describeWriteError,
  validateActivity,
} from './simulatorLogic';

describe('simulator request bodies (API-C §10.3)', () => {
  it('status patch: source simulator, project/task only when chosen, never force', () => {
    expect(buildStatusPatch('working', 'sellway', 'SW-123')).toEqual({
      status: 'working',
      source: 'simulator',
      project: 'sellway',
      taskId: 'SW-123',
    });
    expect(buildStatusPatch('idle', null, null)).toEqual({ status: 'idle', source: 'simulator' });
  });

  it('activity body: agent.activity; severity omitted when Info; empty message omitted', () => {
    expect(
      buildActivityBody({
        agentId: '04-backend-engineer',
        action: ' run_tests ',
        message: 'Running API tests',
        severity: 'info',
        projectId: 'sellway',
        taskId: null,
      }),
    ).toEqual({
      type: 'agent.activity',
      source: 'simulator',
      agentId: '04-backend-engineer',
      action: 'run_tests',
      message: 'Running API tests',
      project: 'sellway',
    });
    expect(
      buildActivityBody({
        agentId: 'a',
        action: 'x',
        message: '  ',
        severity: 'warning',
        projectId: null,
        taskId: null,
      }),
    ).toEqual({
      type: 'agent.activity',
      source: 'simulator',
      agentId: 'a',
      action: 'x',
      severity: 'warning',
    });
  });
});

describe('client validation with the shared schema (UX §9.5)', () => {
  const body = (action: string, message = '') =>
    buildActivityBody({
      agentId: 'a',
      action,
      message,
      severity: 'info',
      projectId: null,
      taskId: null,
    });
  it('empty action', () => {
    expect(validateActivity(body(''))).toEqual({ action: 'Action is required.' });
  });
  it('action > 100 chars', () => {
    expect(validateActivity(body('a'.repeat(101)))).toEqual({
      action: 'Action must be 100 characters or fewer.',
    });
  });
  it('message > 2000 chars', () => {
    expect(validateActivity(body('ok', 'm'.repeat(2001)))).toEqual({
      message: 'Message must be 2,000 characters or fewer.',
    });
  });
  it('valid body', () => {
    expect(validateActivity(body('run_tests', 'x'))).toEqual({});
  });
});

describe('legality hints (REQ-102)', () => {
  it('marks current, legal and illegal buttons from the shared state machine', () => {
    expect(buttonLegality('idle', 'idle')).toBe('current');
    expect(buttonLegality('idle', 'working')).toBe('legal');
    expect(buttonLegality('idle', 'completed')).toBe('illegal');
    expect(buttonLegality('offline', 'working')).toBe('illegal');
  });
  it('lists allowed buttons in button order', () => {
    expect(allowedButtonLabels('idle')).toEqual([
      'Start Planning',
      'Start Work',
      'Set Waiting',
      'Start Review',
      'Fail',
      'Set Offline',
    ]);
    expect(allowedButtonLabels('offline')).toEqual(['Set Idle']);
  });
});

describe('error feedback (UX §9.5)', () => {
  it('409 → server message verbatim + "Allowed from" hint (from the error details)', () => {
    const error = new ApiError(409, 'ILLEGAL_TRANSITION', 'Illegal transition: idle → completed', {
      entity: 'agent',
      id: '04-backend-engineer',
      from: 'idle',
      to: 'completed',
    });
    expect(describeWriteError(error, 'working')).toEqual({
      kind: 'error',
      message: 'Illegal transition: idle → completed',
      hint: 'Allowed from Idle: Start Planning, Start Work, Set Waiting, Start Review, Fail, Set Offline',
    });
  });
  it('400/422 append the first issue', () => {
    const error = new ApiError(
      400,
      'VALIDATION_ERROR',
      'Validation failed: action: Action is required.',
      [{ path: 'action', message: 'Action is required.' }],
    );
    expect(describeWriteError(error, null).message).toBe(
      'Validation failed: action: Action is required. (action: Action is required.)',
    );
    const unknown = new ApiError(422, 'UNKNOWN_PROJECT', 'Unknown project: x', { project: 'x' });
    expect(describeWriteError(unknown, null).message).toBe('Unknown project: x');
  });
  it('network failure / timeout', () => {
    const message = "Can't reach the server. Check that the backend is running.";
    expect(
      describeWriteError(new ApiError(0, 'NETWORK_ERROR', 'Network error'), null).message,
    ).toBe(message);
    expect(describeWriteError(new ApiError(0, 'TIMEOUT', 'Request timed out'), null).message).toBe(
      message,
    );
  });
});
