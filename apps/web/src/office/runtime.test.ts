// QA-5 regression at the game-config level: Phaser must not listen to window-level presses (their DOM target is
// not the canvas). Phaser itself cannot run in jsdom, so it is replaced by a minimal fake.
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock('phaser', () => {
  class Game {
    isBooted = false;
    canvas = null;
    events = { once: vi.fn() };
    scene = { add: vi.fn(), getScene: vi.fn(() => null) };
    destroy = vi.fn();
    constructor(config: unknown) {
      fake.configs.push(config);
    }
  }
  return {
    AUTO: 0,
    Game,
    Scale: { RESIZE: 5 },
    Core: { Events: { BOOT: 'boot' } },
  };
});

vi.mock('./OfficeScene', () => ({ OFFICE_SCENE_KEY: 'office', OfficeScene: class {} }));

const { buildGameConfig, createOfficeGame } = await import('./runtime');
const { createOfficeBridge } = await import('./bridge');

describe('office game config', () => {
  it('disables Phaser window events so overlapping DOM UI never clicks a desk (QA-5)', () => {
    const config = buildGameConfig(document.createElement('div'));
    expect(config.input).toMatchObject({ windowEvents: false, keyboard: false, gamepad: false });
  });

  it('keeps the RESIZE scale mode without touching the parent/body styles', () => {
    const config = buildGameConfig(document.createElement('div'));
    expect(config.scale).toMatchObject({ mode: 5, expandParent: false });
    expect(config.autoFocus).toBe(false);
    expect(config.width).toBeGreaterThanOrEqual(1);
    expect(config.height).toBeGreaterThanOrEqual(1);
  });

  it('creates the game with that config', () => {
    const handle = createOfficeGame(document.createElement('div'), createOfficeBridge());
    expect(fake.configs).toHaveLength(1);
    expect(fake.configs[0]).toMatchObject({ input: { windowEvents: false } });
    handle.destroy();
    handle.destroy(); // idempotent
  });
});
