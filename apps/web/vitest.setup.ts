import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Bridge Testing Library's fake-timer detection to vitest. `waitFor` only
// advances the clock itself when it believes a fake-timer library is active,
// and its check (`@testing-library/dom` `jestFakeTimersAreEnabled`) keys off a
// global `jest` object. Vitest does not define one, so without this shim
// `waitFor` falls back to real timers — which `vi.useFakeTimers()` has mocked,
// leaving `waitFor` spinning until it times out. Exposing a minimal `jest`
// facade that forwards to `vi` lets `waitFor` drive vitest's fake clock. The
// `setTimeout.clock` property vitest sets while faking satisfies the modern
// timers branch of the detection. Harmless when real timers are in use.
if (typeof (globalThis as { jest?: unknown }).jest === 'undefined') {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
}

// jsdom gaps used by Radix primitives (AlertDialog focus/pointer management).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
});
