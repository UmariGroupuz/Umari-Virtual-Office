// Broadcast seam between the services and Socket.IO (API_CONTRACTS §9.7, ADR-008/009). Services call it
// strictly after COMMIT; `realtime/socketServer.ts` (TASK-008) provides the Socket.IO implementation.
import {
  SOCKET_EVENTS,
  type DemoState,
  type OfficeEventPayload,
  type OfficeResyncPayload,
  type ServerToClientEvents,
} from '@vo/shared';

export interface Broadcaster {
  officeEvent(payload: OfficeEventPayload): void;
  demoState(state: DemoState): void;
  resync(payload: OfficeResyncPayload): void;
}

/** Sends nothing (no clients, scripts, tests that do not care about broadcasts). */
export class NoopBroadcaster implements Broadcaster {
  officeEvent(_payload: OfficeEventPayload): void {}
  demoState(_state: DemoState): void {}
  resync(_payload: OfficeResyncPayload): void {}
}

export interface RecordedMessage {
  name: keyof ServerToClientEvents;
  payload: unknown;
}

/**
 * Records every message in call order (tests: REQ-029 "nothing broadcast", payload = response) and then
 * forwards it to `forward` when given (e.g. the real Socket.IO broadcaster).
 */
export class RecordingBroadcaster implements Broadcaster {
  readonly messages: RecordedMessage[] = [];

  constructor(private readonly forward?: Broadcaster) {}

  officeEvent(payload: OfficeEventPayload): void {
    this.messages.push({ name: SOCKET_EVENTS.OFFICE_EVENT, payload });
    this.forward?.officeEvent(payload);
  }

  demoState(state: DemoState): void {
    this.messages.push({ name: SOCKET_EVENTS.DEMO_STATE, payload: state });
    this.forward?.demoState(state);
  }

  resync(payload: OfficeResyncPayload): void {
    this.messages.push({ name: SOCKET_EVENTS.OFFICE_RESYNC, payload });
    this.forward?.resync(payload);
  }

  clear(): void {
    this.messages.length = 0;
  }
}
