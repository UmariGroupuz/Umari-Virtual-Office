// One shared 1 s ticker for the clock, running durations and relative times (ARCHITECTURE §7).
import { useSyncExternalStore } from 'react';
import { useOffice } from '../lib/runtime';

let current = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function tick() {
  current = Date.now();
  for (const listener of listeners) listener();
  // Align to the next second boundary so the clock flips exactly on the second.
  timer = setTimeout(tick, 1000 - (current % 1000));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setTimeout(tick, 1000 - (current % 1000));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => current;

/** Client time in ms, updated every second while any component uses it. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Client time corrected by the snapshot `serverTime` offset (durations, relative times). */
export function useServerNow(): number {
  const now = useNow();
  const offset = useOffice((s) => s.serverTimeOffsetMs);
  return now + offset;
}
