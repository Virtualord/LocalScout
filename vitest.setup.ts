// Shared Vitest setup for every workspace package.
//
// Component suites opt into jsdom with a `@vitest-environment jsdom` docblock;
// this file adds matchers and the jsdom gaps that component tests hit.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Unmount everything between tests.
 *
 * Testing Library only auto-cleans when it can find a global `afterEach`, which
 * Vitest does not provide unless `globals` is enabled. Without this, a button
 * rendered by one test is still in the document during the next one and every
 * `getByRole` finds a duplicate.
 */
afterEach(() => {
  cleanup();
  // Radix and the router both keep timers alive between tests; clearing them
  // stops one test's pending work from firing inside the next.
  vi.clearAllTimers();
});

/**
 * jsdom does not implement `matchMedia`.
 *
 * Every component here consults `(prefers-reduced-motion: reduce)`, so without
 * this the component tests throw on the first render. The default is "no
 * preference", and individual tests can override it to assert the reduced
 * behaviour.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

/**
 * jsdom does not implement `ResizeObserver` either.
 *
 * The map measures its container to choose a desktop or mobile grid, so any test
 * that renders a screen containing the map throws without this. Nothing in these
 * tests depends on a measurement: the observer records nothing and reports
 * nothing, and the component keeps its initial size.
 */
if (typeof window !== 'undefined' && typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  // Radix and the router both keep timers alive between tests; clearing them
  // stops one test's pending work from firing inside the next.
  vi.clearAllTimers();
});
