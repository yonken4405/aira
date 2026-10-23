import { ToastProvider } from '@aira/ui/web';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This import intentionally points at a module that does not exist yet
// (task 16.2 implements `NotificationCenter.tsx`). The failing import is the
// red state for task 16.1 — the tests below pin the bell-island contract the
// implementation must satisfy, per Requirement 8 (8.1-8.5) and R20.5.
import { NotificationCenter } from '../src/components/NotificationCenter';

import type { NotificationView } from '../src/components/NotificationCenter';

/*
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRACT FOR TASK 16.2 (what the implementation must satisfy)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Props (from design.md — NotificationCenterProps):
 *   interface NotificationCenterProps {
 *     readonly initialUnread: number;                 // seed badge count (SSR)
 *     readonly initialItems: readonly NotificationView[]; // seed list, reverse-chron
 *   }
 *   interface NotificationView {
 *     readonly id: string;
 *     readonly type: string;
 *     readonly title: string;
 *     readonly body: string;
 *     readonly read: boolean;
 *     readonly createdAt: string; // ISO UTC
 *   }
 *
 * Endpoints the island talks to:
 *   - GET  /api/notifications?unread=1
 *       → { ok: true, count: number, recent: NotificationView[] }
 *       Called once on mount AND on a fixed 30s interval (paused while hidden),
 *       AND as an immediate refetch right after any mark-read action.
 *   - POST /api/notifications/<id>/read      → marks one item read (open-item)
 *   - POST /api/notifications/mark-all-read  → marks all read, count → 0
 *
 * Polling behavior (design: "lightweight polling", 30s + visibilitychange pause):
 *   - interval = 30_000 ms
 *   - while document.hidden === true the interval must NOT fetch
 *   - after a mark-read / mark-all-read POST the island refetches the unread
 *     payload immediately (not waiting for the next tick)
 *
 * Accessibility (R20.5 / R8.3): the unread count is exposed to assistive tech
 * via an aria-live region and/or an aria-label on the badge that includes the
 * count. The bell is a <button> whose accessible name mentions "notifications".
 * ────────────────────────────────────────────────────────────────────────────
 */

const POLL_MS = 30_000;

// `NotificationCenter` is a client island that may render NavLink-adjacent
// chrome; mock next/navigation the same way app-shell.test.tsx does so the
// island mounts without the real Next.js runtime.
vi.mock('next/navigation', () => ({
  usePathname: () => '/console',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
// Items are passed already reverse-chronological (newest first), matching the
// server contract (store.listForRecipient returns newest-first). The test
// asserts the DOM preserves this order.
const NEWER: NotificationView = {
  id: 'n-newer',
  type: 'incident.assigned',
  title: 'Newer notification',
  body: 'Most recent item body',
  read: false,
  createdAt: '2024-05-02T10:00:00.000Z',
};
const OLDER: NotificationView = {
  id: 'n-older',
  type: 'account.role-changed',
  title: 'Older notification',
  body: 'Earlier item body',
  read: false,
  createdAt: '2024-05-01T09:00:00.000Z',
};
const INITIAL_ITEMS: readonly NotificationView[] = [NEWER, OLDER];

// ── fetch stub ────────────────────────────────────────────────────────────
// A single vi.fn() installed on global.fetch. The unread GET returns the
// unread payload; the mark-read POSTs resolve ok. Each test can override the
// unread count the GET reports via `unreadPayload`.
type FetchMock = ReturnType<typeof vi.fn>;

let fetchMock: FetchMock;
const unreadPayload = { count: INITIAL_ITEMS.length, recent: INITIAL_ITEMS as NotificationView[] };

function jsonOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function installFetch() {
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/notifications') && url.includes('unread=1')) {
      return jsonOk({ ok: true, count: unreadPayload.count, recent: unreadPayload.recent });
    }
    // mark-read / mark-all-read POSTs
    return jsonOk({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
}

// Count only the unread-polling GETs (ignores the mark-read POSTs).
function unreadGetCalls(): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const url = typeof input === 'string' ? input : String(input);
    return url.includes('/api/notifications') && url.includes('unread=1');
  }).length;
}

function postCalls(predicate: (url: string) => boolean): number {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return method === 'POST' && predicate(url);
  }).length;
}

// document.hidden is a read-only accessor in jsdom; redefine it so tests can
// drive the visibilitychange pause.
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function renderCenter(
  props: { initialUnread?: number; initialItems?: readonly NotificationView[] } = {},
) {
  return render(
    <ToastProvider>
      <NotificationCenter
        initialUnread={props.initialUnread ?? INITIAL_ITEMS.length}
        initialItems={props.initialItems ?? INITIAL_ITEMS}
      />
    </ToastProvider>,
  );
}

// Open the bell dropdown so the list becomes visible.
function openBell() {
  fireEvent.click(screen.getByRole('button', { name: /notification/i }));
}

beforeEach(() => {
  unreadPayload.count = INITIAL_ITEMS.length;
  unreadPayload.recent = INITIAL_ITEMS as NotificationView[];
  setHidden(false);
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('NotificationCenter bell + unread badge (R8.1, R8.3, R20.5)', () => {
  it('renders a bell button with an accessible name mentioning notifications', () => {
    renderCenter({ initialUnread: 2 });
    expect(screen.getByRole('button', { name: /notification/i })).toBeTruthy();
  });

  it('shows the unread count from props and exposes it to assistive tech', () => {
    renderCenter({ initialUnread: 3 });

    // The count is visible somewhere in the badge.
    expect(screen.getByText('3')).toBeTruthy();

    // And it is announced: either an aria-live region or an aria-label that
    // includes the count must be present (R20.5).
    const live = document.querySelector('[aria-live]');
    const labelledByCount =
      screen.queryByLabelText(/3 unread/i) ??
      screen.queryByRole('button', { name: /3 unread/i }) ??
      screen.queryByRole('status');
    expect(Boolean(live) || Boolean(labelledByCount)).toBe(true);
  });
});

describe('NotificationCenter list ordering (R8.2)', () => {
  it('lists items reverse-chronologically when the bell is opened', () => {
    renderCenter();
    openBell();

    const newer = screen.getByText(NEWER.title);
    const older = screen.getByText(OLDER.title);
    expect(newer).toBeTruthy();
    expect(older).toBeTruthy();

    // The newer item must appear before the older one in document order.
    const position = newer.compareDocumentPosition(older);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('NotificationCenter open-item marks read (R8.4)', () => {
  it('POSTs the read URL for the opened item and decrements the unread count', async () => {
    renderCenter({ initialUnread: 2 });
    openBell();

    // After opening the item the server reports one fewer unread.
    unreadPayload.count = 1;

    fireEvent.click(screen.getByText(NEWER.title));

    await waitFor(() => {
      expect(
        postCalls((url) => url.includes(`/api/notifications/${NEWER.id}/read`)),
      ).toBeGreaterThanOrEqual(1);
    });

    // The displayed count drops to 1 (via the immediate refetch).
    await waitFor(() => {
      expect(screen.getByText('1')).toBeTruthy();
    });
  });
});

describe('NotificationCenter mark-all-read (R8.5)', () => {
  it('POSTs mark-all-read and zeroes the badge count', async () => {
    renderCenter({ initialUnread: 2 });
    openBell();

    unreadPayload.count = 0;

    fireEvent.click(screen.getByRole('button', { name: /mark all .*read/i }));

    await waitFor(() => {
      expect(
        postCalls((url) => url.includes('/api/notifications/mark-all-read')),
      ).toBeGreaterThanOrEqual(1);
    });

    // Count goes to 0: either the "0" badge shows or no positive count remains.
    await waitFor(() => {
      expect(screen.queryByText('2')).toBeNull();
      expect(screen.queryByText('1')).toBeNull();
    });
  });
});

describe('NotificationCenter polling (R8 lightweight polling + visibility pause)', () => {
  it('fetches on mount, then again after a 30s interval tick', async () => {
    vi.useFakeTimers();
    renderCenter();

    // One unread GET on mount.
    await waitFor(() => expect(unreadGetCalls()).toBeGreaterThanOrEqual(1));
    const afterMount = unreadGetCalls();

    // Advancing a full interval triggers another unread GET.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(unreadGetCalls()).toBeGreaterThan(afterMount);
  });

  it('does NOT fetch on the interval while the document is hidden', async () => {
    vi.useFakeTimers();
    renderCenter();

    await waitFor(() => expect(unreadGetCalls()).toBeGreaterThanOrEqual(1));

    // Hide the tab — the visibility pause must stop interval fetching.
    act(() => {
      setHidden(true);
    });
    const beforeHidden = unreadGetCalls();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    });

    expect(unreadGetCalls()).toBe(beforeHidden);
  });

  it('refetches the unread payload immediately after a mark-read action', async () => {
    renderCenter({ initialUnread: 2 });
    openBell();

    const beforeOpen = unreadGetCalls();
    unreadPayload.count = 1;

    fireEvent.click(screen.getByText(NEWER.title));

    // The read POST fires and is followed by an immediate unread refetch.
    await waitFor(() => {
      expect(
        postCalls((url) => url.includes(`/api/notifications/${NEWER.id}/read`)),
      ).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(unreadGetCalls()).toBeGreaterThan(beforeOpen);
    });
  });
});
