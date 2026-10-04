// Single-instance behavior of the game manager (REQ-075, R-3). Phaser cannot run in jsdom, so the runtime
// module (the only place that constructs a Phaser.Game) is replaced by a fake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeBridge } from './bridge';

interface FakeHandle {
  parent: HTMLElement;
  bridge: OfficeBridge;
  resize: ReturnType<typeof vi.fn>;
  updateBounds: ReturnType<typeof vi.fn>;
  clearHover: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const created: FakeHandle[] = [];

vi.mock('./runtime', () => ({
  createOfficeGame: vi.fn((parent: HTMLElement, bridge: OfficeBridge) => {
    const handle: FakeHandle = {
      parent,
      bridge,
      resize: vi.fn(),
      updateBounds: vi.fn(),
      clearHover: vi.fn(),
      destroy: vi.fn(),
    };
    created.push(handle);
    return handle;
  }),
}));

const manager = await import('./gameManager');

function liveGames(): number {
  return created.filter((h) => h.destroy.mock.calls.length === 0).length;
}

describe('gameManager', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    created.length = 0;
    await manager.loadOfficeRuntime();
  });

  afterEach(() => {
    manager.resetOfficeManagerForTests();
    vi.useRealTimers();
  });

  it('loads the runtime once (stable promise) and resolves true', async () => {
    const a = manager.loadOfficeRuntime();
    const b = manager.loadOfficeRuntime();
    expect(a).toBe(b);
    await expect(a).resolves.toBe(true);
  });

  it('creates exactly one game for a host and passes the page bridge', () => {
    const host = document.createElement('div');
    manager.mountOffice(host);
    manager.mountOffice(host); // repeated call is idempotent
    expect(created).toHaveLength(1);
    expect(created[0]?.parent).toBe(host);
    expect(created[0]?.bridge).toBe(manager.getOfficeBridge());
    expect(manager.hasOfficeGame()).toBe(true);
  });

  it('StrictMode mount → unmount → mount reuses the same game', () => {
    const host = document.createElement('div');
    manager.mountOffice(host);
    manager.unmountOffice(host);
    manager.mountOffice(host);
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]?.destroy).not.toHaveBeenCalled();
    expect(liveGames()).toBe(1);
  });

  it('a real unmount destroys the game on the next macrotask', () => {
    const host = document.createElement('div');
    manager.mountOffice(host);
    manager.unmountOffice(host);
    expect(created[0]?.destroy).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(created[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(manager.hasOfficeGame()).toBe(false);
  });

  it('mount → unmount → mount → unmount across time creates a fresh game and never two live ones', () => {
    const host = document.createElement('div');
    manager.mountOffice(host);
    manager.unmountOffice(host);
    vi.runAllTimers();
    manager.mountOffice(host);
    expect(created).toHaveLength(2);
    expect(liveGames()).toBe(1);
    manager.unmountOffice(host);
    vi.runAllTimers();
    expect(liveGames()).toBe(0);
    expect(created.every((h) => h.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('mounting into a different host releases the previous game first', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    manager.mountOffice(a);
    manager.unmountOffice(a); // pending destroy
    manager.mountOffice(b);
    expect(created).toHaveLength(2);
    expect(created[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(liveGames()).toBe(1);
    vi.runAllTimers();
    expect(liveGames()).toBe(1);
  });

  it('ignores an unmount for a host it does not own', () => {
    const a = document.createElement('div');
    manager.mountOffice(a);
    manager.unmountOffice(document.createElement('div'));
    vi.runAllTimers();
    expect(created[0]?.destroy).not.toHaveBeenCalled();
  });

  it('refreshes canvas bounds before pointer handling and hides the tooltip on scroll', () => {
    const host = document.createElement('div');
    document.body.append(host);
    manager.mountOffice(host);
    const handle = created[0];
    const move = () => host.dispatchEvent(new Event('pointermove', { bubbles: true }));
    move(); // bounds start dirty → one layout read
    move();
    move();
    expect(handle?.updateBounds).toHaveBeenCalledTimes(1); // CR-14: not on every move
    host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(handle?.updateBounds).toHaveBeenCalledTimes(2); // always before a press
    window.dispatchEvent(new Event('scroll'));
    expect(handle?.clearHover).toHaveBeenCalledTimes(1);
    move(); // scroll may have moved the canvas
    move();
    expect(handle?.updateBounds).toHaveBeenCalledTimes(3);
    host.dispatchEvent(new Event('pointerenter'));
    move();
    window.dispatchEvent(new Event('resize'));
    move();
    expect(handle?.updateBounds).toHaveBeenCalledTimes(5);

    manager.unmountOffice(host);
    vi.runAllTimers();
    host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('scroll'));
    expect(handle?.updateBounds).toHaveBeenCalledTimes(5); // listeners removed with the game
    expect(handle?.clearHover).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('reports jsdom as an environment that cannot render the office', () => {
    expect(manager.canRenderOffice()).toBe(false);
  });
});
