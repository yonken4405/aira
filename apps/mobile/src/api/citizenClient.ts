/**
 * `CitizenApiClient` — the mobile citizen app's single door to the `/api/citizen/*`
 * backend (mobile-citizen-account spec, task 11.2; design §"API client contract").
 *
 * React Native's `fetch` has no browser cookie jar and sends no `Origin`, so this
 * client:
 *   - maintains a MANUAL cookie jar: it extracts the `aira_citizen_session` value from
 *     the `set-cookie` header on register/login/device 2xx (via the pure `@aira/ui`
 *     `extractSessionToken`), persists it through `SessionStore`, and re-attaches it as
 *     a `Cookie: aira_citizen_session=<token>` header on every later request (via the
 *     pure `@aira/ui` `formatCookieHeader`);
 *   - clears the jar + store on logout, account-delete, and any `401`;
 *   - bounds every request with a 10 s `AbortController` deadline (R3.3/R7.1/R7.8);
 *   - derives connectivity from the outcome — a `fetch` throw is `offline`, an abort is
 *     `timeout` (design §Connectivity);
 *   - never logs a request body, the cookie/session token, the device key, or any
 *     medical field (R2.8/R4.6/R6.5/R7.11/R10.7/R12).
 *
 * The base URL is injected; a non-HTTPS base is refused outside development (R12.4).
 * This module targets ONLY `/api/citizen/*`. `logout()` → `DELETE /api/citizen/session`;
 * `deleteAccount()` → `DELETE /api/citizen/account`.
 */

import {
  extractSessionToken,
  formatCookieHeader,
  type CitizenView,
  type MedicalDraft,
} from '@aira/ui';
import type { SessionStore } from '../storage/sessionStore';

/**
 * `__DEV__` is a React Native global (true in dev builds, false in release). It is not in
 * the ambient type set here, so declare it and read it defensively through `devDefault()`.
 */
declare const __DEV__: boolean | undefined;

function devDefault(): boolean {
  return typeof __DEV__ === 'boolean' ? __DEV__ : false;
}

/** The owner-only medical profile the backend echoes on GET/PUT (mirrors the server shape). */
export interface MedicalProfile {
  readonly bloodType: string | null;
  readonly ageBand: string | null;
  readonly allergies: readonly string[];
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly notes: string | null;
  readonly contacts: readonly {
    readonly name: string;
    readonly phone: string;
    readonly relation: string | null;
  }[];
}

/**
 * The outcome of any client request. A `2xx` is `ok:true` with the parsed `data`; every
 * other outcome is `ok:false` discriminated by `kind` (design §"API client contract").
 */
export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | {
      readonly ok: false;
      readonly kind: 'http';
      readonly status: number;
      readonly code: string;
      readonly retryAfterSeconds?: number;
    }
  | { readonly ok: false; readonly kind: 'offline' } // network error (fetch threw)
  | { readonly ok: false; readonly kind: 'timeout' }; // AbortController fired after 10 s

export interface CitizenApiClient {
  register(email: string, password: string): Promise<ApiResult<CitizenView>>;
  login(email: string, password: string): Promise<ApiResult<CitizenView>>;
  deviceAuth(deviceKey: string): Promise<ApiResult<CitizenView>>;
  getSession(): Promise<ApiResult<CitizenView>>;
  logout(): Promise<ApiResult<void>>; // DELETE /api/citizen/session
  getMedical(): Promise<ApiResult<MedicalProfile>>;
  putMedical(draft: MedicalDraft): Promise<ApiResult<MedicalProfile>>;
  deleteMedical(): Promise<ApiResult<void>>;
  deleteAccount(): Promise<ApiResult<void>>; // DELETE /api/citizen/account
}

export interface CreateCitizenClientOptions {
  readonly baseUrl: string;
  readonly store: SessionStore;
  readonly fetch?: typeof fetch;
  readonly isDevelopment?: boolean;
}

const REQUEST_TIMEOUT_MS = 10_000;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Internal: a request that already produced a `Response`, or an abort/network failure. */
type RawOutcome =
  | { readonly type: 'response'; readonly response: Response }
  | { readonly type: 'timeout' }
  | { readonly type: 'offline' };

/** Narrow an unknown parsed JSON value to a record without using `any`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Create the citizen API client. Throws synchronously when `baseUrl` is non-HTTPS and the
 * build is not a development build (R12.4), so a release can never talk to an insecure host.
 */
export function createCitizenClient(opts: CreateCitizenClientOptions): CitizenApiClient {
  const isDevelopment = opts.isDevelopment ?? devDefault();
  const fetchImpl = opts.fetch ?? fetch;
  const store = opts.store;

  const normalizedBase = opts.baseUrl.replace(/\/+$/, '');
  const isHttps = /^https:\/\//i.test(normalizedBase);
  if (!isHttps && !isDevelopment) {
    throw new Error('CitizenApiClient requires an https base URL outside development.');
  }

  /** Issue one request under a 10 s abort deadline, classifying the raw transport outcome. */
  async function raw(
    path: string,
    method: HttpMethod,
    body: unknown | undefined,
  ): Promise<RawOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = {};
    const token = await store.getSessionToken();
    if (token) {
      headers.Cookie = formatCookieHeader(token);
    }
    let serializedBody: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      serializedBody = JSON.stringify(body);
    }

    try {
      const response = await fetchImpl(`${normalizedBase}${path}`, {
        method,
        headers,
        body: serializedBody,
        signal: controller.signal,
      });
      return { type: 'response', response };
    } catch (error) {
      // An abort (our 10 s deadline fired) is a timeout; any other throw is a network/offline error.
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { type: 'timeout' };
      }
      return { type: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Persist the session token off a `set-cookie` header, if one is present (R6.5/R12.2). */
  async function captureSessionCookie(response: Response): Promise<void> {
    const setCookie = response.headers.get('set-cookie');
    const extracted = extractSessionToken(setCookie);
    if (extracted) {
      await store.setSessionToken(extracted);
    }
  }

  /** Clear the manual jar + persisted secrets. `includeDeviceKey` also drops the device key. */
  async function clearSession(includeDeviceKey: boolean): Promise<void> {
    await store.clearSessionToken();
    if (includeDeviceKey) {
      await store.clearDeviceKey();
    }
  }

  /** Parse a non-2xx body into an `http` ApiResult `{ status, code, retryAfterSeconds? }`. */
  async function toHttpError(response: Response): Promise<ApiResult<never>> {
    let code = 'unknown';
    let bodyRetry: number | undefined;
    try {
      const parsed = asRecord(await response.json());
      if (parsed) {
        if (typeof parsed.error === 'string') {
          code = parsed.error;
        }
        if (typeof parsed.retryAfterSeconds === 'number') {
          bodyRetry = parsed.retryAfterSeconds;
        }
      }
    } catch {
      // A non-JSON / empty error body leaves the generic code in place; never log it.
    }

    // Prefer the body's `retryAfterSeconds`, then fall back to the `retry-after` header.
    let retryAfterSeconds = bodyRetry;
    if (retryAfterSeconds === undefined) {
      const header = response.headers.get('retry-after');
      if (header !== null) {
        const parsedHeader = Number(header);
        if (Number.isFinite(parsedHeader)) {
          retryAfterSeconds = parsedHeader;
        }
      }
    }

    const base = { ok: false as const, kind: 'http' as const, status: response.status, code };
    return retryAfterSeconds === undefined ? base : { ...base, retryAfterSeconds };
  }

  /**
   * Core request flow shared by every method:
   *   - map a transport failure to `offline` / `timeout`;
   *   - capture the session cookie on 2xx when `captureCookie` is set;
   *   - clear the session on 2xx when `clearOnSuccess` is set, and on ANY 401;
   *   - extract `data` from a 2xx body via `extract`, or treat the body as `void`.
   */
  async function request<T>(args: {
    readonly path: string;
    readonly method: HttpMethod;
    readonly body?: unknown;
    readonly captureCookie?: boolean;
    readonly clearOnSuccess?: boolean;
    readonly clearDeviceKeyOnSuccess?: boolean;
    readonly extract: (body: unknown) => T;
  }): Promise<ApiResult<T>> {
    const outcome = await raw(args.path, args.method, args.body);
    if (outcome.type === 'timeout') {
      return { ok: false, kind: 'timeout' };
    }
    if (outcome.type === 'offline') {
      return { ok: false, kind: 'offline' };
    }

    const { response } = outcome;

    if (response.ok) {
      if (args.captureCookie) {
        await captureSessionCookie(response);
      }
      if (args.clearOnSuccess) {
        await clearSession(args.clearDeviceKeyOnSuccess ?? false);
      }
      let parsedBody: unknown = undefined;
      try {
        parsedBody = await response.json();
      } catch {
        // A 204 / empty body is expected for void results; `extract` ignores it.
      }
      return { ok: true, status: response.status, data: args.extract(parsedBody) };
    }

    // Any 401 means the session is gone: clear the jar + store before returning the error.
    if (response.status === 401) {
      await clearSession(false);
    }

    return toHttpError(response);
  }

  function extractCitizen(body: unknown): CitizenView {
    const record = asRecord(body);
    const citizen = record ? asRecord(record.citizen) : null;
    if (!citizen) {
      throw new Error('citizen response missing citizen view');
    }
    return {
      id: String(citizen.id),
      email: typeof citizen.email === 'string' ? citizen.email : null,
      emailVerified: citizen.emailVerified === true,
    };
  }

  function extractProfile(body: unknown): MedicalProfile {
    const record = asRecord(body);
    const profile = record ? asRecord(record.profile) : null;
    if (!profile) {
      throw new Error('medical response missing profile');
    }
    return profile as unknown as MedicalProfile;
  }

  const extractVoid = (): void => undefined;

  return {
    register(email: string, password: string): Promise<ApiResult<CitizenView>> {
      return request({
        path: '/api/citizen/register',
        method: 'POST',
        body: { email, password },
        captureCookie: true,
        extract: extractCitizen,
      });
    },
    login(email: string, password: string): Promise<ApiResult<CitizenView>> {
      return request({
        path: '/api/citizen/login',
        method: 'POST',
        body: { email, password },
        captureCookie: true,
        extract: extractCitizen,
      });
    },
    deviceAuth(deviceKey: string): Promise<ApiResult<CitizenView>> {
      return request({
        path: '/api/citizen/device',
        method: 'POST',
        body: { deviceKey },
        captureCookie: true,
        extract: extractCitizen,
      });
    },
    getSession(): Promise<ApiResult<CitizenView>> {
      return request({
        path: '/api/citizen/session',
        method: 'GET',
        extract: extractCitizen,
      });
    },
    logout(): Promise<ApiResult<void>> {
      return request({
        path: '/api/citizen/session',
        method: 'DELETE',
        clearOnSuccess: true,
        extract: extractVoid,
      });
    },
    getMedical(): Promise<ApiResult<MedicalProfile>> {
      return request({
        path: '/api/citizen/medical',
        method: 'GET',
        extract: extractProfile,
      });
    },
    putMedical(draft: MedicalDraft): Promise<ApiResult<MedicalProfile>> {
      return request({
        path: '/api/citizen/medical',
        method: 'PUT',
        body: draft,
        extract: extractProfile,
      });
    },
    deleteMedical(): Promise<ApiResult<void>> {
      return request({
        path: '/api/citizen/medical',
        method: 'DELETE',
        extract: extractVoid,
      });
    },
    deleteAccount(): Promise<ApiResult<void>> {
      return request({
        path: '/api/citizen/account',
        method: 'DELETE',
        clearOnSuccess: true,
        clearDeviceKeyOnSuccess: true,
        extract: extractVoid,
      });
    },
  };
}
