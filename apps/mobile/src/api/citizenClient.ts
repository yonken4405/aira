/**
 * Citizen API client for the mobile app (design §"API client contract").
 *
 * Talks ONLY to `/api/citizen/*` (R12.2), enforces a 10 s deadline on every request
 * (R3.3/R7.1/R7.8), keeps an explicit cookie jar (React Native fetch has no browser
 * cookie jar), and never logs a body, cookie, device key, or medical field.
 */

import {
  extractSessionToken,
  formatCookieHeader,
  type CitizenView,
  type MedicalDraft,
} from '@aira/ui';

import type { SessionStore } from '../storage/sessionStore';

/** Local mirror of the server `MedicalProfile` (apps/web/src/lib/medical/profile.ts). */
export interface MedicalProfile {
  readonly bloodType: MedicalDraft['bloodType'];
  readonly ageBand: MedicalDraft['ageBand'];
  readonly allergies: readonly string[];
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly notes: string | null;
  readonly contacts: MedicalDraft['contacts'];
}

export type ApiFailure =
  | {
      readonly ok: false;
      readonly kind: 'http';
      readonly status: number;
      readonly code: string;
      readonly retryAfterSeconds?: number;
    }
  | { readonly ok: false; readonly kind: 'offline' }
  | { readonly ok: false; readonly kind: 'timeout' };

export type ApiResult<T> =
  { readonly ok: true; readonly status: number; readonly data: T } | ApiFailure;

/** The one client seam every screen/provider consumes. */
export interface CitizenApiClient {
  register(email: string, password: string): Promise<ApiResult<CitizenView>>;
  login(email: string, password: string): Promise<ApiResult<CitizenView>>;
  deviceAuth(deviceKey: string): Promise<ApiResult<CitizenView>>;
  getSession(): Promise<ApiResult<CitizenView>>;
  logout(): Promise<ApiResult<void>>;
  getMedical(): Promise<ApiResult<MedicalProfile>>;
  putMedical(draft: MedicalDraft): Promise<ApiResult<MedicalProfile>>;
  deleteMedical(): Promise<ApiResult<void>>;
  deleteAccount(): Promise<ApiResult<void>>;
}

export type FetchLike = typeof fetch;

export interface CitizenApiClientOptions {
  readonly store: SessionStore;
  /** Configured base URL; defaults to the Expo `extra.citizenApiBase` value. */
  readonly baseUrl: string;
  readonly fetchImpl?: FetchLike;
  /** Request deadline; 10 s per the design. Injectable only for tests. */
  readonly timeoutMs?: number;
  /** Development only: allows an `http://` base. Release builds must use HTTPS (R12.4). */
  readonly allowInsecure?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

type RawResult =
  { readonly ok: true; readonly status: number; readonly payload: unknown } | ApiFailure;

function isDevelopment(): boolean {
  // React Native defines `__DEV__`; Jest's environment does too.
  return typeof __DEV__ !== 'undefined' ? __DEV__ : true;
}

function normalizeBaseUrl(baseUrl: string, allowInsecure: boolean): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(trimmed) && !allowInsecure) {
    // Never send citizen credentials over plain HTTP in a release build (R12.4).
    throw new Error('citizen_api_https_required');
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function citizenFrom(value: unknown): CitizenView | null {
  const wrapper = asRecord(value);
  const record = asRecord(wrapper?.['citizen']) ?? wrapper;
  if (!record) {
    return null;
  }
  const id = record['id'];
  const email = record['email'];
  const emailVerified = record['emailVerified'];
  if (typeof id !== 'string' || typeof emailVerified !== 'boolean') {
    return null;
  }
  if (email !== null && typeof email !== 'string') {
    return null;
  }
  return { id, email: email ?? null, emailVerified };
}

function profileFrom(value: unknown): MedicalProfile | null {
  const wrapper = asRecord(value);
  const record = asRecord(wrapper?.['profile']) ?? wrapper;
  if (!record) {
    return null;
  }
  const bloodType = record['bloodType'];
  const ageBand = record['ageBand'];
  const notes = record['notes'];
  const allergies = record['allergies'];
  const conditions = record['conditions'];
  const medications = record['medications'];
  const contacts = record['contacts'];

  if (!Array.isArray(allergies) || !Array.isArray(conditions) || !Array.isArray(medications)) {
    return null;
  }
  if (!Array.isArray(contacts)) {
    return null;
  }
  if (notes !== null && typeof notes !== 'string') {
    return null;
  }

  return {
    bloodType: bloodType === null || typeof bloodType === 'string' ? (bloodType as never) : null,
    ageBand: ageBand === null || typeof ageBand === 'string' ? (ageBand as never) : null,
    allergies: allergies.filter((entry): entry is string => typeof entry === 'string'),
    conditions: conditions.filter((entry): entry is string => typeof entry === 'string'),
    medications: medications.filter((entry): entry is string => typeof entry === 'string'),
    notes: notes ?? null,
    contacts: contacts.flatMap((entry) => {
      const contact = asRecord(entry);
      if (!contact) {
        return [];
      }
      const name = contact['name'];
      const phone = contact['phone'];
      const relation = contact['relation'];
      if (typeof name !== 'string' || typeof phone !== 'string') {
        return [];
      }
      return [{ name, phone, relation: typeof relation === 'string' ? relation : null }];
    }),
  };
}

/** Creates the citizen client. Throws when a release build is given a non-HTTPS base. */
export function createCitizenApiClient(options: CitizenApiClientOptions): CitizenApiClient {
  const allowInsecure = options.allowInsecure ?? isDevelopment();
  const baseUrl = normalizeBaseUrl(options.baseUrl, allowInsecure);
  const store = options.store;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch: FetchLike = options.fetchImpl ?? fetch;

  // Cookie jar: the secure-store token is the single source of truth.
  let tokenCache: string | null | undefined;

  async function currentToken(): Promise<string | null> {
    if (tokenCache === undefined) {
      tokenCache = await store.getSessionToken();
    }
    return tokenCache;
  }

  async function rememberToken(token: string): Promise<void> {
    tokenCache = token;
    await store.setSessionToken(token);
  }

  async function forgetToken(): Promise<void> {
    tokenCache = null;
    await store.clearSessionToken();
  }

  function failureFrom(status: number, body: unknown, response: Response): ApiFailure {
    const record = asRecord(body);
    const code = typeof record?.['error'] === 'string' ? record['error'] : 'unexpected_error';
    const fromBody = record?.['retryAfterSeconds'];
    const fromHeader = response.headers.get('retry-after');
    const headerSeconds = fromHeader === null ? null : Number.parseInt(fromHeader, 10);
    const retryAfterSeconds =
      typeof fromBody === 'number'
        ? fromBody
        : typeof headerSeconds === 'number' && Number.isFinite(headerSeconds)
          ? headerSeconds
          : undefined;

    return retryAfterSeconds === undefined
      ? { ok: false, kind: 'http', status, code }
      : { ok: false, kind: 'http', status, code, retryAfterSeconds };
  }

  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: `/api/citizen/${string}`,
    body?: unknown,
  ): Promise<RawResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('request_timeout'));
      }, timeoutMs);
    });

    try {
      const token = await currentToken();
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (token) {
        headers['cookie'] = formatCookieHeader(token);
      }

      const response = await Promise.race([
        doFetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        }),
        deadline,
      ]);

      if (response.ok) {
        const setCookie = response.headers.get('set-cookie');
        const issued = extractSessionToken(setCookie);
        if (issued) {
          await rememberToken(issued);
        }
      } else if (response.status === 401) {
        // Session loss everywhere: drop the stored token immediately (R6.3/R7.9).
        await forgetToken();
      }

      let payload: unknown;
      try {
        payload = response.status === 204 ? undefined : await response.json();
      } catch {
        payload = undefined;
      }

      if (!response.ok) {
        return failureFrom(response.status, payload, response);
      }
      return { ok: true, status: response.status, payload };
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.message === 'request_timeout')
      ) {
        return { ok: false, kind: 'timeout' };
      }
      return { ok: false, kind: 'offline' };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return {
    async register(email, password) {
      const result = await request('POST', '/api/citizen/register', { email, password });
      if (!result.ok) {
        return result;
      }
      const citizen = citizenFrom(result.payload);
      return citizen
        ? { ok: true, status: result.status, data: citizen }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async login(email, password) {
      const result = await request('POST', '/api/citizen/login', { email, password });
      if (!result.ok) {
        return result;
      }
      const citizen = citizenFrom(result.payload);
      return citizen
        ? { ok: true, status: result.status, data: citizen }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async deviceAuth(deviceKey) {
      // The device key leaves the app ONLY here (R3.7).
      const result = await request('POST', '/api/citizen/device', { deviceKey });
      if (!result.ok) {
        return result;
      }
      const citizen = citizenFrom(result.payload);
      return citizen
        ? { ok: true, status: result.status, data: citizen }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async getSession() {
      const result = await request('GET', '/api/citizen/session');
      if (!result.ok) {
        return result;
      }
      const citizen = citizenFrom(result.payload);
      return citizen
        ? { ok: true, status: result.status, data: citizen }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async logout() {
      const result = await request('DELETE', '/api/citizen/session');
      // Clearing local credentials is unconditional (R5.3).
      await forgetToken();
      return result.ok ? { ok: true, status: result.status, data: undefined } : result;
    },

    async getMedical() {
      const result = await request('GET', '/api/citizen/medical');
      if (!result.ok) {
        return result;
      }
      const profile = profileFrom(result.payload);
      return profile
        ? { ok: true, status: result.status, data: profile }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async putMedical(draft) {
      const result = await request('PUT', '/api/citizen/medical', draft);
      if (!result.ok) {
        return result;
      }
      const profile = profileFrom(result.payload);
      return profile
        ? { ok: true, status: result.status, data: profile }
        : { ok: false, kind: 'http', status: result.status, code: 'invalid_response' };
    },

    async deleteMedical() {
      const result = await request('DELETE', '/api/citizen/medical');
      return result.ok ? { ok: true, status: result.status, data: undefined } : result;
    },

    async deleteAccount() {
      const result = await request('DELETE', '/api/citizen/account');
      if (result.ok) {
        // Account deletion removes the device key too (R10.6).
        await forgetToken();
        await store.clearDeviceKey();
      }
      return result.ok ? { ok: true, status: result.status, data: undefined } : result;
    },
  };
}
