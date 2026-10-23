import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Static adoption guard for R3.2 (Requirement 3, AC 2): the three hand-rolled headers
 * (`AdminHeader`, `PlatformHeader`, and the inline console header in `Dashboard.tsx`)
 * must be replaced by the shared `AppShell` header, leaving ZERO remaining usages.
 *
 * This is a plain node-style test: it reads source files from disk (no DOM, no React
 * render) and asserts on their text, so it stays valid no matter how the components are
 * wired at runtime. Task 12.1 writes this as a FAILING test; task 12.2 makes it pass by
 * deleting the old header components and swapping the layouts to `AppShell`.
 *
 * Path anchoring: the web app root is derived from this test file's own location
 * (`apps/web/tests/shell-adoption.test.ts` -> up two dirs = `apps/web`). This is robust
 * regardless of the process working directory vitest happens to run under.
 */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(WEB_ROOT, 'src');
const APP_DIR = join(WEB_ROOT, 'app');

/** This test file's absolute path — excluded from identifier scans (it names the headers). */
const SELF = fileURLToPath(import.meta.url);

/** Recursively collect `.ts`/`.tsx` source files under a directory (skips if absent). */
function collectSourceFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const info = statSync(full);
      if (info.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next' || entry === '.turbo') {
          continue;
        }
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && full !== SELF) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

const ALL_SOURCE_FILES = [...collectSourceFiles(SRC_DIR), ...collectSourceFiles(APP_DIR)];

/** Files that still reference `identifier` as a whole word, by absolute path. */
function filesReferencing(identifier: string): string[] {
  const pattern = new RegExp(`\\b${identifier}\\b`);
  return ALL_SOURCE_FILES.filter((file) => pattern.test(readFileSync(file, 'utf8')));
}

describe('App_Shell adoption (R3.2): no legacy headers remain', () => {
  it('deletes the AdminHeader component file', () => {
    // 12.2 deletes src/components/AdminHeader.tsx. While it still exists, this fails (red).
    expect(existsSync(join(SRC_DIR, 'components', 'AdminHeader.tsx'))).toBe(false);
  });

  it('deletes the PlatformHeader component file', () => {
    // 12.2 deletes src/components/PlatformHeader.tsx. While it still exists, this fails (red).
    expect(existsSync(join(SRC_DIR, 'components', 'PlatformHeader.tsx'))).toBe(false);
  });

  it('has zero usages of the AdminHeader identifier anywhere in src/ or app/', () => {
    // No import, no render, no definition. (The definition file itself is deleted by 12.2.)
    expect(filesReferencing('AdminHeader')).toEqual([]);
  });

  it('has zero usages of the PlatformHeader identifier anywhere in src/ or app/', () => {
    expect(filesReferencing('PlatformHeader')).toEqual([]);
  });

  it('renders AppShell from the console layout', () => {
    const content = readFileSync(join(APP_DIR, 'console', 'layout.tsx'), 'utf8');
    expect(content).toContain('AppShell');
  });

  it('renders AppShell from the admin layout', () => {
    const content = readFileSync(join(APP_DIR, 'admin', 'layout.tsx'), 'utf8');
    expect(content).toContain('AppShell');
  });

  it('renders AppShell from the platform layout', () => {
    const content = readFileSync(join(APP_DIR, 'platform', 'layout.tsx'), 'utf8');
    expect(content).toContain('AppShell');
  });

  it('removes the inline console header from Dashboard.tsx', () => {
    // Sentinels: the inline console header is the only place Dashboard.tsx emits a raw
    // `<header` JSX tag and the only reason it imports `SignOutButton` (the sign-out
    // control moves into the shared shell header per 12.2). Both are stable markers of
    // the hand-rolled header and disappear exactly when it is removed. Checking both
    // avoids a false green if one is refactored but the header stays.
    const dashboard = readFileSync(join(SRC_DIR, 'components', 'Dashboard.tsx'), 'utf8');
    expect(dashboard).not.toContain('<header');
    expect(dashboard).not.toMatch(/\bSignOutButton\b/);
  });
});
