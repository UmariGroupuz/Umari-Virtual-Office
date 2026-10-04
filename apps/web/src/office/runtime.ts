// Phaser game factory. This is the only module that constructs a `Phaser.Game`; `gameManager.ts` loads it with a
// dynamic import so Phaser (~1.2 MB) is fetched only when the office actually mounts and never in jsdom tests.
import * as Phaser from 'phaser';
import { UI_COLORS } from '@vo/shared';
import type { OfficeBridge } from './bridge';
import { OFFICE_SCENE_KEY, OfficeScene, type OfficeSceneData } from './OfficeScene';

export interface OfficeGameHandle {
  /** Re-measures the host element (called from a ResizeObserver). */
  resize(): void;
  /** Refreshes the cached canvas page bounds so hit-testing survives scroll containers and layout shifts. */
  updateBounds(): void;
  /** Hides the HTML tooltip (page scroll). */
  clearHover(): void;
  destroy(): void;
}

function styleCanvas(canvas: HTMLCanvasElement): void {
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.display = 'block';
  canvas.style.outline = 'none';
  canvas.setAttribute('tabindex', '-1'); // UX §5.1: the roster is the keyboard equivalent
}

/** Game config for the office (exported for the QA-5 regression test). */
export function buildGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: Math.max(1, parent.clientWidth),
    height: Math.max(1, parent.clientHeight),
    backgroundColor: UI_COLORS.bgSunken,
    banner: false,
    autoFocus: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    // QA-5: `windowEvents` (default true) makes Phaser process window-level mousedown/mouseup/touchstart whose
    // target is NOT the canvas, so clicks on DOM UI layered over the office area hit the desks underneath.
    input: { keyboard: false, gamepad: false, windowEvents: false },
    render: { antialias: true, roundPixels: true, powerPreference: 'low-power' },
    scale: { mode: Phaser.Scale.RESIZE, expandParent: false, autoRound: true },
  };
}

export function createOfficeGame(parent: HTMLElement, bridge: OfficeBridge): OfficeGameHandle {
  const game = new Phaser.Game(buildGameConfig(parent));
  const data: OfficeSceneData = { bridge };
  game.scene.add(OFFICE_SCENE_KEY, OfficeScene, true, data);

  if (game.isBooted && game.canvas) styleCanvas(game.canvas);
  else game.events.once(Phaser.Core.Events.BOOT, () => styleCanvas(game.canvas));

  const scene = (): OfficeScene | null => {
    const s = game.scene.getScene(OFFICE_SCENE_KEY);
    return s instanceof OfficeScene ? s : null;
  };

  let destroyed = false;
  return {
    resize() {
      // Same as Phaser's own poll: re-read the parent size first (refresh() alone would use the stale size
      // and then cache the new one, so the change would never be applied).
      if (!destroyed && game.isBooted && game.scale.getParentBounds()) game.scale.refresh();
    },
    updateBounds() {
      if (!destroyed && game.isBooted) game.scale.updateBounds();
    },
    clearHover() {
      if (!destroyed) scene()?.clearHoverInfo();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // Phaser finishes the destroy on its next step and removes the canvas from the host.
      game.destroy(true);
    },
  };
}
