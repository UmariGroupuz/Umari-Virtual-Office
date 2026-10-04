import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfficeApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { makeAgent, makeEvent } from '../testing/fixtures';
import { renderApp, settle, stopRuntimes } from '../testing/renderApp';

vi.mock('../office/OfficeCanvas', () => ({
  default: () => <div data-testid="office-canvas" />,
}));

type FetchArgs = [string, RequestInit | undefined];
let fetchMock: ReturnType<typeof vi.fn<(...args: FetchArgs) => Promise<Response>>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  stopRuntimes();
  vi.unstubAllGlobals();
});

/** Real HTTP client for the write endpoints (fetch is stubbed) so the exact payloads are asserted. */
const realWrites = () => {
  const real = createOfficeApi();
  return { patchAgentStatus: real.patchAgentStatus, postEvent: real.postEvent };
};

async function openSimulator(options: Parameters<typeof renderApp>[0] = {}) {
  const utils = await renderApp({ api: realWrites(), ...options });
  await utils.user.click(screen.getByRole('button', { name: 'Simulator' }));
  const dock = screen.getByRole('region', { name: 'Developer Simulator' });
  return { ...utils, dock };
}

const agentSelect = (dock: HTMLElement) => within(dock).getByRole('combobox', { name: 'Agent' });

describe('simulator target fields (UX §9.3)', () => {
  it('focuses Agent on open; live status suffix; project/task prefill rules', async () => {
    const { dock, user } = await openSimulator();
    expect(agentSelect(dock)).toHaveFocus();
    expect(
      within(dock).getByRole('option', { name: 'Backend Engineer (Idle)' }),
    ).toBeInTheDocument();
    expect(within(dock).getByRole('option', { name: 'Select an agent…' })).toBeInTheDocument();

    const task = within(dock).getByRole('combobox', { name: 'Task' });
    expect(task).toBeDisabled();
    expect(
      within(task).getByRole('option', { name: 'Select a project first' }),
    ).toBeInTheDocument();

    await user.selectOptions(agentSelect(dock), 'Frontend Engineer (Working)');
    expect(within(dock).getByRole('combobox', { name: 'Project' })).toHaveValue('sellway');
    expect(task).toHaveValue('SW-124');
    expect(
      within(task).getByRole('option', { name: 'SW-123 · Lost Goods API (Assigned)' }),
    ).toBeInTheDocument();

    await user.selectOptions(within(dock).getByRole('combobox', { name: 'Project' }), 'Ana Market');
    expect(task).toHaveValue('');
  });

  it('preselects the agent shown in the detail panel', async () => {
    const { dock } = await openSimulator({ ui: { selectedAgentId: '04-backend-engineer' } });
    expect(agentSelect(dock)).toHaveValue('04-backend-engineer');
    expect(within(dock).getByRole('combobox', { name: 'Project' })).toHaveValue('sellway');
  });

  it('no agent selected → all actions disabled with a hint', async () => {
    const { dock } = await openSimulator();
    for (const label of [
      'Set Idle',
      'Start Planning',
      'Start Work',
      'Set Waiting',
      'Start Review',
      'Complete',
      'Fail',
      'Set Offline',
    ]) {
      expect(within(dock).getByRole('button', { name: new RegExp(`^${label}`) })).toBeDisabled();
    }
    expect(within(dock).getByRole('button', { name: 'Send Event' })).toBeDisabled();
    expect(within(dock).getByText('Select an agent to enable actions.')).toBeInTheDocument();
  });
});

describe('status buttons (UX §9.4, REQ-102, REQ-104)', () => {
  it('sends the exact PATCH payload, disables everything while pending, then reports success via the reducer', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    const { dock, user, runtime } = await openSimulator();
    await user.selectOptions(agentSelect(dock), '04-backend-engineer');
    await user.selectOptions(within(dock).getByRole('combobox', { name: 'Task' }), 'SW-123');

    await user.click(within(dock).getByRole('button', { name: 'Start Work' }));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/agents/04-backend-engineer/status');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({
      status: 'working',
      source: 'simulator',
      project: 'sellway',
      taskId: 'SW-123',
    });
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    // Pending: all 8 buttons + Send Event disabled; the clicked one is busy.
    const buttons = within(dock)
      .getAllByRole('button', { pressed: false })
      .concat(within(dock).getAllByRole('button', { pressed: true }));
    expect(buttons).toHaveLength(8);
    for (const b of buttons) expect(b).toBeDisabled();
    expect(within(dock).getByRole('button', { name: 'Start Work' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(within(dock).getByRole('button', { name: 'Send Event' })).toBeDisabled();
    // Nothing changed yet (no optimistic update).
    expect(runtime.store.getState().agents['04-backend-engineer']?.status).toBe('idle');

    const createdAt = new Date().toISOString();
    await act(async () => {
      resolve(
        json(200, {
          data: {
            event: makeEvent({
              id: 'p1',
              seq: 9000,
              type: 'agent.status.changed',
              status: 'working',
              createdAt,
            }),
            agent: makeAgent('04-backend-engineer', { status: 'working', version: 2 }),
            task: null,
          },
        }),
      );
      await Promise.resolve();
    });
    await settle();
    expect(runtime.store.getState().agents['04-backend-engineer']?.status).toBe('working');
    expect(within(dock).getByRole('status')).toHaveTextContent(
      /^Accepted · Backend Engineer → Working · \d\d:\d\d:\d\d$/,
    );
    expect(within(dock).getByRole('button', { name: 'Start Work (current)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('illegal transition: dashed hint, server 409 message verbatim + "Allowed from", store unchanged', async () => {
    fetchMock.mockResolvedValue(
      json(409, {
        error: {
          code: 'ILLEGAL_TRANSITION',
          message: 'Illegal transition: idle → completed',
          details: { entity: 'agent', id: '04-backend-engineer', from: 'idle', to: 'completed' },
        },
      }),
    );
    const { dock, user, runtime } = await openSimulator();
    await user.selectOptions(agentSelect(dock), '04-backend-engineer');
    const complete = within(dock).getByRole('button', { name: 'Complete' });
    expect(complete).toHaveClass('border-dashed');
    expect(complete).toHaveAttribute(
      'title',
      'Not allowed from Idle — the server will reject this',
    );
    expect(complete).toHaveAccessibleDescription(
      'Not allowed from Idle — the server will reject this',
    );
    expect(complete).toBeEnabled();
    const before = runtime.store.getState();

    await user.click(complete);
    await settle();
    const alert = within(dock).getByRole('alert');
    expect(alert).toHaveTextContent('Illegal transition: idle → completed');
    expect(alert).toHaveTextContent(
      'Allowed from Idle: Start Planning, Start Work, Set Waiting, Start Review, Fail, Set Offline',
    );
    const after = runtime.store.getState();
    expect(after.agents).toBe(before.agents);
    expect(after.feed).toBe(before.feed);
  });

  it('same status → "No change · <name> is already <Status>"', async () => {
    fetchMock.mockResolvedValue(
      json(200, { data: { event: null, agent: makeAgent('04-backend-engineer'), task: null } }),
    );
    const { dock, user } = await openSimulator();
    await user.selectOptions(agentSelect(dock), '04-backend-engineer');
    const idle = within(dock).getByRole('button', { name: 'Set Idle (current)' });
    expect(idle).toHaveAttribute('aria-pressed', 'true');
    await user.click(idle);
    await settle();
    expect(within(dock).getByRole('status')).toHaveTextContent(
      'No change · Backend Engineer is already Idle',
    );
  });

  it('network failure → readable message and the store is unchanged', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { dock, user, runtime } = await openSimulator();
    await user.selectOptions(agentSelect(dock), '04-backend-engineer');
    const before = runtime.store.getState().agents;
    await user.click(within(dock).getByRole('button', { name: 'Start Planning' }));
    await settle();
    expect(within(dock).getByRole('alert')).toHaveTextContent(
      "Can't reach the server. Check that the backend is running.",
    );
    expect(runtime.store.getState().agents).toBe(before);
  });

  it('backend unavailable disables every action with a message', async () => {
    const { dock, runtime } = await openSimulator({
      api: {
        ...realWrites(),
        getHealth: () => Promise.reject(new ApiError(0, 'NETWORK_ERROR', 'Network error')),
      },
      ui: { selectedAgentId: '04-backend-engineer' },
    });
    expect(runtime.store.getState().connection.health).toBe('failing');
    expect(
      within(dock).getByText('Simulator is unavailable while the backend is offline.'),
    ).toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: 'Start Work' })).toBeDisabled();
    expect(within(dock).getByRole('button', { name: 'Send Event' })).toBeDisabled();
  });

  it('socket down but HTTP ok → actions stay enabled with the "Live updates are paused" note', async () => {
    const { dock, socket } = await openSimulator({
      ui: { selectedAgentId: '04-backend-engineer' },
    });
    act(() => socket.serverDrop());
    expect(
      within(dock).getByText('Live updates are paused — results will appear after reconnecting.'),
    ).toBeInTheDocument();
    expect(within(dock).getByRole('button', { name: 'Start Work' })).toBeEnabled();
  });
});

describe('Send Activity (UX §9.5, REQ-103)', () => {
  it('empty Action → "Action is required." and no request', async () => {
    const { dock, user } = await openSimulator({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.click(within(dock).getByRole('button', { name: 'Send Event' }));
    expect(within(dock).getByText('Action is required.')).toBeInTheDocument();
    expect(within(dock).getByRole('combobox', { name: 'Action' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('message > 2000 chars → validation message and counter, no request', async () => {
    const { dock, user } = await openSimulator({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.type(within(dock).getByRole('combobox', { name: 'Action' }), 'run_tests');
    const message = within(dock).getByRole('textbox', { name: 'Message' });
    await user.click(message);
    await user.paste('m'.repeat(2001));
    expect(within(dock).getByText('2,001/2,000')).toBeInTheDocument();
    await user.click(within(dock).getByRole('button', { name: 'Send Event' }));
    expect(
      within(dock).getByText('Message must be 2,000 characters or fewer.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the exact agent.activity body (Enter submits) and shows "Event sent"', async () => {
    const createdAt = new Date().toISOString();
    fetchMock.mockResolvedValue(
      json(201, {
        data: {
          event: makeEvent({
            id: 'act1',
            seq: 9100,
            action: 'run_tests',
            message: 'Running API tests',
            createdAt,
          }),
          agent: makeAgent('04-backend-engineer', {
            version: 2,
            currentAction: 'run_tests',
            lastMessage: 'Running API tests',
          }),
          task: null,
        },
      }),
    );
    const { dock, user, runtime } = await openSimulator({
      ui: { selectedAgentId: '04-backend-engineer' },
    });
    await user.type(within(dock).getByRole('combobox', { name: 'Action' }), 'run_tests');
    await user.selectOptions(within(dock).getByRole('combobox', { name: 'Severity' }), 'Warning');
    await user.type(
      within(dock).getByRole('textbox', { name: 'Message' }),
      'Running API tests{Enter}',
    );
    await settle();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/events');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      type: 'agent.activity',
      source: 'simulator',
      agentId: '04-backend-engineer',
      action: 'run_tests',
      message: 'Running API tests',
      severity: 'warning',
      project: 'sellway',
    });
    expect(within(dock).getByRole('status')).toHaveTextContent(
      /^Event sent · run_tests · \d\d:\d\d:\d\d$/,
    );
    expect(runtime.store.getState().agents['04-backend-engineer']?.currentAction).toBe('run_tests');
    expect(runtime.store.getState().feed.some((e) => e.id === 'act1')).toBe(true);
  });

  it('400 shows the server message with the first issue', async () => {
    fetchMock.mockResolvedValue(
      json(422, {
        error: {
          code: 'UNKNOWN_PROJECT',
          message: 'Unknown project: x',
          details: { project: 'x' },
        },
      }),
    );
    const { dock, user } = await openSimulator({ ui: { selectedAgentId: '04-backend-engineer' } });
    await user.type(within(dock).getByRole('combobox', { name: 'Action' }), 'build{Enter}');
    await settle();
    expect(within(dock).getByRole('alert')).toHaveTextContent('Unknown project: x');
  });
});

describe('simulator open/close (UX §9.1)', () => {
  it('X closes and returns focus to the top-bar button', async () => {
    const { dock, user } = await openSimulator();
    await user.click(within(dock).getByRole('button', { name: 'Close Developer Simulator' }));
    expect(screen.queryByRole('region', { name: 'Developer Simulator' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Simulator' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Simulator' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('write responses are buffered during a resync and replayed after it', async () => {
    const { runtime } = await renderApp();
    const resync = runtime.sync.resync();
    runtime.actions.applyWriteResult({
      event: makeEvent({ id: 'w-buf', seq: 9999 }),
      agent: makeAgent('04-backend-engineer', { status: 'working', version: 9 }),
      task: null,
    });
    expect(runtime.sync.bufferSize()).toBe(1);
    await act(async () => {
      await resync;
    });
    expect(runtime.store.getState().agents['04-backend-engineer']?.status).toBe('working');
  });
});

describe('error code coverage', () => {
  it('ApiError carries server codes', () => {
    expect(new ApiError(409, 'ILLEGAL_TRANSITION', 'x').code).toBe('ILLEGAL_TRANSITION');
  });
});
