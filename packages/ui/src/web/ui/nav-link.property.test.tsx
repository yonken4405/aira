/**
 * @vitest-environment jsdom
 *
 * NavLink active-state — property-based test (task 8.3).
 *
 * Feature: web-ux-and-notifications, Property 9
 *
 * Encodes Property 9 from design.md over `NavLink`'s pure active-state rule:
 *
 *   exact  → active iff pathname === href
 *   nested → active iff pathname === href || pathname.startsWith(href + '/')
 *
 * An active link sets `aria-current="page"`; an inactive link omits it.
 *
 * `usePathname` is NavLink's only runtime input, so we drive it through a
 * hoisted mutable closure (the same `vi.hoisted` pattern as `nav-link.test.tsx`)
 * and let each generated case set the current path before rendering. `next/link`
 * is mocked down to a plain anchor so the test reads `aria-current` straight off
 * the DOM. Both the href, the match mode, and the pathname are produced from
 * fast-check arbitraries that deliberately cover every case: equality, a true
 * nested descendant, a sibling that shares the href as a bare string prefix
 * (the trailing-slash boundary), and an unrelated path.
 *
 * This is a post-implementation property: it encodes an invariant the existing
 * `NavLink` already satisfies and is EXPECTED TO PASS. A failing case surfaces a
 * real NavLink bug (reported with its counterexample), never a reason to weaken
 * the property. Runs >= 100 iterations.
 *
 * **Validates: Requirements 3.4, 3.5, 3.6**
 */

import { cleanup, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navState = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Imported after the mocks are registered (vi.mock is hoisted, but keep intent clear).
import { NavLink, type NavMatch } from './nav-link';

const RUNS = 100;

/** The pure predicate under test, mirrored from the design's Property 9 wording. */
function predictedActive(pathname: string, href: string, match: NavMatch): boolean {
  if (match === 'nested') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

/**
 * An href that is a '/'-prefixed sequence of one or more URL-ish path segments,
 * e.g. `/admin`, `/admin/audit`, `/console/incidents`. Segments avoid '/' so the
 * boundary logic is exercised cleanly.
 */
const segment = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^a-zA-Z0-9._~-]/g, 'x'))
  .filter((s) => s.length > 0);

const hrefArb: fc.Arbitrary<string> = fc
  .array(segment, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${segments.join('/')}`);

const matchArb: fc.Arbitrary<NavMatch> = fc.constantFrom<NavMatch>('exact', 'nested');

/** The shape of path derived relative to the generated href. */
type PathKind = 'equal' | 'nested' | 'sibling-prefix' | 'unrelated';

const pathKindArb: fc.Arbitrary<PathKind> = fc.constantFrom<PathKind>(
  'equal',
  'nested',
  'sibling-prefix',
  'unrelated',
);

/** Build a concrete pathname from the href + the chosen relationship. */
function derivePathname(href: string, kind: PathKind, extra: string, unrelated: string): string {
  switch (kind) {
    case 'equal':
      // pathname exactly equals href → active under both modes.
      return href;
    case 'nested':
      // A true descendant: href + '/' + more → active only for nested.
      return `${href}/${extra}`;
    case 'sibling-prefix':
      // Shares href as a bare string prefix WITHOUT the '/' boundary:
      // e.g. href '/admin' → '/adminX'. Must stay inactive in both modes.
      return `${href}${extra}`;
    case 'unrelated':
      // A path that cannot share the href prefix (distinct leading segment).
      return `/zzz-${unrelated}`;
  }
}

afterEach(() => {
  cleanup();
  navState.pathname = '/';
  vi.clearAllMocks();
});

describe('Property 9: NavLink active-state computation', () => {
  it('sets aria-current="page" iff the pure active predicate holds, across all cases', () => {
    fc.assert(
      fc.property(
        hrefArb,
        matchArb,
        pathKindArb,
        segment,
        segment,
        (href, match, kind, extra, unrelated) => {
          const pathname = derivePathname(href, kind, extra, unrelated);
          navState.pathname = pathname;

          render(<NavLink href={href} label="Nav" match={match} />);
          const link = screen.getByRole('link', { name: 'Nav' });

          const expected = predictedActive(pathname, href, match);
          if (expected) {
            expect(link).toHaveAttribute('aria-current', 'page');
          } else {
            expect(link).not.toHaveAttribute('aria-current');
          }

          cleanup();
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('nested: a sibling sharing the href as a bare prefix (no "/" boundary) is never active', () => {
    // Pins the critical boundary case explicitly: '/admin' must NOT be active
    // for '/administrators' under nested matching (R3.5, R3.6).
    navState.pathname = '/administrators';
    render(<NavLink href="/admin" label="Admin" match="nested" />);
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
  });
});
