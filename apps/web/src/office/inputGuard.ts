// QA-5: Phaser hit-tests by page coordinates, so an event whose DOM target is some other element layered over the
// canvas (metrics row, top bar, project selector, part of the canvas scrolled under them) would otherwise "click"
// the desk underneath. The office only reacts to pointer events that actually target its canvas.
// Pure module: no Phaser import (unit-tested in jsdom).

/** The part of a Phaser pointer this guard needs (`Phaser.Input.Pointer` satisfies it). */
export interface PointerLike {
  button: number;
  event?: { target: EventTarget | null } | null;
}

/** True when the pointer's native event was dispatched to the game canvas itself. */
export function isCanvasEvent(
  pointer: PointerLike,
  canvas: EventTarget | null | undefined,
): boolean {
  const target = pointer.event?.target ?? null;
  return canvas != null && target === canvas;
}

/** A primary-button press on the canvas: the only press that may select a desk or close the panel. */
export function isPrimaryCanvasPress(
  pointer: PointerLike,
  canvas: EventTarget | null | undefined,
): boolean {
  return pointer.button === 0 && isCanvasEvent(pointer, canvas);
}
