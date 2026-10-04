// Viewport size and layout mode (UX §2.1). Structural layout differs per mode, so it is decided in JS.
import { useEffect, useState, useSyncExternalStore } from 'react';

export type LayoutMode = 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'wide' | 'ultra';

export function getLayoutMode(width: number): LayoutMode {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1280) return 'laptop';
  if (width < 1600) return 'desktop';
  if (width < 1760) return 'wide';
  return 'ultra';
}

/** Desktop shell (viewport-locked, ≥ 1280). */
export function isShellMode(mode: LayoutMode): boolean {
  return mode === 'desktop' || mode === 'wide' || mode === 'ultra';
}

/** Right (feed) column width per UX §2.1. */
export function rightColumnWidth(width: number): number {
  if (width >= 1760) return 360;
  if (width >= 1600) return 400;
  if (width >= 1440) return 360;
  return 320;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 1440,
  );
}

export function useViewportHeight(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerHeight,
    () => 900,
  );
}

export function useLayoutMode(): LayoutMode {
  return getLayoutMode(useViewportWidth());
}

/** Returns `value` after it stayed unchanged for `delayMs` (initial value immediately). */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
