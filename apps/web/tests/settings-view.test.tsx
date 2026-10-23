import { ThemeProvider, ToastProvider } from '@aira/ui/web';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This import intentionally points at a module that does not exist yet
// (task 15.2 implements `SettingsView.tsx`). The failing import is the red
// state for task 15.1 — the tests below pin the Settings-view contract the
// implementation must satisfy, per Requirement 7 (7.2, 7.3, 7.4, 7.5, 7.6).
import { SettingsView } from '../src/components/SettingsView';

/**
 * Chosen prop contract (aligned to design.md §3 — Settings (R7)):
 *
 *   interface SettingsViewProps {
 *     // Theme control from R2 (R7.2). Supplied by the `useTheme()` context
 *     // value; the view renders the existing `ThemeToggle` from @aira/ui/web,
 *     // which itself reads `useTheme()` under a `ThemeProvider` ancestor. The
 *     // tests therefore wrap renders in `ThemeProvider` and assert the toggle's
 *     // "Appearance" group rather than threading `theme` through props.
 *     theme?: ThemeContextValue;
 *     // Per-channel notification preferences (R7.3). `inApp` is locked-on per
 *     // R14.5 (In_App cannot be opted out of for critical warnings).
 *     preferences: { inApp: boolean; email: boolean; webPush: boolean };
 *     // Browser Web_Push permission state (R7.5, R7.6). Drives the web-push
 *     // control's enabled/disabled state and the explanatory denied message.
 *     pushState: 'unsupported' | 'default' | 'granted' | 'denied';
 *   }
 *
 * Persistence contract (R7.4): changing a channel preference POSTs to
 *   POST /api/notifications/preferences
 * with a JSON body reflecting the new per-channel state, and shows a success
 * Toast (`data-testid="toast-success"`) on an ok response.
 *
 * Push-permission mocking (R7.5/R7.6): the browser permission + service-worker
 * surface is stubbed lightly. The assertions are driven primarily through the
 * `pushState` prop (`denied` → control off + message; `granted` → on; `default`
 * → enabling triggers the permission-request path). `Notification` and
 * `navigator.serviceWorker` are stubbed with `vi.stubGlobal` so the `default`
 * enable flow can observe a permission request without a real browser.
 */

const PREFERENCES_ENDPOINT = '/api/notifications/preferences';

type Preferences = { inApp: boolean; email: boolean; webPush: boolean };
type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

const ALL_ENABLED: Preferences = { inApp: true, email: true, webPush: true };

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

// Browser push surface. `requestPermission` is the observable seam for the
// `default` enable flow; `serviceWorker.register` stands in for subscription
// registration. Both are intentionally light — the prop drives the assertions.
const requestPermission = vi.fn(async () => 'granted');
const swRegister = vi.fn(async () => ({ pushManager: { subscribe: vi.fn(async () => ({})) } }));

function renderSettings(args: { preferences?: Preferences; pushState?: PushState }) {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <SettingsView
          preferences={args.preferences ?? ALL_ENABLED}
          pushState={args.pushState ?? 'default'}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockClear();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  requestPermission.mockClear();
  swRegister.mockClear();
  // A minimal Notification stub exposing permission + requestPermission.
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, {
      permission: 'default' as NotificationPermission,
      requestPermission,
    }),
  );
  // A minimal serviceWorker stub for the subscription-registration path.
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    serviceWorker: { register: swRegister, ready: Promise.resolve({ pushManager: {} }) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('SettingsView theme preference control (R7.2)', () => {
  it('renders the ThemeToggle "Appearance" group from the theme control', () => {
    renderSettings({});

    // The Theme_Preference control is the existing `ThemeToggle` (from
    // @aira/ui/web), which renders a segmented group with the accessible name
    // "Appearance" (i18n `themeLabel`).
    expect(screen.getByRole('group', { name: /appearance/i })).toBeTruthy();
  });
});

describe('SettingsView per-channel preference toggles (R7.3)', () => {
  it('renders in_app, email and web_push switches reflecting the preferences prop', () => {
    renderSettings({ preferences: ALL_ENABLED });

    // Three channel switches render via the `Switch` primitive (role="switch").
    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(3);

    const inApp = screen.getByRole('switch', { name: /in[-\s]?app/i });
    const email = screen.getByRole('switch', { name: /email/i });
    const webPush = screen.getByRole('switch', { name: /web\s*push/i });

    // All three reflect the enabled preference via aria-checked.
    expect(inApp.getAttribute('aria-checked')).toBe('true');
    expect(email.getAttribute('aria-checked')).toBe('true');
    expect(webPush.getAttribute('aria-checked')).toBe('true');
  });

  it('reflects a disabled email preference as an off switch', () => {
    renderSettings({ preferences: { inApp: true, email: false, webPush: true } });

    const email = screen.getByRole('switch', { name: /email/i });
    expect(email.getAttribute('aria-checked')).toBe('false');
  });

  it('keeps In_App enabled and non-togglable per R14.5', () => {
    // In_App is locked-on for critical warnings (R14.5): it must reflect
    // enabled and must not be user-disablable.
    renderSettings({ preferences: ALL_ENABLED });

    const inApp = screen.getByRole('switch', { name: /in[-\s]?app/i });
    expect(inApp.getAttribute('aria-checked')).toBe('true');
    // Locked-on: the control is disabled so it cannot be toggled off.
    expect(inApp.hasAttribute('disabled')).toBe(true);
  });
});

describe('SettingsView persists a preference change (R7.4)', () => {
  it('POSTs to the preferences endpoint and shows a success Toast when toggling email', async () => {
    renderSettings({ preferences: ALL_ENABLED });

    const email = screen.getByRole('switch', { name: /email/i });
    fireEvent.click(email);

    // The change persists via POST to the preferences endpoint, with a body
    // reflecting email now disabled.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        PREFERENCES_ENDPOINT,
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    const [, init] = fetchSpy.mock.calls.at(-1) as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Partial<Preferences>;
    expect(body.email).toBe(false);

    // A success Toast confirms the persisted change (R7.4).
    expect(await screen.findByTestId('toast-success')).toBeTruthy();
  });
});

describe('SettingsView Web_Push enable flow states (R7.5, R7.6)', () => {
  it('shows web_push on when permission is already granted', () => {
    renderSettings({ preferences: ALL_ENABLED, pushState: 'granted' });

    const webPush = screen.getByRole('switch', { name: /web\s*push/i });
    expect(webPush.getAttribute('aria-checked')).toBe('true');
    expect(webPush.hasAttribute('disabled')).toBe(false);
  });

  it('leaves web_push disabled with an explanatory message when permission is denied', () => {
    renderSettings({
      preferences: { inApp: true, email: true, webPush: false },
      pushState: 'denied',
    });

    const webPush = screen.getByRole('switch', { name: /web\s*push/i });
    // Denied: the control is off and cannot be enabled (R7.6).
    expect(webPush.getAttribute('aria-checked')).toBe('false');
    expect(webPush.hasAttribute('disabled')).toBe(true);
    // An explanatory message is shown (R7.6).
    expect(screen.getByText(/denied|blocked|browser settings/i)).toBeTruthy();
  });

  it('requests browser permission when enabling web_push from the default state', async () => {
    renderSettings({
      preferences: { inApp: true, email: true, webPush: false },
      pushState: 'default',
    });

    const webPush = screen.getByRole('switch', { name: /web\s*push/i });
    // From `default`, enabling triggers the permission-request path (R7.5).
    expect(webPush.hasAttribute('disabled')).toBe(false);
    fireEvent.click(webPush);

    await waitFor(() => expect(requestPermission).toHaveBeenCalled());
  });
});
