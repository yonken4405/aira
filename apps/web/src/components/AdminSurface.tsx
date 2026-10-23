'use client';

import { t } from '@aira/ui';
import { cn } from '@aira/ui/web';
import { usePathname } from 'next/navigation';
import { useId, useMemo, useState, type ReactElement } from 'react';

import { can, type Permission, type Role } from '../lib/auth/rbac';
import { AdminAudit, type AdminAuditProps } from './AdminAudit';
import { AdminDashboards, type AdminDashboardsProps } from './AdminDashboards';
import { AdminResponders, type AdminRespondersProps } from './AdminResponders';
import { Forbidden } from './Forbidden';

/** The three consolidated admin tabs (R4.1). */
export type AdminTabId = 'accounts' | 'metrics' | 'audit';

export interface AdminSurfaceProps {
  /**
   * The signed-in principal's role. Tabs are gated via `can(viewerRole, perm)`
   * (R4.6): accounts→`responder:manage`, metrics→`metrics:read`, audit→`audit:read`.
   */
  readonly viewerRole: Role;
  /**
   * The deep-linked tab when the server page knows it (`/admin`→accounts,
   * `/admin/dashboards`→metrics, `/admin/audit`→audit). When absent the surface
   * derives the tab from `usePathname()`, then falls back to the first permitted
   * tab (R4.8).
   */
  readonly initialTab?: AdminTabId;
  /** Already-loaded data handed straight through to each tab body. */
  readonly accounts: AdminRespondersProps;
  readonly metrics: AdminDashboardsProps;
  readonly audit: AdminAuditProps;
}

/** Static tab metadata: id → gating permission, label copy, and pathname. */
interface TabMeta {
  readonly id: AdminTabId;
  readonly permission: Permission;
  readonly label: string;
  readonly path: string;
}

/** Tab order is fixed (R4.1): accounts, metrics, audit. */
const TAB_META: readonly TabMeta[] = [
  { id: 'accounts', permission: 'responder:manage', label: t('adminAccounts'), path: '/admin' },
  {
    id: 'metrics',
    permission: 'metrics:read',
    label: t('adminDashboards'),
    path: '/admin/dashboards',
  },
  { id: 'audit', permission: 'audit:read', label: t('adminAudit'), path: '/admin/audit' },
];

/** Map a pathname to the tab it deep-links to, when any (R4.2, R4.8). */
function tabForPathname(pathname: string): AdminTabId | undefined {
  // Longest-prefix first so `/admin/dashboards` and `/admin/audit` win over `/admin`.
  if (pathname === '/admin/dashboards' || pathname.startsWith('/admin/dashboards/')) {
    return 'metrics';
  }
  if (pathname === '/admin/audit' || pathname.startsWith('/admin/audit/')) {
    return 'audit';
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
}: AdminSurfaceProps): ReactElement {
  const pathname = usePathname();
  const baseId = useId();

  // The permitted tabs, preserving the fixed order (R4.6, R4.7).
  const permittedTabs = useMemo(
    () => TAB_META.filter((meta) => can(viewerRole, meta.permission)),
    [viewerRole],
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
        {selected === 'accounts' ? <AdminResponders {...accounts} /> : null}
        {selected === 'metrics' ? <AdminDashboards {...metrics} /> : null}
        {selected === 'audit' ? <AdminAudit {...audit} /> : null}
      </div>
    </div>
  );
}
