// Seed baseline data — API_CONTRACTS §7 (binding; REQ-120/121). Times are minutes before the seed
// clock `now`. Agents' reference fields come from `@vo/shared` (AGENT_REFERENCE, PROJECTS); this file only
// holds the seeded *state* and the history.
//
// Consistency rules (asserted by seed.test.ts with an independent replay):
// - every status-changing agent event carries an explicit `status` (stored verbatim, as a producer would
//   send it), and the last status event of each agent leads to its seeded state (§7.3);
// - generic events (status.changed / activity / message) only move a task when they change the agent's
//   status and the agent owns the task; task progress only moves with `agent.task.progress`;
// - agents start the window `idle`; tasks created before the window start `assigned` (or `todo` when
//   their first in-window event is the assignment).
import type {
  AgentStatus,
  EventType,
  JsonObject,
  Severity,
  TaskPriority,
  TaskStatus,
} from '@vo/shared';

export interface SeedTask {
  id: string;
  title: string;
  description: string;
  project: string;
  assignedAgentId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  blockedBy: string[];
  createdMinutesAgo: number;
  /** First entry into `in_progress` (only tasks that passed it). */
  startedMinutesAgo: number | null;
  completedMinutesAgo: number | null;
  /** Time of the last event that changed the task row. */
  updatedMinutesAgo: number;
}

export interface SeedAgentState {
  status: AgentStatus;
  currentProject: string | null;
  taskId: string | null;
  progress: number;
  /** Entry into the current run of active statuses (kept for completed/failed). */
  startedMinutesAgo: number | null;
  currentAction: string | null;
}

export interface SeedHistoryEntry {
  minutesAgo: number;
  type: EventType;
  source: 'api' | 'simulator';
  agentId: string | null;
  project: string | null;
  taskId: string | null;
  status: AgentStatus | TaskStatus | null;
  action: string | null;
  message: string | null;
  /** Omitted → `info`. Must follow the ES §2.3 defaults (asserted by tests). */
  severity?: Severity;
  progress: number | null;
  metadata?: JsonObject;
}

export const PM = '01-pm-orchestrator';
export const PA = '02-product-analyst';
export const ARC = '03-architect';
export const BE = '04-backend-engineer';
export const FE = '05-frontend-engineer';
export const DBE = '06-database-engineer';
export const OPS = '07-devops-engineer';
export const SEC = '08-security-engineer';
export const QA = '09-qa-engineer';
export const UX = '10-ui-ux-designer';
export const MOB = '11-mobile-engineer';
export const AIE = '12-ai-engineer';
export const DOC = '13-documentation-engineer';
export const REV = '14-reviewer';
export const AUD = '15-product-auditor';

// §7.1 — 11 tasks.
// prettier-ignore
export const SEED_TASKS: readonly SeedTask[] = [
  { id: 'SW-123', title: 'Lost Goods API', description: 'REST endpoints for reporting, tracking and resolving lost goods claims.', project: 'sellway', assignedAgentId: BE, status: 'assigned', priority: 'high', progress: 0, blockedBy: [], createdMinutesAgo: 125, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 100 },
  { id: 'SW-124', title: 'Dashboard performance optimization', description: 'Cut the seller dashboard load time below one second on large accounts.', project: 'sellway', assignedAgentId: FE, status: 'in_progress', priority: 'normal', progress: 40, blockedBy: [], createdMinutesAgo: 150, startedMinutesAgo: 92, completedMinutesAgo: null, updatedMinutesAgo: 18 },
  { id: 'SW-125', title: 'Campaign analytics', description: 'Report conversion and revenue per marketing campaign.', project: 'sellway', assignedAgentId: null, status: 'todo', priority: 'low', progress: 0, blockedBy: [], createdMinutesAgo: 95, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 95 },
  { id: 'IK-201', title: 'Vacancy posting workflow', description: 'Guided flow for employers to create, preview and publish vacancies.', project: 'ishkun24', assignedAgentId: UX, status: 'completed', priority: 'normal', progress: 100, blockedBy: [], createdMinutesAgo: 175, startedMinutesAgo: 115, completedMinutesAgo: 50, updatedMinutesAgo: 50 },
  { id: 'IK-202', title: 'Recruitment pipeline', description: 'Candidate stages from application to offer, with history per candidate.', project: 'ishkun24', assignedAgentId: DBE, status: 'waiting', priority: 'high', progress: 20, blockedBy: ['IK-203'], createdMinutesAgo: 135, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 46 },
  { id: 'IK-203', title: 'Telegram bot integration', description: 'Notify candidates and employers about pipeline changes through a Telegram bot.', project: 'ishkun24', assignedAgentId: AIE, status: 'planning', priority: 'normal', progress: 10, blockedBy: [], createdMinutesAgo: 140, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 28 },
  { id: 'ERP-301', title: 'Inventory architecture', description: 'Stock ledger, warehouse and costing model for the ERP inventory module.', project: 'erp', assignedAgentId: ARC, status: 'review', priority: 'high', progress: 70, blockedBy: [], createdMinutesAgo: 170, startedMinutesAgo: 108, completedMinutesAgo: null, updatedMinutesAgo: 40 },
  { id: 'ERP-302', title: 'Order management module', description: 'Order entry, fulfilment and payment capture for the ERP sales flow.', project: 'erp', assignedAgentId: QA, status: 'failed', priority: 'critical', progress: 55, blockedBy: [], createdMinutesAgo: 165, startedMinutesAgo: 99, completedMinutesAgo: null, updatedMinutesAgo: 61 },
  { id: 'ERP-303', title: 'CRM integration', description: 'Synchronize customers and deals between the ERP and the external CRM.', project: 'erp', assignedAgentId: SEC, status: 'assigned', priority: 'normal', progress: 0, blockedBy: [], createdMinutesAgo: 110, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 88 },
  { id: 'AM-401', title: 'Seller dashboard', description: 'Mobile dashboard with sales, payouts and stock alerts for marketplace sellers.', project: 'ana-market', assignedAgentId: MOB, status: 'in_progress', priority: 'high', progress: 65, blockedBy: [], createdMinutesAgo: 160, startedMinutesAgo: 113, completedMinutesAgo: null, updatedMinutesAgo: 12 },
  { id: 'AM-402', title: 'Marketplace integration', description: 'Import listings and orders from partner marketplaces.', project: 'ana-market', assignedAgentId: null, status: 'todo', priority: 'critical', progress: 0, blockedBy: [], createdMinutesAgo: 70, startedMinutesAgo: null, completedMinutesAgo: null, updatedMinutesAgo: 44 },
];

// §7.2 — 15 agent states. `lastActivityAt`, `lastMessage` and `currentTask` are derived by seed.ts
// (last agent event of the agent, last message, title of `taskId`).
// prettier-ignore
export const SEED_AGENT_STATES: Readonly<Record<string, SeedAgentState>> = {
  [PM]:  { status: 'working',   currentProject: 'erp',        taskId: null,      progress: 0,   startedMinutesAgo: 25,   currentAction: 'assign_task' },
  [PA]:  { status: 'idle',      currentProject: 'sellway',    taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [ARC]: { status: 'reviewing', currentProject: 'erp',        taskId: 'ERP-301', progress: 70,  startedMinutesAgo: 108,  currentAction: 'review' },
  [BE]:  { status: 'idle',      currentProject: 'sellway',    taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [FE]:  { status: 'working',   currentProject: 'sellway',    taskId: 'SW-124',  progress: 40,  startedMinutesAgo: 92,   currentAction: 'edit_file' },
  [DBE]: { status: 'waiting',   currentProject: 'ishkun24',   taskId: 'IK-202',  progress: 20,  startedMinutesAgo: 84,   currentAction: 'wait' },
  [OPS]: { status: 'offline',   currentProject: 'erp',        taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [SEC]: { status: 'idle',      currentProject: null,         taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [QA]:  { status: 'failed',    currentProject: 'erp',        taskId: 'ERP-302', progress: 55,  startedMinutesAgo: 99,   currentAction: null },
  [UX]:  { status: 'completed', currentProject: 'ishkun24',   taskId: 'IK-201',  progress: 100, startedMinutesAgo: 115,  currentAction: null },
  [MOB]: { status: 'working',   currentProject: 'ana-market', taskId: 'AM-401',  progress: 65,  startedMinutesAgo: 113,  currentAction: 'build' },
  [AIE]: { status: 'planning',  currentProject: 'ishkun24',   taskId: 'IK-203',  progress: 10,  startedMinutesAgo: 56,   currentAction: null },
  [DOC]: { status: 'idle',      currentProject: null,         taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [REV]: { status: 'idle',      currentProject: 'sellway',    taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
  [AUD]: { status: 'idle',      currentProject: null,         taskId: null,      progress: 0,   startedMinutesAgo: null, currentAction: null },
};

// §7.3 — 44 historical events over the past ~2 h, chronological (oldest first). Sources api/simulator only.
// prettier-ignore
export const SEED_HISTORY: readonly SeedHistoryEntry[] = [
  { minutesAgo: 116, type: 'agent.activity',       source: 'api',       agentId: BE,   project: 'sellway',    taskId: null,      status: 'working',   action: 'run_command', message: 'Running the backend test suite before the release', progress: null, metadata: { command: 'npm test' } },
  { minutesAgo: 115, type: 'agent.task.started',   source: 'api',       agentId: UX,   project: 'ishkun24',   taskId: 'IK-201',  status: 'working',   action: null,          message: 'Polishing the vacancy posting form', progress: null },
  { minutesAgo: 113, type: 'agent.task.started',   source: 'api',       agentId: MOB,  project: 'ana-market', taskId: 'AM-401',  status: 'working',   action: null,          message: 'Starting the seller dashboard screens', progress: null },
  { minutesAgo: 112, type: 'agent.status.changed', source: 'api',       agentId: PM,   project: 'erp',        taskId: null,      status: 'planning',  action: null,          message: 'Planning the ERP sprint scope', progress: null },
  { minutesAgo: 110, type: 'task.created',         source: 'api',       agentId: null, project: 'erp',        taskId: 'ERP-303', status: 'todo',      action: null,          message: 'Task created: CRM integration', progress: null },
  { minutesAgo: 108, type: 'agent.task.started',   source: 'api',       agentId: ARC,  project: 'erp',        taskId: 'ERP-301', status: 'working',   action: null,          message: 'Starting the inventory architecture draft', progress: null },
  { minutesAgo: 106, type: 'agent.activity',       source: 'api',       agentId: OPS,  project: 'erp',        taskId: null,      status: 'working',   action: 'build',       message: 'Building the ERP staging images', progress: null },
  { minutesAgo: 103, type: 'agent.message',        source: 'api',       agentId: PM,   project: 'erp',        taskId: null,      status: null,        action: null,          message: 'ERP-302 is ready for QA verification', progress: null },
  { minutesAgo: 102, type: 'agent.status.changed', source: 'api',       agentId: BE,   project: 'sellway',    taskId: null,      status: 'idle',      action: null,          message: 'Backend test suite is green', progress: null },
  { minutesAgo: 100, type: 'agent.task.assigned',  source: 'api',       agentId: BE,   project: 'sellway',    taskId: 'SW-123',  status: null,        action: null,          message: 'Assigned by PM', progress: null },
  { minutesAgo: 99,  type: 'agent.task.started',   source: 'api',       agentId: QA,   project: 'erp',        taskId: 'ERP-302', status: 'working',   action: 'test',        message: 'Running the order management regression suite', progress: null },
  { minutesAgo: 95,  type: 'task.created',         source: 'api',       agentId: null, project: 'sellway',    taskId: 'SW-125',  status: 'todo',      action: null,          message: 'Task created: Campaign analytics', progress: null },
  { minutesAgo: 94,  type: 'agent.status.changed', source: 'api',       agentId: DOC,  project: null,         taskId: null,      status: 'working',   action: 'write_file',  message: 'Updating the API reference', progress: null },
  { minutesAgo: 92,  type: 'agent.task.started',   source: 'api',       agentId: FE,   project: 'sellway',    taskId: 'SW-124',  status: 'working',   action: null,          message: 'Profiling dashboard rendering', progress: null },
  { minutesAgo: 90,  type: 'agent.status.changed', source: 'api',       agentId: PA,   project: 'sellway',    taskId: null,      status: 'planning',  action: null,          message: 'Refining requirements for campaign analytics', progress: null },
  { minutesAgo: 88,  type: 'agent.task.assigned',  source: 'api',       agentId: SEC,  project: 'erp',        taskId: 'ERP-303', status: null,        action: null,          message: 'Assigned by PM', progress: null },
  { minutesAgo: 86,  type: 'agent.task.progress',  source: 'api',       agentId: UX,   project: 'ishkun24',   taskId: 'IK-201',  status: null,        action: 'edit_file',   message: 'Final responsive states for the posting wizard', progress: 80 },
  { minutesAgo: 84,  type: 'agent.status.changed', source: 'api',       agentId: DBE,  project: 'ishkun24',   taskId: 'IK-202',  status: 'planning',  action: null,          message: 'Designing the candidate pipeline schema', progress: null },
  { minutesAgo: 80,  type: 'agent.task.progress',  source: 'api',       agentId: ARC,  project: 'erp',        taskId: 'ERP-301', status: null,        action: null,          message: 'Stock ledger, warehouse and costing model drafted', progress: 70 },
  { minutesAgo: 78,  type: 'agent.task.progress',  source: 'api',       agentId: QA,   project: 'erp',        taskId: 'ERP-302', status: null,        action: 'test',        message: 'Order totals verified, payment capture next', progress: 55 },
  { minutesAgo: 76,  type: 'agent.task.progress',  source: 'api',       agentId: MOB,  project: 'ana-market', taskId: 'AM-401',  status: null,        action: null,          message: 'Sales and payouts widgets implemented', progress: 45 },
  { minutesAgo: 74,  type: 'agent.status.changed', source: 'api',       agentId: OPS,  project: 'erp',        taskId: null,      status: 'idle',      action: null,          message: 'Staging deployment finished', progress: null },
  { minutesAgo: 72,  type: 'agent.status.changed', source: 'simulator', agentId: REV,  project: 'sellway',    taskId: 'SW-124',  status: 'reviewing', action: 'git_diff',    message: 'Reviewing the dashboard performance changes', progress: null },
  { minutesAgo: 70,  type: 'task.created',         source: 'api',       agentId: null, project: 'ana-market', taskId: 'AM-402',  status: 'todo',      action: null,          message: 'Task created: Marketplace integration', progress: null },
  { minutesAgo: 69,  type: 'agent.task.progress',  source: 'api',       agentId: DBE,  project: 'ishkun24',   taskId: 'IK-202',  status: null,        action: null,          message: 'Candidate and stage tables drafted', progress: 20 },
  { minutesAgo: 66,  type: 'agent.status.changed', source: 'api',       agentId: DOC,  project: null,         taskId: null,      status: 'idle',      action: null,          message: 'API reference published', progress: null },
  { minutesAgo: 64,  type: 'agent.task.progress',  source: 'api',       agentId: FE,   project: 'sellway',    taskId: 'SW-124',  status: null,        action: null,          message: 'Virtualized the orders table', progress: 25 },
  { minutesAgo: 61,  type: 'agent.task.failed',    source: 'api',       agentId: QA,   project: 'erp',        taskId: 'ERP-302', status: 'failed',    action: null,          message: 'Payment capture tests failed: 3 of 42 cases', severity: 'error', progress: null, metadata: { failedTests: 3, totalTests: 42 } },
  { minutesAgo: 58,  type: 'agent.status.changed', source: 'api',       agentId: PM,   project: 'erp',        taskId: null,      status: 'idle',      action: null,          message: 'Sprint planning done', progress: null },
  { minutesAgo: 56,  type: 'agent.status.changed', source: 'api',       agentId: AIE,  project: 'ishkun24',   taskId: 'IK-203',  status: 'planning',  action: null,          message: 'Planning the Telegram bot webhook integration', progress: null },
  { minutesAgo: 54,  type: 'agent.status.changed', source: 'simulator', agentId: REV,  project: 'sellway',    taskId: null,      status: 'idle',      action: null,          message: 'Review comments posted on SW-124', progress: null },
  { minutesAgo: 52,  type: 'agent.status.changed', source: 'api',       agentId: PA,   project: 'sellway',    taskId: null,      status: 'idle',      action: null,          message: 'Requirements for SW-125 published', progress: null },
  { minutesAgo: 50,  type: 'agent.task.completed', source: 'api',       agentId: UX,   project: 'ishkun24',   taskId: 'IK-201',  status: 'completed', action: null,          message: 'Vacancy posting workflow approved', progress: null },
  { minutesAgo: 46,  type: 'agent.activity',       source: 'api',       agentId: DBE,  project: 'ishkun24',   taskId: 'IK-202',  status: 'waiting',   action: 'wait',        message: 'Waiting for IK-203 Telegram bot webhooks', progress: null },
  { minutesAgo: 44,  type: 'task.updated',         source: 'api',       agentId: null, project: 'ana-market', taskId: 'AM-402',  status: null,        action: null,          message: 'Task updated: Marketplace integration', progress: null, metadata: { changes: ['priority'] } },
  { minutesAgo: 40,  type: 'agent.status.changed', source: 'api',       agentId: ARC,  project: 'erp',        taskId: 'ERP-301', status: 'reviewing', action: 'review',      message: 'Reviewing the inventory architecture with the team', progress: null },
  { minutesAgo: 38,  type: 'agent.message',        source: 'simulator', agentId: AUD,  project: null,         taskId: null,      status: null,        action: null,          message: 'Weekly audit checklist prepared', progress: null },
  { minutesAgo: 33,  type: 'agent.disconnected',   source: 'api',       agentId: OPS,  project: 'erp',        taskId: null,      status: null,        action: null,          message: 'Connection to the DevOps agent lost', progress: null },
  { minutesAgo: 30,  type: 'agent.message',        source: 'api',       agentId: SEC,  project: 'erp',        taskId: 'ERP-303', status: null,        action: null,          message: 'Reviewing the CRM OAuth scopes before starting ERP-303', progress: null },
  { minutesAgo: 28,  type: 'agent.task.progress',  source: 'api',       agentId: AIE,  project: 'ishkun24',   taskId: 'IK-203',  status: null,        action: null,          message: 'Bot commands and webhook events mapped', progress: 10 },
  { minutesAgo: 25,  type: 'agent.activity',       source: 'api',       agentId: PM,   project: 'erp',        taskId: null,      status: 'working',   action: 'assign_task', message: 'Distributing ERP review work across the team', progress: null },
  { minutesAgo: 20,  type: 'system.warning',       source: 'api',       agentId: null, project: null,         taskId: null,      status: null,        action: null,          message: 'Disk usage on the staging server is above 85%', severity: 'warning', progress: null },
  { minutesAgo: 18,  type: 'agent.task.progress',  source: 'simulator', agentId: FE,   project: 'sellway',    taskId: 'SW-124',  status: null,        action: 'edit_file',   message: 'Memoizing chart selectors in DashboardPage.tsx', progress: 40 },
  { minutesAgo: 12,  type: 'agent.task.progress',  source: 'api',       agentId: MOB,  project: 'ana-market', taskId: 'AM-401',  status: null,        action: 'build',       message: 'Building the Android release candidate', progress: 65 },
];
