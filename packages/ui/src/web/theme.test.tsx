import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// NOTE: This module does not exist yet (implemented in task 5.2). The import
// failing / symbols being undefined is the expected RED state for this task.
import { ThemeProvider, useTheme, type ThemePreference } from './theme';

const STORAGE_KEY = 'aira-theme';

/** A controllable matchMedia mock for '(prefers-color-scheme: dark)'. */
interface MediaMock {
  setDark(next: boolean): void;
  readonly listeners: Array<(event: MediaQueryListEvent) => void>;
}

function installMatchMedia(initialDark: boolean): MediaMock {
  let dark = initialDark;
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];

  const query: MediaQueryList = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: EventListenerOrEventListenerObject) => {
      listeners.push(cb as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, cb: EventListenerOrEventListenerObject) => {
      const idx = listeners.indexOf(cb as (event: MediaQueryListEvent) => void);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    // Legacy API some implementations call.
    addListener: (cb: (event: MediaQueryListEvent) => void) => {
      listeners.push(cb);
    },
    removeListener: (cb: (event: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  vi.stubGlobal(
    'matchMedia',
    vi.fn((input: string) => {
      expect(input).toBe('(prefers-color-scheme: dark)');
      return query;
    }),
  );

  return {
    listeners,
    setDark(next: boolean) {
      dark = next;
      const event = { matches: next, media: query.media } as MediaQueryListEvent;
      for (const cb of [...listeners]) cb(event);
    },
  };
}

/** Test harness exposing the context value to assertions. */
let latest: ReturnType<typeof useTheme> | null = null;

function Probe(): ReactElement {
  latest = useTheme();
  return <div data-testid="probe">{latest.resolved}</div>;
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  latest = null;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider / useTheme (Requirement 2)', () => {
  it('defaults preference to system and resolves via matchMedia when nothing persisted (R2.4)', () => {
    installMatchMedia(true); // OS prefers dark

    renderProvider();

    expect(latest).not.toBeNull();
    expect(latest?.preference).toBe('system');
    expect(latest?.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('resolves system preference to light when prefers-color-scheme is light (R2.4)', () => {
    installMatchMedia(false); // OS prefers light

    renderProvider();

    expect(latest?.preference).toBe('system');
    expect(latest?.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setPreference writes localStorage and sets data-theme for each explicit choice (R2.2, R2.3)', () => {
    installMatchMedia(true);

    renderProvider();

    const cases: Array<[ThemePreference, string]> = [
      ['light', 'light'],
      ['dark', 'dark'],
    ];

    for (const [preference, expected] of cases) {
      act(() => {
        latest?.setPreference(preference);
      });

      expect(localStorage.getItem(STORAGE_KEY)).toBe(preference);
      expect(latest?.preference).toBe(preference);
      expect(latest?.resolved).toBe(expected);
      expect(document.documentElement.getAttribute('data-theme')).toBe(expected);
    }

    // Returning to 'system' persists 'system' and re-resolves via matchMedia.
    act(() => {
      latest?.setPreference('system');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');
    expect(latest?.preference).toBe('system');
    expect(latest?.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('re-resolves live on a matchMedia change while preference is system, without reload (R2.5)', () => {
    const media = installMatchMedia(false); // start light

    renderProvider();

    expect(latest?.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      media.setDark(true); // OS switches to dark
    });

    expect(latest?.preference).toBe('system');
    expect(latest?.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('does not re-resolve on a matchMedia change once an explicit preference is set', () => {
    const media = installMatchMedia(false);

    renderProvider();

    act(() => {
      latest?.setPreference('light');
    });
    expect(latest?.resolved).toBe('light');

    act(() => {
      media.setDark(true); // OS flips to dark, but explicit 'light' must stick
    });

    expect(latest?.preference).toBe('light');
    expect(latest?.resolved).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('adopts the data-theme already present on <html> at mount (no-flash, R2.6)', () => {
    // Pre-paint script already set dark, but the OS currently prefers light and
    // nothing is persisted. The provider must adopt the existing attribute at
    // mount rather than overwriting it from a fresh system resolution.
    installMatchMedia(false);
    document.documentElement.setAttribute('data-theme', 'dark');

    renderProvider();

    expect(latest?.resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
