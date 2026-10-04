// Socket.IO message typing (API_CONTRACTS §1.5, §4, ADR-009).
import type { OfficeEventPayload } from './api';
import type { DemoState } from './demo';

export interface OfficeResyncPayload {
  reason: 'demo-restored';
}

export interface ServerToClientEvents {
  'office:event': (payload: OfficeEventPayload) => void;
  'demo:state': (state: DemoState) => void;
  'office:resync': (payload: OfficeResyncPayload) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- server→client only (REQ-051)
export interface ClientToServerEvents {}
