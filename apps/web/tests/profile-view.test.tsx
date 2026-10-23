import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@aira/ui/web';

// This import intentionally points at a module that does not exist yet
// (task 14.2 creates `ProfileView.tsx`). The failing import is the red state
// for task 14.1 — the tests below pin the contract 14.2 must satisfy for the
// Profile common feature (R6.2–R6.6).
import { ProfileView } from '../src/components/ProfileView';

/**
 * Prop contract chosen for `ProfileView` (task 14.2 must match this). It mirrors
 * the design's `ProfileViewProps` verbatim (design.md §3 "Profile (R6)"):
 *
 *   type Tier = 'responders' | 'platform_admins' | 'citizens'; // NotificationTier
 *
 *   interface ProfileViewProps {
 *     email: string;                 // rendered READ-ONLY (R6.2)
 *     tier: Tier;
 *     editable?: {                   // present only for responders (R6.3)
 *       displayName: string;
 *       callsign: string | null;
 *     };
 *     canChangePassword: boolean;    // can(role, 'account:change-password') (R6.6)
 *   }
 *
 * Behaviour the island owns:
 *  - The email is shown but never an editable, enabled field (R6.2).
 *  - When `editable` is provided (responder), the display-name and callsign
 *    inputs render and are editable (R6.3).
 *  - A valid submit POSTs the changed profile to the documented endpoint and,
 *    on an ok response, shows a success Toast (R6.4).
 *  - An invalid submit (empty required display name) surfaces a field-scoped
 *    error through the upgraded `Field` (aria-invalid) WITHOUT calling fetch
 *    (R6.5).
 *  - The embedded `ChangePasswordForm` (its "Change password" heading +
 *    current-password field) renders only when `canChangePassword` is true
 *    (R6.6).
 *
 * ENDPOINT CONTRACT (documented here so 14.2 implements the matching route):
 * the responder profile submit issues
 *     POST /api/auth/profile
 * with `credentials: 'same-origin'`, a JSON content-type header, and a JSON
 * body carrying the edited `{ displayName, callsign }`. These tests assert the
 * call shape only; 14.2 implements the handler/route.
 */
const PROFILE_ENDPOINT = '/api/auth/profile';

// `ProfileView` embeds `ChangePasswordForm`, which uses `useRouter`; the shell
// pieces it may render read `usePathname`/`next/link`. Drive navigation through
// a hoisted mutable closure and mock `next/link` down to a plain anchor so the
// DOM can be read without the real Next.js runtime (mirrors
// apps/web/tests/app-shell.test.tsx and apps/web/tests/login-form.test.tsx).
const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/console/profile',
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Tier = 'responders' | 'platform_admins' | 'citizens';

type RenderArgs = {
  email?: string;
  tier?: Tier;
  editable?: { displayName: string; callsign: string | null };
  canChangePassword?: boolean;
};

// Stub fetch like login-form.test.tsx: a default spy resolving ok, reset per test.
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

function renderProfile(args: RenderArgs = {}) {
  // ChangePasswordForm + ProfileView use useToast → require a ToastProvider
  // ancestor; the ToastProvider renders toasts with data-testid="toast-<tone>".
  return render(
    <ToastProvider>
      <ProfileView
        email={args.email ?? 'k9-01@aira.test'}
        tier={args.tier ?? 'responders'}
        editable={args.editable}
        canChangePassword={args.canChangePassword ?? false}
      />
    </ToastProvider>,
  );
}

const RESPONDER_EDITABLE = { displayName: 'K9 Unit 01', callsign: 'K9-01' } as const;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  nav.replace.mockClear();
  nav.refresh.mockClear();
  nav.push.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProfileView email is read-only (R6.2)', () => {
  it('shows the signed-in email without exposing it as an editable enabled field', () => {
    renderProfile({ email: 'k9-01@aira.test', tier: 'responders', editable: RESPONDER_EDITABLE });

    // The email value is present on screen.
    expect(screen.getByText(/k9-01@aira\.test/i)).toBeTruthy();

    // It must NOT be an editable, enabled text input. If an <input> carrying the
    // email exists at all, it has to be disabled or readOnly (plain text also
    // satisfies R6.2 — then there is simply no such input).
    const emailInputs = screen
      .queryAllByDisplayValue('k9-01@aira.test')
      .filter((el): el is HTMLInputElement => el.tagName === 'INPUT');
    for (const input of emailInputs) {
      expect(input.disabled || input.readOnly).toBe(true);
    }
  });
});

describe('ProfileView responder fields are editable (R6.3)', () => {
  it('renders editable display-name and callsign inputs for a responder', () => {
    renderProfile({ tier: 'responders', editable: RESPONDER_EDITABLE });

    const displayName = screen.getByLabelText(/display name/i) as HTMLInputElement;
    const callsign = screen.getByLabelText(/callsign/i) as HTMLInputElement;

    expect(displayName.disabled).toBe(false);
    expect(callsign.disabled).toBe(false);

    fireEvent.change(displayName, { target: { value: 'K9 Unit 07' } });
    fireEvent.change(callsign, { target: { value: 'K9-07' } });

    expect(displayName.value).toBe('K9 Unit 07');
    expect(callsign.value).toBe('K9-07');
  });
});

describe('ProfileView valid submit persists and toasts (R6.4)', () => {
  it('POSTs the changed profile to the profile endpoint and shows a success Toast', async () => {
    renderProfile({ tier: 'responders', editable: RESPONDER_EDITABLE, canChangePassword: false });

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: 'K9 Unit 07' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledWith(
      PROFILE_ENDPOINT,
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );

    // The ToastProvider renders a success toast with data-testid="toast-success".
    expect(await screen.findByTestId('toast-success')).toBeTruthy();
  });
});

describe('ProfileView invalid submit surfaces a field error (R6.5)', () => {
  it('marks the empty display-name field aria-invalid and does not call fetch', async () => {
    renderProfile({
      tier: 'responders',
      editable: { displayName: 'K9 Unit 01', callsign: 'K9-01' },
    });

    // Clear the required display name, then submit — a client-side rejection.
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/display name/i).getAttribute('aria-invalid')).toBe('true'),
    );

    // Invalid submits never hit the network (R6.5 rejects before persistence).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ProfileView embedded password change (R6.6)', () => {
  it('embeds the password-change UI when canChangePassword is true', () => {
    renderProfile({ tier: 'responders', editable: RESPONDER_EDITABLE, canChangePassword: true });

    expect(screen.getByRole('heading', { name: /change password/i })).toBeTruthy();
    expect(screen.getByLabelText(/current password/i)).toBeTruthy();
  });

  it('omits the password-change UI when canChangePassword is false', () => {
    renderProfile({ tier: 'responders', editable: RESPONDER_EDITABLE, canChangePassword: false });

    expect(screen.queryByRole('heading', { name: /change password/i })).toBeNull();
    expect(screen.queryByLabelText(/current password/i)).toBeNull();
  });
});
