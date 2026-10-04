// Demo mode payloads (API_CONTRACTS §1.5, ADR-011/022).

export interface DemoState {
  active: boolean;
  intervalMs: number; // current interval when active, else the configured default
  startedAt: string | null; // null when inactive
}

export interface DemoRestoreSummary {
  agentsRestored: number; // snapshot agents restored (not user-touched, differed)
  agentsKept: number; // user-touched agents left as they are
  tasksRestored: number;
  tasksKept: number;
  tasksDeleted: number; // demo-created, not user-touched
}

export interface DemoStopResult {
  demo: DemoState;
  restored: DemoRestoreSummary | null; // null = demo was not running
}
