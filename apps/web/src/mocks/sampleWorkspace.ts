// SAMPLE DATA — NOT CONNECTED (Phase 1, REQ-082). Deterministic Files/Git content per agent id from a seeded
// generator: stable across renders and reloads, never reads the filesystem or git. Shown only under the
// permanent "Sample data — not connected (Phase 1)" notice.
import type { RoomId } from '@vo/shared';

export type ChangeKind = 'M' | 'A' | 'D';

export interface SampleFile {
  kind: ChangeKind;
  path: string;
  /** Pre-rendered relative age ("12m ago"): sample data has no real timestamps. */
  age: string;
}

export interface SampleCommit {
  hash: string;
  message: string;
  age: string;
}

export interface SampleWorkspace {
  files: SampleFile[];
  branch: string;
  commits: SampleCommit[];
  counts: { modified: number; added: number; deleted: number };
}

/** FNV-1a 32-bit hash of a string. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATHS: Record<RoomId, string[]> = {
  management: [
    'docs/PLAN.md',
    'tasks/ACTIVE.md',
    'tasks/BACKLOG.md',
    'docs/REQUIREMENTS.md',
    'docs/ARCHITECTURE.md',
    'docs/DECISIONS.md',
    'tasks/reports/TASK-012-audit.md',
  ],
  development: [
    'apps/server/src/api/routes/lostGoods.ts',
    'apps/server/src/services/claimService.ts',
    'apps/server/test/lostGoods.test.ts',
    'apps/web/src/dashboard/PerformancePanel.tsx',
    'apps/web/src/hooks/useOrders.ts',
    'apps/server/src/db/migrations/004_claims.ts',
    'apps/mobile/src/screens/SellerHome.tsx',
    'packages/shared/src/types/order.ts',
  ],
  design: [
    'design/flows/vacancy-posting.fig.json',
    'docs/UX.md',
    'design/tokens/colors.json',
    'design/screens/checkout.md',
    'design/components/empty-states.md',
  ],
  infrastructure: [
    '.github/workflows/ci.yml',
    'docker/Dockerfile.server',
    'scripts/deploy.mjs',
    'docs/SECURITY.md',
    'infra/nginx.conf',
    'docs/DEPLOYMENT.md',
  ],
  quality: [
    'tests/e2e/orders.spec.ts',
    'tests/e2e/checkout.spec.ts',
    'apps/server/test/inventory.test.ts',
    'tasks/reports/TASK-009-qa.md',
    'tests/fixtures/orders.json',
  ],
  'ai-lab': [
    'services/bot/src/handlers/vacancy.ts',
    'services/bot/src/prompts/intake.md',
    'services/bot/test/handlers.test.ts',
    'services/bot/src/telegram.ts',
    'notebooks/matching-eval.md',
  ],
  documentation: [
    'README.md',
    'docs/PROJECT.md',
    'docs/guides/getting-started.md',
    'docs/api/events.md',
    'CHANGELOG.md',
  ],
  audit: [
    'tasks/reports/TASK-010-audit.md',
    'docs/REQUIREMENTS.md',
    'docs/audit/checklist.md',
    'tasks/BLOCKED.md',
    'docs/audit/findings.md',
  ],
};

const BRANCHES: Record<RoomId, string[]> = {
  management: ['planning/q4-roadmap', 'docs/sprint-12-plan'],
  development: [
    'feature/sw-123-lost-goods-api',
    'feature/sw-124-dashboard-perf',
    'feature/am-401-seller-dashboard',
    'feature/ik-202-recruitment-schema',
  ],
  design: ['design/ik-201-vacancy-flow', 'design/empty-states'],
  infrastructure: ['ci/cache-dependencies', 'security/erp-303-crm-review'],
  quality: ['test/erp-302-order-regression', 'test/e2e-checkout'],
  'ai-lab': ['feature/ik-203-telegram-bot', 'ai/matching-prompts'],
  documentation: ['docs/readme-refresh', 'docs/api-events'],
  audit: ['audit/phase-1-review', 'audit/requirements-trace'],
};

const COMMITS: Record<RoomId, string[]> = {
  management: [
    'Plan sprint 12 tasks',
    'Assign ERP-303 to Security',
    'Update backlog priorities',
    'Record ADR for demo mode',
    'Close TASK-007 review notes',
  ],
  development: [
    'Add claim endpoint validation',
    'Cache dashboard aggregates',
    'Fix pagination cursor off-by-one',
    'Add migration for claims table',
    'Extract order totals helper',
    'Handle empty seller list',
  ],
  design: [
    'Refine vacancy form spacing',
    'Add empty-state illustrations spec',
    'Update color tokens contrast',
    'Document checkout error states',
  ],
  infrastructure: [
    'Cache npm in CI',
    'Pin base image digest',
    'Add rate limit to webhook',
    'Rotate staging credentials doc',
  ],
  quality: [
    'Add order regression test',
    'Stabilize checkout e2e waits',
    'Cover inventory edge cases',
    'Report ERP-302 failure details',
  ],
  'ai-lab': [
    'Add vacancy intake handler',
    'Tune matching prompt',
    'Mock Telegram API in tests',
    'Log bot latency metrics',
  ],
  documentation: [
    'Document event envelope',
    'Refresh getting-started guide',
    'Add changelog for 0.1.0',
    'Fix broken links in README',
  ],
  audit: [
    'Trace REQ-060 to tests',
    'Flag missing empty state',
    'Update audit checklist',
    'Record Phase 1 findings',
  ],
};

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)] as T;
}

function age(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Deterministic sample workspace for an agent (same id → same result). */
export function sampleWorkspace(agentId: string, roomId: RoomId): SampleWorkspace {
  const rand = prng(hash(agentId));
  const pool = [...PATHS[roomId]];
  const fileCount = 5 + Math.floor(rand() * 2); // 5–6 rows
  const files: SampleFile[] = [];
  let minutes = 2 + Math.floor(rand() * 6);
  for (let i = 0; i < fileCount && pool.length > 0; i += 1) {
    const index = Math.floor(rand() * pool.length);
    const [path] = pool.splice(index, 1);
    const roll = rand();
    const kind: ChangeKind = roll < 0.62 ? 'M' : roll < 0.9 ? 'A' : 'D';
    files.push({ kind, path: path ?? 'README.md', age: age(minutes) });
    minutes += 3 + Math.floor(rand() * 25);
  }
  const counts = {
    modified: files.filter((f) => f.kind === 'M').length,
    added: files.filter((f) => f.kind === 'A').length,
    deleted: files.filter((f) => f.kind === 'D').length,
  };

  const messages = [...COMMITS[roomId]];
  const commitCount = 3 + Math.floor(rand() * 3); // 3–5 rows
  const commits: SampleCommit[] = [];
  let commitMinutes = 20 + Math.floor(rand() * 40);
  for (let i = 0; i < commitCount && messages.length > 0; i += 1) {
    const index = Math.floor(rand() * messages.length);
    const [message] = messages.splice(index, 1);
    const hex = Math.floor(rand() * 0xfffffff)
      .toString(16)
      .padStart(7, '0');
    commits.push({ hash: hex, message: message ?? 'Update files', age: age(commitMinutes) });
    commitMinutes += 30 + Math.floor(rand() * 240);
  }

  return { files, branch: pick(BRANCHES[roomId], rand), commits, counts };
}
