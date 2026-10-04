// OfficeCanvas seam (API-C §10.2): mounts/unmounts the single game, pushes props into the bridge and forwards
// callbacks. The Phaser runtime is faked (jsdom has no canvas); the gameManager itself is real.
import { act, render, screen } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeBridge } from './bridge';
import type { OfficeCanvasProps } from './OfficeCanvas';
import { makeAllAgents } from './testFixtures';

const runtime = vi.hoisted(() => ({
  created: [] as { parent: HTMLElement; bridge: OfficeBridge; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock('./runtime', () => ({
  createOfficeGame: (parent: HTMLElement, bridge: OfficeBridge) => {
    const handle = {
      parent,
      bridge,
      resize: vi.fn(),
      updateBounds: vi.fn(),
      clearHover: vi.fn(),
      destroy: vi.fn(),
    };
    runtime.created.push(handle);
    return handle;
  },
}));

const env = vi.hoisted(() => ({ supported: true }));

vi.mock('./gameManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gameManager')>();
  return { ...actual, canRenderOffice: () => env.supported };
});

const { default: OfficeCanvas } = await import('./OfficeCanvas');
const manager = await import('./gameManager');

function props(overrides: Partial<OfficeCanvasProps> = {}): OfficeCanvasProps {
  return {
    agents: makeAllAgents(),
    projectFilter: null,
    selectedAgentId: null,
    reducedMotion: false,
    paused: false,
    onAgentSelect: vi.fn(),
    onBackgroundClick: vi.fn(),
    onAgentHover: vi.fn(),
    ...overrides,
  };
}

async function renderCanvas(p: OfficeCanvasProps, strict = false) {
  const tree = (
    <Suspense fallback={<div>Loading office…</div>}>
      <OfficeCanvas {...p} />
    </Suspense>
  );
  // Async act: the `use()` suspension resolves in a microtask that must be flushed inside act.
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    await Promise.resolve();
  });
  await screen.findByTestId('office-canvas');
  return result!;
}

async function flushDeferredDestroy() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

describe('OfficeCanvas', () => {
  beforeAll(async () => {
    // Resolve the (mocked) dynamic import once so the Suspense round-trip is fast in every test.
    await manager.loadOfficeRuntime();
  });

  beforeEach(() => {
    env.supported = true;
    runtime.created.length = 0;
  });

  afterEach(() => {
    manager.resetOfficeManagerForTests();
  });

  it('renders one full-size div and creates exactly one game under StrictMode', async () => {
    await renderCanvas(props({ className: 'office-host' }), true);
    await flushDeferredDestroy();
    const host = screen.getByTestId('office-canvas');
    expect(host).toHaveClass('office-host');
    expect(host).toHaveStyle({ width: '100%', height: '100%', position: 'relative' });
    expect(runtime.created).toHaveLength(1);
    expect(runtime.created[0]?.parent).toBe(host);
    expect(runtime.created[0]?.destroy).not.toHaveBeenCalled();
  });

  it('destroys the game on a real unmount', async () => {
    const { unmount } = await renderCanvas(props());
    expect(runtime.created).toHaveLength(1);
    unmount();
    await flushDeferredDestroy();
    expect(runtime.created[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(manager.hasOfficeGame()).toBe(false);
  });

  it('re-rendering with new props never re-creates the game and pushes props into the bridge', async () => {
    const p = props();
    const { rerender } = await renderCanvas(p);
    const bridge = manager.getOfficeBridge();
    expect(bridge.getState().agents).toBe(p.agents);

    const agents = p.agents.map((a, i) =>
      i === 3 ? { ...a, status: 'working' as const, version: 2 } : a,
    );
    rerender(
      <Suspense fallback={null}>
        <OfficeCanvas
          {...p}
          agents={agents}
          projectFilter="sellway"
          selectedAgentId="04-backend-engineer"
          reducedMotion
          paused
        />
      </Suspense>,
    );
    expect(bridge.getState()).toEqual({
      agents,
      projectFilter: 'sellway',
      selectedAgentId: '04-backend-engineer',
      reducedMotion: true,
      paused: true,
    });
    expect(runtime.created).toHaveLength(1);
  });

  it('forwards scene events to the latest callbacks', async () => {
    const first = props();
    const { rerender } = await renderCanvas(first);
    const bridge = runtime.created[0]!.bridge;

    const onAgentSelect = vi.fn();
    const onBackgroundClick = vi.fn();
    const onAgentHover = vi.fn();
    rerender(
      <Suspense fallback={null}>
        <OfficeCanvas
          {...first}
          onAgentSelect={onAgentSelect}
          onBackgroundClick={onBackgroundClick}
          onAgentHover={onAgentHover}
        />
      </Suspense>,
    );

    bridge.selectAgent('09-qa-engineer');
    bridge.clickBackground();
    const hover = { agentId: '09-qa-engineer', x: 10, y: 20, width: 58, height: 100 };
    bridge.hoverAgent(hover);
    bridge.hoverAgent(null);

    expect(onAgentSelect).toHaveBeenCalledWith('09-qa-engineer');
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(onAgentHover.mock.calls).toEqual([[hover], [null]]);
    expect(first.onAgentSelect).not.toHaveBeenCalled();
  });

  it('detaches callbacks after unmount', async () => {
    const p = props();
    const { unmount } = await renderCanvas(p);
    const bridge = runtime.created[0]!.bridge;
    unmount();
    bridge.selectAgent('01-pm-orchestrator');
    expect(p.onAgentSelect).not.toHaveBeenCalled();
  });

  it('never loads Phaser where a canvas game cannot run (jsdom / shell tests)', async () => {
    env.supported = false;
    await renderCanvas(props());
    await flushDeferredDestroy();
    expect(runtime.created).toHaveLength(0);
    expect(screen.getByTestId('office-canvas')).toBeEmptyDOMElement();
  });
});
