'use client';

import { t } from '@aira/ui';
import { cn } from '@aira/ui/web';
import { usePathname } from 'next/navigation';
import { useId, useMemo, useState, type ReactElement } from 'react';

import { can, type Permission, type Role } from '../lib/auth/rbac';
import type { OfficeSummary } from '../lib/auth/types';
import { AdminAudit, type AdminAuditProps } from './AdminAudit';
import { AdminDashboards, type AdminDashboardsProps } from './AdminDashboards';
import { AdminResponders, type AdminRespondersProps } from './AdminResponders';
import { AgencyCoverage } from './AgencyCoverage';
import { OrgView } from './OrgView';
import { Forbidden } from './Forbidden';

/** The consolidated admin tabs (R4.1, single-lgu-agency-network R8/R5). */
export type AdminTabId = 'accounts' | 'org' | 'coverage' | 'metrics' | 'audit';

export interface AdminSurfaceProps {
  /**
   * The signed-in principal's role. Tabs are gated via `can(viewerRole, perm)`:
   * accounts→`responder:manage`|`agency:manage`, org→`agency:read:all`|`agency:manage`,
   * coverage→`coverage:manage`, metrics→`metrics:read`, audit→`audit:read` (R4.6).
   */
  readonly viewerRole: Role;
  /**
   * The deep-linked tab when the server page knows it. When absent the surface
   * derives the tab from `usePathname()`, then falls back to the first permitted
   * tab (R4.8).
   */
  readonly initialTab?: AdminTabId;
  /** Already-loaded data handed straight through to each tab body. */
  readonly accounts: AdminRespondersProps;
  readonly metrics: AdminDashboardsProps;
  readonly audit: AdminAuditProps;
  /**
   * The acting agency admin's own agency + the office list, for the coverage editor.
   * Present only for an AGENCY_ADMIN (the LDRRMO coordinator has no own agency).
   */
  readonly agency?: { readonly id: string; readonly name: string } | null;
  readonly offices?: readonly OfficeSummary[];
}

/** Static tab metadata: id → gating permissions, label copy, and pathname. */
interface TabMeta {
  readonly id: AdminTabId;
  /** The tab is shown when the viewer holds ANY of these permissions (R4.6/R4.7). */
  readonly permissions: readonly Permission[];
  readonly label: string;
  readonly path: string;
}

/** Tab order is fixed: accounts, org, coverage, metrics, audit. */
const TAB_META: readonly TabMeta[] = [
  {
    id: 'accounts',
    permissions: ['responder:manage', 'agency:manage'],
    label: t('adminAccounts'),
    path: '/admin',
  },
  {
    id: 'org',
    permissions: ['agency:read:all', 'agency:manage'],
    label: t('adminOrg'),
    path: '/admin/org',
  },
  {
    id: 'coverage',
    permissions: ['coverage:manage'],
    label: t('adminCoverage'),
    path: '/admin/coverage',
  },
  {
    id: 'metrics',
    permissions: ['metrics:read'],
    label: t('adminDashboards'),
    path: '/admin/dashboards',
  },
  { id: 'audit', permissions: ['audit:read'], label: t('adminAudit'), path: '/admin/audit' },
];

/** Map a pathname to the tab it deep-links to, when any (R4.2, R4.8). */
function tabForPathname(pathname: string): AdminTabId | undefined {
  // Longest-prefix first so the deeper routes win over `/admin`.
  if (pathname === '/admin/dashboards' || pathname.startsWith('/admin/dashboards/')) {
    return 'metrics';
  }
  if (pathname === '/admin/audit' || pathname.startsWith('/admin/audit/')) {
    return 'audit';
  }
  if (pathname === '/admin/org' || pathname.startsWith('/admin/org/')) {
    return 'org';
  }
  if (pathname === '/admin/coverage' || pathname.startsWith('/admin/coverage/')) {
    return 'coverage';
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return 'accounts';
  }
  return undefined;
}

/**
 * The consolidated tabbed admin surface (R4). Presents accounts, oversight
 * metrics, and the audit trail as accessible tabs within the App_Shell content
 * frame. Each tab is gated per permission; a tab and its body are omitted when
 * the permission is absent (R4.6, R4.7). The initial tab is the deep-linked tab
 * when permitted, else the first permitted tab (R4.8). Switching tabs swaps the
 * visible body while the single tablist instance stays mounted (R4.5). When the
 * viewer holds none of the three permissions, `Forbidden` renders instead of any
 * tab (R4.9).
 */
export function AdminSurface({
  viewerRole,
  initialTab,
  accounts,
  metrics,
  audit,
  agency,
  offices,
}: AdminSurfaceProps): ReactElement {
  const pathname = usePathname();
  const baseId = useId();

  // The permitted tabs, preserving the fixed order (R4.6, R4.7). The coverage tab also
  // requires a resolved own-agency (an AGENCY_ADMIN); it is omitted without one.
  const permittedTabs = useMemo(
    () =>
      TAB_META.filter((meta) => {
        if (!meta.permissions.some((permission) => can(viewerRole, permission))) {
          return false;
        }
        if (meta.id === 'coverage' && !agency) {
          return false;
        }
        return true;
      }),
    [viewerRole, agency],
  );

  // Resolve the initial selection once: deep-linked tab if permitted, else the
  // tab derived from the pathname if permitted, else the first permitted tab (R4.8).
  const initialSelected = useMemo<AdminTabId | undefined>(() => {
    const permittedIds = new Set(permittedTabs.map((meta) => meta.id));

    if (initialTab && permittedIds.has(initialTab)) {
      return initialTab;
    }

    const derived = tabForPathname(pathname);
    if (derived && permittedIds.has(derived)) {
      return derived;
    }

    return permittedTabs[0]?.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial value only; switches use setSelected.
  }, []);

  const [selected, setSelected] = useState<AdminTabId | undefined>(initialSelected);

  // None of the three permissions → not-authorized, no tabs or bodies (R4.9).
  if (permittedTabs.length === 0 || selected === undefined) {
    return <Forbidden />;
  }

  const activeIndex = permittedTabs.findIndex((meta) => meta.id === selected);

  // Roving keyboard support across the tablist (left/right/home/end).
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const last = permittedTabs.length - 1;
    let next = activeIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = activeIndex >= last ? 0 : activeIndex + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = activeIndex <= 0 ? last : activeIndex - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = permittedTabs[next];
    if (nextTab) {
      setSelected(nextTab.id);
    }
  }

  const tabId = (id: AdminTabId) => `${baseId}-tab-${id}`;
  const panelId = (id: AdminTabId) => `${baseId}-panel-${id}`;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t('appName')}
        className="flex flex-wrap items-center gap-1 border-b border-line"
      >
        {permittedTabs.map((meta) => {
          const isSelected = meta.id === selected;
          return (
            <button
              key={meta.id}
              type="button"
              role="tab"
              id={tabId(meta.id)}
              aria-selected={isSelected}
              aria-controls={panelId(meta.id)}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelected(meta.id)}
              onKeyDown={onKeyDown}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-[11px] font-bold uppercase tracking-label',
                'transition-colors duration-fast',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
                isSelected ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId(selected)} aria-labelledby={tabId(selected)} tabIndex={0}>
        {selected === 'accounts' ? (
          <div className="flex flex-col gap-4">
            <AdminResponders {...accounts} />
          </div>
        ) : null}
        {selected === 'org' ? <OrgView /> : null}
        {selected === 'coverage' && agency ? (
          <AgencyCoverage agencyId={agency.id} agencyName={agency.name} offices={offices ?? []} />
        ) : null}
        {selected === 'metrics' ? <AdminDashboards {...metrics} /> : null}
        {selected === 'audit' ? <AdminAudit {...audit} /> : null}
      </div>
    </div>
  );
}
