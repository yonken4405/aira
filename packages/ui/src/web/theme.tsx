'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { t } from '../i18n';
import { cn } from '../cn';

/**
 * Theme runtime (DESIGN.md §1, R2).
 *
 * `data-theme="light|dark"` on `<html>` is the single source of truth for the applied
 * theme. A pre-paint inline script (root layout, task 3) sets it before first paint so
 * there is no flash. This provider adopts that attribute at mount, hydrates the persisted
 * preference, and keeps `system` live against the OS `prefers-color-scheme` setting.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The persisted choice. */
  readonly preference: ThemePreference;
  /** The concrete theme currently applied to the document root. */
  readonly resolved: ResolvedTheme;
  /** Persists the choice and applies it within the 120ms budget, no reload (R2.2, R2.3). */
  setPreference(next: ThemePreference): void;
}

const STORAGE_KEY = 'aira-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Reads the persisted preference, defaulting to `system` when nothing is stored (R2.4). */
function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') {
    return 'system';
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Resolves the OS setting via `matchMedia` (R2.4). */
function systemResolved(): ResolvedTheme {
  if (typeof matchMedia === 'function') {
    return matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
  }
  return 'dark';
}

/** The `data-theme` already on `<html>`, if a pre-paint script set it (no-flash, R2.6). */
function adoptedResolved(): ResolvedTheme | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' || attr === 'dark' ? attr : null;
}

/** Applies a concrete theme to the document root (R2.2). */
function applyResolved(resolved: ResolvedTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
  }
}

/**
 * Computes the initial resolved theme for the first render:
 * for an explicit preference, that preference; for `system`, the attribute the pre-paint
 * script already applied (adopted so the provider never overwrites it with a possibly
 * different fresh resolution), falling back to a live `matchMedia` read.
 */
function initialResolved(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return adoptedResolved() ?? systemResolved();
}

export function ThemeProvider(props: { children: ReactNode }): ReactElement {
  // Initialize lazily from the persisted preference + adopted attribute so the very first
  // committed render already reflects the applied theme (no flash on mount).
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    initialResolved(readStoredPreference()),
  );

  // True until the `system` media effect has run once. The first run must not clobber a
  // `data-theme` the pre-paint script already applied (no-flash adoption, R2.6); only
  // later OS changes drive a live re-resolution.
  const firstSystemSync = useRef(true);

  // Keep the document attribute in sync with the resolved theme on every change.
  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  // While the preference is `system`, track OS changes and re-resolve live (R2.5).
  // An explicit preference ignores OS changes entirely.
  useEffect(() => {
    if (preference !== 'system') {
      return;
    }
    if (typeof matchMedia !== 'function') {
      return;
    }

    const query = matchMedia(MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      setResolved(event.matches ? 'dark' : 'light');
    };

    // On the first run, keep whatever the initial render adopted (pre-paint attribute).
    // On later runs — e.g. the preference flipping back to `system` — re-sync to the OS.
    if (firstSystemSync.current) {
      firstSystemSync.current = false;
    } else {
      setResolved(query.matches ? 'dark' : 'light');
    }

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Legacy Safari fallback.
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference): void => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Persistence is best-effort; the applied theme still updates.
      }
    }

    setPreferenceState(next);
    const nextResolved = next === 'system' ? systemResolved() : next;
    setResolved(nextResolved);
    applyResolved(nextResolved);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used within a <ThemeProvider>.');
  }
  return value;
}

export interface ThemeToggleProps {
  readonly className?: string;
}

const OPTIONS: ReadonlyArray<{
  readonly preference: ThemePreference;
  readonly icon: LucideIcon;
  readonly labelKey: 'themeLight' | 'themeDark' | 'themeSystem';
}> = [
  { preference: 'light', icon: Sun, labelKey: 'themeLight' },
  { preference: 'dark', icon: Moon, labelKey: 'themeDark' },
  { preference: 'system', icon: Monitor, labelKey: 'themeSystem' },
];

/**
 * A three-way segmented control for `light` / `dark` / `system` (R2.1). All copy routes
 * through `t()`; icons are decorative (`aria-hidden`) with the visible label as the
 * accessible name via `aria-pressed`.
 */
export function ThemeToggle({ className }: ThemeToggleProps): ReactElement {
  // Read the theme context without throwing so the toggle can render inside
  // islands mounted outside a <ThemeProvider> (e.g. the App_Shell header in
  // isolation). Under a provider this is identical to useTheme(); otherwise it
  // falls back to the `system` default with a no-op setter.
  const context = useContext(ThemeContext);
  const preference = context?.preference ?? 'system';
  const setPreference = context?.setPreference ?? (() => undefined);

  return (
    <div
      role="group"
      aria-label={t('themeLabel')}
      className={cn(
        'inline-flex items-center gap-0.5 border border-line bg-raised p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ preference: option, icon: Icon, labelKey }) => {
        const active = preference === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setPreference(option)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1',
              'text-[10px] font-bold uppercase tracking-label',
              'transition-colors duration-fast ease-out',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
              active ? 'bg-fg text-ink' : 'bg-transparent text-muted hover:text-fg',
            )}
          >
            <Icon aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
