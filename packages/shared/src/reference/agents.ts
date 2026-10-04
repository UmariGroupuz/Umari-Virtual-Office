// Agent reference data — API_CONTRACTS §6.1 (REQUIREMENTS §3.1 + desks from UX §5.2).
import type { RoomId } from '../constants/rooms';

export interface AgentReference {
  id: string;
  code: string;
  name: string;
  role: string;
  shortRole: string;
  avatar: string;
  department: string;
  roomId: RoomId;
  deskId: string;
  sortOrder: number;
}

type Row = [
  id: string,
  code: string,
  name: string,
  role: string,
  shortRole: string,
  roomId: RoomId,
  department: string,
  deskId: string,
];

// Kept as a table so it can be compared row by row with API_CONTRACTS §6.1.
// prettier-ignore
const ROWS: readonly Row[] = [
  ['01-pm-orchestrator', 'PM', 'PM / Orchestrator', 'Project Manager / Orchestrator', 'PM', 'management', 'Management', 'management-1'],
  ['02-product-analyst', 'PA', 'Product Analyst', 'Product Analyst', 'Analyst', 'management', 'Management', 'management-2'],
  ['03-architect', 'ARC', 'Architect', 'System Architect', 'Architect', 'management', 'Management', 'management-3'],
  ['04-backend-engineer', 'BE', 'Backend Engineer', 'Senior Backend Engineer', 'Backend', 'development', 'Development', 'development-1'],
  ['05-frontend-engineer', 'FE', 'Frontend Engineer', 'Senior Frontend Engineer', 'Frontend', 'development', 'Development', 'development-2'],
  ['06-database-engineer', 'DBE', 'Database Engineer', 'Database Engineer', 'Database', 'development', 'Development', 'development-3'],
  ['07-devops-engineer', 'OPS', 'DevOps Engineer', 'DevOps Engineer', 'DevOps', 'infrastructure', 'Infrastructure', 'infrastructure-1'],
  ['08-security-engineer', 'SEC', 'Security Engineer', 'Security Engineer', 'Security', 'infrastructure', 'Infrastructure', 'infrastructure-2'],
  ['09-qa-engineer', 'QA', 'QA Engineer', 'QA Engineer', 'QA', 'quality', 'Quality', 'quality-1'],
  ['10-ui-ux-designer', 'UX', 'UI/UX Designer', 'UI/UX Designer', 'UI/UX', 'design', 'Design', 'design-1'],
  ['11-mobile-engineer', 'MOB', 'Mobile Engineer', 'Mobile Engineer', 'Mobile', 'development', 'Development', 'development-4'],
  ['12-ai-engineer', 'AIE', 'AI Engineer', 'AI Engineer', 'AI', 'ai-lab', 'AI Lab', 'ai-lab-1'],
  ['13-documentation-engineer', 'DOC', 'Documentation Engineer', 'Documentation Engineer', 'Docs', 'documentation', 'Documentation', 'documentation-1'],
  ['14-reviewer', 'REV', 'Reviewer', 'Code Reviewer', 'Reviewer', 'quality', 'Quality', 'quality-2'],
  ['15-product-auditor', 'AUD', 'Product Auditor', 'Product Auditor', 'Auditor', 'audit', 'Audit', 'audit-1'],
];

/** The 15 agents in agent-number order (`sortOrder` 1–15). `avatar` = `monogram:<code>` (UX §12). */
export const AGENT_REFERENCE: readonly AgentReference[] = Object.freeze(
  ROWS.map(([id, code, name, role, shortRole, roomId, department, deskId], i) =>
    Object.freeze({
      id,
      code,
      name,
      role,
      shortRole,
      avatar: `monogram:${code}`,
      department,
      roomId,
      deskId,
      sortOrder: i + 1,
    }),
  ),
);

export const AGENT_IDS: readonly string[] = Object.freeze(AGENT_REFERENCE.map((a) => a.id));
