// Health polling (UX §11.1, REQ-142): every 15 s while OK, every 5 s while failing, and on demand.
import { isAborted } from './client';

export type HealthStatus = 'checking' | 'ok' | 'failing';

export const HEALTH_INTERVAL_OK_MS = 15_000;
export const HEALTH_INTERVAL_FAILING_MS = 5_000;

export interface HealthMonitorOptions {
  check: (signal: AbortSignal) => Promise<unknown>;
  onResult: (result: { status: 'ok' | 'failing'; nextCheckAt: number; error?: unknown }) => void;
  now?: () => number;
}

export interface HealthMonitor {
  start(): void;
  /** Runs a check immediately (cancels the pending timer and any in-flight check). */
  checkNow(): Promise<void>;
  stop(): void;
}

export function createHealthMonitor(options: HealthMonitorOptions): HealthMonitor {
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let running = false;

  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void checkNow();
    }, delay);
  };

  async function checkNow(): Promise<void> {
    if (!running) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    try {
      await options.check(controller.signal);
      if (inflight !== controller || !running) return;
      inflight = null;
      options.onResult({ status: 'ok', nextCheckAt: now() + HEALTH_INTERVAL_OK_MS });
      schedule(HEALTH_INTERVAL_OK_MS);
    } catch (error) {
      if (inflight !== controller || !running) return;
      inflight = null;
      if (isAborted(error) && controller.signal.aborted) return;
      options.onResult({
        status: 'failing',
        nextCheckAt: now() + HEALTH_INTERVAL_FAILING_MS,
        error,
      });
      schedule(HEALTH_INTERVAL_FAILING_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void checkNow();
    },
    checkNow,
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      inflight?.abort();
      inflight = null;
    },
  };
}
