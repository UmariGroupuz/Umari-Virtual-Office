// localStorage access wrapped in try/catch (API-C §10.3): storage may be unavailable (private mode, policy).

export const STORAGE_KEYS = {
  hideDemo: 'vo.feed.hideDemo',
  simulatorOpen: 'vo.simulator.open',
} as const;

export function readBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Persistence is a convenience only; ignore storage failures.
  }
}
