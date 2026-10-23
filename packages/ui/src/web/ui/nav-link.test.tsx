import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These imports intentionally point at a module that does not exist yet
// (task 8.2 implements `nav-link.tsx`). The failing import is the red state
// for task 8.1 — the tests below pin the active-state contract the
// implementation must satisfy, per Requirement 3 (3.4, 3.5, 3.6).
import { NavLink } from './nav-link';

/**
 * `usePathname` is the only input to NavLink's active-state computation, so we
 * drive it through a hoisted mutable closure (the `vi.hoisted` pattern used by
 * apps/web/tests/login-form.test.tsx) and let each test set the current path
 * before rendering. We also mock `next/link` down to a plain anchor so the test
 * can read `href` and `aria-current` straight off the DOM without pulling in
 * the real Next.js runtime.
 */
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

/**
 * The active visual is expressed as `aria-current="page"` plus a distinguishing
 * class. We assert the semantic hook (`aria-current`) everywhere and additionally
 * assert that the active state carries a different class string than the inactive
 * state, without over-pinning the exact Tailwind tokens the implementation picks.
 */
function setPath(pathname: string) {
  navState.pathname = pathname;
}

beforeEach(() => {
  navState.pathname = '/';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('NavLink exact matching (R3.4, R3.6, default mode)', () => {
  it('is active with aria-current="page" when pathname equals href', () => {
    setPath('/admin');
    render(<NavLink href="/admin" label="Admin" />);
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('is inactive and omits aria-current when pathname differs', () => {
    setPath('/console');
    render(<NavLink href="/admin" label="Admin" />);
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('does NOT treat a nested path as active under exact matching', () => {
    setPath('/admin/audit');
    render(<NavLink href="/admin" label="Admin" match="exact" />);
    const link = screen.getByRole('link', { name: 'Admin' });
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('applies a different visual class when active vs inactive', () => {
    setPath('/admin');
    const { unmount } = render(<NavLink href="/admin" label="Admin" />);
    const activeClass = screen.getByRole('link', { name: 'Admin' }).className;
    unmount();

    setPath('/console');
    render(<NavLink href="/admin" label="Admin" />);
    const inactiveClass = screen.getByRole('link', { name: 'Admin' }).className;

    expect(activeClass).not.toEqual(inactiveClass);
  });
});

describe('NavLink nested matching (R3.5, R3.6)', () => {
  it('is active when pathname equals the href', () => {
    setPath('/admin');
    render(<NavLink href="/admin" label="Admin" match="nested" />);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
  });

  it('is active when pathname begins with href + "/"', () => {
    setPath('/admin/audit');
    render(<NavLink href="/admin" label="Admin" match="nested" />);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
  });

  it('is NOT active for a sibling that merely shares the href as a string prefix', () => {
    // The `+ '/'` boundary matters: '/administrators' starts with '/admin' but is
    // a different route, so it must stay inactive (R3.5, R3.6).
    setPath('/administrators');
    render(<NavLink href="/admin" label="Admin" match="nested" />);
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
  });

  it('is inactive and omits aria-current for an unrelated path', () => {
    setPath('/console');
    render(<NavLink href="/admin" label="Admin" match="nested" />);
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
  });
});
