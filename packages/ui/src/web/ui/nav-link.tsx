'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '../../cn';

/**
 * Shared navigation link for the App_Shell header (DESIGN.md §2). Consolidates
 * the copy-pasted `usePathname` active-state logic that previously lived in
 * `AdminHeader`/`PlatformHeader` into one primitive.
 *
 * `next/link` and `next/navigation` are provided by the consuming app
 * (`apps/web`); `@aira/ui` keeps `next` out of its own dependencies and only
 * imports these as externals (resolved via the workspace / consuming app, and
 * mocked in `nav-link.test.tsx`).
 */
export type NavMatch = 'exact' | 'nested';

export interface NavLinkProps {
  readonly href: string;
  readonly label: string;
  /** Active-state strategy. Defaults to `'exact'`. */
  readonly match?: NavMatch;
  readonly icon?: ReactNode;
}

/** Shared header styling idiom (mirrors the old AdminHeader/PlatformHeader chrome). */
const NAV_LINK_BASE =
  'inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-bold uppercase tracking-label transition-colors duration-fast';
const NAV_LINK_ACTIVE = 'border-fg bg-fg text-ink';
const NAV_LINK_INACTIVE = 'border-line bg-raised text-muted hover:border-muted hover:text-fg';

/**
 * Active when:
 *  - `match === 'exact'`  → pathname === href
 *  - `match === 'nested'` → pathname === href || pathname.startsWith(href + '/')
 *
 * The trailing-slash boundary on the nested branch is required so a sibling
 * route that merely shares the href as a string prefix (e.g. `/administrators`
 * for href `/admin`) stays inactive (R3.5).
 */
function isActive(pathname: string, href: string, match: NavMatch): boolean {
  if (match === 'nested') {
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  return pathname === href;
}

export function NavLink({ href, label, match = 'exact', icon }: NavLinkProps): ReactElement {
  const pathname = usePathname();
  const active = isActive(pathname, href, match);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(NAV_LINK_BASE, active ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE)}
    >
      {icon}
      {label}
    </Link>
  );
}
