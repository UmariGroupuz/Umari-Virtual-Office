import type { DemoState, OfficeEventPayload, OfficeResyncPayload } from '@vo/shared';
import { describe, expect, it, vi } from 'vitest';
import { NoopBroadcaster, RecordingBroadcaster, type Broadcaster } from './broadcaster';

const payload = {
  event: { id: 'e1', seq: 1 },
  agent: null,
  task: null,
} as unknown as OfficeEventPayload;
const demo: DemoState = { active: true, intervalMs: 3000, startedAt: '2026-10-04T10:00:00.000Z' };
const resync: OfficeResyncPayload = { reason: 'demo-restored' };

describe('NoopBroadcaster', () => {
  it('accepts every message and does nothing', () => {
    const noop: Broadcaster = new NoopBroadcaster();
    expect(() => {
      noop.officeEvent(payload);
      noop.demoState(demo);
      noop.resync(resync);
    }).not.toThrow();
  });
});

describe('RecordingBroadcaster', () => {
  it('records every message in call order with the socket event names', () => {
    const recorder = new RecordingBroadcaster();
    recorder.officeEvent(payload);
    recorder.demoState(demo);
    recorder.resync(resync);
    expect(recorder.messages).toEqual([
      { name: 'office:event', payload },
      { name: 'demo:state', payload: demo },
      { name: 'office:resync', payload: resync },
    ]);
    expect(recorder.messages[0]?.payload).toBe(payload); // the exact object that would be emitted
  });

  it('forwards every message to the wrapped broadcaster after recording it', () => {
    const order: string[] = [];
    const officeEvent = vi.fn(() => order.push(`forward:${String(recorder.messages.length)}`));
    const demoState = vi.fn();
    const resyncFn = vi.fn();
    const recorder = new RecordingBroadcaster({ officeEvent, demoState, resync: resyncFn });
    recorder.officeEvent(payload);
    recorder.demoState(demo);
    recorder.resync(resync);
    expect(officeEvent).toHaveBeenCalledWith(payload);
    expect(demoState).toHaveBeenCalledWith(demo);
    expect(resyncFn).toHaveBeenCalledWith(resync);
    expect(order).toEqual(['forward:1']);
  });

  it('clear() empties the record (and keeps the same array instance)', () => {
    const recorder = new RecordingBroadcaster(new NoopBroadcaster());
    const messages = recorder.messages;
    recorder.officeEvent(payload);
    recorder.clear();
    expect(recorder.messages).toEqual([]);
    expect(recorder.messages).toBe(messages);
  });
});
