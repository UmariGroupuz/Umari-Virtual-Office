// Agent entity (API_CONTRACTS §1.3, REQ-001).
import type { RoomId } from '../constants/rooms';
import type { AgentStatus } from '../constants/statuses';
import type { JsonObject } from './json';

export interface Agent {
  id: string; // '04-backend-engineer'
  code: string; // 'BE' (unique, ≤ 3 chars)
  name: string; // 'Backend Engineer' (A-03)
  role: string; // 'Senior Backend Engineer' (§6.1)
  shortRole: string; // 'Backend' (≤ 12 chars, office label)
  avatar: string; // 'monogram:BE' — generated avatar descriptor, no image asset
  department: string; // 'Development' (room label)
  roomId: RoomId;
  deskId: string; // 'development-1' (UX §5.2, unique)
  status: AgentStatus;
  currentProject: string | null; // project id
  currentTask: string | null; // task title, or the taskId if the task does not exist
  taskId: string | null;
  progress: number; // integer 0–100
  startedAt: string | null;
  lastActivityAt: string | null;
  currentAction: string | null;
  lastMessage: string | null;
  online: boolean; // === (status !== 'offline')
  metadata: JsonObject;
  version: number; // ≥ 1, +1 on every row write (ADR-010)
}
