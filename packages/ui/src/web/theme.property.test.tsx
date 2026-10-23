import { render } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { ThemeProvider, useTheme, type ResolvedTheme, type ThemePreference } from './theme';

/**
 * Feature: web-ux-and-notifications, Property 10
 * Property 10: Theme preference resolves deterministically
 * Validates: Requirements 2.1, 2.4, 2.5
 *
 * The resolver is a pure function of (preference, OS-dark state):
 *  - preference 'light'  -> 'light'  (independent of OS)
 *  - preference 'dark'   -> 'dark'   (independent of OS)
 *  - preference 'system' -> 'dark' iff matchMedia('(prefers-color-scheme: dark)').matches,
 *                           else 'light'
 * Mounting ThemeProvider with a persisted preference + a mocked matchMedia must apply that
 * pure expected value to document.documentElement[data-theme], and re-resolving the same
 * inputs must be idempotent (same inputs -> same output).
 */

const STORAGE_KEY = 'aira-theme';

/** Installs a matchMedia mock pinned to a fixed OS dark/light state. */
function installMatchMedia(dark: boolean): void {
  const query: MediaQueryList = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  vi.stubGlobal(
    'matchMedia',
    vi.fn((input: string) => {
      expect(input).toBe('(prefers-color-scheme: dark)');
      return query;
    }),
  );
}

/** The pure contract the resolver must satisfy. */
function expectedResolved(preference: ThemePreference, osDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return osDark ? 'dark' : 'light';
}

let latest: ReturnType<typeof useTheme> | null = null;

function Probe(): ReactElement {
  latest = useTheme();
  return <div data-testid="probe">{latest.resolved}</div>;
}

function resetEnv(): void {
  latest = null;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.unstubAllGlobals();
}

beforeEach(resetEnv);
afterEach(resetEnv);

describe('Property 10 — theme preference resolves deterministically', () => {
  it('resolves (preference, OS dark) to the pure expected theme and is idempotent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ThemePreference>('light', 'dark', 'system'),
        fc.boolean(),
        (preference, osDark) => {
          // Seed the case: OS state via matchMedia, persisted preference via localStorage,
          // before any mount so the provider initializes deterministically.
          resetEnv();
          installMatchMedia(osDark);
          localStorage.setItem(STORAGE_KEY, preference);

          const expected = expectedResolved(preference, osDark);

          const first = render(
            <ThemeProvider>
              <Probe />
            </ThemeProvider>,
          );

          expect(latest?.preference).toBe(preference);
          expect(latest?.resolved).toBe(expected);
          expect(document.documentElement.getAttribute('data-theme')).toBe(expected);

          first.unmount();

          // Re-resolve with identical inputs: same output (idempotence). A fresh mount
          // re-reads the persisted preference and the same OS state.
          document.documentElement.removeAttribute('data-theme');
          const second = render(
            <ThemeProvider>
              <Probe />
            </ThemeProvider>,
          );

          expect(latest?.preference).toBe(preference);
          expect(latest?.resolved).toBe(expected);
          expect(document.documentElement.getAttribute('data-theme')).toBe(expected);

          second.unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
