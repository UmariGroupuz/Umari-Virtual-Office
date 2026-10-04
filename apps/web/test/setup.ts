// Global test setup for @vo/web (owned by TASK-001; web tasks must not edit it — request changes via the PM).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// `globals: false` disables Testing Library's automatic cleanup, so register it explicitly.
afterEach(() => {
  cleanup();
});

// jsdom does not implement matchMedia. Default: no media query matches (tests may override with vi.stubGlobal
// or by reassigning window.matchMedia).
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// jsdom does not implement ResizeObserver. The stub never calls back.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver !== 'function') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
}
