// `prefers-reduced-motion` evaluated via matchMedia and re-applied on change without reload (UX §14).
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function getMedia(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

function subscribe(listener: () => void): () => void {
  const media = getMedia();
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getMedia()?.matches ?? false,
    () => false,
  );
}
