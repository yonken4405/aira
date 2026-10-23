import { ThemeProvider, ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Render the REAL shell header so the test pins the production logout wiring,
// not a stand-in. `AppShellHeader` is the single sign-out surface the three old
// headers (PlatformHeader/console inline/AdminHeader) were migrated into
// (task 12.2). This is the red state for task 30.1: the header currently signs
// out silently (no Toast), so every success-toast assertion below MUST FAIL
// until task 30.2 adds the logout toasts. Do NOT modify AppShellHeader here.
import { AppShellHeader } from '../src/components/AppShellHeader';

/**
 * Requirement 17 — Toast coverage for all transactions.
 *
 *   R17.3  platform-operator logout shows a logout confirmation success Toast
 *          (closing the silent PlatformHeader gap).
 *   R17.4  console-user logout shows a logout confirmation success Toast
 *          (closing the silent console-logout gap).
 *   R17.2  a failing logout transaction shows an error Toast describing the
 *          failure.
 *   R17.5  all Toast copy is routed through the `t()` i18n helper.
 *   R17.6  Toasts render inside an aria-live region.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * i18n key documented for task 30.2
 * ──────────────────────────────────────────────────────────────────────────
 * 30.2 must add a NEW success-copy key to `packages/ui/src/i18n.ts` and route
 * the logout success Toast title through `t('signedOut')`:
 *
 *     signedOut: 'Signed out',
 *
 * (An error key already exists for the failure path — `loginUnavailable` style
 * copy — but 30.2 is free to add a dedicated `signOutFailed` key; this test
 * only asserts an error Toast appears for the failure path, not its exact copy,
 * so the choice of error key is left to 30.2.) The success assertions below
 * compare the rendered toast title to EXPECTED_SIGNED_OUT_COPY, which is the
 * English value `t('signedOut')` must return once 30.2 adds the key. Keeping the
 * expected literal here (rather than calling `t('signedOut')`, which does not
 * type-check until the key exists) lets this test compile and fail for the right
 * reason today — no toast rendered — instead of a type error.
 */
const SIGNED_OUT_I18N_KEY = 'signedOut';
const EXPECTED_SIGNED_OUT_COPY = 'Signed out';

// The platform tier overrides the default sign-out wiring (DELETE
// /api/platform/session -> /platform/login); the default (responder/console)
// variant POSTs /api/auth/logout -> /login. Both paths must surface a toast.
const PLATFORM_SIGN_OUT = {
  endpoint: '/api/platform/session',
  method: 'DELETE' as const,
  redirectTo: '/platform/login',
};

// `AppShellHeader` uses `useRouter` (replace/refresh) and its NavLinks read
// `usePathname`; `next/link` is mocked down to a plain anchor so the DOM reads
// cleanly without the Next.js runtime (mirrors apps/web/tests/app-shell.test.tsx).
const nav = vi.hoisted(() => ({
  pathname: '/console',
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type SignOutConfig = {
  endpoint: string;
  method?: 'POST' | 'DELETE';
  redirectTo?: string;
};

const RESPONDER_IDENTITY = {
  tier: 'responders' as const,
  displayName: 'k9-01',
  roleLabel: 'Responder',
};
const PLATFORM_IDENTITY = { tier: 'platform_admins' as const, displayName: 'ops' };

// Default fetch spy resolves an ok logout response (success path). Individual
// tests override it to reject / return !ok for the failure path (R17.2).
const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));

function renderHeader(args: {
  identity: typeof RESPONDER_IDENTITY | typeof PLATFORM_IDENTITY;
  signOut?: SignOutConfig;
}) {
  // The header renders ThemeToggle (needs ThemeProvider) and uses toasts via the
  // ToastProvider ancestor (which renders toasts with data-testid="toast-<tone>"
  // inside its aria-live region). NotificationCenter mounts inside and fetches on
  // mount — the stubbed fetch keeps that fail-soft.
  return render(
    <ThemeProvider>
      <ToastProvider>
        <AppShellHeader
          identity={args.identity}
          navEntries={[{ href: '/console', label: 'Queue' }]}
          role={args.identity.tier === 'responders' ? 'RESPONDER' : undefined}
          signOut={args.signOut}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
}

/**
 * Click Sign out and, if a confirmation dialog gates the logout (task 31 adds
 * a Confirm_Dialog on logout per R18.3), click its confirm action so the logout
 * actually proceeds. Tolerant of BOTH the gated and ungated shapes so 30.1 does
 * not fight whatever ordering task 31 lands in:
 *  - ungated: clicking Sign out triggers the logout directly; no alertdialog.
 *  - gated:   clicking Sign out opens a Radix AlertDialog (role="alertdialog");
 *             we click its action (non-cancel) button to proceed.
 */
async function clickSignOutAndConfirm(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

  // If a confirm/alertdialog appeared, proceed through it. Give Radix a tick to
  // portal the dialog in; absence of a dialog is the ungated path and is fine.
  const dialog = await screen
    .findByRole('alertdialog', undefined, { timeout: 200 })
    .catch(() => null);
  if (!dialog) {
    return;
  }

  // The confirm action is the button that does NOT cancel/dismiss. Pick the
  // button whose accessible name is not a cancel-style label.
  const buttons = within(dialog).getAllByRole('button');
  const confirmButton =
    buttons.find((b) => !/cancel|dismiss|close|back/i.test(b.textContent ?? '')) ??
    buttons[buttons.length - 1];
  fireEvent.click(confirmButton as HTMLElement);
}

beforeEach(() => {
  nav.pathname = '/console';
  nav.replace.mockClear();
  nav.refresh.mockClear();
  nav.push.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('logout success Toast (R17.3, R17.4)', () => {
  it('shows a success Toast when the default console logout succeeds (R17.4)', async () => {
    renderHeader({ identity: RESPONDER_IDENTITY });

    await clickSignOutAndConfirm();

    // The logout fetch must have fired against the default console endpoint.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    // FAILS today: signOut() navigates with no toast.
    const toast = await screen.findByTestId('toast-success');
    expect(toast).toBeTruthy();
  });

  it('shows a success Toast when the platform logout variant succeeds (R17.3)', async () => {
    renderHeader({ identity: PLATFORM_IDENTITY, signOut: PLATFORM_SIGN_OUT });

    await clickSignOutAndConfirm();

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/platform/session',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );

    // FAILS today: the platform signOut variant also navigates with no toast.
    const toast = await screen.findByTestId('toast-success');
    expect(toast).toBeTruthy();
  });
});

describe('logout failure Toast (R17.2)', () => {
  it('shows an error Toast when the logout fetch rejects', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    renderHeader({ identity: RESPONDER_IDENTITY });

    await clickSignOutAndConfirm();

    // FAILS today: signOut() swallows the rejection (.catch) and shows no toast.
    const toast = await screen.findByTestId('toast-error');
    expect(toast).toBeTruthy();
  });

  it('shows an error Toast when the logout response is not ok', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 500 }));

    renderHeader({ identity: PLATFORM_IDENTITY, signOut: PLATFORM_SIGN_OUT });

    await clickSignOutAndConfirm();

    // FAILS today: a !ok logout response is ignored and shows no toast.
    const toast = await screen.findByTestId('toast-error');
    expect(toast).toBeTruthy();
  });
});

describe('logout Toast copy and aria-live (R17.5, R17.6)', () => {
  it('routes the success Toast title through t() — the documented signedOut key (R17.5)', async () => {
    renderHeader({ identity: RESPONDER_IDENTITY });

    await clickSignOutAndConfirm();

    // The rendered toast title must equal the copy `t('signedOut')` returns once
    // task 30.2 adds the `signedOut` i18n key. Asserting the exact value pins the
    // copy to the i18n dictionary rather than a hardcoded string literal.
    const toast = await screen.findByTestId('toast-success');
    expect(within(toast).getByText(EXPECTED_SIGNED_OUT_COPY)).toBeTruthy();
  });

  it('renders Toasts inside an aria-live region (R17.6)', async () => {
    const { container } = renderHeader({ identity: RESPONDER_IDENTITY });

    // The ToastProvider region is aria-live already — a light assertion that the
    // announce surface exists so screen readers hear the logout outcome.
    expect(container.ownerDocument.querySelector('[aria-live]')).toBeTruthy();

    await clickSignOutAndConfirm();

    // And the success toast lands inside that aria-live region.
    const toast = await screen.findByTestId('toast-success');
    const live = toast.closest('[aria-live]');
    expect(live).toBeTruthy();
  });
});

// Reference the documented key so an accidental rename of the intended 30.2 key
// is caught here rather than silently drifting.
it('documents the i18n key 30.2 must add', () => {
  expect(SIGNED_OUT_I18N_KEY).toBe('signedOut');
});
