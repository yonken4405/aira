'use client';

import { t } from '@aira/ui';
import { cn } from '@aira/ui/web';
import { Bell, CheckCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * A single notification as rendered by the bell island. Mirrors the server
 * contract (`store.listForRecipient` returns newest-first); `createdAt` is an
 * ISO UTC string. Kept structurally identical to the Phase-5 wire shape so the
 * `GET /api/notifications?unread=1` payload maps straight onto it.
 */
export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly read: boolean;
  readonly createdAt: string;
}

export interface NotificationCenterProps {
  /** Seed badge count (from SSR when available; the shell mounts with 0). */
  readonly initialUnread: number;
  /** Seed list, already reverse-chronological (newest first). */
  readonly initialItems: readonly NotificationView[];
}

/** Shape of the unread-polling payload: `GET /api/notifications?unread=1`. */
interface UnreadPayload {
  readonly ok: boolean;
  readonly count: number;
  readonly recent: readonly NotificationView[];
}

/** Fixed lightweight-poll cadence (design §8: 30s, paused while hidden). */
const POLL_MS = 30_000;
const UNREAD_URL = '/api/notifications?unread=1';

/**
 * Fetch the unread payload, tolerating a missing or throwing `fetch`. The shell
 * mounts this island without server-fetched seed data and some tests never stub
 * `fetch`, so every network touch is fail-soft: on any error we return `null`
 * and the caller keeps the last-known (seeded) state rather than crashing.
 */
async function fetchUnread(): Promise<UnreadPayload | null> {
  if (typeof fetch !== 'function') {
    return null;
  }
  try {
    const res = await fetch(UNREAD_URL, { credentials: 'same-origin' });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as Partial<UnreadPayload>;
    if (!data || data.ok !== true) {
      return null;
    }
    return {
      ok: true,
      count: typeof data.count === 'number' ? data.count : 0,
      recent: Array.isArray(data.recent) ? data.recent : [],
    };
  } catch {
    return null;
  }
}

/** POST a mark-read style action, fail-soft (never throws out of the island). */
async function postAction(url: string): Promise<void> {
  if (typeof fetch !== 'function') {
    return;
  }
  try {
    await fetch(url, { method: 'POST', credentials: 'same-origin' });
  } catch {
    // Fail-soft: the subsequent refetch reconciles the true state anyway.
  }
}

/**
 * The Notification Center bell island (R8, R20.5). Renders a bell `<button>`
 * with an unread-count badge whose count is announced to assistive tech via an
 * `aria-live` region and an `aria-label` that includes the count. Clicking the
 * bell toggles a dropdown listing items newest-first. Opening an item POSTs its
 * read endpoint then immediately refetches the unread payload; "mark all read"
 * POSTs the bulk endpoint then refetches. The island also polls the unread
 * payload every 30s, pausing while `document.hidden`.
 */
export function NotificationCenter({
  initialUnread,
  initialItems,
}: NotificationCenterProps): ReactElement {
  const [count, setCount] = useState<number>(initialUnread);
  const [items, setItems] = useState<readonly NotificationView[]>(initialItems);
  const [open, setOpen] = useState(false);

  const refetchUnread = useCallback(async () => {
    const payload = await fetchUnread();
    if (payload) {
      setCount(payload.count);
      setItems(payload.recent);
    }
  }, []);

  // Keep the latest applier in a ref so the interval effect can run once (empty
  // deps) without going stale, while the mount fetch calls it directly.
  const refetchRef = useRef(refetchUnread);
  refetchRef.current = refetchUnread;

  // Mount GET + 30s polling, paused while the tab is hidden. The mount fetch
  // seeds the real count/list over the SSR seed; the interval skips any tick
  // while `document.hidden` so a backgrounded tab stops polling. Every network
  // touch is fail-soft (see fetchUnread), so a missing or throwing `fetch` in a
  // test that never stubbed it leaves the seeded state in place.
  useEffect(() => {
    void refetchRef.current();

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      void refetchRef.current();
    }, POLL_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const onOpenItem = useCallback(
    async (id: string) => {
      await postAction(`/api/notifications/${id}/read`);
      await refetchUnread();
    },
    [refetchUnread],
  );

  const onMarkAllRead = useCallback(async () => {
    await postAction('/api/notifications/mark-all-read');
    await refetchUnread();
  }, [refetchUnread]);

  const unreadLabel = t('shellNotificationsBellCount', { count });

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unreadLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'relative inline-flex items-center justify-center border border-line bg-raised p-1.5',
          'text-muted transition-colors duration-fast hover:border-muted hover:text-fg',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
        )}
      >
        <Bell aria-hidden="true" size={14} strokeWidth={2} />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-1.5 -top-1.5 inline-flex min-w-[16px] items-center justify-center',
              'border border-line bg-status-error px-1 text-[10px] font-bold leading-4 text-fg',
            )}
          >
            {count}
          </span>
        ) : null}
      </button>

      {/* Announce the unread count to assistive tech (R20.5). */}
      <span role="status" aria-live="polite" className="sr-only">
        {unreadLabel}
      </span>

      {open ? (
        <div
          role="menu"
          aria-label={t('notifications')}
          className={cn('absolute right-0 z-50 mt-2 w-72 border border-line bg-surface shadow-lg')}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-label text-muted">
              {t('notifications')}
            </span>
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              className={cn(
                'inline-flex items-center gap-1 border border-line bg-raised px-2 py-1',
                'text-[10px] font-bold uppercase tracking-label text-muted',
                'transition-colors duration-fast hover:border-muted hover:text-fg',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
              )}
            >
              <CheckCheck aria-hidden="true" size={12} />
              {t('markAllRead')}
            </button>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted">{t('notificationsEmpty')}</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void onOpenItem(item.id)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                      'transition-colors duration-fast hover:bg-raised',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fg',
                      item.read ? 'text-muted' : 'text-fg',
                    )}
                  >
                    <span className="text-xs font-semibold">{item.title}</span>
                    <span className="text-[11px] text-muted">{item.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
