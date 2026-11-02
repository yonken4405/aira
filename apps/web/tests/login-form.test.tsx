import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from '../app/login/LoginForm';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
  usePathname: () => '/login',
}));

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({}), { status: 401 }));

function renderLogin(next: string | null = null) {
  return render(<LoginForm next={next} />);
}

function submit(email = 'k9-01@aira.test', password = 'correct horse battery staple') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy);
  fetchSpy.mockReset();
  nav.replace.mockClear();
  nav.refresh.mockClear();
});

describe('LoginForm', () => {
  it('keeps the sign-in button disabled until both fields are filled', () => {
    renderLogin();

    const button = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'k9-01@aira.test' } });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    expect(button.disabled).toBe(false);
  });

  it('shows one generic message when the responder login rejects the credentials', async () => {
    // single-lgu-agency-network R2.3: /login posts ONLY the responder login and never
    // retries a platform login (the break-glass superadmin has no web entry point).
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'invalid_credentials' }), { status: 401 }),
    );

    renderLogin();
    submit();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Email or password is incorrect.',
    );
    expect(nav.replace).not.toHaveBeenCalled();
    // Exactly one request — to the responder login, never the platform login.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  it('never calls the platform login endpoint (no platform retry, R2.3)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'invalid_credentials' }), { status: 401 }),
    );

    renderLogin();
    submit('admin@aira.dev');

    await screen.findByRole('alert');
    const calledUrls = fetchSpy.mock.calls.map((call) => (call as unknown[])[0]);
    expect(calledUrls).not.toContain('/api/platform/login');
  });

  it('treats a lockout as authoritative and does not retry the other tier', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'account_locked', retryAfterSeconds: 600 }), {
        status: 423,
      }),
    );

    renderLogin();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many attempts. Try again in 10 minutes.',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('explains an unavailable authentication service without retrying', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 503 }));

    renderLogin();
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Authentication is unavailable. Try again shortly.',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('lands the role on its console after a successful sign-in', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          viewer: {
            id: 'responder-dispatcher',
            callsign: 'OPCEN-01',
            role: 'DISPATCHER',
            officeName: 'Cebu City DRRMO',
            mustChangePassword: false,
          },
        }),
        { status: 200 },
      ),
    );

    renderLogin();
    submit('opcen-01');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/console'));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('honours a validated next path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          viewer: {
            id: 'responder-admin',
            callsign: 'ADMIN-1',
            role: 'ADMIN',
            officeName: 'Cebu City DRRMO',
            mustChangePassword: false,
          },
        }),
        { status: 200 },
      ),
    );

    renderLogin('/admin/audit');
    submit('admin-1');

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/admin/audit'));
  });
});
