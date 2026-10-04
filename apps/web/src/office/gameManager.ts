// Page-level owner of the single Phaser game (REQ-075, ADR-012, risk R-3). Plain module outside React:
// - at most one game exists; React StrictMode's mount → unmount → mount on the same host reuses it because the
//   destroy is deferred by one macrotask and cancelled by the re-mount;
// - a real unmount destroys it; mounting on a different host releases the old game first;
// - Phaser is loaded lazily (dynamic import of `./runtime`) and never in jsdom.
import { createOfficeBridge, type OfficeBridge } from './bridge';
import type { OfficeGameHandle } from './runtime';

type RuntimeModule = typeof import('./runtime');

interface MountEntry {
  parent: HTMLElement;
  handle: OfficeGameHandle | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  detachDom: () => void;
}

const bridge: OfficeBridge = createOfficeBridge();
let runtime: RuntimeModule | null = null;
let runtimePromise: Promise<boolean> | null = null;
let entry: MountEntry | null = null;

/** The page-level bridge: OfficeCanvas writes props into it, the scene subscribes to it. */
export function getOfficeBridge(): OfficeBridge {
  return bridge;
}

/** False where a canvas game cannot run (server rendering, jsdom tests): OfficeCanvas then renders only its div. */
export function canRenderOffice(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !/\bjsdom\b/i.test(navigator.userAgent)
  );
}

/** Loads Phaser + the scene once. Resolves `false` (and logs) when the chunk cannot be loaded. Stable promise. */
export function loadOfficeRuntime(): Promise<boolean> {
  runtimePromise ??= import('./runtime').then(
    (module) => {
      runtime = module;
      return true;
    },
    (error: unknown) => {
      console.error('[office] Failed to load the office renderer.', error);
      return false;
    },
  );
  return runtimePromise;
}

/** Mounts the office into `parent` (idempotent for the same parent). */
export function mountOffice(parent: HTMLElement): void {
  if (entry) {
    if (entry.destroyTimer !== null) {
      clearTimeout(entry.destroyTimer);
      entry.destroyTimer = null;
    }
    if (entry.parent === parent) return; // StrictMode re-mount or repeated call: reuse
    releaseEntry(entry); // a different host: never keep two games
    entry = null;
  }
  const next: MountEntry = { parent, handle: null, destroyTimer: null, detachDom: noop };
  entry = next;
  if (runtime) {
    startGame(next, runtime);
    return;
  }
  void loadOfficeRuntime().then((ok) => {
    if (ok && runtime && entry === next && next.handle === null) startGame(next, runtime);
  });
}

/** Schedules the destroy (next macrotask) so an immediate re-mount of the same host can cancel it. */
export function unmountOffice(parent: HTMLElement): void {
  const current = entry;
  if (!current || current.parent !== parent || current.destroyTimer !== null) return;
  current.destroyTimer = setTimeout(() => {
    current.destroyTimer = null;
    if (entry === current) {
      releaseEntry(current);
      entry = null;
    }
  }, 0);
}

/** True while a game is owned by the manager (including during the deferred-destroy window). */
export function hasOfficeGame(): boolean {
  return entry?.handle != null;
}

/** Test helper: drops every module-level reference (does not touch the bridge state). */
export function resetOfficeManagerForTests(): void {
  if (entry) releaseEntry(entry);
  entry = null;
}

function startGame(target: MountEntry, module: RuntimeModule): void {
  target.handle = module.createOfficeGame(target.parent, bridge);
  target.detachDom = attachDom(target);
}

function releaseEntry(target: MountEntry): void {
  if (target.destroyTimer !== null) clearTimeout(target.destroyTimer);
  target.destroyTimer = null;
  target.detachDom();
  target.detachDom = noop;
  target.handle?.destroy();
  target.handle = null;
}

/**
 * Host listeners: size changes (ResizeObserver), canvas bounds before pointer handling, tooltip hide on scroll.
 * CR-14: the canvas page position (a layout read) is refreshed before every pointerdown, but on pointermove only
 * after something may have moved it (pointer re-entered the host, scroll, window or host resize).
 */
function attachDom(target: MountEntry): () => void {
  const { parent } = target;
  let boundsDirty = true;
  const markDirty = () => {
    boundsDirty = true;
  };
  const refreshBounds = () => {
    boundsDirty = false;
    target.handle?.updateBounds();
  };
  const onPointerDown = () => refreshBounds();
  const onPointerMove = () => {
    if (boundsDirty) refreshBounds();
  };
  const onScroll = () => {
    boundsDirty = true;
    target.handle?.clearHover();
  };
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          boundsDirty = true;
          target.handle?.resize();
        })
      : null;
  observer?.observe(parent);
  parent.addEventListener('pointerdown', onPointerDown, true);
  parent.addEventListener('pointermove', onPointerMove, true);
  parent.addEventListener('pointerenter', markDirty);
  window.addEventListener('resize', markDirty, { passive: true });
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    observer?.disconnect();
    parent.removeEventListener('pointerdown', onPointerDown, true);
    parent.removeEventListener('pointermove', onPointerMove, true);
    parent.removeEventListener('pointerenter', markDirty);
    window.removeEventListener('resize', markDirty);
    window.removeEventListener('scroll', onScroll, { capture: true });
  };
}

function noop(): void {}
