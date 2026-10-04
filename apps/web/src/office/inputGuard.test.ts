// QA-5 regression: a press on DOM UI layered over the office area must never select a desk or close the panel.
import { describe, expect, it } from 'vitest';
import { isCanvasEvent, isPrimaryCanvasPress } from './inputGuard';

const canvas = document.createElement('canvas');
const metricCard = document.createElement('dl'); // e.g. the "Working" metric card above a scrolled canvas
const projectSelector = document.createElement('button');

function press(target: EventTarget | null, button = 0) {
  return { button, event: { target } };
}

describe('inputGuard (QA-5)', () => {
  it('accepts a primary press on the canvas itself', () => {
    expect(isPrimaryCanvasPress(press(canvas), canvas)).toBe(true);
    expect(isCanvasEvent(press(canvas), canvas)).toBe(true);
  });

  it.each([
    ['metric card', metricCard],
    ['project selector', projectSelector],
    ['document body', document.body],
    ['window', window],
    ['no target', null],
  ])('rejects a press whose DOM target is the %s', (_name, target) => {
    expect(isPrimaryCanvasPress(press(target), canvas)).toBe(false);
    expect(isCanvasEvent(press(target), canvas)).toBe(false);
  });

  it('rejects non-primary buttons on the canvas', () => {
    expect(isPrimaryCanvasPress(press(canvas, 1), canvas)).toBe(false);
    expect(isPrimaryCanvasPress(press(canvas, 2), canvas)).toBe(false);
  });

  it('rejects pointers without a native event and a missing canvas', () => {
    expect(isPrimaryCanvasPress({ button: 0 }, canvas)).toBe(false);
    expect(isPrimaryCanvasPress({ button: 0, event: null }, canvas)).toBe(false);
    expect(isPrimaryCanvasPress(press(canvas), null)).toBe(false);
    expect(isPrimaryCanvasPress(press(null), undefined)).toBe(false);
  });
});
